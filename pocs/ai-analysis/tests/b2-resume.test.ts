/**
 * Reprise de B.2 après l'incident HTTP 429 (hors ligne, horloge simulée, aucun réseau) :
 * diagnostic des erreurs de limitation, temporisation persistante (75 s après la fin, Retry-After, interruption,
 * redémarrage), exception de quota liée à la publication refusée, décompte exact des analyses restantes.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forbidNetwork, evaluationSet } from './helpers.js';
import { classifySdkError, parseDurationMs, rateLimitHeaders, retryAfterFrom } from '../src/adapters/real.js';
import { MockAdapter, mockOutput } from '../src/adapters/mock.js';
import { ProviderError } from '../src/adapters/types.js';
import { BudgetGuard } from '../src/budget/guard.js';
import { FileBudgetStore, MemoryBudgetStore } from '../src/budget/store.js';
import { DEFAULT_LIMITS } from '../src/config/budget.js';
import { MODELS } from '../src/config/models.js';
import { PHASE_QUOTA_EXCEPTIONS, PROVIDER_MIN_GAP_AFTER_END_MS, phaseModelMax, phaseTotalMax } from '../src/config/quotas.js';
import { PROMPT_VERSION } from '../src/prompt.js';
import { parseArgs } from '../src/runner/args.js';
import { FilePacingStore, MemoryPacingStore, ProviderPacer } from '../src/runner/pacing.js';
import { planRun, SMOKE_FIXTURE_ID } from '../src/runner/plan.js';
import { CALL_LATENCY_ASSUMPTIONS_MS, estimateRunDurationMs, executeRun, pacingOffsets, type RunDeps } from '../src/runner/run.js';
import { ACTIVATION_TTL_MS_BY_PHASE, consumeGrant, createGrant, confirmationPhrase, type RealCallActivation } from '../src/security/activation.js';

before(forbidNetwork);
const HAIKU = 'anthropic-haiku-5-5';
const LUNA = 'openai-gpt-6-luna';
const MODELS2 = [HAIKU, LUNA];
const GAP = PROVIDER_MIN_GAP_AFTER_END_MS.openai;
const INCIDENT_RUN = '5742ce5d-75fc-4ec9-9090-f8d10d94da87';
const INCIDENT_PUB = 'gh-angular-components:433858366';
const EXC = PHASE_QUOTA_EXCEPTIONS.find((e) => e.phase === 'B2')!;
const INCIDENT_MSG = '429 Rate limit reached for gpt-6-luna in project proj_X organization org-X on requests per min (RPM): Limit 1, Used 1, Requested 1. Please try again in 1m0s. Visit https://platform.openai.com/account/rate-limits to learn more.';

// ================================================================ 1. Diagnostic
test('Diagnostic 429 : message réel sans en-têtes → délai « try again in 1m0s » retenu, absence d’en-têtes signalée', () => {
  const e = classifySdkError({ status: 429, message: INCIDENT_MSG });
  assert.equal(e.kind, 'rate-limit');
  assert.equal(e.transmitted, true);
  assert.equal(e.requestSent, false, 'non facturée');
  assert.equal(e.retryAfterMs, 60_000);
  assert.match(e.message, /aucun en-tête de limitation reçu/);
});

test('Diagnostic 429 : en-têtes Retry-After et réinitialisation (Headers ou dictionnaire), liste blanche sans secret', () => {
  const now = Date.parse('2026-11-06T20:02:24Z');
  const h = new Headers({ 'retry-after': '20', 'x-ratelimit-reset-requests': '1m30s', 'x-ratelimit-remaining-requests': '0', 'x-request-id': 'req_abc', authorization: 'Bearer sk-secret', 'set-cookie': 'a=b' });
  const e = classifySdkError({ status: 429, message: 'Rate limit', headers: h }, now);
  assert.equal(e.retryAfterMs, 90_000, 'le délai le plus long l’emporte');
  assert.match(e.message, /x-ratelimit-remaining-requests=0/);
  assert.match(e.message, /x-request-id=req_abc/);
  assert.ok(!/Bearer|sk-secret|set-cookie/.test(e.message), 'en-têtes hors liste blanche jamais conservés');
  assert.deepEqual(Object.keys(rateLimitHeaders({ 'Retry-After-Ms': '1500', Cookie: 'x' })), ['retry-after-ms']);
  assert.equal(retryAfterFrom({ 'retry-after-ms': '1500' }, '', now), 1_500);
  assert.equal(retryAfterFrom({ 'retry-after': new Date(now + 45_000).toUTCString() }, '', now), 45_000);
  assert.equal(retryAfterFrom({ 'anthropic-ratelimit-requests-reset': new Date(now + 30_000).toISOString() }, '', now), 30_000);
  assert.equal(retryAfterFrom({}, 'pas d’indication', now), null);
  assert.deepEqual(['1m0s', '6.5s', '120ms', '1h2m3s', 'abc'].map(parseDurationMs), [60_000, 6_500, 120, 3_723_000, null]);
  assert.equal(classifySdkError({ status: 400, message: 'bad' }).retryAfterMs, null);
});

// ================================================================ 2. Temporisation
test('Temporisation : 75 s après la FIN de la requête précédente ; Retry-After plus long respecté', async () => {
  const p = new ProviderPacer(new MemoryPacingStore());
  assert.equal(await p.earliestStart('openai'), 0, 'aucune contrainte au départ');
  await p.begin('openai', 1_000);
  await p.end('openai', 7_300, null); // requête de 6,3 s (comme la 2e requête Luna de l'incident)
  assert.equal(await p.earliestStart('openai'), 7_300 + GAP);
  assert.equal(await p.earliestStart('anthropic'), 0, 'fournisseurs indépendants');
  await p.begin('openai', 82_300);
  await p.end('openai', 83_000, 120_000); // 429 avec Retry-After 120 s
  assert.equal(await p.earliestStart('openai'), 83_000 + 120_000);
  await p.begin('openai', 203_000);
  await p.end('openai', 204_000, 10_000); // indication plus courte que le délai minimal : le minimal l'emporte
  assert.equal(await p.earliestStart('openai'), 204_000 + GAP);
});

test('Temporisation persistante : survit au redémarrage, à une erreur et à un arrêt brutal pendant une requête', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dunggle-pacing-'));
  try {
    const path = join(dir, 'provider-pacing.json');
    // Requête en erreur (429) via l'adaptateur temporisé : la fin et le Retry-After sont notés malgré l'erreur.
    let t = 10_000;
    const failing = new MockAdapter(() => Promise.reject(classifySdkError({ status: 429, message: INCIDENT_MSG })), MODELS[LUNA]);
    const p1 = new ProviderPacer(new FilePacingStore(path));
    await assert.rejects(p1.wrap({ real: true, model: failing.model, analyze: (r) => ((t += 800), failing.analyze(r)) }, 'openai', () => t, async (ms) => { t += ms; }).analyze({} as never), ProviderError);
    assert.equal((await stat(path)).mode & 0o777, 0o600, 'fichier local en 600');
    // Nouveau processus (redémarrage) : l'état est relu.
    const p2 = new ProviderPacer(new FilePacingStore(path));
    assert.equal(await p2.earliestStart('openai'), 10_800 + GAP, 'max(fin + 75 s, fin + 60 s indiqués)');
    // Arrêt brutal pendant une requête : début noté, fin jamais notée → délai SDK + 75 s.
    await p2.begin('openai', 200_000);
    const p3 = new ProviderPacer(new FilePacingStore(path));
    assert.equal(await p3.earliestStart('openai'), 200_000 + 60_000 + GAP);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ================================================================ 3. Registre reproduisant l'état réel
let ACT: RealCallActivation;
before(async () => {
  const dir = `${await mkdtemp(join(tmpdir(), 'dunggle-act-'))}/`;
  await createGrant({ phase: 'B2', models: MODELS2, maxEur: 0.13, confirm: confirmationPhrase('B2', 0.13) }, dir);
  ACT = await consumeGrant(dir, { phase: 'B2', models: MODELS2, maxEur: 0.13 });
});
const env = { ANTHROPIC_API_KEY: ['sk', 'ant', 'api03', 'TESTREPRISEB2xxxxxxxxxxxxxx'].join('-'), OPENAI_API_KEY: ['sk', 'proj', 'TESTREPRISEB2xxxxxxxxxxxxxxxx'].join('-') } as NodeJS.ProcessEnv;
const key = (m: string, pub: string) => `${m}|${pub}|${PROMPT_VERSION}`;

/** État réel au 2026-11-06 : B.1 (orion, ancien prompt) puis B.2 interrompu (5 analyses, 1 refus 429 Luna). */
async function realLedgerReplica(store = new MemoryBudgetStore()) {
  const g = new BudgetGuard(store);
  for (const m of MODELS2) {
    const r = await g.reserve({ modelKey: m, inputTokensEstimate: 7460, idempotencyKey: `${m}|${SMOKE_FIXTURE_ID}|1c46e6992832`, quota: { scope: 'trial', phase: 'B1', runId: `b1-${m}` } });
    await g.reconcile(r.id, { inputTokens: 1500, outputTokens: 450 });
  }
  const q = { scope: 'trial' as const, phase: 'B2' as const, runId: INCIDENT_RUN };
  for (const [m, pub] of [[HAIKU, 'gh-angular:435859328'], [LUNA, 'gh-angular:435859328'], [HAIKU, 'gh-angular:432042455'], [LUNA, 'gh-angular:432042455'], [HAIKU, INCIDENT_PUB]]) {
    const r = await g.reserve({ modelKey: m, inputTokensEstimate: 7800, idempotencyKey: key(m, pub), quota: q });
    await g.reconcile(r.id, { inputTokens: 2700, outputTokens: 170 });
  }
  const r = await g.reserve({ modelKey: LUNA, inputTokensEstimate: 7800, idempotencyKey: key(LUNA, INCIDENT_PUB), quota: q });
  await g.release(r.id, 'rate-limit : non facturée', { transmitted: true });
  const s = await g.snapshot();
  assert.deepEqual([s.quotas.phases.B2.total, s.quotas.phases.B2.perModel[HAIKU], s.quotas.phases.B2.perModel[LUNA]], [6, 3, 3]);
  assert.equal(s.quotas.exceptionsUsed?.[EXC.id], undefined, 'la tentative de l’incident est ordinaire (comme dans le registre réel)');
  return g;
}

