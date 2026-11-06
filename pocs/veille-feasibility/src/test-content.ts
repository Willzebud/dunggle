/**
 * POC 1.1 — Extraction de contenu et gestion des publications incomplètes.
 * Prérequis : `npm run test:sources` (lit results/articles.json et results/sources-report.json).
 * Passage unique et séquentiel : 3 pages Hugging Face + 3 pages Google Research
 * + 1 page (la plus récente) par autre source pour vérifier les liens. Aucun LLM.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { SOURCES, SETTINGS } from './sources.config.js';
import { classifyContent, titleCoverage, CONTENT_LEVEL_THRESHOLDS, type ContentLevelCode } from './content-level.js';
import { extractPage, shingleSimilarity, type PageExtraction } from './extract.js';
import { dedupKey, isValidHttpUrl, looksLikeHomepage, sameResource } from './url-utils.js';
import { PRICE_SCENARIOS, TOKEN_ASSUMPTIONS } from './report.js';
import type { NormalizedArticle, SourceReport } from './types.js';

const RESULTS = new URL('../results/', import.meta.url);
const TARGET_SOURCES = ['huggingface-blog', 'google-research'];
const PAGES_PER_TARGET = 3;

/** Pages de liste des sources : une URL d'article identique à l'une d'elles pointerait vers l'accueil. */
function listingUrls(sourceId: string): string[] {
  const s = SOURCES.find((x) => x.id === sourceId)!;
  if (s.type === 'github-releases') {
    const repo = s.url.replace('https://api.github.com/repos/', '').replace(/\/releases$/, '');
    return [`https://github.com/${repo}`, `https://github.com/${repo}/releases`];
  }
  const extra: Record<string, string[]> = {
    'huggingface-blog': ['https://huggingface.co/blog'],
    'google-research': ['https://research.google/blog'],
    'openai-news': ['https://openai.com/news'],
    'deepmind-blog': ['https://deepmind.google/blog', 'https://deepmind.google/discover/blog'],
  };
  return [new URL(s.url).origin + '/', ...(extra[sourceId] ?? [])];
}

const RANK: Record<ContentLevelCode, number> = { MINIMAL: 0, PARTIAL: 1, FULL: 2 };
const best = (a: ContentLevelCode, b: ContentLevelCode) => (RANK[a] >= RANK[b] ? a : b);
const DAY = 86_400_000;

type LinkVerdict = 'OK' | 'OK (redirection vers la même publication)' | 'OK (redirection vers la publication, autre URL)' | 'REDIRIGÉ vers une autre page' | 'REDIRIGÉ vers l’accueil' | 'INACCESSIBLE' | 'BLOQUÉ (anti-bot)' | 'NON VÉRIFIÉ (robots.txt)' | 'ERREUR RÉSEAU';

function linkVerdict(article: NormalizedArticle, ex: PageExtraction, titleMatch: number | null): LinkVerdict {
  if (ex.robots.allowed === false) return 'NON VÉRIFIÉ (robots.txt)';
  const t = ex.trace;
  if (!t || t.error) return 'ERREUR RÉSEAU';
  if (ex.error?.includes('anti-bot')) return 'BLOQUÉ (anti-bot)';
  if (!t.status || t.status >= 400) return 'INACCESSIBLE';
  if (t.redirected && t.finalUrl && !sameResource(t.finalUrl, article.url!)) {
    // Même publication republiée à une autre adresse (titre de la page cible conforme au flux)
    if (titleMatch !== null && titleMatch >= 0.6 && !looksLikeHomepage(t.finalUrl, listingUrls(article.sourceId))) {
      return 'OK (redirection vers la publication, autre URL)';
    }
    return looksLikeHomepage(t.finalUrl, listingUrls(article.sourceId)) ? 'REDIRIGÉ vers l’accueil' : 'REDIRIGÉ vers une autre page';
  }
  return t.redirected ? 'OK (redirection vers la même publication)' : 'OK';
}

interface PageTest {
  article: Pick<NormalizedArticle, 'id' | 'sourceId' | 'sourceName' | 'title' | 'url' | 'publishedAt' | 'contentLength' | 'contentLevel'>;
  purpose: 'extraction' | 'vérification de lien';
  extraction: Omit<PageExtraction, 'text'> & { textChars: number; textPreview: string };
  link: LinkVerdict;
  titleMatch: number | null;
  dateCheck: string;
  genericSimilarity: number | null;
  pageLevel: ContentLevelCode | null;
  pageLevelReasons: string[];
  feedLevel: ContentLevelCode;
  finalLevel: ContentLevelCode;
  issues: string[];
}

