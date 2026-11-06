/**
 * Préparation de B.2 (hors ligne, aucun réseau) : contrôle « affirmation interdite », activation par phase,
 * ordre et durée d'exécution, interruption et reprise sans doublon, indicateurs de comparaison, grille à l'aveugle.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forbidNetwork, evaluationSet, groundTruth } from './helpers.js';
import { autoCheckSummary, containsClaim } from '../src/evaluation/summary-checks.js';
import { blindReviewGrid, computeModelMetrics, latestRecords, selectComparableRuns, type GroundTruthItem } from '../src/evaluation/compare.js';
import { PROMPT_VERSION } from '../src/prompt.js';
import { MockAdapter, mockOutput } from '../src/adapters/mock.js';
import { BudgetGuard } from '../src/budget/guard.js';
import { FileBudgetStore, MemoryBudgetStore } from '../src/budget/store.js';
import { DEFAULT_LIMITS } from '../src/config/budget.js';
import { MODELS } from '../src/config/models.js';
import { POC_PHASES } from '../src/config/quotas.js';
import { analyzePublication } from '../src/pipeline.js';
import { parseArgs } from '../src/runner/args.js';
import { planRun, SMOKE_FIXTURE_ID } from '../src/runner/plan.js';
import { CALL_LATENCY_ASSUMPTIONS_MS, estimateRunDurationMs, executeRun, type RunDeps } from '../src/runner/run.js';
import { ACTIVATION_TTL_MS_BY_PHASE, ACTIVATION_TTL_MAX_MS, consumeGrant, createGrant, confirmationPhrase, type RealCallActivation } from '../src/security/activation.js';
import { isEligible } from '../src/evaluation/dataset.js';
import type { AnalysisRecord } from '../src/types.js';

before(forbidNetwork);
const HAIKU = 'anthropic-haiku-5-5';
const LUNA = 'openai-gpt-6-luna';
const MODELS2 = [HAIKU, LUNA];

// ================================================================ 1. Affirmations interdites
test('Affirmation interdite : sensible à la casse et aux frontières de mots (incident « MIT » / « limites »)', () => {
  assert.equal(containsClaim('Les limites signalées concernent la vidéo.', 'MIT'), false);
  assert.equal(containsClaim('Le modèle est sous licence mit.', 'MIT'), false, 'casse différente');
  assert.equal(containsClaim('Le cours MITx est cité.', 'MIT'), false, 'préfixe d’un autre mot');
  assert.equal(containsClaim('Distribué sous licence MIT.', 'MIT'), true);
  assert.equal(containsClaim('Licence (MIT) annoncée', 'MIT'), true);
  assert.equal(containsClaim('un modèle de 13 milliards de paramètres', '13 milliards'), true, 'espace insécable');
  assert.equal(containsClaim('un modèle de 113 milliards', '13 milliards'), false, 'chiffre précédé d’un chiffre');
  assert.equal(containsClaim('13 milliardaires', '13 milliards'), false);
  assert.equal(containsClaim('Le score a.b.c', 'a.b'), true, 'ponctuation littérale (pas de joker)');
  assert.equal(containsClaim('Le score axb', 'a.b'), false);
  assert.equal(containsClaim('texte', '   '), false);
});

test('Affirmation interdite : les résumés réels de B.1 ne sont plus signalés à tort', () => {
  const pub = evaluationSet.items.find((p) => p.id === SMOKE_FIXTURE_ID)!;
  const summary = 'Les limites signalées incluent la lecture de tableaux complexes et l’absence de traitement vidéo, sous licence Apache-2.0.';
  const c = autoCheckSummary({ summary, keyPoints: ['Limites : tableaux complexes'], sourceText: pub.text ?? null, title: pub.title, summaryExpected: true, kept: true, excerptLimited: false, forbiddenClaims: ['13 milliards', 'MIT'] });
  assert.equal(c.find((x) => x.criterion === 'no_invented_claims')!.verdict, 'pass');
  const bad = autoCheckSummary({ summary: 'Publié sous licence MIT.', keyPoints: [], sourceText: pub.text ?? null, title: pub.title, summaryExpected: true, kept: true, excerptLimited: false, forbiddenClaims: ['MIT'] });
  assert.equal(bad.find((x) => x.criterion === 'no_invented_claims')!.verdict, 'fail');
});

// ================================================================ 3. Plan B.2
/**
 * Registre reproduisant l'état réel après B.1 : orion analysée par les deux modèles avec l'ANCIEN prompt
 * (clé d'idempotence différente de la version courante), quotas B.1 consommés.
 */