function clockDeps(guard: BudgetGuard, opts: { pacer?: ProviderPacer; start?: number; stopWhen?: () => boolean; lunaLatency?: number; failLunaOn?: string } = {}) {
  let t = opts.start ?? ACT.validUntil - 89 * 60_000;
  const sent: { model: string; pub: string; start: number; end: number }[] = [];
  const deps: RunDeps & { sent: typeof sent; clock: () => number } = {
    guard, env, activation: ACT, pacer: opts.pacer, sent, clock: () => t,
    now: () => t,
    sleep: async (ms) => { t += ms; },
    shouldStop: opts.stopWhen,
    adapterFor: (k) => {
      const a = new MockAdapter(() => ({ rawText: mockOutput({ exclusionReason: 'none' }), usage: { inputTokens: 2700, outputTokens: 170 }, stopReason: 'end_turn' }), MODELS[k]);
      return {
        real: true, model: a.model,
        analyze: async (req) => {
          const start = t;
          t += k === LUNA ? (opts.lunaLatency ?? 6_300) : 1_400;
          const pub = (req as { publication?: { id: string } }).publication?.id ?? JSON.stringify(req).match(/"id":"([^"]+)"/)?.[1] ?? '?';
          sent.push({ model: k, pub, start, end: t });
          if (k === LUNA && opts.failLunaOn && sent.filter((x) => x.model === LUNA).length === 1) throw classifySdkError({ status: 429, message: INCIDENT_MSG });
          return a.analyze(req);
        },
      };
    },
  };
  return deps;
}

