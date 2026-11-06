import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forbidNetwork, evaluationSet, groundTruth, networkCalls } from './helpers.js';
import { THEMES, PUBLICATION_TYPES, EXCLUSION_REASONS } from '../src/taxonomy.js';
import { resolveInput } from '../src/content-policy.js';
import { PERMANENT_ACTIVATION, buildAnthropicParams, buildOpenAIParams, apiKeyConfigured } from '../src/adapters/real.js';
import { MODELS, CANDIDATE_MODEL_KEYS } from '../src/config/models.js';
import { ANALYSIS_JSON_SCHEMA } from '../src/schema.js';
import { prefilterHint, PREFILTER_ENABLED } from '../src/prefilter.js';

before(forbidNetwork);
const root = fileURLToPath(new URL('..', import.meta.url));

test('fixtures : ~30 publications, couverture des catégories et niveaux demandés', () => {
  const items = evaluationSet.items;
  assert.ok(items.length >= 30);
  for (const lvl of ['FULL', 'PARTIAL', 'MINIMAL']) assert.ok(items.some((p) => p.contentLevel === lvl), lvl);
  const gt = groundTruth.items;
  for (const t of THEMES) assert.ok(gt.some((g) => g.themes.includes(t)), t);
  for (const ty of ['release', 'feature', 'research', 'product', 'prospective_analysis']) assert.ok(gt.some((g) => g.types.includes(ty)), ty);
  assert.ok(gt.some((g) => g.acceptableExclusions.includes('promotional')));
  assert.ok(gt.filter((g) => g.hardToClassify).length >= 5);
  for (const d of ['must_keep', 'must_exclude', 'ambiguous']) assert.ok(gt.some((g) => g.editorialDecision === d), d);
});

test('fixtures réelles : métadonnées uniquement, aucun texte d’article tiers', () => {
  for (const p of evaluationSet.items.filter((x) => !x.synthetic)) {
    assert.equal(p.text, undefined, `${p.id} ne doit contenir aucun texte`);
    assert.ok(!('description' in p), `${p.id} : pas de description`);
    assert.ok(/^https:\/\//.test(p.url) && !p.url.includes('example.invalid'), `${p.id} : URL originale réelle`);
  }
});

test('fixtures synthétiques : clairement signalées, jamais présentées comme réelles', () => {
  for (const p of evaluationSet.items.filter((x) => x.synthetic)) {
    assert.ok(p.title.startsWith('[SYNTHÉTIQUE]'), p.id);
    assert.ok(p.url.startsWith('https://example.invalid/'), p.id);
    assert.ok(p.sourceId.startsWith('synthetic'), p.id);
    if (p.text) assert.match(p.text, /[Ff]ixture synthétique/, p.id);
  }
});

test('vérité terrain : alignée sur le jeu, valeurs conformes à la taxonomie, faits de référence présents dans le texte', () => {
  const ids = evaluationSet.items.map((p) => p.id);
  assert.deepEqual(groundTruth.items.map((g) => g.id), ids);
  for (const g of groundTruth.items) {
    for (const t of [...g.themes, ...g.acceptableExtraThemes]) assert.ok((THEMES as readonly string[]).includes(t), `${g.id} ${t}`);
    for (const ty of g.types) assert.ok((PUBLICATION_TYPES as readonly string[]).includes(ty), `${g.id} ${ty}`);
    for (const e of g.acceptableExclusions) assert.ok(e === null || (EXCLUSION_REASONS as readonly string[]).includes(e), `${g.id} ${e}`);
    assert.ok(g.novelty[0] >= 1 && g.novelty[1] <= 5 && g.novelty[0] <= g.novelty[1], g.id);
    const p = evaluationSet.items.find((x) => x.id === g.id)!;
    for (const fact of g.referenceFacts ?? []) assert.ok(p.text?.includes(fact), `${g.id} : fait « ${fact} » absent du texte`);
    for (const claim of g.forbiddenClaims ?? []) assert.ok(!p.text?.includes(claim) || claim.length < 4, `${g.id} : « ${claim} » ne doit pas figurer dans le texte`);
    // summaryAllowed = politique × niveau ; summaryExpected n'est jamais vrai sans autorisation ni pour une exclusion
    assert.equal(resolveInput(p).summaryAllowed, g.summaryAllowed, `${g.id} : summaryAllowed incohérent`);
    if (!g.summaryAllowed) assert.equal(g.summaryExpected, false, `${g.id} : résumé attendu sans autorisation`);
    if (g.editorialDecision === 'must_exclude') assert.equal(g.summaryExpected, false, `${g.id} : résumé attendu pour une exclusion`);
  }
});

test('préfiltre : mode observation, n’exclut rien (désactivé)', () => {
  assert.equal(PREFILTER_ENABLED, false);
  for (const p of evaluationSet.items) assert.equal(typeof prefilterHint(p).wouldSkip, 'boolean');
});

test('aucun appel réel : interrupteur figé, requêtes construites conformes aux formats vérifiés', () => {
  assert.equal(PERMANENT_ACTIVATION, false);
  const req = { system: 's', user: 'u', schema: ANALYSIS_JSON_SCHEMA, maxOutputTokens: 800 };
  const a = buildAnthropicParams(MODELS['anthropic-haiku-5-5'], req);
  assert.equal(a.model, 'claude-haiku-5-5');
  assert.equal(a.output_config.format.type, 'json_schema');
  assert.equal(a.max_tokens, 800);
  const o = buildOpenAIParams(MODELS['openai-gpt-6-luna'], req);
  assert.equal(o.model, 'gpt-6-luna');
  assert.equal(o.text.format.strict, true);
  assert.equal(o.max_output_tokens, 800);
  assert.equal(apiKeyConfigured('anthropic', {}), false);
  assert.equal(networkCalls.length, 0);
});

test('modèles candidats : tarifs et date de vérification renseignés', () => {
  for (const k of CANDIDATE_MODEL_KEYS) {
    const m = MODELS[k];
    assert.ok(m.pricing && m.pricing.length > 0, k);
    assert.equal(m.verifiedAt, '2026-11-06');
    assert.ok(m.sources.every((s) => s.startsWith('https://')));
  }
});

test('code source : aucun appel réseau ni SDK fournisseur dans le POC (phase A)', () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) files.push(p);
    }
  };
  walk(join(root, 'src'));
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!/\bfetch\s*\(/.test(src), `${f} : fetch interdit`);
    assert.ok(!/from ['"](@anthropic-ai\/sdk|openai|node:https?|undici|axios)/.test(src), `${f} : import statique d’un client réseau interdit`);
    // Les SDK officiels ne sont chargés (import dynamique) que dans src/adapters/real.ts, derrière les contrôles d'activation.
    if (/import\(['"](@anthropic-ai\/sdk|openai)['"]\)/.test(src)) assert.ok(f.endsWith(join('adapters', 'real.ts')), `${f} : SDK fournisseur hors de l’adaptateur`);
  }
});

test('sécurité des fichiers : aucune clé dans le POC, var/ ignoré par Git', () => {
  const gitignore = readFileSync(join(root, '..', '..', '.gitignore'), 'utf8');
  assert.match(gitignore, /pocs\/ai-analysis\/var\//);
  const all = ['fixtures/evaluation-set.json', 'fixtures/ground-truth.json', '.env.example'].map((f) => readFileSync(join(root, f), 'utf8')).join('\n');
  assert.ok(!/sk-(ant-)?[A-Za-z0-9_-]{16,}/.test(all));
  assert.match(readFileSync(join(root, '.env.example'), 'utf8'), /ANTHROPIC_API_KEY=\n/);
});
