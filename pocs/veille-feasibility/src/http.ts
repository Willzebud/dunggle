import { SETTINGS } from './sources.config.js';
import type { HttpTrace } from './types.js';

export interface FetchResult {
  trace: HttpTrace;
  body: string | null;
  headers: Headers | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequestAt = 0;

/** Requête HTTP GET avec timeout, User-Agent identifiable et trace complète. Ne lève jamais. */
export async function httpGet(url: string, extraHeaders: Record<string, string> = {}): Promise<FetchResult> {
  // Espacement minimal entre requêtes (exécution séquentielle)
  const wait = lastRequestAt + SETTINGS.delayBetweenRequestsMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  const started = Date.now();
  const trace: HttpTrace = {
    requestedUrl: url,
    finalUrl: null,
    status: null,
    redirected: false,
    contentType: null,
    bytes: 0,
    durationMs: 0,
    cacheHeaders: { etag: false, lastModified: false, cacheControl: null },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SETTINGS.timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': SETTINGS.userAgent,
        Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.5, */*;q=0.1',
        ...extraHeaders,
      },
    });
    trace.finalUrl = res.url;
    trace.status = res.status;
    trace.redirected = res.redirected;
    trace.contentType = res.headers.get('content-type');
    trace.cacheHeaders = {
      etag: res.headers.has('etag'),
      lastModified: res.headers.has('last-modified'),
      cacheControl: res.headers.get('cache-control'),
    };
    if (res.headers.has('x-ratelimit-limit')) {
      const reset = res.headers.get('x-ratelimit-reset');
      trace.rateLimit = {
        limit: numOrNull(res.headers.get('x-ratelimit-limit')),
        remaining: numOrNull(res.headers.get('x-ratelimit-remaining')),
        resetAt: reset ? new Date(Number(reset) * 1000).toISOString() : null,
      };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    trace.bytes = buf.length;
    if (buf.length > SETTINGS.maxBodyBytes) {
      trace.error = `Réponse trop volumineuse (${buf.length} octets)`;
      return { trace, body: null, headers: res.headers };
    }
    return { trace, body: buf.toString('utf8'), headers: res.headers };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } };
    trace.error =
      e.name === 'AbortError'
        ? `Timeout après ${SETTINGS.timeoutMs} ms`
        : `${e.message}${e.cause ? ` (${e.cause.code ?? e.cause.message})` : ''}`;
    return { trace, body: null, headers: null };
  } finally {
    clearTimeout(timer);
    trace.durationMs = Date.now() - started;
  }
}

function numOrNull(v: string | null): number | null {
  return v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v);
}

/** Supprime les balises HTML et normalise les espaces. */
export function stripHtml(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(text: string, max = 500): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Retourne une date ISO valide, ou null. */
export function toIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// --- robots.txt (vérification simple, groupe "User-agent: *") ---
const robotsCache = new Map<string, { traceOk: boolean; rules: { allow: boolean; path: string }[] | null; note: string; aiDisallowed: string[] }>();

export async function checkRobots(
  url: string,
): Promise<{ checked: boolean; allowed: boolean | null; note: string; aiCrawlersDisallowed: string[]; trace?: HttpTrace }> {
  const u = new URL(url);
  let entry = robotsCache.get(u.origin);
  let trace: HttpTrace | undefined;
  if (!entry) {
    const r = await httpGet(`${u.origin}/robots.txt`, { Accept: 'text/plain' });
    trace = r.trace;
    if (r.trace.status === 200 && r.body && !/^\s*</.test(r.body)) {
      entry = { traceOk: true, rules: parseRobots(r.body), note: 'robots.txt lu', aiDisallowed: aiCrawlersDisallowed(r.body) };
    } else if (r.trace.status === 404) {
      entry = { traceOk: true, rules: [], note: 'pas de robots.txt (404) : aucune restriction déclarée', aiDisallowed: [] };
    } else {
      entry = { traceOk: false, rules: null, note: `robots.txt non vérifiable (${r.trace.status ?? r.trace.error})`, aiDisallowed: [] };
    }
    robotsCache.set(u.origin, entry);
  }
  if (!entry.rules) return { checked: false, allowed: null, note: entry.note, aiCrawlersDisallowed: entry.aiDisallowed, trace };
  const path = u.pathname + u.search;
  let best: { allow: boolean; path: string } | null = null;
  for (const rule of entry.rules) {
    if (robotsPatternMatches(rule.path, path) && (!best || rule.path.length > best.path.length)) best = rule;
  }
  const allowed = best ? best.allow : true;
  return {
    checked: true,
    allowed,
    aiCrawlersDisallowed: entry.aiDisallowed,
    note: best ? `${entry.note} ; règle « ${best.allow ? 'Allow' : 'Disallow'}: ${best.path} »` : `${entry.note} ; aucune règle ne bloque ce chemin`,
    trace,
  };
}

function parseRobots(txt: string): { allow: boolean; path: string }[] {
  const rules: { allow: boolean; path: string }[] = [];
  let inStar = false;
  let lastWasUA = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const [k, ...rest] = line.split(':');
    const key = k.trim().toLowerCase();
    const val = rest.join(':').trim();
    if (key === 'user-agent') {
      if (!lastWasUA) inStar = false;
      if (val === '*') inStar = true;
      lastWasUA = true;
      continue;
    }
    lastWasUA = false;
    if (!inStar) continue;
    if (key === 'disallow' && val) rules.push({ allow: false, path: val });
    if (key === 'allow' && val) rules.push({ allow: true, path: val });
  }
  return rules;
}

/** Correspondance RFC 9309 : `*` = toute séquence, `$` final = fin du chemin. */
function robotsPatternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = body.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${re}${anchored ? '$' : ''}`).test(path);
}

/**
 * Robots d'IA connus (collecte pour entraînement ou réponses d'assistants). S'ils sont exclus de tout le site,
 * c'est un SIGNAL d'opposition de l'éditeur à la réutilisation de ses contenus par des IA. Il ne vise pas
 * notre User-Agent, mais il est pertinent avant d'envoyer du texte intégral à un LLM (POC 2).
 */
export const AI_CRAWLERS = [
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-Web', 'anthropic-ai', 'Claude-SearchBot', 'Claude-User',
  'CCBot', 'Google-Extended', 'Applebot-Extended', 'Bytespider', 'PerplexityBot', 'meta-externalagent', 'Amazonbot', 'cohere-ai',
];

/** Robots d'IA connus pour lesquels le robots.txt contient « Disallow: / » (site entier). */
export function aiCrawlersDisallowed(txt: string): string[] {
  const groups: { agents: string[]; disallowAll: boolean }[] = [];
  let current: { agents: string[]; disallowAll: boolean } | null = null;
  let lastWasUA = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!lastWasUA || !current) {
        current = { agents: [], disallowAll: false };
        groups.push(current);
      }
      current.agents.push(val.toLowerCase());
      lastWasUA = true;
      continue;
    }
    lastWasUA = false;
    if (current && key === 'disallow' && val === '/') current.disallowAll = true;
  }
  return AI_CRAWLERS.filter((bot) => groups.some((g) => g.disallowAll && g.agents.includes(bot.toLowerCase())));
}
