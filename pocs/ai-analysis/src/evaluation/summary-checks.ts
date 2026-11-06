/**
 * Grille d'évaluation des résumés (phase B). Aucun LLM évaluateur.
 *
 * Six critères, notés manuellement de 0 à 2 (voir reports/summary-evaluation-grid.md) :
 *   factual_accuracy, essential_information, no_invented_claims, content_level_respect, french_quality, concision_usefulness
 *
 * Les vérifications automatiques ci-dessous sont INDICATIVES : elles reposent sur des correspondances
 * textuelles (faits de référence, chiffres, mots fréquents) et ne prouvent ni la fidélité ni la qualité.
 * Seul `content_level_respect` est vérifiable de façon fiable (résumé présent / absent).
 */
import { ungroundedNumbers } from '../pipeline.js';

export const SUMMARY_CRITERIA = [
  { id: 'factual_accuracy', label: 'Exactitude factuelle', automatic: 'indicatif (chiffres absents du texte)' },
  { id: 'essential_information', label: 'Présence des informations essentielles', automatic: 'indicatif (faits de référence retrouvés)' },
  { id: 'no_invented_claims', label: 'Absence d’affirmations inventées', automatic: 'indicatif (affirmations interdites retrouvées)' },
  { id: 'content_level_respect', label: 'Respect du niveau de contenu disponible', automatic: 'fiable (présence / absence, longueur vs extrait)' },
  { id: 'french_quality', label: 'Qualité du français', automatic: 'indicatif (langue détectée par mots fréquents)' },
  { id: 'concision_usefulness', label: 'Concision et utilité', automatic: 'indicatif (longueur, nombre de phrases)' },
] as const;
export type CriterionId = (typeof SUMMARY_CRITERIA)[number]['id'];

export type AutoVerdict = 'pass' | 'warn' | 'fail' | 'n/a';
export interface AutoCheck {
  criterion: CriterionId;
  verdict: AutoVerdict;
  indicative: boolean;
  detail: string;
}

export interface SummaryCheckInput {
  summary: string | null;
  keyPoints: string[];
  /** Texte effectivement transmis au modèle (null en mode métadonnées). */
  sourceText: string | null;
  title: string;
  summaryExpected: boolean | 'if-kept';
  kept: boolean;
  excerptLimited: boolean;
  referenceFacts?: string[];
  forbiddenClaims?: string[];
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
const FR = ['le', 'la', 'les', 'des', 'du', 'une', 'est', 'et', 'pour', 'avec', 'dans', 'qui', 'sur', 'pas'];
const EN = ['the', 'and', 'with', 'for', 'this', 'that', 'is', 'are', 'of', 'to', 'in', 'on'];

export const CONCISION = { maxChars: 600, maxSentences: 4, maxKeyPoints: 5 };

export function autoCheckSummary(i: SummaryCheckInput): AutoCheck[] {
  const text = [i.summary ?? '', ...i.keyPoints].join(' ').trim();
  const expected = i.summaryExpected === true || (i.summaryExpected === 'if-kept' && i.kept);
  const checks: AutoCheck[] = [];

  // Respect du niveau de contenu : fiable.
  if (!expected) {
    checks.push({ criterion: 'content_level_respect', verdict: text ? 'fail' : 'pass', indicative: false, detail: text ? 'Résumé produit alors qu’aucun n’est attendu' : 'Aucun résumé, conformément aux attentes' });
    return checks; // les autres critères sont sans objet
  }
  if (!i.summary) {
    checks.push({ criterion: 'content_level_respect', verdict: 'warn', indicative: false, detail: 'Résumé attendu mais absent (refus du modèle, suppression par une règle, ou exclusion)' });
    return checks;
  }
  const tooLong = i.excerptLimited && i.sourceText !== null && i.summary.length > i.sourceText.length;
  checks.push({ criterion: 'content_level_respect', verdict: tooLong ? 'fail' : 'pass', indicative: false, detail: tooLong ? 'Résumé plus long que l’extrait fourni' : 'Résumé présent et proportionné au contenu transmis' });

  const ungrounded = ungroundedNumbers(text, `${i.title} ${i.sourceText ?? ''}`);
  checks.push({ criterion: 'factual_accuracy', verdict: ungrounded.length ? 'fail' : 'pass', indicative: true, detail: ungrounded.length ? `Chiffres absents du texte : ${ungrounded.join(', ')}` : 'Aucun chiffre absent du texte (ne prouve pas l’exactitude)' });

  if (i.referenceFacts?.length) {
    const found = i.referenceFacts.filter((f) => norm(text).includes(norm(f)));
    const ratio = found.length / i.referenceFacts.length;
    checks.push({ criterion: 'essential_information', verdict: ratio >= 0.67 ? 'pass' : ratio > 0 ? 'warn' : 'fail', indicative: true, detail: `${found.length}/${i.referenceFacts.length} faits de référence retrouvés textuellement (une paraphrase correcte peut échapper à ce contrôle)` });
  } else checks.push({ criterion: 'essential_information', verdict: 'n/a', indicative: true, detail: 'Pas de faits de référence' });

  const forbidden = (i.forbiddenClaims ?? []).filter((c) => norm(text).includes(norm(c)));
  checks.push({ criterion: 'no_invented_claims', verdict: forbidden.length ? 'fail' : 'pass', indicative: true, detail: forbidden.length ? `Affirmations interdites retrouvées : ${forbidden.join(', ')}` : 'Aucune affirmation interdite retrouvée (une invention formulée autrement n’est pas détectée)' });

  const words = norm(text).match(/[a-z]+/g) ?? [];
  const fr = words.filter((w) => FR.includes(w)).length;
  const en = words.filter((w) => EN.includes(w)).length;
  checks.push({ criterion: 'french_quality', verdict: fr > en ? 'pass' : 'warn', indicative: true, detail: `Mots fréquents : ${fr} français / ${en} anglais (ne juge ni la grammaire ni le style)` });

  const sentences = (i.summary.match(/[.!?](\s|$)/g) ?? []).length || 1;
  const concise = i.summary.length <= CONCISION.maxChars && sentences <= CONCISION.maxSentences && i.keyPoints.length <= CONCISION.maxKeyPoints;
  checks.push({ criterion: 'concision_usefulness', verdict: concise ? 'pass' : 'warn', indicative: true, detail: `${i.summary.length} caractères, ${sentences} phrase(s), ${i.keyPoints.length} point(s) clé(s)` });
  return checks;
}
