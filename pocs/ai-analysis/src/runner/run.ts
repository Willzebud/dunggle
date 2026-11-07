import { randomUUID } from 'node:crypto';
import type { BudgetGuard } from '../budget/guard.js';
import type { AIAdapter } from '../adapters/types.js';
import { apiKeyConfigured, apiKeyFormatProblem } from '../adapters/real.js';
import { MODELS } from '../config/models.js';
import { PROVIDER_MIN_GAP_AFTER_END_MS, phaseTotalMax } from '../config/quotas.js';
import { MemoryPacingStore, ProviderPacer, type Provider } from './pacing.js';
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
  /** Horloge et attente injectables (tests hors ligne). */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Interruption demandée (Ctrl+C) : l'exécution s'arrête proprement AVANT la réservation suivante. */
  shouldStop?: () => boolean;
  /** Temporisation par fournisseur ; réel : persistante (var/provider-pacing.json). Défaut : en mémoire. */
  pacer?: ProviderPacer;
}

const providerOf = (modelKey: string): Provider => (MODELS[modelKey]?.provider === 'anthropic' ? 'anthropic' : 'openai');

/** Attente interruptible (tranches d'au plus 1 s) ; renvoie false si une interruption a été demandée. */
async function waitUntil(t: number, now: () => number, sleep: (ms: number) => Promise<void>, shouldStop?: () => boolean): Promise<boolean> {
  while (now() < t) {
    if (shouldStop?.()) return false;
    await sleep(Math.min(1_000, t - now()));
  }
  return !shouldStop?.();
}

/** Hypothèses de durée par appel : régime typique observé en B.1 (quelques secondes) et pire cas (délai SDK). */
export const CALL_LATENCY_ASSUMPTIONS_MS = Object.freeze({ typical: 15_000, worst: 60_000 });

/**
 * Durée estimée d'une exécution : ordre réel des appels, délai minimal APRÈS LA FIN de la requête précédente du
 * même fournisseur, et contraintes déjà persistées (`initialEarliestMs` : délai avant la première requête possible).
 */
export function estimateRunDurationMs(plan: Pick<RunPlan, 'calls'>, latencyMs: number, initialEarliestMs: Partial<Record<Provider, number>> = {}): number {
  let t = 0;
  const earliest = new Map<Provider, number>(Object.entries(initialEarliestMs) as [Provider, number][]);
  for (const c of plan.calls) {
    const p = providerOf(c.modelKey);
    t = Math.max(t, earliest.get(p) ?? 0);
    t += latencyMs;
    earliest.set(p, t + PROVIDER_MIN_GAP_AFTER_END_MS[p]);
  }
  return t;
}

/** Délais restants (ms) avant la première requête possible par fournisseur, d'après l'état persistant. */
export async function pacingOffsets(pacer: ProviderPacer, now: number): Promise<Partial<Record<Provider, number>>> {
  const o: Partial<Record<Provider, number>> = {};
  for (const p of ['anthropic', 'openai'] as const) o[p] = Math.max(0, (await pacer.earliestStart(p)) - now);
  return o;
}

export interface RunReport {
  executed: boolean;
  blockers: string[];
  records: AnalysisRecord[];
  stoppedReason: string | null;
  spentEur: number;
  runId: string | null;
  /** Durée mesurée de chaque appel et de l'exécution (ms). */
  timings?: { modelKey: string; publicationId: string; ms: number }[];
  durationMs?: number;
}

/**
 * Prérequis d'une exécution RÉELLE (hors activation, vérifiée à part). Une seule non-conformité bloque tout,
 * avant la moindre réservation : --real, montant confirmé, clés, modèles validés, quotas, budget, registre cohérent.
 */
