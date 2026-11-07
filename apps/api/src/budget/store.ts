/**
 * Registre budgétaire (copié du POC 2, périmètre opérationnel seul : ni budget d'essai, ni phases, ni exceptions).
 * Le stockage MongoDB (écriture conditionnelle et jeton de garde) arrive au lot L4 ; il implémente la même interface.
 */
import type { QuotaContext } from '../config/limits.js';

export interface Reservation {
  id: string;
  modelKey: string;
  estimatedMaxEur: number;
  inputTokensEstimate: number;
  maxOutputTokens: number;
  month: string;
  day: string;
  createdAt: string;
  /** Clé d'idempotence de l'analyse couverte par cette réservation. */
  idempotencyKey: string;
  /** Compteurs de quota incrémentés par cette réservation (décomptés seulement si la requête n'a pas été transmise). */
  quota: { context: QuotaContext; dailyKey: string; monthlyKey: string };
}

/** Compteurs de tentatives d'appels (persistants, jamais remis à zéro au redémarrage). */
export interface QuotaCounters {
  /** AAAA-MM-JJ (jour Europe/Paris) → tentatives. */
  daily: Record<string, number>;
  /** AAAA-MM (mois Europe/Paris) → tentatives. */
  monthly: Record<string, number>;
  /** identifiant d'exécution → tentatives. */
  runs: Record<string, number>;
}

export const emptyQuotas = (): QuotaCounters => ({ daily: {}, monthly: {}, runs: {} });

/** Appel envoyé dont la facturation réelle est inconnue : compté au maximum tant qu'il n'est pas réconcilié. */
export interface UncertainEntry {
  id: string;
  modelKey: string;
  chargedEur: number;
  month: string;
  reason: string;
  since: string;
}

export interface LedgerState {
  version: 1;
  /**
   * Par mois civil UTC (YYYY-MM) : dépense comptée (réconciliée + incertaine), réservations en cours,
   * part incertaine (incluse dans spent), dépassements constatés (coût réel > estimation).
   */
  months: Record<string, { spentEur: number; reservedEur: number; uncertainEur: number; overrunEur?: number }>;
  /** Par jour (YYYY-MM-DD, UTC) : nombre d'analyses réservées. */
  days: Record<string, { analyses: number }>;
  reservations: Record<string, Reservation>;
  /** Appels à facturation incertaine, jamais libérés : seule une réconciliation explicite peut les solder. */
  uncertain: Record<string, UncertainEntry>;
  /**
   * Registre d'idempotence : une analyse ne peut être réservée qu'une fois.
   * in-progress → completed | uncertain ; supprimée seulement si la requête n'a certainement pas été facturée.
   */
  analyses: Record<string, AnalysisEntry>;
  /** Nombre total de réservations jamais faites (monotone) : détecte un registre restauré ou réinitialisé. */
  sequence: number;
  quotas: QuotaCounters;
}

export interface AnalysisEntry {
  status: 'in-progress' | 'completed' | 'uncertain';
  reservationId: string;
  modelKey: string;
  since: string;
  costEur?: number;
  /** Résultat enregistré après validation (absent si le processus s'est arrêté avant la sauvegarde). */
  result?: unknown;
}

export const emptyState = (): LedgerState => ({ version: 1, months: {}, days: {}, reservations: {}, uncertain: {}, analyses: {}, sequence: 0, quotas: emptyQuotas() });

/**
 * Stockage du registre. Contrat : `transaction` applique `fn` sur une copie de l'état ; lecture → vérification →
 * écriture sont atomiques vis-à-vis des autres transactions. `fn` est synchrone ; si elle lève, rien n'est écrit.
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

/** Registre en mémoire (tests et simulation) : protège contre les appels concurrents d'un même processus. */
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
