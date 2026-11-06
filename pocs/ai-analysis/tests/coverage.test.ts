import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { forbidNetwork, evaluationSet, pub } from './helpers.js';
import { analyzePublication, computeSection } from '../src/pipeline.js';
import { MockAdapter, mockOutput } from '../src/adapters/mock.js';
import { BudgetGuard } from '../src/budget/guard.js';
import { MemoryBudgetStore } from '../src/budget/store.js';
import { DEFAULT_LIMITS } from '../src/config/budget.js';
import { coverageFor, MANDATORY_COVERAGE_SOURCES } from '../src/config/coverage.js';
import type { AnalysisOutput, PublicationInput } from '../src/types.js';

before(forbidNetwork);

const guard = (over = {}) => new BudgetGuard(new MemoryBudgetStore(), { ...DEFAULT_LIMITS, ...over });
const ok = (over: Record<string, unknown> = {}) => new MockAdapter(() => ({ rawText: mockOutput(over), usage: { inputTokens: 600, outputTokens: 80 }, stopReason: 'end_turn' }));
const out = (o: Partial<AnalysisOutput>): AnalysisOutput => ({ ...(JSON.parse(mockOutput()) as AnalysisOutput), ...o });
const angularRelease = evaluationSet.items.find((p) => p.sourceId === 'gh-angular')!;
const mcpRelease = evaluationSet.items.find((p) => p.sourceId === 'gh-mcp-ts-sdk')!;

test('couverture : déterminée par la source (8 canaux officiels), pas par le modèle', () => {
  assert.equal(Object.keys(MANDATORY_COVERAGE_SOURCES).length, 8);
  for (const id of ['gh-angular', 'typescript-blog', 'gh-mcp-ts-sdk', 'gh-langgraph', 'gh-openai-agents']) assert.equal(coverageFor(id), 'mandatory');
  for (const id of ['openai-news', 'mit-tech-review', 'simon-willison', 'source-inconnue']) assert.equal(coverageFor(id), 'selective');
});

test('couverture obligatoire : pertinence moyenne et nouveauté faible → « Mises à jour », sans forcer la pertinence', async () => {
  const r = await analyzePublication(angularRelease, { adapter: ok({ themes: ['ANGULAR'], type: 'release', relevance: 45, novelty: 1 }), guard: guard() });
  assert.equal(r.coveragePolicy, 'mandatory');
  assert.equal(r.section, 'updates');
  assert.equal(r.analysis!.relevance, 45, 'la pertinence renvoyée n’est pas modifiée');
});

test('couverture obligatoire : un score très bas ou une thématique erronée n’exclut pas', async () => {
  const r = await analyzePublication(mcpRelease, { adapter: ok({ themes: ['DIGITAL_INNOVATION'], type: 'release', relevance: 3, novelty: 1, exclusionReason: 'off_topic' }), guard: guard() });
  assert.equal(r.section, 'updates');
  assert.equal(r.analysis!.exclusionReason, null);
  assert.ok(r.violations.some((v) => v.startsWith('mandatory-coverage-exclusion-overridden (off_topic)')));
});

test('couverture obligatoire : doublon avéré exclu ; version majeure dans le flux principal', () => {
  assert.equal(computeSection(angularRelease, out({ type: 'release', exclusionReason: 'duplicate' })).section, 'excluded');
  assert.equal(computeSection(angularRelease, out({ type: 'release', novelty: 4 })).section, 'main');
});

test('couverture obligatoire : ne neutralise pas les restrictions de contenu (metadata-only)', async () => {
  const adapter = ok({ themes: ['ANGULAR'], type: 'release', summary: 'Résumé non autorisé.', keyPoints: ['x'] });
  const r = await analyzePublication({ ...angularRelease, text: 'Notes de release présentes localement.' }, { adapter, guard: guard() });
  assert.equal(JSON.parse(adapter.calls[0].user).untrustedPublication.text, null);
  assert.equal(r.analysis!.summary, null);
  assert.ok(r.violations.some((v) => v.startsWith('summary-forbidden')));
});

test('couverture obligatoire : ne neutralise pas une exclusion éditoriale déterministe', async () => {
  const p: PublicationInput = { ...angularRelease, id: 'test:editorial', editorial: { ruleId: 'regle-test', kind: 'recurring-digest', action: 'excluded', reason: 'test' } };
  const adapter = ok();
  const r = await analyzePublication(p, { adapter, guard: guard() });
  assert.equal(r.status, 'skipped-editorial');
  assert.equal(r.section, 'excluded');
  assert.equal(adapter.calls.length, 0);
});

test('couverture obligatoire : une release non analysée (budget épuisé) reste visible ; une source sélective reste en attente', async () => {
  const mandatory = await analyzePublication(angularRelease, { adapter: ok(), guard: guard({ trialTotalCapEur: 0 }) });
  assert.equal(mandatory.status, 'refused-budget');
  assert.equal(mandatory.section, 'updates');
  assert.ok(mandatory.violations.includes('mandatory-coverage-unanalyzed'));
  const selective = await analyzePublication(pub(), { adapter: ok(), guard: guard({ trialTotalCapEur: 0 }) });
  assert.equal(selective.section, 'pending');
});

test('sources sélectives : un score bas n’exclut jamais à lui seul', () => {
  const p = pub({ sourceId: 'openai-news', synthetic: false });
  assert.equal(computeSection(p, out({ relevance: 2, novelty: 1, exclusionReason: null })).section, 'main');
  assert.equal(computeSection(p, out({ exclusionReason: 'promotional' })).section, 'excluded');
});
