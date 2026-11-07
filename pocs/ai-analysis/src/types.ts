import type { ExclusionReason, PublicationType, Subtheme, Theme } from './taxonomy.js';

/** Disponibilité technique du contenu (POC 1.1). Indépendante de la politique de réutilisation. */
export type ContentLevel = 'FULL' | 'PARTIAL' | 'MINIMAL';

/** Ce qu'il est permis de transmettre à une IA externe pour une source. */
export type ContentPolicy = 'full-allowed' | 'excerpt-only' | 'metadata-only' | 'blocked';

/** Ce qui est effectivement transmis au modèle pour une publication donnée. */
export type InputMode = 'full' | 'excerpt' | 'metadata' | 'none';

/** Publication en entrée du POC 2 (forme compatible avec NormalizedArticle du POC 1). */
export interface PublicationInput {
  id: string;
  synthetic: boolean;
  sourceId: string;
  sourceName: string;
  sourceType: 'feed' | 'github-releases' | 'synthetic';
  /** URL originale exacte : jamais modifiée (bouton « Lire l'article »). */
  url: string;
  title: string;
  publishedAt: string | null;
  contentLevel: ContentLevel;
  /** Texte disponible localement. Pour les publications réelles, il n'est jamais versionné. */
  text?: string | null;
  categories?: string[];
  /** Règle éditoriale déterministe du POC 1.2 (exclusion tracée ou compilation marquée). */
  editorial?: { ruleId: string; kind: string; action: 'excluded' | 'flagged'; reason: string };
}

/** Sortie structurée attendue du modèle (validée par src/schema.ts). */
export interface AnalysisOutput {
  themes: Theme[];
  subthemes: Subtheme[];
  type: PublicationType;
  /** Pertinence personnelle pour le profil Dunggle : entier de 0 à 100. */
  relevance: number;
  /** Importance de la nouveauté : entier de 1 (mineure) à 5 (rupture). */
  novelty: number;
  /** Confiance du modèle dans sa classification : réel de 0 à 1 (voir README). */
  confidence: number;
  relevanceReason: string;
  /** Résumé en français, ou null s'il n'est pas autorisé ou si le contenu est insuffisant. */
  summary: string | null;
  keyPoints: string[];
  exclusionReason: ExclusionReason | null;
}

export type AnalysisStatus =
  | 'analyzed'
  | 'skipped-blocked'
  | 'skipped-editorial'
  | 'skipped-duplicate'
  | 'refused-budget'
  | 'refused-quota'
  | 'refused-unknown-pricing'
  | 'provider-error'
  | 'invalid-output';

/** Rubrique du futur dashboard. Les publications non analysées restent « pending » : jamais supprimées. */
export type Section = 'main' | 'updates' | 'excluded' | 'pending';

export interface AnalysisRecord {
  publicationId: string;
  sourceId: string;
  /** Recopie exacte de PublicationInput.url. */
  url: string;
  title: string;
  synthetic: boolean;
  contentLevel: ContentLevel;
  contentPolicy: ContentPolicy;
  /** Couverture obligatoire ou sélective, déterminée par la source (indépendante des scores IA). */
  coveragePolicy: 'mandatory' | 'selective';
  inputMode: InputMode;
  status: AnalysisStatus;
  section: Section;
  analysis: AnalysisOutput | null;
  /**
   * Écarts entre la sortie du modèle et les règles de contenu ou de couverture. Jamais de correction du texte :
   * le contenu fautif est SUPPRIMÉ (résumé, points clés, URL ou raison), ou la rubrique est ajustée, et l'écart est tracé ici.
   */
  violations: string[];
  model: string | null;
  costEur: number | null;
  costUncertain: boolean;
  /** Usage facturable normalisé et usage brut du fournisseur (compteurs uniquement). */
  usage?: { billable: { inputTokens: number; outputTokens: number; reasoningTokens?: number } | null; raw: Record<string, unknown> | null };
  stopReason?: string | null;
  error?: string;
  /**
   * DIAGNOSTIC LOCAL UNIQUEMENT (var/, hors Git ; jamais affiché ni réinjecté) :
   * - texte brut d'une sortie rejetée par la validation (invalid-output), sans aucune correction ;
   * - résumé et points clés supprimés par une règle de contenu ou d'exclusion, avec les motifs.
   */
  rejectedRawOutput?: string;
  droppedSummary?: { summary: string | null; keyPoints: string[]; reasons: string[] };
}
