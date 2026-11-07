/**
 * Collecte HORS LIGNE : `fetch` est remplacé par un faux serveur qui ne connaît que des réponses synthétiques ;
 * toute autre URL fait échouer le test. Vérifie la normalisation, les droits (aucun texte conservé en
 * metadata-only), robots.txt, la tolérance aux erreurs et les règles éditoriales.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFetch } from '../helpers.js';
import { GITHUB_RELEASES, LONG_TEXT, RSS_FEED } from './fixtures.js';
import { collectFeed } from '../../src/collection/feed.js';
import { collectGitHubReleases } from '../../src/collection/github.js';
import { collectAll } from '../../src/collection/collect.js';
import { clearRobotsCacheForTests, setRequestDelayForTests } from '../../src/collection/http.js';
import { retainText, textRetentionLimit } from '../../src/collection/rights.js';
import type { SourceConfig } from '../../src/collection/types.js';

const FEED: SourceConfig = { id: 'openai-news', name: 'Synthetic (politique metadata-only)', category: 'ia', type: 'feed', url: 'https://feed.example/rss.xml' };
const GH: SourceConfig = { id: 'gh-angular', name: 'Synthetic releases', category: 'angular', type: 'github-releases', url: 'https://api.github.com/repos/example/lib/releases' };
const ROBOTS_OK = { body: 'User-agent: *\nDisallow: /private/\n', contentType: 'text/plain' };

beforeEach(() => {
  setRequestDelayForTests(0);
  clearRobotsCacheForTests();
});

test('flux RSS : normalisation (id natif, URL originale intacte, dedupKey, date ISO, catégories, niveau FULL)', async () => {
  installFakeFetch({ 'https://feed.example/rss.xml': { body: RSS_FEED } });
  const r = await collectFeed(FEED);
  assert.deepEqual(r.errors, []);
  assert.equal(r.itemsInFeed, 2);
  const [a, b] = r.articles;
  assert.equal(a.id, 'openai-news:post-2');
  assert.equal(a.url, 'https://feed.example/posts/fictional-2?utm_source=rss&utm_medium=feed');
  assert.equal(a.dedupKey, 'feed.example/posts/fictional-2');
  assert.equal(a.publishedAt, '2026-11-04T09:00:00.000Z');
  assert.deepEqual(a.categories, ['Releases']);
  assert.equal(a.contentLevel, 'FULL');
  assert.ok(a.contentLength >= LONG_TEXT.trim().length);
  assert.equal(b.id, 'openai-news:post-1', 'tri par date décroissante');
});

test('droits (correction 1) : en metadata-only, ni texte ni description conservés ; seule la mesure technique reste', async () => {
  installFakeFetch({ 'https://feed.example/rss.xml': { body: RSS_FEED } });
  const r = await collectFeed(FEED);
  for (const a of r.articles) {
    assert.equal(a.text, null);
    assert.equal(a.description, null);
  }
  assert.ok(r.articles[0].contentLength > 0);
  assert.ok(!JSON.stringify(r.articles).includes('Synthetic release notes'), 'aucun fragment du texte dans la sortie');
});

test('droits : bornes de conservation par politique (full 6 000, extrait 400, metadata/blocked/inconnue 0)', () => {
  assert.equal(textRetentionLimit('x', 'full-allowed'), 6000);
  assert.equal(textRetentionLimit('x', 'excerpt-only'), 400);
  assert.equal(textRetentionLimit('x', 'metadata-only'), 0);
  assert.equal(textRetentionLimit('x', 'blocked'), 0);
  assert.equal(textRetentionLimit('source-inconnue'), 0);
  const big = 'y'.repeat(9000);
  assert.ok(retainText('x', 'd', big, 'full-allowed').text!.length <= 6000);
  const ex = retainText('x', 'z'.repeat(450), big, 'excerpt-only');
  assert.ok(ex.text!.length <= 400 && ex.description!.length <= 400);
  assert.deepEqual(retainText('x', 'd', big, 'metadata-only'), { description: null, text: null });
});

test('GitHub Releases : brouillons ignorés, prérelease signalée, titre de repli sur le tag, aucune note conservée (metadata-only)', async () => {
  const calls = installFakeFetch({ 'https://api.github.com/repos/example/lib/releases?per_page=10': { body: GITHUB_RELEASES, contentType: 'application/json' } });
  const r = await collectGitHubReleases(GH);
  assert.deepEqual(r.errors, []);
  assert.equal(r.itemsInFeed, 2);
  assert.deepEqual(r.articles.map((a) => [a.id, a.title, a.prerelease]), [['gh-angular:2002', 'v2.0.0', false], ['gh-angular:2001', 'v2.0.0-rc.1', true]]);
  assert.ok(r.articles.every((a) => a.text === null && a.description === null));
  assert.ok(r.warnings.some((w) => w.includes('pré-versions')));
  assert.equal(calls.length, 1);
});

test('collectAll : robots.txt vérifié avant le flux ; source interdite sautée ; erreur isolée ; GitHub sans robots.txt', async () => {
  const blocked: SourceConfig = { id: 'deepmind-blog', name: 'Interdite', category: 'ia', type: 'feed', url: 'https://blocked.example/feed.xml' };
  const broken: SourceConfig = { id: 'huggingface-blog', name: 'En panne', category: 'ia', type: 'feed', url: 'https://broken.example/feed.xml' };
  const calls = installFakeFetch({
    'https://feed.example/robots.txt': ROBOTS_OK,
    'https://feed.example/rss.xml': { body: RSS_FEED },
    'https://blocked.example/robots.txt': { body: 'User-agent: *\nDisallow: /\n', contentType: 'text/plain' },
    'https://broken.example/robots.txt': { status: 404, body: '' },
    'https://broken.example/feed.xml': { status: 500, body: 'erreur' },
    'https://api.github.com/repos/example/lib/releases?per_page=10': { body: GITHUB_RELEASES, contentType: 'application/json' },
  });
  const run = await collectAll([FEED, blocked, broken, GH]);
  assert.equal(run.articles.length, 4);
  const by = Object.fromEntries(run.sources.map((s) => [s.sourceId, s]));
  assert.equal(by['deepmind-blog'].skipped, true);
  assert.ok(by['deepmind-blog'].errors[0].includes('robots.txt interdit'));
  assert.ok(!calls.includes('https://blocked.example/feed.xml'), 'flux interdit jamais demandé');
  assert.deepEqual(by['huggingface-blog'].errors, ['HTTP 500']);
  assert.equal(by['gh-angular'].robots, null);
  assert.equal(by['openai-news'].collected, 2);
  assert.ok(!calls.some((u) => u.includes('api.github.com/robots.txt')));
});

test('collectAll : règles éditoriales appliquées (exclusion tracée, récupérable)', async () => {
  const mit: SourceConfig = { id: 'mit-tech-review', name: 'Synthetic MIT', category: 'prospective', type: 'feed', url: 'https://mit.example/feed' };
  const feed = RSS_FEED.replace('Fictional Library 2.0 released', 'The Download: synthetic digest');
  installFakeFetch({ 'https://mit.example/robots.txt': ROBOTS_OK, 'https://mit.example/feed': { body: feed } });
  const run = await collectAll([mit]);
  assert.equal(run.excluded.length, 1);
  assert.equal(run.excluded[0].editorial?.ruleId, 'mit-tr-the-download');
  assert.equal(run.sources[0].editorialExcluded, 1);
  assert.equal(run.articles.length, 1);
});

test('collectAll : une exception inattendue d’un collecteur est consignée sans interrompre les autres sources', async () => {
  const run = await collectAll([FEED, GH], {
    feed: async () => { throw new Error('panne simulée'); },
    github: async (s) => ({ effectiveUrl: s.url, format: 'json', requests: [], articles: [], itemsInFeed: 0, allDates: [], errors: [], warnings: [], authRequired: false }),
    robots: async () => ({ checked: true, allowed: true, note: 'ok', aiCrawlersDisallowed: [] }),
  });
  assert.deepEqual(run.sources[0].errors, ['Exception : panne simulée']);
  assert.deepEqual(run.sources[1].errors, []);
});

test('flux HTML (protection anti-bot) : erreur signalée, jamais contournée', async () => {
  installFakeFetch({ 'https://feed.example/rss.xml': { body: '<!doctype html><html><title>Just a moment...</title>cf-chl</html>', contentType: 'text/html' } });
  const r = await collectFeed(FEED);
  assert.equal(r.articles.length, 0);
  assert.ok(r.errors[0].includes('anti-bot'));
});
