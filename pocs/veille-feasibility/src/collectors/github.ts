import { SETTINGS } from '../sources.config.js';
import { httpGet, stripHtml, toIsoDate, truncate } from '../http.js';
import { classifyContent } from '../content-level.js';
import { dedupKey, isValidHttpUrl } from '../url-utils.js';
import type { CollectResult, NormalizedArticle, SourceConfig } from '../types.js';

interface GitHubRelease {
  id: number;
  name: string | null;
  tag_name: string;
  html_url: string;
  published_at: string | null;
  created_at: string;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  author?: { login: string } | null;
}

/** Collecte les releases d'un dépôt via l'API REST GitHub officielle. */
export async function collectGitHubReleases(source: SourceConfig): Promise<CollectResult> {
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

  const url = `${source.url}?per_page=${SETTINGS.maxArticlesPerSource}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (SETTINGS.githubToken) headers.Authorization = `Bearer ${SETTINGS.githubToken}`;

  const res = await httpGet(url, headers);
  result.requests.push(res.trace);
  result.effectiveUrl = res.trace.finalUrl ?? url;

  if (res.trace.error) {
    result.errors.push(`Erreur réseau : ${res.trace.error}`);
    return result;
  }
  if (res.trace.redirected) result.warnings.push(`Redirection : ${url} → ${res.trace.finalUrl} (dépôt renommé/déplacé ?)`);
  if (res.trace.status === 403 || res.trace.status === 429) {
    const rl = res.trace.rateLimit;
    result.errors.push(
      `HTTP ${res.trace.status} : ${rl?.remaining === 0 ? `quota API épuisé (reset ${rl.resetAt})` : 'accès refusé'}`,
    );
    return result;
  }
  if (res.trace.status === 401) {
    result.authRequired = true;
    result.errors.push('HTTP 401 : token GitHub invalide');
    return result;
  }
  if (!res.trace.status || res.trace.status >= 400) {
    result.errors.push(`HTTP ${res.trace.status}`);
    return result;
  }

  let data: unknown;
  try {
    data = JSON.parse(res.body ?? '');
  } catch {
    result.format = 'inconnu';
    result.errors.push(`JSON invalide (Content-Type=${res.trace.contentType})`);
    return result;
  }
  result.format = 'json';
  if (!Array.isArray(data)) {
    result.errors.push('Réponse JSON inattendue (tableau attendu)');
    return result;
  }

  const releases = (data as GitHubRelease[]).filter((r) => !r.draft);
  result.itemsInFeed = releases.length;
  if (releases.length === 0) {
    result.errors.push('Aucune release publiée (le projet utilise peut-être uniquement des tags)');
    return result;
  }

  const collectedAt = new Date().toISOString();
  const articles: NormalizedArticle[] = releases.map((r) => {
    const body = stripHtml(r.body ?? '');
    const title = r.name?.trim() || r.tag_name;
    const level = classifyContent({ title, text: body, origin: 'feed' });
    return {
      id: `${source.id}:${r.id}`,
      nativeId: String(r.id),
      nativeIdOrigin: 'source',
      sourceId: source.id,
      sourceName: source.name,
      category: source.category,
      title,
      url: r.html_url,
      publishedAt: toIsoDate(r.published_at) ?? toIsoDate(r.created_at),
      rawDate: r.published_at ?? r.created_at,
      description: body ? truncate(body) : null,
      contentLength: body.length,
      author: r.author?.login ?? null,
      prerelease: r.prerelease,
      collectedAt,
      dedupKey: isValidHttpUrl(r.html_url) ? dedupKey(r.html_url).key : null,
      contentLevel: level.level,
      contentLevelReasons: level.reasons,
      idBasis: 'native',
    };
  });

  const pre = articles.filter((a) => a.prerelease).length;
  if (pre > 0) result.warnings.push(`${pre}/${articles.length} releases sont des pré-versions (next/rc/beta)`);

  result.allDates = articles.map((a) => a.publishedAt);
  articles.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  result.articles = articles.slice(0, SETTINGS.maxArticlesPerSource);
  return result;
}
