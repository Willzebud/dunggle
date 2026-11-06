/**
 * Indicateurs de comparaison des modèles (phase B.2), calculés HORS LIGNE à partir des enregistrements
 * d'analyse et de la vérité de référence. Aucun LLM évaluateur ; les contrôles de résumé restent indicatifs
 * et la revue humaine (grille à l'aveugle) fait foi.
 *
 * Conventions :
 * - Une publication non analysée (erreur, refus, sortie invalide) compte comme un ÉCHEC dans les rappels
 *   (prudence) et apparaît dans les erreurs ; elle n'est pas comptée comme une prédiction dans les précisions.
 * - Les décisions « ambiguous » sont exclues des précisions/rappels et rapportées à part.
 * - Thèmes, types, pertinence, nouveauté : évalués sur les publications `must_keep` analysées et conservées.
 */
import { autoCheckSummary, type AutoVerdict, type CriterionId } from './summary-checks.js';
import type { AnalysisRecord, PublicationInput } from '../types.js';

export interface GroundTruthItem {
  id: string;
  editorialDecision: 'must_keep' | 'must_exclude' | 'ambiguous';
  coveragePolicy: 'mandatory' | 'selective';
  themes: string[];
  acceptableExtraThemes: string[];
  types: string[];
  relevance: 'high' | 'medium' | 'low';
  novelty: [number, number];
  sections: string[];
  summaryAllowed: boolean;
  summaryExpected: boolean | 'if-kept';
  referenceFacts?: string[];
  forbiddenClaims?: string[];
}

export const RELEVANCE_BANDS = { high: [70, 100], medium: [40, 69], low: [0, 39] } as const;

/** Volume mensuel estimé (POC 1.2 : ~390 publications/mois) et quota mensuel de production. */
export const MONTHLY_VOLUME = { estimated: 390, productionQuota: 500 } as const;

export interface Timing {
  modelKey: string;
  publicationId: string;
  ms: number;
}

interface PR {
  precision: number | null;
  recall: number | null;
  tp: number;
  fp: number;
  fn: number;
}

export interface ModelMetrics {
  model: string;
  records: number;
  statuses: Record<string, number>;
  errors: { publicationId: string; status: string; error: string | null }[];
  keep: PR;
  exclude: PR;
  ambiguous: { kept: number; excluded: number; unanalyzed: number };
  mandatoryCoverage: { total: number; visible: number; analyzed: number; missing: string[] };
  themes: { evaluated: number; exactAcceptable: number; microPrecision: number | null; microRecall: number | null };
  subthemes: { distribution: Record<string, number>; note: string };
  types: { evaluated: number; acceptable: number; primary: number; confusion: Record<string, number> };
  relevance: { evaluated: number; inBand: number; meanDistanceToBand: number | null };
  novelty: { evaluated: number; inRange: number; meanDistanceToRange: number | null };
  sections: { evaluated: number; correct: number };
  summaries: { expected: number; produced: number; forbiddenWhenNotAllowed: number; criteria: Record<string, Record<AutoVerdict, number>> };
  cost: { totalEur: number; analyzed: number; avgPerPublicationEur: number | null; projectedMonthlyEur: { estimated: number | null; productionQuota: number | null }; avgInputTokens: number | null; avgOutputTokens: number | null; avgReasoningTokens: number | null };
  time: { calls: number; avgMs: number | null; medianMs: number | null; p95Ms: number | null };
}

const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 1000 : null);
const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 1000) / 1000 : null);
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
};
const dist = (v: number, [lo, hi]: readonly [number, number]) => (v < lo ? lo - v : v > hi ? v - hi : 0);

const isKept = (r: AnalysisRecord) => r.status === 'analyzed' && r.analysis !== null && r.analysis.exclusionReason === null;
const isExcluded = (r: AnalysisRecord) => r.status === 'analyzed' && r.analysis !== null && r.analysis.exclusionReason !== null;

function pr(tp: number, fp: number, fn: number): PR {
  return { precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), tp, fp, fn };
}

