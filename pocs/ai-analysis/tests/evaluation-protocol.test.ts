import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { forbidNetwork, evaluationSet, groundTruth, byId } from './helpers.js';
import { evaluatePrefilter, prefilterHint, PREFILTER_ENABLED, type PrefilterHint } from '../src/prefilter.js';
import { coverageFor } from '../src/config/coverage.js';
import { resolveInput } from '../src/content-policy.js';
import { autoCheckSummary, SUMMARY_CRITERIA } from '../src/evaluation/summary-checks.js';
import { analyzePublication } from '../src/pipeline.js';
import { MockAdapter, mockOutput } from '../src/adapters/mock.js';
import { BudgetGuard } from '../src/budget/guard.js';
import { MemoryBudgetStore } from '../src/budget/store.js';
import { SYSTEM_PROMPT } from '../src/prompt.js';

before(forbidNetwork);
const hint = (wouldSkip: boolean): PrefilterHint => ({ verdict: wouldSkip ? 'FINANCE_STARTUP' : 'PERTINENT', wouldSkip, domains: [], note: '' });

// ------------------------------------------------------------------ préfiltre : 3 statuts
test('préfiltre : FN = must_keep écartées, FP = must_exclude conservées, ambigus comptés à part', () => {
  const r = evaluatePrefilter([
    { id: 'k1', hint: hint(false), decision: 'must_keep' },
    { id: 'k2', hint: hint(true), decision: 'must_keep' },
    { id: 'x1', hint: hint(true), decision: 'must_exclude' },
    { id: 'x2', hint: hint(false), decision: 'must_exclude' },
    { id: 'a1', hint: hint(true), decision: 'ambiguous' },
    { id: 'a2', hint: hint(false), decision: 'ambiguous' },
  ]);
  assert.deepEqual(r.mustKeep, { total: 2, kept: 1, falseNegatives: 1, falseNegativeIds: ['k2'] });
  assert.deepEqual(r.mustExclude, { total: 2, skipped: 1, falsePositives: 1, falsePositiveIds: ['x2'] });
  assert.deepEqual(r.ambiguous, { total: 2, skipped: 1, kept: 1, skippedIds: ['a1'] });
  assert.equal(r.keepRecall, 0.5);
});

test('préfiltre : l’acquisition OpenAI (ambiguë) n’est plus un faux négatif ; préfiltre désactivé', () => {
  assert.equal(PREFILTER_ENABLED, false);
  const items = evaluationSet.items
    .filter((p) => resolveInput(p).mode !== 'none' && p.editorial?.action !== 'excluded')
    .map((p) => ({ id: p.id, hint: prefilterHint(p), decision: groundTruth.items.find((g) => g.id === p.id)!.editorialDecision }));
  const r = evaluatePrefilter(items);
  const acq = 'openai-news:https://openai.com/index/openai-to-acquire-pierre';
  assert.ok(!r.mustKeep.falseNegativeIds.includes(acq));
  assert.ok(r.ambiguous.skippedIds.includes(acq), 'comptée parmi les ambiguës écartées');
  assert.equal(r.mustKeep.falseNegatives, 0);
});

// ------------------------------------------------------------------ vérité terrain
test('vérité terrain : décision explicite, cohérente avec les exclusions acceptables, indépendante de hardToClassify', () => {
  for (const g of groundTruth.items) {
    const nul = g.acceptableExclusions.includes(null);
    const reasons = g.acceptableExclusions.filter((x) => x !== null).length;
    if (g.editorialDecision === 'must_keep') assert.ok(nul && reasons === 0, g.id);
    if (g.editorialDecision === 'must_exclude') assert.ok(!nul && reasons > 0, g.id);
    if (g.editorialDecision === 'ambiguous') assert.ok(nul && reasons > 0, g.id);
  }
  // La décision n'est pas déduite de la difficulté : des must_keep difficiles existent.
  assert.ok(groundTruth.items.some((g) => g.editorialDecision === 'must_keep' && g.hardToClassify));
});

test('vérité terrain : couverture obligatoire alignée sur la configuration, jamais « excluded », pertinence non forcée', () => {
  for (const g of groundTruth.items) {
    const p = byId(g.id);
    assert.equal(g.coveragePolicy, coverageFor(p.sourceId), g.id);
    if (g.coveragePolicy === 'mandatory') assert.ok(!g.sections.includes('excluded'), g.id);
  }
  const mandatory = groundTruth.items.filter((g) => g.coveragePolicy === 'mandatory');
  assert.ok(mandatory.some((g) => g.relevance === 'medium' && g.novelty[0] <= 2), 'release obligatoire, pertinence moyenne, nouveauté faible');
});

test('vérité terrain : lumio-funding exclue → résumé autorisé mais non attendu (test dédié)', () => {
  const g = groundTruth.items.find((x) => x.id === 'synthetic:lumio-funding')!;
  assert.equal(g.editorialDecision, 'must_exclude');
  assert.equal(g.summaryAllowed, true);
  assert.equal(g.summaryExpected, false);
  assert.equal(g.exclusionBehaviourTest, true);
});

