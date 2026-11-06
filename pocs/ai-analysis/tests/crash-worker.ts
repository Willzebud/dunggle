/** Processus auxiliaire : réserve puis s'interrompt brutalement avant toute réconciliation (aucun réseau). */
import { BudgetGuard } from '../src/budget/guard.js';
import { FileBudgetStore } from '../src/budget/store.js';
import { DEFAULT_LIMITS } from '../src/config/budget.js';

const g = new BudgetGuard(new FileBudgetStore(process.argv[2]), DEFAULT_LIMITS, undefined, () => new Date('2026-11-06T10:00:00.000Z'));
await g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 500 });
process.exit(9); // interruption simulée : l'appel « en cours » ne sera jamais réconcilié
