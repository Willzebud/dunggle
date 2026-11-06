import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { forbidNetwork } from './helpers.js';
import { BudgetGuard, BudgetRefusedError, MemoryUsageLogger, JsonlUsageLogger } from '../src/budget/guard.js';
import { FileBudgetStore, MemoryBudgetStore } from '../src/budget/store.js';
import { DEFAULT_LIMITS, type BudgetLimits } from '../src/config/budget.js';

before(forbidNetwork);

const limits = (over: Partial<BudgetLimits> = {}): BudgetLimits => ({ ...DEFAULT_LIMITS, ...over });
const fixedNow = () => new Date('2026-11-06T10:00:00.000Z');
const code = (e: unknown) => (e as BudgetRefusedError).code;

test('budget : estimation prudente = (entrée + sortie max) × marge × taux, tarif vérifié Haiku 5.5', () => {
  const g = new BudgetGuard(new MemoryBudgetStore(), limits(), undefined, fixedNow);
  // (3000 × 0,10 + 800 × 0,50) / 1e6 = 0,0007 $ ; × 1,25 × 1,00 = 0,000875 €
  assert.equal(g.estimateMaxCostEur('anthropic-haiku-5-5', 3000, 800), 0.000875);
  // gpt-6-luna : entrée au pire cas d'écriture en cache (1,25×) : (3000 × 0,125 + 800 × 0,50)/1e6 × 1,25
  assert.equal(g.estimateMaxCostEur('openai-gpt-6-luna', 3000, 800), 0.000969);
});

test('budget : tarif inconnu → refus avant tout appel', async () => {
  const g = new BudgetGuard(new MemoryBudgetStore(), limits(), undefined, fixedNow);
  await assert.rejects(g.reserve({ modelKey: 'mock-unpriced', inputTokensEstimate: 100 }), (e) => code(e) === 'unknown-pricing');
  await assert.rejects(g.reserve({ modelKey: 'modele-invente', inputTokensEstimate: 100 }), (e) => code(e) === 'unknown-pricing');
});

test('budget : requête trop grande refusée (pas de troncature silencieuse)', async () => {
  const g = new BudgetGuard(new MemoryBudgetStore(), limits(), undefined, fixedNow);
  await assert.rejects(g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 16001 }), (e) => code(e) === 'request-too-large');
  await assert.rejects(g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 10, maxOutputTokens: 801 }), (e) => code(e) === 'request-too-large');
});

test('budget : limites incohérentes refusées', () => {
  assert.throws(() => new BudgetGuard(new MemoryBudgetStore(), limits({ monthlyOperationalCapEur: 12 })), (e) => code(e) === 'invalid-limits');
  assert.throws(() => new BudgetGuard(new MemoryBudgetStore(), limits({ trialTotalCapEur: 9 })), (e) => code(e) === 'invalid-limits');
});

test('budget : refus AVANT dépassement du budget d’essai (0,50 €)', async () => {
  const g = new BudgetGuard(new MemoryBudgetStore(), limits({ trialTotalCapEur: 0.01 }), undefined, fixedNow);
  // mock-cheap : (100 × 1 + 800 × 5)/1e6 × 1,25 = 0,005125 € par requête
  await g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 100 });
  await assert.rejects(g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 100 }), (e) => code(e) === 'trial-cap');
  const s = await g.snapshot();
  assert.ok(s.trial.reservedEur <= 0.01);
});

test('budget : plafond opérationnel mensuel et maximum absolu', async () => {
  const g = new BudgetGuard(new MemoryBudgetStore(), limits({ monthlyOperationalCapEur: 0.006, monthlyHardCapEur: 0.006, trialTotalCapEur: 0 }), undefined, fixedNow);
  await g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 100, scope: 'operational' });
  await assert.rejects(g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 100, scope: 'operational' }), (e) => ['monthly-operational', 'monthly-hard'].includes(code(e)));
});

test('budget : quota quotidien d’analyses', async () => {
  const g = new BudgetGuard(new MemoryBudgetStore(), limits({ dailyMaxAnalyses: 2 }), undefined, fixedNow);
  await g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 10 });
  await g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 10 });
  await assert.rejects(g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 10 }), (e) => code(e) === 'daily-limit');
});

