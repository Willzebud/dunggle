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
