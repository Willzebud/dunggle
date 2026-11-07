/** Tests hors ligne repris du POC 1 (identifiants, déduplication, règles éditoriales, niveaux, robots.txt). */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { forbidNetwork } from '../helpers.js';
import { assignStableIds } from '../../src/collection/feed.js';
import { applyEditorialRules } from '../../src/collection/editorial-rules.js';
import { dedupKey, isValidHttpUrl, looksLikeHomepage, sameResource } from '../../src/collection/url.js';
import { classifyContent } from '../../src/collection/content-level.js';
import { aiCrawlersDisallowed } from '../../src/collection/http.js';
import type { NormalizedArticle, SourceConfig } from '../../src/collection/types.js';

before(forbidNetwork);

function article(over: Partial<NormalizedArticle>): NormalizedArticle {
  const url = over.url ?? 'https://example.org/post';
  return {
    id: 'src:x', nativeId: 'x', nativeIdOrigin: 'source', sourceId: 'src', sourceName: 'Source', category: 'ia',
    title: 'Titre', url, publishedAt: '2026-11-01T00:00:00.000Z', rawDate: null, description: null, text: null, contentLength: 0,
    author: null, collectedAt: '2026-11-06T00:00:00.000Z', dedupKey: url ? dedupKey(url).key : null, contentLevel: 'MINIMAL', contentLevelReasons: [], ...over,
  };
}

test('identifiants : Project Zero (normalized-url) → id fondé sur l’URL normalisée, URL originale intacte', () => {
  const pz: SourceConfig = { id: 'project-zero', name: 'PZ', category: 'innovation', type: 'feed', url: 'https://projectzero.google/feed.xml', idStrategy: 'normalized-url' };
  const sameId = 'https://projectzero.google/2026/02/windows-administrator-protection';
  const a = article({ sourceId: 'project-zero', id: `project-zero:${sameId}`, nativeId: sameId, url: 'https://projectzero.google/2026/02/getprocesshandlefromhwnd.html?utm_source=rss' });
  const b = article({ sourceId: 'project-zero', id: `project-zero:${sameId}`, nativeId: sameId, url: 'https://projectzero.google/2026/02/windows-administrator-protection.html' });
  const out = assignStableIds(pz, [a, b]);
  assert.equal(new Set(out.map((x) => x.id)).size, 2);
  assert.equal(out[0].id, 'project-zero:projectzero.google/2026/02/getprocesshandlefromhwnd.html');
  assert.equal(out[0].url, 'https://projectzero.google/2026/02/getprocesshandlefromhwnd.html?utm_source=rss', 'URL originale préservée');
  assert.equal(out[0].nativeId, sameId, 'identifiant natif conservé pour traçabilité');
  assert.ok(out.every((x) => x.idBasis === 'normalized-url'));
});

test('identifiants : stratégie native → repli URL uniquement pour les collisions, avec avertissement', () => {
  const src: SourceConfig = { id: 'src', name: 'S', category: 'ia', type: 'feed', url: 'https://example.org/feed' };
  const warnings: string[] = [];
  const out = assignStableIds(src, [article({ id: 'src:dup', url: 'https://example.org/a' }), article({ id: 'src:dup', url: 'https://example.org/b' }), article({ id: 'src:unique', url: 'https://example.org/c' })], warnings);
  assert.deepEqual(out.map((x) => x.id), ['src:example.org/a', 'src:example.org/b', 'src:unique']);
  assert.deepEqual(out.map((x) => x.idBasis), ['normalized-url', 'normalized-url', 'native']);
  assert.equal(warnings.length, 1);
});

