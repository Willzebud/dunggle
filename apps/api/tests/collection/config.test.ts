/** Configuration des sources : collecte, droits et couverture cohérents (une entrée de droits par source). */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { forbidNetwork } from '../helpers.js';
import { COLLECTION_SETTINGS, SOURCES } from '../../src/config/sources.js';
import { CONTENT_POLICIES, validatePolicies } from '../../src/config/content-policies.js';
import { MANDATORY_COVERAGE_SOURCES } from '../../src/config/coverage.js';

before(forbidNetwork);

test('sources : 17 sources (12 du POC 1 puis 5 du POC 1.2), identifiants uniques, URL https valides', () => {
  assert.deepEqual(SOURCES.map((s) => s.id), [
    'angular-blog', 'gh-angular', 'gh-angular-components', 'openai-news', 'deepmind-blog', 'huggingface-blog', 'google-research',
    'simon-willison', 'gh-openai-agents', 'gh-langgraph', 'gh-mcp-ts-sdk', 'gh-claude-code',
    'typescript-blog', 'project-zero', 'one-useful-thing', 'mit-tech-review', 'ieee-robotics',
  ]);
  for (const s of SOURCES) assert.equal(new URL(s.url).protocol, 'https:', s.id);
  assert.equal(SOURCES.find((s) => s.id === 'project-zero')?.idStrategy, 'normalized-url');
  assert.ok(SOURCES.filter((s) => s.id !== 'project-zero').every((s) => s.idStrategy === undefined));
  assert.ok(SOURCES.filter((s) => s.type === 'github-releases').every((s) => s.url.startsWith('https://api.github.com/repos/')));
});

test('droits : exactement une politique par source collectée, et aucune politique orpheline', () => {
  assert.deepEqual(validatePolicies(), []);
  assert.deepEqual(CONTENT_POLICIES.map((p) => p.sourceId).sort(), SOURCES.map((s) => s.id).sort());
});

test('couverture obligatoire : uniquement des sources collectées', () => {
  const ids = new Set(SOURCES.map((s) => s.id));
  for (const id of Object.keys(MANDATORY_COVERAGE_SOURCES)) assert.ok(ids.has(id), id);
});

test('réglages : collecte polie et bornée, User-Agent Dunggle identifiable, réglages figés', () => {
  assert.equal(COLLECTION_SETTINGS.maxArticlesPerSource, 10);
  assert.ok(COLLECTION_SETTINGS.delayBetweenRequestsMs >= 750);
  assert.ok(COLLECTION_SETTINGS.timeoutMs <= 15_000);
  if (!process.env.DUNGGLE_USER_AGENT) assert.match(COLLECTION_SETTINGS.userAgent, /Dunggle/);
  assert.ok(Object.isFrozen(COLLECTION_SETTINGS));
});
