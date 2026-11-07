/**
 * Limites et hypothèses figées de l'application (copiées du POC 2, config/budget.ts).
 * Estimation des tokens (prompt), plafonds budgétaires, quotas de production, file d’attente et temporisation.
 */

/** Estimation TYPIQUE (projections) : 1 token pour 3 caractères. Ce n'est PAS une borne haute. */
export const CHARS_PER_TOKEN_TYPICAL = 3;

/**
 * Marge forfaitaire ajoutée à la borne en octets : formatage des messages et prompt système injecté
 * par la sortie structurée (les deux fournisseurs l'ajoutent ; sa taille n'est pas publiée).
 * Hypothèse à confirmer par l'usage réel en phase B ; un dépassement est enregistré comme dette.
 */
export const PROVIDER_OVERHEAD_TOKENS = 2000;

/**
 * Limites budgétaires applicatives (copiées du POC 2, sans le budget d'essai des phases de POC). Elles ne remplacent
 * PAS les plafonds de dépense à configurer chez le fournisseur (console), seuls à même de garantir la facture.
 */
export interface BudgetLimits {
  /** Maximum absolu des appels IA par mois civil (hors hébergement). */
  monthlyHardCapEur: number;
  /** Budget opérationnel : seuil réellement appliqué aux réservations. */
  monthlyOperationalCapEur: number;
  /** Nombre maximal d'analyses (réservations) par jour UTC. */
  dailyMaxAnalyses: number;
  /** Plafond de la BORNE HAUTE de tokens d'entrée par requête (au-delà : refus, pas de troncature silencieuse). */
  maxInputTokensPerRequest: number;
  /** Plafond de tokens de sortie par requête (max_output_tokens, raisonnement compris). */
  maxOutputTokensPerRequest: number;
  /** Marge appliquée à l'estimation maximale (incertitude de comptage des tokens). */
  safetyMultiplier: number;
  /** Conversion prudente USD → EUR (borne haute assumée, à réviser). */
  eurPerUsd: number;
  /**
   * Arrêt sécurisé : tant qu'un coût incertain n'est pas réconcilié, toute nouvelle réservation est refusée.
   * Désactivable uniquement par code (tests), jamais par une donnée d'entrée ni un argument CLI.
   */
  blockWhenUncertain: boolean;
}

/** Gelé : aucune partie du programme ne peut modifier les plafonds à l'exécution. */
export const DEFAULT_LIMITS: Readonly<BudgetLimits> = Object.freeze({
  monthlyHardCapEur: 10,
  monthlyOperationalCapEur: 8,
  dailyMaxAnalyses: 200,
  maxInputTokensPerRequest: 16000,
  maxOutputTokensPerRequest: 800,
  safetyMultiplier: 1.25,
  eurPerUsd: 1.0,
  blockWhenUncertain: true,
});

/**
 * Quotas d'appels IA. Ils comptent les TENTATIVES envoyées au fournisseur et sont vérifiés dans la même transaction
 * que le budget. Une tentative transmise reste comptée même si elle échoue ou si sa facturation est incertaine ;
 * seule une requête certainement NON transmise (refus avant envoi) est décomptée.
 */
export interface ProductionQuotas {
  /** Par jour civil Europe/Paris. */
  dailyMax: number;
  /** Par mois civil Europe/Paris. */
  monthlyMax: number;
  /** Par exécution (cycle). */
  perRunMax: number;
}

/** Quotas existants conservés (décision du 2026-11-07). */
export const PRODUCTION_QUOTAS: Readonly<ProductionQuotas> = Object.freeze({ dailyMax: 20, monthlyMax: 500, perRunMax: 10 });

/** Contexte de quota : OBLIGATOIRE pour toute réservation (aucun appel hors quotas). */
export interface QuotaContext {
  runId: string;
}

/**
 * Publications en attente : une publication non analysée reste visible mais n'est plus proposée à l'IA après
 * maxAgeDays ; au plus maxBacklog candidates par cycle. Ordre : couverture obligatoire, puis les plus récentes.
 */
export const PENDING_POLICY = Object.freeze({ maxAgeDays: 14, maxBacklog: 100 });

/**
 * Délai minimal entre la FIN de la dernière requête vers un fournisseur et le DÉBUT de la suivante.
 * OpenAI : 75 s (incident 429 de B.2 avec une limite d'1 requête/minute), à réévaluer quand les limites du projet
 * de production seront connues. Les indications Retry-After du fournisseur s'ajoutent à ce délai.
 */
export const PROVIDER_MIN_GAP_AFTER_END_MS: Readonly<Record<'anthropic' | 'openai', number>> = Object.freeze({ anthropic: 0, openai: 75_000 });
/** Requête restée « en vol » (processus tué) : on suppose qu'elle a pu durer jusqu'au délai SDK. */
export const PROVIDER_REQUEST_TIMEOUT_MS = 60_000;
