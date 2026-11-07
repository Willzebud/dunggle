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
