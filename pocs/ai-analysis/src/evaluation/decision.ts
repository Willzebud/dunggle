/**
 * Règle de décision du test final B3 (fixtures/b3/decision-rule.json, figée AVANT les appels réels).
 * Fonction PURE, hors ligne : mêmes entrées, mêmes critères et mêmes seuils pour les deux modèles.
 *
 * Priorités (pondération sur 100) : 1. couverture des actualités importantes ; 2. exactitude factuelle et absence
 * d'invention ; 3. qualité des résumés ; 4. fiabilité des sorties structurées ; 5. classification ; 6. coût et latence.
 *
 * Les critères 2 et 3 reposent sur la revue HUMAINE à l'aveugle. Sans elle, ils sont estimés à partir des contrôles
 * automatiques (indicatifs) et la décision est marquée PROVISOIRE : une estimation automatique n'est jamais
 * présentée comme une évaluation humaine.
 */
import type { AnalysisRecord, PublicationInput } from '../types.js';
import { RELEVANCE_BANDS, relevanceDistance, type GroundTruthItem, type ModelMetrics } from './compare.js';
import { autoCheckSummary, type CriterionId } from './summary-checks.js';

export type CriterionKey = 'importantCoverage' | 'factualAccuracy' | 'summaryQuality' | 'structuredReliability' | 'classification' | 'costLatency';

export interface DecisionRule {
  version: number;
  weights: Record<CriterionKey, number>;
  importantCoverage: { visibleInBand: number; visibleBelowBand: number; visibleAboveBand: number; excludedOrNotAnalyzed: number };
  structuredReliability: { penaltyFactor: number; droppedSummaryWeight: number; droppingViolations: string[] };
  classification: { exclusionDecisions: number; typesAcceptable: number; themesExact: number; noveltyInRange: number; sectionsCorrect: number };
  costLatency: { cost: number; latency: number };
  eliminatory: { importantExcludedMin: number; humanConfirmedInventionsMin: number; invalidOutputsMin: number; projectedMonthlyEurAtProductionQuotaMax: number };
  protocolArtifact: { pattern: string; maxNeutralizedItems: number };
  closeMarginPoints: number;
  tieBreakOrder: CriterionKey[];
  tieBreakMinDifferenceShare: number;
}

export interface ModelEvidence {
  model: string;
  records: AnalysisRecord[];
  metrics: ModelMetrics;
}

/** Notes humaines (0–2) par publication puis par modèle, après levée de l'aveugle, avec les inventions documentées. */
export type HumanNotes = Partial<Record<CriterionId, number | null>> & { inventions?: DocumentedInvention[] };
export type HumanScores = Record<string, Record<string, HumanNotes>>;

export interface ModelScore {
  model: string;
  criteria: Record<CriterionKey, number>;
  total: number;
  eliminations: string[];
  details: {
    importantItems: { id: string; score: number; section: string | null; relevance: number | null }[];
    importantExcluded: number;
    invalidOutputs: number;
    droppedSummaries: number;
    humanConfirmedInventions: number | null;
    summariesExpected: number;
    summariesDelivered: number;
  };
}

