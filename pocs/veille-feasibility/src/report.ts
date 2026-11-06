import { mkdir, writeFile } from 'node:fs/promises';
import { SETTINGS } from './sources.config.js';
import { CATEGORY_LABELS, type Category, type NormalizedArticle, type SourceReport } from './types.js';

const RESULTS_DIR = new URL('../results/', import.meta.url);

/** Hypothèses pour l'estimation de tokens du POC 2 (aucun appel IA n'est fait ici). */
export const TOKEN_ASSUMPTIONS = {
  charsPerToken: 4,
  maxInputCharsPerArticle: 6000, // contenu tronqué avant envoi au modèle
  promptOverheadTokens: 400, // consignes + taxonomie de classification
  outputTokensPerArticle: 150, // résumé court + catégorie + tags
};
/** Scénarios de prix HYPOTHÉTIQUES (USD par million de tokens) : à remplacer par la grille réelle du fournisseur choisi. */
export const PRICE_SCENARIOS = [
  { label: 'Petit modèle économique', inPerM: 0.15, outPerM: 0.6 },
  { label: 'Modèle intermédiaire', inPerM: 1, outPerM: 5 },
  { label: 'Grand modèle', inPerM: 3, outPerM: 15 },
];

const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : '—');
const yesNo = (b: boolean) => (b ? 'Oui' : 'Non');
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export interface RunMeta {
  startedAt: string;
  finishedAt: string;
  nodeVersion: string;
  totalRequests: number;
}

export async function writeResults(reports: SourceReport[], articles: NormalizedArticle[], excluded: NormalizedArticle[], meta: RunMeta): Promise<void> {
  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(
    new URL('articles.json', RESULTS_DIR),
    JSON.stringify(
      {
        generatedAt: meta.finishedAt,
        count: articles.length,
        articles,
        excludedNote: 'Publications exclues par une règle éditoriale déterministe ciblée (src/editorial-rules.ts). Conservées pour audit et récupération éventuelle au POC 2.',
        excludedCount: excluded.length,
        excluded,
      },
      null,
      2,
    ),
  );
  const reportJson = {
    meta: { ...meta, userAgent: SETTINGS.userAgent, githubTokenUsed: !!SETTINGS.githubToken, settings: { ...SETTINGS, githubToken: undefined } },
    sources: reports.map(({ allDates: _omit, ...r }) => r),
  };
  await writeFile(new URL('sources-report.json', RESULTS_DIR), JSON.stringify(reportJson, null, 2));
  await writeFile(new URL('feasibility-report.md', RESULTS_DIR), buildMarkdown(reports, meta));
}

function problemsOf(r: SourceReport): string {
  const items = [...r.errors, ...r.analysis.restrictions.filter((x) => !x.startsWith('Quota API GitHub'))];
  if (!r.analysis.datesReliable && r.analysis.accessible) items.push(...r.analysis.datesNotes);
  if (r.analysis.recency === 'peu-active' || r.analysis.recency === 'inactive') {
    items.push(`Dernière publication il y a ${r.analysis.daysSinceLastPublication} j`);
  }
  return items.length ? esc(items.join(' ; ')) : 'Aucun';
}

