/** Garde budgétaire (reprise des tests du POC 2, périmètre opérationnel seul). Hors ligne. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { forbidNetwork, testGuard } from '../helpers.js';
import { BudgetGuard, BudgetRefusedError, MemoryUsageLogger, type ReserveRequest } from '../../src/budget/guard.js';
import { MemoryBudgetStore } from '../../src/budget/store.js';
import { DEFAULT_LIMITS, PROVIDER_OVERHEAD_TOKENS } from '../../src/config/limits.js';
import { ANALYSIS_MODEL_KEY, MODELS } from '../../src/config/model.js';
import { buildPrompt } from '../../src/analysis/prompt.js';
import { resolveInput } from '../../src/analysis/content-policy.js';
import { ANALYSIS_JSON_SCHEMA } from '../../src/analysis/schema.js';
import { pub } from '../helpers.js';

before(forbidNetwork);
const code = (e: unknown) => (e as BudgetRefusedError).code;
let n = 0;
/** Réservation de test : clé d'idempotence unique et contexte de quota (obligatoires). */
const req = (o: Partial<ReserveRequest> = {}): ReserveRequest => ({ modelKey: 'mock-cheap', inputTokensEstimate: 100, idempotencyKey: `k${++n}`, quota: { runId: 'run' }, ...o });

test('plafonds et modèle : 10 € absolu, 8 € opérationnel, sortie 800 tokens ; GPT-6 Luna seul modèle configuré', () => {
  assert.equal(DEFAULT_LIMITS.monthlyHardCapEur, 10);
  assert.equal(DEFAULT_LIMITS.monthlyOperationalCapEur, 8);
  assert.equal(DEFAULT_LIMITS.maxOutputTokensPerRequest, 800);
  assert.ok(Object.isFrozen(DEFAULT_LIMITS));
  assert.ok(!('trialTotalCapEur' in DEFAULT_LIMITS), 'aucun budget d’essai de POC');
  assert.deepEqual(Object.keys(MODELS), ['openai-gpt-6-luna']);
  assert.equal(ANALYSIS_MODEL_KEY, 'openai-gpt-6-luna');
  assert.equal(MODELS[ANALYSIS_MODEL_KEY].modelId, 'gpt-6-luna');
  assert.equal(MODELS[ANALYSIS_MODEL_KEY].validation.status, 'validated');
});

test('estimation : (entrée × pire cas cache + sortie max) × marge × taux, tarif vérifié de GPT-6 Luna', () => {
  const g = testGuard();
  // (3000 × 0,10 × 1,25 + 800 × 0,50) / 1e6 × 1,25 = 0,000969 €
  assert.equal(g.estimateMaxCostEur(ANALYSIS_MODEL_KEY, 3000, 800), 0.000969);
  assert.ok(g.estimateMaxCostEur(ANALYSIS_MODEL_KEY, 5000) >= g.actualCostEur(ANALYSIS_MODEL_KEY, Math.ceil(5000 * 1.25), 800), 'écriture en cache couverte');
});

test('estimation : borne haute d’entrée = octets UTF-8 + marge forfaitaire, supérieure à l’estimation typique', () => {
  for (const policy of ['full-allowed', 'excerpt-only', 'metadata-only'] as const) {
    const p = pub();
    const b = buildPrompt(p, resolveInput(p, policy));
    const bytes = Buffer.byteLength(b.system) + Buffer.byteLength(b.user) + Buffer.byteLength(JSON.stringify(ANALYSIS_JSON_SCHEMA));
    assert.equal(b.inputTokensUpperBound, bytes + PROVIDER_OVERHEAD_TOKENS);
    assert.ok(b.inputTokensUpperBound > b.inputTokensEstimate);
  }
});

test('refus avant tout appel : tarif inconnu, modèle inconnu, modèle non validé, requête trop grande', async () => {
  const g = testGuard();
  await assert.rejects(g.reserve(req({ modelKey: 'mock-unpriced' })), (e) => code(e) === 'unknown-pricing');
  await assert.rejects(g.reserve(req({ modelKey: 'modele-invente' })), (e) => code(e) === 'unknown-pricing');
  await assert.rejects(g.reserve(req({ modelKey: 'mock-not-validated' })), (e) => code(e) === 'model-not-validated');
  await assert.rejects(g.reserve(req({ inputTokensEstimate: 16001 })), (e) => code(e) === 'request-too-large');
  await assert.rejects(g.reserve(req({ maxOutputTokens: 801 })), (e) => code(e) === 'request-too-large');
  assert.deepEqual((await g.snapshot()).reservations, {});
});

test('contexte obligatoire : sans clé d’idempotence ou sans contexte de quota, aucune réservation', async () => {
  const g = testGuard();
  await assert.rejects(g.reserve({ ...req(), idempotencyKey: '' }), (e) => code(e) === 'missing-context');
  await assert.rejects(g.reserve({ ...req(), quota: undefined as never }), (e) => code(e) === 'missing-context');
  assert.equal((await g.snapshot()).sequence, 0);
});

