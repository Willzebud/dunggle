import type { ModelConfig } from '../config/models.js';
import { ProviderError, RealCallsDisabledError, type AIAdapter, type AnalysisRequest, type AnalysisResponse, type ProviderUsage } from './types.js';
import { redactSecrets } from '../security/redact.js';
import { activationAllows, type RealCallActivation } from '../security/activation.js';

/**
 * Il n'existe AUCUNE activation permanente des appels réels (ni constante, ni variable d'environnement).
 * Un appel exige une activation en mémoire obtenue en consommant une autorisation locale à usage unique
 * (src/security/activation.ts), en plus des autres verrous de l'exécuteur (src/runner/).
 */
export const PERMANENT_ACTIVATION = false as const;

/** Présence d'une clé (sans jamais la lire ni l'afficher). */
export function apiKeyConfigured(provider: 'anthropic' | 'openai', env: NodeJS.ProcessEnv = process.env): boolean {
  const v = provider === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Cohérence du FORMAT de la clé avec le fournisseur (sans jamais renvoyer la valeur) : empêche d'envoyer une clé
 * à un autre fournisseur (variables inversées). Anthropic : préfixe `sk-ant-` ; OpenAI : préfixe `sk-` hors `sk-ant-`.
 */
export function apiKeyFormatProblem(provider: 'anthropic' | 'openai', env: NodeJS.ProcessEnv = process.env): string | null {
  const v = (provider === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY)?.trim();
  if (!v) return null;
  if (provider === 'anthropic' && !v.startsWith('sk-ant-')) {
    return v.startsWith('sk-') ? 'ANTHROPIC_API_KEY contient une clé au format OpenAI (variables inversées ?)' : 'ANTHROPIC_API_KEY : format non reconnu (préfixe sk-ant- attendu)';
  }
  if (provider === 'openai' && (v.startsWith('sk-ant-') || !v.startsWith('sk-'))) {
    return v.startsWith('sk-ant-') ? 'OPENAI_API_KEY contient une clé au format Anthropic (variables inversées ?)' : 'OPENAI_API_KEY : format non reconnu (préfixe sk- attendu)';
  }
  return null;
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
    // Mise en cache activée par défaut et écritures facturées 1,25× : le mode explicite sans point
    // d'arrêt « does not use prompt caching or create cache writes » (guide prompt-caching).
    prompt_cache_options: { mode: 'explicit' as const },
    text: { format: { type: 'json_schema' as const, name: 'dunggle_analysis', schema: req.schema, strict: true } },
  };
}

/** Client minimal attendu (SDK officiel en production, faux client dans les tests : aucun réseau). */
export interface MessagesClient {
  messages: { create(params: Record<string, unknown>): Promise<any> };
}
export interface ResponsesClient {
  responses: { create(params: Record<string, unknown>): Promise<any> };
}

/** Options réseau imposées aux SDK : AUCUNE relance automatique (non budgétée), délai borné. */
export const SDK_OPTIONS = { maxRetries: 0, timeout: 60_000 } as const;

/**
 * Classe une erreur SDK selon son risque financier :
 * - statut HTTP 4xx (requête refusée : authentification, validation, limite de débit ou de dépense) :
 *   non traitée par le fournisseur → requestSent = false (aucun coût) ;
 * - 5xx, délai dépassé, coupure réseau : la requête a pu être traitée → coût incertain (requestSent = true).
 * Le message est masqué (aucun secret) avant d'être propagé.
 */
export function classifySdkError(e: unknown, nowMs: number = Date.now()): ProviderError {
  const err = e as { status?: number; name?: string; message?: string; headers?: unknown };
  const msg = redactSecrets(String(err?.message ?? e));
  const status = typeof err?.status === 'number' ? err.status : undefined;
  if (status !== undefined && status >= 400 && status < 500) {
    const kind = status === 401 || status === 403 ? 'auth' : status === 429 ? 'rate-limit' : 'invalid-request';
    const headers = rateLimitHeaders(err?.headers);
    const retryAfterMs = retryAfterFrom(headers, msg, nowMs);
    const info = Object.keys(headers).length ? ` [en-têtes : ${Object.entries(headers).map(([k, v]) => `${k}=${v}`).join(', ')}]` : ' [aucun en-tête de limitation reçu]';
    // Refusée par le fournisseur : non facturée, mais TRANSMISE (compte dans les quotas).
    return new ProviderError(kind, `HTTP ${status} : ${msg}${info}`, false, null, true, retryAfterMs);
  }
  if (status !== undefined && status >= 500) return new ProviderError('server', `HTTP ${status} : ${msg}`, true);
  if (/timeout/i.test(err?.name ?? '') || /timed? ?out/i.test(msg)) return new ProviderError('timeout', msg, true);
  return new ProviderError('network', msg, true);
}

