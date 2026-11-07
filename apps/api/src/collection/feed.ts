import Parser from 'rss-parser';
import { COLLECTION_SETTINGS as SETTINGS } from '../config/sources.js';
import { httpGet, stripHtml, toIsoDate, truncate } from './http.js';
import { classifyContent } from './content-level.js';
import { dedupKey, isValidHttpUrl } from './url.js';
import { retainText } from './rights.js';
import type { CollectResult, FeedFormat, HttpTrace, NormalizedArticle, SourceConfig } from './types.js';

type FeedItem = Parser.Item & {
  id?: string;
  author?: string;
  summary?: string;
  published?: string;
  updated?: string;
  'content:encoded'?: string;
  description?: string;
};

const parser: Parser<Record<string, unknown>, FeedItem> = new Parser({
  customFields: { item: ['published', 'updated', 'content:encoded', 'description'] },
});

export const ATOM_UPDATED_ONLY =
  'Atom : <published> absent, date <updated> utilisée (peut refléter une modification plutôt que la publication)';

export const DESCRIPTION_IS_CATEGORY =
  'Le champ <description> ne contient que le nom de la catégorie, pas de résumé ni de contenu';

/** Conventions courantes testées si la page HTML ne déclare aucun flux. */
const CONVENTIONAL_FEED_PATHS = ['/feed', '/rss.xml', '/feed.xml'];

