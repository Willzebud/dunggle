/**
 * Reprise de B.1 après l'incident HTTP 400 (schéma) — hors ligne, aucun réseau.
 * Non-régression du schéma (nullable, enums, required, imbrication) et exception de quota à usage unique.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forbidNetwork, evaluationSet } from './helpers.js';
import { ANALYSIS_JSON_SCHEMA, NO_EXCLUSION, providerSchemaProblems, validateAnalysis } from '../src/schema.js';
import { EXCLUSION_REASONS } from '../src/taxonomy.js';
import { MockAdapter, mockOutput } from '../src/adapters/mock.js';
import { ProviderError, type AnalysisRequest } from '../src/adapters/types.js';
import { buildAnthropicParams, buildOpenAIParams, classifySdkError } from '../src/adapters/real.js';
import { BudgetGuard, BudgetRefusedError } from '../src/budget/guard.js';
import { MemoryBudgetStore } from '../src/budget/store.js';
import { DEFAULT_LIMITS } from '../src/config/budget.js';
import { MODELS } from '../src/config/models.js';
import { PHASE_QUOTA_EXCEPTIONS, POC_PHASES, PRODUCTION_QUOTAS, phaseModelMax, phaseTotalMax } from '../src/config/quotas.js';
import { analyzePublication } from '../src/pipeline.js';
import { parseArgs } from '../src/runner/args.js';
import { planRun, SMOKE_FIXTURE_ID } from '../src/runner/plan.js';
import { executeRun, type RunDeps } from '../src/runner/run.js';
import { smokeChecks } from '../src/runner/smoke-checks.js';
import { createGrant, consumeGrant, confirmationPhrase, type RealCallActivation } from '../src/security/activation.js';
import type { AnalysisRecord } from '../src/types.js';

before(forbidNetwork);

const HAIKU = 'anthropic-haiku-5-5';
const LUNA = 'openai-gpt-6-luna';

// ================================================================ Schéma : non-régression
test('Schéma : aucune violation des règles communes Anthropic/OpenAI, aucune union', () => {
  assert.deepEqual(providerSchemaProblems(ANALYSIS_JSON_SCHEMA), []);
  const json = JSON.stringify(ANALYSIS_JSON_SCHEMA);
  assert.ok(!json.includes('null'), 'aucun null dans le schéma transport');
  assert.ok(!/"type":\[/.test(json), 'aucun tableau de types');
  assert.ok(!/anyOf|allOf|oneOf/.test(json));
});

test('Schéma : le contrôle détecte la forme refusée par Anthropic et les autres formes à risque', () => {
  const base = (prop: unknown) => ({ type: 'object', additionalProperties: false, required: ['x'], properties: { x: prop } });
  const cases: [unknown, RegExp][] = [
    [base({ type: ['string', 'null'], enum: ['a', null] }), /tableau de types|null dans enum/], // incident B.1
    [base({ anyOf: [{ type: 'string' }, { type: 'null' }] }), /anyOf/],
    [base({ type: 'integer', minimum: 0 }), /minimum/],
    [base({ type: 'string', maxLength: 10 }), /maxLength/],
    [base({ type: 'integer', enum: [1, 2] }), /seulement sur type string/],
    [base({ type: 'string', enum: ['A b', 'a b'] }), /casse/],
    [base({ type: 'array', items: { type: 'string' }, minItems: 2 }), /minItems/],
    [base({ type: 'object', properties: { y: { type: 'string' } }, required: ['y'] }), /additionalProperties/], // objet imbriqué
    [base({ type: 'array', items: { type: 'object', additionalProperties: false, properties: { y: { type: 'string' } }, required: [] } }), /absente de required/], // tableau d'objets
    [{ type: 'object', additionalProperties: false, required: ['x', 'y'], properties: { x: { type: 'string' } } }, /sans propriété/],
    [{ type: 'object', additionalProperties: false, required: [], properties: { x: { type: 'string' } } }, /absente de required/],
  ];
  for (const [schema, re] of cases) {
    const p = providerSchemaProblems(schema);
    assert.ok(p.some((m) => re.test(m)), `${JSON.stringify(schema)} → ${p.join(' | ')}`);
  }
});

test('Schéma : chaque champ est requis, enum exclusionReason = motifs connus + "none"', () => {
  assert.deepEqual([...ANALYSIS_JSON_SCHEMA.required].sort(), Object.keys(ANALYSIS_JSON_SCHEMA.properties).sort());
  assert.deepEqual(ANALYSIS_JSON_SCHEMA.properties.exclusionReason.enum, [...EXCLUSION_REASONS, NO_EXCLUSION]);
  assert.ok(!(EXCLUSION_REASONS as readonly string[]).includes(NO_EXCLUSION), 'la sentinelle n’est pas un vrai motif');
});

test('Validation : sentinelles converties en null, valeurs nulles et invalides traitées strictement', () => {
  const kept = validateAnalysis(mockOutput({ summary: 'Résumé.', keyPoints: ['Point'], exclusionReason: 'none' }));
  assert.equal(kept.ok, true, kept.errors.join());
  assert.equal(kept.value!.exclusionReason, null);
  const excluded = validateAnalysis(mockOutput({ themes: [], summary: '', keyPoints: [], exclusionReason: 'funding_only' }));
  assert.equal(excluded.ok, true, excluded.errors.join());
  assert.equal(excluded.value!.summary, null);
  assert.equal(excluded.value!.exclusionReason, 'funding_only');
  assert.equal(validateAnalysis(mockOutput({ summary: '', keyPoints: ['Point'] })).ok, false, 'points clés sans résumé');
  assert.equal(validateAnalysis(mockOutput({ summary: '   ' })).ok, false, 'blancs seuls');
  assert.equal(validateAnalysis(mockOutput({ exclusionReason: 'None' })).ok, false, 'casse différente refusée');
  assert.equal(validateAnalysis(mockOutput({ exclusionReason: 'autre' })).ok, false);
  assert.equal(validateAnalysis(mockOutput({ themes: [], exclusionReason: 'none' })).ok, false, 'thèmes vides sans motif');
  const missing = JSON.parse(mockOutput()) as Record<string, unknown>;
  delete missing.exclusionReason;
  assert.equal(validateAnalysis(missing).ok, false);
  // L'entrée n'est pas modifiée par la conversion.
  const raw = { ...(JSON.parse(mockOutput({ exclusionReason: 'none', summary: '' , keyPoints: [] })) as Record<string, unknown>) };
  validateAnalysis(raw);
  assert.equal(raw.exclusionReason, 'none');
});

test('Les deux adaptateurs et le pipeline transmettent exactement le schéma corrigé', async () => {
  const req: AnalysisRequest = { system: 's', user: 'u', schema: ANALYSIS_JSON_SCHEMA, maxOutputTokens: 800 };
  assert.equal(buildAnthropicParams(MODELS[HAIKU], req).output_config.format.schema, ANALYSIS_JSON_SCHEMA);
  const o = buildOpenAIParams(MODELS[LUNA], req);
  assert.equal(o.text.format.schema, ANALYSIS_JSON_SCHEMA);
  assert.equal(o.text.format.strict, true);
  let seen: unknown = null;
  const adapter = new MockAdapter((r) => ((seen = r.schema), { rawText: mockOutput({ exclusionReason: 'none' }), usage: { inputTokens: 900, outputTokens: 120 }, stopReason: 'end_turn' }));
  const fixture = evaluationSet.items.find((i) => i.id === SMOKE_FIXTURE_ID)!;
  const rec = await analyzePublication(fixture, { adapter, guard: new BudgetGuard(new MemoryBudgetStore()) });
  assert.equal(seen, ANALYSIS_JSON_SCHEMA);
  assert.equal(rec.status, 'analyzed');
});

// ================================================================ Affichage du smoke test
test('Smoke test : une requête refusée n’apparaît jamais comme un appel réussi', () => {
  const fixture = evaluationSet.items.find((i) => i.id === SMOKE_FIXTURE_ID)!;
  const gt = { themes: [], types: [], relevance: 'high' as const, novelty: [1, 5] as [number, number], sections: [] };
  const base = { publicationId: fixture.id, model: HAIKU, status: 'provider-error', analysis: null, usage: null, costEur: 0, costUncertain: false, section: 'pending' } as unknown as AnalysisRecord;
  const r400 = smokeChecks({ ...base, error: `invalid-request : ${classifySdkError({ status: 400, message: 'schema' }).message}` }, fixture, gt, 0.002);
  assert.equal(r400.find((c) => c.check === 'Appel abouti (réponse reçue)')!.ok, false);
  assert.equal(r400.find((c) => c.check === 'Authentification')!.ok, true);
  assert.equal(r400.find((c) => c.check === 'Aucun coût d’écriture en cache')!.ok, null);
  const r401 = smokeChecks({ ...base, error: 'auth : HTTP 401 : bad key' }, fixture, gt, 0.002);
  assert.equal(r401.find((c) => c.check === 'Authentification')!.ok, false);
  const net = smokeChecks({ ...base, error: 'network : ECONNRESET' }, fixture, gt, 0.002);
  assert.equal(net.find((c) => c.check === 'Authentification')!.ok, null);
});

// ================================================================ Exception de quota B.1
test('Exception B.1 : figée, B.1 uniquement, Haiku uniquement, +1 tentative ; rien d’autre ne change', () => {
  // Deux exceptions versionnées : B.1 Haiku (HTTP 400) et B.2 Luna (HTTP 429, liée à sa publication).
  assert.equal(PHASE_QUOTA_EXCEPTIONS.length, 2);
  assert.equal(PHASE_QUOTA_EXCEPTIONS.filter((x) => x.phase === 'B1').length, 1);
  const e = PHASE_QUOTA_EXCEPTIONS.find((x) => x.phase === 'B1')!;
  assert.equal(e.publicationId, undefined, 'exception B.1 non liée (comportement inchangé)');
  assert.deepEqual([e.phase, e.modelKey, e.extraCalls, e.incident.requestId, e.incident.billed], ['B1', HAIKU, 1, 'req_011Cgn4kjg6cEFjYpA4ZQLCh', false]);
  assert.ok(Object.isFrozen(PHASE_QUOTA_EXCEPTIONS) && Object.isFrozen(e) && Object.isFrozen(e.incident));
  assert.throws(() => (PHASE_QUOTA_EXCEPTIONS as unknown as unknown[]).push({}));
  assert.equal(phaseModelMax('B1', HAIKU), 2);
  assert.equal(phaseModelMax('B1', LUNA), 1, 'quota Luna inchangé');
  assert.equal(phaseTotalMax('B1'), 3);
  assert.equal(phaseModelMax('B2', HAIKU), 37);
  assert.equal(phaseModelMax('B2', LUNA), 38, 'B.2 : +1 Luna (exception liée)');
  assert.equal(phaseTotalMax('B2'), 75);
  assert.deepEqual({ ...POC_PHASES.B1 }, { mode: 'smoke', perModelMax: 1, totalMax: 2, description: POC_PHASES.B1.description, active: true });
  assert.deepEqual({ ...PRODUCTION_QUOTAS }, { dailyMax: 20, monthlyMax: 500, perRunMax: 10 });
  assert.equal(DEFAULT_LIMITS.trialTotalCapEur, 0.5);
});

let ACT: RealCallActivation;
before(async () => {
  const dir = `${await mkdtemp(join(tmpdir(), 'dunggle-act-'))}/`;
  await createGrant({ phase: 'B1', models: [HAIKU, LUNA], maxEur: 0.004, confirm: confirmationPhrase('B1', 0.004) }, dir);
  ACT = await consumeGrant(dir, { phase: 'B1', models: [HAIKU, LUNA], maxEur: 0.004 });
});
const env = { ANTHROPIC_API_KEY: ['sk', 'ant', 'api03', 'TESTREPRISEB1xxxxxxxxxxxxxx'].join('-'), OPENAI_API_KEY: ['sk', 'proj', 'TESTREPRISEB1xxxxxxxxxxxxxxxx'].join('-') } as NodeJS.ProcessEnv;

/** Registre reproduisant l'état réel après l'incident : une tentative Haiku B.1 transmise, non facturée. */
async function guardAfterIncident() {
  const guard = new BudgetGuard(new MemoryBudgetStore());
  const r = await guard.reserve({ modelKey: HAIKU, inputTokensEstimate: 7288, quota: { scope: 'trial', phase: 'B1', runId: 'incident' } });
  await guard.release(r.id, 'HTTP 400 schéma', { transmitted: true });
  const s = await guard.snapshot();
  assert.deepEqual([s.quotas.phases.B1.total, s.quotas.phases.B1.perModel[HAIKU], s.trial.spentEur], [1, 1, 0]);
  return guard;
}
const okAdapter = (k: string) => new MockAdapter(() => ({ rawText: mockOutput({ exclusionReason: 'none' }), usage: { inputTokens: 900, outputTokens: 120 }, stopReason: 'end_turn' }), MODELS[k]);
function deps(guard: BudgetGuard, adapterFor = okAdapter, activation: RealCallActivation | null = ACT): RunDeps & { calls: string[] } {
  const calls: string[] = [];
  return { guard, env, activation, now: () => 0, sleep: async () => {}, calls, adapterFor: (k) => { const a = adapterFor(k); return { real: a.real, model: a.model, analyze: (req) => (calls.push(k), a.analyze(req)) }; } };
}

