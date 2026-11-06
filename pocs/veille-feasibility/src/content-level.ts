/**
 * Classification technique de la DISPONIBILITÉ du contenu d'une publication.
 * ⚠️ Ce n'est PAS un score de pertinence : une publication MINIMAL peut être très pertinente.
 *
 * Critères (appliqués dans l'ordre) :
 *  FULL    : ≥ FULL_MIN_CHARS caractères ET ≥ FULL_MIN_WORDS mots de texte,
 *            qui n'est pas une copie du titre ni une étiquette de catégorie,
 *            ET (pour une page extraite) qui correspond à l'article : absence de contenu générique
 *            (texte identique d'une page à l'autre) ET, soit couverture du titre ≥ MIN_TITLE_COVERAGE,
 *            soit (≥ MIN_TITLE_TOKENS_FOUND mots du titre retrouvés ET titre de la page conforme au flux).
 *  PARTIAL : ≥ PARTIAL_MIN_CHARS caractères ET ≥ PARTIAL_MIN_WORDS mots, avec les mêmes contrôles
 *            de qualité, mais un volume insuffisant pour une analyse approfondie.
 *  MINIMAL : titre + URL (+ date/métadonnées) uniquement, ou texte jugé non fiable.
 */
export type ContentLevelCode = 'FULL' | 'PARTIAL' | 'MINIMAL';

export const CONTENT_LEVEL_THRESHOLDS = {
  FULL_MIN_CHARS: 1200,
  FULL_MIN_WORDS: 180,
  PARTIAL_MIN_CHARS: 60,
  PARTIAL_MIN_WORDS: 8,
  /** Part minimale des mots significatifs du titre retrouvés dans le texte extrait d'une page */
  MIN_TITLE_COVERAGE: 0.5,
  /** Règle alternative pour les titres longs : nb minimal de mots du titre retrouvés… */
  MIN_TITLE_TOKENS_FOUND: 4,
  /** …à condition que le titre extrait de la page corresponde au titre du flux */
  MIN_PAGE_TITLE_MATCH: 0.6,
};

export interface ContentLevelInput {
  title: string;
  text: string;
  /** feed = contenu du flux/de l'API ; page = texte extrait de la page HTML */
  origin: 'feed' | 'page';
  /** Étiquettes de catégorie connues (pour détecter une description = catégorie) */
  categories?: string[];
  /** Signalé par l'appelant si le texte est identique à celui d'autres pages (contenu générique) */
  genericSuspected?: boolean;
  /** Correspondance (0..1) entre le titre extrait de la page et le titre du flux */
  pageTitleMatch?: number | null;
}

export interface ContentLevelResult {
  level: ContentLevelCode;
  reasons: string[];
  metrics: { chars: number; words: number; titleCoverage: number | null };
}

const STOPWORDS = new Set(
  'the a an and or of to in on for with from by at as is are be this that its it into how new our your we you via using über les des une pour avec dans sur par aux'.split(' '),
);

export function significantTokens(s: string): string[] {
  return (s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+/g) ?? []).filter(
    (w) => w.length > 2 && !STOPWORDS.has(w),
  );
}

/** Mots significatifs du titre présents dans le texte. */
export function titleTokensFound(title: string, text: string): { found: number; total: number } {
  const t = [...new Set(significantTokens(title))];
  const words = new Set(significantTokens(text));
  return { found: t.filter((w) => words.has(w)).length, total: t.length };
}

/** Part des mots significatifs du titre présents dans le texte (0..1). */
export function titleCoverage(title: string, text: string): number | null {
  const { found, total } = titleTokensFound(title, text);
  return total === 0 ? null : found / total;
}

const norm = (s: string) => s.toLowerCase().replace(/\W+/g, ' ').trim();

export function classifyContent(input: ContentLevelInput): ContentLevelResult {
  const T = CONTENT_LEVEL_THRESHOLDS;
  const text = input.text.replace(/\s+/g, ' ').trim();
  const chars = text.length;
  const words = text ? text.split(' ').length : 0;
  const coverage = input.origin === 'page' ? titleCoverage(input.title, text) : null;
  const reasons: string[] = [];
  const metrics = { chars, words, titleCoverage: coverage === null ? null : Math.round(coverage * 100) / 100 };

  // --- Contrôles de qualité : le texte doit être un vrai contenu de l'article ---
  if (chars === 0) {
    return { level: 'MINIMAL', reasons: ['Aucun texte disponible : titre et métadonnées uniquement'], metrics };
  }
  if ((input.categories ?? []).some((c) => norm(c) === norm(text))) {
    return { level: 'MINIMAL', reasons: ['Le texte est une simple étiquette de catégorie'], metrics };
  }
  if (norm(text) === norm(input.title) || norm(text).length <= norm(input.title).length) {
    return { level: 'MINIMAL', reasons: ['Le texte ne fait que répéter le titre (ou est plus court que lui)'], metrics };
  }
  if (input.genericSuspected) {
    return { level: 'MINIMAL', reasons: ['Texte identique à celui d’autres pages : contenu générique, pas l’article'], metrics };
  }
  if (input.origin === 'page' && coverage !== null) {
    const { found } = titleTokensFound(input.title, text);
    const pct = Math.round(coverage * 100);
    const byCoverage = coverage >= T.MIN_TITLE_COVERAGE;
    const byTokens = found >= T.MIN_TITLE_TOKENS_FOUND && (input.pageTitleMatch ?? 0) >= T.MIN_PAGE_TITLE_MATCH;
    if (!byCoverage && !byTokens) {
      return {
        level: 'MINIMAL',
        reasons: [`Le texte extrait ne correspond pas à l’article (couverture du titre ${pct} % < ${T.MIN_TITLE_COVERAGE * 100} %, ${found} mot(s) du titre retrouvé(s))`],
        metrics,
      };
    }
    reasons.push(
      byCoverage
        ? `Correspondance avec l’article vérifiée (couverture du titre ${pct} %)`
        : `Correspondance avec l’article vérifiée par la règle « titre long » (couverture du titre ${pct} %, ${found} mots retrouvés, titre de page conforme au flux)`,
    );
  }

  // --- Volume ---
  if (chars >= T.FULL_MIN_CHARS && words >= T.FULL_MIN_WORDS) {
    reasons.push(`${chars} caractères / ${words} mots ≥ seuil FULL (${T.FULL_MIN_CHARS} car. / ${T.FULL_MIN_WORDS} mots)`);
    return { level: 'FULL', reasons, metrics };
  }
  if (chars >= T.PARTIAL_MIN_CHARS && words >= T.PARTIAL_MIN_WORDS) {
    reasons.push(`${chars} caractères / ${words} mots : extrait exploitable mais < seuil FULL`);
    return { level: 'PARTIAL', reasons, metrics };
  }
  reasons.push(`${chars} caractères / ${words} mots < seuil PARTIAL (${T.PARTIAL_MIN_CHARS} car. / ${T.PARTIAL_MIN_WORDS} mots)`);
  return { level: 'MINIMAL', reasons, metrics };
}
