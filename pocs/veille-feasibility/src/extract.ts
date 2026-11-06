import { Readability, isProbablyReaderable } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { checkRobots, httpGet, toIsoDate } from './http.js';
import type { HttpTrace } from './types.js';

/**
 * Extraction générique du contenu principal d'une page d'article.
 * - Aucune règle spécifique à un site : Readability (algorithme du mode lecture de Firefox).
 * - robots.txt vérifié AVANT la requête ; si interdit, la page n'est pas demandée.
 * - Aucun contournement : une page protégée (403, challenge anti-bot) est simplement signalée.
 */
export interface PageExtraction {
  url: string;
  robots: { checked: boolean; allowed: boolean | null; note: string };
  fetched: boolean;
  trace: HttpTrace | null;
  /** Signaux d'usage exprimés par la page (en-tête X-Robots-Tag, meta robots, réservation TDM) */
  usageSignals: string[];
  readerable: boolean | null;
  title: string | null;
  siteName: string | null;
  publishedAt: string | null;
  dateSource: string | null;
  text: string;
  error: string | null;
}

export async function extractPage(url: string): Promise<PageExtraction> {
  const out: PageExtraction = {
    url,
    robots: { checked: false, allowed: null, note: '' },
    fetched: false,
    trace: null,
    usageSignals: [],
    readerable: null,
    title: null,
    siteName: null,
    publishedAt: null,
    dateSource: null,
    text: '',
    error: null,
  };

  const robots = await checkRobots(url);
  out.robots = { checked: robots.checked, allowed: robots.allowed, note: robots.note };
  if (robots.allowed === false) {
    out.error = 'Page non demandée : interdite par robots.txt';
    return out;
  }

  const res = await httpGet(url, { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' });
  out.trace = res.trace;
  out.fetched = true;
  if (res.trace.error) {
    out.error = `Erreur réseau : ${res.trace.error}`;
    return out;
  }
  const xRobots = res.headers?.get('x-robots-tag');
  if (xRobots) out.usageSignals.push(`X-Robots-Tag: ${xRobots}`);
  const tdmHeader = res.headers?.get('tdm-reservation');
  if (tdmHeader) out.usageSignals.push(`tdm-reservation (en-tête): ${tdmHeader}`);

  if (!res.trace.status || res.trace.status >= 400) {
    const challenge =
      res.headers?.get('cf-mitigated') === 'challenge' ||
      (res.body && /cf-chl|captcha|just a moment|attention required/i.test(res.body));
    out.error = `HTTP ${res.trace.status}${challenge ? ' : page de protection anti-bot (non contournée)' : ''}`;
    return out;
  }
  if (!/html/i.test(res.trace.contentType ?? '')) {
    out.error = `Content-Type inattendu : ${res.trace.contentType}`;
    return out;
  }

  let document: Document;
  try {
    ({ document } = parseHTML(res.body ?? '') as unknown as { document: Document });
  } catch (e) {
    out.error = `HTML non analysable : ${(e as Error).message}`;
    return out;
  }

  const metaRobots = document.querySelector('meta[name="robots" i]')?.getAttribute('content');
  if (metaRobots) out.usageSignals.push(`meta robots: ${metaRobots}`);
  const tdmMeta = document.querySelector('meta[name="tdm-reservation" i]')?.getAttribute('content');
  if (tdmMeta) out.usageSignals.push(`tdm-reservation (meta): ${tdmMeta}`);

  // Métadonnées lues AVANT Readability (qui modifie le DOM)
  const { date, source } = findPublishedDate(document);
  out.publishedAt = date;
  out.dateSource = source;
  const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? null;

  try {
    out.readerable = isProbablyReaderable(document);
    const article = new Readability(document, { charThreshold: 300 }).parse();
    if (!article) {
      out.error = 'Readability n’a identifié aucun contenu principal';
    } else {
      out.text = (article.textContent ?? '').replace(/\s+/g, ' ').trim();
      out.title = article.title?.trim() || ogTitle;
      out.siteName = article.siteName ?? null;
      if (!out.publishedAt && article.publishedTime) {
        out.publishedAt = toIsoDate(article.publishedTime);
        out.dateSource = out.publishedAt ? 'Readability publishedTime' : null;
      }
    }
  } catch (e) {
    out.error = `Échec de l’extraction : ${(e as Error).message}`;
  }
  return out;
}

/** Date de publication à partir des métadonnées standard (Open Graph, schema.org, <time>). */
function findPublishedDate(doc: Document): { date: string | null; source: string | null } {
  const metas: [string, string][] = [
    ['meta[property="article:published_time"]', 'meta article:published_time'],
    ['meta[name="article:published_time"]', 'meta article:published_time'],
    ['meta[itemprop="datePublished"]', 'meta itemprop=datePublished'],
    ['meta[name="date"]', 'meta name=date'],
    ['meta[name="publish-date"]', 'meta name=publish-date'],
  ];
  for (const [sel, label] of metas) {
    const v = toIsoDate(doc.querySelector(sel)?.getAttribute('content'));
    if (v) return { date: v, source: label };
  }
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const found = findKey(JSON.parse(s.textContent ?? ''), 'datePublished');
      const v = toIsoDate(typeof found === 'string' ? found : null);
      if (v) return { date: v, source: 'JSON-LD datePublished' };
    } catch {
      /* JSON-LD invalide : ignoré */
    }
  }
  const t = toIsoDate(doc.querySelector('time[datetime]')?.getAttribute('datetime'));
  if (t) return { date: t, source: '<time datetime> (premier de la page)' };
  return { date: null, source: null };
}

function findKey(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  if (Array.isArray(obj)) {
    for (const o of obj) {
      const r = findKey(o, key);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  const rec = obj as Record<string, unknown>;
  if (key in rec) return rec[key];
  for (const v of Object.values(rec)) {
    const r = findKey(v, key);
    if (r !== undefined) return r;
  }
  return undefined;
}

/** Similarité de Jaccard sur des 5-grammes de mots (détection de texte générique commun à plusieurs pages). */
export function shingleSimilarity(a: string, b: string): number {
  const sh = (s: string) => {
    const w = s.toLowerCase().split(/\s+/).filter(Boolean);
    const set = new Set<string>();
    for (let i = 0; i + 5 <= w.length; i++) set.add(w.slice(i, i + 5).join(' '));
    return set;
  };
  const A = sh(a);
  const B = sh(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
