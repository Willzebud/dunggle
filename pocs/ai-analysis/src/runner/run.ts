import type { BudgetGuard } from '../budget/guard.js';
import type { AIAdapter } from '../adapters/types.js';
import { apiKeyConfigured } from '../adapters/real.js';
import { MODELS } from '../config/models.js';
import { analyzePublication } from '../pipeline.js';
import type { AnalysisRecord } from '../types.js';
import type { RunArgs } from './args.js';
import type { RunPlan } from './plan.js';

export interface RunDeps {
  guard: BudgetGuard;
  adapterFor(modelKey: string): AIAdapter;
  /** Valeur de REAL_CALLS_ENABLED (injectée pour les tests avec fournisseurs simulés). */
  realCallsEnabled: boolean;
  env: NodeJS.ProcessEnv;
}

export interface RunReport {
  executed: boolean;
  blockers: string[];
  records: AnalysisRecord[];
  stoppedReason: string | null;
  spentEur: number;
}

/** Prérequis d'une exécution RÉELLE. Une seule non-conformité bloque tout, avant la moindre réservation. */
export async function realRunBlockers(args: RunArgs, plan: RunPlan, deps: RunDeps): Promise<string[]> {
  const b: string[] = [];
  if (!args.real) b.push('Mode simulation (--real absent)');
  if (!deps.realCallsEnabled) b.push('REAL_CALLS_ENABLED = false : activation par une modification de code revue (autorisation de B.1)');
  if (args.confirmMaxEur === null) b.push(`--confirm-max-eur absent (coût maximal du plan : ${plan.totalMaxEur} €)`);
  else if (args.confirmMaxEur < plan.totalMaxEur) b.push(`--confirm-max-eur=${args.confirmMaxEur} < coût maximal du plan (${plan.totalMaxEur} €)`);
  for (const k of new Set(plan.calls.map((c) => c.modelKey))) {
    const m = MODELS[k];
    if (!m || m.validation.status !== 'validated') b.push(`${k} : configuration non validée`);
    if (m && !apiKeyConfigured(m.provider === 'anthropic' ? 'anthropic' : 'openai', deps.env)) b.push(`${k} : clé API absente de l’environnement`);
    if (m && deps.adapterFor(k).model.key !== k) b.push(`${k} : adaptateur incohérent`);
  }
  const s = await deps.guard.snapshot();
  const uncertain = Object.keys(s.uncertain).length;
  if (uncertain) b.push(`${uncertain} coût(s) incertain(s) à réconcilier avant toute nouvelle dépense`);
  if (Object.keys(s.reservations).length) b.push(`${Object.keys(s.reservations).length} réservation(s) ouverte(s) : processus concurrent ou interrompu`);
  const remaining = deps.guard.limits.trialTotalCapEur - s.trial.spentEur - s.trial.reservedEur;
  if (remaining < plan.totalMaxEur) b.push(`Budget d’essai restant ${Math.max(0, remaining).toFixed(6)} € < coût maximal du plan ${plan.totalMaxEur} €`);
  if (plan.calls.length === 0) b.push('Aucun appel à effectuer (tout est déjà analysé ou plafonné)');
  return b;
}

/**
 * Exécution séquentielle (jamais concurrente). S'arrête immédiatement en cas d'incertitude financière,
 * de refus budgétaire, ou si la dépense de l'exécution atteint le montant confirmé.
 */
export async function executeRun(args: RunArgs, plan: RunPlan, deps: RunDeps): Promise<RunReport> {
  const blockers = await realRunBlockers(args, plan, deps);
  if (blockers.length) return { executed: false, blockers, records: [], stoppedReason: null, spentEur: 0 };
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
    const rec = await analyzePublication(call.publication, { adapter: deps.adapterFor(call.modelKey), guard: deps.guard, scope: 'trial' });
    records.push(rec);
    spent += rec.costEur ?? 0;
    if (rec.costUncertain) {
      stoppedReason = 'coût incertain : arrêt sécurisé (réconciliation manuelle requise)';
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
  return { executed: true, blockers: [], records, stoppedReason, spentEur: Math.round(spent * 1e6) / 1e6 };
}
