import { BudgetRefusedError, type BudgetGuard } from './budget/guard.js';
import { ProviderError, RealCallsDisabledError, type AIAdapter } from './adapters/types.js';
import { resolveInput, type ResolvedInput } from './content-policy.js';
import { coverageFor, type CoveragePolicy } from './config/coverage.js';
import { buildPrompt, PROMPT_VERSION, SYSTEM_PROMPT } from './prompt.js';
import { redactSecrets } from './security/redact.js';
import { ANALYSIS_JSON_SCHEMA, validateAnalysis } from './schema.js';
import type { AnalysisOutput, AnalysisRecord, AnalysisStatus, PublicationInput, Section } from './types.js';

export interface PipelineDeps {
  adapter: AIAdapter;
  guard: BudgetGuard;
  scope?: 'trial' | 'operational';
  /** Analyser aussi les publications exclues par une règle éditoriale (récupération). Défaut : non. */
  analyzeEditorialExcluded?: boolean;
}

/** Clé d'idempotence : une analyse = un modèle × une publication × une version du protocole. */
export function analysisKey(modelKey: string, publicationId: string): string {
  return `${modelKey}|${publicationId}|${PROMPT_VERSION}`;
}

/** Statuts pour lesquels la publication n'a pas pu être analysée (elle reste conservée). */
const UNANALYZED: AnalysisStatus[] = ['refused-budget', 'refused-unknown-pricing', 'provider-error', 'invalid-output'];

/**
 * Analyse une publication en UN SEUL appel (classification + résumé éventuel).
 * Ne lève jamais pour une erreur prévisible : renvoie toujours un AnalysisRecord qui conserve l'URL originale.
 */
export async function analyzePublication(pub: PublicationInput, deps: PipelineDeps): Promise<AnalysisRecord> {
  const input = resolveInput(pub);
  const coverage = coverageFor(pub.sourceId);
  const rec: AnalysisRecord = {
    publicationId: pub.id,
    sourceId: pub.sourceId,
    url: pub.url,
    title: pub.title,
    synthetic: pub.synthetic,
    contentLevel: pub.contentLevel,
    contentPolicy: input.policy,
    coveragePolicy: coverage,
    inputMode: input.mode,
    status: 'analyzed',
    section: 'pending',
    analysis: null,
    violations: [],
    model: deps.adapter.model.key,
    costEur: null,
    costUncertain: false,
  };
  // Une publication non analysée d'une source à couverture obligatoire reste visible (« Mises à jour », non analysée).
  const unanalyzed = (r: AnalysisRecord): AnalysisRecord =>
    UNANALYZED.includes(r.status) && coverage === 'mandatory' ? { ...r, section: 'updates', violations: [...r.violations, 'mandatory-coverage-unanalyzed'] } : r;

  // 1. Restriction de contenu : jamais neutralisée, même pour une couverture obligatoire.
  if (input.mode === 'none') return { ...rec, status: 'skipped-blocked', model: null };
  // 2. Exclusion éditoriale déterministe explicitement justifiée : prioritaire sur la couverture obligatoire.
  if (pub.editorial?.action === 'excluded' && !deps.analyzeEditorialExcluded) {
    return { ...rec, status: 'skipped-editorial', section: 'excluded', model: null, error: `Règle éditoriale ${pub.editorial.ruleId} (récupérable)` };
  }

  const prompt = buildPrompt(pub, input);
  const maxOut = deps.guard.limits.maxOutputTokensPerRequest;

  // 3. Réservation du coût MAXIMAL avant l'appel, avec revendication atomique de l'analyse (idempotence).
  const key = analysisKey(deps.adapter.model.key, pub.id);
  let reservationId: string;
  try {
    reservationId = (await deps.guard.reserve({ modelKey: deps.adapter.model.key, inputTokensEstimate: prompt.inputTokensUpperBound, maxOutputTokens: maxOut, scope: deps.scope ?? 'trial', idempotencyKey: key })).id;
  } catch (e) {
    if (e instanceof BudgetRefusedError) {
      if (e.code === 'duplicate-analysis') return { ...rec, status: 'skipped-duplicate', error: e.message };
      return unanalyzed({ ...rec, status: e.code === 'unknown-pricing' ? 'refused-unknown-pricing' : 'refused-budget', error: `${e.code} : ${e.message}` });
    }
    throw e;
  }
  const finish = async (r: AnalysisRecord): Promise<AnalysisRecord> => {
    const safe = r.error ? { ...r, error: redactSecrets(r.error) } : r;
    // Résultat attaché à l'analyse (sauf si la réservation a été libérée : la clé n'existe plus).
    if (await deps.guard.getAnalysis(key)) await deps.guard.recordResult(key, safe);
    return safe;
  };

  // 4. Appel et comptabilité.
  let rawText: string;
  try {
    const res = await deps.adapter.analyze({ system: prompt.system, user: prompt.user, schema: ANALYSIS_JSON_SCHEMA, maxOutputTokens: maxOut });
    rawText = res.rawText;
    rec.usage = { billable: res.usage, raw: res.rawUsage ?? null };
    rec.stopReason = res.stopReason;
    if (res.usage) rec.costEur = await deps.guard.reconcile(reservationId, res.usage);
    else {
      rec.costEur = await deps.guard.markUncertain(reservationId, 'usage absent de la réponse');
      rec.costUncertain = true;
    }
  } catch (e) {
    if (e instanceof RealCallsDisabledError) {
      await deps.guard.release(reservationId, e.message);
      return finish(unanalyzed({ ...rec, status: 'provider-error', costEur: 0, error: e.message }));
    }
    if (e instanceof ProviderError) {
      if (!e.requestSent) {
        await deps.guard.release(reservationId, `${e.kind} avant envoi`);
        rec.costEur = 0;
      } else if (e.usage) {
        rec.costEur = await deps.guard.reconcile(reservationId, e.usage);
      } else {
        rec.costEur = await deps.guard.markUncertain(reservationId, `${e.kind} : ${e.message}`);
        rec.costUncertain = true;
      }
      return finish(unanalyzed({ ...rec, status: 'provider-error', error: `${e.kind} : ${e.message}` }));
    }
    rec.costEur = await deps.guard.markUncertain(reservationId, `erreur inattendue : ${(e as Error).message}`);
    return finish(unanalyzed({ ...rec, status: 'provider-error', costUncertain: true, error: (e as Error).message }));
  }

  // 5. Validation stricte de la sortie.
  const v = validateAnalysis(rawText);
  if (!v.ok || !v.value) return finish(unanalyzed({ ...rec, status: 'invalid-output', error: v.errors.join(' ; ') }));

  // 6. Règles de contenu, placement, puis suppression des résumés inutiles.
  const content = enforceContentRules(pub, input, v.value);
  const placed = computeSection(pub, content.analysis, coverage);
  const final = dropSummaryIfExcluded(placed.section, placed.analysis);
  return finish({ ...rec, analysis: final.analysis, section: placed.section, violations: [...content.violations, ...placed.violations, ...final.violations] });
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