test('Reprise B.1 : un appel Haiku + un appel Luna, même fixture, puis plus aucun appel possible', async () => {
  const guard = await guardAfterIncident();
  const args = parseArgs(['--mode=smoke', '--real', '--confirm-max-eur=0.004']);
  const plan = planRun(args, evaluationSet.items, guard, await guard.snapshot());
  assert.deepEqual(plan.calls.map((c) => c.modelKey), [HAIKU, LUNA]);
  assert.ok(plan.calls.every((c) => c.publication.id === SMOKE_FIXTURE_ID));
  assert.ok(plan.totalMaxEur < 0.004);
  const d = deps(guard);
  const r = await executeRun(args, plan, d);
  assert.equal(r.executed, true, r.blockers.join());
  assert.deepEqual(d.calls, [HAIKU, LUNA]);
  const s = await guard.snapshot();
  assert.deepEqual([s.quotas.phases.B1.total, s.quotas.phases.B1.perModel[HAIKU], s.quotas.phases.B1.perModel[LUNA]], [3, 2, 1]);
  // Plus rien : ni plan, ni réservation directe, pour aucun modèle.
  assert.equal(planRun(args, evaluationSet.items, guard, s).calls.length, 0);
  for (const m of [HAIKU, LUNA]) {
    await assert.rejects(guard.reserve({ modelKey: m, inputTokensEstimate: 100, idempotencyKey: `x|${m}`, quota: { scope: 'trial', phase: 'B1', runId: 'nouvelle' } }), (e: unknown) => e instanceof BudgetRefusedError && /quota-phase/.test(e.code));
  }
});

