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

export type PocPhase = 'B1' | 'B2' | 'B3';

export interface PocPhaseQuotas {
  mode: 'smoke' | 'full' | 'final';
  perModelMax: number;
  totalMax: number;
  description: string;
  /**
   * Phase ouverte aux réservations réelles. Une phase inactive est refusée par le garde budgétaire
   * (`quota-phase-inactive`) et par la création d'autorisation locale, AVANT toute réservation.
   * Son activation passe par un commit relu, après autorisation explicite de l'utilisateur.
   */
  active: boolean;
}

/**
 * POC : règles distinctes (périmètre `trial`), pour ne pas fausser le protocole de comparaison.
 * Les compteurs de phase et le budget cumulé de 0,50 € ne sont JAMAIS remis à zéro (B.1 puis B.2).
 * Chaque phase exige sa propre autorisation locale à usage unique.
 */
export const POC_PHASES: Readonly<Record<PocPhase, Readonly<PocPhaseQuotas>>> = Object.freeze({
  B1: Object.freeze({ mode: 'smoke', perModelMax: 1, totalMax: 2, description: 'Smoke tests : un appel par modèle', active: true }),
  B2: Object.freeze({ mode: 'full', perModelMax: 37, totalMax: 74, description: 'Évaluation complète : jusqu’à 37 publications par modèle', active: true }),
  // Test final discriminant (préparé le 2026-11-07, reports/phase-b3-final-test.md) : 15 publications figées
  // (fixtures/b3/, empreinte B3_FREEZE_SHA256) × 2 modèles. INACTIF : aucune réservation possible tant que
  // l'utilisateur ne l'a pas explicitement autorisé et qu'un commit relu n'a pas basculé `active`.
  B3: Object.freeze({ mode: 'final', perModelMax: 15, totalMax: 30, description: 'Test final discriminant : 15 publications figées par modèle', active: false }),
});

/**
 * Exceptions de quota de phase : liste FERMÉE, versionnée et figée (toute modification passe par un commit relu).
 * Chacune n'ajoute qu'UNE tentative cumulative à un seul modèle d'une seule phase, après un incident documenté.
 * Elle ne remet aucun compteur à zéro, ne change ni le budget de 0,50 €, ni les quotas de production,
 * ni le plafond PAR EXÉCUTION.
 *
 * Exception LIÉE (`publicationId` renseigné) : la tentative supplémentaire n'est utilisable QUE pour cette
 * publication, une seule fois (consommation enregistrée dans le registre sous `id`). Les autres appels restent
 * soumis au plafond de base, comme si l'exception n'existait pas. Exception NON liée (B.1) : relève simplement
 * le plafond cumulatif du modèle.
 */
export interface PhaseQuotaException {
  /** Identifiant stable, clé de consommation dans le registre. */
  id: string;
  phase: PocPhase;
  modelKey: string;
  extraCalls: 1;
  /** Publication à laquelle la tentative est réservée (exception liée). */
  publicationId?: string;
  incident: { date: string; requestId: string | null; runId?: string; reservationId?: string; httpStatus: number; cause: string; billed: false };
  approval: string;
}

