/**
 * Prépare l'évaluation de la phase B, SANS aucun appel : politiques appliquées, modes d'entrée,
 * tokens et coût maximal estimés par modèle candidat, mesure du préfiltre contre la vérité terrain.
 *   npm run prepare:eval   → reports/evaluation-readiness.md
 */
import { readFile, writeFile } from 'node:fs/promises';
import { DEFAULT_LIMITS } from '../config/budget.js';
import { CANDIDATE_MODEL_KEYS, MODELS } from '../config/models.js';
import { BudgetGuard } from '../budget/guard.js';
import { MemoryBudgetStore } from '../budget/store.js';
import { resolveInput } from '../content-policy.js';
import { buildPrompt } from '../prompt.js';
import { evaluatePrefilter, prefilterHint, PREFILTER_ENABLED } from '../prefilter.js';
import type { PublicationInput } from '../types.js';

const fx = new URL('../../fixtures/', import.meta.url);
const set = JSON.parse(await readFile(new URL('evaluation-set.json', fx), 'utf8')) as { items: PublicationInput[] };
const gt = JSON.parse(await readFile(new URL('ground-truth.json', fx), 'utf8')) as { items: { id: string; acceptableExclusions: (string | null)[]; ambiguous: boolean; expectedStatus?: string; summaryExpected: boolean }[] };
const guard = new BudgetGuard(new MemoryBudgetStore(), DEFAULT_LIMITS);

const rows = set.items.map((p) => {
  const input = resolveInput(p);
  const g = gt.items.find((x) => x.id === p.id)!;
  const editorialSkip = p.editorial?.action === 'excluded';
  const eligible = input.mode !== 'none' && !editorialSkip;
  const prompt = buildPrompt(p, input);
  const costs = Object.fromEntries(CANDIDATE_MODEL_KEYS.map((k) => [k, eligible ? guard.estimateMaxCostEur(k, prompt.inputTokensEstimate) : 0]));
  return { p, g, input, eligible, editorialSkip, tokens: prompt.inputTokensEstimate, costs, hint: prefilterHint(p) };
});

const eligible = rows.filter((r) => r.eligible);
const prefilter = evaluatePrefilter(eligible.map((r) => ({ id: r.p.id, hint: r.hint, expectedExcluded: !r.g.acceptableExclusions.includes(null) })));
const count = <T>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
const maxTokens = Math.max(...rows.map((r) => r.tokens));