test('Décompte : 69 analyses restantes (Haiku 34, Luna 35), publication refusée replanifiée, aucune analyse réussie refacturée', async () => {
  const g = await realLedgerReplica();
  const s = await g.snapshot();
  const plan = planRun(parseArgs(['--mode=full']), evaluationSet.items, g, s);
  assert.equal(plan.calls.length, 69);
  assert.equal(plan.calls.filter((c) => c.modelKey === HAIKU).length, 34);
  assert.equal(plan.calls.filter((c) => c.modelKey === LUNA).length, 35);
  assert.ok(plan.calls.some((c) => c.modelKey === LUNA && c.publication.id === INCIDENT_PUB), 'Luna × publication refusée replanifiée');
  assert.ok(plan.calls.some((c) => c.modelKey === LUNA && c.publication.id === 'synthetic:minimal-announcement'), 'dernière publication Luna non écartée');
  assert.ok(!plan.calls.some((c) => c.modelKey === HAIKU && c.publication.id === INCIDENT_PUB), 'Haiku déjà analysée : non refacturée');
  assert.equal(new Set(plan.calls.map((c) => c.key)).size, 69, 'aucun doublon');
  assert.deepEqual(plan.skipped.map((x) => x.reason.split(' ')[0]), Array(5).fill('déjà'), 'seules les 5 analyses réussies sont écartées');
  assert.ok(plan.totalMaxEur <= 0.13);
  assert.ok(plan.totalMaxEur + s.trial.spentEur < DEFAULT_LIMITS.trialTotalCapEur);
  const typical = estimateRunDurationMs(plan, CALL_LATENCY_ASSUMPTIONS_MS.typical);
  assert.ok(typical * 1.25 <= ACTIVATION_TTL_MS_BY_PHASE.B2, `typique ${typical / 60_000} min`);
});