function dateCheck(feed: string | null, page: string | null): string {
  if (!page) return feed ? 'Date absente de la page (date du flux conservée)' : 'Aucune date';
  if (!feed) return `Date page ${page.slice(0, 10)} (pas de date flux)`;
  const diffH = Math.abs(new Date(feed).getTime() - new Date(page).getTime()) / 3_600_000;
  return diffH <= 36 ? `Cohérente avec le flux (écart ${diffH.toFixed(0)} h)` : `⚠️ Écart de ${(diffH / 24).toFixed(1)} j avec le flux`;
}

async function main() {
  const { articles } = JSON.parse(await readFile(new URL('articles.json', RESULTS), 'utf8')) as { articles: NormalizedArticle[] };
  const srcReport = JSON.parse(await readFile(new URL('sources-report.json', RESULTS), 'utf8')) as { sources: SourceReport[] };
  const startedAt = new Date().toISOString();
  console.log(`POC 1.1 — ${articles.length} publications chargées depuis results/articles.json\n`);

  // ---------- 1. Vérification statique des 120 URL (sans requête) ----------
  const seen = new Map<string, string>();
  const staticChecks = articles.map((a) => {
    const valid = isValidHttpUrl(a.url);
    const dk = valid ? dedupKey(a.url!) : null;
    const homepage = valid ? looksLikeHomepage(a.url!, listingUrls(a.sourceId)) : null;
    const duplicateOf = dk && seen.has(dk.key) ? seen.get(dk.key)! : null;
    if (dk && !seen.has(dk.key)) seen.set(dk.key, a.id);
    return { id: a.id, sourceId: a.sourceId, url: a.url, valid, https: valid && a.url!.startsWith('https://'), homepage, dedupKey: dk?.key ?? null, removedParams: dk?.removed ?? [], duplicateOf };
  });

  // ---------- 2. Sélection des pages à tester ----------
  const selections: { article: NormalizedArticle; purpose: PageTest['purpose'] }[] = [];
  for (const sid of TARGET_SOURCES) {
    articles.filter((a) => a.sourceId === sid && isValidHttpUrl(a.url)).slice(0, PAGES_PER_TARGET).forEach((article) => selections.push({ article, purpose: 'extraction' }));
  }
  for (const s of SOURCES.filter((x) => !TARGET_SOURCES.includes(x.id))) {
    const a = articles.find((x) => x.sourceId === s.id && isValidHttpUrl(x.url));
    if (a) selections.push({ article: a, purpose: 'vérification de lien' });
  }

  // ---------- 3. Requêtes (séquentielles) ----------
  const raw: { sel: (typeof selections)[number]; ex: PageExtraction }[] = [];
  for (const sel of selections) {
    process.stdout.write(`→ [${sel.purpose === 'extraction' ? 'EXTRACTION' : 'LIEN      '}] ${sel.article.sourceName.padEnd(26)} `);
    const ex = await extractPage(sel.article.url!);
    raw.push({ sel, ex });
    console.log(`${ex.trace?.status ?? '—'} ${ex.text.length} car.${ex.error ? ` | ${ex.error}` : ''}`);
  }

  // ---------- 4. Analyse : détection de texte générique (pages d'une même source) ----------
  const maxSim = new Map<string, number>();
  for (const sid of TARGET_SOURCES) {
    const group = raw.filter((r) => r.sel.article.sourceId === sid && r.sel.purpose === 'extraction' && r.ex.text);
    for (const a of group) {
      let m = 0;
      for (const b of group) if (a !== b) m = Math.max(m, shingleSimilarity(a.ex.text, b.ex.text));
      maxSim.set(a.sel.article.id, m);
    }
  }

  const tests: PageTest[] = raw.map(({ sel, ex }) => {
    const a = sel.article;
    const sim = maxSim.get(a.id) ?? null;
    const generic = sim !== null && sim > 0.5;
    const tm = ex.title ? titleCoverage(a.title, ex.title) : null;
    // GitHub : le contenu vient déjà de l'API (notes de release) ; la page ne sert qu'à vérifier le lien.
    const isGitHub = SOURCES.find((s) => s.id === a.sourceId)?.type === 'github-releases';
    const pl = ex.text && !isGitHub ? classifyContent({ title: a.title, text: ex.text, origin: 'page', genericSuspected: generic, pageTitleMatch: tm }) : null;
    const feedLevel = a.contentLevel ?? 'MINIMAL';
    const pageLevel = pl?.level ?? null;
    const issues: string[] = [];
    if (ex.error) issues.push(ex.error);
    if (ex.usageSignals.length) issues.push(`Signaux d’usage : ${ex.usageSignals.join(' ; ')}`);
    if (ex.trace?.redirected) issues.push(`Redirection → ${ex.trace.finalUrl}`);
    if (tm !== null && tm < 0.6) issues.push(`Titre extrait différent du flux (« ${ex.title} »)`);
    if (generic) issues.push(`Texte très proche d’une autre page (similarité ${(sim! * 100).toFixed(0)} %)`);
    if (ex.readerable === false && ex.text) issues.push('Page jugée peu « lisible » par Readability (extraction quand même tentée)');
    const { text, ...exMeta } = ex;
    return {
      article: { id: a.id, sourceId: a.sourceId, sourceName: a.sourceName, title: a.title, url: a.url, publishedAt: a.publishedAt, contentLength: a.contentLength, contentLevel: a.contentLevel },
      purpose: sel.purpose,
      extraction: { ...exMeta, textChars: text.length, textPreview: text.slice(0, 300) },
      link: linkVerdict(a, ex, tm),
      titleMatch: tm === null ? null : Math.round(tm * 100) / 100,
      dateCheck: dateCheck(a.publishedAt, ex.publishedAt),
      genericSimilarity: sim === null ? null : Math.round(sim * 100) / 100,
      pageLevel,
      pageLevelReasons: pl?.reasons ?? [],
      feedLevel,
      finalLevel: pageLevel ? best(feedLevel, pageLevel) : feedLevel,
      issues,
    };
  });

  const finishedAt = new Date().toISOString();
  const output = { generatedAt: finishedAt, startedAt, thresholds: CONTENT_LEVEL_THRESHOLDS, tests, staticUrlChecks: staticChecks };
  await writeFile(new URL('content-extraction.json', RESULTS), JSON.stringify(output, null, 2));
  await writeFile(new URL('content-extraction-report.md', RESULTS), buildReport(tests, staticChecks, articles, srcReport.sources, startedAt, finishedAt));
  const reqs = tests.reduce((s, t) => s + (t.extraction.fetched ? 1 : 0), 0);
  console.log(`\n${tests.length} pages testées (${reqs} requêtes de page + robots.txt par domaine).`);
  console.log('Résultats : results/content-extraction-report.md, results/content-extraction.json');
}