test('limites et quotas incohérents refusés à la construction', () => {
  assert.throws(() => testGuard({ limits: { monthlyOperationalCapEur: 12 } }), (e) => code(e) === 'invalid-limits');
  assert.throws(() => testGuard({ limits: { safetyMultiplier: 0.5 } }), (e) => code(e) === 'invalid-limits');
  assert.throws(() => testGuard({ quotas: { dailyMax: 5, monthlyMax: 500, perRunMax: 10 } }), (e) => code(e) === 'invalid-limits');
});

test('plafond opérationnel mensuel et maximum absolu', async () => {
  const g = testGuard({ limits: { monthlyOperationalCapEur: 0.006, monthlyHardCapEur: 0.006 } });
  await g.reserve(req());
  await assert.rejects(g.reserve(req()), (e) => ['monthly-operational', 'monthly-hard'].includes(code(e)));
});

test('plafond quotidien d’analyses (UTC)', async () => {
  const g = testGuard({ limits: { dailyMaxAnalyses: 2 } });
  await g.reserve(req());
  await g.reserve(req());
  await assert.rejects(g.reserve(req()), (e) => code(e) === 'daily-limit');
});

test('idempotence : une même analyse n’est jamais réservée deux fois ; libérée (non facturée) elle peut être retentée', async () => {
  const g = testGuard();
  const r = await g.reserve(req({ idempotencyKey: 'pub|luna|v|h#1' }));
  await assert.rejects(g.reserve(req({ idempotencyKey: 'pub|luna|v|h#1' })), (e) => code(e) === 'duplicate-analysis');
  await g.release(r.id, 'refus avant envoi');
  await g.reserve(req({ idempotencyKey: 'pub|luna|v|h#1' }));
  const done = await g.reserve(req({ idempotencyKey: 'pub|luna|v|h#2' }));
  await g.reconcile(done.id, { inputTokens: 100, outputTokens: 10 });
  await assert.rejects(g.reserve(req({ idempotencyKey: 'pub|luna|v|h#2' })), (e) => code(e) === 'duplicate-analysis', 'analyse facturée : jamais refacturée');
});

test('réconciliation, libération et coût incertain ; journal d’usage', async () => {
  const log = new MemoryUsageLogger();
  // blockWhenUncertain désactivé ici (par code) pour enchaîner les cas ; le blocage est testé plus bas.
  const g = testGuard({ limits: { blockWhenUncertain: false }, logger: log });
  const r1 = await g.reserve(req({ inputTokensEstimate: 1000 }));
  assert.equal(await g.reconcile(r1.id, { inputTokens: 900, outputTokens: 100 }), 0.0014); // (900 × 1 + 100 × 5)/1e6
  const r2 = await g.reserve(req({ inputTokensEstimate: 1000 }));
  assert.equal(await g.markUncertain(r2.id, 'timeout'), r2.estimatedMaxEur);
  const r3 = await g.reserve(req({ inputTokensEstimate: 1000 }));
  await g.release(r3.id, 'non envoyé');
  const s = await g.snapshot();
  const m = s.months['2026-11'];
  assert.equal(m.reservedEur, 0);
  assert.equal(m.spentEur, Math.round((0.0014 + r2.estimatedMaxEur) * 1e6) / 1e6);
  assert.equal(m.uncertainEur, r2.estimatedMaxEur);
  assert.equal(s.days['2026-11-06'].analyses, 2, 'la requête libérée ne compte pas');
  await assert.rejects(g.reconcile(r1.id, { inputTokens: 1, outputTokens: 1 }), (e) => code(e) === 'unknown-reservation', 'double réconciliation refusée');
  assert.deepEqual(log.events.map((e) => e.event), ['reserved', 'reconciled', 'reserved', 'uncertain', 'reserved', 'released']);
});

test('correction 2 : un coût incertain n’est jamais libéré et BLOQUE toute nouvelle dépense jusqu’au rapprochement', async () => {
  const g = testGuard();
  const r = await g.reserve(req({ inputTokensEstimate: 1000 }));
  await g.markUncertain(r.id, 'HTTP 500 : traitement possible');
  await assert.rejects(g.release(r.id, 'tentative de libération'), (e) => code(e) === 'unknown-reservation');
  await assert.rejects(g.reserve(req()), (e) => code(e) === 'uncertain-pending');
  let s = await g.snapshot();
  assert.ok(s.uncertain[r.id]);
  assert.equal(s.months['2026-11'].spentEur, r.estimatedMaxEur, 'compté au maximum');
  assert.equal(s.analyses[r.idempotencyKey].status, 'uncertain');
  const actual = await g.resolveUncertain(r.id, { inputTokens: 500, outputTokens: 50 });
  s = await g.snapshot();
  assert.equal(s.months['2026-11'].spentEur, actual);
  assert.equal(s.months['2026-11'].uncertainEur, 0);
  await g.reserve(req()); // dépenses rouvertes après rapprochement
});

