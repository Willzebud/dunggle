import { randomUUID } from 'node:crypto';
import type { BudgetGuard } from '../budget/guard.js';
import type { AIAdapter } from '../adapters/types.js';
import { apiKeyConfigured } from '../adapters/real.js';
import { MODELS } from '../config/models.js';
import { POC_PHASES } from '../config/quotas.js';
import { analyzePublication } from '../pipeline.js';
import { activationAllows, type RealCallActivation } from '../security/activation.js';
import type { AnalysisRecord } from '../types.js';
import type { RunArgs } from './args.js';
import type { RunPlan } from './plan.js';

export interface RunDeps {
  guard: BudgetGuard;
  adapterFor(modelKey: string): AIAdapter;
  /** Activation en mémoire issue d'une autorisation locale consommée (null : aucun appel réel possible). */
  activation: RealCallActivation | null;
  env: NodeJS.ProcessEnv;
}

export interface RunReport {
  executed: boolean;
  blockers: string[];
  records: AnalysisRecord[];
  stoppedReason: string | null;
  spentEur: number;
  runId: string | null;
}

/**
 * Prérequis d'une exécution RÉELLE (hors activation, vérifiée à part). Une seule non-conformité bloque tout,
 * avant la moindre réservation : --real, montant confirmé, clés, modèles validés, quotas, budget, registre cohérent.
 */
export async function realRunBlockers(args: RunArgs, plan: RunPlan, deps: Omit<RunDeps, 'activation'>): Promise<string[]> {
  const b: string[] = [];
  if (!args.real) b.push('Mode simulation (--real absent)');
  if (args.confirmMaxEur === null) b.push(`--confirm-max-eur absent (coût maximal du plan : ${plan.totalMaxEur} €)`);
  else if (args.confirmMaxEur < plan.totalMaxEur) b.push(`--confirm-max-eur=${args.confirmMaxEur} < coût maximal du plan (${plan.totalMaxEur} €)`);
  for (const k of new Set(plan.calls.map((c) => c.modelKey))) {
    const m = MODELS[k];
    if (!m || m.validation.status !== 'validated') b.push(`${k} : configuration non validée`);
    if (m && !apiKeyConfigured(m.provider === 'anthropic' ? 'anthropic' : 'openai', deps.env)) b.push(`${k} : clé API absente de l’environnement`);
  }
  const s = await deps.guard.snapshot();
  const uncertain = Object.keys(s.uncertain).length;
  if (uncertain) b.push(`${uncertain} coût(s) incertain(s) à réconcilier avant toute nouvelle dépense`);
  if (Object.keys(s.reservations).length) b.push(`${Object.keys(s.reservations).length} réservation(s) ouverte(s) : processus concurrent ou interrompu`);
  const remaining = deps.guard.limits.trialTotalCapEur - s.trial.spentEur - s.trial.reservedEur;
  if (remaining < plan.totalMaxEur) b.push(`Budget d’essai restant ${Math.max(0, remaining).toFixed(6)} € < coût maximal du plan ${plan.totalMaxEur} €`);
  const P = POC_PHASES[plan.phase];
  const used = s.quotas?.phases?.[plan.phase]?.total ?? 0;
  if (used + plan.calls.length > P.totalMax) b.push(`Quota de la phase ${plan.phase} insuffisant (${used}/${P.totalMax} déjà utilisés)`);
  if (plan.calls.length === 0) b.push('Aucun appel à effectuer (déjà analysé, ou quota de phase épuisé)');
  return b;
}

/**
 * Exécution séquentielle (jamais concurrente), avec un identifiant d'exécution unique et le contexte de quota
 * de la phase. S'arrête immédiatement sur : incertitude financière, quota atteint, refus budgétaire,
 * erreur non transitoire, ou montant confirmé atteint.
 */
export async function executeRun(args: RunArgs, plan: RunPlan, deps: RunDeps): Promise<RunReport> {
  const blockers = await realRunBlockers(args, plan, deps);
  for (const k of new Set(plan.calls.map((c) => c.modelKey))) {
    const denied = activationAllows(deps.activation, k);
    if (denied) blockers.push(`${k} : ${denied}`);
  }
  if (deps.activation && deps.activation.phase !== plan.phase) blockers.push(`Activation délivrée pour ${deps.activation.phase}, plan ${plan.phase}`);
  if (deps.activation && args.confirmMaxEur !== null && args.confirmMaxEur > deps.activation.maxEur) blockers.push('Montant confirmé supérieur au montant autorisé');
  if (blockers.length) return { executed: false, blockers, records: [], stoppedReason: null, spentEur: 0, runId: null };
  const runId = randomUUID();
  const quota = { scope: 'trial' as const, phase: plan.phase, runId };
  const records: AnalysisRecord[] = [];
  let spent = 0;
  let stoppedReason: string | null = null;
  for (const call of plan.calls) {
    if (records.length >= plan.maxCalls) {
      stoppedReason = 'plafond d’appels de l’exécution atteint';
      break;
    }
    if (spent + call.maxCostEur > (args.confirmMaxEur ?? 0)) {
      stoppedReason = 'montant confirmé (--confirm-max-eur) atteint';
      break;
    }
    const rec = await analyzePublication(call.publication, { adapter: deps.adapterFor(call.modelKey), guard: deps.guard, scope: 'trial', quota });
    records.push(rec);
    spent += rec.costEur ?? 0;
    if (rec.costUncertain) {
      stoppedReason = 'coût incertain : arrêt sécurisé (réconciliation manuelle requise)';
      break;
    }
    if (rec.status === 'refused-quota') {
      stoppedReason = `quota atteint : ${rec.error} (publications restantes conservées en attente)`;
      break;
    }
    if (rec.status === 'refused-budget' || rec.status === 'refused-unknown-pricing') {
      stoppedReason = `refus budgétaire : ${rec.error}`;
      break;
    }
    if (rec.status === 'provider-error' && /auth|HTTP 4/.test(rec.error ?? '')) {
      stoppedReason = `erreur fournisseur non transitoire : ${rec.error}`;
      break;
    }
  }
  return { executed: true, blockers: [], records, stoppedReason, spentEur: Math.round(spent * 1e6) / 1e6, runId };
}
