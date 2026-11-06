/**
 * Prépare l'évaluation de la phase B, SANS aucun appel :
 *   - reports/evaluation-readiness.md      : modes envoyés, coûts maximaux, préfiltre (3 statuts)
 *   - reports/evaluation-dataset-quality.md : composition et cohérence du jeu et de la vérité terrain
 *   - review/phase-b-manual-review.template.json : fiche de revue manuelle des résultats de la phase B
 *   npm run prepare:eval
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { DEFAULT_LIMITS } from '../config/budget.js';
import { CANDIDATE_MODEL_KEYS, MODELS } from '../config/models.js';
import { MANDATORY_COVERAGE_SOURCES, coverageFor } from '../config/coverage.js';
import { BudgetGuard } from '../budget/guard.js';
import { MemoryBudgetStore } from '../budget/store.js';
import { resolveInput } from '../content-policy.js';
import { buildPrompt } from '../prompt.js';
import { evaluatePrefilter, prefilterHint, PREFILTER_ENABLED, type EditorialDecision } from '../prefilter.js';
import { SUMMARY_CRITERIA } from '../evaluation/summary-checks.js';
import type { PublicationInput } from '../types.js';

interface GT {
  id: string;
  editorialDecision: EditorialDecision;
  coveragePolicy: 'mandatory' | 'selective';
  hardToClassify: boolean;
  themes: string[];
  types: string[];
  relevance: string;
  novelty: [number, number];
  acceptableExclusions: (string | null)[];
  sections: string[];
  summaryAllowed: boolean;
  summaryExpected: boolean | 'if-kept';
  expectedStatus?: string;
  referenceFacts?: string[];
  forbiddenClaims?: string[];
}

const root = new URL('../../', import.meta.url);
const set = JSON.parse(await readFile(new URL('fixtures/evaluation-set.json', root), 'utf8')) as { items: PublicationInput[] };
const gtFile = JSON.parse(await readFile(new URL('fixtures/ground-truth.json', root), 'utf8')) as { items: GT[]; changeLog: string[]; revisedAt: string };
const guard = new BudgetGuard(new MemoryBudgetStore(), DEFAULT_LIMITS);
const today = new Date().toISOString().slice(0, 10);

const rows = set.items.map((p) => {
  const input = resolveInput(p);
  const g = gtFile.items.find((x) => x.id === p.id)!;
  const editorialSkip = p.editorial?.action === 'excluded';
  const eligible = input.mode !== 'none' && !editorialSkip;
  const prompt = buildPrompt(p, input);
  const costs = Object.fromEntries(CANDIDATE_MODEL_KEYS.map((k) => [k, eligible ? guard.estimateMaxCostEur(k, prompt.inputTokensUpperBound) : 0]));
  return { p, g, input, eligible, editorialSkip, typical: prompt.inputTokensEstimate, bound: prompt.inputTokensUpperBound, costs, hint: prefilterHint(p) };
});
const eligible = rows.filter((r) => r.eligible);
const pf = evaluatePrefilter(eligible.map((r) => ({ id: r.p.id, hint: r.hint, decision: r.g.editorialDecision })));
const count = <T>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
const fmt = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(', ');
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)} %`);
const esc = (s: string) => s.replace(/\|/g, '\\|');

// ------------------------------------------------------------------ evaluation-readiness.md
const L: string[] = ['# POC 2 — Préparation de l’évaluation (phase A.1)', ''];
L.push(`> Généré par \`npm run prepare:eval\` le ${today}. **Aucun appel à un modèle.** Coûts = MAXIMA : borne haute d’entrée (octets UTF-8 + ${2000} tokens de marge pour le formatage et le prompt injecté par la sortie structurée), sortie au plafond de ${DEFAULT_LIMITS.maxOutputTokensPerRequest} tokens (réflexion comprise), marge ×${DEFAULT_LIMITS.safetyMultiplier}, 1 USD compté 1 EUR.`, '');
L.push('## 1. Synthèse', '');
L.push(`- ${set.items.length} publications ; **${eligible.length} éligibles à l’IA** (non éligibles : ${rows.filter((r) => r.input.mode === 'none').length} source bloquée, ${rows.filter((r) => r.editorialSkip).length} exclusion éditoriale tracée).`);
L.push(`- Décisions éditoriales (vérité terrain) : ${fmt(count(rows, (r) => r.g.editorialDecision))}. Couverture : ${fmt(count(rows, (r) => r.g.coveragePolicy))}.`);
L.push(`- Résumés : autorisés pour ${rows.filter((r) => r.g.summaryAllowed).length} publications, attendus pour ${rows.filter((r) => r.g.summaryExpected === true).length} (+ ${rows.filter((r) => r.g.summaryExpected === 'if-kept').length} « si conservée »). Toutes sont synthétiques.`);
L.push(`- Modes envoyés : ${fmt(count(rows, (r) => (r.eligible ? r.input.mode : 'aucun appel')))}.`, '');

L.push('## 2. Préfiltre déterministe (observation — **désactivé**)', '');
L.push(`Préfiltre activé : **${PREFILTER_ENABLED ? 'oui' : 'non'}**. Mesure sur les ${pf.total} publications éligibles, contre la décision éditoriale explicite de la vérité terrain.`, '');
L.push('| Groupe | Total | Correct | Erreurs | Détail |', '|---|---|---|---|---|');
L.push(`| \`must_keep\` | ${pf.mustKeep.total} | ${pf.mustKeep.kept} conservées | **${pf.mustKeep.falseNegatives} faux négatifs** (écartées à tort) | ${pf.mustKeep.falseNegativeIds.join(', ') || '—'} |`);
L.push(`| \`must_exclude\` | ${pf.mustExclude.total} | ${pf.mustExclude.skipped} écartées | **${pf.mustExclude.falsePositives} faux positifs** (conservées à tort) | ${pf.mustExclude.falsePositiveIds.join(', ') || '—'} |`);
L.push(`| \`ambiguous\` (hors erreurs) | ${pf.ambiguous.total} | — | — | ${pf.ambiguous.skipped} écartées, ${pf.ambiguous.kept} conservées${pf.ambiguous.skippedIds.length ? ` (écartées : ${pf.ambiguous.skippedIds.join(', ')})` : ''} |`);
L.push('', `Rappel « à conserver » : **${pct(pf.keepRecall)}** ; rappel « à exclure » : **${pct(pf.excludeRecall)}**.`, '');
L.push('**Correction méthodologique (phase A.1)** : le rapport précédent comptait l’acquisition OpenAI comme faux négatif. Or sa vérité terrain autorise la conservation comme l’exclusion. Elle est désormais `ambiguous` et comptée à part. Les erreurs ne portent plus que sur les publications `must_keep` (faux négatifs) et `must_exclude` (faux positifs).', '');
L.push(`Décision : le préfiltre reste **désactivé**. ${pf.mustExclude.falsePositives > 0 ? `Il laisse passer ${pf.mustExclude.falsePositives} publication(s) à exclure, ce qui est sans danger puisque l’IA les classera. ` : ''}Son intérêt économique est nul à ce volume (budget-scenarios.md). Sur 37 publications, l’absence de faux négatif ne suffit pas à garantir son innocuité sur le flux réel : il faudra le remesurer en phase B, contre les classifications réelles.`, '');

L.push('## 3. Détail par publication', '');
L.push('| Publication | Source | Décision | Couverture | Niveau | Politique | Mode envoyé | Résumé autorisé / attendu | Tokens (typique / borne) | Coût max Haiku 5.5 | Coût max gpt-6-luna | Préfiltre |');
L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const mode = r.input.mode === 'none' ? 'aucun appel (bloquée)' : r.editorialSkip ? 'aucun appel (règle éditoriale)' : r.input.mode;
  L.push(`| ${esc(r.p.title).slice(0, 60)} | ${r.p.sourceId} | ${r.g.editorialDecision} | ${r.g.coveragePolicy} | ${r.p.contentLevel} | ${r.input.policy} | ${mode} | ${r.g.summaryAllowed ? 'oui' : 'non'} / ${r.g.summaryExpected === 'if-kept' ? 'si conservée' : r.g.summaryExpected ? 'oui' : 'non'} | ${r.eligible ? `${r.typical} / ${r.bound}` : '—'} | ${r.costs['anthropic-haiku-5-5'].toFixed(6)} € | ${r.costs['openai-gpt-6-luna'].toFixed(6)} € | ${r.hint.verdict}${r.hint.wouldSkip ? ' → écarterait' : ''} |`);
}
L.push('', '## 4. Coût d’une passe complète (maximum)', '');
L.push('| Modèle | Passe complète (éligibles) | Passes possibles dans 0,50 € |', '|---|---|---|');
for (const k of CANDIDATE_MODEL_KEYS) {
  const total = eligible.reduce((s, r) => s + r.costs[k], 0);
  L.push(`| ${MODELS[k].modelId} | ${total.toFixed(4)} € | ${Math.floor(DEFAULT_LIMITS.trialTotalCapEur / total)} |`);
}
const maxBound = Math.max(...eligible.map((r) => r.bound));
L.push('', `Borne haute maximale : ${maxBound} tokens (plafond par requête : ${DEFAULT_LIMITS.maxInputTokensPerRequest}) ${maxBound <= DEFAULT_LIMITS.maxInputTokensPerRequest ? '✅' : '❌'}.`, '');
L.push('## 5. Protocole de la phase B (préparé, non exécuté)', '');
L.push('1. Une passe par modèle candidat sur les publications éligibles, avec le garde **persistant** (`createPersistentGuard`), en périmètre `trial`.');
L.push('2. Score automatique de la classification contre la vérité terrain : thématiques, type, bande de pertinence, intervalle de nouveauté, décision éditoriale, rubrique.');
L.push('3. Contrôles automatiques **indicatifs** des résumés (`src/evaluation/summary-checks.ts`), puis **revue manuelle obligatoire** dans `review/phase-b-manual-review.template.json` (grille : `reports/summary-evaluation-grid.md`).');
L.push('4. Aucun second LLM évaluateur.', '');
L.push('## 6. Limites de représentativité', '');
L.push('- 39 publications choisies à la main pour couvrir les cas, pas un échantillon aléatoire du flux réel (environ 13 publications par jour).');
L.push('- Les 30 publications réelles sont en `metadata-only` : seule la classification sur titre et métadonnées y sera mesurée. Les résumés ne seront évalués que sur 7 fixtures synthétiques, courtes et en français, alors que les articles réels sont surtout en anglais.');
L.push('- La vérité terrain a été rédigée par l’assistant : elle doit être relue, en particulier les 5 décisions `ambiguous` et les 11 publications `hardToClassify`.', '');
await writeFile(new URL('reports/evaluation-readiness.md', root), L.join('\n'));

// ------------------------------------------------------------------ evaluation-dataset-quality.md
const gt = gtFile.items;
const issues: string[] = [];
for (const r of rows) {
  const g = r.g;
  const nul = g.acceptableExclusions.includes(null);
  const reasons = g.acceptableExclusions.filter((x) => x !== null).length;
  if (g.editorialDecision === 'must_keep' && (!nul || reasons > 0)) issues.push(`${g.id} : must_keep mais exclusions acceptables ${JSON.stringify(g.acceptableExclusions)}`);
  if (g.editorialDecision === 'must_exclude' && nul) issues.push(`${g.id} : must_exclude mais null accepté`);
  if (g.editorialDecision === 'ambiguous' && (!nul || reasons === 0)) issues.push(`${g.id} : ambiguous sans alternative réelle`);
  if (g.coveragePolicy !== coverageFor(r.p.sourceId)) issues.push(`${g.id} : coveragePolicy incohérente avec la configuration`);
  if (g.coveragePolicy === 'mandatory' && g.sections.includes('excluded')) issues.push(`${g.id} : couverture obligatoire mais rubrique « excluded » acceptée`);
  if (g.summaryAllowed !== r.input.summaryAllowed) issues.push(`${g.id} : summaryAllowed incohérent avec politique × niveau`);
  if (g.summaryExpected !== false && !g.summaryAllowed) issues.push(`${g.id} : résumé attendu mais non autorisé`);
  if (g.editorialDecision === 'must_exclude' && g.summaryExpected !== false) issues.push(`${g.id} : résumé attendu pour une publication à exclure`);
}
const Q: string[] = ['# POC 2 — Qualité du jeu d’évaluation (phase A.1)', ''];
Q.push(`> Généré par \`npm run prepare:eval\` le ${today}. Vérité terrain révisée : ${gtFile.revisedAt}.`, '');
Q.push('## Composition', '');
Q.push('| Dimension | Répartition |', '|---|---|');
Q.push(`| Origine | ${fmt(count(set.items, (p) => (p.synthetic ? 'synthétique' : 'réelle (métadonnées seules)')))} |`);
Q.push(`| Décision éditoriale | ${fmt(count(gt, (g) => g.editorialDecision))} |`);
Q.push(`| Couverture | ${fmt(count(gt, (g) => g.coveragePolicy))} |`);
Q.push(`| Classification difficile (hardToClassify) | ${fmt(count(gt, (g) => (g.hardToClassify ? 'oui' : 'non')))} |`);
Q.push(`| Niveau de contenu | ${fmt(count(set.items, (p) => p.contentLevel))} |`);
Q.push(`| Bande de pertinence | ${fmt(count(gt, (g) => g.relevance))} |`);
Q.push(`| Thématique principale attendue | ${fmt(count(gt, (g) => g.themes[0] ?? '(aucune : exclusion)'))} |`);
Q.push(`| Type principal attendu | ${fmt(count(gt, (g) => g.types[0]))} |`);
Q.push(`| Résumé attendu | ${fmt(count(gt, (g) => String(g.summaryExpected)))} |`, '');
Q.push('## Indépendance des dimensions (exemples présents dans le jeu)', '');
const ex = (f: (g: GT) => boolean) => gt.filter(f).map((g) => `\`${g.id.split(':')[0]}…\``).length;
Q.push(`- Couverture obligatoire avec pertinence moyenne : ${ex((g) => g.coveragePolicy === 'mandatory' && g.relevance === 'medium')} publications (aucune pertinence forcée à 70+).`);
Q.push(`- Couverture obligatoire et nouveauté faible (≤ 2) : ${ex((g) => g.coveragePolicy === 'mandatory' && g.novelty[0] <= 2)}.`);
Q.push(`- \`must_keep\` difficiles à classer : ${ex((g) => g.editorialDecision === 'must_keep' && g.hardToClassify)} (la décision n’est pas déduite de la difficulté).`);
Q.push(`- Résumé autorisé mais non attendu (exclusion) : ${ex((g) => g.summaryAllowed && g.summaryExpected === false)} (\`synthetic:lumio-funding\`, test dédié au comportement d’exclusion).`, '');
Q.push('## Contrôles de cohérence', '');
Q.push(issues.length ? issues.map((i) => `- ❌ ${i}`).join('\n') : '✅ Aucune incohérence entre décision éditoriale, exclusions acceptables, couverture, rubriques et résumés.', '');
Q.push('## Journal des modifications de la vérité terrain', '', ...gtFile.changeLog.map((c) => `- ${c}`), '');
Q.push('## Sources à couverture obligatoire', '', ...Object.entries(MANDATORY_COVERAGE_SOURCES).map(([k, v]) => `- \`${k}\` : ${v}`), '');
await writeFile(new URL('reports/evaluation-dataset-quality.md', root), Q.join('\n'));

// ------------------------------------------------------------------ fiche de revue manuelle
const template = {
  description:
    'Fiche de revue manuelle des résultats de la phase B (à copier, puis remplir après les appels). Notes des résumés : 0 = insuffisant, 1 = acceptable, 2 = bon. Aucun LLM évaluateur. Les contrôles automatiques sont indicatifs.',
  criteria: SUMMARY_CRITERIA.map((c) => ({ id: c.id, label: c.label, automatic: c.automatic })),
  reviewer: null,
  reviewedAt: null,
  models: CANDIDATE_MODEL_KEYS.map((k) => MODELS[k].modelId),
  items: eligible.map((r) => ({
    publicationId: r.p.id,
    synthetic: r.p.synthetic,
    title: r.p.title,
    expected: {
      editorialDecision: r.g.editorialDecision,
      coveragePolicy: r.g.coveragePolicy,
      themes: r.g.themes,
      types: r.g.types,
      relevance: r.g.relevance,
      novelty: r.g.novelty,
      sections: r.g.sections,
      summaryExpected: r.g.summaryExpected,
    },
    results: CANDIDATE_MODEL_KEYS.map((k) => ({
      model: MODELS[k].modelId,
      classification: { themesOk: null, typeOk: null, relevanceOk: null, noveltyOk: null, decisionOk: null, sectionOk: null },
      summary: r.g.summaryExpected === false ? 'sans objet' : Object.fromEntries(SUMMARY_CRITERIA.map((c) => [c.id, null])),
      notes: '',
    })),
  })),
};
await mkdir(new URL('review/', root), { recursive: true });
await writeFile(new URL('review/phase-b-manual-review.template.json', root), JSON.stringify(template, null, 2));
console.log(`evaluation-readiness.md, evaluation-dataset-quality.md (${issues.length} incohérence(s)), review template (${eligible.length} publications). Préfiltre : FN=${pf.mustKeep.falseNegatives} FP=${pf.mustExclude.falsePositives} ambigus écartés=${pf.ambiguous.skipped}`);
if (issues.length) process.exitCode = 1;