async function guardAfterB1(store = new MemoryBudgetStore()) {
  const g = new BudgetGuard(store);
  for (const m of MODELS2) {
    const r = await g.reserve({ modelKey: m, inputTokensEstimate: 7460, idempotencyKey: `${m}|${SMOKE_FIXTURE_ID}|1c46e6992832`, quota: { scope: 'trial', phase: 'B1', runId: `b1-${m}` } });
    await g.reconcile(r.id, { inputTokens: 1500, outputTokens: 450 });
  }
  return g;
}

test('B.2 : 37 publications éligibles × 2 modèles = 74 appels alternés, orion réanalysée avec le prompt courant', async () => {
  assert.equal(evaluationSet.items.filter(isEligible).length, 37);
  for (const m of MODELS2) assert.equal(MODELS[m].validation.status, 'validated');
  const g = await guardAfterB1();
  const plan = planRun(parseArgs(['--mode=full']), evaluationSet.items, g, await g.snapshot());
  assert.equal(plan.phase, 'B2');
  assert.equal(plan.calls.length, 74);
  assert.equal(plan.calls.filter((c) => c.publication.id === SMOKE_FIXTURE_ID).length, 2, 'orion replanifiée (nouveau prompt)');
  assert.equal(plan.skipped.length, 0);
  for (const m of MODELS2) assert.equal(plan.calls.filter((c) => c.modelKey === m).length, 37);
  assert.equal(new Set(plan.calls.map((c) => c.key)).size, 74, 'aucun doublon');
  const s0 = await g.snapshot();
  assert.ok(Object.keys(s0.analyses).some((k) => k.endsWith('|1c46e6992832')), 'résultats B.1 conservés dans le registre');
  for (let i = 0; i < plan.calls.length; i++) assert.equal(plan.calls[i].modelKey, MODELS2[i % 2], 'ordre alterné');
  for (const m of MODELS2) assert.ok(plan.calls.filter((c) => c.modelKey === m).length <= POC_PHASES.B2.perModelMax);
  assert.ok(plan.calls.every((c) => c.inputTokensUpperBound <= DEFAULT_LIMITS.maxInputTokensPerRequest));
  const s = await g.snapshot();
  assert.ok(plan.totalMaxEur + s.trial.spentEur < DEFAULT_LIMITS.trialTotalCapEur, 'budget cumulé respecté');
  assert.ok(plan.totalMaxEur < 0.12);
});

test('B.2 : durée estimée compatible avec l’activation B.2 (90 min), B.1 inchangé, plafond absolu', async () => {
  const g = await guardAfterB1();
  const plan = planRun(parseArgs(['--mode=full']), evaluationSet.items, g, await g.snapshot());
  const typical = estimateRunDurationMs(plan, CALL_LATENCY_ASSUMPTIONS_MS.typical);
  const worst = estimateRunDurationMs(plan, CALL_LATENCY_ASSUMPTIONS_MS.worst);
  assert.ok(typical >= 35 * 60_000 && typical <= 40 * 60_000, `typique ${typical / 60_000} min`);
  assert.ok(worst <= ACTIVATION_TTL_MS_BY_PHASE.B2, `pire cas ${worst / 60_000} min`);
  assert.equal(ACTIVATION_TTL_MS_BY_PHASE.B1, 30 * 60_000);
  assert.ok(Object.values(ACTIVATION_TTL_MS_BY_PHASE).every((t) => t <= ACTIVATION_TTL_MAX_MS));
  assert.ok(Object.isFrozen(ACTIVATION_TTL_MS_BY_PHASE));
  for (const phase of ['B1', 'B2'] as const) {
    const dir = `${await mkdtemp(join(tmpdir(), 'dunggle-ttl-'))}/`;
    await createGrant({ phase, models: MODELS2, maxEur: 0.2, confirm: confirmationPhrase(phase, 0.2) }, dir);
    const now = new Date();
    const a = await consumeGrant(dir, { phase, models: MODELS2, maxEur: 0.2 }, now);
    assert.equal(a.validUntil - now.getTime(), ACTIVATION_TTL_MS_BY_PHASE[phase]);
    await rm(dir, { recursive: true, force: true });
  }
});

