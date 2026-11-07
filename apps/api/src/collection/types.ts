/**
 * Types de la collecte (copiés du POC 1, sans les structures propres aux rapports de faisabilité).
 */
import type { ContentLevelCode } from './content-level.js';

/** Catégorie éditoriale d'une source. */
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
  /** Identifiant stable : `${sourceId}:${identifiant natif}` (ou URL normalisée, voir idBasis) */
  id: string;
  /** Identifiant natif fourni par la source (guid RSS, id Atom, id de release GitHub) */
  nativeId: string;
  /** Indique si nativeId vient de la source ou d'un repli (URL, titre) */
  nativeIdOrigin: 'source' | 'fallback-url' | 'fallback-title';
  sourceId: string;
  sourceName: string;
  category: Category;
  title: string;
  /** URL originale exacte, jamais modifiée (bouton « Lire l'article ») */
  url: string | null;
  /** ISO 8601, ou null si absente / non parsable */
  publishedAt: string | null;
  /** Date brute telle que fournie par la source */
  rawDate: string | null;
  /**
   * Courte description (500 caractères au plus) et texte borné : CONSERVÉS UNIQUEMENT si la politique de droits de la
   * source l'autorise (collection/rights.ts). En metadata-only ou blocked : toujours null.
   */
  description: string | null;
  text: string | null;
  /** Longueur du texte disponible dans la source (mesure technique, le texte lui-même n'est pas conservé) */
  contentLength: number;
  author: string | null;
  /** Spécifique GitHub */
  prerelease?: boolean;
  /** Catégories déclarées par le flux (métadonnées) */
  categories?: string[];
  collectedAt: string;
  /** Clé de déduplication (URL sans paramètres de suivi). Ne remplace jamais `url`. */
  dedupKey: string | null;
  /** Disponibilité du contenu (≠ pertinence) */
  contentLevel: ContentLevelCode;
  contentLevelReasons: string[];
  /** Base de l'identifiant `id` : identifiant natif du flux ou URL normalisée */
  idBasis?: 'native' | 'normalized-url';
  /** Règle éditoriale déterministe appliquée (trace) — voir editorial-rules.ts */
  editorial?: EditorialFlag;
}

export interface EditorialFlag {
  ruleId: string;
  kind: 'recurring-digest';
  /** excluded : retirée des publications retenues mais conservée avec sa trace ; flagged : conservée et marquée */
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

export type FeedFormat = 'rss' | 'atom' | 'rdf' | 'json' | 'html' | 'inconnu';

/** Résultat brut d'un collecteur. */
export interface CollectResult {
  effectiveUrl: string | null;
  format: FeedFormat;
  requests: HttpTrace[];
  articles: NormalizedArticle[];
  itemsInFeed: number;
  allDates: (string | null)[];
  errors: string[];
  warnings: string[];
  authRequired: boolean;
}
