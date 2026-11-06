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
  /** Plafond de tokens d'entrée estimés par requête (au-delà : refus, pas de troncature silencieuse). */
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
  maxInputTokensPerRequest: 4000,
  maxOutputTokensPerRequest: 800,
  safetyMultiplier: 1.25,
  eurPerUsd: 1.0,
};

/** Estimation prudente du nombre de tokens : 1 token pour 3 caractères (surestime pour le français). */
export const CHARS_PER_TOKEN_CONSERVATIVE = 3;
