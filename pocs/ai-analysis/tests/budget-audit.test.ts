import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { forbidNetwork, evaluationSet } from './helpers.js';
import { BudgetGuard, BudgetRefusedError, MemoryUsageLogger } from '../src/budget/guard.js';
import { FileBudgetStore, LockTimeoutError, MemoryBudgetStore } from '../src/budget/store.js';
import { createPersistentGuard } from '../src/budget/factory.js';
import { DEFAULT_LIMITS, PROVIDER_OVERHEAD_TOKENS, type BudgetLimits } from '../src/config/budget.js';
import { MODELS } from '../src/config/models.js';
import { buildPrompt } from '../src/prompt.js';
import { resolveInput } from '../src/content-policy.js';
import { normalizeAnthropicUsage, normalizeOpenAIUsage, buildAnthropicParams, buildOpenAIParams, realCallBlockers } from '../src/adapters/real.js';
import { ANALYSIS_JSON_SCHEMA } from '../src/schema.js';

before(forbidNetwork);
const L = (o: Partial<BudgetLimits> = {}): BudgetLimits => ({ ...DEFAULT_LIMITS, ...o });
const code = (e: unknown) => (e as BudgetRefusedError).code;
const at = (iso: string) => () => new Date(iso);
const tmp = () => mkdtemp(join(tmpdir(), 'dunggle-audit-'));

test('plafonds configurés : 10 € absolu, 8 € opérationnel, 0,50 € d’essai', () => {
  assert.equal(DEFAULT_LIMITS.monthlyHardCapEur, 10);
  assert.equal(DEFAULT_LIMITS.monthlyOperationalCapEur, 8);
  assert.equal(DEFAULT_LIMITS.trialTotalCapEur, 0.5);
});

test('estimation : borne haute d’entrée ≥ octets UTF-8 + marge, et ≥ estimation typique', () => {
  for (const p of evaluationSet.items) {
    const input = resolveInput(p);
    const b = buildPrompt(p, input);
    const bytes = Buffer.byteLength(b.system) + Buffer.byteLength(b.user) + Buffer.byteLength(JSON.stringify(ANALYSIS_JSON_SCHEMA));
    assert.equal(b.inputTokensUpperBound, bytes + PROVIDER_OVERHEAD_TOKENS, p.id);
    assert.ok(b.inputTokensUpperBound > b.inputTokensEstimate, p.id);
  }
});

test('estimation : coût MAXIMAL (sortie au plafond complet, réflexion comprise), pas moyen', () => {
  const g = new BudgetGuard(new MemoryBudgetStore());
  const est = g.estimateMaxCostEur('anthropic-haiku-5-5', 5000);
  // pire cas réel possible : 5000 tokens d'entrée + 800 tokens de sortie (max_tokens borne réflexion + texte)
  const worst = g.actualCostEur('anthropic-haiku-5-5', 5000, 800);
  assert.ok(est >= worst, `${est} ≥ ${worst}`);
  // OpenAI : le pire cas inclut une écriture en cache à 1,25× sur toute l'entrée
  const luna = g.estimateMaxCostEur('openai-gpt-6-luna', 5000);
  assert.ok(luna >= g.actualCostEur('openai-gpt-6-luna', Math.ceil(5000 * 1.25), 800), 'écriture en cache 30 min couverte');
  // les requêtes construites imposent ce même plafond au fournisseur
  const req = { system: 's', user: 'u', schema: ANALYSIS_JSON_SCHEMA, maxOutputTokens: DEFAULT_LIMITS.maxOutputTokensPerRequest };
  assert.equal(buildAnthropicParams(MODELS['anthropic-haiku-5-5'], req).max_tokens, 800);
  const o = buildOpenAIParams(MODELS['openai-gpt-6-luna'], req);
  assert.equal(o.max_output_tokens, 800);
  assert.deepEqual(o.prompt_cache_options, { mode: 'explicit' }, 'aucune écriture en cache demandée');
  assert.ok(!('cache_control' in buildAnthropicParams(MODELS['anthropic-haiku-5-5'], req)), 'pas de mise en cache Anthropic');
});

