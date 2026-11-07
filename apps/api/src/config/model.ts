/**
 * Modèle d'analyse de Dunggle : GPT-6 Luna, retenu selon le protocole B3 (pocs/ai-analysis/reports/phase-b3-final-test.md § 8).
 * Configuration copiée à l'identique du POC 2 (tarifs et capacités vérifiés sur les pages OFFICIELLES le 2026-11-06).
 * Les tarifs doivent être REVÉRIFIÉS avant le premier appel réel (lot L9). Un modèle sans tarif vérifié ou non validé
 * est refusé par la garde budgétaire : aucun appel n'est alors possible.
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
    /** Points à confirmer par la toute première requête réelle. */
    firstRequestChecks: string[];
  };
}

const OAI_PRICING = 'https://developers.openai.com/api/docs/pricing';
const OAI_MODEL = 'https://developers.openai.com/api/docs/models/gpt-6-luna';
const OAI_REASONING = 'https://developers.openai.com/api/docs/guides/reasoning';
const OAI_SO = 'https://developers.openai.com/api/docs/guides/structured-outputs';
const OAI_CACHE = 'https://developers.openai.com/api/docs/guides/prompt-caching';
const OAI_TOKENS = 'https://developers.openai.com/api/docs/guides/token-counting';

export const MODELS: Record<string, ModelConfig> = {
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
};

/** Clé du modèle d'analyse utilisé par le pipeline. */
export const ANALYSIS_MODEL_KEY = 'openai-gpt-6-luna';
