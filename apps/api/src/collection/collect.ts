/**
 * Collecte d'un cycle : un passage SÉQUENTIEL sur les sources configurées, sans boucle ni relance.
 * - robots.txt est vérifié AVANT la collecte d'un flux : une interdiction explicite pour notre User-Agent saute la
 *   source (consignée) ; un robots.txt non vérifiable est signalé sans bloquer (comportement du POC 1).
 * - Une source en erreur est consignée et n'interrompt jamais le cycle.
 * - Les règles éditoriales ciblées s'appliquent ensuite : les exclusions restent tracées et récupérables.
 * Aucun stockage ici (voir L5) et aucun appel IA.
 */
import { SOURCES } from '../config/sources.js';
import { applyEditorialRules } from './editorial-rules.js';
import { collectFeed } from './feed.js';
import { collectGitHubReleases } from './github.js';
import { checkRobots } from './http.js';
import type { CollectResult, NormalizedArticle, SourceConfig } from './types.js';

export interface SourceRun {
  sourceId: string;
  effectiveUrl: string | null;
  itemsInFeed: number;
  collected: number;
  editorialExcluded: number;
  requests: number;
  robots: { checked: boolean; allowed: boolean | null; note: string } | null;
  skipped: boolean;
  errors: string[];
  warnings: string[];
}

export interface CollectionRun {
  startedAt: string;
  finishedAt: string;
  /** Publications retenues (y compris les compilations marquées). */
  articles: NormalizedArticle[];
  /** Publications exclues par une règle éditoriale (trace conservée, récupérables). */
  excluded: NormalizedArticle[];
  sources: SourceRun[];
}

export interface Collectors {
  feed(source: SourceConfig): Promise<CollectResult>;
  github(source: SourceConfig): Promise<CollectResult>;
  robots(url: string): ReturnType<typeof checkRobots>;
}

const DEFAULT_COLLECTORS: Collectors = { feed: collectFeed, github: collectGitHubReleases, robots: checkRobots };

export async function collectAll(sources: readonly SourceConfig[] = SOURCES, collectors: Collectors = DEFAULT_COLLECTORS, now: () => Date = () => new Date()): Promise<CollectionRun> {
  const startedAt = now().toISOString();
  const articles: NormalizedArticle[] = [];
  const excluded: NormalizedArticle[] = [];
  const runs: SourceRun[] = [];
  for (const source of sources) {
    const run: SourceRun = { sourceId: source.id, effectiveUrl: null, itemsInFeed: 0, collected: 0, editorialExcluded: 0, requests: 0, robots: null, skipped: false, errors: [], warnings: [] };
    try {
      if (source.type !== 'github-releases') {
        const r = await collectors.robots(source.url);
        run.robots = { checked: r.checked, allowed: r.allowed, note: r.note };
        if (r.trace) run.requests++;
        if (r.allowed === false) {
          run.skipped = true;
          run.errors.push(`robots.txt interdit ce chemin : source non collectée (${r.note})`);
          runs.push(run);
          continue;
        }
        if (!r.checked) run.warnings.push(`robots.txt non vérifié : ${r.note}`);
      }
      const c = source.type === 'github-releases' ? await collectors.github(source) : await collectors.feed(source);
      const { kept, excluded: ex } = applyEditorialRules(c.articles);
      articles.push(...kept);
      excluded.push(...ex);
      Object.assign(run, { effectiveUrl: c.effectiveUrl, itemsInFeed: c.itemsInFeed, collected: kept.length, editorialExcluded: ex.length });
      run.requests += c.requests.length;
      run.errors.push(...c.errors);
      run.warnings.push(...c.warnings);
    } catch (err) {
      // Erreur inattendue d'un collecteur : consignée, jamais masquée, sans interrompre les autres sources.
      run.errors.push(`Exception : ${(err as Error).message}`);
    }
    runs.push(run);
  }
  return { startedAt, finishedAt: now().toISOString(), articles, excluded, sources: runs };
}