test('budget : réconciliation avec l’usage réel, libération et coût incertain', async () => {
  const log = new MemoryUsageLogger();
  const g = new BudgetGuard(new MemoryBudgetStore(), limits(), log, fixedNow);
  const r1 = await g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 1000 });
  const actual = await g.reconcile(r1.id, { inputTokens: 900, outputTokens: 100 });
  assert.equal(actual, 0.0014); // (900 × 1 + 100 × 5)/1e6
  const r2 = await g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 1000 });
  assert.equal(await g.markUncertain(r2.id, 'timeout'), r2.estimatedMaxEur);
  const r3 = await g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 1000 });
  await g.release(r3.id, 'non envoyé');
  const s = await g.snapshot();
  const m = s.months['2026-11'];
  assert.equal(m.reservedEur, 0);
  assert.equal(m.spentEur, Math.round((0.0014 + r2.estimatedMaxEur) * 1e6) / 1e6);
  assert.equal(m.uncertainEur, r2.estimatedMaxEur);
  assert.equal(s.days['2026-11-06'].analyses, 2, 'la requête libérée ne compte pas dans le quota');
  await assert.rejects(g.reconcile(r1.id, { inputTokens: 1, outputTokens: 1 }), (e) => code(e) === 'unknown-reservation', 'double réconciliation refusée');
  assert.deepEqual(log.events.map((e) => e.event), ['reserved', 'reconciled', 'reserved', 'uncertain', 'reserved', 'released']);
});

test('budget : coût réel supérieur à l’estimation → enregistré et signalé', async () => {
  const log = new MemoryUsageLogger();
  const g = new BudgetGuard(new MemoryBudgetStore(), limits(), log, fixedNow);
  const r = await g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 10, maxOutputTokens: 10 });
  const actual = await g.reconcile(r.id, { inputTokens: 5000, outputTokens: 2000 });
  assert.ok(actual > r.estimatedMaxEur);
  assert.ok(log.events.some((e) => e.code === 'actual-exceeds-estimate'));
  assert.equal((await g.snapshot()).months['2026-11'].spentEur, actual);
});

test('budget : réservations orphelines facturées au maximum', async () => {
  let now = new Date('2026-11-06T10:00:00.000Z');
  const g = new BudgetGuard(new MemoryBudgetStore(), limits(), undefined, () => now);
  const r = await g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 10 });
  now = new Date('2026-11-06T11:00:00.000Z');
  assert.deepEqual(await g.expireStale(30 * 60_000), [r.id]);
  assert.equal((await g.snapshot()).months['2026-11'].uncertainEur, r.estimatedMaxEur);
});

test('concurrence (mémoire) : 100 réservations simultanées ne dépassent jamais le plafond', async () => {
  const cap = 0.05;
  const g = new BudgetGuard(new MemoryBudgetStore(), limits({ trialTotalCapEur: cap }), undefined, fixedNow);
  const results = await Promise.allSettled(Array.from({ length: 100 }, () => g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 100 })));
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const per = 0.005125;
  assert.equal(ok, Math.floor(cap / per)); // 9
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => code((r as PromiseRejectedResult).reason) === 'trial-cap'));
  assert.ok((await g.snapshot()).trial.reservedEur <= cap);
});

test('concurrence (fichier) : deux gardes sur le même registre ne dépassent pas le plafond', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dunggle-budget-'));
  try {
    const path = join(dir, 'ledger.json');
    const cap = 0.03;
    const a = new BudgetGuard(new FileBudgetStore(path), limits({ trialTotalCapEur: cap }), undefined, fixedNow);
    const b = new BudgetGuard(new FileBudgetStore(path), limits({ trialTotalCapEur: cap }), undefined, fixedNow);
    const results = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => (i % 2 ? a : b).reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 100 })));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, Math.floor(cap / 0.005125)); // 5
    const state = JSON.parse(await readFile(path, 'utf8'));
    assert.ok(state.trial.reservedEur <= cap);
    assert.equal(Object.keys(state.reservations).length, 5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('concurrence (processus distincts) : le verrou fichier protège entre processus', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dunggle-budget-'));
  try {
    const path = join(dir, 'ledger.json');
    const worker = new URL('./budget-worker.ts', import.meta.url).pathname;
    const run = () =>
      new Promise<number>((resolve, reject) => {
        const p = spawn(process.execPath, ['--import', 'tsx', worker, path], { stdio: ['ignore', 'pipe', 'inherit'] });
        let out = '';
        p.stdout.on('data', (d) => (out += d));
        p.on('exit', (c) => (c === 0 ? resolve(Number(out.trim())) : reject(new Error(`worker ${c}`))));
      });
    const counts = await Promise.all([run(), run(), run()]);
    const total = counts.reduce((s, n) => s + n, 0);
    assert.equal(total, Math.floor(0.03 / 0.005125)); // 5 au total, quel que soit l'entrelacement
    const state = JSON.parse(await readFile(path, 'utf8'));
    assert.ok(state.trial.reservedEur <= 0.03);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('journal : JSON Lines sans contenu de publication ni clé', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dunggle-log-'));
  try {
    const path = join(dir, 'usage.jsonl');
    const g = new BudgetGuard(new MemoryBudgetStore(), limits(), new JsonlUsageLogger(path), fixedNow);
    const r = await g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 10 });
    await g.reconcile(r.id, { inputTokens: 10, outputTokens: 10 });
    const lines = (await readFile(path, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.event), ['reserved', 'reconciled']);
    assert.ok(lines.every((l) => !('text' in l) && !('apiKey' in l)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