const L: string[] = ['# POC 2 — Phase A : préparation de l’évaluation', ''];
L.push(`> Généré par \`npm run prepare:eval\` le ${new Date().toISOString().slice(0, 10)}. **Aucun appel à un modèle.** Les coûts sont des MAXIMA estimés (entrée estimée à 1 token / 3 caractères, sortie au plafond de ${DEFAULT_LIMITS.maxOutputTokensPerRequest} tokens, marge ×${DEFAULT_LIMITS.safetyMultiplier}, 1 USD compté 1 EUR).`, '');
L.push('## 1. Jeu d’évaluation', '');
L.push(`- **${set.items.length} publications** : ${rows.filter((r) => !r.p.synthetic).length} réelles (métadonnées uniquement) et ${rows.filter((r) => r.p.synthetic).length} synthétiques (textes fictifs signalés).`);
L.push(`- Niveaux de contenu : ${Object.entries(count(rows, (r) => r.p.contentLevel)).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
L.push(`- Politiques : ${Object.entries(count(rows, (r) => r.input.policy)).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
L.push(`- Modes d’entrée effectifs : ${Object.entries(count(rows, (r) => r.input.mode)).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
L.push(`- Cas ambigus (vérité terrain) : ${gt.items.filter((g) => g.ambiguous).length}. Résumés attendus : ${gt.items.filter((g) => g.summaryExpected).length} (uniquement des fixtures synthétiques).`);
L.push(`- **Éligibles à l’IA : ${eligible.length}** (exclus : ${rows.filter((r) => r.input.mode === 'none').length} source bloquée, ${rows.filter((r) => r.editorialSkip).length} exclusion éditoriale tracée).`, '');

L.push('## 2. Détail par publication', '');
L.push(`| Publication | Source | Niveau | Politique | Mode envoyé | Résumé permis | Tokens entrée (est.) | Coût max Haiku 5.5 | Coût max gpt-6-luna | Préfiltre (observation) |`);
L.push('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const status = r.input.mode === 'none' ? 'aucun appel (bloquée)' : r.editorialSkip ? 'aucun appel (règle éditoriale)' : r.input.mode;
  L.push(`| ${r.p.title.replace(/\|/g, '\\|').slice(0, 70)} | ${r.p.sourceId} | ${r.p.contentLevel} | ${r.input.policy} | ${status} | ${r.input.summaryAllowed ? 'oui' : 'non'} | ${r.eligible ? r.tokens : '—'} | ${r.costs['anthropic-haiku-5-5'].toFixed(6)} € | ${r.costs['openai-gpt-6-luna'].toFixed(6)} € | ${r.hint.verdict}${r.hint.wouldSkip ? ' → écarterait' : ''} |`);
}
L.push('');

L.push('## 3. Coût d’une passe complète (maximum estimé)', '');
L.push('| Modèle | Passe complète (éligibles) | Passes possibles dans le budget d’essai de 0,50 € |');
L.push('|---|---|---|');
for (const k of CANDIDATE_MODEL_KEYS) {
  const total = eligible.reduce((s, r) => s + r.costs[k], 0);
  L.push(`| ${MODELS[k].modelId} | ${total.toFixed(4)} € | ${Math.floor(DEFAULT_LIMITS.trialTotalCapEur / total)} |`);
}
L.push('', `Entrée maximale estimée : ${maxTokens} tokens (plafond par requête : ${DEFAULT_LIMITS.maxInputTokensPerRequest}) ${maxTokens <= DEFAULT_LIMITS.maxInputTokensPerRequest ? '✅' : '❌'}.`, '');

L.push('## 4. Préfiltre déterministe (observation, non activé)', '');
L.push(`Préfiltre activé : **${PREFILTER_ENABLED ? 'oui' : 'non'}**. Mesure sur les ${prefilter.total} publications éligibles, comparée à la vérité terrain (« exclusion obligatoire » = exclue) :`, '');
L.push('| Écartées à juste titre | Gardées alors qu’à exclure (faux positifs) | **Écartées à tort (faux négatifs)** | Gardées à juste titre |');
L.push('|---|---|---|---|');
L.push(`| ${prefilter.truePositives} | ${prefilter.falsePositives} | **${prefilter.falseNegatives}** | ${prefilter.trueNegatives} |`, '');
if (prefilter.falseNegativeIds.length) L.push(`Faux négatifs (publications pertinentes que le préfiltre aurait écartées) : ${prefilter.falseNegativeIds.join(', ')}.`, '');
L.push('Ces chiffres opposent le préfiltre à la vérité terrain **avant** tout appel IA. Il faudra les recompter en phase B, contre les classifications réelles. Le préfiltre ne doit pas être activé tant qu’il produit des faux négatifs sur des publications prioritaires.', '');

L.push('## 5. Limites de représentativité', '');
L.push('- 39 publications seulement, choisies à la main pour couvrir les cas ; ce n’est pas un échantillon aléatoire du flux réel (environ 13 publications par jour).');
L.push('- Les 30 publications réelles sont toutes en `metadata-only` : la phase B ne mesurera sur elles que la classification à partir du titre et des métadonnées. La qualité des résumés ne sera mesurée que sur 7 fixtures synthétiques.');
L.push('- La vérité terrain a été rédigée par l’assistant à partir des titres : elle doit être relue par le propriétaire du projet, en particulier les 10 cas ambigus.');
L.push('- Les fixtures synthétiques sont en français et courtes ; les articles réels sont surtout en anglais et plus longs.');
L.push('- Les tokens sont estimés (3 caractères par token) ; le comptage exact viendra de l’usage renvoyé par les fournisseurs en phase B.', '');
await writeFile(new URL('../../reports/evaluation-readiness.md', import.meta.url), L.join('\n'));
console.log(`evaluation-readiness.md : ${set.items.length} publications, ${eligible.length} éligibles, préfiltre FN=${prefilter.falseNegatives} FP=${prefilter.falsePositives}`);