test('tokens de raisonnement : normalisation Anthropic (inclusifs) et OpenAI (prudente, plafonnée)', () => {
  assert.deepEqual(normalizeAnthropicUsage({ input_tokens: 1000, output_tokens: 600, output_tokens_details: { thinking_tokens: 400 } }), { inputTokens: 1000, outputTokens: 600, reasoningTokens: 400 });
  assert.equal(normalizeAnthropicUsage({ input_tokens: 1000, output_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 50 }).inputTokens, 1250);
  // OpenAI : output_tokens inclut le raisonnement (documenté) → pris tel quel
  assert.deepEqual(normalizeOpenAIUsage({ input_tokens: 75, output_tokens: 1186, output_tokens_details: { reasoning_tokens: 1024 } }), { inputTokens: 75, outputTokens: 1186, reasoningTokens: 1024 });
  // Exemple officiel du guide prompt-caching : 12 000 entrées dont 4 000 lues et 7 000 écrites (ici 30 min)
  const ex = normalizeOpenAIUsage({ input_tokens: 12000, output_tokens: 10, input_tokens_details: { cached_tokens: 4000, cache_write_tokens: 7000, cache_write_tokens_details: { ttl_30m_tokens: 7000, ttl_12h_tokens: 0 } } });
  assert.equal(ex.inputTokens, 5000 + 8750); // (1 000 ordinaires + 4 000 lectures à 1×, prudent) + 7 000 × 1,25
  // Écritures sans détail : pire cas 2,5×
  assert.equal(normalizeOpenAIUsage({ input_tokens: 1000, output_tokens: 1, input_tokens_details: { cache_write_tokens: 1000 } }).inputTokens, 2500);
});

test('validation documentaire : aucune information essentielle au niveau « résumé », « déduit » ou « absent »', () => {
  for (const k of ['anthropic-haiku-5-5', 'openai-gpt-6-luna']) {
    const weak = MODELS[k].validation.checks.filter((c) => c.evidence !== 'verbatim');
    assert.deepEqual(weak.map((c) => c.item), [], `${k} : preuves non textuelles`);
    for (const c of MODELS[k].validation.checks) assert.match(c.source, /^https:\/\/(platform\.claude\.com|developers\.openai\.com)\//, c.item);
  }
});

test('tarifs : palier long contexte appliqué ; modèle non validé refusé ; appels réels bloqués', () => {
  const g = new BudgetGuard(new MemoryBudgetStore(), L({ maxInputTokensPerRequest: 400_000 }));
  assert.ok(g.actualCostEur('openai-gpt-6-luna', 300_000, 0) > g.actualCostEur('openai-gpt-6-luna', 272_000, 0) * 2 * 0.99);
  assert.throws(() => g.estimateMaxCostEur('openai-gpt-5-nano', 100), (e) => code(e) === 'model-not-validated');
  for (const k of ['anthropic-haiku-5-5', 'openai-gpt-6-luna']) {
    assert.equal(MODELS[k].validation.status, 'validated');
    assert.ok(realCallBlockers(MODELS[k]).some((b) => b.includes('REAL_CALLS_ENABLED')));
  }
});

test('coût incertain : la réservation n’est jamais libérée ; seule une réconciliation explicite la solde', async () => {
  const log = new MemoryUsageLogger();
  const g = new BudgetGuard(new MemoryBudgetStore(), L(), log, at('2026-11-06T10:00:00Z'));
  const r = await g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 1000 });
  await g.markUncertain(r.id, 'timeout');
  await assert.rejects(g.release(r.id, 'tentative'), (e) => code(e) === 'unknown-reservation', 'libération impossible');
  let s = await g.snapshot();
  assert.ok(s.uncertain[r.id], 'entrée incertaine persistée');
  assert.equal(s.months['2026-11'].spentEur, r.estimatedMaxEur);
  // usage finalement connu, inférieur : la différence est rendue
  const actual = await g.resolveUncertain(r.id, { inputTokens: 500, outputTokens: 50 });
  s = await g.snapshot();
  assert.equal(s.months['2026-11'].spentEur, actual);
  assert.equal(s.months['2026-11'].uncertainEur, 0);
  assert.deepEqual(s.uncertain, {});
});

test('dette : coût réel > estimation enregistré et appels suivants bloqués', async () => {
  const log = new MemoryUsageLogger();
  const g = new BudgetGuard(new MemoryBudgetStore(), L({ trialTotalCapEur: 0.02 }), log, at('2026-11-06T10:00:00Z'));
  const r = await g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 100, maxOutputTokens: 100 });
  const actual = await g.reconcile(r.id, { inputTokens: 15_000, outputTokens: 2_000 }); // 0,025 €
  assert.ok(actual > 0.02);
  const s = await g.snapshot();
  assert.equal(s.trial.spentEur, actual);
  assert.ok((s.months['2026-11'].overrunEur ?? 0) > 0);
  assert.ok(log.events.some((e) => e.code === 'actual-exceeds-estimate'));
  assert.ok(log.events.some((e) => e.code === 'trial-cap-exceeded'));
  await assert.rejects(g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 10 }), (e) => code(e) === 'trial-cap');
});

