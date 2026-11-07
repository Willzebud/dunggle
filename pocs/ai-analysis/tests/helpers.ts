import { readFileSync } from 'node:fs';
import type { PublicationInput } from '../src/types.js';
import { BudgetGuard } from '../src/budget/guard.js';
import { createGrant } from '../src/security/activation.js';
import { POC_PHASES, type PocPhase, type PocPhaseQuotas } from '../src/config/quotas.js';

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
    editorialDecision: 'must_keep' | 'must_exclude' | 'ambiguous';
    coveragePolicy: 'mandatory' | 'selective';
    hardToClassify: boolean;
    themes: string[];
    acceptableExtraThemes: string[];
    types: string[];
    relevance: 'high' | 'medium' | 'low';
    novelty: [number, number];
    acceptableExclusions: (string | null)[];
    sections: string[];
    summaryAllowed: boolean;
    summaryExpected: boolean | 'if-kept';
    exclusionBehaviourTest?: boolean;
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

// ---------------------------------------------------------------------------------------------------------------
// Phases du POC : toutes FERMÉES dans la configuration versionnée depuis le 2026-11-07 (B1, B2, B3 : active: false).
// Les tests de MÉCANIQUE (quotas cumulatifs, exceptions, reprises, temporisation, autorisation, sécurité) rejouent
// B1/B2/B3 sur une COPIE ouverte de la table, injectée par code uniquement, avec des registres simulés ou temporaires.
// La fermeture réelle est vérifiée séparément (tests/phases-closed.test.ts) avec la configuration par défaut.

export const OPEN_TEST_PHASES: Readonly<Record<PocPhase, Readonly<PocPhaseQuotas>>> = Object.freeze({
  B1: Object.freeze({ ...POC_PHASES.B1, active: true }),
  B2: Object.freeze({ ...POC_PHASES.B2, active: true }),
  B3: Object.freeze({ ...POC_PHASES.B3, active: true }),
});

type GuardArgs = ConstructorParameters<typeof BudgetGuard>;
/** Garde budgétaire de test : mêmes paramètres que BudgetGuard (défauts inchangés), table des phases ouverte. */
export function testGuard(store: GuardArgs[0], limits?: GuardArgs[1], logger?: GuardArgs[2], now?: GuardArgs[3], models?: GuardArgs[4], productionQuotas?: GuardArgs[5]): BudgetGuard {
  return new BudgetGuard(store, limits, logger, now, models, productionQuotas, OPEN_TEST_PHASES);
}

/** Autorisation locale de test : mêmes contrôles que createGrant, sur la table des phases ouverte. */
export function testCreateGrant(p: Parameters<typeof createGrant>[0], dir: string, now?: Date) {
  return createGrant(p, dir, now, OPEN_TEST_PHASES);
}
