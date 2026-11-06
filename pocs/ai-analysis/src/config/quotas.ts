/**
 * Quotas d'appels IA (phase B.0.1). Ils comptent les TENTATIVES envoyées au fournisseur, tous fournisseurs
 * confondus (une analyse par deux modèles = deux appels), et sont vérifiés dans la même transaction que le budget.
 * Une tentative transmise reste comptée même si elle échoue ou si sa facturation est incertaine ; seule une
 * requête certainement NON transmise (refus avant envoi) est décomptée.
 */
export interface ProductionQuotas {
  /** Par jour civil Europe/Paris. */
  dailyMax: number;
  /** Par mois civil Europe/Paris. */
  monthlyMax: number;
  /** Par exécution (identifiant d'exécution). */
  perRunMax: number;
}

/** Production future : périmètre `operational` (budget 8 € opérationnel, 10 € absolu). */
export const PRODUCTION_QUOTAS: Readonly<ProductionQuotas> = Object.freeze({ dailyMax: 20, monthlyMax: 500, perRunMax: 10 });

export type PocPhase = 'B1' | 'B2';

export interface PocPhaseQuotas {
  mode: 'smoke' | 'full';
  perModelMax: number;
  totalMax: number;
  description: string;
}

/**
 * POC : règles distinctes (périmètre `trial`), pour ne pas fausser le protocole de comparaison.
 * Les compteurs de phase et le budget cumulé de 0,50 € ne sont JAMAIS remis à zéro (B.1 puis B.2).
 * Chaque phase exige sa propre autorisation locale à usage unique.
 */
export const POC_PHASES: Readonly<Record<PocPhase, Readonly<PocPhaseQuotas>>> = Object.freeze({
  B1: Object.freeze({ mode: 'smoke', perModelMax: 1, totalMax: 2, description: 'Smoke tests : un appel par modèle' }),
  B2: Object.freeze({ mode: 'full', perModelMax: 37, totalMax: 74, description: 'Évaluation complète : jusqu’à 37 publications par modèle' }),
});

/**
 * Exceptions de quota de phase : liste FERMÉE, versionnée et figée (toute modification passe par un commit relu).
 * Chacune n'ajoute qu'UNE tentative cumulative à un seul modèle d'une seule phase, après un incident documenté.
 * Elle ne remet aucun compteur à zéro, ne change ni le budget de 0,50 €, ni les quotas de production, ni B.2,
 * ni le plafond PAR EXÉCUTION (B.1 : un appel par modèle et deux au total par exécution).
 */
export interface PhaseQuotaException {
  phase: PocPhase;
  modelKey: string;
  extraCalls: 1;
  incident: { date: string; requestId: string; httpStatus: number; cause: string; billed: false };
  approval: string;
}

export const PHASE_QUOTA_EXCEPTIONS: readonly Readonly<PhaseQuotaException>[] = Object.freeze([
  Object.freeze({
    phase: 'B1',
    modelKey: 'anthropic-haiku-5-5',
    extraCalls: 1,
    incident: Object.freeze({
      date: '2026-11-06',
      requestId: 'req_011Cgn4kjg6cEFjYpA4ZQLCh',
      httpStatus: 400,
      cause: 'Schéma refusé (enum + type ["string","null"] sur exclusionReason) ; schéma corrigé sans union',
      billed: false,
    }),
    approval: 'Option A validée par l’utilisateur le 2026-11-06 ; l’appel réel exige une nouvelle autorisation locale',
  } as const),
]);

/** Plafond cumulatif d'appels d'un modèle dans une phase (base + exceptions). */
export function phaseModelMax(phase: PocPhase, modelKey: string): number {
  return POC_PHASES[phase].perModelMax + PHASE_QUOTA_EXCEPTIONS.filter((e) => e.phase === phase && e.modelKey === modelKey).reduce((s, e) => s + e.extraCalls, 0);
}

/** Plafond cumulatif total d'une phase (base + exceptions). */
export function phaseTotalMax(phase: PocPhase): number {
  return POC_PHASES[phase].totalMax + PHASE_QUOTA_EXCEPTIONS.filter((e) => e.phase === phase).reduce((s, e) => s + e.extraCalls, 0);
}

export const phaseForMode = (mode: 'smoke' | 'full'): PocPhase => (mode === 'smoke' ? 'B1' : 'B2');

/** Contexte de quota attaché à chaque réservation. Obligatoire pour tout appel réel. */
export type QuotaContext = { scope: 'operational'; runId: string } | { scope: 'trial'; phase: PocPhase; runId: string };

/**
 * Politique des publications en attente (production) : évite une accumulation illimitée.
 * - Une publication non analysée reste visible (métadonnées) mais n'est plus proposée à l'IA après maxAgeDays.
 * - Au plus maxBacklog publications sont candidates à chaque cycle ; le surplus attend sans être supprimé.
 * - Ordre : couverture obligatoire d'abord, puis les plus récentes.
 */
export const PENDING_POLICY = Object.freeze({ maxAgeDays: 14, maxBacklog: 100 });

/**
 * Espacement minimal entre deux requêtes RÉELLES vers un même fournisseur, dans une exécution.
 * OpenAI : projet `dunggle-poc` limité à 1 requête par minute → 61 s (marge d'une seconde). Une requête
 * refusée en 429 serait comptée dans les quotas (transmise) et arrêterait l'exécution : on l'évite en amont.
 */
export const PROVIDER_MIN_INTERVAL_MS: Readonly<Record<'anthropic' | 'openai', number>> = Object.freeze({ anthropic: 0, openai: 61_000 });
