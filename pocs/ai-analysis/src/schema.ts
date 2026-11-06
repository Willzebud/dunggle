import { EXCLUSION_REASONS, PUBLICATION_TYPES, THEMES, isKnownSubtheme } from './taxonomy.js';
import type { AnalysisOutput } from './types.js';

/**
 * Schéma JSON envoyé aux fournisseurs (sortie structurée).
 * Compatible avec les deux fournisseurs vérifiés le 2026-11-06 :
 * - Anthropic `output_config.format` (type "json_schema") : additionalProperties:false obligatoire,
 *   pas de contraintes numériques (minimum/maximum), pas de minLength/maxLength.
 * - OpenAI Responses `text.format` (json_schema, strict:true) : tous les champs dans `required`.
 * Les bornes (relevance 0–100, confidence 0–1, longueurs) sont donc vérifiées LOCALEMENT par validateAnalysis().
 */
export const ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['themes', 'subthemes', 'type', 'relevance', 'novelty', 'confidence', 'relevanceReason', 'summary', 'keyPoints', 'exclusionReason'],
  properties: {
    themes: { type: 'array', items: { type: 'string', enum: [...THEMES] } },
    subthemes: { type: 'array', items: { type: 'string' } },
    type: { type: 'string', enum: [...PUBLICATION_TYPES] },
    relevance: { type: 'integer', description: 'Pertinence personnelle, entier de 0 à 100' },
    novelty: { type: 'integer', enum: [1, 2, 3, 4, 5], description: 'Importance de la nouveauté, 1 à 5' },
    confidence: { type: 'number', description: 'Confiance de 0 à 1' },
    relevanceReason: { type: 'string' },
    summary: { type: ['string', 'null'] },
    keyPoints: { type: 'array', items: { type: 'string' } },
    exclusionReason: { type: ['string', 'null'], enum: [...EXCLUSION_REASONS, null] },
  },
} as const;

export const LIMITS = {
  maxThemes: 4,
  maxSubthemes: 6,
  maxKeyPoints: 5,
  maxSummaryChars: 1200,
  maxKeyPointChars: 240,
  maxReasonChars: 400,
};

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  value: AnalysisOutput | null;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Valide une sortie de modèle (objet déjà parsé ou texte JSON). Aucune correction silencieuse. */
export function validateAnalysis(input: unknown): ValidationResult {
  let obj: unknown = input;
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input);
    } catch {
      return { ok: false, errors: ['JSON invalide'], value: null };
    }
  }
  const errors: string[] = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, errors: ['objet attendu'], value: null };
  const o = obj as Record<string, unknown>;

  const allowed = new Set(Object.keys(ANALYSIS_JSON_SCHEMA.properties));
  for (const k of Object.keys(o)) if (!allowed.has(k)) errors.push(`champ inattendu : ${k}`);
  for (const k of ANALYSIS_JSON_SCHEMA.required) if (!(k in o)) errors.push(`champ manquant : ${k}`);

  if (!Array.isArray(o.themes) || o.themes.some((t) => !(THEMES as readonly unknown[]).includes(t))) errors.push('themes : tableau de thématiques connues attendu');
  else if (new Set(o.themes).size !== o.themes.length) errors.push('themes : doublons');
  else if (o.themes.length > LIMITS.maxThemes) errors.push(`themes : au plus ${LIMITS.maxThemes}`);
  if (Array.isArray(o.themes) && o.themes.length === 0 && o.exclusionReason == null) errors.push('themes : vide sans motif d’exclusion');

  if (!Array.isArray(o.subthemes) || o.subthemes.some((s) => typeof s !== 'string' || !isKnownSubtheme(s))) errors.push('subthemes : codes connus ou other:<libellé> attendus');
  else if (o.subthemes.length > LIMITS.maxSubthemes) errors.push(`subthemes : au plus ${LIMITS.maxSubthemes}`);

  if (!(PUBLICATION_TYPES as readonly unknown[]).includes(o.type)) errors.push('type : valeur inconnue');
  if (!isInt(o.relevance) || o.relevance < 0 || o.relevance > 100) errors.push('relevance : entier de 0 à 100 attendu');
  if (!isInt(o.novelty) || o.novelty < 1 || o.novelty > 5) errors.push('novelty : entier de 1 à 5 attendu');
  if (typeof o.confidence !== 'number' || !Number.isFinite(o.confidence) || o.confidence < 0 || o.confidence > 1) errors.push('confidence : nombre de 0 à 1 attendu');
  if (typeof o.relevanceReason !== 'string' || !o.relevanceReason.trim() || o.relevanceReason.length > LIMITS.maxReasonChars) errors.push(`relevanceReason : texte non vide de ${LIMITS.maxReasonChars} caractères max`);
  if (o.summary !== null && (typeof o.summary !== 'string' || !o.summary.trim() || o.summary.length > LIMITS.maxSummaryChars)) errors.push(`summary : texte non vide de ${LIMITS.maxSummaryChars} caractères max, ou null`);
  if (!Array.isArray(o.keyPoints) || o.keyPoints.some((k) => typeof k !== 'string' || !k.trim() || k.length > LIMITS.maxKeyPointChars)) errors.push('keyPoints : tableau de textes courts attendu');
  else if (o.keyPoints.length > LIMITS.maxKeyPoints) errors.push(`keyPoints : au plus ${LIMITS.maxKeyPoints}`);
  if (o.summary === null && Array.isArray(o.keyPoints) && o.keyPoints.length > 0) errors.push('keyPoints : doit être vide quand summary est null');
  if (o.exclusionReason !== null && !(EXCLUSION_REASONS as readonly unknown[]).includes(o.exclusionReason)) errors.push('exclusionReason : motif inconnu');

  return errors.length ? { ok: false, errors, value: null } : { ok: true, errors: [], value: o as unknown as AnalysisOutput };
}
