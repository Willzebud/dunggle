/**
 * Temporisation des requêtes réelles par fournisseur, PERSISTANTE (var/provider-pacing.json, hors Git).
 *
 * Règle : une requête ne part pas avant
 *   - fin de la dernière requête + délai minimal (PROVIDER_MIN_GAP_AFTER_END_MS, OpenAI 75 s) ;
 *   - fin de la dernière requête + délai indiqué par le fournisseur (Retry-After, réinitialisation) s'il est plus long ;
 *   - si une requête est restée « en vol » (processus tué avant d'en noter la fin) : début + délai SDK + délai minimal.
 * La fin est notée même si la requête échoue (bloc finally). L'état survit à une interruption, un redémarrage ou
 * une reprise : chaque exécution relit le fichier avant la première requête.
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { PROVIDER_MIN_GAP_AFTER_END_MS, PROVIDER_REQUEST_TIMEOUT_MS } from '../config/quotas.js';
import { ProviderError, type AIAdapter } from '../adapters/types.js';

export type Provider = 'anthropic' | 'openai';

export interface ProviderPacingRecord {
  /** Fin (ms epoch) de la dernière requête, réussie ou en erreur. */
  lastEndedAt?: number;
  /** Début d'une requête dont la fin n'a pas été notée (processus interrompu). */
  inFlightSince?: number;
  /** Pas de requête avant cet instant (indication du fournisseur). */
  notBefore?: number;
  /** Dernier délai indiqué par le fournisseur (ms), pour le rapport. */
  lastRetryAfterMs?: number;
}
export type PacingState = Partial<Record<Provider, ProviderPacingRecord>>;

export interface PacingStore {
  load(): Promise<PacingState>;
  save(state: PacingState): Promise<void>;
}

export class MemoryPacingStore implements PacingStore {
  constructor(private state: PacingState = {}) {}
  async load() {
    return structuredClone(this.state);
  }
  async save(s: PacingState) {
    this.state = structuredClone(s);
  }
}

/** Fichier local, écriture atomique (fichier temporaire puis renommage), droits 600. */
export class FilePacingStore implements PacingStore {
  constructor(readonly path: string) {}
  async load(): Promise<PacingState> {
    if (!existsSync(this.path)) return {};
    const raw = JSON.parse(await readFile(this.path, 'utf8')) as PacingState;
    for (const [p, r] of Object.entries(raw)) {
      for (const [k, v] of Object.entries(r ?? {})) {
        if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Fichier de temporisation invalide (${p}.${k}) : corriger ou supprimer ${this.path} après vérification`);
      }
    }
    return raw;
  }
  async save(s: PacingState) {
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(s, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, this.path);
  }
}

export class ProviderPacer {
  constructor(
    readonly store: PacingStore,
    readonly gapsMs: Readonly<Record<Provider, number>> = PROVIDER_MIN_GAP_AFTER_END_MS,
    readonly requestTimeoutMs: number = PROVIDER_REQUEST_TIMEOUT_MS,
  ) {}

  /** Instant (ms epoch) à partir duquel une requête peut partir ; 0 si aucune contrainte. */
  async earliestStart(p: Provider): Promise<number> {
    const r = (await this.store.load())[p];
    if (!r) return 0;
    const gap = this.gapsMs[p];
    let t = 0;
    if (r.lastEndedAt !== undefined) t = Math.max(t, r.lastEndedAt + gap);
    if (r.inFlightSince !== undefined) t = Math.max(t, r.inFlightSince + this.requestTimeoutMs + gap);
    if (r.notBefore !== undefined) t = Math.max(t, r.notBefore);
    return t;
  }

  async begin(p: Provider, now: number): Promise<void> {
    const s = await this.store.load();
    s[p] = { ...s[p], inFlightSince: now };
    await this.store.save(s);
  }

  /** Fin d'une requête (réussie ou non). `retryAfterMs` : indication du fournisseur, s'ajoute au délai minimal. */
  async end(p: Provider, now: number, retryAfterMs: number | null): Promise<void> {
    const s = await this.store.load();
    const r: ProviderPacingRecord = { ...s[p], lastEndedAt: now };
    delete r.inFlightSince;
    if (retryAfterMs !== null && retryAfterMs > 0) {
      r.notBefore = Math.max(r.notBefore ?? 0, now + retryAfterMs, now + this.gapsMs[p]);
      r.lastRetryAfterMs = retryAfterMs;
    }
    s[p] = r;
    await this.store.save(s);
  }

  /**
   * Adaptateur temporisé : attend si nécessaire (garde-fou, la boucle d'exécution attend déjà AVANT la réservation),
   * note le début, puis la fin dans tous les cas, avec l'éventuel Retry-After de l'erreur.
   */
  wrap(inner: AIAdapter, p: Provider, now: () => number, sleep: (ms: number) => Promise<void>): AIAdapter {
    return {
      real: inner.real,
      model: inner.model,
      analyze: async (req) => {
        const wait = (await this.earliestStart(p)) - now();
        if (wait > 0) await sleep(wait);
        await this.begin(p, now());
        let retryAfter: number | null = null;
        try {
          return await inner.analyze(req);
        } catch (e) {
          if (e instanceof ProviderError) retryAfter = e.retryAfterMs;
          throw e;
        } finally {
          await this.end(p, now(), retryAfter);
        }
      },
    };
  }
}
