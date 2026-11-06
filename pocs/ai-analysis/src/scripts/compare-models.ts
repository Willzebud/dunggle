/**
 * Comparaison des modèles (B.2), HORS LIGNE : lit les résultats locaux `var/runs/*.json` (B.1 et B.2),
 * retient le dernier enregistrement par (modèle, publication), calcule les indicateurs et prépare la grille
 * de revue humaine à l'aveugle. Tout est écrit dans `var/` (ignoré par Git). Aucun appel réseau.
 *   npm run poc2:compare
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
const require_ = (p: string) => readFileSync(p, 'utf8');
import { VAR_DIR } from '../budget/factory.js';
import { blindReviewGrid, comparisonMarkdown, computeModelMetrics, latestRecords, type GroundTruthItem, type Timing } from '../evaluation/compare.js';
import type { AnalysisRecord, PublicationInput } from '../types.js';

const runsDir = `${VAR_DIR}runs/`;
const files = existsSync(runsDir) ? (await readdir(runsDir)).filter((f) => f.endsWith('.json')).sort() : [];
if (!files.length) {
  console.log('Aucun résultat local dans var/runs/ : rien à comparer.');
  process.exit(0);
}
const runs: { records: AnalysisRecord[]; timings: Timing[] }[] = [];
for (const f of files) {
  const r = JSON.parse(await readFile(`${runsDir}${f}`, 'utf8')) as { report: { records: AnalysisRecord[]; timings?: Timing[] } };
  runs.push({ records: r.report.records, timings: r.report.timings ?? [] });
}
const gt = (JSON.parse(await readFile(new URL('../../fixtures/ground-truth.json', import.meta.url), 'utf8')) as { items: GroundTruthItem[] }).items;
const pubs = (JSON.parse(await readFile(new URL('../../fixtures/evaluation-set.json', import.meta.url), 'utf8')) as { items: PublicationInput[] }).items;
const byModel = latestRecords(runs);
const timings = runs.flatMap((r) => r.timings);
const metrics = [...byModel.entries()].map(([m, recs]) => computeModelMetrics(m, recs, gt, pubs, timings));
const md = `# Comparaison des modèles — résultats locaux\n\n> Généré le ${new Date().toISOString()} à partir de ${files.length} exécution(s). Fichier local (var/), non versionné. Les contrôles de résumé sont indicatifs ; la revue humaine fait foi.\n\n${comparisonMarkdown(metrics)}`;
await mkdir(`${VAR_DIR}reports/`, { recursive: true });
await mkdir(`${VAR_DIR}review/`, { recursive: true });
await writeFile(`${VAR_DIR}reports/model-comparison.md`, md);
await writeFile(`${VAR_DIR}reports/model-comparison.json`, JSON.stringify(metrics, null, 2));
const { grid, key } = blindReviewGrid(byModel, gt, pubs);
const gridPath = `${VAR_DIR}review/summary-review.blind.json`;
// Une grille déjà commencée (relecteur ou note renseignés) n'est jamais écrasée ; une grille vierge est régénérée.
const started = existsSync(gridPath) && (() => {
  const g = JSON.parse(require_(gridPath)) as { reviewer: unknown; items: { candidates: { scores: Record<string, unknown> }[] }[] };
  return g.reviewer !== null || g.items.some((i) => i.candidates.some((c) => Object.values(c.scores).some((v) => v !== null)));
})();
if (!started) {
  await writeFile(gridPath, JSON.stringify(grid, null, 2));
  await writeFile(`${VAR_DIR}review/summary-review.key.json`, JSON.stringify(key, null, 2));
} else console.log(`Grille déjà commencée, conservée telle quelle : ${gridPath}`);
console.log(md);
console.log(`\nÉcrit : ${VAR_DIR}reports/model-comparison.md, ${gridPath}`);