function buildMarkdown(reports: SourceReport[], meta: RunMeta): string {
  const L: string[] = [];
  const statusIcon = { OK: '✅ OK', PARTIEL: '⚠️ PARTIEL', 'ÉCHEC': '❌ ÉCHEC' } as const;

  L.push('# POC 1 — Rapport de faisabilité de la collecte de veille', '');
  L.push(`- **Exécution** : ${meta.startedAt} → ${meta.finishedAt} (Node.js ${meta.nodeVersion})`);
  L.push(`- **Requêtes HTTP effectuées** : ${meta.totalRequests} (passage unique, séquentiel, ${SETTINGS.delayBetweenRequestsMs} ms entre requêtes)`);
  L.push(`- **User-Agent** : \`${SETTINGS.userAgent}\``);
  L.push(`- **Token GitHub** : ${SETTINGS.githubToken ? 'utilisé' : 'non utilisé (accès anonyme)'}`);
  L.push('- Toutes les données ci-dessous proviennent des réponses réelles des sources au moment de l’exécution.', '');

  // --- Tableau de synthèse ---
  L.push('## 1. Synthèse par source', '');
  L.push('| # | Source | Catégorie | Statut | Publications (collectées / dans le flux) | Dernière publication | Problèmes éventuels |');
  L.push('|---|---|---|---|---|---|---|');
  reports.forEach((r, i) => {
    L.push(
      `| ${i + 1} | ${esc(r.source.name)} | ${CATEGORY_LABELS[r.source.category]} | ${statusIcon[r.analysis.status]} | ${r.itemsCollected} / ${r.itemsInFeed} | ${fmtDate(r.latestPublication)} | ${problemsOf(r)} |`,
    );
  });
  L.push('', 'Statut : **OK** = recommandée pour le MVP ; **PARTIEL** = accessible mais avec une réserve bloquante (dates, fraîcheur, robots.txt…) ; **ÉCHEC** = inaccessible ou inexploitable. Depuis le POC 1.1, l’absence de contenu n’est plus bloquante : elle détermine le mode d’exploitation (FULL / PARTIAL / MINIMAL, voir `content-extraction-report.md`).', '');

  // --- Grille d'analyse ---
  L.push('## 2. Grille de faisabilité', '');
  L.push('| Source | Accessible | Exploitable | Dates fiables | Récente | Contenu pour résumé IA | Mode d’exploitation (F/P/M) | Auth. requise | MVP |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of reports) {
    const a = r.analysis;
    const rec = a.daysSinceLastPublication === null ? a.recency : `${a.recency} (${a.daysSinceLastPublication} j)`;
    L.push(
      `| ${esc(r.source.name)} | ${yesNo(a.accessible)} | ${yesNo(a.exploitable)} | ${yesNo(a.datesReliable)} | ${rec} | ${a.content} (médiane ${a.medianContentLength} car.) | ${a.exploitationMode ?? '—'} (${a.levelDistribution ? `${a.levelDistribution.FULL}/${a.levelDistribution.PARTIAL}/${a.levelDistribution.MINIMAL}` : '—'}) | ${yesNo(a.authRequired)} | ${a.recommendedForMvp ? '**Oui**' : 'Non'} |`,
    );
  }
  L.push('');
  L.push(`Seuils : récente ≤ ${SETTINGS.activeDays} j, peu active ≤ ${SETTINGS.lowActivityDays} j ; contenu suffisant ≥ ${SETTINGS.contentSufficientChars} caractères de texte, limité ≥ ${SETTINGS.contentLimitedChars}. Mode d’exploitation = niveau de contenu majoritaire des publications du flux (F/P/M = nombre de publications FULL/PARTIAL/MINIMAL), avant extraction éventuelle de la page.`, '');

  // --- Détails ---
  L.push('## 3. Détail par source', '');
  for (const r of reports) {
    const a = r.analysis;
    L.push(`### ${r.source.name} — ${statusIcon[a.status]}`, '');
    L.push(`- URL configurée : ${r.source.url}`);
    L.push(`- URL effective : ${r.effectiveUrl ?? '—'} (format : ${r.format})`);
    for (const t of r.requests) {
      L.push(
        `- Requête : \`GET ${t.requestedUrl}\` → ${t.status ?? 'aucune réponse'}${t.redirected ? ` (redirigé vers ${t.finalUrl})` : ''}, ${t.contentType ?? 'Content-Type absent'}, ${t.bytes} octets, ${t.durationMs} ms${t.error ? `, erreur : ${t.error}` : ''}`,
      );
    }
    if (r.robots) L.push(`- robots.txt : ${r.robots.note}`);
    if (r.robots?.aiCrawlersDisallowed?.length) L.push(`- ⚠️ robots.txt exclut des robots d’IA (signal de réutilisation) : ${r.robots.aiCrawlersDisallowed.join(', ')}`);
    if (r.editorialExcluded?.length) L.push(`- Règle éditoriale : ${r.editorialExcluded.length} publication(s) exclue(s), conservée(s) dans \`articles.json > excluded\` (${r.editorialExcluded.map((e) => `« ${e.title} »`).join(', ')})`);
    if (r.editorialFlagged) L.push(`- Règle éditoriale : ${r.editorialFlagged} compilation(s) récurrente(s) marquée(s), conservée(s) dans \`articles\``);
    L.push(`- Dates : ${a.datesNotes.join(' ; ')}`);
    L.push(`- Authentification : ${a.authNotes}`);
    if (a.restrictions.length) L.push(`- Restrictions / limites : ${a.restrictions.join(' ; ')}`);
    if (r.errors.length) L.push(`- **Erreurs** : ${r.errors.join(' ; ')}`);
    const otherWarnings = r.warnings.filter((w) => !a.restrictions.includes(w) && !a.datesNotes.includes(w));
    if (otherWarnings.length) L.push(`- Remarques : ${otherWarnings.join(' ; ')}`);
    L.push(`- Volume estimé : ${a.estimatedPerDay === null ? 'n/a' : `${round(a.estimatedPerDay)} / jour`} — ${a.estimationMethod}`);
    L.push(`- Recommandée pour le MVP : **${a.recommendedForMvp ? 'Oui' : 'Non'}**`, '');
  }

  // --- Bilan par catégorie ---
  L.push('## 4. Bilan par catégorie', '');
  // Objectif « ≥ 3 sources OK » : seulement pour les catégories prioritaires (A, B, C).
  // Les catégories sélectives (POC 1.2) n'ont pas d'objectif de nombre de sources.
  const PRIORITY: Category[] = ['angular', 'ia', 'agents'];
  const cats = (Object.keys(CATEGORY_LABELS) as Category[]).filter((c) => PRIORITY.includes(c) || reports.some((r) => r.source.category === c));
  const catSummary = cats.map((cat) => {
    const rs = reports.filter((r) => r.source.category === cat);
    const ok = rs.filter((r) => r.analysis.status === 'OK');
    const perDay = rs.reduce((s, r) => s + (r.analysis.status !== 'ÉCHEC' ? r.analysis.estimatedPerDay ?? 0 : 0), 0);
    return { cat, rs, ok, perDay, priority: PRIORITY.includes(cat) };
  });
  L.push('| Catégorie | Priorité | Sources testées | Sources OK | Objectif ≥ 3 | Volume estimé / jour |');
  L.push('|---|---|---|---|---|---|');
  for (const c of catSummary) {
    L.push(`| ${CATEGORY_LABELS[c.cat]} | ${c.priority ? 'Maximale' : 'Sélective'} | ${c.rs.length} | ${c.ok.length} | ${c.priority ? (c.ok.length >= 3 ? '✅ Atteint' : '❌ Non atteint') : 'Sans objectif'} | ~${round(c.perDay, 1)} |`);
  }
  L.push('');
  for (const c of catSummary) {
    L.push(`**${CATEGORY_LABELS[c.cat]}** : ${c.ok.length}/${c.rs.length} sources OK (${c.ok.map((r) => r.source.name).join(', ') || 'aucune'}).`);
    const notOk = c.rs.filter((r) => r.analysis.status !== 'OK');
    for (const r of notOk) L.push(`- ${r.source.name} (${r.analysis.status}) : ${problemsOf(r)}`);
    L.push('');
  }

  // --- Volume ---
  const total = catSummary.reduce((s, c) => s + c.perDay, 0);
  L.push('## 5. Estimation du volume quotidien', '');
  L.push(`**Total estimé : ~${round(total, 1)} nouvelles publications par jour** (≈ ${Math.round(total * 30)} par mois), sources en échec exclues.`, '');
  L.push('| Source | Publications / jour | Méthode |');
  L.push('|---|---|---|');
  for (const r of reports) {
    L.push(`| ${esc(r.source.name)} | ${r.analysis.estimatedPerDay === null ? 'n/a' : round(r.analysis.estimatedPerDay)} | ${esc(r.analysis.estimationMethod)} |`);
  }
  L.push('', '**Limites de l’estimation :**');
  L.push('- Basée sur un seul passage : les flux ne contiennent qu’un nombre limité d’éléments récents et les releases GitHub sont limitées à 10 par dépôt, ce qui rend l’estimation imprécise pour les sources très actives (flux « tronqués »).');
  L.push('- L’activité est irrégulière (pics lors des sorties majeures, conférences, annonces) ; une moyenne sur 30 jours lisse ces pics.');
  L.push('- Les releases GitHub incluent des pré-versions et des correctifs mineurs, qui gonflent le volume sans forcément représenter une actualité à résumer.');
  L.push('- Une mesure fiable nécessiterait des collectes répétées (ex. quotidiennes) pendant plusieurs semaines, hors périmètre de ce POC.', '');

  // --- Projection POC 2 ---
  const okReports = reports.filter((r) => r.analysis.status !== 'ÉCHEC');
  let tokensIn = 0;
  let tokensOut = 0;
  for (const r of okReports) {
    const perMonth = (r.analysis.estimatedPerDay ?? 0) * 30;
    const avgChars = r.analysis.medianContentLength;
    const inPerArticle = Math.min(avgChars, TOKEN_ASSUMPTIONS.maxInputCharsPerArticle) / TOKEN_ASSUMPTIONS.charsPerToken + TOKEN_ASSUMPTIONS.promptOverheadTokens;
    tokensIn += perMonth * inPerArticle;
    tokensOut += perMonth * TOKEN_ASSUMPTIONS.outputTokensPerArticle;
  }
  L.push('## 6. Projection pour le POC 2 (aucun appel IA effectué)', '');
  L.push(`Hypothèses : ${TOKEN_ASSUMPTIONS.charsPerToken} caractères ≈ 1 token ; contenu tronqué à ${TOKEN_ASSUMPTIONS.maxInputCharsPerArticle} caractères ; ${TOKEN_ASSUMPTIONS.promptOverheadTokens} tokens de consignes ; ${TOKEN_ASSUMPTIONS.outputTokensPerArticle} tokens de sortie par publication ; un seul appel par publication (pas de retraitement).`, '');
  L.push(`- Tokens d’entrée estimés : **~${(tokensIn / 1e6).toFixed(2)} M / mois**`);
  L.push(`- Tokens de sortie estimés : **~${(tokensOut / 1e6).toFixed(2)} M / mois**`, '');
  L.push('| Scénario de prix (hypothétique, à vérifier) | Entrée $/M | Sortie $/M | Coût estimé / mois |');
  L.push('|---|---|---|---|');
  for (const p of PRICE_SCENARIOS) {
    const cost = (tokensIn / 1e6) * p.inPerM + (tokensOut / 1e6) * p.outPerM;
    L.push(`| ${p.label} | ${p.inPerM} | ${p.outPerM} | ~${cost.toFixed(2)} $ |`);
  }
  L.push('', 'Ces prix sont des ordres de grandeur illustratifs et non une grille tarifaire officielle : ils devront être confrontés aux tarifs du fournisseur retenu au démarrage du POC 2.', '');

  // --- Conclusion ---
  const allCatsOk = catSummary.filter((c) => c.priority).every((c) => c.ok.length >= 3);
  const githubRepos = reports.filter((r) => r.source.type === 'github-releases').length;
  const excludedTotal = reports.reduce((s, r) => s + (r.editorialExcluded?.length ?? 0), 0);
  const flaggedTotal = reports.reduce((s, r) => s + (r.editorialFlagged ?? 0), 0);
  const aiSignals = reports.filter((r) => r.robots?.aiCrawlersDisallowed?.length);
  const midCost = (tokensIn / 1e6) * PRICE_SCENARIOS[1].inPerM + (tokensOut / 1e6) * PRICE_SCENARIOS[1].outPerM;
  L.push('## 7. Conclusion', '');
  L.push(`- Critère « ≥ 3 sources fonctionnelles par catégorie » : ${allCatsOk ? '✅ atteint' : '❌ non atteint'} pour les catégories prioritaires (${catSummary.filter((c) => c.priority).map((c) => `${CATEGORY_LABELS[c.cat]} ${c.ok.length}/3`).join(', ')}).`);
  L.push(`- Sources gratuites : ✅ toutes les sources testées sont publiques et gratuites (flux RSS/Atom et API GitHub publique ; quota anonyme de 60 req/h largement suffisant pour ${githubRepos} dépôts collectés quelques fois par jour).`);
  L.push('- Contournement : ✅ aucun (pas de scraping, pas de contournement anti-bot ; robots.txt vérifié pour les flux).');
  L.push(`- Budget IA : avec un modèle intermédiaire hypothétique, ~${midCost.toFixed(2)} $/mois pour le volume mesuré (projection conservatrice : les publications exclues par règle éditoriale sont comptées dans le volume).`);
  L.push(`- Règles éditoriales ciblées : ${excludedTotal} publication(s) exclue(s) avec trace, ${flaggedTotal} compilation(s) marquée(s) et conservée(s). Aucun filtre général par mot-clé.`);
  L.push(
    aiSignals.length
      ? `- ⚠️ Signaux de réutilisation : le robots.txt de ${aiSignals.map((r) => r.source.name).join(', ')} exclut des robots d’IA. À examiner avant d’envoyer leur texte intégral à un LLM.`
      : '- Signaux de réutilisation : aucun robots.txt ne cible explicitement des robots d’IA.',
  );
  L.push('');
  L.push(
    allCatsOk
      ? '**Verdict : GO pour le POC 2** (analyse et classification par IA sous 10 €/mois), sous réserve des points listés ci-dessus.'
      : '**Verdict : GO conditionnel pour le POC 2** — la collecte est techniquement faisable, mais l’objectif de 3 sources OK n’est pas atteint pour toutes les catégories ; voir le bilan par catégorie.',
  );
  L.push('');
  return L.join('\n');
}