function detectFormat(body: string): FeedFormat {
  const head = body.slice(0, 2000).replace(/^﻿/, '').trimStart();
  if (/<rss[\s>]/i.test(head)) return 'rss';
  if (/<feed[\s>]/i.test(head)) return 'atom';
  if (/<rdf:RDF[\s>]/i.test(head)) return 'rdf';
  if (/^<!doctype html|<html[\s>]/i.test(head)) return 'html';
  if (/^[\[{]/.test(head)) return 'json';
  return 'inconnu';
}

function isXmlContentType(ct: string | null): boolean {
  return !!ct && /(xml|rss|atom)/i.test(ct);
}

/** Collecte une source RSS/Atom (avec découverte éventuelle). */
export async function collectFeed(source: SourceConfig): Promise<CollectResult> {
  const result: CollectResult = {
    effectiveUrl: null,
    format: 'inconnu',
    requests: [],
    articles: [],
    itemsInFeed: 0,
    allDates: [],
    errors: [],
    warnings: [],
    authRequired: false,
  };

  let feedUrl = source.url;

  if (source.type === 'feed-discovery') {
    const discovered = await discoverFeed(source.url, result);
    if (!discovered) {
      result.errors.push('Aucun flux RSS/Atom découvert');
      return result;
    }
    feedUrl = discovered.url;
    if (discovered.body) {
      // Le flux a déjà été téléchargé pendant la découverte : pas de seconde requête
      return parseFeedBody(source, discovered.url, discovered.body, discovered.trace, result);
    }
  }

  const res = await httpGet(feedUrl);
  result.requests.push(res.trace);
  if (!checkHttp(res.trace, result)) return result;
  return parseFeedBody(source, feedUrl, res.body!, res.trace, result);
}

function checkHttp(trace: HttpTrace, result: CollectResult): boolean {
  if (trace.error) {
    result.errors.push(`Erreur réseau : ${trace.error}`);
    return false;
  }
  if (trace.status === 401 || trace.status === 403) {
    result.authRequired = trace.status === 401;
    result.errors.push(`HTTP ${trace.status} : accès refusé (protection anti-bot ou authentification)`);
    return false;
  }
  if (trace.status === 429) {
    result.errors.push('HTTP 429 : limite de requêtes atteinte');
    return false;
  }
  if (!trace.status || trace.status >= 400) {
    result.errors.push(`HTTP ${trace.status}`);
    return false;
  }
  if (trace.redirected) result.warnings.push(`Redirection : ${trace.requestedUrl} → ${trace.finalUrl}`);
  return true;
}

async function parseFeedBody(
  source: SourceConfig,
  feedUrl: string,
  body: string,
  trace: HttpTrace,
  result: CollectResult,
): Promise<CollectResult> {
  result.effectiveUrl = trace.finalUrl ?? feedUrl;
  result.format = detectFormat(body);

  if (result.format === 'html') {
    const challenge = /cloudflare|cf-chl|captcha|just a moment|attention required/i.test(body);
    result.errors.push(
      challenge
        ? 'HTML reçu au lieu d’un flux : page de protection anti-bot (non contournée)'
        : 'HTML reçu au lieu d’un flux RSS/Atom',
    );
    return result;
  }
  if (!['rss', 'atom', 'rdf'].includes(result.format)) {
    result.errors.push(`Format inattendu (${result.format}), Content-Type=${trace.contentType}`);
    return result;
  }
  if (!isXmlContentType(trace.contentType)) {
    result.warnings.push(`Content-Type non XML (${trace.contentType}) malgré un contenu ${result.format.toUpperCase()}`);
  }

  let feed: Parser.Output<FeedItem>;
  try {
    feed = await parser.parseString(body);
  } catch (err) {
    result.errors.push(`XML invalide : ${(err as Error).message}`);
    return result;
  }

  const items = feed.items ?? [];
  result.itemsInFeed = items.length;
  if (items.length === 0) {
    result.errors.push('Flux valide mais vide');
    return result;
  }

  const collectedAt = new Date().toISOString();
  const normalized = assignStableIds(source, items.map((it) => normalizeItem(source, it, collectedAt, result)), result.warnings);
  result.allDates = normalized.map((a) => a.publishedAt);

  // Tri par date décroissante (articles sans date à la fin), puis limitation
  normalized.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  result.articles = normalized.slice(0, SETTINGS.maxArticlesPerSource);
  return result;
}

function normalizeItem(source: SourceConfig, it: FeedItem, collectedAt: string, result: CollectResult): NormalizedArticle {
  const rawDate = it.pubDate ?? it.published ?? it.updated ?? null;
  const publishedAt = toIsoDate(it.isoDate) ?? toIsoDate(rawDate);
  if (result.format === 'atom' && !it.published && it.updated && !result.warnings.includes(ATOM_UPDATED_ONLY)) {
    result.warnings.push(ATOM_UPDATED_ONLY);
  }

  const candidates = [it['content:encoded'], it.content, it.summary, it.description].map((c) => stripHtml(c));
  const fullText = candidates.reduce((a, b) => (b.length > a.length ? b : a), '');
  const shortText = stripHtml(it.contentSnippet) || fullText;
  const cats = (it.categories ?? []).map((c) => stripHtml(typeof c === 'string' ? c : String((c as { _?: string })._ ?? '')));
  if (fullText && cats.includes(fullText) && !result.warnings.includes(DESCRIPTION_IS_CATEGORY)) {
    result.warnings.push(DESCRIPTION_IS_CATEGORY);
  }

  const nativeRaw = it.guid ?? it.id ?? null;
  const nativeId = nativeRaw ?? it.link ?? it.title ?? 'inconnu';
  const nativeIdOrigin: NormalizedArticle['nativeIdOrigin'] = nativeRaw ? 'source' : it.link ? 'fallback-url' : 'fallback-title';

  const title = stripHtml(it.title) || '';
  const level = classifyContent({ title, text: fullText, origin: 'feed', categories: cats });

  return {
    id: `${source.id}:${nativeId}`,
    nativeId,
    nativeIdOrigin,
    sourceId: source.id,
    sourceName: source.name,
    category: source.category,
    title,
    url: it.link ?? null,
    publishedAt,
    rawDate,
    // Droits : description et texte conservés seulement si la politique de la source l'autorise.
    ...retainText(source.id, shortText ? truncate(shortText) : null, fullText),
    contentLength: fullText.length,
    author: it.creator ?? it.author ?? null,
    categories: cats.filter(Boolean),
    collectedAt,
    dedupKey: isValidHttpUrl(it.link) ? dedupKey(it.link).key : null,
    contentLevel: level.level,
    contentLevelReasons: level.reasons,
  };
}

/**
 * Identifiants stables :
 * - idStrategy 'normalized-url' : `${sourceId}:${dedupKey}` pour toutes les publications ayant une URL valide ;
 * - sinon identifiant natif, et repli sur l'URL normalisée pour les seules publications dont l'identifiant natif
 *   est partagé par plusieurs publications du même flux (collision), avec un avertissement.
 * L'URL originale (`url`) et l'identifiant natif (`nativeId`) ne sont jamais modifiés.
 */
export function assignStableIds(source: SourceConfig, articles: NormalizedArticle[], warnings: string[] = []): NormalizedArticle[] {
  const byUrl = (a: NormalizedArticle): NormalizedArticle =>
    a.dedupKey ? { ...a, id: `${source.id}:${a.dedupKey}`, idBasis: 'normalized-url' } : { ...a, idBasis: 'native' };
  if (source.idStrategy === 'normalized-url') return articles.map(byUrl);
  const counts = new Map<string, number>();
  for (const a of articles) counts.set(a.id, (counts.get(a.id) ?? 0) + 1);
  const colliding = articles.filter((a) => (counts.get(a.id) ?? 0) > 1).length;
  if (colliding) warnings.push(`${colliding} publication(s) partagent un identifiant natif : identification par URL normalisée pour celles-ci`);
  return articles.map((a) => ((counts.get(a.id) ?? 0) > 1 ? byUrl(a) : { ...a, idBasis: 'native' }));
}

/** Découverte du flux : lien <link rel="alternate"> de la page HTML, puis conventions courantes. */
async function discoverFeed(
  pageUrl: string,
  result: CollectResult,
): Promise<{ url: string; body?: string; trace: HttpTrace } | null> {
  const page = await httpGet(pageUrl, { Accept: 'text/html,application/xhtml+xml' });
  result.requests.push(page.trace);

  const candidates: string[] = [];
  if (page.body && page.trace.status && page.trace.status < 400) {
    if (page.trace.redirected) result.warnings.push(`Redirection page d'accueil : ${page.trace.requestedUrl} → ${page.trace.finalUrl}`);
    const base = page.trace.finalUrl ?? pageUrl;
    for (const tag of page.body.match(/<link\b[^>]*>/gi) ?? []) {
      if (!/rel=["']?alternate/i.test(tag)) continue;
      if (!/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
      const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
      if (href) candidates.push(new URL(href, base).toString());
    }
    if (candidates.length) {
      result.warnings.push(`Flux découvert via <link rel="alternate"> : ${candidates[0]}`);
    } else {
      result.warnings.push('Aucun <link rel="alternate"> RSS/Atom dans la page HTML');
    }
  } else {
    result.warnings.push(
      `Page d'accueil inaccessible pour la découverte (${page.trace.status ?? page.trace.error})`,
    );
  }

  if (candidates.length === 0) {
    const origin = new URL(pageUrl).origin;
    candidates.push(...CONVENTIONAL_FEED_PATHS.map((p) => origin + p));
    result.warnings.push(`Test des chemins conventionnels : ${CONVENTIONAL_FEED_PATHS.join(', ')}`);
  }

  for (const url of [...new Set(candidates)]) {
    const r = await httpGet(url);
    result.requests.push(r.trace);
    if (r.body && r.trace.status === 200 && ['rss', 'atom', 'rdf'].includes(detectFormat(r.body))) {
      if (r.trace.redirected) result.warnings.push(`Redirection : ${r.trace.requestedUrl} → ${r.trace.finalUrl}`);
      return { url, body: r.body, trace: r.trace };
    }
    result.warnings.push(`Candidat rejeté ${url} : ${r.trace.status ?? r.trace.error}, format ${r.body ? detectFormat(r.body) : 'n/a'}`);
  }
  return null;
}
