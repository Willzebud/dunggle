import { fileURLToPath } from 'node:url';
import { DEFAULT_LIMITS, type BudgetLimits } from '../config/budget.js';
import { BudgetGuard, JsonlUsageLogger } from './guard.js';
import { FileBudgetStore } from './store.js';

/** Dossier local ignoré par Git (état budgétaire, journal d'usage). */
export const VAR_DIR = fileURLToPath(new URL('../../var/', import.meta.url));

/**
 * Garde budgétaire PERSISTANTE à utiliser pour tout appel réel (phase B) : le registre survit aux
 * redémarrages et est partagé entre processus (verrou fichier). Le registre en mémoire est réservé aux tests.
 */
export function createPersistentGuard(limits: BudgetLimits = DEFAULT_LIMITS, dir = VAR_DIR): BudgetGuard {
  return new BudgetGuard(new FileBudgetStore(`${dir}budget-ledger.json`), limits, new JsonlUsageLogger(`${dir}usage-log.jsonl`));
}