// ======================================================================================
function buildReport(
  tests: PageTest[],
  staticChecks: { id: string; sourceId: string; url: string | null; valid: boolean; https: boolean; homepage: boolean | null; dedupKey: string | null; removedParams: string[]; duplicateOf: string | null }[],
  articles: NormalizedArticle[],
  sources: SourceReport[],
  startedAt: string,
  finishedAt: string,
): string {
  const L: string[] = [];
  const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const T = CONTENT_LEVEL_THRESHOLDS;
  const ext = tests.filter((t) => t.purpose === 'extraction');

  L.push('# POC 1.1 — Extraction de contenu et publications incomplètes', '');
  L.push(`- **Exécution** : ${startedAt} → ${finishedAt}`);
  L.push(`- **Méthode** : vérification de robots.txt, puis une requête GET par page autorisée, puis extraction générique avec Mozilla Readability (aucune règle propre à un site). Dates lues dans les métadonnées standard (Open Graph, JSON-LD, <time>).`);
  L.push(`- **User-Agent** : \`${SETTINGS.userAgent}\` ; ${SETTINGS.delayBetweenRequestsMs} ms entre requêtes ; aucun appel à un LLM ; aucun contournement.`);
  L.push('- Toutes les valeurs proviennent des réponses réelles au moment de l’exécution.', '');

  // ---------- 1. Les 6 publications ----------
  L.push('## 1. Extraction : 6 publications testées', '');
  L.push('| # | Source | Publication (URL originale) | HTTP | robots.txt | Caractères flux → page | Niveau flux → page | Date | Erreurs / restrictions |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  ext.forEach((t, i) => {
    const e = t.extraction;
    L.push(
      `| ${i + 1} | ${t.article.sourceName} | [${esc(t.article.title)}](${t.article.url}) | ${e.trace?.status ?? '—'} | ${e.robots.allowed === false ? '❌ interdit' : e.robots.checked ? '✅ autorisé' : '⚠️ non vérifiable'} | ${t.article.contentLength} → **${e.textChars}** | ${t.feedLevel} → **${t.pageLevel ?? 'n/a'}** | ${esc(t.dateCheck)} | ${t.issues.length ? esc(t.issues.join(' ; ')) : 'Aucune'} |`,
    );
  });
  L.push('');
  L.push('**Contrôles de correspondance avec l’article (texte extrait) :**', '');
  L.push('| # | Titre extrait | Titre conforme au flux | Couverture du titre dans le texte | Similarité max. avec une autre page de la source | Début du texte extrait |');
  L.push('|---|---|---|---|---|---|');
  ext.forEach((t, i) => {
    const cov = titleCoverage(t.article.title, t.extraction.textPreview.length ? (t.extraction.textPreview + ' ') : '');
    const fullCov = t.pageLevelReasons.find((r) => r.includes('couverture du titre'))?.match(/(\d+) %/)?.[1];
    L.push(
      `| ${i + 1} | ${esc(t.extraction.title ?? '—')} | ${t.titleMatch === null ? '—' : t.titleMatch >= 0.6 ? `✅ (${Math.round(t.titleMatch * 100)} %)` : `❌ (${Math.round(t.titleMatch * 100)} %)`} | ${fullCov ? `${fullCov} %` : cov === null ? '—' : `${Math.round(cov * 100)} % (début)`} | ${t.genericSimilarity === null ? '—' : `${Math.round(t.genericSimilarity * 100)} %`} | « ${esc(t.extraction.textPreview.slice(0, 160))}… » |`,
    );
  });
  L.push('', `Un texte est rejeté (MINIMAL) s’il est identique à plus de 50 % (5-grammes) à celui d’une autre page de la même source, ce qui indique un contenu générique. Il est aussi rejeté si la correspondance avec l’article n’est pas établie : il faut soit qu’au moins ${T.MIN_TITLE_COVERAGE * 100} % des mots significatifs du titre figurent dans le texte, soit (règle « titre long ») qu’au moins ${T.MIN_TITLE_TOKENS_FOUND} mots du titre y figurent **et** que le titre de la page corresponde à celui du flux (≥ ${T.MIN_PAGE_TITLE_MATCH * 100} %).`, '');
  L.push('> **Calibration** : lors d’une première exécution, la règle reposait uniquement sur la couverture du titre (≥ 50 %). L’article Hugging Face « A Closer Look at Phonon TTS… » a alors été classé MINIMAL alors que le texte extrait était bien l’article (titre de page identique, aucune similarité avec les autres pages) : son titre marketing est long et seuls 45 % de ses mots apparaissent dans le texte. La règle « titre long » a été ajoutée pour corriger ce faux négatif. Elle exige toujours que le texte contienne plusieurs mots du titre.', '');

  // ---------- Comparaison ----------
  L.push('### Comparaison des deux sources', '');
  L.push('| Source | Pages autorisées / testées | HTTP 200 | Extraction FULL | Médiane caractères extraits | Date dans la page | Signaux d’usage |');
  L.push('|---|---|---|---|---|---|---|');
  const perSource = TARGET_SOURCES.map((sid) => {
    const g = ext.filter((t) => t.article.sourceId === sid);
    const chars = g.map((t) => t.extraction.textChars).sort((a, b) => a - b);
    const med = chars.length ? chars[Math.floor(chars.length / 2)] : 0;
    return {
      sid,
      name: g[0]?.article.sourceName ?? sid,
      g,
      allowed: g.filter((t) => t.extraction.robots.allowed !== false).length,
      ok200: g.filter((t) => t.extraction.trace?.status === 200).length,
      full: g.filter((t) => t.pageLevel === 'FULL').length,
      partialOrBetter: g.filter((t) => t.pageLevel && t.pageLevel !== 'MINIMAL').length,
      med,
      dated: g.filter((t) => t.extraction.publishedAt).length,
      signals: [...new Set(g.flatMap((t) => t.extraction.usageSignals))],
    };
  });
  for (const p of perSource) {
    L.push(`| ${p.name} | ${p.allowed}/${p.g.length} | ${p.ok200}/${p.g.length} | ${p.full}/${p.g.length} | ${p.med} | ${p.dated}/${p.g.length} | ${p.signals.join(' ; ') || 'Aucun'} |`);
  }
  L.push('');

  L.push('### Recommandation par source', '');
  const recoBySource = new Map<string, { mode: ContentLevelCode; text: string }>();
  for (const p of perSource) {
    let mode: ContentLevelCode;
    let text: string;
    const restrictive = p.signals.filter((s) => /noai|noimageai|nosnippet|noarchive|tdm-reservation: ?1/i.test(s));
    if (p.full === p.g.length && p.g.length > 0) {
      mode = 'FULL';
      text = `**Conserver, en mode FULL avec extraction de la page.** ${p.full}/${p.g.length} articles extraits en entier (médiane ${p.med} caractères). Cela coûte une requête de plus par publication, autorisée par robots.txt. Si l’extraction échoue, la publication repasse en MINIMAL (titre, date et lien fiables).`;
    } else if (p.partialOrBetter > 0) {
      mode = p.full > 0 ? 'FULL' : 'PARTIAL';
      text = `**Conserver, extraction irrégulière** (${p.full} FULL, ${p.partialOrBetter} au moins PARTIAL sur ${p.g.length}). Classer chaque publication individuellement et repasser en MINIMAL si l’extraction échoue.`;
    } else {
      mode = 'MINIMAL';
      text = `**Conserver en mode MINIMAL.** Titre, date et lien sont fiables, mais l’extraction n’aboutit pas. Aucun résumé ne sera généré.`;
    }
    if (restrictive.length) text += ` ⚠️ Signal d’usage à examiner avant tout traitement automatisé du texte : ${restrictive.join(' ; ')}.`;
    text += ' Les conditions d’utilisation du site restent à valider humainement : ce POC ne vérifie que robots.txt et les signaux techniques.';
    recoBySource.set(p.sid, { mode, text });
    L.push(`- **${p.name}** : ${text}`);
  }
  L.push('');

  // ---------- 2. URLs ----------
  L.push('## 2. Conservation et vérification des URL', '');
  const total = staticChecks.length;
  const valid = staticChecks.filter((c) => c.valid).length;
  const https = staticChecks.filter((c) => c.https).length;
  const home = staticChecks.filter((c) => c.homepage).length;
  const dups = staticChecks.filter((c) => c.duplicateOf).length;
  const withTracking = staticChecks.filter((c) => c.removedParams.length);
  L.push('**Contrôles sans requête, sur les ' + total + ' publications de `articles.json` :**', '');
  L.push(`- URL présentes et valides : **${valid}/${total}** (HTTPS : ${https}/${total})`);
  L.push(`- URL pointant vers une page d’accueil ou de liste : **${home}**`);
  L.push(`- Doublons détectés après normalisation : **${dups}**`);
  const paramsBySource = new Map<string, Set<string>>();
  for (const c of withTracking) {
    const s = paramsBySource.get(c.sourceId) ?? new Set();
    c.removedParams.forEach((p) => s.add(p));
    paramsBySource.set(c.sourceId, s);
  }
  L.push(`- URL contenant des paramètres de suivi : **${withTracking.length}** (${[...paramsBySource].map(([s, p]) => `${s} : ${[...p].join(', ')}`).join(' ; ') || 'aucune'})`);
  const ex1 = withTracking[0];
  if (ex1) {
    L.push('', 'Exemple : l’URL de consultation reste intacte, seule la clé de déduplication est nettoyée :', '');
    L.push('```');
    L.push(`url      : ${ex1.url}`);
    L.push(`dedupKey : ${ex1.dedupKey}`);
    L.push('```');
  }
  L.push('');
  L.push('**Vérification HTTP réelle (les 6 pages extraites, plus la publication la plus récente de chacune des 10 autres sources) :**', '');
  L.push('| Source | URL originale | HTTP | Redirection | Verdict du lien | Pointe vers l’article |');
  L.push('|---|---|---|---|---|---|');
  for (const t of tests) {
    const tr = t.extraction.trace;
    const homepageFinal = tr?.finalUrl ? looksLikeHomepage(tr.finalUrl, listingUrls(t.article.sourceId)) : null;
    L.push(
      `| ${t.article.sourceName} | ${t.article.url} | ${tr?.status ?? '—'} | ${tr?.redirected ? `→ ${tr.finalUrl}` : 'Non'} | ${t.link} | ${homepageFinal === null ? '—' : homepageFinal ? '❌ accueil' : '✅'} |`,
    );
  }
  const broken = tests.filter((t) => !t.link.startsWith('OK'));
  L.push('');
  L.push(broken.length ? `⚠️ **Liens à signaler** : ${broken.map((t) => `${t.article.sourceName} (${t.link})`).join(' ; ')}.` : '✅ Tous les liens vérifiés sont accessibles et pointent vers la publication.');
  L.push('', 'Règle retenue : `url` = lien exact fourni par la source, jamais modifié (bouton « Lire l’article »). `dedupKey` = forme normalisée sans `utm_*`, `fbclid`, `gclid`, `source=rss…` (Medium), fragment, `www` ni slash final ; elle sert uniquement à la déduplication. Si une redirection mène vers une autre page ou vers l’accueil, ou si le lien renvoie une erreur 4xx/5xx, il faut le signaler sans le réécrire.', '');

  // ---------- 3. Classification ----------
  L.push('## 3. Classification technique du contenu (FULL / PARTIAL / MINIMAL)', '');
  L.push('> Cette classification mesure uniquement la **disponibilité** du contenu. Elle ne mesure pas sa **pertinence**, qui sera évaluée par l’IA au POC 2. Une publication MINIMAL peut être très pertinente.', '');
  L.push('Critères appliqués dans l’ordre (`src/content-level.ts`) :', '');
  L.push(`1. **Qualité** : le texte passe en MINIMAL s’il est vide, s’il ne fait que répéter le titre, s’il se réduit à une étiquette de catégorie ou s’il est générique (identique à d’autres pages). Pour une page extraite, il passe aussi en MINIMAL si la correspondance avec l’article n’est pas établie (couverture du titre ≥ ${T.MIN_TITLE_COVERAGE * 100} %, ou au moins ${T.MIN_TITLE_TOKENS_FOUND} mots du titre retrouvés avec un titre de page conforme au flux).`);
  L.push(`2. **FULL** : au moins ${T.FULL_MIN_CHARS} caractères **et** au moins ${T.FULL_MIN_WORDS} mots de texte valide.`);
  L.push(`3. **PARTIAL** : au moins ${T.PARTIAL_MIN_CHARS} caractères **et** au moins ${T.PARTIAL_MIN_WORDS} mots de texte valide.`);
  L.push('4. **MINIMAL** : tout le reste (titre, URL et éventuellement date et métadonnées).', '');
  L.push('Le niveau d’une publication est le meilleur niveau entre le contenu du flux et le contenu extrait de la page.', '');

  L.push('**Répartition des 120 publications selon le contenu du flux seul, et mode atteignable :**', '');
  L.push('| Source | FULL | PARTIAL | MINIMAL | Mode via le flux | Page testée | Mode atteignable |');
  L.push('|---|---|---|---|---|---|---|');
  const modeSummary: { name: string; feedMode: ContentLevelCode; reachable: ContentLevelCode; basis: string }[] = [];
  for (const s of SOURCES) {
    const arts = articles.filter((a) => a.sourceId === s.id);
    const d = { FULL: 0, PARTIAL: 0, MINIMAL: 0 } as Record<ContentLevelCode, number>;
    for (const a of arts) d[a.contentLevel ?? 'MINIMAL']++;
    const feedMode = sources.find((r) => r.source.id === s.id)?.analysis.exploitationMode ?? 'MINIMAL';
    const pageTests = tests.filter((t) => t.article.sourceId === s.id && t.pageLevel);
    let reachable = feedMode;
    let basis = '—';
    if (TARGET_SOURCES.includes(s.id)) {
      reachable = best(feedMode, recoBySource.get(s.id)?.mode ?? 'MINIMAL');
      basis = `${pageTests.filter((t) => t.pageLevel === 'FULL').length}/${tests.filter((t) => t.article.sourceId === s.id).length} pages FULL`;
    } else if (pageTests.length) {
      const pl = pageTests[0].pageLevel!;
      basis = `1 page : ${pl} (${pageTests[0].extraction.textChars} car., indicatif)`;
      reachable = best(feedMode, pl);
    } else {
      const t = tests.find((x) => x.article.sourceId === s.id);
      basis = !t ? 'non testée' : s.type === 'github-releases' ? `lien ${t.link} ; contenu fourni par l’API (extraction inutile)` : `1 page : non extraite (${t.link})`;
    }
    modeSummary.push({ name: s.name, feedMode, reachable, basis });
    L.push(`| ${s.name} | ${d.FULL} | ${d.PARTIAL} | ${d.MINIMAL} | ${feedMode} | ${basis} | **${reachable}**${reachable !== feedMode ? ' (avec extraction)' : ''} |`);
  }
  L.push('', 'Pour les autres sources, le niveau atteignable avec extraction repose sur **une seule page** : c’est une indication, pas une validation. Pour les dépôts GitHub, le niveau est celui des notes de release fournies par l’API.', '');

  // ---------- 4. Niveaux d'exploitation ----------
  L.push('## 4. Trois niveaux d’exploitation (comportement cible)', '');
  L.push('| Niveau | Données disponibles | Traitement futur (POC 2 et suivants) |');
  L.push('|---|---|---|');
  L.push('| **FULL** (complet) | Titre, URL originale, date, contenu détaillé | Analyse de pertinence par IA, classification thématique, résumé, points clés |');
  L.push('| **PARTIAL** (partiel) | Titre, URL originale, date, extrait court | Classification thématique, estimation de pertinence, résumé **strictement limité** à l’extrait |');
  L.push('| **MINIMAL** | Titre, URL originale, éventuellement date et métadonnées | Pertinence estimée sur le titre et les métadonnées uniquement, **aucun résumé**, conservation si la pertinence est suffisante |');
  L.push('');
  L.push('**Règle fondamentale** : une publication n’est **jamais** exclue parce que son contenu est inaccessible. Elle ne peut être exclue que si elle est manifestement hors sujet, ce qui relève de la pertinence et non de la disponibilité. Le niveau de contenu sert à choisir le traitement, pas à filtrer.', '');
  L.push('Garde-fous contre le contenu fictif, à reprendre au POC 2 :');
  L.push('- Le prompt reçoit le niveau (`contentLevel`) et l’instruction de n’utiliser que le texte fourni.');
  L.push('- En MINIMAL, aucun champ « résumé » n’est demandé au modèle ; le dashboard affiche « Contenu non analysé ».');
  L.push('- En PARTIAL, le résumé ne doit pas dépasser l’information de l’extrait (contrôle possible : longueur du résumé ≤ longueur de l’extrait).', '');

  // ---------- 5. Dashboard ----------
  L.push('## 5. Comportement attendu du dashboard (à implémenter plus tard)', '');
  L.push('| Élément | FULL | PARTIAL | MINIMAL |');
  L.push('|---|---|---|---|');
  L.push('| Titre | ✅ | ✅ | ✅ |');
  L.push('| Source | ✅ | ✅ | ✅ |');
  L.push('| Date | ✅ | ✅ | ✅ si disponible |');
  L.push('| Contenu affiché | Résumé IA et points clés | Informations disponibles (extrait, résumé limité) | Mention « Contenu non analysé » |');
  L.push('| Pertinence | Score de pertinence | Pertinence estimée | Pertinence estimée sur le titre et les métadonnées |');
  L.push('| Bouton « Lire l’article » | ✅ | ✅ | ✅ |');
  L.push('');
  L.push('- Le bouton ouvre **toujours l’URL originale exacte** (`url`), jamais `dedupKey` ni une URL reconstruite.');
  L.push('- Les publications MINIMAL restent **éligibles aux rapports quotidiens** si leur pertinence estimée dépasse le seuil retenu.');
  L.push('- Un badge de niveau (Complet / Partiel / Minimal) indique à l’utilisateur la profondeur d’analyse, à ne pas confondre avec la pertinence.');
  L.push('- Un lien signalé comme cassé (4xx/5xx, redirection vers l’accueil) reste affiché, avec un avertissement.', '');

  // ---------- 6. Synthèse ----------
  const hf = perSource.find((p) => p.sid === 'huggingface-blog')!;
  const gr = perSource.find((p) => p.sid === 'google-research')!;
  const reliable = (p: typeof hf) => p.full === p.g.length && p.g.length > 0;
  const nFull = modeSummary.filter((m) => m.reachable === 'FULL').length;
  const nFullFeed = modeSummary.filter((m) => m.feedMode === 'FULL').length;
  const nPartial = modeSummary.filter((m) => m.reachable === 'PARTIAL').length;
  const nMinimal = modeSummary.filter((m) => m.reachable === 'MINIMAL').length;
  const blocked = tests.filter((t) => t.link.startsWith('BLOQUÉ') || t.link.startsWith('NON VÉRIFIÉ') || t.link === 'INACCESSIBLE');

  L.push('## 6. Synthèse', '');
  L.push(`**1. Extraction fiable du contenu ?**`);
  for (const p of [hf, gr]) {
    L.push(`- ${p.name} : ${reliable(p) ? `✅ oui sur l’échantillon (${p.full}/${p.g.length} FULL, médiane ${p.med} caractères, titre et texte conformes à l’article)` : `❌ non fiable (${p.full}/${p.g.length} FULL)`}. robots.txt : ${p.allowed}/${p.g.length} pages autorisées. Date trouvée dans la page : ${p.dated}/${p.g.length}.`);
  }
  L.push('- Limite : l’échantillon ne compte que 3 pages par source. Un changement de gabarit HTML pourrait dégrader l’extraction, d’où le repli automatique en MINIMAL.', '');
  L.push('**2. Les publications sans contenu restent-elles exploitables en mode minimal ?**');
  const minimalOk = articles.filter((a) => isValidHttpUrl(a.url) && a.title && a.publishedAt).length;
  L.push(`- ✅ Oui. ${minimalOk}/${articles.length} publications ont un titre, une URL valide et une date fiable, ce qui est le socle du mode MINIMAL. Aucun résumé n’est produit dans ce mode.`, '');
  L.push('**3. Limites techniques identifiées**');
  L.push('- L’extraction double le nombre de requêtes pour les sources concernées (une par nouvelle publication) ; il faut la limiter aux nouvelles publications et respecter un délai entre requêtes.');
  L.push('- Readability est générique : il peut inclure des légendes ou des blocs annexes, ou manquer du contenu chargé en JavaScript. Le contrôle de correspondance titre/texte limite ce risque sans l’éliminer.');
  L.push('- Les contrôles de pertinence du texte (couverture du titre, similarité entre pages) sont heuristiques : ils détectent les cas grossiers (page générique, mauvaise page), pas les extractions partielles subtiles.');
  L.push('- robots.txt ne remplace pas les conditions d’utilisation : la réutilisation du texte intégral (stockage, envoi à un LLM) doit être validée juridiquement, notamment l’opt-out TDM en droit européen.');
  if (blocked.length) L.push(`- Pages non vérifiables automatiquement : ${blocked.map((t) => `${t.article.sourceName} (${t.link})`).join(' ; ')}. Ces liens restent conservés et cliquables.`);
  L.push('- Le niveau atteignable des autres sources repose sur une seule page chacune.');
  L.push('- Le contrôle de correspondance par les mots du titre ne fonctionne pas pour les titres réduits à un numéro de version (releases GitHub : « 2.4.0 », « v2.1.318 »). C’est sans conséquence ici, puisque le contenu GitHub vient de l’API et non de la page, mais ce contrôle ne doit pas être appliqué à ce type de titre.', '');
  L.push('**4. Sources à remplacer**');
  L.push('- Aucune source n’a besoin d’être remplacée pour des raisons d’accès : toutes fournissent un titre, une URL et une date fiables.');
  L.push(`- Pour enrichir la catégorie IA en contenu FULL **sans extraction**, il faudrait des flux avec contenu intégral. Sur les 12 sources, ${nFullFeed} sont FULL via le flux seul.`, '');
  L.push('**5. Conséquences pour le futur système de veille**');
  L.push('- Le modèle de données doit porter `contentLevel` (disponibilité) **et** un score de pertinence distinct.');
  L.push('- Le pipeline devient : collecte du flux → classification du niveau → extraction de la page si autorisée et utile → reclassification → analyse IA adaptée au niveau.');
  L.push('- Le coût IA dépend du niveau : une publication MINIMAL coûte environ le prompt plus le titre, une publication FULL coûte jusqu’à la troncature du contenu.', '');

  // ---------- 7. Budget POC 2 ----------
  L.push('## 7. Impact sur le budget du POC 2 (projection, aucun appel IA)', '');
  let inFeed = 0, inExtract = 0, out = 0;
  for (const s of SOURCES) {
    const r = sources.find((x) => x.source.id === s.id);
    const perMonth = (r?.analysis.estimatedPerDay ?? 0) * 30;
    const feedChars = r?.analysis.medianContentLength ?? 0;
    const p = perSource.find((x) => x.sid === s.id);
    const extChars = p && reliable(p) ? p.med : feedChars;
    const tok = (c: number) => Math.min(c, TOKEN_ASSUMPTIONS.maxInputCharsPerArticle) / TOKEN_ASSUMPTIONS.charsPerToken + TOKEN_ASSUMPTIONS.promptOverheadTokens;
    inFeed += perMonth * tok(feedChars);
    inExtract += perMonth * tok(Math.max(feedChars, extChars));
    out += perMonth * TOKEN_ASSUMPTIONS.outputTokensPerArticle;
  }
  L.push(`Mêmes hypothèses que \`feasibility-report.md\` (troncature à ${TOKEN_ASSUMPTIONS.maxInputCharsPerArticle} caractères, ${TOKEN_ASSUMPTIONS.promptOverheadTokens} tokens de prompt, ${TOKEN_ASSUMPTIONS.outputTokensPerArticle} tokens de sortie, prix **hypothétiques**).`, '');
  L.push('| Scénario de prix (hypothétique) | Flux seul | Avec extraction HF + Google Research |');
  L.push('|---|---|---|');
  for (const p of PRICE_SCENARIOS) {
    const c = (i: number) => ((i / 1e6) * p.inPerM + (out / 1e6) * p.outPerM).toFixed(2);
    L.push(`| ${p.label} (${p.inPerM} $ / ${p.outPerM} $ par M) | ~${c(inFeed)} $/mois | ~${c(inExtract)} $/mois |`);
  }
  L.push('', `Tokens d’entrée : ~${(inFeed / 1e6).toFixed(2)} M/mois avec le flux seul, ~${(inExtract / 1e6).toFixed(2)} M/mois avec extraction.`, '');
  L.push('Mécanismes de maîtrise du budget à prévoir au POC 2 :');
  L.push('- **Plafond mensuel applicatif** strictement inférieur à 10 € (ex. 8 €), avec une marge pour les retraitements.');
  L.push('- **Quota quotidien** = plafond restant ÷ jours restants. Chaque appel est comptabilisé en tokens réels (usage renvoyé par l’API) avant le suivant.');
  L.push('- **Arrêt automatique** dès que le quota du jour ou le plafond du mois est atteint : les publications restent stockées avec le statut « en attente d’analyse » et ne sont jamais supprimées.');
  L.push('- **Ordre de traitement** suggéré quand le quota approche : MINIMAL et PARTIAL d’abord (peu coûteux), puis FULL. Ce choix reste à arbitrer au POC 2.', '');
  return L.join('\n');
}

main().catch((err) => {
  console.error('Échec inattendu du POC 1.1 :', err);
  process.exitCode = 1;
});
