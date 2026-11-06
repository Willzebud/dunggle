import { readFileSync } from 'node:fs';
import type { PublicationInput } from '../src/types.js';

/** Interdit tout accès réseau pendant les tests : un appel à fetch fait échouer le test. */
export const networkCalls: string[] = [];
export function forbidNetwork(): void {
  globalThis.fetch = (async (input: unknown) => {
    networkCalls.push(String(input));
    throw new Error(`Accès réseau interdit pendant les tests : ${String(input)}`);
  }) as typeof fetch;
}

const fixturesDir = new URL('../fixtures/', import.meta.url);
export const evaluationSet = JSON.parse(readFileSync(new URL('evaluation-set.json', fixturesDir), 'utf8')) as { items: PublicationInput[] };
export const groundTruth = JSON.parse(readFileSync(new URL('ground-truth.json', fixturesDir), 'utf8')) as {
  items: {
    id: string;
    themes: string[];
    acceptableExtraThemes: string[];
    types: string[];
    relevance: 'high' | 'medium' | 'low';
    novelty: [number, number];
    acceptableExclusions: (string | null)[];
    sections: string[];
    ambiguous: boolean;
    summaryExpected: boolean;
    expectedStatus?: string;
    referenceFacts?: string[];
    forbiddenClaims?: string[];
  }[];
};

export function pub(over: Partial<PublicationInput> = {}): PublicationInput {
  return {
    id: 'test:1',
    synthetic: true,
    sourceId: 'synthetic-fixtures',
    sourceName: 'Fixtures',
    sourceType: 'synthetic',
    url: 'https://example.invalid/dunggle-fixtures/test?utm_source=rss#frag',
    title: '[SYNTHÉTIQUE] Publication de test',
    publishedAt: '2026-11-01T00:00:00.000Z',
    contentLevel: 'FULL',
    text: 'Texte synthétique de test décrivant la version 2.0 et une nouvelle API de démonstration. '.repeat(5),
    ...over,
  };
}

export const byId = (id: string) => evaluationSet.items.find((p) => p.id === id)!;