export function computeModelMetrics(
  model: string,
  records: AnalysisRecord[],
  gt: GroundTruthItem[],
  pubs: PublicationInput[],
  timings: Timing[] = [],
): ModelMetrics {
  const byId = new Map(records.map((r) => [r.publicationId, r]));
  const statuses: Record<string, number> = {};
  for (const r of records) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
  const errors = records.filter((r) => r.status !== 'analyzed').map((r) => ({ publicationId: r.publicationId, status: r.status, error: r.error ?? null }));

  let kTp = 0, kFp = 0, kFn = 0, eTp = 0, eFp = 0, eFn = 0;
  const ambiguous = { kept: 0, excluded: 0, unanalyzed: 0 };
  const mandatory = { total: 0, visible: 0, analyzed: 0, missing: [] as string[] };
  const themes = { evaluated: 0, exactAcceptable: 0, tp: 0, fp: 0, fn: 0 };
  const subDist: Record<string, number> = {};
  const types = { evaluated: 0, acceptable: 0, primary: 0, confusion: {} as Record<string, number> };
  const relevance = { evaluated: 0, inBand: 0, d: [] as number[] };
  const novelty = { evaluated: 0, inRange: 0, d: [] as number[] };
  const sections = { evaluated: 0, correct: 0 };
  const summaries = { expected: 0, produced: 0, forbiddenWhenNotAllowed: 0, criteria: {} as Record<string, Record<AutoVerdict, number>> };

  for (const g of gt) {
    const r = byId.get(g.id);
    if (!r) continue; // publication non planifiée pour ce modèle (ex. inéligible)
    const kept = isKept(r);
    const excluded = isExcluded(r);
    if (g.editorialDecision === 'must_keep') {
      if (kept) kTp++;
      else kFn++;
      if (excluded) eFp++;
    } else if (g.editorialDecision === 'must_exclude') {
      if (excluded) eTp++;
      else eFn++;
      if (kept) kFp++;
    } else {
      if (kept) ambiguous.kept++;
      else if (excluded) ambiguous.excluded++;
      else ambiguous.unanalyzed++;
    }

    if (g.coveragePolicy === 'mandatory') {
      mandatory.total++;
      if (r.section === 'main' || r.section === 'updates') mandatory.visible++;
      else mandatory.missing.push(g.id);
      if (r.status === 'analyzed') mandatory.analyzed++;
    }

    if (r.section) {
      sections.evaluated++;
      if (g.sections.includes(r.section)) sections.correct++;
    }

    const a = r.analysis;
    if (a) for (const s of a.subthemes) subDist[s] = (subDist[s] ?? 0) + 1;
    if (g.editorialDecision === 'must_keep' && a && kept) {
      themes.evaluated++;
      const allowed = new Set([...g.themes, ...g.acceptableExtraThemes]);
      const pred = new Set<string>(a.themes);
      if (g.themes.every((t) => pred.has(t)) && [...pred].every((t) => allowed.has(t))) themes.exactAcceptable++;
      // Thème attendu trouvé : TP ; thème toléré (acceptableExtraThemes) : neutre ; autre thème : FP.
      for (const t of pred) {
        if (g.themes.includes(t)) themes.tp++;
        else if (!allowed.has(t)) themes.fp++;
      }
      for (const t of g.themes) if (!pred.has(t)) themes.fn++;
      types.evaluated++;
      if (g.types.includes(a.type)) types.acceptable++;
      if (g.types[0] === a.type) types.primary++;
      else {
        const k = `${g.types[0]} → ${a.type}`;
        types.confusion[k] = (types.confusion[k] ?? 0) + 1;
      }
      relevance.evaluated++;
      const band = RELEVANCE_BANDS[g.relevance];
      if (dist(a.relevance, band) === 0) relevance.inBand++;
      relevance.d.push(dist(a.relevance, band));
      novelty.evaluated++;
      if (dist(a.novelty, g.novelty) === 0) novelty.inRange++;
      novelty.d.push(dist(a.novelty, g.novelty));
    }

    // Résumés : respect du droit au résumé (fiable) et contrôles indicatifs quand un résumé est attendu.
    if (a?.summary && !g.summaryAllowed) summaries.forbiddenWhenNotAllowed++;
    const expected = g.summaryExpected === true || (g.summaryExpected === 'if-kept' && kept);
    if (expected) {
      summaries.expected++;
      if (a?.summary) summaries.produced++;
      const pub = pubs.find((p) => p.id === g.id);
      for (const c of autoCheckSummary({ summary: a?.summary ?? null, keyPoints: a?.keyPoints ?? [], sourceText: pub?.text ?? null, title: pub?.title ?? '', summaryExpected: g.summaryExpected, kept, excerptLimited: r.inputMode === 'excerpt', referenceFacts: g.referenceFacts, forbiddenClaims: g.forbiddenClaims })) {
        const bucket = (summaries.criteria[c.criterion as CriterionId] ??= { pass: 0, warn: 0, fail: 0, 'n/a': 0 });
        bucket[c.verdict]++;
      }
    }
  }

  const analyzed = records.filter((r) => r.status === 'analyzed');
  const billed = records.filter((r) => r.costEur !== null);
  const totalEur = Math.round(billed.reduce((s, r) => s + (r.costEur ?? 0), 0) * 1e6) / 1e6;
  const avg = analyzed.length ? totalEur / analyzed.length : null;
  const usages = records.map((r) => r.usage?.billable).filter((u): u is NonNullable<typeof u> => !!u);
  const ms = timings.filter((t) => t.modelKey === model).map((t) => t.ms);

  return {
    model,
    records: records.length,
    statuses,
    errors,
    keep: pr(kTp, kFp, kFn),
    exclude: pr(eTp, eFp, eFn),
    ambiguous,
    mandatoryCoverage: mandatory,
    themes: { evaluated: themes.evaluated, exactAcceptable: themes.exactAcceptable, microPrecision: ratio(themes.tp, themes.tp + themes.fp), microRecall: ratio(themes.tp, themes.tp + themes.fn) },
    subthemes: { distribution: subDist, note: 'Pas de sous-thèmes dans la vérité de référence : évaluation par revue humaine uniquement.' },
    types,
    relevance: { evaluated: relevance.evaluated, inBand: relevance.inBand, meanDistanceToBand: mean(relevance.d) },
    novelty: { evaluated: novelty.evaluated, inRange: novelty.inRange, meanDistanceToRange: mean(novelty.d) },
    sections,
    summaries,
    cost: {
      totalEur,
      analyzed: analyzed.length,
      avgPerPublicationEur: avg === null ? null : Math.round(avg * 1e6) / 1e6,
      projectedMonthlyEur: {
        estimated: avg === null ? null : Math.round(avg * MONTHLY_VOLUME.estimated * 1e4) / 1e4,
        productionQuota: avg === null ? null : Math.round(avg * MONTHLY_VOLUME.productionQuota * 1e4) / 1e4,
      },
      avgInputTokens: mean(usages.map((u) => u.inputTokens)),
      avgOutputTokens: mean(usages.map((u) => u.outputTokens)),
      avgReasoningTokens: mean(usages.map((u) => u.reasoningTokens ?? 0)),
    },
    time: { calls: ms.length, avgMs: mean(ms), medianMs: quantile(ms, 0.5), p95Ms: quantile(ms, 0.95) },
  };
}

