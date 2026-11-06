import type { BudgetGuard } from '../budget/guard.js';
import type { LedgerState } from '../budget/store.js';
import { resolveInput } from '../content-policy.js';
import { isEligible } from '../evaluation/dataset.js';
import { analysisKey } from '../pipeline.js';
import { buildPrompt } from '../prompt.js';
import type { PublicationInput } from '../types.js';
import type { RunArgs } from './args.js';
import { POC_PHASES, phaseForMode, phaseModelMax, phaseTotalMax, type PocPhase } from '../config/quotas.js';

/** Fixture synthétique FULL commune aux deux smoke tests (contenu rédigé pour le POC, aucun texte tiers). */
export const SMOKE_FIXTURE_ID = 'synthetic:orion-multimodal';

/** Plafonds d'appels par modèle et par exécution, issus des quotas de phase du POC (non relevables par argument). */
export const RUN_CALL_LIMITS = { smoke: POC_PHASES.B1.perModelMax, full: POC_PHASES.B2.perModelMax } as const;

export interface PlannedCall {
  modelKey: string;
  publication: PublicationInput;
  key: string;
  inputTokensUpperBound: number;
  maxCostEur: number;
}

export interface RunPlan {
  mode: RunArgs['mode'];
  phase: PocPhase;
  calls: PlannedCall[];
  skipped: { key: string; reason: string }[];
  maxCalls: number;
  totalMaxEur: number;
  duplicatesRemoved: number;
}

/**
 * Plan d'exécution SANS effet de bord : publications dédupliquées, analyses déjà enregistrées dans le
 * registre (terminées, incertaines ou en cours) écartées, plafond d'appels appliqué, coût maximal calculé.
 */
export function planRun(args: RunArgs, items: PublicationInput[], guard: BudgetGuard, ledger: LedgerState | null): RunPlan {
  const source = args.mode === 'smoke' ? items.filter((p) => p.id === SMOKE_FIXTURE_ID) : items.filter(isEligible);
  if (args.mode === 'smoke' && source.length !== 1) throw new Error(`Fixture de smoke test introuvable : ${SMOKE_FIXTURE_ID}`);
  // Déduplication : même identifiant ou même URL → une seule analyse.
  const seen = new Set<string>();
  const unique = source.filter((p) => {
    const k = `${p.id}|${p.url}`;
    if (seen.has(p.id) || seen.has(p.url)) return false;
    seen.add(p.id).add(p.url);
    return !!k;
  });
  const phase = phaseForMode(args.mode);
  const P = POC_PHASES[phase];
  const used = ledger?.quotas?.phases?.[phase];
  const perModel = Math.min(args.maxCalls ?? RUN_CALL_LIMITS[args.mode], RUN_CALL_LIMITS[args.mode]);
  let phaseRemaining = phaseTotalMax(phase) - (used?.total ?? 0);
  const perModelCalls = new Map<string, PlannedCall[]>();
  const skipped: RunPlan['skipped'] = [];
  for (const modelKey of args.models) {
    let n = 0;
    // Quota de phase cumulatif (jamais remis à zéro) : appels déjà tentés pour ce modèle.
    const modelRemaining = phaseModelMax(phase, modelKey) - (used?.perModel?.[modelKey] ?? 0);
    for (const p of unique) {
      const key = analysisKey(modelKey, p.id);
      const prev = ledger?.analyses?.[key];
      if (prev) {
        skipped.push({ key, reason: `déjà ${prev.status} (non refacturé)` });
        continue;
      }
      if (n >= perModel || n >= modelRemaining || phaseRemaining <= 0) {
        skipped.push({ key, reason: n >= modelRemaining || phaseRemaining <= 0 ? `quota de la phase ${phase} épuisé (en attente, non analysée)` : `plafond d’appels de l’exécution atteint (${perModel} par modèle)` });
        continue;
      }
      const bound = buildPrompt(p, resolveInput(p)).inputTokensUpperBound;
      if (!perModelCalls.has(modelKey)) perModelCalls.set(modelKey, []);
      perModelCalls.get(modelKey)!.push({ modelKey, publication: p, key, inputTokensUpperBound: bound, maxCostEur: guard.estimateMaxCostEur(modelKey, bound) });
      n++;
      phaseRemaining--;
    }
  }
  // Ordre alterné entre modèles (H, L, H, L…) : les appels Anthropic s'intercalent pendant l'attente imposée
  // par la limite OpenAI (1 requête/minute), et une interruption laisse les deux modèles à un avancement comparable.
  const queues = [...perModelCalls.values()];
  const calls: PlannedCall[] = [];
  for (let i = 0; queues.some((q) => i < q.length); i++) for (const q of queues) if (i < q.length) calls.push(q[i]);
  const totalMaxEur = Math.round(calls.reduce((s, c) => s + c.maxCostEur, 0) * 1e6) / 1e6;
  return { mode: args.mode, phase, calls, skipped, maxCalls: Math.min(perModel * args.models.length, P.totalMax), totalMaxEur, duplicatesRemoved: source.length - unique.length };
}