function assertEnabled(activation: RealCallActivation | null, provider: string, model: ModelConfig, env: NodeJS.ProcessEnv) {
  const denied = activationAllows(activation, model.key);
  if (denied) throw new RealCallsDisabledError(`${provider} — ${denied}`);
  const blockers = realCallBlockers(model, activation).filter((b) => !b.startsWith('Activation'));
  if (blockers.length) throw new ProviderError('invalid-request', `Appel refusé avant envoi : ${blockers.join(' ; ')}`, false);
  if (!apiKeyConfigured(model.provider === 'anthropic' ? 'anthropic' : 'openai', env)) {
    throw new ProviderError('auth', 'Clé API absente de l’environnement : appel refusé avant envoi', false);
  }
  const fmt = apiKeyFormatProblem(model.provider === 'anthropic' ? 'anthropic' : 'openai', env);
  if (fmt) throw new ProviderError('auth', `${fmt} : appel refusé avant envoi`, false);
}

export class AnthropicAdapter implements AIAdapter {
  readonly real = true;
  constructor(
    readonly model: ModelConfig,
    private readonly clientFactory?: () => Promise<MessagesClient>,
    private readonly activation: RealCallActivation | null = null,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  private async client(): Promise<MessagesClient> {
    if (this.clientFactory) return this.clientFactory();
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    // La clé est lue ici, au moment de l'appel, uniquement depuis l'environnement ; elle n'est jamais stockée ni journalisée.
    return new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY, ...SDK_OPTIONS }) as unknown as MessagesClient;
  }

  async analyze(req: AnalysisRequest): Promise<AnalysisResponse> {
    const params = buildAnthropicParams(this.model, req);
    assertEnabled(this.activation, 'anthropic', this.model, this.env);
    const client = await this.client();
    let res: any;
    try {
      res = await client.messages.create(params);
    } catch (e) {
      throw classifySdkError(e);
    }
    const usage = res?.usage ? normalizeAnthropicUsage(res.usage) : null;
    if (res?.stop_reason === 'refusal') throw new ProviderError('refusal', 'Refus du modèle (stop_reason = refusal)', true, usage);
    const rawText = (res?.content ?? []).filter((b: any) => b?.type === 'text').map((b: any) => String(b.text)).join('');
    return { rawText, usage, stopReason: res?.stop_reason ?? null, rawUsage: numericOnly(res?.usage) };
  }
}

/** En-têtes de limitation conservés (liste blanche : aucun secret). Accepte un objet Headers ou un dictionnaire. */
export const RATE_LIMIT_HEADER_WHITELIST = Object.freeze([
  'retry-after', 'retry-after-ms', 'x-request-id', 'request-id',
  'x-ratelimit-limit-requests', 'x-ratelimit-remaining-requests', 'x-ratelimit-reset-requests',
  'x-ratelimit-limit-tokens', 'x-ratelimit-remaining-tokens', 'x-ratelimit-reset-tokens',
  'anthropic-ratelimit-requests-limit', 'anthropic-ratelimit-requests-remaining', 'anthropic-ratelimit-requests-reset',
  'anthropic-ratelimit-tokens-reset', 'anthropic-ratelimit-input-tokens-reset', 'anthropic-ratelimit-output-tokens-reset',
]);
export function rateLimitHeaders(h: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h || typeof h !== 'object') return out;
  const get = typeof (h as { get?: unknown }).get === 'function'
    ? (k: string) => (h as { get(k: string): string | null }).get(k)
    : (k: string) => {
        const e = Object.entries(h as Record<string, unknown>).find(([n]) => n.toLowerCase() === k);
        return e && e[1] != null ? String(e[1]) : null;
      };
  for (const k of RATE_LIMIT_HEADER_WHITELIST) {
    const v = get(k);
    if (v != null && v !== '') out[k] = redactSecrets(String(v)).slice(0, 100);
  }
  return out;
}

/** Durée au format OpenAI (« 1m0s », « 6.5s », « 120ms », « 1h2m3s ») → ms ; null si illisible. */
export function parseDurationMs(s: string): number | null {
  const t = s.trim();
  if (!/^(\d+(\.\d+)?(h|ms|m|s))+$/.test(t)) return null;
  let ms = 0;
  for (const [, n, u] of t.matchAll(/(\d+(?:\.\d+)?)(h|ms|m|s)/g)) ms += Number(n) * (u === 'h' ? 3_600_000 : u === 'm' ? 60_000 : u === 's' ? 1_000 : 1);
  return Math.ceil(ms);
}

/**
 * Délai d'attente le plus long parmi les indications disponibles : retry-after-ms, retry-after (secondes ou date HTTP),
 * réinitialisations OpenAI (durée) et Anthropic (date RFC 3339), et « try again in … » du message. null si aucune.
 */