export interface DecisionResult {
  ruleVersion: number;
  provisional: boolean;
  provisionalReasons: string[];
  neutralized: { id: string; models: string[] }[];
  summariesInconclusive: boolean;
  scores: ModelScore[];
  chosen: string | null;
  validated: boolean;
  basis: string;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const isKept = (r: AnalysisRecord | undefined) => !!r && r.status === 'analyzed' && !!r.analysis && r.analysis.exclusionReason === null;
const isExcluded = (r: AnalysisRecord | undefined) => !!r && r.status === 'analyzed' && !!r.analysis && r.analysis.exclusionReason !== null;
const AUTO_POINTS: Record<string, number | null> = { pass: 2, warn: 1, fail: 0, 'n/a': null };

/** Publications synthétiques dont une sortie évoque leur caractère fictif ou de test : artefact de protocole. */
export function protocolArtifacts(evidence: ModelEvidence[], pubs: PublicationInput[], pattern: string): { id: string; models: string[] }[] {
  const re = new RegExp(pattern, 'iu');
  const out: { id: string; models: string[] }[] = [];
  for (const p of pubs.filter((x) => x.synthetic)) {
    const models = evidence
      .filter((e) => {
        const a = e.records.find((r) => r.publicationId === p.id)?.analysis;
        return !!a && re.test([a.relevanceReason, a.summary ?? '', ...a.keyPoints].join(' '));
      })
      .map((e) => e.model);
    if (models.length) out.push({ id: p.id, models });
  }
  return out;
}

/** Invention matérielle documentée par le relecteur (seule base possible d'une élimination pour invention). */
export interface DocumentedInvention {
  /** Passage EXACT du résumé ou des points clés du candidat. */
  claim: string;
  /** « absent » : le texte source ne contient pas cette information ; « contradicted » : il dit autre chose. */
  sourceCheck: 'absent' | 'contradicted';
  /** Justification rédigée par le relecteur, en référence au texte source. */
  justification: string;
}

export interface ReviewCandidate {
  label: string;
  summary: string | null;
  keyPoints: string[];
  scores: Record<string, number | null>;
  inventions?: DocumentedInvention[];
  comment?: string;
}
export interface ReviewGrid {
  reviewer: unknown;
  items: { publicationId: string; sourceText: string | null; candidates: ReviewCandidate[] }[];
}

const squash = (x: string) => x.replace(/\s+/g, ' ').trim().toLowerCase();
export const MIN_JUSTIFICATION_CHARS = 20;

/**
 * Validation de la grille AVANT toute lecture de la correspondance A/B : relecteur renseigné, toutes les notes
 * saisies (0, 1 ou 2), et pour chaque note 0 en « absence d'invention » au moins une invention DOCUMENTÉE
 * (passage exact du candidat, vérification « absent » / « contradicted » par rapport au texte source, justification).
 * Une invention documentée exige à l'inverse la note 0. Une simple reformulation ou une omission n'est pas une
 * invention : elle relève des critères « exactitude » ou « informations essentielles » (instructions de la grille).
 */
export function validateReviewGrid(grid: ReviewGrid): string[] {
  const problems: string[] = [];
  if (!grid.reviewer) problems.push('relecteur non renseigné');
  for (const it of grid.items) {
    for (const c of it.candidates) {
      const where = `${it.publicationId} / ${c.label}`;
      for (const [k, v] of Object.entries(c.scores)) if (v !== 0 && v !== 1 && v !== 2) problems.push(`${where} : note « ${k} » manquante ou hors 0–2`);
      const inv = c.inventions ?? [];
      if (c.scores.no_invented_claims === 0 && inv.length === 0) problems.push(`${where} : note 0 en absence d'invention sans invention documentée`);
      if (inv.length > 0 && c.scores.no_invented_claims !== 0) problems.push(`${where} : invention documentée mais note « absence d'invention » ≠ 0`);
      const produced = squash([c.summary ?? '', ...c.keyPoints].join(' '));
      for (const [i, x] of inv.entries()) {
        const w = `${where} invention ${i + 1}`;
        if (!x?.claim?.trim()) problems.push(`${w} : passage absent`);
        else if (!produced.includes(squash(x.claim))) problems.push(`${w} : passage introuvable tel quel dans le résumé ou les points clés du candidat`);
        else if (x.sourceCheck === 'absent' && it.sourceText && squash(it.sourceText).includes(squash(x.claim))) problems.push(`${w} : passage présent tel quel dans le texte source (pas une invention)`);
        if (x?.sourceCheck !== 'absent' && x?.sourceCheck !== 'contradicted') problems.push(`${w} : sourceCheck doit valoir « absent » ou « contradicted »`);
        if (!x?.justification || x.justification.trim().length < MIN_JUSTIFICATION_CHARS) problems.push(`${w} : justification de ${MIN_JUSTIFICATION_CHARS} caractères au moins requise`);
      }
    }
  }
  return problems;
}

/** Notes humaines validées, par publication puis par modèle (lecture de la correspondance APRÈS validation), sinon null. */
export function humanScoresFromGrid(grid: ReviewGrid, key: Record<string, Record<string, string>>): HumanScores | null {
  if (validateReviewGrid(grid).length) return null;
  const out: HumanScores = {};
  for (const it of grid.items) {
    for (const c of it.candidates) {
      const model = key[it.publicationId]?.[c.label];
      if (!model) return null;
      (out[it.publicationId] ??= {})[model] = { ...(c.scores as Record<CriterionId, number>), inventions: c.inventions ?? [] };
    }
  }
  return out;
}
export function decide(evidence: ModelEvidence[], gt: GroundTruthItem[], pubs: PublicationInput[], rule: DecisionRule, human: HumanScores | null): DecisionResult {
  const W = rule.weights;
  const neutralized = protocolArtifacts(evidence, pubs, rule.protocolArtifact.pattern);
  const neutral = new Set(neutralized.map((n) => n.id));
  const summariesInconclusive = neutralized.length > rule.protocolArtifact.maxNeutralizedItems;
  const provisionalReasons: string[] = [];
  if (!human) provisionalReasons.push('revue humaine à l’aveugle absente, incomplète ou invalide : OBLIGATOIRE avant toute décision (scores 2 et 3 seulement estimés, indicatifs)');
  if (summariesInconclusive) provisionalReasons.push(`${neutralized.length} publications neutralisées (artefacts de protocole) > ${rule.protocolArtifact.maxNeutralizedItems} : critères 2 et 3 non concluants, exclus du total`);

  const pubById = new Map(pubs.map((p) => [p.id, p]));
  const minCost = Math.min(...evidence.map((e) => e.metrics.cost.avgPerPublicationEur ?? Infinity));
  const minLatency = Math.min(...evidence.map((e) => e.metrics.time.medianMs ?? Infinity));

  const scores: ModelScore[] = evidence.map((e) => {
    const rec = new Map(e.records.map((r) => [r.publicationId, r]));
    const eliminations: string[] = [];

    // 1. Couverture des actualités importantes.
    const IC = rule.importantCoverage;
    const importantItems = gt
      .filter((g) => g.important && !neutral.has(g.id))
      .map((g) => {
        const r = rec.get(g.id);
        const a = r?.status === 'analyzed' ? r.analysis : null;
        const visible = r?.section === 'main' || r?.section === 'updates';
        let score = IC.excludedOrNotAnalyzed;
        if (a && visible) {
          const d = relevanceDistance(a.relevance, g);
          const lowest = Math.min(...(g.relevanceBands?.length ? g.relevanceBands : [g.relevance]).map((b) => RELEVANCE_BANDS[b][0]));
          score = d === 0 ? IC.visibleInBand : a.relevance < lowest ? IC.visibleBelowBand : IC.visibleAboveBand;
        }
        return { id: g.id, score, section: r?.section ?? null, relevance: a?.relevance ?? null };
      });
    const importantExcluded = importantItems.filter((i) => i.section === 'excluded').length;
    if (importantExcluded >= rule.eliminatory.importantExcludedMin) eliminations.push(`${importantExcluded} actualités importantes exclues (seuil ${rule.eliminatory.importantExcludedMin})`);
    const coverage = W.importantCoverage * (mean(importantItems.map((i) => i.score)) ?? 0);

    // 2 et 3. Résumés : notes humaines si disponibles, sinon contrôles automatiques (indicatifs).
    const notesFor = (g: GroundTruthItem, r: AnalysisRecord): Partial<Record<CriterionId, number | null>> => {
      const h = human?.[g.id]?.[e.model];
      if (h) return h;
      const pub = pubById.get(g.id);
      const auto: Partial<Record<CriterionId, number | null>> = {};
      for (const c of autoCheckSummary({ summary: r.analysis?.summary ?? null, keyPoints: r.analysis?.keyPoints ?? [], sourceText: r.inputMode === 'excerpt' || r.inputMode === 'full' ? (pub?.text ?? null) : null, title: pub?.title ?? '', summaryExpected: true, kept: true, excerptLimited: r.inputMode === 'excerpt', referenceFacts: g.referenceFacts, forbiddenClaims: g.forbiddenClaims })) auto[c.criterion] = AUTO_POINTS[c.verdict];
      return auto;
    };
    const avg = (n: Partial<Record<CriterionId, number | null>>, ks: CriterionId[]) => mean(ks.map((k) => n[k]).filter((v): v is number => typeof v === 'number'));
    const delivered = gt.filter((g) => g.summaryAllowed && !neutral.has(g.id) && !!rec.get(g.id)?.analysis?.summary);
    const factualPerItem = delivered.map((g) => avg(notesFor(g, rec.get(g.id)!), ['factual_accuracy', 'no_invented_claims']) ?? 0);
    const factual = W.factualAccuracy * ((mean(factualPerItem) ?? 0) / 2);
    let inventions: number | null = null;
    if (human) {
      // Seules comptent les inventions DOCUMENTÉES (passage exact, vérification contre la source, justification).
      inventions = delivered.filter((g) => human[g.id]?.[e.model]?.no_invented_claims === 0 && (human[g.id]?.[e.model]?.inventions?.length ?? 0) > 0).length;
      if (inventions >= rule.eliminatory.humanConfirmedInventionsMin) eliminations.push(`${inventions} invention(s) confirmée(s) par la revue humaine (seuil ${rule.eliminatory.humanConfirmedInventionsMin})`);
    }
    const expected = gt.filter((g) => !neutral.has(g.id) && (g.summaryExpected === true || (g.summaryExpected === 'if-kept' && isKept(rec.get(g.id)))));
    const qualityPerItem = expected.map((g) => {
      const r = rec.get(g.id);
      if (!r?.analysis?.summary) return 0;
      return (avg(notesFor(g, r), ['essential_information', 'content_level_respect', 'french_quality', 'concision_usefulness']) ?? 0) / 2;
    });
    const quality = W.summaryQuality * (expected.length ? (mean(qualityPerItem) ?? 0) : 1);

    // 4. Fiabilité des sorties structurées (erreurs fournisseur exclues : elles ne mesurent pas le modèle).
    const SR = rule.structuredReliability;
    const measured = e.records.filter((r) => r.status !== 'provider-error' && r.status !== 'refused-quota' && r.status !== 'refused-budget' && !r.status.startsWith('skipped'));
    const invalid = measured.filter((r) => r.status === 'invalid-output').length;
    const dropped = measured.filter((r) => r.violations.some((v) => SR.droppingViolations.some((d) => v.startsWith(d)))).length;
    if (invalid >= rule.eliminatory.invalidOutputsMin) eliminations.push(`${invalid} sorties structurées invalides (seuil ${rule.eliminatory.invalidOutputsMin})`);
    const reliability = measured.length ? W.structuredReliability * Math.max(0, 1 - (SR.penaltyFactor * (invalid + SR.droppedSummaryWeight * dropped)) / measured.length) : 0;

    // 5. Classification.
    const C = rule.classification;
    const decisions = gt.filter((g) => g.editorialDecision !== 'ambiguous' && !neutral.has(g.id));
    const correct = decisions.filter((g) => (g.editorialDecision === 'must_keep' ? isKept(rec.get(g.id)) : isExcluded(rec.get(g.id)))).length;
    const m = e.metrics;
    const part = (a: number, b: number) => (b ? a / b : 0);
    const classification =
      W.classification *
      (C.exclusionDecisions * part(correct, decisions.length) +
        C.typesAcceptable * part(m.types.acceptable, m.types.evaluated) +
        C.themesExact * part(m.themes.exactAcceptable, m.themes.evaluated) +
        C.noveltyInRange * part(m.novelty.inRange, m.novelty.evaluated) +
        C.sectionsCorrect * part(m.sections.correct, m.sections.evaluated));

    // 6. Coût et latence (relatifs au meilleur des deux).
    const cost = m.cost.avgPerPublicationEur;
    const lat = m.time.medianMs;
    const costLatency = (cost ? rule.costLatency.cost * (minCost / cost) : 0) + (lat ? rule.costLatency.latency * (minLatency / lat) : 0);
    const monthly = m.cost.projectedMonthlyEur.productionQuota;
    if (monthly !== null && monthly > rule.eliminatory.projectedMonthlyEurAtProductionQuotaMax) eliminations.push(`coût mensuel projeté ${monthly} € > ${rule.eliminatory.projectedMonthlyEurAtProductionQuotaMax} €`);

    const criteria: Record<CriterionKey, number> = {
      importantCoverage: round2(coverage),
      factualAccuracy: round2(factual),
      summaryQuality: round2(quality),
      structuredReliability: round2(reliability),
      classification: round2(classification),
      costLatency: round2(costLatency),
    };
    const counted = (Object.keys(criteria) as CriterionKey[]).filter((k) => !(summariesInconclusive && (k === 'factualAccuracy' || k === 'summaryQuality')));
    const maxPoints = counted.reduce((s, k) => s + W[k], 0);
    const total = round2((counted.reduce((s, k) => s + criteria[k], 0) / maxPoints) * 100);
    return {
      model: e.model,
      criteria,
      total,
      eliminations,
      details: { importantItems, importantExcluded, invalidOutputs: invalid, droppedSummaries: dropped, humanConfirmedInventions: inventions, summariesExpected: expected.length, summariesDelivered: delivered.length },
    };
  });

  // Choix : éliminations, puis écart de score, puis ordre de priorité, puis coût.
  const order = rule.tieBreakOrder.filter((k) => !(summariesInconclusive && (k === 'factualAccuracy' || k === 'summaryQuality')));
  const tieBreak = (cands: ModelScore[]): { chosen: ModelScore; why: string } => {
    for (const k of order) {
      const sorted = [...cands].sort((a, b) => b.criteria[k] - a.criteria[k]);
      if (sorted[0].criteria[k] - sorted[1].criteria[k] >= rule.tieBreakMinDifferenceShare * W[k]) return { chosen: sorted[0], why: `résultats proches ; départage sur le critère prioritaire « ${k} »` };
    }
    const byCost = [...cands].sort((a, b) => (evidence.find((x) => x.model === a.model)!.metrics.cost.avgPerPublicationEur ?? Infinity) - (evidence.find((x) => x.model === b.model)!.metrics.cost.avgPerPublicationEur ?? Infinity));
    return { chosen: byCost[0], why: 'résultats équivalents sur tous les critères prioritaires ; départage par le coût' };
  };
  // La revue humaine à l'aveugle est obligatoire : sans elle, aucun modèle n'est désigné, même provisoirement.
  if (!human) {
    return { ruleVersion: rule.version, provisional: true, provisionalReasons, neutralized, summariesInconclusive, scores, chosen: null, validated: false, basis: 'décision non rendue : revue humaine à l’aveugle obligatoire (grille complète et validée)' };
  }
  const remaining = scores.filter((s) => !s.eliminations.length);
  let chosen: ModelScore;
  let basis: string;
  let validated = true;
  if (remaining.length === 1) {
    chosen = remaining[0];
    basis = 'seul modèle sans critère éliminatoire';
  } else if (remaining.length === 0) {
    validated = false;
    const fewest = Math.min(...scores.map((s) => s.eliminations.length));
    const cands = scores.filter((s) => s.eliminations.length === fewest);
    const t = cands.length === 1 ? { chosen: cands[0], why: 'moins de critères éliminatoires' } : tieBreak(cands);
    chosen = t.chosen;
    basis = `AUCUN modèle validé (tous ont au moins un critère éliminatoire) ; choix provisoire, remplaçable : ${t.why}`;
  } else {
    const sorted = [...remaining].sort((a, b) => b.total - a.total);
    if (sorted[0].total - sorted[1].total >= rule.closeMarginPoints) {
      chosen = sorted[0];
      basis = `domine nettement (écart ${round2(sorted[0].total - sorted[1].total)} points ≥ ${rule.closeMarginPoints})`;
    } else {
      const t = tieBreak(sorted);
      chosen = t.chosen;
      basis = `${t.why} (écart total ${round2(sorted[0].total - sorted[1].total)} < ${rule.closeMarginPoints} points) ; modèle remplaçable ultérieurement`;
    }
  }
  return { ruleVersion: rule.version, provisional: provisionalReasons.length > 0 || !validated, provisionalReasons, neutralized, summariesInconclusive, scores, chosen: chosen.model, validated, basis };
}
