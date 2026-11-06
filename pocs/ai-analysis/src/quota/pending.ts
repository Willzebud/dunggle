import { PENDING_POLICY } from '../config/quotas.js';
import { coverageFor } from '../config/coverage.js';
import type { LedgerState } from '../budget/store.js';
import { analysisKey } from '../pipeline.js';
import type { PublicationInput } from '../types.js';

export interface PendingSelection {
  /** Publications à proposer à l'IA, dans l'ordre (couverture obligatoire, puis les plus récentes). */
  queue: PublicationInput[];
  /** Trop anciennes : restent visibles sans analyse IA ; jamais relancées automatiquement. */
  expired: PublicationInput[];
  /** Au-delà du plafond de file : conservées pour un cycle ultérieur, non marquées comme analysées. */
  deferred: PublicationInput[];
}

/**
 * Sélection des publications en attente pour un modèle (production). Une publication est « en attente »
 * tant qu'aucune analyse (terminée, incertaine ou en cours) n'existe dans le registre : un refus de quota
 * ne crée aucune entrée, donc la publication reste candidate au cycle suivant, sans relance automatique.
 */
export function selectPending(items: PublicationInput[], ledger: LedgerState | null, modelKey: string, now: Date, policy = PENDING_POLICY): PendingSelection {
  const minTime = now.getTime() - policy.maxAgeDays * 86_400_000;
  const pending = items.filter((p) => !ledger?.analyses?.[analysisKey(modelKey, p.id)]);
  const expired = pending.filter((p) => p.publishedAt !== null && Date.parse(p.publishedAt) < minTime);
  const fresh = pending
    .filter((p) => !expired.includes(p))
    .sort((a, b) => {
      const ma = coverageFor(a.sourceId) === 'mandatory' ? 0 : 1;
      const mb = coverageFor(b.sourceId) === 'mandatory' ? 0 : 1;
      return ma - mb || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '');
    });
  return { queue: fresh.slice(0, policy.maxBacklog), expired, deferred: fresh.slice(policy.maxBacklog) };
}
