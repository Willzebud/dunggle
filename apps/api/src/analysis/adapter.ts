/** Interface des adaptateurs de modèle et erreurs fournisseur normalisées (copiées du POC 2). */
import type { ModelConfig } from '../config/model.js';

export interface AnalysisRequest {
  system: string;
  user: string;
  schema: object;
  maxOutputTokens: number;
}

/** Usage FACTURABLE normalisé (réflexion / raisonnement inclus dans outputTokens). */
export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens de réflexion / raisonnement déclarés (information, déjà comptés dans outputTokens). */
  reasoningTokens?: number;
}

export interface AnalysisResponse {
  /** Texte JSON renvoyé par le modèle (sortie structurée). */
  rawText: string;
  /** Usage réel facturé ; null si le fournisseur ne l'a pas renvoyé. */
  usage: ProviderUsage | null;
  stopReason: string | null;
  /** Usage brut du fournisseur (compteurs numériques uniquement : cache, raisonnement), pour vérification. */
  rawUsage?: Record<string, unknown> | null;
}

export type ProviderErrorKind = 'rate-limit' | 'server' | 'timeout' | 'network' | 'auth' | 'invalid-request' | 'refusal' | 'truncated';

/**
 * Erreur fournisseur normalisée.
 * - `requestSent` : false seulement si l'on est CERTAIN que la requête n'a pas atteint le fournisseur.
 * - `usage` : usage connu malgré l'erreur (ex. refus ou troncature facturés).
 */
export class ProviderError extends Error {
  /** La requête a-t-elle atteint le fournisseur ? (compte alors dans les quotas, même non facturée). */
  readonly transmitted: boolean;
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    /** false : CERTAINEMENT non facturée (refus avant envoi, ou refus HTTP 4xx du fournisseur). */
    readonly requestSent: boolean,
    readonly usage: ProviderUsage | null = null,
    transmitted?: boolean,
    /** Délai d'attente indiqué par le fournisseur (Retry-After, réinitialisation de limite), en ms ; null si absent. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'ProviderError';
    this.transmitted = transmitted ?? requestSent;
  }
}

export class RealCallsDisabledError extends Error {
  constructor(provider: string) {
    super(`Appels réels désactivés (${provider}) : aucune requête n'est envoyée.`);
    this.name = 'RealCallsDisabledError';
  }
}

export interface AIAdapter {
  readonly model: ModelConfig;
  /** true pour les adaptateurs qui contacteraient un fournisseur réel. */
  readonly real: boolean;
  analyze(req: AnalysisRequest): Promise<AnalysisResponse>;
}