/** Dernier enregistrement par (modèle, publication), dans l'ordre chronologique des exécutions. */
export function latestRecords(runs: { records: AnalysisRecord[] }[]): Map<string, AnalysisRecord[]> {
  const last = new Map<string, AnalysisRecord>();
  for (const run of runs) for (const r of run.records) if (r.model) last.set(`${r.model}|${r.publicationId}`, r);
  const byModel = new Map<string, AnalysisRecord[]>();
  for (const r of last.values()) {
    if (!byModel.has(r.model!)) byModel.set(r.model!, []);
    byModel.get(r.model!)!.push(r);
  }
  return byModel;
}

/**
 * Grille de revue humaine À L'AVEUGLE : pour chaque publication résumée par au moins un modèle, les résumés
 * sont présentés sous des étiquettes A/B tirées au hasard ; la correspondance est fournie séparément.
 */
export function blindReviewGrid(byModel: Map<string, AnalysisRecord[]>, gt: GroundTruthItem[], pubs: PublicationInput[], rand: () => number = Math.random) {
  const models = [...byModel.keys()];
  const items: unknown[] = [];
  const key: Record<string, Record<string, string>> = {};
  for (const g of gt) {
    const outs = models.map((m) => ({ m, r: byModel.get(m)!.find((r) => r.publicationId === g.id) })).filter((x) => x.r?.analysis?.summary);
    if (!outs.length) continue;
    const shuffled = [...outs].sort(() => rand() - 0.5);
    const pub = pubs.find((p) => p.id === g.id);
    key[g.id] = {};
    items.push({
      publicationId: g.id,
      title: pub?.title ?? null,
      sourceText: pub?.synthetic ? pub.text ?? null : '(texte non conservé : se référer à la source)',
      referenceFacts: g.referenceFacts ?? [],
      forbiddenClaims: g.forbiddenClaims ?? [],
      candidates: shuffled.map((x, i) => {
        const label = String.fromCharCode(65 + i);
        key[g.id][label] = x.m;
        return {
          label,
          summary: x.r!.analysis!.summary,
          keyPoints: x.r!.analysis!.keyPoints,
          scores: { factual_accuracy: null, essential_information: null, no_invented_claims: null, content_level_respect: null, french_quality: null, concision_usefulness: null },
          comment: '',
        };
      }),
      preferred: null,
    });
  }
  return {
    grid: {
      description: 'Revue humaine à l’aveugle des résumés B.2. Notes : 0 = insuffisant, 1 = acceptable, 2 = bon. Ne pas ouvrir le fichier de correspondance avant la fin de la revue.',
      criteria: ['factual_accuracy', 'essential_information', 'no_invented_claims', 'content_level_respect', 'french_quality', 'concision_usefulness'],
      reviewer: null,
      reviewedAt: null,
      items,
    },
    key,
  };
}