test('dette sur coût incertain : excédent imputé au mois d’origine', async () => {
  const g = new BudgetGuard(new MemoryBudgetStore(), L(), undefined, at('2026-11-06T10:00:00Z'));
  const r = await g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 100, maxOutputTokens: 100 });
  await g.markUncertain(r.id, 'réseau');
  const actual = await g.resolveUncertain(r.id, { inputTokens: 10_000, outputTokens: 1_000 });
  const m = (await g.snapshot()).months['2026-11'];
  assert.equal(m.spentEur, actual);
  assert.ok((m.overrunEur ?? 0) > 0);
});

test('mois civils : une réservation de fin de mois est imputée à son mois ; le mois suivant repart de zéro', async () => {
  let now = new Date('2026-10-31T23:59:30Z');
  const store = new MemoryBudgetStore();
  const g = new BudgetGuard(store, L({ monthlyOperationalCapEur: 0.006, monthlyHardCapEur: 0.006, trialTotalCapEur: 0.006 }), undefined, () => now);
  const r = await g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 100, scope: 'operational' });
  await assert.rejects(g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 100, scope: 'operational' }), (e) => code(e) === 'monthly-operational' || code(e) === 'monthly-hard');
  now = new Date('2026-11-01T00:00:30Z');
  await g.reconcile(r.id, { inputTokens: 100, outputTokens: 100 });
  const s = await g.snapshot();
  assert.ok(s.months['2026-10'].spentEur > 0, 'imputé à octobre');
  assert.equal(s.months['2026-11'], undefined);
  await g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 100, scope: 'operational' }); // novembre : budget neuf
});

test('persistance : le registre survit à un redémarrage (nouvelle instance)', async () => {
  const dir = await tmp();
  try {
    const g1 = await createPersistentGuard(L({ trialTotalCapEur: 0.01 }), `${dir}/`);
    const r = await g1.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 100 });
    await g1.markUncertain(r.id, 'interruption simulée');
    const g2 = await createPersistentGuard(L({ trialTotalCapEur: 0.01 }), `${dir}/`); // « redémarrage »
    const s = await g2.snapshot();
    assert.ok(s.uncertain[r.id]);
    assert.equal(s.trial.spentEur, r.estimatedMaxEur);
    await assert.rejects(g2.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 100 }), (e) => code(e) === 'uncertain-pending', 'coût incertain persistant : arrêt sécurisé après redémarrage');
    const log = (await readFile(`${dir}/usage-log.jsonl`, 'utf8')).trim().split('\n');
    assert.ok(log.length >= 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('interruption de processus : la réservation reste comptée, puis convertie en coût incertain (jamais libérée)', async () => {
  const dir = await tmp();
  try {
    const path = join(dir, 'ledger.json');
    const worker = new URL('./crash-worker.ts', import.meta.url).pathname;
    const exit = await new Promise<number | null>((resolve) => spawn(process.execPath, ['--import', 'tsx', worker, path], { stdio: 'ignore' }).on('exit', resolve));
    assert.equal(exit, 9, 'le processus s’est interrompu après la réservation');
    const g = new BudgetGuard(new FileBudgetStore(path), L(), undefined, at('2026-11-06T12:00:00Z'));
    const before = await g.snapshot();
    const ids = Object.keys(before.reservations);
    assert.equal(ids.length, 1, 'réservation orpheline toujours comptée');
    assert.ok(before.trial.reservedEur > 0);
    assert.deepEqual(await g.expireStale(30 * 60_000), ids);
    const after = await g.snapshot();
    assert.deepEqual(after.reservations, {});
    assert.ok(after.uncertain[ids[0]], 'convertie en coût incertain, pas libérée');
    assert.equal(after.trial.spentEur, before.trial.reservedEur);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('verrou orphelin : jamais cassé automatiquement → aucune réservation possible', async () => {
  const dir = await tmp();
  try {
    const path = join(dir, 'ledger.json');
    await mkdir(`${path}.lock`);
    const g = new BudgetGuard(new FileBudgetStore(path, 200), L());
    await assert.rejects(g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 10 }), (e) => e instanceof LockTimeoutError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