test('dédup : dedupKey retire le suivi (utm, clics, source=rss Medium, fragment, www, slash final) sans toucher à l’URL', () => {
  const url = 'https://blog.angular.dev/post-123?source=rss----447683c3d9a3---4';
  assert.equal(dedupKey(url).key, 'blog.angular.dev/post-123');
  assert.equal(url, 'https://blog.angular.dev/post-123?source=rss----447683c3d9a3---4');
  assert.equal(dedupKey('https://www.Example.org/a/?utm_source=x&b=2&a=1&fbclid=z#top').key, 'example.org/a?a=1&b=2');
  assert.ok(sameResource('http://example.org/a/', 'https://www.example.org/a?utm_medium=rss'));
  assert.ok(!sameResource('https://example.org/a', 'https://example.org/b'));
  assert.ok(isValidHttpUrl('https://example.org') && !isValidHttpUrl('ftp://example.org') && !isValidHttpUrl(null));
  assert.ok(looksLikeHomepage('https://example.org/') && looksLikeHomepage('https://example.org/blog/', ['https://example.org/blog']));
});

test('règles éditoriales : « The Download » (MIT TR) exclu avec trace, non supprimé', () => {
  const dl = article({ sourceId: 'mit-tech-review', id: 'mit:1', title: 'The Download: blended meat, restored sight, and the agentic web' });
  const normal = article({ sourceId: 'mit-tech-review', id: 'mit:2', title: 'How “reverse game theory” could keep AI agents in check' });
  const { kept, excluded } = applyEditorialRules([dl, normal]);
  assert.deepEqual(kept.map((x) => x.id), ['mit:2']);
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].editorial?.ruleId, 'mit-tr-the-download');
  assert.equal(excluded[0].editorial?.action, 'excluded');
  assert.equal(excluded[0].url, dl.url, 'publication exclue conservée intégralement');
});

test('règles éditoriales : « Video Friday » (IEEE Robotics) marqué mais conservé', () => {
  const vf = article({ sourceId: 'ieee-robotics', id: 'ieee:1', title: 'Video Friday: Spot Plays to Show Its Whole-Body Manipulation' });
  const art = article({ sourceId: 'ieee-robotics', id: 'ieee:2', title: 'Digit 5 May Be the First Humanoid Robot Worker That’s Truly Safe' });
  const { kept, excluded } = applyEditorialRules([vf, art]);
  assert.equal(excluded.length, 0);
  assert.equal(kept.length, 2);
  assert.equal(kept[0].editorial?.action, 'flagged');
  assert.equal(kept[1].editorial, undefined);
});

test('règles éditoriales : ciblées par source (pas de filtre général par mot-clé)', () => {
  const { kept, excluded } = applyEditorialRules([
    article({ sourceId: 'simon-willison', title: 'The Download: a title on another source' }),
    article({ sourceId: 'mit-tech-review', title: 'Video Friday at MIT' }),
    article({ sourceId: 'mit-tech-review', title: 'Why we stopped The Download: a retrospective' }),
  ]);
  assert.equal(excluded.length, 0);
  assert.ok(kept.every((x) => !x.editorial));
});

test('niveaux de contenu : FULL / PARTIAL / MINIMAL', () => {
  const long = 'Lorem ipsum dolor sit amet consectetur adipiscing elit. '.repeat(40);
  assert.equal(classifyContent({ title: 'Lorem ipsum dolor', text: long, origin: 'feed' }).level, 'FULL');
  assert.equal(classifyContent({ title: 'X', text: 'We release a new open model for fast speech recognition on device today.', origin: 'feed' }).level, 'PARTIAL');
  assert.equal(classifyContent({ title: 'Wearables', text: 'Health & Bioscience', origin: 'feed', categories: ['Health & Bioscience'] }).level, 'MINIMAL');
  assert.equal(classifyContent({ title: 'Phonon TTS benchmarks', text: long, origin: 'page', pageTitleMatch: 1 }).level, 'MINIMAL', 'texte sans rapport rejeté');
});

test('robots.txt : détection des robots d’IA exclus (cas Medium)', () => {
  const txt = 'User-Agent: *\nDisallow: /m/\n\nUser-Agent: Amazonbot\nUser-Agent: ClaudeBot\nUser-Agent: GPTBot\nDisallow: /\nAllow: /about\n';
  assert.deepEqual(aiCrawlersDisallowed(txt), ['GPTBot', 'ClaudeBot', 'Amazonbot']);
  assert.deepEqual(aiCrawlersDisallowed('User-agent: *\nDisallow: /private/\n'), []);
});
