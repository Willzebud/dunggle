/**
 * Règles de contenu, de placement et de suppression des résumés, appliquées à une sortie DÉJÀ validée.
 * Copiées à l'identique du POC 2 (pipeline.ts), validées en B3 : toute évolution est explicite et testée
 * (docs/backend-design.md § 8). Jamais de correction du texte : suppression tracée dans `violations`.
 */
import { coverageFor, type CoveragePolicy } from '../config/coverage.js';
import type { ResolvedInput } from './content-policy.js';
import { SYSTEM_PROMPT } from './prompt.js';
import type { AnalysisOutput, PublicationInput, Section } from './types.js';

export interface RulesResult {
  analysis: AnalysisOutput;
  section: Section;
  violations: string[];
  /** Résumé supprimé par une règle : conservé pour audit (jamais affiché, jamais réinjecté). */
  droppedSummary?: { summary: string | null; keyPoints: string[]; reasons: string[] };
}

/**
 * Séquence du POC 2 (analyzePublication, étape 6) : règles de contenu, placement, puis suppression des
 * résumés inutiles. `validated` est la sortie acceptée par validateAnalysis().
 */
export function applyRules(pub: PublicationInput, input: ResolvedInput, validated: AnalysisOutput, coverage: CoveragePolicy = coverageFor(pub.sourceId)): RulesResult {
  const content = enforceContentRules(pub, input, validated);
  const placed = computeSection(pub, content.analysis, coverage);
  const final = dropSummaryIfExcluded(placed.section, placed.analysis);
  const violations = [...content.violations, ...placed.violations, ...final.violations];
  const hadSummary = validated.summary !== null || validated.keyPoints.length > 0;
  const lostSummary = hadSummary && final.analysis.summary === null && final.analysis.keyPoints.length === 0;
  const dropped = lostSummary ? { droppedSummary: { summary: validated.summary, keyPoints: validated.keyPoints, reasons: violations } } : {};
  return { analysis: final.analysis, section: placed.section, violations, ...dropped };
}

