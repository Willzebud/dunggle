/**
 * POC 1.2 — Test des sources candidates, qualité éditoriale, couverture et volume.
 *   npm run test:candidates            → collecte (1 passage) + rapports
 *   npm run test:candidates -- --offline → rapports régénérés depuis candidates-raw.json, sans requête
 * Aucun LLM. Les 12 sources existantes ne sont PAS re-téléchargées : leurs données viennent de results/.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { SETTINGS, SOURCES as ALL_SOURCES, INITIAL_SOURCE_IDS } from '../sources.config.js';

// Le POC 1.2 compare toujours aux 12 sources INITIALES, même après l'intégration des candidates retenues.
const SOURCES = ALL_SOURCES.filter((s) => INITIAL_SOURCE_IDS.includes(s.id));
import { checkRobots } from '../http.js';
import { collectFeed } from '../collectors/feed.js';
import { analyze } from '../analysis.js';
import { extractPage } from '../extract.js';
import { classifyContent, significantTokens, type ContentLevelCode } from '../content-level.js';
import { PRICE_SCENARIOS, TOKEN_ASSUMPTIONS } from '../report.js';
import { CANDIDATES, CANDIDATE_VARIANTS, SAMPLE_SIZE, RECOMMENDED_IDS, type CandidateSource } from './candidates.config.js';
import { gradePublication, titleJaccard, SOURCE_DOMAIN_PRIOR, type GridResult, type Verdict } from './editorial-grid.js';
import type { NormalizedArticle, SourceReport, HttpTrace } from '../types.js';

const RESULTS = new URL('../../results/', import.meta.url);
const OUT = new URL('poc-1.2/', RESULTS);
const OFFLINE = process.argv.includes('--offline');
const VARIANTS = process.argv.includes('--variants');

interface CandidateRaw {
  source: CandidateSource;
  report: SourceReport;
  articles: NormalizedArticle[];
  extraction: null | {
    url: string; status: number | null; robotsAllowed: boolean | null; chars: number; level: ContentLevelCode | null;
    reasons: string[]; error: string | null; usageSignals: string[];
  };
}

// ------------------------------------------------------------------ collecte
async function collect(list: CandidateSource[] = CANDIDATES): Promise<{ startedAt: string; finishedAt: string; candidates: CandidateRaw[] }> {
  const startedAt = new Date().toISOString();
  SETTINGS.maxArticlesPerSource = SAMPLE_SIZE; // échantillon plus large, issu du même et unique téléchargement
  const out: CandidateRaw[] = [];
  for (const source of list) {
    process.stdout.write(`→ ${source.name.padEnd(34)} `);
    const c = await collectFeed(source);
    let robots: SourceReport['robots'];
    const extra: HttpTrace[] = [];
    if (c.effectiveUrl) {
      const r = await checkRobots(c.effectiveUrl);
      robots = { checked: r.checked, allowed: r.allowed, note: r.note, aiCrawlersDisallowed: r.aiCrawlersDisallowed };
      if (r.trace) extra.push(r.trace);
    }
    const analysis = analyze(source, c, robots);
    const dates = c.articles.map((a) => a.publishedAt).filter((d): d is string => !!d).sort();
    const report: SourceReport = {
      source, effectiveUrl: c.effectiveUrl, format: c.format, requests: [...c.requests, ...extra], robots,
      itemsInFeed: c.itemsInFeed, itemsCollected: c.articles.length, latestPublication: dates.at(-1) ?? null,
      oldestCollected: dates[0] ?? null, errors: c.errors, warnings: c.warnings, analysis,
    };

    // Extraction HTML générique : 1 page, seulement si le flux n'est pas déjà FULL et si robots.txt l'autorise
    let extraction: CandidateRaw['extraction'] = null;
    const first = c.articles.find((a) => a.url);
    if (first && analysis.accessible && analysis.exploitationMode !== 'FULL') {
      const ex = await extractPage(first.url!);
      const lvl = ex.text ? classifyContent({ title: first.title, text: ex.text, origin: 'page', pageTitleMatch: 1 }) : null;
      extraction = {
        url: first.url!, status: ex.trace?.status ?? null, robotsAllowed: ex.robots.allowed, chars: ex.text.length,
        level: lvl?.level ?? null, reasons: lvl?.reasons ?? [], error: ex.error, usageSignals: ex.usageSignals,
      };
    }
    out.push({ source, report, articles: c.articles, extraction });
    console.log(
      `${analysis.status.padEnd(7)} ${String(c.articles.length).padStart(2)}/${c.itemsInFeed} pub. | ${analysis.estimatedPerDay?.toFixed(2) ?? '—'}/j | flux ${analysis.exploitationMode}` +
        `${extraction ? ` | page ${extraction.status} ${extraction.level ?? extraction.error}` : ''}${c.errors.length ? ` | ERREUR ${c.errors.join(' ; ')}` : ''}`,
    );
  }
  return { startedAt, finishedAt: new Date().toISOString(), candidates: out };
}

// ------------------------------------------------------------------ analyse éditoriale
const USEFUL: Verdict[] = ['PERTINENT', 'MISE_A_JOUR'];
const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)} %` : '—');
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

interface Graded { a: NormalizedArticle; g: GridResult; g0?: GridResult; dup: { with: string; score: number; kind: 'URL' | 'titre' } | null }
interface SourceStats {
  id: string; name: string; isCandidate: boolean; perDay: number; n: number;
  counts: Record<Verdict, number>; usefulShare: number; usefulPerWeek: number; ambiguousPerWeek: number;
  dupCount: number; graded: Graded[]; mode: ContentLevelCode; medianChars: number; extractedChars: number | null;
  domainShare: Record<string, number>;
  method: string;
}

function stats(id: string, name: string, isCandidate: boolean, perDay: number, graded: Graded[], mode: ContentLevelCode, medianChars: number, extractedChars: number | null, method = ''): SourceStats {
  const counts = { PERTINENT: 0, MISE_A_JOUR: 0, AMBIGU: 0, PROMO: 0, FINANCE_STARTUP: 0, HORS_SUJET: 0 } as Record<Verdict, number>;
  for (const x of graded) counts[x.g.verdict]++;
  const n = graded.length || 1;
  const useful = (counts.PERTINENT + counts.MISE_A_JOUR) / n;
  const domainShare: Record<string, number> = {};
  for (const x of graded) if (USEFUL.includes(x.g.verdict)) for (const d of x.g.domains) domainShare[d] = (domainShare[d] ?? 0) + 1 / n;
  return {
    id, name, isCandidate, perDay, n: graded.length, counts, usefulShare: useful, usefulPerWeek: perDay * 7 * useful,
    ambiguousPerWeek: perDay * 7 * (counts.AMBIGU / n), dupCount: graded.filter((x) => x.dup).length, graded, mode, medianChars, extractedChars, domainShare, method,
  };
}

// ------------------------------------------------------------------ main
async function main() {
  await mkdir(OUT, { recursive: true });
  const rawFile = new URL('candidates-raw.json', OUT);
  let raw;
  if (VARIANTS) {
    // Ajoute uniquement les variantes au JSON brut existant (pas de re-collecte des 8 candidates)
    raw = JSON.parse(await readFile(rawFile, 'utf8'));
    const v = await collect(CANDIDATE_VARIANTS);
    raw.candidates = [...raw.candidates.filter((c: CandidateRaw) => !CANDIDATE_VARIANTS.some((x) => x.id === c.source.id)), ...v.candidates];
    raw.variantsCollectedAt = v.startedAt;
    await writeFile(rawFile, JSON.stringify(raw, null, 2));
  } else if (OFFLINE) {
    raw = JSON.parse(await readFile(rawFile, 'utf8'));
  } else {
    raw = await collect();
    await writeFile(rawFile, JSON.stringify(raw, null, 2));
  }

  const existingArticles = (JSON.parse(await readFile(new URL('articles.json', RESULTS), 'utf8')) as { articles: NormalizedArticle[] }).articles.filter((a) => INITIAL_SOURCE_IDS.includes(a.sourceId));
  const existingReports = (JSON.parse(await readFile(new URL('sources-report.json', RESULTS), 'utf8')) as { sources: SourceReport[] }).sources;
  const extraction11 = JSON.parse(await readFile(new URL('content-extraction.json', RESULTS), 'utf8')) as { tests: { article: { sourceId: string }; purpose: string; extraction: { textChars: number }; pageLevel: string | null }[] };
  const candidates = raw.candidates as CandidateRaw[];

  // Doublons : URL (dedupKey) ou titres proches (Jaccard ≥ 0.5) avec les 12 sources ou une autre candidate
  const pool: { src: string; a: NormalizedArticle }[] = [
    ...existingArticles.map((a) => ({ src: a.sourceName, a })),
    ...candidates.flatMap((c) => c.articles.map((a) => ({ src: c.source.name, a }))),
  ];
  const findDup = (a: NormalizedArticle): Graded['dup'] => {
    let best: Graded['dup'] = null;
    for (const p of pool) {
      if (p.a.sourceId === a.sourceId) continue;
      if (a.dedupKey && p.a.dedupKey === a.dedupKey) return { with: `${p.src} : ${p.a.title}`, score: 1, kind: 'URL' };
      const s = titleJaccard(a.title, p.a.title, significantTokens);
      if (s >= 0.5 && (!best || s > best.score)) best = { with: `${p.src} : ${p.a.title}`, score: Math.round(s * 100) / 100, kind: 'titre' };
    }
    return best;
  };

  const extractedMed11 = (sid: string) => {
    const v = extraction11.tests.filter((t) => t.article.sourceId === sid && t.purpose === 'extraction' && t.pageLevel === 'FULL').map((t) => t.extraction.textChars).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };

  const existingStats = SOURCES.map((s) => {
    const rep = existingReports.find((r) => r.source.id === s.id)!;
    const graded = existingArticles.filter((a) => a.sourceId === s.id).map((a) => ({ a, g0: gradePublication(a.title, a.description, { releaseSource: s.type === 'github-releases' }), g: gradePublication(a.title, a.description, { releaseSource: s.type === 'github-releases', sourceDomains: SOURCE_DOMAIN_PRIOR[s.id] }), dup: null }));
    return stats(s.id, s.name, false, rep.analysis.estimatedPerDay ?? 0, graded, rep.analysis.exploitationMode ?? 'MINIMAL', rep.analysis.medianContentLength, extractedMed11(s.id));
  });
  const candStats = candidates.map((c) => {
    const graded = c.articles.map((a) => ({ a, g0: gradePublication(a.title, a.description), g: gradePublication(a.title, a.description, { sourceDomains: SOURCE_DOMAIN_PRIOR[c.source.id] }), dup: findDup(a) }));
    const ex = c.extraction && c.extraction.level === 'FULL' ? c.extraction.chars : null;
    return stats(c.source.id, c.source.name, true, c.report.analysis.estimatedPerDay ?? 0, graded, c.report.analysis.exploitationMode ?? 'MINIMAL', c.report.analysis.medianContentLength, ex, c.report.analysis.estimationMethod);
  });
  const recommended = candStats.filter((s) => RECOMMENDED_IDS.includes(s.id));

  // Données brutes de la grille, pour vérification
  await writeFile(new URL('editorial-grid.json', OUT), JSON.stringify({
    generatedAt: new Date().toISOString(),
    note: 'Grille déterministe (src/poc-1-2/editorial-grid.ts), aucun LLM. Titre + 200 premiers caractères de la description.',
    sources: [...existingStats, ...candStats].map((s) => ({
      id: s.id, name: s.name, candidate: s.isCandidate, perDay: s.perDay, counts: s.counts,
      items: s.graded.map((x) => ({ title: x.a.title, url: x.a.url, publishedAt: x.a.publishedAt, contentLevel: x.a.contentLevel, ...x.g, duplicate: x.dup })),
    })),
  }, null, 2));

  const meta = `- **Collecte** : ${raw.startedAt} → ${raw.finishedAt}${raw.variantsCollectedAt ? ` ; variantes IEEE : ${raw.variantsCollectedAt}` : ''} (${OFFLINE ? 'rapports régénérés hors ligne depuis `candidates-raw.json`' : 'passage unique'})\n- **Mesuré** = issu des réponses réelles. **Estimé** = calcul ou projection à partir de ces mesures.`;
  await writeFile(new URL('sources-test-report.md', OUT), testReport(candidates, meta));
  await writeFile(new URL('editorial-quality-report.md', OUT), editorialReport(existingStats, candStats, meta));
  await writeFile(new URL('coverage-report.md', OUT), coverageReport(existingStats, candStats, recommended, meta));
  await writeFile(new URL('volume-estimation.md', OUT), volumeReport(existingStats, candStats, recommended, meta));
  console.log(`\nRapports générés dans results/poc-1.2/ (recommandées : ${RECOMMENDED_IDS.join(', ') || 'aucune définie'})`);
}

// ------------------------------------------------------------------ rapports
function testReport(cands: CandidateRaw[], meta: string): string {
  const L = ['# POC 1.2 — Tests techniques des sources candidates', '', meta, ''];
  L.push('## Synthèse (mesuré)', '');
  L.push('| Source | Type | Statut | HTTP | robots.txt | Publications (échantillon / flux) | Dates fiables | Dernière | Volume / jour (estimé) | Contenu du flux | Extraction HTML (1 page) | URL vers l’article |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of cands) {
    const a = c.report.analysis;
    const main = c.report.requests.filter((t) => !t.requestedUrl.endsWith('robots.txt')).at(-1);
    const d = a.levelDistribution;
    const urlsOk = c.articles.filter((x) => x.url && x.dedupKey && !/^[^/]+\/?$/.test(x.dedupKey)).length;
    const ex = c.extraction;
    L.push(
      `| ${c.source.name} | ${c.report.format} | ${a.status} | ${main?.status ?? main?.error ?? '—'}${main?.redirected ? ' (redirigé)' : ''} | ${c.report.robots?.allowed === false ? '❌' : c.report.robots?.checked ? '✅' : '⚠️'} | ${c.report.itemsCollected} / ${c.report.itemsInFeed} | ${a.datesReliable ? 'Oui' : 'Non'} | ${c.report.latestPublication?.slice(0, 10) ?? '—'} | ${a.estimatedPerDay === null ? '—' : a.estimatedPerDay.toFixed(2)} | ${a.exploitationMode} (${d ? `${d.FULL}/${d.PARTIAL}/${d.MINIMAL}` : '—'}) | ${ex ? `${ex.status ?? '—'} → ${ex.level ?? ex.error} (${ex.chars} car.)` : 'non nécessaire (flux FULL)'} | ${urlsOk}/${c.articles.length} |`,
    );
  }
  L.push('', 'Contenu du flux : mode majoritaire et répartition FULL/PARTIAL/MINIMAL (critères de `src/content-level.ts`, POC 1.1). Extraction HTML : Readability, 1 page la plus récente, uniquement si robots.txt l’autorise.', '');
  L.push('## Détail par source', '');
  for (const c of cands) {
    const a = c.report.analysis;
    L.push(`### ${c.source.name}`, '');
    L.push(`- Lacune visée : ${c.source.gap}`);
    L.push(`- URL configurée : ${c.source.url} → effective : ${c.report.effectiveUrl ?? '—'}`);
    for (const t of c.report.requests) L.push(`- \`GET ${t.requestedUrl}\` → ${t.status ?? t.error}${t.redirected ? ` (→ ${t.finalUrl})` : ''}, ${t.contentType ?? '—'}, ${t.bytes} o`);
    if (c.report.robots) L.push(`- robots.txt : ${c.report.robots.note}`);
    L.push(`- Dates : ${a.datesNotes.join(' ; ')} ; fraîcheur : ${a.recency} (${a.daysSinceLastPublication ?? '—'} j)`);
    L.push(`- Volume : ${a.estimationMethod}`);
    if (a.restrictions.length) L.push(`- Limites : ${a.restrictions.join(' ; ')}`);
    if (c.report.errors.length) L.push(`- **Erreurs** : ${c.report.errors.join(' ; ')}`);
    const warn = c.report.warnings.filter((w) => !a.restrictions.includes(w));
    if (warn.length) L.push(`- Remarques : ${warn.join(' ; ')}`);
    if (c.extraction) L.push(`- Extraction : ${c.extraction.url} → HTTP ${c.extraction.status ?? '—'}, ${c.extraction.chars} caractères, niveau ${c.extraction.level ?? '—'}${c.extraction.error ? `, ${c.extraction.error}` : ''}${c.extraction.usageSignals.length ? `, signaux : ${c.extraction.usageSignals.join(' ; ')}` : ''}`);
    L.push('- Conditions d’utilisation : à vérifier humainement (robots.txt ne vaut pas licence de réutilisation du texte).', '');
  }
  return L.join('\n');
}

function verdictRow(s: SourceStats): string {
  const c = s.counts;
  const u0 = s.graded.filter((x) => x.g0 && USEFUL.includes(x.g0.verdict)).length;
  return `| ${s.name} | ${s.n} | ${SOURCE_DOMAIN_PRIOR[s.id] ? pct(u0, s.n) : '= (pas de contexte)'} | ${pct(c.PERTINENT, s.n)} | ${pct(c.MISE_A_JOUR, s.n)} | ${pct(c.AMBIGU, s.n)} | ${pct(c.PROMO, s.n)} | ${pct(c.FINANCE_STARTUP, s.n)} | ${pct(c.HORS_SUJET, s.n)} | ${r1(s.perDay * 7)} | **${r1(s.usefulPerWeek)}** (+${r1(s.ambiguousPerWeek)} ambigus) | ${s.isCandidate ? `${s.dupCount}/${s.n}` : '—'} |`;
}

function editorialReport(existing: SourceStats[], cands: SourceStats[], meta: string): string {
  const L = ['# POC 1.2 — Qualité éditoriale, bruit et doublons', '', meta, ''];
  L.push('## Méthode', '');
  L.push('- Grille **déterministe** (`src/poc-1-2/editorial-grid.ts`) appliquée au titre et aux 200 premiers caractères de la description. Aucun LLM.');
  L.push('- Verdicts : **PERTINENT** (domaine Dunggle + nouveauté/analyse), **MISE_A_JOUR** (release d’un outil suivi), **AMBIGU** (à revoir humainement), **PROMO**, **FINANCE_STARTUP** (levée, acquisition, nomination, partenariat, classement), **HORS_SUJET**.');
  L.push(`- Échantillon : jusqu’à ${SAMPLE_SIZE} publications récentes par candidate (un seul téléchargement du flux) ; 10 par source existante (\`articles.json\`).`);
  L.push('- Publications utiles / semaine (**estimé**) = volume/jour × 7 × part PERTINENT + MISE_A_JOUR.');
  L.push('- **Contexte de source** : pour une source mono-domaine (`SOURCE_DOMAIN_PRIOR`), une publication sans domaine détecté hérite du domaine de la source. La colonne « Utiles sans contexte de source » donne le résultat sans cette règle. **Calibration** : au premier passage, la grille sans cette règle classait l’Angular Blog à 100 % ambigu et Hugging Face à 60 % hors sujet, parce que leurs titres ne répètent pas leur domaine. La règle et quelques signaux lexicaux (update, adds, techniques, comparing…) ont été ajoutés après examen de l’échantillon.');
  L.push('- Limites : une grille par mots-clés ne détecte ni la qualité d’analyse ni l’opinion sans substance ; elle confond certains homonymes (« agents » chimiques, « transformers » électriques). Les proportions sont des **ordres de grandeur**.', '');
  const head = ['| Source | Échantillon | Utiles sans contexte de source | Pertinent | Mise à jour | Ambigu | Promo | Finance/startup | Hors sujet | Publications / semaine | Utiles / semaine | Doublons potentiels |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  L.push('## Sources candidates (mesuré sur échantillon, volumes estimés)', '', ...head, ...cands.map(verdictRow), '');
  L.push('## Référence : les 12 sources existantes (même grille)', '', ...head, ...existing.map(verdictRow), '');
  L.push('## Doublons potentiels détectés (candidates vs existantes et entre candidates)', '');
  const dups = cands.flatMap((s) => s.graded.filter((x) => x.dup).map((x) => ({ s, x })));
  if (!dups.length) L.push('Aucun doublon détecté (URL identique ou titres proches, Jaccard ≥ 0,5). L’échantillon des sources existantes ne compte que 10 publications par source, ce qui sous-estime le risque.');
  else {
    L.push('| Candidate | Publication | Doublon potentiel | Type | Score |', '|---|---|---|---|---|');
    for (const { s, x } of dups) L.push(`| ${s.name} | ${esc(x.a.title)} | ${esc(x.dup!.with)} | ${x.dup!.kind} | ${x.dup!.score} |`);
  }
  L.push('');
  L.push('## Cas ambigus et exemples (pour revue humaine)', '');
  for (const s of cands) {
    L.push(`### ${s.name}`, '');
    const show = (v: Verdict, max: number) => s.graded.filter((x) => x.g.verdict === v).slice(0, max);
    for (const [v, max] of [['PERTINENT', 4], ['AMBIGU', 6], ['PROMO', 3], ['FINANCE_STARTUP', 4], ['HORS_SUJET', 4]] as [Verdict, number][]) {
      const xs = show(v, max);
      if (!xs.length) continue;
      L.push(`- **${v}** (${s.counts[v]}) :`);
      for (const x of xs) L.push(`  - ${x.a.publishedAt?.slice(0, 10) ?? '—'} — ${esc(x.a.title)} _(${x.g.domains.join(', ') || 'aucun domaine'} ; ${x.g.note})_`);
    }
    L.push('');
  }
  return L.join('\n');
}

const COVERAGE_DOMAINS: [string, string][] = [
  ['ANGULAR', 'Angular / TypeScript'], ['AI', 'IA'], ['AI_AGENTS', 'Agents IA'], ['QUANTUM_COMPUTING', 'Informatique quantique'],
  ['QUANTUM_PHYSICS', 'Physique quantique (lien numérique incertain)'], ['ROBOTICS', 'Robotique'], ['SECURITY', 'Cybersécurité'],
  ['HARDWARE', 'Matériel / semi-conducteurs'], ['SOFTWARE', 'Logiciel / architecture'], ['FUTURE_OF_WORK', 'Travail / prospective'], ['REGULATION', 'Réglementation'],
];

function weekly(list: SourceStats[], d: string): number {
  return list.reduce((s, x) => s + x.perDay * 7 * (x.domainShare[d] ?? 0), 0);
}

function coverageReport(existing: SourceStats[], cands: SourceStats[], rec: SourceStats[], meta: string): string {
  const L = ['# POC 1.2 — Couverture avant / après', '', meta, ''];
  L.push('Indicateur (**estimé**) : publications utiles par semaine détectables pour chaque domaine = Σ sources (volume/jour × 7 × part des publications utiles de l’échantillon qui touchent ce domaine). Une publication peut compter dans plusieurs domaines. Ce n’est **pas** une mesure d’exhaustivité : un domaine « couvert » peut encore manquer des annonces importantes.', '');
  L.push('| Domaine | Avant (12 sources) | Après (+ recommandées) | Après (+ toutes les candidates testées) | Apport principal des recommandées |');
  L.push('|---|---|---|---|---|');
  for (const [d, label] of COVERAGE_DOMAINS) {
    const before = weekly(existing, d);
    const after = before + weekly(rec, d);
    const all = before + weekly(cands, d);
    const top = rec.map((s) => ({ n: s.name, v: s.perDay * 7 * (s.domainShare[d] ?? 0) })).filter((x) => x.v > 0.05).sort((a, b) => b.v - a.v).slice(0, 2).map((x) => `${x.n} (${r1(x.v)})`).join(', ');
    L.push(`| ${label} | ${r1(before)} | **${r1(after)}** | ${r1(all)} | ${top || '—'} |`);
  }
  L.push('', `Sources recommandées prises en compte : ${rec.map((s) => s.name).join(', ') || 'aucune'}.`, '');
  L.push('## Contribution par source (publications utiles / semaine, estimé)', '');
  L.push('| Source | ' + COVERAGE_DOMAINS.map(([, l]) => l.split(' (')[0]).join(' | ') + ' |');
  L.push('|---|' + COVERAGE_DOMAINS.map(() => '---').join('|') + '|');
  for (const s of [...existing, ...cands]) {
    L.push(`| ${s.isCandidate ? '🆕 ' : ''}${s.name} | ${COVERAGE_DOMAINS.map(([d]) => { const v = s.perDay * 7 * (s.domainShare[d] ?? 0); return v >= 0.05 ? r1(v) : '·'; }).join(' | ')} |`);
  }
  L.push('');
  return L.join('\n');
}

function volumeReport(existing: SourceStats[], cands: SourceStats[], rec: SourceStats[], meta: string): string {
  const T = TOKEN_ASSUMPTIONS;
  const tokFull = (chars: number) => Math.min(chars, T.maxInputCharsPerArticle) / T.charsPerToken + T.promptOverheadTokens;
  const TRIAGE_IN = T.promptOverheadTokens + 40; // titre + métadonnées
  const TRIAGE_OUT = 30;
  const scen = (list: SourceStats[]) => {
    let perDay = 0, useful = 0, amb = 0, inA = 0, outA = 0, inB = 0, outB = 0;
    for (const s of list) {
      const n = s.n || 1;
      const month = s.perDay * 30;
      const chars = Math.max(s.medianChars, s.extractedChars ?? 0);
      const keepShare = (s.counts.PERTINENT + s.counts.MISE_A_JOUR + s.counts.AMBIGU) / n;
      perDay += s.perDay;
      useful += s.perDay * s.usefulShare;
      amb += s.perDay * (s.counts.AMBIGU / n);
      // Scénario A : analyse complète de toutes les publications
      inA += month * tokFull(chars); outA += month * T.outputTokensPerArticle;
      // Scénario B : tri sur titre pour tout, analyse complète pour PERTINENT + MISE_A_JOUR + AMBIGU
      inB += month * TRIAGE_IN + month * keepShare * tokFull(chars);
      outB += month * TRIAGE_OUT + month * keepShare * T.outputTokensPerArticle;
    }
    return { perDay, useful, amb, inA, outA, inB, outB };
  };
  const cost = (i: number, o: number, p: (typeof PRICE_SCENARIOS)[number]) => (i / 1e6) * p.inPerM + (o / 1e6) * p.outPerM;
  const sets: [string, SourceStats[]][] = [
    ['Avant : 12 sources', existing],
    [`Après : 12 + ${rec.length} recommandées`, [...existing, ...rec]],
    [`Toutes : 12 + ${cands.length} candidates testées (8 + 2 variantes IEEE)`, [...existing, ...cands]],
  ];
  const L = ['# POC 1.2 — Volume et projection des coûts', '', meta, ''];
  L.push('## Volumes (estimés à partir des dates mesurées)', '');
  L.push('| Périmètre | Sources | Publications / jour | / mois | Utiles / jour (Pertinent + MàJ) | Ambiguës / jour |');
  L.push('|---|---|---|---|---|---|');
  for (const [label, list] of sets) {
    const s = scen(list);
    L.push(`| ${label} | ${list.length} | ${r1(s.perDay)} | ${Math.round(s.perDay * 30)} | ${r1(s.useful)} | ${r1(s.amb)} |`);
  }
  L.push('', '## Volume par source candidate', '');
  L.push('| Source | Publications / jour | Méthode d’estimation | Caractères analysables (médiane flux / extraction) |');
  L.push('|---|---|---|---|');
  for (const s of cands) L.push(`| ${RECOMMENDED_IDS.includes(s.id) ? '✅ ' : ''}${s.name} | ${s.perDay.toFixed(2)} | ${esc(s.method)} | ${s.medianChars} / ${s.extractedChars ?? '—'} |`);
  L.push('', '## Projection des tokens et coûts (aucun appel IA effectué)', '');
  L.push(`Hypothèses (identiques aux POC 1/1.1) : ${T.charsPerToken} car./token, troncature ${T.maxInputCharsPerArticle} car., ${T.promptOverheadTokens} tokens de prompt, ${T.outputTokensPerArticle} tokens de sortie. Contenu = max(médiane du flux, médiane extraite si l’extraction FULL a été validée).`);
  L.push(`- **Scénario A** : analyse complète de chaque publication.`);
  L.push(`- **Scénario B** : tri préalable sur titre + métadonnées pour toutes (~${TRIAGE_IN} tokens entrée / ${TRIAGE_OUT} sortie), puis analyse complète seulement des publications PERTINENT / MISE_A_JOUR / AMBIGU. Les autres restent stockées (jamais supprimées) avec leur évaluation de pertinence issue du tri.`, '');
  L.push('| Périmètre | Tokens entrée / mois (A) | (B) | ' + PRICE_SCENARIOS.map((p) => `${p.label} A / B`).join(' | ') + ' |');
  L.push('|---|---|---|' + PRICE_SCENARIOS.map(() => '---').join('|') + '|');
  for (const [label, list] of sets) {
    const s = scen(list);
    L.push(`| ${label} | ${(s.inA / 1e6).toFixed(2)} M | ${(s.inB / 1e6).toFixed(2)} M | ${PRICE_SCENARIOS.map((p) => `${cost(s.inA, s.outA, p).toFixed(2)} $ / ${cost(s.inB, s.outB, p).toFixed(2)} $`).join(' | ')} |`);
  }
  L.push('', 'Prix **hypothétiques** (USD par million de tokens) à remplacer par la grille réelle du fournisseur retenu au POC 2. Objectif : ≤ 10 €/mois d’appels IA, hors hébergement.');
  L.push('', '**Limites** : volumes issus d’un passage unique (flux tronqués pour les sources actives), proportions issues d’une grille par mots-clés, tokens estimés par la règle 4 caractères ≈ 1 token. Prévoir une marge ×2 à ×3 pour les retraitements, les publications plus longues et les erreurs d’estimation.', '');
  return L.join('\n');
}

main().catch((err) => {
  console.error('Échec inattendu du POC 1.2 :', err);
  process.exitCode = 1;
});
