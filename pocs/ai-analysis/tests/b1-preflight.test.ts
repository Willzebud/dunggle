/**
 * Vérifications finales avant B.1 (hors ligne, aucun réseau) : chargement du .env, plan smoke,
 * espacement des requêtes OpenAI (1 requête/minute), absence de relance facturable, politique de contenu.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forbidNetwork, evaluationSet, testGuard, testCreateGrant } from './helpers.js';
import { loadLocalEnv, parseEnvFile, defaultGitIgnored, EnvFileError } from '../src/security/env-file.js';
import { MockAdapter, mockOutput } from '../src/adapters/mock.js';
import { classifySdkError, SDK_OPTIONS, apiKeyFormatProblem, AnthropicAdapter, OpenAIAdapter } from '../src/adapters/real.js';
import { BudgetGuard } from '../src/budget/guard.js';
import { MemoryBudgetStore } from '../src/budget/store.js';
import { DEFAULT_LIMITS } from '../src/config/budget.js';
import { MODELS } from '../src/config/models.js';
import { PROVIDER_MIN_GAP_AFTER_END_MS } from '../src/config/quotas.js';
import { resolveInput } from '../src/content-policy.js';
import { buildPrompt } from '../src/prompt.js';
import { parseArgs } from '../src/runner/args.js';
import { planRun, SMOKE_FIXTURE_ID } from '../src/runner/plan.js';
import { executeRun, type RunDeps } from '../src/runner/run.js';
import { createGrant, consumeGrant, confirmationPhrase, type RealCallActivation } from '../src/security/activation.js';

before(forbidNetwork);

const V_ANT = ['sk', 'ant', 'api03', 'VALEURDETESTENVFILE0123456789'].join('-');
const V_OAI = ['sk', 'proj', 'VALEURDETESTENVFILE0123456789abcd'].join('-');
const notIgnoredByGit = () => false;
const ignoredByGit = () => true;

async function envFile(content: string, mode = 0o600) {
  const dir = await mkdtemp(join(tmpdir(), 'dunggle-env-'));
  const path = join(dir, '.env');
  await writeFile(path, content);
  await chmod(path, mode);
  return { dir, path };
}

// ================================================================ Chargement du .env
test('.env : charge uniquement les deux clés de la liste blanche, sans écraser le shell', async () => {
  const { dir, path } = await envFile(`# commentaire\nANTHROPIC_API_KEY=${V_ANT}\nexport OPENAI_API_KEY="${V_OAI}"\nNODE_OPTIONS=--inspect\nligne invalide\n`);
  try {
    const env: NodeJS.ProcessEnv = {};
    const r = loadLocalEnv(path, { env, gitIgnored: ignoredByGit });
    assert.deepEqual(r.loaded.sort(), ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);
    assert.equal(env.ANTHROPIC_API_KEY, V_ANT);
    assert.equal(env.OPENAI_API_KEY, V_OAI, 'guillemets retirés');
    assert.equal(env.NODE_OPTIONS, undefined, 'variable hors liste blanche ignorée');
    assert.ok(r.ignored.some((i) => i.startsWith('NODE_OPTIONS')));
    const shell: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'valeur-du-shell' };
    const r2 = loadLocalEnv(path, { env: shell, gitIgnored: ignoredByGit });
    assert.equal(shell.OPENAI_API_KEY, 'valeur-du-shell', 'le shell reste prioritaire');
    assert.deepEqual(r2.keptFromShell, ['OPENAI_API_KEY']);
    // Le résultat ne contient aucune valeur.
    assert.ok(!JSON.stringify([r, r2]).includes(V_ANT) && !JSON.stringify([r, r2]).includes(V_OAI));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('.env : refusé s’il est lisible par d’autres ou non ignoré par Git ; erreurs sans valeur', async () => {
  const a = await envFile(`ANTHROPIC_API_KEY=${V_ANT}\n`, 0o644);
  const b = await envFile(`ANTHROPIC_API_KEY=${V_ANT}\n`);
  try {
    if (process.platform !== 'win32') assert.throws(() => loadLocalEnv(a.path, { env: {}, gitIgnored: ignoredByGit }), /chmod 600/);
    const env: NodeJS.ProcessEnv = {};
    assert.throws(() => loadLocalEnv(b.path, { env, gitIgnored: notIgnoredByGit }), /pas ignoré par Git/);
    assert.equal(env.ANTHROPIC_API_KEY, undefined, 'rien chargé');
    try {
      parseEnvFile(`OPENAI_API_KEY=${V_OAI} suite\n`);
      assert.fail('valeur avec espace acceptée');
    } catch (e) {
      assert.ok(e instanceof EnvFileError);
      assert.ok(!(e as Error).message.includes(V_OAI), 'le message d’erreur ne contient pas la valeur');
    }
    assert.deepEqual(loadLocalEnv(join(a.dir, 'absent'), { env: {} }), { found: false, loaded: [], keptFromShell: [], ignored: [] });
  } finally {
    await rm(a.dir, { recursive: true, force: true });
    await rm(b.dir, { recursive: true, force: true });
  }
});

test('.env réel du POC : ignoré par Git (vérifié sans lire le fichier)', () => {
  const path = new URL('../.env', import.meta.url).pathname;
  assert.equal(defaultGitIgnored(path), true);
});

// ================================================================ Plan B.1
test('B.1 : exactement une requête par fournisseur, sur la fixture synthétique, coût maximal ≤ 0,004 € (montant confirmé de B.1)', () => {
  const plan = planRun(parseArgs(['--mode=smoke']), evaluationSet.items, testGuard(new MemoryBudgetStore()), null);
  assert.equal(plan.phase, 'B1');
  assert.equal(plan.calls.length, 2);
  assert.deepEqual(plan.calls.map((c) => MODELS[c.modelKey].provider).sort(), ['anthropic', 'openai']);
  assert.ok(plan.calls.every((c) => c.publication.id === SMOKE_FIXTURE_ID));
  assert.ok(plan.totalMaxEur > 0 && plan.totalMaxEur <= 0.004, String(plan.totalMaxEur));
  assert.ok(plan.totalMaxEur <= DEFAULT_LIMITS.trialTotalCapEur);
});

test('B.1 : la fixture envoyée respecte sa politique de contenu (synthétique, full-allowed, aucune URL ou donnée tierce)', () => {
  const p = evaluationSet.items.find((i) => i.id === SMOKE_FIXTURE_ID)!;
  assert.equal(p.synthetic, true);
  assert.equal(p.sourceId, 'synthetic-fixtures');
  assert.match(p.url, /^https:\/\/example\.invalid\//);
  const r = resolveInput(p);
  assert.equal(r.policy, 'full-allowed');
  const prompt = buildPrompt(p, r);
  // Le message utilisateur ne contient que cette publication.
  const others = evaluationSet.items.filter((i) => i.id !== p.id);
  assert.ok(others.every((o) => !prompt.user.includes(o.url)));
});

// ================================================================ Débit, relances
let ACT_B2: RealCallActivation;
let ACT_B1: RealCallActivation;
before(async () => {
  const models = ['anthropic-haiku-5-5', 'openai-gpt-6-luna'];
  for (const phase of ['B1', 'B2'] as const) {
    const dir = `${await mkdtemp(join(tmpdir(), 'dunggle-act-'))}/`;
    await testCreateGrant({ phase, models, maxEur: 0.5, confirm: confirmationPhrase(phase, 0.5) }, dir);
    const a = await consumeGrant(dir, { phase, models, maxEur: 0.5 });
    if (phase === 'B1') ACT_B1 = a;
    else ACT_B2 = a;
  }
});
const fakeEnv = { ANTHROPIC_API_KEY: V_ANT, OPENAI_API_KEY: V_OAI } as NodeJS.ProcessEnv;
const ok = (k: string) => new MockAdapter(() => ({ rawText: mockOutput({}), usage: { inputTokens: 900, outputTokens: 120 }, stopReason: 'end_turn' }), MODELS[k]);

function clockDeps(guard: BudgetGuard, activation: RealCallActivation, adapterFor: RunDeps['adapterFor']) {
  let t = 0;
  const sleeps: number[] = [];
  const sent: { provider: string; at: number }[] = [];
  const deps: RunDeps = {
    guard, activation, env: fakeEnv,
    now: () => t,
    sleep: async (ms) => { sleeps.push(ms); t += ms; },
    adapterFor: (k) => {
      const a = adapterFor(k);
      return { ...a, real: a.real, model: a.model, analyze: (req) => { sent.push({ provider: MODELS[k].provider, at: t }); t += 2_000; return a.analyze(req); } };
    },
  };
  return { deps, sleeps, sent };
}

test('OpenAI 1 requête/minute : B.1 n’attend pas (une requête par fournisseur)', async () => {
  const guard = testGuard(new MemoryBudgetStore());
  const args = parseArgs(['--mode=smoke', '--real', '--confirm-max-eur=0.004']);
  const { deps, sleeps, sent } = clockDeps(guard, ACT_B1, ok);
  const r = await executeRun(args, planRun(args, evaluationSet.items, guard, null), deps);
  assert.equal(r.records.length, 2);
  assert.equal(sleeps.length, 0);
  assert.equal(sent.filter((s) => s.provider === 'openai').length, 1);
});

test('OpenAI 1 requête/minute : en B.2, chaque requête OpenAI part au moins 75 s après la FIN de la précédente', async () => {
  const guard = testGuard(new MemoryBudgetStore());
  const args = parseArgs(['--mode=full', '--real', '--confirm-max-eur=0.5', '--max-calls=3']);
  const { deps, sent } = clockDeps(guard, ACT_B2, ok);
  const r = await executeRun(args, planRun(args, evaluationSet.items, guard, null), deps);
  assert.equal(r.records.length, 6);
  const oai = sent.filter((s) => s.provider === 'openai').map((s) => s.at);
  assert.equal(oai.length, 3);
  // Chaque requête simulée dure 2 s : fin = début + 2 000 ms.
  for (let i = 1; i < oai.length; i++) assert.ok(oai[i] - (oai[i - 1] + 2_000) >= PROVIDER_MIN_GAP_AFTER_END_MS.openai, `écart après la fin ${oai[i] - oai[i - 1] - 2_000} ms`);
});

test('Aucune relance automatique : SDK sans retry, 429 compté et exécution arrêtée après une seule tentative', async () => {
  assert.equal(SDK_OPTIONS.maxRetries, 0);
  const e = classifySdkError({ status: 429, message: 'Rate limit reached' });
  assert.equal(e.kind, 'rate-limit');
  assert.equal(e.transmitted, true);
  const guard = testGuard(new MemoryBudgetStore());
  const args = parseArgs(['--mode=smoke', '--real', '--confirm-max-eur=0.004']);
  let attempts = 0;
  const failing = (k: string) => new MockAdapter(() => { attempts++; return Promise.reject(classifySdkError({ status: 429, message: 'limit' })); }, MODELS[k]);
  const { deps } = clockDeps(guard, ACT_B1, failing);
  const r = await executeRun(args, planRun(args, evaluationSet.items, guard, null), deps);
  assert.equal(attempts, 1, 'une seule tentative, aucune relance');
  assert.match(r.stoppedReason ?? '', /non transitoire/);
  const s = await guard.snapshot();
  assert.equal(s.quotas?.phases?.B1?.total, 1, 'tentative transmise comptée dans le quota de phase');
});

test('Clés inversées : exécution refusée avant toute réservation, et aucun adaptateur n’envoie la clé d’un autre fournisseur', async () => {
  const swapped = { ANTHROPIC_API_KEY: V_OAI, OPENAI_API_KEY: V_ANT } as NodeJS.ProcessEnv;
  assert.match(apiKeyFormatProblem('anthropic', swapped)!, /format OpenAI/);
  assert.match(apiKeyFormatProblem('openai', swapped)!, /format Anthropic/);
  assert.equal(apiKeyFormatProblem('anthropic', fakeEnv), null);
  assert.equal(apiKeyFormatProblem('openai', fakeEnv), null);
  assert.ok(![apiKeyFormatProblem('anthropic', swapped), apiKeyFormatProblem('openai', swapped)].join().includes('VALEURDETEST'), 'aucune valeur dans le message');
  const guard = testGuard(new MemoryBudgetStore());
  const args = parseArgs(['--mode=smoke', '--real', '--confirm-max-eur=0.004']);
  const { deps } = clockDeps(guard, ACT_B1, ok);
  const r = await executeRun(args, planRun(args, evaluationSet.items, guard, null), { ...deps, env: swapped });
  assert.equal(r.executed, false);
  assert.equal(r.blockers.filter((b) => /variables inversées/.test(b)).length, 2);
  assert.equal(Object.keys((await guard.snapshot()).analyses).length, 0);
  let created = false;
  const factory = async () => ((created = true), { messages: { create: async () => ({}) }, responses: { create: async () => ({}) } }) as never;
  await assert.rejects(new AnthropicAdapter(MODELS['anthropic-haiku-5-5'], factory, ACT_B1, swapped).analyze({ system: 's', user: 'u', schema: {}, maxOutputTokens: 800 }), /variables inversées/);
  await assert.rejects(new OpenAIAdapter(MODELS['openai-gpt-6-luna'], factory, ACT_B1, swapped).analyze({ system: 's', user: 'u', schema: {}, maxOutputTokens: 800 }), /variables inversées/);
  assert.equal(created, false, 'aucun client SDK créé');
});
