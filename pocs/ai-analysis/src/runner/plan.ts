import type { BudgetGuard } from '../budget/guard.js';
import type { LedgerState } from '../budget/store.js';
import { resolveInput } from '../content-policy.js';
import { isEligible } from '../evaluation/dataset.js';
import { analysisKey } from '../pipeline.js';
import { buildPrompt } from '../prompt.js';
import type { PublicationInput } from '../types.js';
import type { RunArgs } from './args.js';

/** Fixture synthétique FULL commune aux deux smoke tests (contenu rédigé pour le POC, aucun texte tiers). */
export const SMOKE_FIXTURE_ID = 'synthetic:orion-multimodal';

/** Plafonds d'appels par exécution, par modèle (non relevables par argument). */
export const RUN_CALL_LIMITS = { smoke: 1, full: 40 } as const;

export interface PlannedCall {
  modelKey: string;
  publication: PublicationInput;
  key: string;
  inputTokensUpperBound: number;
  maxCostEur: number;
}

export interface RunPlan {
  mode: RunArgs['mode'];
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
  const perModel = Math.min(args.maxCalls ?? RUN_CALL_LIMITS[args.mode], RUN_CALL_LIMITS[args.mode]);
  const calls: PlannedCall[] = [];
  const skipped: RunPlan['skipped'] = [];
  for (const modelKey of args.models) {
    let n = 0;
    for (const p of unique) {
      const key = analysisKey(modelKey, p.id);
      const prev = ledger?.analyses?.[key];
      if (prev) {
        skipped.push({ key, reason: `déjà ${prev.status} (non refacturé)` });
        continue;
      }
      if (n >= perModel) {
        skipped.push({ key, reason: `plafond d’appels de l’exécution atteint (${perModel} par modèle)` });
        continue;
      }
      const bound = buildPrompt(p, resolveInput(p)).inputTokensUpperBound;
      calls.push({ modelKey, publication: p, key, inputTokensUpperBound: bound, maxCostEur: guard.estimateMaxCostEur(modelKey, bound) });
      n++;
    }
  }
  const totalMaxEur = Math.round(calls.reduce((s, c) => s + c.maxCostEur, 0) * 1e6) / 1e6;
  return { mode: args.mode, calls, skipped, maxCalls: perModel * args.models.length, totalMaxEur, duplicatesRemoved: source.length - unique.length };
}
