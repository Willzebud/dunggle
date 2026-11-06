import { SOURCES, SETTINGS } from './sources.config.js';
import { checkRobots } from './http.js';
import { collectFeed } from './collectors/feed.js';
import { collectGitHubReleases } from './collectors/github.js';
import { analyze } from './analysis.js';
import { writeResults } from './report.js';
import { applyEditorialRules } from './editorial-rules.js';
import type { CollectResult, NormalizedArticle, SourceConfig, SourceReport } from './types.js';

/** Passage unique et séquentiel sur toutes les sources (pas de boucle de collecte). */
async function testSource(source: SourceConfig): Promise<{ report: SourceReport; articles: NormalizedArticle[]; excluded: NormalizedArticle[] }> {
  let c: CollectResult;
  try {
    c = source.type === 'github-releases' ? await collectGitHubReleases(source) : await collectFeed(source);
  } catch (err) {
    // Erreur inattendue d'un collecteur : on la consigne, on ne la masque pas
    c = { effectiveUrl: null, format: 'inconnu', requests: [], articles: [], itemsInFeed: 0, allDates: [], errors: [`Exception : ${(err as Error).stack ?? err}`], warnings: [], authRequired: false };
  }

  let robots: SourceReport['robots'];
  if (source.type !== 'github-releases' && c.effectiveUrl) {
    const r = await checkRobots(c.effectiveUrl);
    robots = { checked: r.checked, allowed: r.allowed, note: r.note, aiCrawlersDisallowed: r.aiCrawlersDisallowed };
    if (r.trace) c.requests.push({ ...r.trace });
  }
  // Règles éditoriales ciblées (POC 1.2) : exclusions tracées, compilations marquées
  const { kept, excluded } = applyEditorialRules(c.articles);
  c.articles = kept;

  // L'analyse se base sur la requête de collecte, pas sur robots.txt
  const collectRequests = c.requests.filter((t) => !t.requestedUrl.endsWith('/robots.txt'));
  const analysis = analyze(source, { ...c, requests: collectRequests }, robots);

  const dates = c.articles.map((a) => a.publishedAt).filter((d): d is string => !!d).sort();
  const report: SourceReport = {
    source,
    effectiveUrl: c.effectiveUrl,
    format: c.format,
    requests: c.requests,
    robots,
    itemsInFeed: c.itemsInFeed,
    itemsCollected: c.articles.length,
    latestPublication: dates.at(-1) ?? null,
    oldestCollected: dates[0] ?? null,
    errors: c.errors,
    warnings: c.warnings,
    analysis,
    editorialExcluded: excluded.map((a) => ({ ruleId: a.editorial!.ruleId, title: a.title, url: a.url, publishedAt: a.publishedAt })),
    editorialFlagged: kept.filter((a) => a.editorial?.action === 'flagged').length,
  };
  return { report, articles: c.articles, excluded };
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`POC 1 — test de ${SOURCES.length} sources (User-Agent: ${SETTINGS.userAgent})`);
  console.log(`Token GitHub : ${SETTINGS.githubToken ? 'oui' : 'non (quota anonyme 60 req/h)'}\n`);

  const reports: SourceReport[] = [];
  const articles: NormalizedArticle[] = [];
  const excludedAll: NormalizedArticle[] = [];
  for (const source of SOURCES) {
    process.stdout.write(`→ ${source.name.padEnd(30)} `);
    const { report, articles: a, excluded } = await testSource(source);
    reports.push(report);
    articles.push(...a);
    excludedAll.push(...excluded);
    const an = report.analysis;
    console.log(
      `${an.status.padEnd(8)} ${String(report.itemsCollected).padStart(2)} pub. | dernière ${report.latestPublication?.slice(0, 10) ?? '—'} | ${
        report.errors.length ? `ERREUR: ${report.errors.join(' ; ')}` : `contenu ${an.content}, dates ${an.datesReliable ? 'fiables' : 'NON fiables'}`
      }${excluded.length ? ` | ${excluded.length} exclue(s) par règle` : ''}${report.editorialFlagged ? ` | ${report.editorialFlagged} compilation(s) marquée(s)` : ''}`,
    );
  }

  const totalRequests = reports.reduce((s, r) => s + r.requests.length, 0);
  await writeResults(reports, articles, excludedAll, { startedAt, finishedAt: new Date().toISOString(), nodeVersion: process.version, totalRequests });

  const ok = reports.filter((r) => r.analysis.status === 'OK').length;
  console.log(`\n${ok}/${reports.length} sources OK — ${articles.length} publications normalisées (+${excludedAll.length} exclues par règle éditoriale, conservées dans articles.json > excluded), ${totalRequests} requêtes HTTP.`);
  console.log('Résultats : results/articles.json, results/sources-report.json, results/feasibility-report.md');
}

main().catch((err) => {
  console.error('Échec inattendu du POC :', err);
  process.exitCode = 1;
});
