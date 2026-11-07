/** Temporisation par fournisseur (reprise du POC 2) : 75 s après la FIN de la requête OpenAI précédente. Hors ligne. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { forbidNetwork } from '../helpers.js';
import { MemoryPacingStore, ProviderPacer } from '../../src/budget/pacing.js';
import { ProviderError, type AIAdapter } from '../../src/analysis/adapter.js';
import { PROVIDER_MIN_GAP_AFTER_END_MS, PROVIDER_REQUEST_TIMEOUT_MS } from '../../src/config/limits.js';
import { TEST_MODELS } from '../helpers.js';

before(forbidNetwork);

test('délais figés : OpenAI 75 s après la fin, requête en vol supposée durer 60 s', () => {
  assert.equal(PROVIDER_MIN_GAP_AFTER_END_MS.openai, 75_000);
  assert.equal(PROVIDER_REQUEST_TIMEOUT_MS, 60_000);
  assert.ok(Object.isFrozen(PROVIDER_MIN_GAP_AFTER_END_MS));
});

test('aucune contrainte au départ ; puis fin + 75 s ; Retry-After plus long respecté', async () => {
  const p = new ProviderPacer(new MemoryPacingStore());
  assert.equal(await p.earliestStart('openai'), 0);
  await p.begin('openai', 1_000);
  await p.end('openai', 4_000, null);
  assert.equal(await p.earliestStart('openai'), 79_000);
  await p.begin('openai', 80_000);
  await p.end('openai', 81_000, 120_000);
  assert.equal(await p.earliestStart('openai'), 201_000);
});

test('arrêt brutal pendant une requête : état persistant « en vol » → début + 60 s + 75 s', async () => {
  const store = new MemoryPacingStore();
  await new ProviderPacer(store).begin('openai', 10_000);
  // « redémarrage » : nouveau pacer sur le même état persistant
  assert.equal(await new ProviderPacer(store).earliestStart('openai'), 10_000 + 60_000 + 75_000);
});

test('adaptateur temporisé : attend avant l’envoi, note la fin même en cas d’erreur, avec le Retry-After', async () => {
  let clock = 0;
  const waits: number[] = [];
  const store = new MemoryPacingStore({ openai: { lastEndedAt: 0 } });
  const pacer = new ProviderPacer(store);
  let fail = false;
  const inner: AIAdapter = {
    real: false,
    model: TEST_MODELS['mock-cheap'],
    analyze: async () => {
      clock += 2_000;
      if (fail) throw new ProviderError('rate-limit', 'HTTP 429', false, null, true, 30_000);
      return { rawText: '{}', usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'completed' };
    },
  };
  const a = pacer.wrap(inner, 'openai', () => clock, async (ms) => { waits.push(ms); clock += ms; });
  await a.analyze({ system: 's', user: 'u', schema: {}, maxOutputTokens: 10 });
  assert.deepEqual(waits, [75_000]);
  assert.equal((await store.load()).openai?.lastEndedAt, 77_000);
  fail = true;
  await assert.rejects(a.analyze({ system: 's', user: 'u', schema: {}, maxOutputTokens: 10 }), ProviderError);
  const s = (await store.load()).openai!;
  assert.equal(s.inFlightSince, undefined, 'fin notée malgré l’erreur');
  assert.equal(s.notBefore, s.lastEndedAt! + 75_000, 'le plus long des deux délais (75 s > 30 s)');
});
