/** Processus auxiliaire du test de concurrence inter-processus (aucun réseau). */
import { BudgetGuard } from '../src/budget/guard.js';
import { FileBudgetStore } from '../src/budget/store.js';
import { DEFAULT_LIMITS } from '../src/config/budget.js';

const path = process.argv[2];
const g = new BudgetGuard(new FileBudgetStore(path, 15_000), { ...DEFAULT_LIMITS, trialTotalCapEur: 0.03 }, undefined, () => new Date('2026-11-06T10:00:00.000Z'));
const results = await Promise.allSettled(Array.from({ length: 10 }, () => g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 100 })));
process.stdout.write(String(results.filter((r) => r.status === 'fulfilled').length));
