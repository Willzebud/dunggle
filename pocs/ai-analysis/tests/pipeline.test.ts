import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { forbidNetwork, networkCalls, pub, byId, evaluationSet } from './helpers.js';
import { analyzePublication, computeSection, ungroundedNumbers } from '../src/pipeline.js';
import { MockAdapter, mockOutput } from '../src/adapters/mock.js';
import { ProviderError } from '../src/adapters/types.js';
import { AnthropicAdapter, OpenAIAdapter } from '../src/adapters/real.js';
import { MODELS } from '../src/config/models.js';
import { BudgetGuard, MemoryUsageLogger } from '../src/budget/guard.js';
import { MemoryBudgetStore } from '../src/budget/store.js';
import { DEFAULT_LIMITS } from '../src/config/budget.js';
import type { AnalysisOutput } from '../src/types.js';

before(forbidNetwork);

const now = () => new Date('2026-11-06T10:00:00.000Z');
const guard = (over = {}) => new BudgetGuard(new MemoryBudgetStore(), { ...DEFAULT_LIMITS, ...over }, new MemoryUsageLogger(), now);
const ok = (over: Record<string, unknown> = {}) => new MockAdapter(() => ({ rawText: mockOutput(over), usage: { inputTokens: 500, outputTokens: 100 }, stopReason: 'end_turn' }));

test('URL originale conservée à l’identique, quel que soit le statut', async () => {
  const p = pub();
  for (const adapter of [ok(), new MockAdapter(() => Promise.reject(new ProviderError('server', '500', true)))]) {
    const r = await analyzePublication(p, { adapter, guard: guard() });
    assert.equal(r.url, p.url, 'aucune normalisation (utm, fragment conservés)');
  }
  const blocked = await analyzePublication(byId('synthetic:blocked-source'), { adapter: ok(), guard: guard() });
  assert.equal(blocked.url, 'https://example.invalid/dunggle-fixtures/blocked-source');
});

test('source bloquée : aucun appel au modèle, aucune réservation, publication conservée', async () => {
  const adapter = ok();
  const g = guard();
  const r = await analyzePublication(byId('synthetic:blocked-source'), { adapter, guard: g });
  assert.equal(r.status, 'skipped-blocked');
  assert.equal(r.section, 'pending');
  assert.equal(adapter.calls.length, 0);
  assert.deepEqual((await g.snapshot()).reservations, {});
});

test('metadata-only (source réelle) : aucun texte transmis, résumé du modèle supprimé et tracé', async () => {
  const adapter = ok({ summary: 'Résumé inventé à partir de rien.', keyPoints: ['Point inventé'] });
  const real = byId(evaluationSet.items.find((p) => p.sourceId === 'mit-tech-review' && !p.editorial)!.id);
  const r = await analyzePublication({ ...real, text: 'Texte intégral présent localement mais non autorisé.' }, { adapter, guard: guard() });
  const sent = JSON.parse(adapter.calls[0].user);
  assert.equal(sent.untrustedPublication.text, null);
  assert.equal(sent.contentProvided, 'metadata');
  assert.ok(!adapter.calls[0].user.includes('Texte intégral présent localement'));
  assert.equal(r.analysis!.summary, null);
  assert.deepEqual(r.analysis!.keyPoints, []);
  assert.ok(r.violations.some((v) => v.startsWith('summary-forbidden')));
});

test('MINIMAL : aucun résumé même pour une source synthétique autorisée', async () => {
  const r = await analyzePublication(byId('synthetic:minimal-announcement'), { adapter: ok({ summary: 'Résumé', keyPoints: ['x'] }), guard: guard() });
  assert.equal(r.inputMode, 'metadata');
  assert.equal(r.analysis!.summary, null);
});