test('dette : coût réel > estimation enregistré, signalé, et appels suivants bloqués par le plafond', async () => {
  const log = new MemoryUsageLogger();
  const g = testGuard({ limits: { monthlyOperationalCapEur: 0.02, monthlyHardCapEur: 0.02 }, logger: log });
  const r = await g.reserve(req({ maxOutputTokens: 100 }));
  const actual = await g.reconcile(r.id, { inputTokens: 15_000, outputTokens: 2_000 }); // 0,025 €
  assert.ok(actual > 0.02);
  const m = (await g.snapshot()).months['2026-11'];
  assert.equal(m.spentEur, actual);
  assert.ok((m.overrunEur ?? 0) > 0);
  assert.ok(log.events.some((e) => e.code === 'actual-exceeds-estimate'));
  assert.ok(log.events.some((e) => e.code === 'operational-cap-exceeded'));
  await assert.rejects(g.reserve(req()), (e) => ['monthly-operational', 'monthly-hard'].includes(code(e)));
});

test('dette sur coût incertain : excédent imputé au mois d’origine', async () => {
  const g = testGuard();
  const r = await g.reserve(req({ maxOutputTokens: 100 }));
  await g.markUncertain(r.id, 'réseau');
  const actual = await g.resolveUncertain(r.id, { inputTokens: 10_000, outputTokens: 1_000 });
  const m = (await g.snapshot()).months['2026-11'];
  assert.equal(m.spentEur, actual);
  assert.ok((m.overrunEur ?? 0) > 0);
});

test('mois civils : une réservation de fin de mois est imputée à son mois ; le mois suivant repart de zéro', async () => {
  let now = new Date('2026-10-31T23:59:30Z');
  const g = testGuard({ limits: { monthlyOperationalCapEur: 0.006, monthlyHardCapEur: 0.006 }, now: () => now });
  const r = await g.reserve(req());
  await assert.rejects(g.reserve(req()), (e) => code(e) === 'monthly-operational' || code(e) === 'monthly-hard');
  now = new Date('2026-11-01T00:00:30Z');
  await g.reconcile(r.id, { inputTokens: 100, outputTokens: 100 });
  const s = await g.snapshot();
  assert.ok(s.months['2026-10'].spentEur > 0, 'imputé à octobre');
  assert.equal(s.months['2026-11'], undefined);
  await g.reserve(req({ quota: { runId: 'run-novembre' } }));
});

test('réservations orphelines (arrêt brutal) : converties en coût incertain au maximum, jamais libérées', async () => {
  let now = new Date('2026-11-06T10:00:00.000Z');
  const g = testGuard({ now: () => now });
  const r = await g.reserve(req());
  now = new Date('2026-11-06T11:00:00.000Z');
  assert.deepEqual(await g.expireStale(30 * 60_000), [r.id]);
  const s = await g.snapshot();
  assert.equal(s.months['2026-11'].uncertainEur, r.estimatedMaxEur);
  assert.deepEqual(s.reservations, {});
  assert.ok(s.uncertain[r.id]);
  await assert.rejects(g.reserve(req()), (e) => code(e) === 'uncertain-pending');
});

test('concurrence (mémoire) : 100 réservations simultanées ne dépassent jamais le plafond', async () => {
  const cap = 0.05;
  const g = testGuard({ limits: { monthlyOperationalCapEur: cap }, quotas: { dailyMax: 1000, monthlyMax: 1000, perRunMax: 1000 } });
  const results = await Promise.allSettled(Array.from({ length: 100 }, () => g.reserve(req())));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, Math.floor(cap / 0.005125)); // 9
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => code((r as PromiseRejectedResult).reason) === 'monthly-operational'));
  assert.ok((await g.snapshot()).months['2026-11'].reservedEur <= cap);
});

test('journal d’usage : secrets masqués (motifs connus et valeurs exactes de l’environnement)', async () => {
  const log = new MemoryUsageLogger();
  const g = new BudgetGuard(new MemoryBudgetStore(), { ...DEFAULT_LIMITS, blockWhenUncertain: false }, log, () => new Date('2026-11-06T10:00:00Z'), (await import('../helpers.js')).TEST_MODELS);
  const r = await g.reserve(req());
  await g.markUncertain(r.id, 'erreur avec sk-proj-ABCDEFGHIJKLMNOPQRSTUV et Bearer abcdefghijklmnop');
  const dump = JSON.stringify(log.events) + JSON.stringify(await g.snapshot());
  assert.ok(!dump.includes('sk-proj-ABCDEFGHIJKLMNOPQRSTUV'));
  assert.ok(!dump.includes('abcdefghijklmnop'));
});