export function retryAfterFrom(headers: Record<string, string>, message: string, nowMs: number): number | null {
  const c: number[] = [];
  const num = (v?: string) => (v !== undefined && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);
  const ms = num(headers['retry-after-ms']);
  if (ms !== null) c.push(ms);
  const ra = headers['retry-after'];
  if (ra !== undefined) {
    const sec = num(ra);
    if (sec !== null) c.push(sec * 1_000);
    else if (!Number.isNaN(Date.parse(ra))) c.push(Date.parse(ra) - nowMs);
  }
  for (const k of ['x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens']) {
    const d = headers[k] !== undefined ? parseDurationMs(headers[k]) : null;
    if (d !== null) c.push(d);
  }
  for (const k of ['anthropic-ratelimit-requests-reset', 'anthropic-ratelimit-tokens-reset', 'anthropic-ratelimit-input-tokens-reset', 'anthropic-ratelimit-output-tokens-reset']) {
    if (headers[k] !== undefined && !Number.isNaN(Date.parse(headers[k]))) c.push(Date.parse(headers[k]) - nowMs);
  }
  const m = /try again in ((?:\d+(?:\.\d+)?(?:h|ms|m|s))+)/i.exec(message);
  if (m) {
    const d = parseDurationMs(m[1]);
    if (d !== null) c.push(d);
  }
  const valid = c.filter((x) => Number.isFinite(x) && x > 0);
  return valid.length ? Math.ceil(Math.max(...valid)) : null;
}

export class OpenAIAdapter implements AIAdapter {
  readonly real = true;
  constructor(
    readonly model: ModelConfig,
    private readonly clientFactory?: () => Promise<ResponsesClient>,
    private readonly activation: RealCallActivation | null = null,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  private async client(): Promise<ResponsesClient> {
    if (this.clientFactory) return this.clientFactory();
    const { default: OpenAI } = await import('openai');
    return new OpenAI({ apiKey: this.env.OPENAI_API_KEY, ...SDK_OPTIONS }) as unknown as ResponsesClient;
  }

  async analyze(req: AnalysisRequest): Promise<AnalysisResponse> {
    const params = buildOpenAIParams(this.model, req);
    assertEnabled(this.activation, 'openai', this.model, this.env);
    const client = await this.client();
    let res: any;
    try {
      res = await client.responses.create(params);
    } catch (e) {
      throw classifySdkError(e);
    }
    const usage = res?.usage ? normalizeOpenAIUsage(res.usage) : null;
    const refusal = (res?.output ?? []).some((o: any) => (o?.content ?? []).some((c: any) => c?.type === 'refusal'));
    if (refusal) throw new ProviderError('refusal', 'Refus du modèle (contenu « refusal »)', true, usage);
    // status « incomplete » (plafond de sortie atteint) : sortie tronquée, facturée → validée puis rejetée par le pipeline.
    return { rawText: String(res?.output_text ?? ''), usage, stopReason: res?.status ?? null, rawUsage: numericOnly(res?.usage) };
  }
}

/** Raisons empêchant tout appel réel pour un modèle (en plus de REAL_CALLS_ENABLED). */
export function realCallBlockers(model: ModelConfig, activation: RealCallActivation | null = null): string[] {
  const b: string[] = [];
  const denied = activationAllows(activation, model.key);
  if (denied) b.push(`Activation : ${denied}`);
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
 * Usage OpenAI → usage facturable, selon les règles documentées :
 * - output_tokens « includes all tokens generated by the model » (raisonnement compris) → pris tel quel ;
 * - coût d'entrée = entrée ordinaire × 1 + lectures en cache × 0,1 + écritures 30 min × 1,25 + écritures 12 h × 2,5
 *   (guide prompt-caching). Le résultat est exprimé en « tokens équivalents » au prix d'entrée standard.
 *   Les lectures sont comptées à 1× (prudent) ; des écritures sans détail sont comptées à 2,5× (pire cas).
 */
export function normalizeOpenAIUsage(u: {
  input_tokens: number;
  output_tokens: number;
  input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number; cache_write_tokens_details?: { ttl_30m_tokens?: number; ttl_12h_tokens?: number } } | null;
  output_tokens_details?: { reasoning_tokens?: number } | null;
}): ProviderUsage {
  const d = u.input_tokens_details ?? {};
  const writes = d.cache_write_tokens ?? 0;
  const w30 = d.cache_write_tokens_details?.ttl_30m_tokens;
  const w12 = d.cache_write_tokens_details?.ttl_12h_tokens;
  const writeEquivalent = w30 !== undefined || w12 !== undefined ? 1.25 * (w30 ?? 0) + 2.5 * (w12 ?? 0) : 2.5 * writes;
  const nonWrite = Math.max(0, u.input_tokens - writes); // entrée ordinaire + lectures, comptées à 1×
  return {
    inputTokens: Math.ceil(nonWrite + writeEquivalent),
    outputTokens: u.output_tokens,
    reasoningTokens: u.output_tokens_details?.reasoning_tokens,
  };
}

/** Conserve uniquement les compteurs numériques (récursivement) d'un objet d'usage fournisseur. */
export function numericOnly(u: unknown): Record<string, unknown> | null {
  if (!u || typeof u !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(u as Record<string, unknown>)) {
    if (typeof v === 'number') out[k] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const n = numericOnly(v);
      if (n && Object.keys(n).length) out[k] = n;
    }
  }
  return out;
}
