import { BudgetRefusedError, type BudgetGuard } from './budget/guard.js';
import { ProviderError, RealCallsDisabledError, type AIAdapter } from './adapters/types.js';
import { resolveInput, type ResolvedInput } from './content-policy.js';
import { buildPrompt } from './prompt.js';
import { ANALYSIS_JSON_SCHEMA, validateAnalysis } from './schema.js';
import { PRIORITY_THEMES } from './taxonomy.js';
import type { AnalysisOutput, AnalysisRecord, PublicationInput, Section } from './types.js';

export interface PipelineDeps {
  adapter: AIAdapter;
  guard: BudgetGuard;
  scope?: 'trial' | 'operational';
  /** Analyser aussi les publications exclues par une règle éditoriale (récupération). Défaut : non. */
  analyzeEditorialExcluded?: boolean;
}

/**
 * Analyse une publication. Ne lève jamais pour une erreur prévisible : renvoie toujours un
 * AnalysisRecord qui conserve l'URL originale ; une publication non analysée reste « pending ».
 */
export async function analyzePublication(pub: PublicationInput, deps: PipelineDeps): Promise<AnalysisRecord> {
  const input = resolveInput(pub);
  const rec: AnalysisRecord = {
    publicationId: pub.id,
    sourceId: pub.sourceId,
    url: pub.url,
    title: pub.title,
    synthetic: pub.synthetic,
    contentLevel: pub.contentLevel,
    contentPolicy: input.policy,
    inputMode: input.mode,
    status: 'analyzed',
    section: 'pending',
    analysis: null,
    violations: [],
    model: deps.adapter.model.key,
    costEur: null,
    costUncertain: false,
  };

  if (input.mode === 'none') return { ...rec, status: 'skipped-blocked', model: null };
  if (pub.editorial?.action === 'excluded' && !deps.analyzeEditorialExcluded) {
    return { ...rec, status: 'skipped-editorial', section: 'excluded', model: null, error: `Règle éditoriale ${pub.editorial.ruleId} (récupérable)` };
  }

  const prompt = buildPrompt(pub, input);
  const maxOut = deps.guard.limits.maxOutputTokensPerRequest;

  let reservationId: string;
  try {
    reservationId = (await deps.guard.reserve({ modelKey: deps.adapter.model.key, inputTokensEstimate: prompt.inputTokensEstimate, maxOutputTokens: maxOut, scope: deps.scope ?? 'trial' })).id;
  } catch (e) {
    if (e instanceof BudgetRefusedError) {
      return { ...rec, status: e.code === 'unknown-pricing' ? 'refused-unknown-pricing' : 'refused-budget', error: `${e.code} : ${e.message}` };
    }
    throw e;
  }

  let rawText: string;
  try {
    const res = await deps.adapter.analyze({ system: prompt.system, user: prompt.user, schema: ANALYSIS_JSON_SCHEMA, maxOutputTokens: maxOut });
    rawText = res.rawText;
    if (res.usage) rec.costEur = await deps.guard.reconcile(reservationId, res.usage);
    else {
      rec.costEur = await deps.guard.markUncertain(reservationId, 'usage absent de la réponse');
      rec.costUncertain = true;
    }
  } catch (e) {
    if (e instanceof RealCallsDisabledError) {
      await deps.guard.release(reservationId, e.message);
      return { ...rec, status: 'provider-error', costEur: 0, error: e.message };
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
      return { ...rec, status: 'provider-error', error: `${e.kind} : ${e.message}` };
    }
    // Erreur inattendue : coût inconnu → facturé au maximum, par prudence.
    rec.costEur = await deps.guard.markUncertain(reservationId, `erreur inattendue : ${(e as Error).message}`);
    return { ...rec, status: 'provider-error', costUncertain: true, error: (e as Error).message };
  }

  const v = validateAnalysis(rawText);
  if (!v.ok || !v.value) return { ...rec, status: 'invalid-output', error: v.errors.join(' ; ') };

  const { analysis, violations } = enforceContentRules(pub, input, v.value);
  const { section, violations: v2, analysis: finalAnalysis } = computeSection(pub, analysis);
  return { ...rec, analysis: finalAnalysis, section, violations: [...violations, ...v2] };
}

/** Applique les règles de contenu à la sortie du modèle (corrige et trace, ne fait jamais confiance au modèle). */
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

/** Nombres (versions, montants, scores) cités dans le résumé mais absents du texte fourni. */
export function ungroundedNumbers(summary: string, source: string): string[] {
  const norm = (s: string) => s.replace(/(\d)[,\s](?=\d{3}\b)/g, '$1').replace(/,/g, '.');
  const src = norm(source);
  const nums = norm(summary).match(/\d+(?:\.\d+)*/g) ?? [];
  return [...new Set(nums.filter((n) => !src.includes(n)))];
}

/** Rubrique du dashboard. Les releases des thématiques prioritaires restent visibles (« updates »). */
export function computeSection(pub: PublicationInput, a: AnalysisOutput): { section: Section; violations: string[]; analysis: AnalysisOutput } {
  const priority = a.themes.some((t) => PRIORITY_THEMES.includes(t));
  const isRelease = a.type === 'release' || pub.sourceType === 'github-releases';
  if (a.exclusionReason) {
    if (priority && isRelease && a.exclusionReason !== 'duplicate') {
      return { section: 'updates', violations: [`priority-release-exclusion-overridden (${a.exclusionReason})`], analysis: { ...a, exclusionReason: null } };
    }
    return { section: 'excluded', violations: [], analysis: a };
  }
  // Releases mineures/intermédiaires et nouveautés faibles des thématiques prioritaires : rubrique « Mises à jour ».
  // Les versions majeures (novelty ≥ 4) remontent dans le flux principal.
  if (priority && ((isRelease && a.novelty <= 3) || a.novelty <= 2)) return { section: 'updates', violations: [], analysis: a };
  if (pub.editorial?.action === 'flagged') return { section: 'updates', violations: [], analysis: a };
  return { section: 'main', violations: [], analysis: a };
}