let ACT_B2: RealCallActivation;
before(async () => {
  const dir = `${await mkdtemp(join(tmpdir(), 'dunggle-act-'))}/`;
  await createGrant({ phase: 'B2', models: MODELS2, maxEur: 0.12, confirm: confirmationPhrase('B2', 0.12) }, dir);
  ACT_B2 = await consumeGrant(dir, { phase: 'B2', models: MODELS2, maxEur: 0.12 });
});
const env = { ANTHROPIC_API_KEY: ['sk', 'ant', 'api03', 'TESTB2xxxxxxxxxxxxxxxxxxxxx'].join('-'), OPENAI_API_KEY: ['sk', 'proj', 'TESTB2xxxxxxxxxxxxxxxxxxxxxxx'].join('-') } as NodeJS.ProcessEnv;
function deps(guard: BudgetGuard, opts: { stopAfter?: number; activation?: RealCallActivation | null; now?: () => number } = {}): RunDeps & { calls: string[] } {
  const calls: string[] = [];
  let t = 0;
  return {
    guard, env, activation: opts.activation === undefined ? ACT_B2 : opts.activation, calls,
    now: opts.now ?? (() => t), sleep: async (ms) => { t += ms; },
    shouldStop: () => opts.stopAfter !== undefined && calls.length >= opts.stopAfter,
    adapterFor: (k) => {
      const a = new MockAdapter(() => ({ rawText: mockOutput({ exclusionReason: 'none' }), usage: { inputTokens: 900, outputTokens: 120 }, stopReason: 'end_turn' }), MODELS[k]);
      return { real: true, model: a.model, analyze: (req) => (calls.push(k), (t += 3_000), a.analyze(req)) };
    },
  };
}

