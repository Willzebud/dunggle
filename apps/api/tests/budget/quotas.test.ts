/** Quotas de production (repris du POC 2) : 20/jour et 500/mois en Europe/Paris, 10 par exécution. Hors ligne. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { forbidNetwork, testGuard } from '../helpers.js';
import { BudgetGuard, BudgetRefusedError } from '../../src/budget/guard.js';
import { MemoryBudgetStore, emptyState, type LedgerState } from '../../src/budget/store.js';
import { PENDING_POLICY, PRODUCTION_QUOTAS } from '../../src/config/limits.js';
import { parisDay, parisMonth } from '../../src/budget/time.js';

before(forbidNetwork);
const code = (e: unknown) => (e as BudgetRefusedError).code;
let n = 0;
const reserveOp = (g: BudgetGuard, runId: string) => g.reserve({ modelKey: 'openai-gpt-6-luna', inputTokensEstimate: 1000, idempotencyKey: `q${++n}`, quota: { runId } });
const at = (iso: string) => () => new Date(iso);
const withMonthly = (k: string, v: number): LedgerState => ({ ...emptyState(), quotas: { daily: {}, monthly: { [k]: v }, runs: {} } });

test('quotas conservés et gelés : 20/jour, 500/mois, 10/exécution ; file d’attente 14 jours / 100', () => {
  assert.deepEqual({ ...PRODUCTION_QUOTAS }, { dailyMax: 20, monthlyMax: 500, perRunMax: 10 });
  assert.ok(Object.isFrozen(PRODUCTION_QUOTAS));
  assert.throws(() => ((PRODUCTION_QUOTAS as { dailyMax: number }).dailyMax = 1e6), TypeError);
  assert.deepEqual({ ...PENDING_POLICY }, { maxAgeDays: 14, maxBacklog: 100 });
});

test('21e appel quotidien refusé, même réparti sur plusieurs exécutions', async () => {
  const g = testGuard();
  for (let i = 0; i < 20; i++) await reserveOp(g, `run-${Math.floor(i / 10)}`);
  await assert.rejects(reserveOp(g, 'run-3'), (e) => code(e) === 'quota-daily');
  assert.equal((await g.snapshot()).quotas.daily['2026-11-06'], 20);
});

test('11e appel de la même exécution refusé ; une autre exécution reste possible', async () => {
  const g = testGuard();
  for (let i = 0; i < 10; i++) await reserveOp(g, 'run-A');
  await assert.rejects(reserveOp(g, 'run-A'), (e) => code(e) === 'quota-run');
  await reserveOp(g, 'run-B');
});

test('501e appel mensuel refusé (compteurs persistés)', async () => {
  await assert.rejects(reserveOp(testGuard({ store: new MemoryBudgetStore(withMonthly('2026-11', 500)), now: at('2026-11-20T10:00:00Z') }), 'r'), (e) => code(e) === 'quota-monthly');
  const g2 = testGuard({ store: new MemoryBudgetStore(withMonthly('2026-11', 499)), now: at('2026-11-20T10:00:00Z') });
  await reserveOp(g2, 'r');
  await assert.rejects(reserveOp(g2, 'r2'), (e) => code(e) === 'quota-monthly');
});

test('multiplier les identifiants d’exécution ne contourne pas le quota quotidien', async () => {
  const g = testGuard();
  for (let i = 0; i < 20; i++) await reserveOp(g, `run-unique-${i}`);
  await assert.rejects(reserveOp(g, 'encore-une'), (e) => code(e) === 'quota-daily');
});

test('concurrence (mémoire) : 30 réservations simultanées sur deux gardes partageant le registre → 20 au plus', async () => {
  const store = new MemoryBudgetStore();
  const g1 = testGuard({ store });
  const g2 = testGuard({ store });
  const res = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => reserveOp(i % 2 ? g1 : g2, `run-${i % 4}`)));
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 20);
});

test('tentatives : refus 4xx transmis compté ; refus avant envoi décompté ; coût incertain compté', async () => {
  const g = testGuard({ limits: { blockWhenUncertain: false } });
  const runs = async () => (await g.snapshot()).quotas.runs.t ?? 0;
  const a = await reserveOp(g, 't');
  await g.release(a.id, 'HTTP 429', { transmitted: true });
  assert.equal(await runs(), 1, 'refus du fournisseur : tentative comptée, non facturée');
  const b = await reserveOp(g, 't');
  await g.release(b.id, 'clé absente : refus avant envoi');
  assert.equal(await runs(), 1, 'refus avant envoi : décompté');
  const c = await reserveOp(g, 't');
  await g.markUncertain(c.id, 'délai dépassé');
  assert.equal(await runs(), 2, 'facturation incertaine : comptée');
});

test('Europe/Paris : clés de jour correctes, y compris aux changements d’heure', () => {
  assert.equal(parisDay(new Date('2026-11-05T22:59:00Z')), '2026-11-05');
  assert.equal(parisDay(new Date('2026-11-05T23:00:00Z')), '2026-11-06');
  assert.equal(parisDay(new Date('2026-03-28T23:00:00Z')), '2026-03-29');
  assert.equal(parisDay(new Date('2026-03-29T22:00:00Z')), '2026-03-30', 'le 29 mars ne dure que 23 heures');
  assert.equal(parisDay(new Date('2026-10-24T22:00:00Z')), '2026-10-25');
  assert.equal(parisDay(new Date('2026-10-25T22:59:00Z')), '2026-10-25', 'le 25 octobre dure 25 heures');
  assert.equal(parisDay(new Date('2026-10-25T23:00:00Z')), '2026-10-26');
  assert.equal(parisMonth(new Date('2026-10-31T23:00:00Z')), '2026-11');
});

test('changement de jour Europe/Paris : le quota repart à minuit Paris, pas à minuit UTC', async () => {
  let t = new Date('2026-11-05T22:00:00Z'); // 23:00 à Paris
  const g = testGuard({ now: () => t });
  for (let i = 0; i < 20; i++) await reserveOp(g, `r${Math.floor(i / 10)}`);
  t = new Date('2026-11-05T22:59:00Z');
  await assert.rejects(reserveOp(g, 'r9'), (e) => code(e) === 'quota-daily');
  t = new Date('2026-11-05T23:00:00Z'); // 00:00 Paris le 6
  await reserveOp(g, 'r10');
  for (let i = 0; i < 19; i++) await reserveOp(g, `r1${1 + Math.floor(i / 10)}`);
  t = new Date('2026-11-06T00:30:00Z'); // minuit UTC passé : toujours le 6 à Paris
  await assert.rejects(reserveOp(g, 'r20'), (e) => code(e) === 'quota-daily');
});

test('changement d’heure (25 octobre) : pas de remise à zéro pendant l’heure répétée', async () => {
  let t = new Date('2026-10-24T22:30:00Z');
  const g = testGuard({ now: () => t });
  for (let i = 0; i < 20; i++) await reserveOp(g, `r${Math.floor(i / 10)}`);
  t = new Date('2026-10-25T00:30:00Z');
  await assert.rejects(reserveOp(g, 'x1'), (e) => code(e) === 'quota-daily');
  t = new Date('2026-10-25T01:30:00Z');
  await assert.rejects(reserveOp(g, 'x2'), (e) => code(e) === 'quota-daily');
  t = new Date('2026-10-25T23:00:00Z');
  await reserveOp(g, 'x3');
});

test('changement de mois Europe/Paris : 31/10 23:59 refusé, 01/11 00:00 accepté', async () => {
  let t = new Date('2026-10-31T22:59:00Z');
  const g = testGuard({ store: new MemoryBudgetStore(withMonthly('2026-10', 500)), now: () => t });
  await assert.rejects(reserveOp(g, 'm1'), (e) => code(e) === 'quota-monthly');
  t = new Date('2026-10-31T23:00:00Z');
  await reserveOp(g, 'm2');
});

test('redémarrage : un nouveau garde sur le même registre ne réinitialise jamais les compteurs', async () => {
  const store = new MemoryBudgetStore();
  const g1 = testGuard({ store });
  for (let i = 0; i < 20; i++) await reserveOp(g1, `r${Math.floor(i / 10)}`);
  await assert.rejects(reserveOp(testGuard({ store, now: at('2026-11-06T11:00:00Z') }), 'apres-redemarrage'), (e) => code(e) === 'quota-daily');
});
