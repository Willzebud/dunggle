import { EXCLUSION_REASONS, PUBLICATION_TYPES, THEMES, isKnownSubtheme } from './taxonomy.js';
import type { AnalysisOutput } from './types.js';

/**
 * Schéma JSON envoyé aux fournisseurs (sortie structurée), dans sa forme « transport ».
 *
 * Incident B.1 (2026-11-06, req_011Cgn4kjg6cEFjYpA4ZQLCh) : Anthropic a refusé (HTTP 400)
 * `exclusionReason: { type: ['string','null'], enum: [..., null] }` avec « Enum value 'funding_only' does not
 * match declared type '['string', 'null']' ». Les deux documentations (vérifiées le 2026-11-06) acceptent en
 * principe les types multiples et `anyOf`, mais Anthropic les compte comme « union types » coûteux, et leur
 * combinaison avec `enum` vient d'échouer en production. Le schéma n'utilise donc PLUS AUCUNE union :
 * - aucun tableau de types, aucun `anyOf`/`allOf`/`oneOf`, aucun `null` ;
 * - « absence » représentée par des sentinelles explicites : summary = "" (aucun résumé),
 *   exclusionReason = "none" (aucune exclusion), converties en null par validateAnalysis() ;
 * - additionalProperties:false sur tout objet, tous les champs dans `required` (exigence OpenAI strict) ;
 * - aucune contrainte numérique ou de longueur (non supportées par Anthropic) : bornes vérifiées localement.
 * Le contrôle hors ligne `providerSchemaProblems()` applique ces règles à tout le schéma (tests de non-régression).
 */
export const NO_EXCLUSION = 'none' as const;
export const NO_SUMMARY = '' as const;

export const ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['themes', 'subthemes', 'type', 'relevance', 'novelty', 'confidence', 'relevanceReason', 'summary', 'keyPoints', 'exclusionReason'],
  properties: {
    themes: { type: 'array', items: { type: 'string', enum: [...THEMES] } },
    subthemes: { type: 'array', items: { type: 'string' } },
    type: { type: 'string', enum: [...PUBLICATION_TYPES] },
    relevance: { type: 'integer', description: 'Pertinence personnelle, entier de 0 à 100' },
    // Pas d'enum entier : non documenté côté Anthropic (phase A.1) ; borne 1–5 vérifiée localement.
    novelty: { type: 'integer', description: 'Importance de la nouveauté, entier de 1 à 5' },
    confidence: { type: 'number', description: 'Confiance de 0 à 1' },
    relevanceReason: { type: 'string' },
    summary: { type: 'string', description: 'Résumé en français, ou chaîne vide si aucun résumé' },
    keyPoints: { type: 'array', items: { type: 'string' } },
    exclusionReason: { type: 'string', enum: [...EXCLUSION_REASONS, NO_EXCLUSION], description: '"none" si la publication n’est pas exclue' },
  },
} as const;

/**
 * Contrôle hors ligne des règles COMMUNES aux deux fournisseurs (documentations Anthropic « JSON Schema
 * limitations » et OpenAI « Supported schemas », relues le 2026-11-06), plus la règle prudente « aucune union ».
 * Retourne la liste des violations (chemin : problème). Ne remplace pas la validation du fournisseur.
 */
export function providerSchemaProblems(schema: unknown): string[] {
  const out: string[] = [];
  const FORBIDDEN = ['anyOf', 'allOf', 'oneOf', 'not', 'if', 'then', 'else', '$ref', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'maxItems', 'pattern', 'format', 'patternProperties', 'dependentRequired', 'dependentSchemas'];
  const BASIC = ['object', 'array', 'string', 'integer', 'number', 'boolean'];
  let enumCount = 0;
  const walk = (node: unknown, path: string, depth: number) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return void out.push(`${path} : sous-schéma objet attendu`);
    const n = node as Record<string, unknown>;
    for (const k of FORBIDDEN) if (k in n) out.push(`${path} : mot-clé « ${k} » interdit`);
    if (Array.isArray(n.type)) out.push(`${path} : tableau de types (union) interdit`);
    else if (typeof n.type !== 'string' || !BASIC.includes(n.type)) out.push(`${path} : type simple attendu (${BASIC.join(', ')})`);
    if ('enum' in n) {
      const e = n.enum;
      if (!Array.isArray(e) || e.length === 0) out.push(`${path} : enum non vide attendu`);
      else {
        enumCount += e.length;
        if (new Set(e).size !== e.length) out.push(`${path} : valeurs d’enum en double`);
        for (const v of e) {
          if (v === null) out.push(`${path} : null dans enum interdit`);
          else if (n.type === 'string' && typeof v !== 'string') out.push(`${path} : valeur d’enum ${JSON.stringify(v)} hors type string`);
          else if (n.type !== 'string') out.push(`${path} : enum autorisé seulement sur type string`);
        }
        const lower = e.filter((v): v is string => typeof v === 'string').map((v) => v.toLowerCase());
        if (new Set(lower).size !== lower.length) out.push(`${path} : valeurs d’enum ne différant que par la casse`);
      }
    }
    if ('minItems' in n && n.minItems !== 0 && n.minItems !== 1) out.push(`${path} : minItems limité à 0 ou 1`);
    if (n.type === 'object') {
      if (depth > 10) out.push(`${path} : imbrication > 10 niveaux`);
      if (n.additionalProperties !== false) out.push(`${path} : additionalProperties:false obligatoire`);
      const props = (n.properties ?? {}) as Record<string, unknown>;
      const req = Array.isArray(n.required) ? (n.required as string[]) : [];
      for (const k of Object.keys(props)) if (!req.includes(k)) out.push(`${path}.${k} : propriété absente de required`);
      for (const k of req) if (!(k in props)) out.push(`${path} : required « ${k} » sans propriété`);
      for (const [k, v] of Object.entries(props)) walk(v, `${path}.${k}`, depth + 1);
    }
    if (n.type === 'array') {
      if (!('items' in n)) out.push(`${path} : items obligatoire`);
      else walk(n.items, `${path}[]`, depth + 1);
    }
  };
  walk(schema, '$', 1);
  if (schema && typeof schema === 'object' && (schema as Record<string, unknown>).type !== 'object') out.push('$ : la racine doit être un objet');
  if (enumCount > 1000) out.push(`$ : ${enumCount} valeurs d’enum (> 1000)`);
  return out;
}

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
  // Forme transport → forme interne : sentinelles explicites converties en null (copie, entrée non modifiée).
  const o = { ...(obj as Record<string, unknown>) };
  if (o.summary === NO_SUMMARY) o.summary = null;
  if (o.exclusionReason === NO_EXCLUSION) o.exclusionReason = null;

  if (typeof o.summary === 'string' && o.summary.length > 0 && !o.summary.trim()) errors.push('summary : blancs seuls interdits (chaîne vide = aucun résumé)');
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