test('FULL autorisé : texte transmis et résumé conservé s’il est fondé sur le texte', async () => {
  const fixture = byId('synthetic:orion-multimodal');
  const adapter = ok({ summary: 'OrionVision est un modèle multimodal de 7 milliards de paramètres sous licence Apache-2.0, avec un score de 81,4 sur BenchX.', keyPoints: ['Poids ouverts'] });
  const r = await analyzePublication(fixture, { adapter, guard: guard() });
  assert.equal(r.inputMode, 'full');
  assert.ok(JSON.parse(adapter.calls[0].user).untrustedPublication.text.includes('Apache-2.0'));
  assert.ok(r.analysis!.summary);
  assert.deepEqual(r.violations, []);
});

test('aucun fait inventé : un nombre absent du texte fait supprimer le résumé', async () => {
  const r = await analyzePublication(byId('synthetic:orion-multimodal'), { adapter: ok({ summary: 'Modèle de 13 milliards de paramètres.', keyPoints: ['13 milliards'] }), guard: guard() });
  assert.equal(r.analysis!.summary, null);
  assert.ok(r.violations.some((v) => v.startsWith('ungrounded-number')));
  assert.deepEqual(ungroundedNumbers('score de 81,4 et version 2099-01', 'score 81,4 révision 2099-01'), []);
});

test('PARTIAL : résumé plus long que l’extrait supprimé', async () => {
  const long = 'Ce résumé est volontairement bien plus long que l’extrait fourni au modèle. '.repeat(6);
  const r = await analyzePublication(byId('synthetic:orchestrajs-32'), { adapter: ok({ summary: long.trim() }), guard: guard() });
  assert.equal(r.inputMode, 'excerpt');
  assert.equal(r.analysis!.summary, null);
  assert.ok(r.violations.includes('summary-longer-than-excerpt'));
});

test('exclusion éditoriale (The Download) : non analysée, conservée et récupérable', async () => {
  const dl = evaluationSet.items.find((p) => p.editorial?.action === 'excluded')!;
  const adapter = ok();
  const r = await analyzePublication(dl, { adapter, guard: guard() });
  assert.equal(r.status, 'skipped-editorial');
  assert.equal(r.section, 'excluded');
  assert.equal(adapter.calls.length, 0);
  const recovered = await analyzePublication(dl, { adapter, guard: guard(), analyzeEditorialExcluded: true });
  assert.equal(recovered.status, 'analyzed');
});

test('exclusion décidée par le modèle : publication conservée avec son motif', async () => {
  const r = await analyzePublication(byId('synthetic:lumio-funding'), { adapter: ok({ themes: [], exclusionReason: 'funding_only' }), guard: guard() });
  assert.equal(r.status, 'analyzed');
  assert.equal(r.section, 'excluded');
  assert.equal(r.analysis!.exclusionReason, 'funding_only');
});

const out = (o: Partial<AnalysisOutput>): AnalysisOutput => ({ ...(JSON.parse(mockOutput()) as AnalysisOutput), ...o });

test('releases prioritaires : toujours visibles (Mises à jour), même avec faible importance ou exclusion', () => {
  const rel = byId(evaluationSet.items.find((p) => p.sourceId === 'gh-angular')!.id);
  assert.equal(computeSection(rel, out({ themes: ['ANGULAR'], type: 'release', novelty: 1, relevance: 85 })).section, 'updates');
  const over = computeSection(rel, out({ themes: ['ANGULAR'], type: 'release', novelty: 1, exclusionReason: 'off_topic' }));
  assert.equal(over.section, 'updates');
  assert.equal(over.analysis.exclusionReason, null);
  assert.ok(over.violations[0].startsWith('mandatory-coverage-exclusion-overridden'));
  assert.equal(computeSection(rel, out({ themes: ['ANGULAR'], type: 'release', novelty: 5 })).section, 'main', 'version majeure : flux principal');
  assert.equal(computeSection(rel, out({ themes: ['ANGULAR'], type: 'release', exclusionReason: 'duplicate' })).section, 'excluded', 'doublon réel : exclu');
});

