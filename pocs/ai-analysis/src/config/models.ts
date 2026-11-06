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
  /**
   * Multiplicateur du prix d'entrée dans le PIRE cas (estimation maximale) : écriture en cache facturée
   * automatiquement par le fournisseur. 1 si aucune écriture ne peut être facturée sans demande explicite.
   */
  worstCaseInputMultiplier?: number;
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
const OAI_CACHE = 'https://developers.openai.com/api/docs/guides/prompt-caching';
const OAI_TOKENS = 'https://developers.openai.com/api/docs/guides/token-counting';
const ANT_COST = 'https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost';

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
    sources: [ANT_PRICING, ANT_MODELS, ANT_SO, ANT_THINK, ANT_COST],
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
        { item: 'Réflexion facturée en sortie', evidence: 'verbatim', value: '« Tokens Claude uses while thinking (billed as output tokens) »', source: ANT_COST },
        { item: 'Réflexion incluse dans output_tokens', evidence: 'verbatim', value: '« output_tokens remains the inclusive, authoritative total used for billing »', source: ANT_COST },
        { item: 'Unions ["string","null"]', evidence: 'verbatim', value: '« type arrays (for example, "type": ["string", "null"]) » comptés dans la limite de 16 paramètres en union', source: ANT_SO },
        { item: 'Enum avec null', evidence: 'verbatim', value: '« enum (strings, numbers, booleans, or nulls only, no complex types) »', source: ANT_SO },
        { item: 'additionalProperties', evidence: 'verbatim', value: '« required and additionalProperties (must be set to false for objects) »', source: ANT_SO },
        { item: 'Contraintes numériques', evidence: 'verbatim', value: 'non prises en charge (minimum, maximum) → bornes vérifiées localement', source: ANT_SO },
        { item: 'Surcoût du prompt de sortie structurée', evidence: 'verbatim', value: '« Your input token count is slightly higher » ; couvert par la marge forfaitaire', source: ANT_SO },
        { item: 'Mise en cache', evidence: 'verbatim', value: 'activée uniquement via cache_control (non envoyé par Dunggle) → aucune écriture facturée', source: ANT_PRICING },
      ],
      blockers: [],
      firstRequestChecks: [
        'Écart entre input_tokens réel et borne haute (taille réelle du prompt injecté par la sortie structurée).',
        'Absence de cache_creation_input_tokens dans l’usage.',
      ],
    },
  },
  'openai-gpt-6-luna': {
    key: 'openai-gpt-6-luna',
    provider: 'openai',
    modelId: 'gpt-6-luna',
    pricing: [
      // Mise en cache activée par défaut (écritures 30 min à 1,25×) : couverte dans l'estimation maximale,
      // et désactivée dans la requête (prompt_cache_options.mode = "explicit" sans point d'arrêt).
      { maxInputTokens: 272_000, inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5, worstCaseInputMultiplier: 1.25 },
      { maxInputTokens: null, inputUsdPerMTok: 0.2, outputUsdPerMTok: 0.75, worstCaseInputMultiplier: 1.25 },
    ],
    verifiedAt: '2026-11-06',
    sources: [OAI_PRICING, OAI_MODEL, OAI_REASONING, OAI_SO, OAI_CACHE, OAI_TOKENS],
    structuredOutput: 'Responses API : text.format = { type: "json_schema", name, schema, strict: true }',
    billingNotes: [
      'Tokens de raisonnement facturés en sortie ; max_output_tokens borne raisonnement + sortie visible + formatage.',
      'usage.output_tokens inclut tous les tokens générés, raisonnement compris (guide token-counting).',
      'Mise en cache activée par défaut ; écritures facturées 1,25× (30 min) ou 2,5× (12 h, sur demande) → désactivée par prompt_cache_options.mode = "explicit" sans point d’arrêt ; estimation maximale à 1,25× par prudence.',
      'Contenu système caché ajouté par OpenAI (« OpenAI-provided hidden system content ») : couvert par la marge forfaitaire.',
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
        { item: 'Raisonnement inclus dans output_tokens', evidence: 'verbatim', value: '« Reported output token usage includes all tokens generated by the model […] reports this total as output_tokens »', source: OAI_TOKENS },
        { item: 'Mode strict : champs required', evidence: 'verbatim', value: '« all fields or function parameters must be specified as required »', source: OAI_SO },
        { item: 'Mode strict : additionalProperties', evidence: 'verbatim', value: '« additionalProperties: false must always be set in objects »', source: OAI_SO },
        { item: 'Unions avec null', evidence: 'verbatim', value: '« emulate an optional parameter by using a union type with null »', source: OAI_SO },
        { item: 'Enum avec null', evidence: 'verbatim', value: 'exemple officiel « "enum": ["violence", "sexual", "self_harm", null] »', source: OAI_SO },
        { item: 'Mise en cache par défaut et écritures facturées', evidence: 'verbatim', value: '« Prompt caching is enabled by default » ; « cache writes cost 1.25× » (GPT-5.6 et suivants)', source: OAI_CACHE },
        { item: 'Désactivation des écritures', evidence: 'verbatim', value: '« When no explicit breakpoints are placed, the request does not use prompt caching or create cache writes » (mode explicit)', source: OAI_CACHE },
      ],
      blockers: [],
      firstRequestChecks: [
        'input_tokens_details.cache_write_tokens = 0 (mode explicit sans point d’arrêt effectif).',
        'Écart entre input_tokens réel et borne haute (contenu système caché + sortie structurée).',
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
