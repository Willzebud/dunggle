/**
 * Clôture du POC 2 (2026-11-07) : les phases B1, B2 et B3 sont FERMÉES dans la configuration versionnée.
 * Ces tests utilisent la configuration PAR DÉFAUT (aucune table injectée) : aucune réservation, aucune autorisation
 * locale et aucune exécution réelle ne sont possibles, quel que soit le montant ou la phrase de confirmation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetGuard, BudgetRefusedError } from '../src/budget/guard.js';
import { MemoryBudgetStore } from '../src/budget/store.js';
import { POC_PHASES, PRODUCTION_QUOTAS, type PocPhase } from '../src/config/quotas.js';
import { ActivationError, confirmationPhrase, createGrant } from '../src/security/activation.js';
import { parseArgs } from '../src/runner/args.js';
import { planRun } from '../src/runner/plan.js';
import { realRunBlockers } from '../src/runner/run.js';
import { forbidNetwork, evaluationSet } from './helpers.js';

forbidNetwork();
const PHASES: PocPhase[] = ['B1', 'B2', 'B3'];
const MODELS = ['anthropic-haiku-5-5', 'openai-gpt-6-luna'];

test('Configuration versionnée : B1, B2 et B3 fermées (active: false), plafonds historiques et quotas de production inchangés', () => {
  assert.deepEqual(PHASES.map((p) => POC_PHASES[p].active), [false, false, false]);
  assert.deepEqual(PHASES.map((p) => [POC_PHASES[p].perModelMax, POC_PHASES[p].totalMax]), [[1, 2], [37, 74], [15, 30]]);
  assert.ok(Object.isFrozen(POC_PHASES) && PHASES.every((p) => Object.isFrozen(POC_PHASES[p])));
  assert.deepEqual({ ...PRODUCTION_QUOTAS }, { dailyMax: 20, monthlyMax: 500, perRunMax: 10 });
});

test('Garde budgétaire par défaut : toute réservation de phase POC refusée (quota-phase-inactive) avant tout engagement', async () => {
  const store = new MemoryBudgetStore();
  const g = new BudgetGuard(store);
  for (const phase of PHASES) {
    for (const modelKey of MODELS) {
      await assert.rejects(
        g.reserve({ modelKey, inputTokensEstimate: 1000, idempotencyKey: `${modelKey}|closed:${phase}|v`, quota: { scope: 'trial', phase, runId: `closed-${phase}` } }),
        (e: unknown) => e instanceof BudgetRefusedError && e.code === 'quota-phase-inactive',
      );
    }
  }
  const s = await store.read();
  assert.equal(Object.keys(s.reservations).length, 0, 'aucune réservation créée');
  assert.equal(s.trial.reservedEur, 0);
});

test('Autorisation locale par défaut : refusée pour chaque phase, même avec la phrase exacte ; aucun fichier écrit', async () => {
  const dir = `${await mkdtemp(join(tmpdir(), 'dunggle-closed-'))}/`;
  for (const phase of PHASES) {
    await assert.rejects(
      createGrant({ phase, models: MODELS, maxEur: 0.06, confirm: confirmationPhrase(phase, 0.06) }, dir),
      (e: unknown) => e instanceof ActivationError && new RegExp(`Phase ${phase} inactive`).test((e as Error).message),
    );
  }
  assert.deepEqual(await readdir(dir), []);
});

test('Exécution réelle par défaut : bloquée pour les trois modes (smoke, full, final)', async () => {
  for (const [mode, phase] of [['smoke', 'B1'], ['full', 'B2'], ['final', 'B3']] as const) {
    const g = new BudgetGuard(new MemoryBudgetStore());
    const plan = planRun(parseArgs([`--mode=${mode}`, '--dry-run']), evaluationSet.items, g, null);
    const real = parseArgs([`--mode=${mode}`, '--real', `--confirm-max-eur=${plan.totalMaxEur}`]);
    const blockers = await realRunBlockers(real, plan, { guard: g, adapterFor: () => { throw new Error('jamais appelé'); }, env: {} });
    assert.ok(blockers.some((b) => new RegExp(`Phase ${phase} inactive`).test(b)), `${mode} : ${blockers.join(' | ')}`);
  }
});
