import type { ModelConfig } from '../config/models.js';
import { RealCallsDisabledError, type AIAdapter, type AnalysisRequest, type AnalysisResponse, type ProviderUsage } from './types.js';

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

/** Raisons empêchant tout appel réel pour un modèle (en plus de REAL_CALLS_ENABLED). */
export function realCallBlockers(model: ModelConfig): string[] {
  const b: string[] = [];
  if (!REAL_CALLS_ENABLED) b.push('Appels réels désactivés en phase A (REAL_CALLS_ENABLED = false)');
  if (model.provider === 'mock') b.push('Modèle simulé');
  if (model.validation.status !== 'validated') b.push(`Configuration non validée : ${model.validation.blockers.join(' ; ')}`);
  if (!model.pricing) b.push('Tarif non vérifié');
  return b;
}

/**
 * Usage Anthropic → usage facturable. `output_tokens` est documenté comme total facturé incluant la
 * réflexion. Les tokens de cache (non utilisés par Dunggle) sont comptés au prix d'entrée, l'écriture
 * en cache majorée ×2 (pire cas documenté : écriture 1 h).
 */
export function normalizeAnthropicUsage(u: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  output_tokens_details?: { thinking_tokens?: number } | null;
}): ProviderUsage {
  return {
    inputTokens: u.input_tokens + 2 * (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    outputTokens: u.output_tokens,
    reasoningTokens: u.output_tokens_details?.thinking_tokens,
  };
}

/**
 * Usage OpenAI → usage facturable, de manière PRUDENTE : l'inclusion de reasoning_tokens dans
 * output_tokens n'est que déduite d'un exemple. On compte donc output + reasoning, plafonné par
 * max_output_tokens (qui, lui, borne explicitement raisonnement + sortie visible + formatage).
 * Si output_tokens dépasse déjà le plafond, la valeur déclarée est conservée (jamais sous-estimée).
 */
export function normalizeOpenAIUsage(
  u: { input_tokens: number; output_tokens: number; input_tokens_details?: { cached_tokens?: number } | null; output_tokens_details?: { reasoning_tokens?: number } | null },
  maxOutputTokens: number,
): ProviderUsage {
  const reasoning = u.output_tokens_details?.reasoning_tokens ?? 0;
  const output = Math.max(u.output_tokens, Math.min(u.output_tokens + reasoning, maxOutputTokens));
  return { inputTokens: u.input_tokens, outputTokens: output, reasoningTokens: reasoning };
}