test('B.2 : interruption (Ctrl+C) puis reprise : aucune réservation ouverte, aucun doublon facturable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dunggle-resume-'));
  try {
    const g = await guardAfterB1(new FileBudgetStore(join(dir, 'ledger.json')) as unknown as MemoryBudgetStore);
    const args = parseArgs(['--mode=full', '--real', '--confirm-max-eur=0.12']);
    const d1 = deps(g, { stopAfter: 10 });
    const r1 = await executeRun(args, planRun(args, evaluationSet.items, g, await g.snapshot()), d1);
    assert.equal(r1.records.length, 10);
    assert.match(r1.stoppedReason!, /interruption demandée/);
    assert.equal(r1.timings!.length, 10);
    let s = await g.snapshot();
    assert.equal(Object.keys(s.reservations).length, 0, 'aucune réservation laissée ouverte');
    // Reprise (nouvelle autorisation dans la réalité ; ici même activation de test) : uniquement le reste.
    const plan2 = planRun(args, evaluationSet.items, g, s);
    assert.equal(plan2.calls.length, 64);
    const d2 = deps(g);
    const r2 = await executeRun(args, plan2, d2);
    assert.equal(r2.records.length, 64);
    s = await g.snapshot();
    assert.equal(s.quotas.phases.B2.total, 74);
    const keys = [...r1.records, ...r2.records].map((r) => `${r.model}|${r.publicationId}`);
    assert.equal(new Set(keys).size, 74, 'aucune publication analysée deux fois');
    // Quota B.2 : exactement 37 par modèle ; une 38e tentative est refusée par le garde.
    for (const m of MODELS2) {
      assert.equal(s.quotas.phases.B2.perModel[m], 37);
      await assert.rejects(g.reserve({ modelKey: m, inputTokensEstimate: 100, idempotencyKey: `x|${m}`, quota: { scope: 'trial', phase: 'B2', runId: 'extra' } }), /Quota de la phase B2/);
    }
    assert.equal(planRun(args, evaluationSet.items, g, s).calls.length, 0, 'plus rien à faire');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('B.2 : activation insuffisante pour la durée estimée → exécution refusée avant tout appel', async () => {
  const g = await guardAfterB1();
  const args = parseArgs(['--mode=full', '--real', '--confirm-max-eur=0.12']);
  // Horloge simulée : il ne reste que 20 minutes de validité.
  const d = deps(g, { now: () => ACT_B2.validUntil - 20 * 60_000 });
  const r = await executeRun(args, planRun(args, evaluationSet.items, g, await g.snapshot()), d);
  assert.equal(r.executed, false);
  assert.ok(r.blockers.some((b) => /Durée estimée/.test(b)), r.blockers.join(' | '));
  assert.equal(d.calls.length, 0);
});

// ================================================================ 4. Indicateurs
const gtItems = groundTruth.items as unknown as GroundTruthItem[];
function rec(id: string, model: string, over: Partial<AnalysisRecord> & { exclusionReason?: string | null; type?: string; themes?: string[]; relevance?: number; novelty?: number } = {}): AnalysisRecord {
  const pub = evaluationSet.items.find((p) => p.id === id)!;
  const g = gtItems.find((x) => x.id === id)!;
  const excluded = over.exclusionReason != null;
  return {
    publicationId: id, sourceId: pub.sourceId, url: pub.url, title: pub.title, synthetic: !!pub.synthetic, contentLevel: pub.contentLevel,
    contentPolicy: 'metadata-only', coveragePolicy: g.coveragePolicy, inputMode: 'metadata', status: 'analyzed',
    section: excluded ? 'excluded' : (g.sections[0] as AnalysisRecord['section']),
    analysis: { themes: (over.themes ?? g.themes) as never, subthemes: ['ai_models'], type: (over.type ?? g.types[0]) as never, relevance: over.relevance ?? 80, novelty: over.novelty ?? g.novelty[0], confidence: 0.8, relevanceReason: 'r', summary: null, keyPoints: [], exclusionReason: (over.exclusionReason ?? null) as never },
    violations: [], model, costEur: 0.0004, costUncertain: false, usage: { billable: { inputTokens: 1000, outputTokens: 200, reasoningTokens: 0 }, raw: null },
    ...over,
  } as AnalysisRecord;
}

test('Indicateurs : précision/rappel conservation et exclusion, couverture obligatoire, types, coûts, durées', () => {
  const keep = gtItems.filter((g) => g.editorialDecision === 'must_keep').slice(0, 4).map((g) => g.id);
  const excl = gtItems.filter((g) => g.editorialDecision === 'must_exclude').slice(0, 2).map((g) => g.id);
  const records = [
    rec(keep[0], HAIKU),
    rec(keep[1], HAIKU, { type: 'feature' }),
    rec(keep[2], HAIKU, { exclusionReason: 'promotional' }), // conservation manquée = exclusion à tort
    { ...rec(keep[3], HAIKU), status: 'provider-error', analysis: null, section: 'pending', costEur: 0, error: 'HTTP 500' } as AnalysisRecord,
    rec(excl[0], HAIKU, { exclusionReason: 'promotional' }),
    rec(excl[1], HAIKU), // exclusion manquée
  ];
  const m = computeModelMetrics(HAIKU, records, gtItems, evaluationSet.items, [{ modelKey: HAIKU, publicationId: keep[0], ms: 1000 }, { modelKey: HAIKU, publicationId: keep[1], ms: 3000 }]);
  assert.deepEqual([m.keep.tp, m.keep.fp, m.keep.fn], [2, 1, 2]);
  assert.equal(m.keep.precision, 0.667);
  assert.equal(m.keep.recall, 0.5);
  assert.deepEqual([m.exclude.tp, m.exclude.fp, m.exclude.fn], [1, 1, 1]);
  assert.equal(m.errors.length, 1);
  assert.equal(m.statuses['provider-error'], 1);
  assert.equal(m.types.evaluated, 2);
  assert.equal(m.types.primary, 1);
  assert.equal(m.cost.analyzed, 5);
  assert.equal(m.cost.avgPerPublicationEur, 0.0004);
  assert.equal(m.cost.projectedMonthlyEur.estimated, 0.156);
  assert.deepEqual([m.time.avgMs, m.time.medianMs], [2000, 1000]);
  const mandatory = gtItems.find((g) => g.coveragePolicy === 'mandatory')!;
  const cov = computeModelMetrics(HAIKU, [{ ...rec(mandatory.id, HAIKU), status: 'refused-quota', analysis: null, section: 'pending' } as AnalysisRecord], gtItems, evaluationSet.items);
  assert.deepEqual([cov.mandatoryCoverage.total, cov.mandatoryCoverage.visible], [1, 0]);
  assert.deepEqual(cov.mandatoryCoverage.missing, [mandatory.id]);
});

test('Indicateurs : dernier enregistrement retenu (incident B.1 puis reprise) et grille de revue à l’aveugle', () => {
  const orion = SMOKE_FIXTURE_ID;
  const failed = { ...rec(orion, HAIKU), status: 'provider-error', analysis: null } as AnalysisRecord;
  const ok = (m: string, summary: string) => {
    const r = rec(orion, m);
    return { ...r, analysis: { ...r.analysis!, summary, keyPoints: ['p'] } } as AnalysisRecord;
  };
  const byModel = latestRecords([{ records: [failed] }, { records: [ok(HAIKU, 'Résumé H.'), ok(LUNA, 'Résumé L.')] }]);
  assert.equal(byModel.get(HAIKU)!.length, 1);
  assert.equal(byModel.get(HAIKU)![0].status, 'analyzed');
  const { grid, key } = blindReviewGrid(byModel, gtItems, evaluationSet.items, () => 0.9);
  const item = (grid.items as { publicationId: string; candidates: { label: string; summary: string }[] }[]).find((i) => i.publicationId === orion)!;
  assert.deepEqual(item.candidates.map((c) => c.label), ['A', 'B']);
  assert.ok(!JSON.stringify(grid).includes(HAIKU) && !JSON.stringify(grid).includes(LUNA), 'aucun nom de modèle dans la grille');
  for (const c of item.candidates) assert.equal(byModel.get(key[orion][c.label])![0].analysis!.summary, c.summary, 'correspondance exacte');
});

test('Comparaison : seules les exécutions B.2 du prompt courant sont retenues (B.1 conservé, non réutilisé)', () => {
  const r = (file: string, mode: string, promptVersion?: string) => ({ file, args: { mode }, promptVersion, report: { records: [] } });
  const { kept, ignored } = selectComparableRuns([r('b1-incident.json', 'smoke'), r('b1-reprise.json', 'smoke', '1c46e6992832'), r('b2-ancien.json', 'full', 'ancien'), r('b2.json', 'full', PROMPT_VERSION)], PROMPT_VERSION);
  assert.deepEqual(kept.map((k) => k.file), ['b2.json']);
  assert.equal(ignored.length, 3);
  assert.notEqual(PROMPT_VERSION, '1c46e6992832', 'le prompt B.2 diffère de celui de B.1');
});

test('Prompt : définitions des huit types présentes et conformes à la règle validée', async () => {
  const { SYSTEM_PROMPT } = await import('../src/prompt.js');
  for (const t of ['security_advisory', 'release', 'feature', 'product', 'breakthrough', 'research', 'technical_analysis', 'prospective_analysis']) assert.match(SYSTEM_PROMPT, new RegExp(`· ${t} :`));
  assert.match(SYSTEM_PROMPT, /ÉVÉNEMENT DOMINANT/);
  assert.match(SYSTEM_PROMPT, /nouvelle version d'un modèle d'IA existant/);
  assert.match(SYSTEM_PROMPT, /disponibilité n'est pas établie/);
});
