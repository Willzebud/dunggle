import type { ContentLevelCode } from './content-level.js';

/** POC 1.2 : ajout de 'innovation' et 'prospective' pour les sources candidates. */
export type Category = 'angular' | 'ia' | 'agents' | 'innovation' | 'prospective';

export const CATEGORY_LABELS: Record<Category, string> = {
  angular: 'Angular',
  ia: 'Intelligence artificielle',
  agents: 'Agents IA',
  innovation: 'Innovations numériques',
  prospective: 'Transformations et prospective',
};

/** feed : URL RSS/Atom connue. feed-discovery : page HTML dont il faut découvrir le flux. */
export type SourceType = 'feed' | 'feed-discovery' | 'github-releases';

export interface SourceConfig {
  id: string;
  name: string;
  category: Category;
  type: SourceType;
  url: string;
  /**
   * Identification des publications. 'native' (défaut) : guid/id du flux, avec repli automatique
   * sur l'URL normalisée en cas de collision. 'normalized-url' : toujours l'URL normalisée (dedupKey).
   */
  idStrategy?: 'native' | 'normalized-url';
}

/** Structure commune à toutes les publications collectées. */
export interface NormalizedArticle {
  /** Identifiant stable : `${sourceId}:${identifiant natif}` */
  id: string;
  /** Identifiant natif fourni par la source (guid RSS, id Atom, id de release GitHub) */
  nativeId: string;
  /** Indique si nativeId vient de la source ou d'un repli (URL, titre) */
  nativeIdOrigin: 'source' | 'fallback-url' | 'fallback-title';
  sourceId: string;
  sourceName: string;
  category: Category;
  title: string;
  url: string | null;
  /** ISO 8601, ou null si absente / non parsable */
  publishedAt: string | null;
  /** Date brute telle que fournie par la source */
  rawDate: string | null;
  /** Courte description en texte brut (max 500 caractères) */
  description: string | null;
  /** Longueur du texte complet disponible dans la source (sans HTML) */
  contentLength: number;
  author: string | null;
  /** Spécifique GitHub */
  prerelease?: boolean;
  collectedAt: string;
  /** POC 1.1 — clé de déduplication (URL sans paramètres de suivi). Ne remplace jamais `url`. */
  dedupKey?: string | null;
  /** POC 1.1 — disponibilité du contenu (≠ pertinence) */
  contentLevel?: ContentLevelCode;
  contentLevelReasons?: string[];
  /** Base de l'identifiant `id` : identifiant natif du flux ou URL normalisée */
  idBasis?: 'native' | 'normalized-url';
  /** Règle éditoriale déterministe appliquée (trace) — voir src/editorial-rules.ts */
  editorial?: EditorialFlag;
}

export interface EditorialFlag {
  ruleId: string;
  kind: 'recurring-digest';
  /** excluded : retirée de `articles` mais conservée dans `excluded` ; flagged : conservée et marquée */
  action: 'excluded' | 'flagged';
  reason: string;
}

export interface HttpTrace {
  requestedUrl: string;
  finalUrl: string | null;
  status: number | null;
  redirected: boolean;
  contentType: string | null;
  bytes: number;
  durationMs: number;
  cacheHeaders: { etag: boolean; lastModified: boolean; cacheControl: string | null };
  rateLimit?: { limit: number | null; remaining: number | null; resetAt: string | null };
  error?: string;
}

export type Recency = 'active' | 'peu-active' | 'inactive' | 'inconnue';
export type ContentLevel = 'suffisant' | 'limité' | 'insuffisant';
export type SourceStatus = 'OK' | 'PARTIEL' | 'ÉCHEC';

export interface FeasibilityAnalysis {
  accessible: boolean;
  exploitable: boolean;
  datesReliable: boolean;
  datesNotes: string[];
  recency: Recency;
  daysSinceLastPublication: number | null;
  content: ContentLevel;
  medianContentLength: number;
  authRequired: boolean;
  authNotes: string;
  restrictions: string[];
  recommendedForMvp: boolean;
  status: SourceStatus;
  /** Estimation de publications par jour, null si non calculable */
  estimatedPerDay: number | null;
  estimationMethod: string;
  /** POC 1.1 — niveau de contenu majoritaire des publications collectées */
  exploitationMode?: ContentLevelCode;
  levelDistribution?: Record<ContentLevelCode, number>;
}

export interface SourceReport {
  source: SourceConfig;
  /** URL réellement utilisée pour la collecte (après découverte éventuelle) */
  effectiveUrl: string | null;
  format: 'rss' | 'atom' | 'rdf' | 'json' | 'html' | 'inconnu';
  requests: HttpTrace[];
  robots?: { checked: boolean; allowed: boolean | null; note: string; aiCrawlersDisallowed?: string[] };
  itemsInFeed: number;
  itemsCollected: number;
  latestPublication: string | null;
  oldestCollected: string | null;
  errors: string[];
  warnings: string[];
  analysis: FeasibilityAnalysis;
  /** Règles éditoriales : publications exclues (trace) et nombre de publications marquées */
  editorialExcluded?: { ruleId: string; title: string; url: string | null; publishedAt: string | null }[];
  editorialFlagged?: number;
  /** Toutes les dates du flux (pour l'estimation de volume, non exportées dans articles.json) */
  allDates?: string[];
}

/** Résultat brut d'un collecteur, avant analyse. */
export interface CollectResult {
  effectiveUrl: string | null;
  format: SourceReport['format'];
  requests: HttpTrace[];
  articles: NormalizedArticle[];
  itemsInFeed: number;
  allDates: (string | null)[];
  errors: string[];
  warnings: string[];
  authRequired: boolean;
}
