/** Processus auxiliaire du test de quotas inter-processus (aucun réseau) : 10 tentatives, exécution propre. */
import { BudgetGuard } from '../src/budget/guard.js';
import { FileBudgetStore } from '../src/budget/store.js';
import { DEFAULT_LIMITS } from '../src/config/budget.js';

const [path, runId] = process.argv.slice(2);
const g = new BudgetGuard(new FileBudgetStore(path, 20_000), DEFAULT_LIMITS, undefined, () => new Date('2026-11-06T10:00:00.000Z'));
const models = ['anthropic-haiku-5-5', 'openai-gpt-6-luna'];
const results = await Promise.allSettled(
  Array.from({ length: 10 }, (_, i) => g.reserve({ modelKey: models[i % 2], inputTokensEstimate: 1000, quota: { scope: 'operational', runId } })),
);
process.stdout.write(String(results.filter((r) => r.status === 'fulfilled').length));
