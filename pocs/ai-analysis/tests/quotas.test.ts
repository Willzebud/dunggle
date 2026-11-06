/**
 * Phase B.0.1 — quotas d'appels (production et POC) et activation locale à usage unique. Hors ligne.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { forbidNetwork, evaluationSet, pub } from './helpers.js';
import { BudgetGuard, BudgetRefusedError } from '../src/budget/guard.js';
import { FileBudgetStore, MemoryBudgetStore, emptyState, type LedgerState } from '../src/budget/store.js';
import { DEFAULT_LIMITS } from '../src/config/budget.js';
import { PENDING_POLICY, POC_PHASES, PRODUCTION_QUOTAS, type QuotaContext } from '../src/config/quotas.js';
import { parisDay, parisMonth } from '../src/quota/time.js';
import { selectPending } from '../src/quota/pending.js';
import { analyzePublication } from '../src/pipeline.js';
import { MockAdapter, mockOutput } from '../src/adapters/mock.js';
import { ProviderError } from '../src/adapters/types.js';
import { AnthropicAdapter } from '../src/adapters/real.js';
import { MODELS } from '../src/config/models.js';
import { parseArgs } from '../src/runner/args.js';
import { planRun } from '../src/runner/plan.js';
import { ActivationError, confirmationPhrase, consumeGrant, createGrant, GRANT_TTL_MS } from '../src/security/activation.js';

before(forbidNetwork);

const code = (e: unknown) => (e as BudgetRefusedError).code;
const MODELS2 = ['anthropic-haiku-5-5', 'openai-gpt-6-luna'];
const op = (runId: string): QuotaContext => ({ scope: 'operational', runId });
const reserveOp = (g: BudgetGuard, runId: string, i = 0) => g.reserve({ modelKey: MODELS2[i % 2], inputTokensEstimate: 1000, scope: 'operational', quota: op(runId) });
const at = (iso: string) => () => new Date(iso);
const tmp = () => mkdtemp(join(tmpdir(), 'dunggle-quota-'));

// ------------------------------------------------------------------ quotas de production
test('production : valeurs par défaut gelées (20/jour, 10/exécution, 500/mois ; 8 € / 10 €)', () => {
  assert.deepEqual({ ...PRODUCTION_QUOTAS }, { dailyMax: 20, monthlyMax: 500, perRunMax: 10 });
  assert.ok(Object.isFrozen(PRODUCTION_QUOTAS) && Object.isFrozen(POC_PHASES) && Object.isFrozen(POC_PHASES.B1));
  assert.throws(() => ((PRODUCTION_QUOTAS as { dailyMax: number }).dailyMax = 1e6), TypeError);
  assert.equal(DEFAULT_LIMITS.monthlyOperationalCapEur, 8);
  assert.equal(DEFAULT_LIMITS.monthlyHardCapEur, 10);
});

test('production : 21e appel quotidien refusé, quota partagé entre fournisseurs', async () => {
  const g = new BudgetGuard(new MemoryBudgetStore(), DEFAULT_LIMITS, undefined, at('2026-11-06T10:00:00Z'));
  for (let i = 0; i < 20; i++) await reserveOp(g, `run-${Math.floor(i / 10)}`, i); // 2 exécutions de 10, deux fournisseurs alternés
  await assert.rejects(reserveOp(g, 'run-3'), (e) => code(e) === 'quota-daily');
  const s = await g.snapshot();
  assert.equal(s.quotas.daily['operational|2026-11-06'], 20);
});

test('production : 11e appel de la même exécution refusé', async () => {
  const g = new BudgetGuard(new MemoryBudgetStore());
  for (let i = 0; i < 10; i++) await reserveOp(g, 'run-A', i);
  await assert.rejects(reserveOp(g, 'run-A'), (e) => code(e) === 'quota-run');
  await reserveOp(g, 'run-B'); // une autre exécution reste possible dans le quota quotidien
});

test('production : 501e appel mensuel refusé (compteurs persistés)', async () => {
  const initial: LedgerState = { ...emptyState(), quotas: { daily: {}, monthly: { 'operational|2026-11': 500 }, runs: {}, phases: {} } };
  const g = new BudgetGuard(new MemoryBudgetStore(initial), DEFAULT_LIMITS, undefined, at('2026-11-20T10:00:00Z'));
  await assert.rejects(reserveOp(g, 'r'), (e) => code(e) === 'quota-monthly');
  const g2 = new BudgetGuard(new MemoryBudgetStore({ ...initial, quotas: { ...initial.quotas, monthly: { 'operational|2026-11': 499 } } }), DEFAULT_LIMITS, undefined, at('2026-11-20T10:00:00Z'));
  await reserveOp(g2, 'r'); // 500e accepté
  await assert.rejects(reserveOp(g2, 'r2'), (e) => code(e) === 'quota-monthly'); // 501e refusé
});

test('production : deux gardes concurrents sur le même registre ne dépassent pas 20 appels', async () => {
  const dir = await tmp();
  try {
    const path = join(dir, 'ledger.json');
    const g1 = new BudgetGuard(new FileBudgetStore(path), DEFAULT_LIMITS, undefined, at('2026-11-06T10:00:00Z'));
    const g2 = new BudgetGuard(new FileBudgetStore(path), DEFAULT_LIMITS, undefined, at('2026-11-06T10:00:00Z'));
    const res = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => reserveOp(i % 2 ? g1 : g2, `run-${i % 4}`, i)));
    assert.equal(res.filter((r) => r.status === 'fulfilled').length, 20);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('production : trois processus distincts ne dépassent pas 20 appels', async () => {
  const dir = await tmp();
  try {
    const path = join(dir, 'ledger.json');
    const worker = new URL('./quota-worker.ts', import.meta.url).pathname;
    const run = (id: string) =>
      new Promise<number>((resolve, reject) => {
        const p = spawn(process.execPath, ['--import', 'tsx', worker, path, id], { stdio: ['ignore', 'pipe', 'inherit'] });
        let out = '';
        p.stdout.on('data', (d) => (out += d));
        p.on('exit', (c) => (c === 0 ? resolve(Number(out.trim())) : reject(new Error(`worker ${c}`))));
      });
    const counts = await Promise.all([run('p1'), run('p2'), run('p3')]);
    assert.equal(counts.reduce((a, b) => a + b, 0), 20);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Europe/Paris : clés de jour correctes, y compris aux changements d’heure', () => {
  // Hiver (UTC+1) : minuit Paris = 23:00 UTC ; été (UTC+2) : 22:00 UTC.
  assert.equal(parisDay(new Date('2026-11-05T22:59:00Z')), '2026-11-05');
  assert.equal(parisDay(new Date('2026-11-05T23:00:00Z')), '2026-11-06');
  // Passage à l'heure d'été (29 mars 2026, 02:00 → 03:00)
  assert.equal(parisDay(new Date('2026-03-28T22:59:00Z')), '2026-03-28');
  assert.equal(parisDay(new Date('2026-03-28T23:00:00Z')), '2026-03-29');
  assert.equal(parisDay(new Date('2026-03-29T22:00:00Z')), '2026-03-30', 'le 29 mars ne dure que 23 heures');
  // Passage à l'heure d'hiver (25 octobre 2026, 03:00 → 02:00)
  assert.equal(parisDay(new Date('2026-10-24T21:59:00Z')), '2026-10-24');
  assert.equal(parisDay(new Date('2026-10-24T22:00:00Z')), '2026-10-25');
  assert.equal(parisDay(new Date('2026-10-25T22:59:00Z')), '2026-10-25', 'le 25 octobre dure 25 heures');
  assert.equal(parisDay(new Date('2026-10-25T23:00:00Z')), '2026-10-26');
  assert.equal(parisMonth(new Date('2026-10-31T23:00:00Z')), '2026-11');
});

test('changement de jour Europe/Paris : le quota repart à minuit Paris, pas à minuit UTC', async () => {
  let t = new Date('2026-11-05T22:00:00Z'); // 23:00 à Paris
  const g = new BudgetGuard(new MemoryBudgetStore(), DEFAULT_LIMITS, undefined, () => t);
  for (let i = 0; i < 20; i++) await reserveOp(g, `r${Math.floor(i / 10)}`, i);
  t = new Date('2026-11-05T22:59:00Z'); // 23:59 Paris
  await assert.rejects(reserveOp(g, 'r9'), (e) => code(e) === 'quota-daily');
  t = new Date('2026-11-05T23:00:00Z'); // 00:00 Paris le 6
  await reserveOp(g, 'r10');
  for (let i = 0; i < 19; i++) await reserveOp(g, `r1${1 + Math.floor(i / 10)}`, i);
  t = new Date('2026-11-06T00:30:00Z'); // minuit UTC passé : toujours le 6 à Paris
  await assert.rejects(reserveOp(g, 'r20'), (e) => code(e) === 'quota-daily');
});

test('changement d’heure (25 octobre) : pas de remise à zéro pendant l’heure répétée', async () => {
  let t = new Date('2026-10-24T22:30:00Z'); // 00:30 CEST le 25
  const g = new BudgetGuard(new MemoryBudgetStore(), DEFAULT_LIMITS, undefined, () => t);
  for (let i = 0; i < 20; i++) await reserveOp(g, `r${Math.floor(i / 10)}`, i);
  t = new Date('2026-10-25T00:30:00Z'); // 02:30 CEST, puis
  await assert.rejects(reserveOp(g, 'x1'), (e) => code(e) === 'quota-daily');
  t = new Date('2026-10-25T01:30:00Z'); // 02:30 CET (heure répétée) : même jour civil
  await assert.rejects(reserveOp(g, 'x2'), (e) => code(e) === 'quota-daily');
  t = new Date('2026-10-25T23:00:00Z'); // 00:00 CET le 26
  await reserveOp(g, 'x3');
});

test('changement de mois Europe/Paris : 31/10 23:59 refusé, 01/11 00:00 accepté', async () => {
  const initial: LedgerState = { ...emptyState(), quotas: { daily: {}, monthly: { 'operational|2026-10': 500 }, runs: {}, phases: {} } };
  let t = new Date('2026-10-31T22:59:00Z'); // 23:59 CET le 31 octobre
  const g = new BudgetGuard(new MemoryBudgetStore(initial), DEFAULT_LIMITS, undefined, () => t);
  await assert.rejects(reserveOp(g, 'm1'), (e) => code(e) === 'quota-monthly');
  t = new Date('2026-10-31T23:00:00Z'); // 00:00 le 1er novembre à Paris
  await reserveOp(g, 'm2');
});

test('redémarrage : les compteurs persistés ne sont jamais réinitialisés', async () => {
  const dir = await tmp();
  try {
    const path = join(dir, 'ledger.json');
    const g1 = new BudgetGuard(new FileBudgetStore(path), DEFAULT_LIMITS, undefined, at('2026-11-06T10:00:00Z'));
    for (let i = 0; i < 20; i++) await reserveOp(g1, `r${Math.floor(i / 10)}`, i);
    const g2 = new BudgetGuard(new FileBudgetStore(path), DEFAULT_LIMITS, undefined, at('2026-11-06T11:00:00Z')); // nouveau processus
    await assert.rejects(reserveOp(g2, 'apres-redemarrage'), (e) => code(e) === 'quota-daily');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ tentatives : ce qui compte
test('tentatives : timeout après envoi et refus 4xx comptent ; refus avant envoi ne compte pas', async () => {
  const quota = op('t');
  const count = async (g: BudgetGuard) => (await g.snapshot()).quotas.runs.t ?? 0;
  const g1 = new BudgetGuard(new MemoryBudgetStore(), { ...DEFAULT_LIMITS, blockWhenUncertain: false });
  await analyzePublication(pub({ id: 'a' }), { adapter: new MockAdapter(() => Promise.reject(new ProviderError('timeout', 'délai', true))), guard: g1, scope: 'operational', quota });
  assert.equal(await count(g1), 1, 'timeout après envoi : compté (coût incertain)');
  await analyzePublication(pub({ id: 'b' }), { adapter: new MockAdapter(() => Promise.reject(new ProviderError('rate-limit', 'HTTP 429', false, null, true))), guard: g1, scope: 'operational', quota });
  assert.equal(await count(g1), 2, 'refus 4xx transmis : compté, non facturé');
  await analyzePublication(pub({ id: 'c' }), { adapter: new MockAdapter(() => Promise.reject(new ProviderError('auth', 'clé absente', false))), guard: g1, scope: 'operational', quota });
  assert.equal(await count(g1), 2, 'refus avant envoi : décompté');
});

// ------------------------------------------------------------------ contournements
test('contournements : identifiants d’exécution multiples, adaptateur réel sans quota, réservation sans quota', async () => {
  const g = new BudgetGuard(new MemoryBudgetStore(), DEFAULT_LIMITS, undefined, at('2026-11-06T10:00:00Z'));
  for (let i = 0; i < 20; i++) await reserveOp(g, `run-unique-${i}`, i); // une exécution par appel
  await assert.rejects(reserveOp(g, 'encore-une'), (e) => code(e) === 'quota-daily', 'multiplier les exécutions ne contourne pas le quota quotidien');
  const real = await analyzePublication(pub(), { adapter: new AnthropicAdapter(MODELS['anthropic-haiku-5-5']), guard: new BudgetGuard(new MemoryBudgetStore()) });
  assert.equal(real.status, 'refused-quota', 'un adaptateur réel exige un contexte de quota');
});

test('dépassement : publications non traitées conservées en attente, ni analysées ni relancées ; reprise le lendemain', async () => {
  let t = new Date('2026-11-06T10:00:00Z');
  const g = new BudgetGuard(new MemoryBudgetStore(), DEFAULT_LIMITS, undefined, () => t);
  const items = Array.from({ length: 25 }, (_, i) => pub({ id: `p${i}`, url: `https://example.invalid/dunggle-fixtures/p${i}`, publishedAt: '2026-11-05T08:00:00Z' }));
  const adapter = new MockAdapter(() => ({ rawText: mockOutput(), usage: { inputTokens: 500, outputTokens: 50 }, stopReason: 'end_turn' }));
  const statuses: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const r = await analyzePublication(items[i], { adapter, guard: g, scope: 'operational', quota: op(`run-${Math.floor(i / 10)}`) });
    statuses.push(r.status);
  }
  assert.equal(statuses.filter((s) => s === 'analyzed').length, 20);
  assert.equal(statuses.filter((s) => s === 'refused-quota').length, 5);
  assert.equal(adapter.calls.length, 20, 'aucune relance automatique');
  const pendingToday = selectPending(items, await g.snapshot(), 'mock-cheap', t);
  assert.equal(pendingToday.queue.length, 5, 'les 5 restent en attente (non marquées analysées)');
  t = new Date('2026-11-06T23:30:00Z'); // lendemain à Paris
  for (const p of pendingToday.queue) assert.equal((await analyzePublication(p, { adapter, guard: g, scope: 'operational', quota: op('run-j2') })).status, 'analyzed');
  assert.equal(selectPending(items, await g.snapshot(), 'mock-cheap', t).queue.length, 0);
});

test('file d’attente : couverture obligatoire en premier, expiration après 14 jours, plafond de 100', () => {
  const now = new Date('2026-11-06T10:00:00Z');
  const old = pub({ id: 'old', url: 'https://example.invalid/o', publishedAt: '2026-10-01T00:00:00Z' });
  const angular = { ...evaluationSet.items.find((p) => p.sourceId === 'gh-angular')!, publishedAt: '2026-11-01T00:00:00Z' };
  const recent = pub({ id: 'recent', url: 'https://example.invalid/r', publishedAt: '2026-11-05T00:00:00Z' });
  const sel = selectPending([recent, old, angular], null, 'mock-cheap', now);
  assert.equal(sel.queue[0].id, angular.id, 'couverture obligatoire en premier');
  assert.deepEqual(sel.expired.map((p) => p.id), ['old']);
  const many = Array.from({ length: 130 }, (_, i) => pub({ id: `m${i}`, url: `https://example.invalid/m${i}`, publishedAt: '2026-11-05T00:00:00Z' }));
  const s2 = selectPending(many, null, 'mock-cheap', now);
  assert.equal(s2.queue.length, PENDING_POLICY.maxBacklog);
  assert.equal(s2.deferred.length, 30);
});

// ------------------------------------------------------------------ POC : règles distinctes
test('POC B.1 : un appel par modèle, deux au total ; B.1 non rejouable ; B.2 non remis à zéro', async () => {
  const g = new BudgetGuard(new MemoryBudgetStore());
  const q = { scope: 'trial' as const, phase: 'B1' as const, runId: 'b1' };
  await g.reserve({ modelKey: 'anthropic-haiku-5-5', inputTokensEstimate: 1000, quota: q });
  await assert.rejects(g.reserve({ modelKey: 'anthropic-haiku-5-5', inputTokensEstimate: 1000, quota: q }), (e) => code(e) === 'quota-phase-model');
  await g.reserve({ modelKey: 'openai-gpt-6-luna', inputTokensEstimate: 1000, quota: q });
  await assert.rejects(g.reserve({ modelKey: 'openai-gpt-6-luna', inputTokensEstimate: 1000, quota: { ...q, runId: 'b1-bis' } }), (e) => ['quota-phase-total', 'quota-phase-model'].includes(code(e)));
  const s = await g.snapshot();
  assert.equal(s.quotas.phases.B1.total, 2);
  // B.1 terminé : le plan smoke ne propose plus rien
  assert.equal(planRun(parseArgs(['--mode=smoke']), evaluationSet.items, g, s).calls.length, 0);
  // B.2 : quota de phase propre (37/modèle, 74 au total), budget d'essai cumulé conservé
  const plan2 = planRun(parseArgs(['--mode=full']), evaluationSet.items, g, s);
  assert.equal(plan2.phase, 'B2');
  assert.ok(plan2.calls.length <= POC_PHASES.B2.totalMax);
  for (const m of MODELS2) assert.ok(plan2.calls.filter((c) => c.modelKey === m).length <= POC_PHASES.B2.perModelMax);
  assert.ok(s.trial.reservedEur > 0, 'budget d’essai cumulé, jamais remis à zéro');
});

test('POC B.2 : la fixture déjà analysée en B.1 n’est pas refacturée (36 nouveaux appels par modèle)', async () => {
  const g = new BudgetGuard(new MemoryBudgetStore());
  const adapter = new MockAdapter(() => ({ rawText: mockOutput(), usage: { inputTokens: 500, outputTokens: 50 }, stopReason: 'end_turn' }), MODELS['anthropic-haiku-5-5']);
  await analyzePublication(evaluationSet.items.find((p) => p.id === 'synthetic:orion-multimodal')!, { adapter, guard: g, quota: { scope: 'trial', phase: 'B1', runId: 'b1' } });
  const plan2 = planRun(parseArgs(['--mode=full', '--model=anthropic-haiku-5-5']), evaluationSet.items, g, await g.snapshot());
  assert.equal(plan2.calls.length, 36);
  assert.ok(plan2.skipped.some((s) => s.key.includes('orion') && /completed/.test(s.reason)));
});

// ------------------------------------------------------------------ activation locale à usage unique
test('activation : phrase de confirmation exacte, usage unique, expiration, correspondance stricte', async () => {
  const dir = `${await tmp()}/`;
  try {
    const models = ['anthropic-haiku-5-5'];
    await assert.rejects(createGrant({ phase: 'B1', models, maxEur: 0.002, confirm: 'oui' }, dir), ActivationError);
    await assert.rejects(createGrant({ phase: 'B1', models, maxEur: 0.9, confirm: confirmationPhrase('B1', 0.9) }, dir), ActivationError);
    await createGrant({ phase: 'B1', models, maxEur: 0.002, confirm: confirmationPhrase('B1', 0.002) }, dir);
    await assert.rejects(createGrant({ phase: 'B1', models, maxEur: 0.002, confirm: confirmationPhrase('B1', 0.002) }, dir), /existe déjà/);
    const act = await consumeGrant(dir, { phase: 'B1', models, maxEur: 0.002 });
    assert.equal(act.phase, 'B1');
    await assert.rejects(access(`${dir}real-call-grant.json`), 'autorisation consommée : plus aucun fichier actif');
    await assert.rejects(consumeGrant(dir, { phase: 'B1', models, maxEur: 0.002 }), /Aucune autorisation/, 'réutilisation impossible');
    // Expirée
    const t0 = new Date('2026-11-06T10:00:00Z');
    await createGrant({ phase: 'B1', models, maxEur: 0.002, confirm: confirmationPhrase('B1', 0.002) }, dir, t0);
    await assert.rejects(consumeGrant(dir, { phase: 'B1', models, maxEur: 0.002 }, new Date(t0.getTime() + GRANT_TTL_MS + 1)), /expirée/);
    // Phase, modèles ou montant non couverts : refusée ET détruite
    for (const exp of [{ phase: 'B2' as const, models, maxEur: 0.002 }, { phase: 'B1' as const, models: ['openai-gpt-6-luna'], maxEur: 0.002 }, { phase: 'B1' as const, models, maxEur: 0.01 }]) {
      await createGrant({ phase: 'B1', models, maxEur: 0.002, confirm: confirmationPhrase('B1', 0.002) }, dir);
      await assert.rejects(consumeGrant(dir, exp), /refusée/);
      await assert.rejects(access(`${dir}real-call-grant.json`));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
