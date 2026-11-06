import type { ModelConfig } from '../config/models.js';
import { RealCallsDisabledError, type AIAdapter, type AnalysisRequest, type AnalysisResponse } from './types.js';

/**
 * PHASE A : aucun appel réel. Cette constante n'est PAS pilotable par variable d'environnement,
 * pour qu'aucune configuration ne puisse déclencher une facturation par erreur. En phase B,
 * l'activation passera par une modification de code revue, avec le SDK officiel de chaque fournisseur
 * (@anthropic-ai/sdk, openai) et le budget d'essai de 0,50 €.
 */
export const REAL_CALLS_ENABLED = false as const;

/** Présence d'une clé (sans jamais la lire ni l'afficher). */
export function apiKeyConfigured(provider: 'anthropic' | 'openai', env: NodeJS.ProcessEnv = process.env): boolean {
  const v = provider === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Paramètres de `client.messages.create(...)` (Messages API), vérifiés le 2026-11-06 :
 * sortie structurée via `output_config.format` (type "json_schema"). La réflexion adaptative de
 * Claude Haiku 5.5 est active par défaut ; `effort: "low"` limite son coût, et `max_tokens`
 * borne réflexion + réponse (borne utilisée par le budget).
 */
export function buildAnthropicParams(model: ModelConfig, req: AnalysisRequest) {
  return {
    model: model.modelId,
    max_tokens: req.maxOutputTokens,
    system: req.system,
    messages: [{ role: 'user' as const, content: req.user }],
    output_config: {
      effort: 'low' as const,
      format: { type: 'json_schema' as const, schema: req.schema },
    },
  };
}

/**
 * Paramètres de `client.responses.create(...)` (Responses API), vérifiés le 2026-11-06 :
 * `text.format` json_schema strict. `max_output_tokens` borne raisonnement + réponse ;
 * `store: false` évite la conservation côté fournisseur des réponses.
 */
export function buildOpenAIParams(model: ModelConfig, req: AnalysisRequest) {
  return {
    model: model.modelId,
    instructions: req.system,
    input: req.user,
    max_output_tokens: req.maxOutputTokens,
    reasoning: { effort: 'low' as const },
    store: false,
    text: { format: { type: 'json_schema' as const, name: 'dunggle_analysis', schema: req.schema, strict: true } },
  };
}

export class AnthropicAdapter implements AIAdapter {
  readonly real = true;
  constructor(readonly model: ModelConfig) {}
  async analyze(req: AnalysisRequest): Promise<AnalysisResponse> {
    buildAnthropicParams(this.model, req); // la requête est construite (et testée) mais jamais envoyée
    throw new RealCallsDisabledError('anthropic');
  }
}

export class OpenAIAdapter implements AIAdapter {
  readonly real = true;
  constructor(readonly model: ModelConfig) {}
  async analyze(req: AnalysisRequest): Promise<AnalysisResponse> {
    buildOpenAIParams(this.model, req);
    throw new RealCallsDisabledError('openai');
  }
}