test('Reprise complète simulée : 69 appels, Luna toujours ≥ 75 s après la fin de la précédente, exception consommée une fois', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dunggle-resume429-'));
  try {
    const g = await realLedgerReplica(new FileBudgetStore(join(dir, 'ledger.json')) as unknown as MemoryBudgetStore);
    // L'état de temporisation de l'incident : dernière requête Luna terminée il y a 10 s.
    const pacer = new ProviderPacer(new FilePacingStore(join(dir, 'pacing.json')));
    const d = clockDeps(g, { pacer });
    const incidentEnd = d.clock() - 10_000;
    await pacer.end('openai', incidentEnd, 60_000);
    const args = parseArgs(['--mode=full', '--real', '--confirm-max-eur=0.13']);
    const r = await executeRun(args, planRun(args, evaluationSet.items, g, await g.snapshot()), d);
    assert.equal(r.executed, true, r.blockers.join(' | '));
    assert.equal(r.records.length, 69);
    assert.equal(r.stoppedReason, null);
    const luna = d.sent.filter((x) => x.model === LUNA);
    assert.ok(luna[0].start >= incidentEnd + GAP, 'première requête Luna ≥ 75 s après la fin de la précédente (état persistant)');
    assert.equal(r.records.find((x) => x.model === LUNA)!.publicationId, INCIDENT_PUB, 'la publication refusée passe en premier pour Luna');
    for (let i = 1; i < luna.length; i++) assert.ok(luna[i].start - luna[i - 1].end >= GAP, `écart ${luna[i].start - luna[i - 1].end} ms`);
    const s = await g.snapshot();
    assert.deepEqual([s.quotas.phases.B2.total, s.quotas.phases.B2.perModel[HAIKU], s.quotas.phases.B2.perModel[LUNA]], [75, 37, 38]);
    assert.equal(s.quotas.exceptionsUsed?.[EXC.id]?.idempotencyKey, key(LUNA, INCIDENT_PUB), 'exception imputée à la publication refusée');
    assert.equal(Object.keys(s.reservations).length, 0);
    assert.equal(Object.keys(s.uncertain).length, 0);
    // Plus rien à faire ; toute tentative supplémentaire est refusée.
    assert.equal(planRun(args, evaluationSet.items, g, s).calls.length, 0);
    for (const m of MODELS2) await assert.rejects(g.reserve({ modelKey: m, inputTokensEstimate: 100, idempotencyKey: key(m, 'autre'), quota: { scope: 'trial', phase: 'B2', runId: 'extra' } }), /Quota de la phase B2/);
    assert.equal(phaseModelMax('B2', LUNA), 38);
    assert.equal(phaseTotalMax('B2'), 75);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Première requête Luna de la reprise : attend la fin de l’incident + 75 s (état persistant relu)', async () => {
  const g = await realLedgerReplica();
  const pacer = new ProviderPacer(new MemoryPacingStore());
  const d = clockDeps(g, { pacer });
  const t0 = d.clock();
  await pacer.end('openai', t0 - 10_000, null);
  const args = parseArgs(['--mode=full', '--real', '--confirm-max-eur=0.13', '--max-calls=2']);
  await executeRun(args, planRun(args, evaluationSet.items, g, await g.snapshot()), d);
  const first = d.sent.find((x) => x.model === LUNA)!;
  assert.ok(first.start >= t0 - 10_000 + GAP, `départ ${first.start - t0} ms après le lancement`);
  assert.equal(d.sent[0].model, HAIKU, 'Haiku n’attend pas');
  assert.ok((await pacingOffsets(pacer, d.clock())).openai! > 0);
});

