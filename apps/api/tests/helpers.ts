/** Interdit tout accès réseau pendant les tests : un appel à fetch fait échouer le test. */
export const networkCalls: string[] = [];
export function forbidNetwork(): void {
  globalThis.fetch = (async (input: unknown) => {
    networkCalls.push(String(input));
    throw new Error(`Accès réseau interdit pendant les tests : ${String(input)}`);
  }) as typeof fetch;
}

import type { AnalysisOutput, PublicationInput } from '../src/analysis/types.js';

/** Publication de test (synthétique). Source inconnue de la configuration → politique metadata-only par défaut. */
export function pub(over: Partial<PublicationInput> = {}): PublicationInput {
  return {
    id: 'test:1',
    synthetic: true,
    sourceId: 'test-source',
    sourceName: 'Fixtures',
    sourceType: 'feed',
    url: 'https://example.invalid/dunggle-fixtures/test?utm_source=rss#frag',
    title: '[SYNTHÉTIQUE] Publication de test',
    publishedAt: '2026-11-01T00:00:00.000Z',
    contentLevel: 'FULL',
    text: 'Texte synthétique de test décrivant la version 2.0 et une nouvelle API de démonstration. '.repeat(5),
    ...over,
  };
}

/** Réponse de modèle valide minimale (JSON), surchargeable. */
export function mockOutput(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    themes: ['AI'],
    subthemes: ['ai_models'],
    type: 'research',
    relevance: 70,
    novelty: 3,
    confidence: 0.8,
    relevanceReason: 'Publication liée à un nouveau modèle.',
    summary: null,
    keyPoints: [],
    exclusionReason: null,
    ...over,
  });
}

export const out = (o: Partial<AnalysisOutput> = {}): AnalysisOutput => ({ ...(JSON.parse(mockOutput()) as AnalysisOutput), ...o });

/**
 * Faux `fetch` pour la collecte hors ligne : ne sert QUE les URL déclarées (réponses synthétiques) et échoue pour
 * toute autre URL. Les appels sont enregistrés pour vérification.
 */
export interface FakeRoute { status?: number; body: string; contentType?: string; headers?: Record<string, string> }
export function installFakeFetch(routes: Record<string, FakeRoute>): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    const url = String(input);
    calls.push(url);
    const r = routes[url];
    if (!r) throw new Error(`Accès réseau interdit pendant les tests : ${url}`);
    void init;
    const res = new Response(r.body, { status: r.status ?? 200, headers: { 'content-type': r.contentType ?? 'application/rss+xml', ...(r.headers ?? {}) } });
    Object.defineProperty(res, 'url', { value: url });
    return res;
  }) as typeof fetch;
  return calls;
}

import { BudgetGuard, MemoryUsageLogger } from '../src/budget/guard.js';
import { MemoryBudgetStore } from '../src/budget/store.js';
import { DEFAULT_LIMITS, PRODUCTION_QUOTAS, type BudgetLimits, type ProductionQuotas } from '../src/config/limits.js';
import { MODELS, type ModelConfig } from '../src/config/model.js';

/** Modèles FICTIFS des tests (jamais dans la configuration de l'application). */
const simulated = { status: 'simulated' as const, checks: [], blockers: [], firstRequestChecks: [] };
export const TEST_MODELS: Record<string, ModelConfig> = {
  ...MODELS,
  /** Tarif volontairement élevé pour exercer les plafonds : (100 × 1 + 800 × 5)/1e6 × 1,25 = 0,005125 € par requête de 100 tokens. */
  'mock-cheap': { key: 'mock-cheap', provider: 'mock', modelId: 'mock-cheap', pricing: [{ maxInputTokens: null, inputUsdPerMTok: 1, outputUsdPerMTok: 5 }], verifiedAt: 'fictif', sources: [], structuredOutput: 'simulé', billingNotes: [], maxOutputTokensProvider: null, validation: simulated },
  'mock-unpriced': { key: 'mock-unpriced', provider: 'mock', modelId: 'mock-unpriced', pricing: null, verifiedAt: null, sources: [], structuredOutput: 'simulé', billingNotes: [], maxOutputTokensProvider: null, validation: simulated },
  'mock-not-validated': { key: 'mock-not-validated', provider: 'mock', modelId: 'x', pricing: [{ maxInputTokens: null, inputUsdPerMTok: 1, outputUsdPerMTok: 1 }], verifiedAt: '2026-11-06', sources: [], structuredOutput: 'simulé', billingNotes: [], maxOutputTokensProvider: null, validation: { ...simulated, status: 'not-validated', blockers: ['test'] } },
};

/** Garde de test : registre en mémoire, modèles fictifs disponibles, horloge et limites surchargeables. */
export function testGuard(o: { limits?: Partial<BudgetLimits>; now?: () => Date; logger?: MemoryUsageLogger; store?: MemoryBudgetStore; quotas?: ProductionQuotas } = {}): BudgetGuard {
  return new BudgetGuard(o.store ?? new MemoryBudgetStore(), { ...DEFAULT_LIMITS, ...o.limits }, o.logger ?? new MemoryUsageLogger(), o.now ?? (() => new Date('2026-11-06T10:00:00.000Z')), TEST_MODELS, o.quotas ?? PRODUCTION_QUOTAS);
}
