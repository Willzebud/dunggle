/**
 * Modèles candidats — tarifs et capacités revérifiés sur les pages OFFICIELLES le 2026-11-06 (phase A.1).
 * Voir reports/models-pricing.md. Un modèle sans tarif vérifié (`pricing: null`) ou dont la
 * configuration est « not-validated » est REFUSÉ par le budget, donc aucun appel n'est possible.
 */
export interface PriceTier {
  /** Le tarif s'applique jusqu'à ce nombre de tokens d'entrée (inclus) ; null = sans limite. */
  maxInputTokens: number | null;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

/** Niveau de preuve d'une information : texte officiel cité, résumé d'une page officielle, déduction, ou absent. */
export type EvidenceLevel = 'verbatim' | 'summary' | 'inferred' | 'not-stated';

export interface ValidationCheck {
  item: string;
  evidence: EvidenceLevel;
  value: string;
  source: string;
}

export interface ModelConfig {
  key: string;
  provider: 'anthropic' | 'openai' | 'mock';
  modelId: string;
  /** Paliers triés par maxInputTokens croissant ; null = tarif non vérifié → aucun appel possible. */
  pricing: PriceTier[] | null;
  verifiedAt: string | null;
  sources: string[];
  structuredOutput: string;
  billingNotes: string[];
  maxOutputTokensProvider: number | null;
  validation: {
    /** validated : identifiant, tarif et sortie structurée confirmés sur source officielle. simulated : modèle de test. */
    status: 'validated' | 'not-validated' | 'simulated';
    checks: ValidationCheck[];
    /** Raisons bloquantes (si not-validated). */
    blockers: string[];
    /** Points à confirmer par la toute première requête réelle de la phase B (comptée dans le budget d'essai). */
    firstRequestChecks: string[];
  };
}

const ANT_PRICING = 'https://platform.claude.com/docs/en/about-claude/pricing';
const ANT_MODELS = 'https://platform.claude.com/docs/en/about-claude/models/overview';
const ANT_SO = 'https://platform.claude.com/docs/en/build-with-claude/structured-outputs';
const ANT_THINK = 'https://platform.claude.com/docs/en/build-with-claude/extended-thinking';
const OAI_PRICING = 'https://developers.openai.com/api/docs/pricing';
const OAI_MODEL = 'https://developers.openai.com/api/docs/models/gpt-6-luna';
const OAI_REASONING = 'https://developers.openai.com/api/docs/guides/reasoning';
const OAI_SO = 'https://developers.openai.com/api/docs/guides/structured-outputs';

export const MODELS: Record<string, ModelConfig> = {
  'anthropic-haiku-5-5': {
    key: 'anthropic-haiku-5-5',
    provider: 'anthropic',
    modelId: 'claude-haiku-5-5',
    pricing: [
      { maxInputTokens: 100_000, inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 },
      { maxInputTokens: null, inputUsdPerMTok: 0.5, outputUsdPerMTok: 2.5 },
    ],
    verifiedAt: '2026-11-06',
    sources: [ANT_PRICING, ANT_MODELS, ANT_SO, ANT_THINK],
    structuredOutput: 'Messages API : output_config.format = { type: "json_schema", schema }',
    billingNotes: [
      'Réflexion adaptative (toujours disponible) facturée comme sortie ; max_tokens borne réflexion + réponse ; usage.output_tokens est le total facturé.',
      'Tarif supérieur au-delà de 100 000 tokens d’entrée (palier modélisé).',
      'La sortie structurée injecte un prompt système supplémentaire facturé en entrée (taille non publiée).',
    ],
    maxOutputTokensProvider: 128_000,
    validation: {
      status: 'validated',
      checks: [
        { item: 'Identifiant API', evidence: 'verbatim', value: 'claude-haiku-5-5', source: ANT_MODELS },
        { item: 'Tarif ≤ 100K tokens', evidence: 'verbatim', value: '0,10 $ entrée / 0,50 $ sortie par MTok', source: ANT_PRICING },
        { item: 'Tarif > 100K tokens', evidence: 'verbatim', value: '0,50 $ / 2,50 $ par MTok', source: ANT_PRICING },
        { item: 'Sortie structurée output_config.format json_schema', evidence: 'verbatim', value: 'pris en charge ; claude-haiku-5-5 listé', source: ANT_SO },
        { item: 'max_tokens borne la réflexion', evidence: 'verbatim', value: '« max_tokens remains the hard ceiling on total output »', source: ANT_THINK },
        { item: 'Réflexion facturée en sortie, incluse dans output_tokens', evidence: 'verbatim', value: '« output_tokens remains the inclusive, authoritative total used for billing »', source: ANT_THINK },
        { item: 'Unions ["string","null"] et enum avec null', evidence: 'summary', value: 'autorisés (limite de 16 paramètres en union)', source: ANT_SO },
        { item: 'Enum d’entiers', evidence: 'not-stated', value: 'non documenté → retiré du schéma (novelty validé localement)', source: ANT_SO },
        { item: 'Surcoût du prompt de sortie structurée', evidence: 'summary', value: 'tokens d’entrée « légèrement » supérieurs ; couvert par la marge forfaitaire', source: ANT_SO },
      ],
      blockers: [],
      firstRequestChecks: [
        'Schéma accepté sans erreur 400 (unions avec null, enum de exclusionReason incluant null).',
        'Écart entre input_tokens réel et borne haute (mesure du prompt injecté).',
      ],
    },
  },
  'openai-gpt-6-luna': {
    key: 'openai-gpt-6-luna',
    provider: 'openai',
    modelId: 'gpt-6-luna',
    pricing: [
      { maxInputTokens: 272_000, inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 },
      { maxInputTokens: null, inputUsdPerMTok: 0.2, outputUsdPerMTok: 0.75 },
    ],
    verifiedAt: '2026-11-06',
    sources: [OAI_PRICING, OAI_MODEL, OAI_REASONING, OAI_SO],
    structuredOutput: 'Responses API : text.format = { type: "json_schema", name, schema, strict: true }',
    billingNotes: [
      'Tokens de raisonnement facturés en sortie ; max_output_tokens borne raisonnement + sortie visible + formatage.',
      'Inclusion des tokens de raisonnement dans usage.output_tokens : seulement déduite d’un exemple → normalisation prudente (voir normalizeOpenAIUsage).',
      'Au-delà de 272K tokens d’entrée : 2× entrée, 1,5× sortie (palier modélisé).',
    ],
    maxOutputTokensProvider: 128_000,
    validation: {
      status: 'validated',
      checks: [
        { item: 'Identifiant API', evidence: 'verbatim', value: 'gpt-6-luna (instantané par défaut)', source: OAI_MODEL },
        { item: 'Tarif ≤ 272K tokens', evidence: 'verbatim', value: '0,10 $ entrée / 0,01 $ entrée en cache / 0,50 $ sortie par M', source: OAI_PRICING },
        { item: 'Tarif > 272K tokens', evidence: 'verbatim', value: '0,20 $ / 0,75 $ par M', source: OAI_PRICING },
        { item: 'Sortie structurée', evidence: 'verbatim', value: '« structured_outputs » dans les fonctionnalités du modèle', source: OAI_MODEL },
        { item: 'Raisonnement facturé en sortie', evidence: 'verbatim', value: '« billed as output tokens »', source: OAI_REASONING },
        { item: 'max_output_tokens borne le raisonnement', evidence: 'verbatim', value: '« including reasoning tokens, visible output tokens, and non-visible formatting tokens »', source: OAI_REASONING },
        { item: 'reasoning_tokens inclus dans output_tokens', evidence: 'inferred', value: 'déduit de l’exemple d’usage ; normalisation prudente', source: OAI_REASONING },
        { item: 'Mode strict : required complet, additionalProperties:false, unions avec null', evidence: 'summary', value: 'conformes au schéma Dunggle', source: OAI_SO },
      ],
      blockers: [],
      firstRequestChecks: [
        'Schéma accepté en mode strict (enum incluant null pour exclusionReason).',
        'Structure de usage (output_tokens vs output_tokens_details.reasoning_tokens) sur une réponse réelle.',
      ],
    },
  },
  // Alternative relevée mais non retenue.
  'openai-gpt-5-nano': {
    key: 'openai-gpt-5-nano',
    provider: 'openai',
    modelId: 'gpt-5-nano',
    pricing: [{ maxInputTokens: 272_000, inputUsdPerMTok: 0.05, outputUsdPerMTok: 0.4 }],
    verifiedAt: '2026-11-06',
    sources: [OAI_PRICING],
    structuredOutput: 'Non vérifié',
    billingNotes: ['Capacités de sortie structurée non vérifiées.'],
    maxOutputTokensProvider: null,
    validation: { status: 'not-validated', checks: [], blockers: ['Sortie structurée non vérifiée sur la page modèle'], firstRequestChecks: [] },
  },
  /** Modèle fictif des tests : tarif artificiel, aucun fournisseur. */
  'mock-cheap': {
    key: 'mock-cheap',
    provider: 'mock',
    modelId: 'mock-cheap',
    pricing: [{ maxInputTokens: null, inputUsdPerMTok: 1, outputUsdPerMTok: 5 }],
    verifiedAt: 'fictif',
    sources: [],
    structuredOutput: 'simulé',
    billingNotes: ['Modèle de test : tarif volontairement élevé pour exercer les plafonds.'],
    maxOutputTokensProvider: null,
    validation: { status: 'simulated', checks: [], blockers: [], firstRequestChecks: [] },
  },
  /** Modèle fictif sans tarif : doit toujours être refusé. */
  'mock-unpriced': {
    key: 'mock-unpriced',
    provider: 'mock',
    modelId: 'mock-unpriced',
    pricing: null,
    verifiedAt: null,
    sources: [],
    structuredOutput: 'simulé',
    billingNotes: ['Tarif inconnu : sert à vérifier le refus.'],
    maxOutputTokensProvider: null,
    validation: { status: 'simulated', checks: [], blockers: [], firstRequestChecks: [] },
  },
};

export const CANDIDATE_MODEL_KEYS = ['anthropic-haiku-5-5', 'openai-gpt-6-luna'];