// ------------------------------------------------------------------ résumés des publications exclues
test('exclusion : la consigne interdit le résumé et le pipeline supprime tout résumé d’une publication exclue', async () => {
  assert.match(SYSTEM_PROMPT, /Si exclusionReason n'est pas null, summary = null/);
  const adapter = new MockAdapter(() => ({
    rawText: mockOutput({ themes: [], exclusionReason: 'funding_only', summary: 'Lumio lève 40 millions d’euros.', keyPoints: ['40 millions'] }),
    usage: { inputTokens: 900, outputTokens: 120 },
    stopReason: 'end_turn',
  }));
  const r = await analyzePublication(byId('synthetic:lumio-funding'), { adapter, guard: new BudgetGuard(new MemoryBudgetStore()) });
  assert.equal(r.section, 'excluded');
  assert.equal(r.analysis!.summary, null);
  assert.deepEqual(r.analysis!.keyPoints, []);
  assert.ok(r.violations.includes('summary-on-excluded-dropped'));
  assert.equal(adapter.calls.length, 1, 'un seul appel : pas d’appel supplémentaire pour décider du résumé');
});

// ------------------------------------------------------------------ grille d'évaluation des résumés
test('grille : six critères, contrôles automatiques indicatifs sauf le respect du niveau de contenu', () => {
  assert.equal(SUMMARY_CRITERIA.length, 6);
  const checks = autoCheckSummary({
    summary: 'OrionVision est un modèle multimodal de 7 milliards de paramètres sous licence Apache-2.0, avec un score de 81,4.',
    keyPoints: [],
    sourceText: byId('synthetic:orion-multimodal').text!,
    title: 'Orion',
    summaryExpected: true,
    kept: true,
    excerptLimited: false,
    referenceFacts: ['7 milliards', 'Apache-2.0', '81,4'],
    forbiddenClaims: ['13 milliards'],
  });
  assert.ok(checks.every((c) => c.verdict === 'pass' || c.verdict === 'n/a'), JSON.stringify(checks));
  assert.ok(checks.filter((c) => c.criterion !== 'content_level_respect').every((c) => c.indicative));
  assert.equal(checks.find((c) => c.criterion === 'content_level_respect')!.indicative, false);
});

test('grille : affirmation interdite, chiffre inventé, anglais et résumé non attendu détectés', () => {
  const base = { keyPoints: [], sourceText: 'Le modèle compte 7 milliards de paramètres.', title: 'T', kept: true, excerptLimited: false, forbiddenClaims: ['MIT'] };
  const bad = autoCheckSummary({ ...base, summary: 'The model has 13 billion parameters under the MIT license.', summaryExpected: true, referenceFacts: ['7 milliards'] });
  const v = Object.fromEntries(bad.map((c) => [c.criterion, c.verdict]));
  assert.equal(v.factual_accuracy, 'fail');
  assert.equal(v.no_invented_claims, 'fail');
  assert.equal(v.french_quality, 'warn');
  assert.equal(v.essential_information, 'fail');
  const unexpected = autoCheckSummary({ ...base, summary: 'Résumé.', summaryExpected: false });
  assert.deepEqual(unexpected.map((c) => [c.criterion, c.verdict]), [['content_level_respect', 'fail']]);
  const ifKeptExcluded = autoCheckSummary({ ...base, summary: null, summaryExpected: 'if-kept', kept: false });
  assert.equal(ifKeptExcluded[0].verdict, 'pass');
});

// ------------------------------------------------------------------ cohérence ensemble / éligibles
import { readFileSync } from 'node:fs';
import { decisionCounts, isEligible, subsetConsistencyErrors, DECISIONS } from '../src/evaluation/dataset.js';

test('cohérence : effectifs éligibles ≤ effectifs globaux, sommes exactes', () => {
  const all = groundTruth.items;
  const elig = all.filter((g) => isEligible(byId(g.id)));
  const cAll = decisionCounts(all);
  const cElig = decisionCounts(elig);
  assert.deepEqual(subsetConsistencyErrors(cAll, cElig, { all: all.length, subset: elig.length }), []);
  for (const d of DECISIONS) assert.ok(cElig[d] <= cAll[d], d);
  // Les non-éligibles expliquent exactement l'écart
  const nonElig = decisionCounts(all.filter((g) => !isEligible(byId(g.id))));
  for (const d of DECISIONS) assert.equal(cAll[d], cElig[d] + nonElig[d], d);
  assert.deepEqual(subsetConsistencyErrors({ must_keep: 1, must_exclude: 0, ambiguous: 4 }, { must_keep: 1, must_exclude: 0, ambiguous: 5 }, { all: 5, subset: 6 }), ['ambiguous : 5 éligibles > 4 au total', 'sous-ensemble plus grand que l’ensemble'], 'détecte les incohérences');
});

test('cohérence : le rapport evaluation-readiness.md est à jour avec les données', () => {
  const md = readFileSync(new URL('../reports/evaluation-readiness.md', import.meta.url), 'utf8');
  const all = groundTruth.items;
  const elig = all.filter((g) => isEligible(byId(g.id)));
  const fmt = (c: Record<string, number>) => Object.entries(c).map(([k, v]) => `${k} ${v}`).join(', ');
  assert.ok(md.includes(`ensemble des ${all.length} publications** : ${fmt(decisionCounts(all))}`), 'effectifs globaux');
  assert.ok(md.includes(`Sur les ${elig.length} éligibles** : ${fmt(decisionCounts(elig))}`), 'effectifs éligibles');
  const c = decisionCounts(elig);
  assert.match(md, new RegExp(`\\| \`must_keep\` \\| ${c.must_keep} \\|`));
  assert.match(md, new RegExp(`\\| \`must_exclude\` \\| ${c.must_exclude} \\|`));
  assert.match(md, new RegExp(`\\| \`ambiguous\` \\(hors erreurs\\) \\| ${c.ambiguous} \\|`));
  assert.ok(!/\b5 décisions `ambiguous`|11 publications `hardToClassify`/.test(md), 'plus aucun effectif codé en dur');
});