export const PHASE_QUOTA_EXCEPTIONS: readonly Readonly<PhaseQuotaException>[] = Object.freeze([
  Object.freeze({
    id: 'B1-haiku-http400-2026-11-06',
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
  Object.freeze({
    id: 'B2-luna-http429-2026-11-06',
    phase: 'B2',
    modelKey: 'openai-gpt-6-luna',
    extraCalls: 1,
    publicationId: 'gh-angular-components:433858366',
    incident: Object.freeze({
      date: '2026-11-06',
      requestId: null, // non conservé (en-têtes de réponse non journalisés à l’époque)
      runId: '5742ce5d-75fc-4ec9-9090-f8d10d94da87',
      reservationId: '4db6d939-0b41-45d3-bd5b-9cee437f1b60',
      httpStatus: 429,
      cause: 'Limite fournisseur de 1 requête/minute (« Limit 1, Used 1, Requested 1 ») ; requête refusée, non facturée, comptée',
      billed: false,
    }),
    approval: 'Exception unique validée par l’utilisateur le 2026-11-06 pour remplacer l’appel Luna refusé ; l’appel réel exige une nouvelle autorisation locale',
  } as const),
]);

const exceptionsFor = (phase: PocPhase, modelKey?: string) => PHASE_QUOTA_EXCEPTIONS.filter((e) => e.phase === phase && (modelKey === undefined || e.modelKey === modelKey));

/**
 * Exception liée encore disponible pour cette publication (null sinon). Conditions : même phase, même modèle, même
 * publication, pas encore consommée (`used`), et l'exécution de l'incident présente dans les compteurs du registre
 * (`runs`) : sans l'incident réel, l'exception n'existe pas. Elle ne s'applique jamais à une tentative de
 * l'exécution de l'incident elle-même (`currentRunId`) : seulement à une reprise ultérieure.
 */
export function boundExceptionFor(phase: PocPhase, modelKey: string, publicationId: string, used: Readonly<Record<string, unknown>>, runs: Readonly<Record<string, number>>, currentRunId: string): Readonly<PhaseQuotaException> | null {
  return exceptionsFor(phase, modelKey).find((e) => e.publicationId === publicationId && !used[e.id] && !!e.incident.runId && e.incident.runId !== currentRunId && (runs[e.incident.runId] ?? 0) > 0) ?? null;
}

/** Plafond applicable aux appels ORDINAIRES (base + exceptions non liées) : les exceptions liées n'y comptent pas. */
export function phaseModelBaseMax(phase: PocPhase, modelKey: string): number {
  return POC_PHASES[phase].perModelMax + exceptionsFor(phase, modelKey).filter((e) => !e.publicationId).reduce((s, e) => s + e.extraCalls, 0);
}
export function phaseTotalBaseMax(phase: PocPhase): number {
  return POC_PHASES[phase].totalMax + exceptionsFor(phase).filter((e) => !e.publicationId).reduce((s, e) => s + e.extraCalls, 0);
}

/** Nombre d'exceptions liées déjà consommées (pour un modèle, ou pour toute la phase). */
export function consumedBoundExceptions(phase: PocPhase, used: Readonly<Record<string, unknown>>, modelKey?: string): number {
  return exceptionsFor(phase, modelKey).filter((e) => e.publicationId && used[e.id]).length;
}

/** Plafond cumulatif d'appels d'un modèle dans une phase (base + exceptions). */
export function phaseModelMax(phase: PocPhase, modelKey: string): number {
  return POC_PHASES[phase].perModelMax + PHASE_QUOTA_EXCEPTIONS.filter((e) => e.phase === phase && e.modelKey === modelKey).reduce((s, e) => s + e.extraCalls, 0);
}

/** Plafond cumulatif total d'une phase (base + exceptions). */
export function phaseTotalMax(phase: PocPhase): number {
  return POC_PHASES[phase].totalMax + PHASE_QUOTA_EXCEPTIONS.filter((e) => e.phase === phase).reduce((s, e) => s + e.extraCalls, 0);
}

export const phaseForMode = (mode: 'smoke' | 'full' | 'final'): PocPhase => (mode === 'smoke' ? 'B1' : mode === 'full' ? 'B2' : 'B3');

/** Version du prompt utilisée par B.2 (résultats historiques, comparaison reproductible hors ligne). */
export const B2_PROMPT_VERSION = '96c4c96347de';

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
 * Délai minimal entre la FIN de la dernière requête réelle vers un fournisseur et le DÉBUT de la suivante.
 * OpenAI : projet `dunggle-poc` limité à 1 requête par minute. Incident B.2 du 2026-11-06 : 429 avec 61 s
 * entre les DÉBUTS (54,8 s après la fin de la précédente) → 75 s après la fin, marge conservatrice. Persisté
 * hors Git (var/provider-pacing.json) : s'applique aussi après une interruption, un redémarrage ou une erreur.
 * Les indications `Retry-After` / réinitialisation renvoyées par le fournisseur s'ajoutent à ce délai.
 */
export const PROVIDER_MIN_GAP_AFTER_END_MS: Readonly<Record<'anthropic' | 'openai', number>> = Object.freeze({ anthropic: 0, openai: 75_000 });
/** Requête restée « en vol » (processus tué) : on suppose qu'elle a pu durer jusqu'au délai SDK. */
export const PROVIDER_REQUEST_TIMEOUT_MS = 60_000;
