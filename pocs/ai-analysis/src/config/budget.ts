/**
 * Limites budgétaires applicatives. Elles ne remplacent PAS les plafonds de dépense à configurer
 * chez chaque fournisseur (console), seuls à même de garantir la facture.
 */
export interface BudgetLimits {
  /** Maximum absolu des appels IA par mois civil (hors hébergement). */
  monthlyHardCapEur: number;
  /** Budget opérationnel recommandé : seuil réellement appliqué aux réservations. */
  monthlyOperationalCapEur: number;
  /** Budget total des essais du POC 2 (toutes phases confondues). */
  trialTotalCapEur: number;
  /** Nombre maximal d'analyses (réservations) par jour. */
  dailyMaxAnalyses: number;
  /** Plafond de la BORNE HAUTE de tokens d'entrée par requête (au-delà : refus, pas de troncature silencieuse). */
  maxInputTokensPerRequest: number;
  /** Plafond de tokens de sortie par requête (max_tokens / max_output_tokens, réflexion comprise). */
  maxOutputTokensPerRequest: number;
  /** Marge appliquée à l'estimation maximale (incertitude de comptage des tokens). */
  safetyMultiplier: number;
  /** Conversion prudente USD → EUR (borne haute assumée, à réviser). */
  eurPerUsd: number;
}

export const DEFAULT_LIMITS: BudgetLimits = {
  monthlyHardCapEur: 10,
  monthlyOperationalCapEur: 8,
  trialTotalCapEur: 0.5,
  dailyMaxAnalyses: 200,
  maxInputTokensPerRequest: 16000,
  maxOutputTokensPerRequest: 800,
  safetyMultiplier: 1.25,
  eurPerUsd: 1.0,
};

/** Estimation TYPIQUE (projections) : 1 token pour 3 caractères. Ce n'est PAS une borne haute. */
export const CHARS_PER_TOKEN_TYPICAL = 3;

/**
 * Marge forfaitaire ajoutée à la borne en octets : formatage des messages et prompt système injecté
 * par la sortie structurée (les deux fournisseurs l'ajoutent ; sa taille n'est pas publiée).
 * Hypothèse à confirmer par l'usage réel en phase B ; un dépassement est enregistré comme dette.
 */
export const PROVIDER_OVERHEAD_TOKENS = 2000;