test('Reprise B.1 : une exécution ne peut pas consommer deux tentatives Haiku (même avec --max-calls)', async () => {
  const guard = new BudgetGuard(new MemoryBudgetStore());
  const plan = planRun(parseArgs(['--mode=smoke', '--max-calls=5', '--model=' + HAIKU]), evaluationSet.items, guard, null);
  assert.equal(plan.calls.length, 1, 'un appel Haiku par exécution');
  // Même par appels directs : la 3e tentative cumulée Haiku est refusée.
  for (let i = 0; i < 2; i++) {
    const r = await guard.reserve({ modelKey: HAIKU, inputTokensEstimate: 100, idempotencyKey: `k${i}`, quota: { scope: 'trial', phase: 'B1', runId: `r${i}` } });
    await guard.release(r.id, 'test', { transmitted: true });
  }
  await assert.rejects(guard.reserve({ modelKey: HAIKU, inputTokensEstimate: 100, idempotencyKey: 'k2', quota: { scope: 'trial', phase: 'B1', runId: 'r2' } }), /Quota de la phase B1 atteint pour anthropic-haiku-5-5 \(2\)/);
});

test('Reprise B.1 : nouvelle autorisation exigée, coût incertain bloquant, aucune relance, budget appliqué', async () => {
  const args = parseArgs(['--mode=smoke', '--real', '--confirm-max-eur=0.004']);
  // Sans activation (l'autorisation précédente est consommée) : aucun appel.
  let guard = await guardAfterIncident();
  let d = deps(guard, okAdapter, null);
  let r = await executeRun(args, planRun(args, evaluationSet.items, guard, await guard.snapshot()), d);
  assert.equal(r.executed, false);
  assert.equal(d.calls.length, 0);
  // Délai dépassé sur Haiku : coût incertain → arrêt, Luna non appelé, aucune relance, nouvelle exécution bloquée.
  guard = await guardAfterIncident();
  let attempts = 0;
  d = deps(guard, (k) => new MockAdapter(() => (attempts++, Promise.reject(new ProviderError('timeout', 'délai', true))), MODELS[k]));
  r = await executeRun(args, planRun(args, evaluationSet.items, guard, await guard.snapshot()), d);
  assert.equal(attempts, 1);
  assert.deepEqual(d.calls, [HAIKU]);
  assert.match(r.stoppedReason!, /coût incertain/);
  const again = await executeRun(args, planRun(args, evaluationSet.items, guard, await guard.snapshot()), deps(guard));
  assert.equal(again.executed, false);
  // Budget : un plafond d'essai insuffisant bloque avant toute réservation.
  const tight = new BudgetGuard(new MemoryBudgetStore(), { ...DEFAULT_LIMITS, trialTotalCapEur: 0.001 });
  const rb = await executeRun(args, planRun(args, evaluationSet.items, tight, null), deps(tight));
  assert.equal(rb.executed, false);
  assert.ok(rb.blockers.some((b) => /Budget d’essai restant/.test(b)));
});