export async function realRunBlockers(args: RunArgs, plan: RunPlan, deps: Omit<RunDeps, 'activation'>): Promise<string[]> {
  const b: string[] = [];
  if (!args.real) b.push('Mode simulation (--real absent)');
  if (!deps.guard.phases[plan.phase]?.active) b.push(`Phase ${plan.phase} inactive : aucune réservation ni aucun appel possible avant son activation explicite`);
  if (args.confirmMaxEur === null) b.push(`--confirm-max-eur absent (coût maximal du plan : ${plan.totalMaxEur} €)`);
  else if (args.confirmMaxEur < plan.totalMaxEur) b.push(`--confirm-max-eur=${args.confirmMaxEur} < coût maximal du plan (${plan.totalMaxEur} €)`);
  for (const k of new Set(plan.calls.map((c) => c.modelKey))) {
    const m = MODELS[k];
    if (!m || m.validation.status !== 'validated') b.push(`${k} : configuration non validée`);
    const prov = m?.provider === 'anthropic' ? 'anthropic' : 'openai';
    if (m && !apiKeyConfigured(prov, deps.env)) b.push(`${k} : clé API absente de l’environnement`);
    const fmt = m ? apiKeyFormatProblem(prov, deps.env) : null;
    if (fmt) b.push(`${k} : ${fmt}`);
  }
  const s = await deps.guard.snapshot();
  const uncertain = Object.keys(s.uncertain).length;
  if (uncertain) b.push(`${uncertain} coût(s) incertain(s) à réconcilier avant toute nouvelle dépense`);
  if (Object.keys(s.reservations).length) b.push(`${Object.keys(s.reservations).length} réservation(s) ouverte(s) : processus concurrent ou interrompu`);
  const remaining = deps.guard.limits.trialTotalCapEur - s.trial.spentEur - s.trial.reservedEur;
  if (remaining < plan.totalMaxEur) b.push(`Budget d’essai restant ${Math.max(0, remaining).toFixed(6)} € < coût maximal du plan ${plan.totalMaxEur} €`);
  const totalMax = phaseTotalMax(plan.phase);
  const used = s.quotas?.phases?.[plan.phase]?.total ?? 0;
  if (used + plan.calls.length > totalMax) b.push(`Quota de la phase ${plan.phase} insuffisant (${used}/${totalMax} déjà utilisés)`);
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
  const pacer = deps.pacer ?? new ProviderPacer(new MemoryPacingStore());
  if (deps.activation) {
    const t0 = (deps.now ?? Date.now)();
    const remaining = deps.activation.validUntil - t0;
    const typical = estimateRunDurationMs(plan, CALL_LATENCY_ASSUMPTIONS_MS.typical, await pacingOffsets(pacer, t0));
    if (typical * 1.25 > remaining) blockers.push(`Durée estimée (${Math.round(typical / 60_000)} min, marge 25 %) supérieure à la validité restante de l’activation (${Math.round(remaining / 60_000)} min)`);
  }
  if (blockers.length) return { executed: false, blockers, records: [], stoppedReason: null, spentEur: 0, runId: null };
  const runId = randomUUID();
  const quota = { scope: 'trial' as const, phase: plan.phase, runId };
  const records: AnalysisRecord[] = [];
  let spent = 0;
  let stoppedReason: string | null = null;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timings: NonNullable<RunReport['timings']> = [];
  const startedAt = now();
  for (const call of plan.calls) {
    if (deps.shouldStop?.()) {
      stoppedReason = 'interruption demandée : arrêt avant la réservation suivante (reprise possible sans doublon)';
      break;
    }
    if (records.length >= plan.maxCalls) {
      stoppedReason = 'plafond d’appels de l’exécution atteint';
      break;
    }
    if (spent + call.maxCostEur > (args.confirmMaxEur ?? 0)) {
      stoppedReason = 'montant confirmé (--confirm-max-eur) atteint';
      break;
    }
    // Limites de débit fournisseur (OpenAI : 75 s après la fin de la précédente, Retry-After, état persistant) :
    // attente AVANT la réservation, interruptible par Ctrl+C sans laisser de réservation ouverte.
    const provider = providerOf(call.modelKey);
    if (!(await waitUntil(await pacer.earliestStart(provider), now, sleep, deps.shouldStop))) {
      stoppedReason = 'interruption demandée : arrêt avant la réservation suivante (reprise possible sans doublon)';
      break;
    }
    const t0 = now();
    const adapter = pacer.wrap(deps.adapterFor(call.modelKey), provider, now, sleep);
    const rec = await analyzePublication(call.publication, { adapter, guard: deps.guard, scope: 'trial', quota });
    timings.push({ modelKey: call.modelKey, publicationId: call.publication.id, ms: now() - t0 });
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
  return { executed: true, blockers: [], records, stoppedReason, spentEur: Math.round(spent * 1e6) / 1e6, runId, timings, durationMs: now() - startedAt };
}