const pct = (x: number | null) => (x === null ? 'n/d' : `${Math.round(x * 1000) / 10} %`);
const frac = (a: number, b: number) => `${a}/${b}${b ? ` (${Math.round((a / b) * 1000) / 10} %)` : ''}`;

export function comparisonMarkdown(metrics: ModelMetrics[]): string {
  const rows: [string, (m: ModelMetrics) => string][] = [
    ['Enregistrements', (m) => String(m.records)],
    ['Statuts', (m) => Object.entries(m.statuses).map(([k, v]) => `${k} ${v}`).join(', ')],
    ['Conservation — précision / rappel', (m) => `${pct(m.keep.precision)} / ${pct(m.keep.recall)}`],
    ['Exclusion — précision / rappel', (m) => `${pct(m.exclude.precision)} / ${pct(m.exclude.recall)}`],
    ['Ambiguës (conservées / exclues / non analysées)', (m) => `${m.ambiguous.kept} / ${m.ambiguous.excluded} / ${m.ambiguous.unanalyzed}`],
    ['Couverture obligatoire visible', (m) => frac(m.mandatoryCoverage.visible, m.mandatoryCoverage.total)],
    ['Thèmes exacts (tolérances incluses)', (m) => frac(m.themes.exactAcceptable, m.themes.evaluated)],
    ['Thèmes — précision / rappel (micro)', (m) => `${pct(m.themes.microPrecision)} / ${pct(m.themes.microRecall)}`],
    ['Type acceptable / type principal', (m) => `${frac(m.types.acceptable, m.types.evaluated)} / ${frac(m.types.primary, m.types.evaluated)}`],
    ['Pertinence dans la bande / écart moyen', (m) => `${frac(m.relevance.inBand, m.relevance.evaluated)} / ${m.relevance.meanDistanceToBand ?? 'n/d'}`],
    ['Nouveauté dans l’intervalle / écart moyen', (m) => `${frac(m.novelty.inRange, m.novelty.evaluated)} / ${m.novelty.meanDistanceToRange ?? 'n/d'}`],
    ['Rubrique correcte', (m) => frac(m.sections.correct, m.sections.evaluated)],
    ['Résumés produits / attendus', (m) => `${m.summaries.produced}/${m.summaries.expected}`],
    ['Résumés interdits produits (fiable)', (m) => String(m.summaries.forbiddenWhenNotAllowed)],
    ['Coût total / moyen par publication', (m) => `${m.cost.totalEur} € / ${m.cost.avgPerPublicationEur ?? 'n/d'} €`],
    [`Coût mensuel projeté (${MONTHLY_VOLUME.estimated} / ${MONTHLY_VOLUME.productionQuota} publications)`, (m) => `${m.cost.projectedMonthlyEur.estimated ?? 'n/d'} € / ${m.cost.projectedMonthlyEur.productionQuota ?? 'n/d'} €`],
    ['Tokens moyens (entrée / sortie / raisonnement)', (m) => `${m.cost.avgInputTokens ?? 'n/d'} / ${m.cost.avgOutputTokens ?? 'n/d'} / ${m.cost.avgReasoningTokens ?? 'n/d'}`],
    ['Durée par appel (moyenne / médiane / p95)', (m) => (m.time.calls ? `${m.time.avgMs} / ${m.time.medianMs} / ${m.time.p95Ms} ms` : 'n/d')],
  ];
  const head = `| Indicateur | ${metrics.map((m) => m.model).join(' | ')} |\n|---|${metrics.map(() => '---').join('|')}|`;
  const body = rows.map(([label, f]) => `| ${label} | ${metrics.map(f).join(' | ')} |`).join('\n');
  const crit = metrics.map((m) => `**${m.model}** : ${Object.entries(m.summaries.criteria).map(([c, v]) => `${c} ✓${v.pass} ⚠${v.warn} ✗${v.fail}`).join(' ; ') || 'aucun résumé attendu'}`).join('\n\n');
  const conf = metrics.map((m) => `**${m.model}** : ${Object.entries(m.types.confusion).map(([k, v]) => `${k} ×${v}`).join(', ') || 'aucune'}`).join('\n\n');
  const errs = metrics.map((m) => `**${m.model}** : ${m.errors.map((e) => `${e.publicationId} (${e.status})`).join(', ') || 'aucune'}`).join('\n\n');
  const miss = metrics.map((m) => `**${m.model}** : ${m.mandatoryCoverage.missing.join(', ') || 'aucune'}`).join('\n\n');
  return `${head}\n${body}\n\n### Contrôles de résumé (indicatifs)\n\n${crit}\n\n### Écarts de type (principal attendu → produit)\n\n${conf}\n\n### Couverture obligatoire manquante\n\n${miss}\n\n### Erreurs\n\n${errs}\n`;
}

export interface RunFile {
  file: string;
  args?: { mode?: string };
  phase?: string;
  promptVersion?: string;
  report: { records: AnalysisRecord[]; timings?: Timing[] };
}

/** Exécutions comparables : B.2 (mode full) avec la version courante du prompt. B.1 et anciens prompts : écartés. */
export function selectComparableRuns(runs: RunFile[], promptVersion: string): { kept: RunFile[]; ignored: { file: string; reason: string }[] } {
  const kept: RunFile[] = [];
  const ignored: { file: string; reason: string }[] = [];
  for (const r of runs) {
    if (r.args?.mode !== 'full') ignored.push({ file: r.file, reason: `mode ${r.args?.mode ?? 'inconnu'} (historique B.1, non réutilisé)` });
    else if (r.promptVersion !== promptVersion) ignored.push({ file: r.file, reason: `prompt ${r.promptVersion ?? 'inconnu'} ≠ ${promptVersion}` });
    else kept.push(r);
  }
  return { kept, ignored };
}
