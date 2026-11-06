/**
 * Modèles candidats. Les tarifs ci-dessous ont été relevés sur les pages OFFICIELLES le 2026-11-06 :
 * - Anthropic : https://platform.claude.com/docs/en/about-claude/pricing (et structured-outputs)
 * - OpenAI    : https://developers.openai.com/api/docs/pricing (et models/gpt-6-luna, guides/structured-outputs)
 * Voir reports/models-pricing.md. Un modèle sans tarif vérifié (`pricing: null`) est REFUSÉ par le budget.
 */
export interface PriceTier {
  /** Le tarif s'applique jusqu'à ce nombre de tokens d'entrée (inclus) ; null = sans limite. */
  maxInputTokens: number | null;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
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
  /** Particularité de facturation à prendre en compte dans l'estimation. */
  billingNotes: string[];
  /** Plafond technique de sortie annoncé par le fournisseur (information). */
  maxOutputTokensProvider: number | null;
}

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
    sources: ['https://platform.claude.com/docs/en/about-claude/pricing', 'https://platform.claude.com/docs/en/build-with-claude/structured-outputs'],
    structuredOutput: 'Messages API : output_config.format = { type: "json_schema", schema } ; claude-haiku-5-5 listé parmi les modèles pris en charge',
    billingNotes: [
      'Réflexion adaptative active par défaut et facturée comme tokens de sortie : max_tokens borne réflexion + réponse.',
      'Tarif supérieur au-delà de 100 000 tokens d’entrée (palier modélisé).',
      'Effort par défaut « medium » : fixer « low » pour la classification.',
    ],
    maxOutputTokensProvider: 128_000,
  },
  'openai-gpt-6-luna': {
    key: 'openai-gpt-6-luna',
    provider: 'openai',
    modelId: 'gpt-6-luna',
    pricing: [{ maxInputTokens: 272_000, inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 }],
    verifiedAt: '2026-11-06',
    sources: ['https://developers.openai.com/api/docs/pricing', 'https://developers.openai.com/api/docs/models/gpt-6-luna', 'https://developers.openai.com/api/docs/guides/structured-outputs'],
    structuredOutput: 'Responses API : text.format = { type: "json_schema", name, schema, strict: true } ; « structured_outputs » listé dans les fonctionnalités du modèle',
    billingNotes: [
      'Modèle de raisonnement (reasoning.effort, défaut « medium ») : la page modèle ne précise pas la facturation des tokens de raisonnement ; ils sont comptés comme sortie par prudence et bornés par max_output_tokens.',
      'Tarif « long contexte » (> 272K) non relevé : au-delà, le modèle est refusé par le budget.',
    ],
    maxOutputTokensProvider: 128_000,
  },
  // Alternatives relevées mais non retenues comme candidats principaux (voir reports/models-pricing.md).
  'openai-gpt-5-nano': {
    key: 'openai-gpt-5-nano',
    provider: 'openai',
    modelId: 'gpt-5-nano',
    pricing: [{ maxInputTokens: 272_000, inputUsdPerMTok: 0.05, outputUsdPerMTok: 0.4 }],
    verifiedAt: '2026-11-06',
    sources: ['https://developers.openai.com/api/docs/pricing'],
    structuredOutput: 'Non vérifié sur la page modèle lors de ce relevé',
    billingNotes: ['Capacités de sortie structurée non vérifiées : à confirmer avant usage.'],
    maxOutputTokensProvider: null,
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
  },
};

export const CANDIDATE_MODEL_KEYS = ['anthropic-haiku-5-5', 'openai-gpt-6-luna'];
