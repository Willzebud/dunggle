import { MODELS, type ModelConfig } from '../config/models.js';
import type { AIAdapter, AnalysisRequest, AnalysisResponse } from './types.js';

export type MockBehaviour = (req: AnalysisRequest, callIndex: number) => Promise<AnalysisResponse> | AnalysisResponse;

/** Adaptateur simulé : aucune requête réseau, comportement entièrement scripté par les tests. */
export class MockAdapter implements AIAdapter {
  readonly real = false;
  readonly calls: AnalysisRequest[] = [];
  constructor(
    private readonly behaviour: MockBehaviour,
    readonly model: ModelConfig = MODELS['mock-cheap'],
  ) {}
  async analyze(req: AnalysisRequest): Promise<AnalysisResponse> {
    const i = this.calls.length;
    this.calls.push(req);
    return this.behaviour(req, i);
  }
}

/** Réponse valide minimale, surchargeable. */
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