test('cas ambigus : jamais supprimés, statut et rubrique toujours renseignés', async () => {
  const amb = evaluationSet.items.filter((p) => ['synthetic:regional-agents-rules', 'synthetic:minimal-announcement'].includes(p.id));
  for (const p of amb) {
    const r = await analyzePublication(p, { adapter: ok({ confidence: 0.3 }), guard: guard() });
    assert.ok(['main', 'updates', 'excluded', 'pending'].includes(r.section));
    assert.equal(r.publicationId, p.id);
  }
});

test('erreurs fournisseur : non envoyée → libérée ; usage connu → réconcilié ; inconnu → incertain', async () => {
  const g = guard();
  const before = await analyzePublication(pub({ id: 'a' }), { adapter: new MockAdapter(() => Promise.reject(new ProviderError('network', 'DNS', false))), guard: g });
  assert.equal(before.costEur, 0);
  const refused = await analyzePublication(pub({ id: 'b' }), { adapter: new MockAdapter(() => Promise.reject(new ProviderError('refusal', 'refus', true, { inputTokens: 400, outputTokens: 5 }))), guard: g });
  assert.equal(refused.costEur, 0.000425);
  const timeout = await analyzePublication(pub({ id: 'c' }), { adapter: new MockAdapter(() => Promise.reject(new ProviderError('timeout', 'délai', true))), guard: g });
  assert.equal(timeout.costUncertain, true);
  assert.ok(timeout.costEur! > 0);
  for (const r of [before, refused, timeout]) {
    assert.equal(r.status, 'provider-error');
    assert.equal(r.section, 'pending');
  }
  assert.deepEqual((await g.snapshot()).reservations, {}, 'aucune réservation laissée ouverte');
});

test('sortie invalide : publication conservée en attente, coût réconcilié', async () => {
  const r = await analyzePublication(pub(), { adapter: new MockAdapter(() => ({ rawText: '{"themes":["X"]}', usage: { inputTokens: 100, outputTokens: 10 }, stopReason: 'end_turn' })), guard: guard() });
  assert.equal(r.status, 'invalid-output');
  assert.equal(r.section, 'pending');
  assert.ok(r.costEur! > 0);
});

test('usage absent de la réponse : coût compté au maximum (incertain)', async () => {
  const r = await analyzePublication(pub(), { adapter: new MockAdapter(() => ({ rawText: mockOutput(), usage: null, stopReason: null })), guard: guard() });
  assert.equal(r.costUncertain, true);
});

test('budget épuisé ou tarif inconnu : pas d’appel, publication en attente', async () => {
  const adapter = ok();
  const r = await analyzePublication(pub(), { adapter, guard: guard({ trialTotalCapEur: 0 }) });
  assert.equal(r.status, 'refused-budget');
  const unpriced = new MockAdapter(() => ({ rawText: mockOutput(), usage: null, stopReason: null }), MODELS['mock-unpriced']);
  const r2 = await analyzePublication(pub(), { adapter: unpriced, guard: guard() });
  assert.equal(r2.status, 'refused-unknown-pricing');
  assert.equal(adapter.calls.length + unpriced.calls.length, 0);
});

test('adaptateurs réels : sans contexte de quota → refus ; sans activation → aucune requête, réservation et quota rendus', async () => {
  const g = guard();
  for (const adapter of [new AnthropicAdapter(MODELS['anthropic-haiku-5-5']), new OpenAIAdapter(MODELS['openai-gpt-6-luna'])]) {
    const noQuota = await analyzePublication(byId('synthetic:angular-99'), { adapter, guard: g });
    assert.equal(noQuota.status, 'refused-quota');
    const r = await analyzePublication(byId('synthetic:angular-99'), { adapter, guard: g, quota: { scope: 'trial', phase: 'B1', runId: 'test' } });
    assert.equal(r.status, 'provider-error');
    assert.match(r.error!, /Appels réels désactivés/);
    assert.equal(r.costEur, 0);
  }
  const s = await g.snapshot();
  assert.equal(s.trial.spentEur, 0);
  assert.equal(s.quotas.phases.B1?.total ?? 0, 0, 'requêtes non transmises : quota décompté');
  assert.equal(networkCalls.length, 0);
});