/** Applique les règles de contenu à la sortie du modèle (corrige et trace ; ne fait jamais confiance au modèle). */
export function enforceContentRules(pub: PublicationInput, input: ResolvedInput, a: AnalysisOutput): { analysis: AnalysisOutput; violations: string[] } {
  const out = { ...a, keyPoints: [...a.keyPoints] };
  const violations: string[] = [];
  const hasSummary = out.summary !== null || out.keyPoints.length > 0;

  if (!input.summaryAllowed && hasSummary) {
    violations.push(`summary-forbidden (${input.mode})`);
    out.summary = null;
    out.keyPoints = [];
  }
  if (input.summaryLimitedToExcerpt && out.summary && input.text && out.summary.length > input.text.length) {
    violations.push('summary-longer-than-excerpt');
    out.summary = null;
    out.keyPoints = [];
  }
  // Injection : fuite des consignes système ou URL absente de la publication (ex. « contacte https://… »).
  const generated = `${out.summary ?? ''} ${out.keyPoints.join(' ')} ${out.relevanceReason}`;
  const sourceAll = `${pub.title} ${pub.url} ${input.text ?? ''}`;
  if (leaksSystemPrompt(generated)) {
    violations.push('possible-system-prompt-leak');
    out.summary = null;
    out.keyPoints = [];
    out.relevanceReason = '[raison supprimée : reprise possible des consignes système]';
  }
  const foreignUrls = (generated.match(/https?:\/\/[^\s)"'<>]+/g) ?? []).filter((u) => !sourceAll.includes(u.replace(/[.,;]+$/, '')));
  if (foreignUrls.length) {
    violations.push(`ungrounded-url (${foreignUrls.length})`);
    out.summary = null;
    out.keyPoints = [];
    out.relevanceReason = out.relevanceReason.replace(/https?:\/\/[^\s)"'<>]+/g, '[URL supprimée]');
  }
  if (out.summary || out.keyPoints.length) {
    const source = `${pub.title} ${input.text ?? ''}`;
    const ungrounded = ungroundedNumbers(`${out.summary ?? ''} ${out.keyPoints.join(' ')}`, source);
    if (ungrounded.length) {
      violations.push(`ungrounded-number (${ungrounded.join(', ')})`);
      out.summary = null;
      out.keyPoints = [];
    }
  }
  return { analysis: out, violations };
}

/** Nombres (versions, montants, scores) cités dans le résumé mais absents du texte fourni. Contrôle INDICATIF. */
export function ungroundedNumbers(summary: string, source: string): string[] {
  const norm = (s: string) => s.replace(/(\d)[,\s](?=\d{3}\b)/g, '$1').replace(/,/g, '.');
  const src = norm(source);
  const nums = norm(summary).match(/\d+(?:\.\d+)*/g) ?? [];
  return [...new Set(nums.filter((n) => !src.includes(n)))];
}

/**
 * Rubrique du dashboard.
 * - Couverture obligatoire (déterminée par la source) : jamais « excluded » à cause d'un score ou d'un
 *   motif proposé par le modèle, sauf doublon avéré. Placement minimal : « updates ».
 * - Releases et nouveautés faibles des sources obligatoires → « updates » ; versions majeures (novelty ≥ 4) → « main ».
 * - Sources sélectives : exclusion motivée → « excluded » ; compilation marquée → « updates » ; sinon « main ».
 * Les scores (relevance, novelty) n'excluent jamais à eux seuls une publication.
 */
export function computeSection(
  pub: PublicationInput,
  a: AnalysisOutput,
  coverage: CoveragePolicy = coverageFor(pub.sourceId),
): { section: Section; violations: string[]; analysis: AnalysisOutput } {
  const isRelease = a.type === 'release' || pub.sourceType === 'github-releases';
  if (coverage === 'mandatory') {
    if (a.exclusionReason === 'duplicate') return { section: 'excluded', violations: [], analysis: a };
    if (a.exclusionReason) {
      return { section: 'updates', violations: [`mandatory-coverage-exclusion-overridden (${a.exclusionReason})`], analysis: { ...a, exclusionReason: null } };
    }
    if (isRelease && a.novelty >= 4) return { section: 'main', violations: [], analysis: a };
    if (isRelease || a.novelty <= 2) return { section: 'updates', violations: [], analysis: a };
    return { section: 'main', violations: [], analysis: a };
  }
  if (a.exclusionReason) return { section: 'excluded', violations: [], analysis: a };
  if (pub.editorial?.action === 'flagged') return { section: 'updates', violations: [], analysis: a };
  return { section: 'main', violations: [], analysis: a };
}

/**
 * Une publication exclue n'a pas besoin de résumé : il est supprimé (et l'écart tracé si le modèle en a
 * produit un malgré la consigne). Limite d'un appel unique : le résumé éventuel est généré (et facturé)
 * avant que la décision d'exclusion ne soit connue ; la consigne demande au modèle de s'en abstenir.
 */
export function dropSummaryIfExcluded(section: Section, a: AnalysisOutput): { analysis: AnalysisOutput; violations: string[] } {
  if (section !== 'excluded' || (a.summary === null && a.keyPoints.length === 0)) return { analysis: a, violations: [] };
  return { analysis: { ...a, summary: null, keyPoints: [] }, violations: ['summary-on-excluded-dropped'] };
}

/** Détecte la reprise d'un passage des consignes système (fenêtre glissante de 50 caractères). */
export function leaksSystemPrompt(text: string, window = 50): boolean {
  const norm = (x: string) => x.replace(/\s+/g, ' ').toLowerCase();
  const t = norm(text);
  const sys = norm(SYSTEM_PROMPT);
  if (t.length < window) return false;
  for (let i = 0; i + window <= sys.length; i += 25) if (t.includes(sys.slice(i, i + window))) return true;
  return false;
}