test('Exception liée : inutilisable pour une autre publication, une seule fois, restituée si la requête n’est pas transmise', async () => {
  const g = await realLedgerReplica();
  const q = { scope: 'trial' as const, phase: 'B2' as const, runId: 'exc-test' };
  // Requête non transmise (refus avant envoi) : l'exception redevient disponible.
  const r0 = await g.reserve({ modelKey: LUNA, inputTokensEstimate: 100, idempotencyKey: key(LUNA, INCIDENT_PUB), quota: q });
  assert.equal(r0.quota?.exceptionId, EXC.id);
  await g.release(r0.id, 'refus avant envoi', { transmitted: false });
  assert.equal((await g.snapshot()).quotas.exceptionsUsed?.[EXC.id], undefined, 'restituée');
  // Nouvel échec TRANSMIS sur la même publication : l'exception est consommée définitivement.
  const r1 = await g.reserve({ modelKey: LUNA, inputTokensEstimate: 100, idempotencyKey: key(LUNA, INCIDENT_PUB), quota: q });
  await g.release(r1.id, 'HTTP 429', { transmitted: true });
  assert.ok((await g.snapshot()).quotas.exceptionsUsed?.[EXC.id]);
  // Les 34 autres publications Luna consomment le plafond ordinaire (3 + 34 = 37).
  const others = evaluationSet.items.filter((p) => !['gh-angular:435859328', 'gh-angular:432042455', INCIDENT_PUB].includes(p.id) && !p.id.includes('blocked') && !/1144908/.test(p.id)).slice(0, 34);
  assert.equal(others.length, 34);
  for (const p of others) {
    const r = await g.reserve({ modelKey: LUNA, inputTokensEstimate: 100, idempotencyKey: key(LUNA, p.id), quota: q });
    await g.release(r.id, 'test', { transmitted: true });
  }
  const s = await g.snapshot();
  assert.equal(s.quotas.phases.B2.perModel[LUNA], 38);
  // Ni la publication de l'incident (exception déjà consommée), ni une autre ne peuvent obtenir une tentative de plus.
  await assert.rejects(g.reserve({ modelKey: LUNA, inputTokensEstimate: 100, idempotencyKey: key(LUNA, INCIDENT_PUB), quota: q }), /Quota de la phase B2/);
  await assert.rejects(g.reserve({ modelKey: LUNA, inputTokensEstimate: 100, idempotencyKey: key(LUNA, 'synthetic:autre'), quota: q }), /Quota de la phase B2/);
  // Haiku n'est pas concerné par l'exception.
  assert.equal(EXC.modelKey, LUNA);
  assert.equal(EXC.publicationId, INCIDENT_PUB);
  assert.equal(EXC.incident.httpStatus, 429);
  assert.ok(Object.isFrozen(EXC) && Object.isFrozen(EXC.incident));
});

test('Exception liée : absente si l’exécution de l’incident n’est pas dans le registre (aucun effet hors de cet incident)', async () => {
  const g = new BudgetGuard(new MemoryBudgetStore());
  const r = await g.reserve({ modelKey: LUNA, inputTokensEstimate: 100, idempotencyKey: key(LUNA, INCIDENT_PUB), quota: { scope: 'trial', phase: 'B2', runId: 'autre-run' } });
  assert.equal(r.quota?.exceptionId, undefined, 'tentative ordinaire');
});

test('Ctrl+C pendant l’attente OpenAI : arrêt avant la réservation, aucune réservation ouverte', async () => {
  const g = await realLedgerReplica();
  const pacer = new ProviderPacer(new MemoryPacingStore());
  let waited = 0;
  const d = clockDeps(g, { pacer, stopWhen: () => waited > 30_000 });
  const realSleep = d.sleep!;
  d.sleep = async (ms) => { waited += ms; await realSleep(ms); };
  await pacer.end('openai', d.clock(), null);
  const args = parseArgs(['--mode=full', '--real', '--confirm-max-eur=0.13']);
  const r = await executeRun(args, planRun(args, evaluationSet.items, g, await g.snapshot()), d);
  assert.match(r.stoppedReason ?? '', /interruption demandée/);
  assert.equal(r.records.filter((x) => x.model === LUNA).length, 0, 'aucune requête Luna envoyée');
  assert.equal(Object.keys((await g.snapshot()).reservations).length, 0);
});

test('429 pendant la reprise : arrêt, Retry-After noté, la reprise suivante attend', async () => {
  const g = await realLedgerReplica();
  const pacer = new ProviderPacer(new MemoryPacingStore());
  const d = clockDeps(g, { pacer, failLunaOn: 'first', lunaLatency: 800 });
  const args = parseArgs(['--mode=full', '--real', '--confirm-max-eur=0.13']);
  const r = await executeRun(args, planRun(args, evaluationSet.items, g, await g.snapshot()), d);
  assert.match(r.stoppedReason ?? '', /non transitoire/);
  const lunaEnd = d.sent.find((x) => x.model === LUNA)!.end;
  assert.equal(await pacer.earliestStart('openai'), lunaEnd + GAP, 'max(75 s, 60 s indiqués)');
});
