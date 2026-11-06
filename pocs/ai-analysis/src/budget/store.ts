import { mkdir, readFile, rename, rmdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface Reservation {
  id: string;
  modelKey: string;
  scope: 'trial' | 'operational';
  estimatedMaxEur: number;
  inputTokensEstimate: number;
  maxOutputTokens: number;
  month: string;
  day: string;
  createdAt: string;
}

export interface LedgerState {
  version: 1;
  /** Par mois civil (YYYY-MM) : dépense réconciliée, réservations en cours, part incertaine (comptée dans spent). */
  months: Record<string, { spentEur: number; reservedEur: number; uncertainEur: number }>;
  /** Par jour (YYYY-MM-DD) : nombre d'analyses réservées. */
  days: Record<string, { analyses: number }>;
  /** Budget global des essais du POC, toutes périodes confondues. */
  trial: { spentEur: number; reservedEur: number };
  reservations: Record<string, Reservation>;
}

export const emptyState = (): LedgerState => ({ version: 1, months: {}, days: {}, trial: { spentEur: 0, reservedEur: 0 }, reservations: {} });

/**
 * Stockage du registre budgétaire. `transaction` exécute `fn` de manière exclusive :
 * lecture → vérification → écriture sont atomiques vis-à-vis des autres transactions.
 * `fn` est synchrone ; si elle lève une exception, rien n'est écrit.
 */
export interface BudgetStore {
  transaction<T>(fn: (state: LedgerState) => T): Promise<T>;
  read(): Promise<LedgerState>;
}

/** Verrou asynchrone simple (sérialise les transactions d'un même processus). */
class Mutex {
  private tail: Promise<void> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/** Registre en mémoire : protège contre les appels concurrents d'un même processus. */
export class MemoryBudgetStore implements BudgetStore {
  private state: LedgerState;
  private mutex = new Mutex();
  constructor(initial: LedgerState = emptyState()) {
    this.state = structuredClone(initial);
  }
  transaction<T>(fn: (state: LedgerState) => T): Promise<T> {
    return this.mutex.run(async () => {
      const draft = structuredClone(this.state);
      const out = fn(draft); // si fn lève, l'état n'est pas modifié
      this.state = draft;
      return out;
    });
  }
  async read(): Promise<LedgerState> {
    return structuredClone(this.state);
  }
}

export class LockTimeoutError extends Error {}

/**
 * Registre fichier JSON, protégé contre plusieurs processus par un verrou `mkdir` (atomique sur
 * les systèmes de fichiers locaux) et écrit par renommage atomique (fichier temporaire → rename).
 * Un verrou orphelin (processus tué) n'est JAMAIS cassé automatiquement : LockTimeoutError, à
 * traiter manuellement, plutôt que de risquer deux écrivains simultanés.
 */
export class FileBudgetStore implements BudgetStore {
  private mutex = new Mutex();
  constructor(
    private readonly path: string,
    private readonly lockTimeoutMs = 5000,
  ) {}

  private get lockPath() {
    return `${this.path}.lock`;
  }

  private async acquire(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const deadline = Date.now() + this.lockTimeoutMs;
    for (;;) {
      try {
        await mkdir(this.lockPath);
        return;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        if (Date.now() > deadline) throw new LockTimeoutError(`Verrou budgétaire occupé : ${this.lockPath}`);
        await new Promise((r) => setTimeout(r, 5 + Math.random() * 10));
      }
    }
  }

  private async load(): Promise<LedgerState> {
    try {
      const s = JSON.parse(await readFile(this.path, 'utf8')) as LedgerState;
      if (s.version !== 1) throw new Error(`Version de registre inconnue : ${s.version}`);
      return s;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
      throw e; // registre illisible : on refuse plutôt que de repartir de zéro
    }
  }

  transaction<T>(fn: (state: LedgerState) => T): Promise<T> {
    return this.mutex.run(async () => {
      await this.acquire();
      try {
        const state = await this.load();
        const out = fn(state);
        const tmp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(tmp, JSON.stringify(state, null, 2));
        await rename(tmp, this.path);
        return out;
      } finally {
        await rmdir(this.lockPath).catch(() => undefined);
      }
    });
  }

  read(): Promise<LedgerState> {
    return this.mutex.run(() => this.load());
  }
}
