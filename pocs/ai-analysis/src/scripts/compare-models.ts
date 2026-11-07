/**
 * Comparaison des modèles, HORS LIGNE : lit les résultats locaux `var/runs/*.json`, ne retient QUE les exécutions
 * de la phase demandée produites avec la version de prompt de cette phase, puis le dernier enregistrement par
 * (modèle, publication), calcule les indicateurs et prépare la grille de revue humaine à l'aveugle.
 * Tout est écrit dans `var/` (ignoré par Git). Aucun appel réseau.
 *   npm run compare                 → B.2 (prompt B.2 historique, fixtures/evaluation-set.json)
 *   npm run compare -- --phase=B3   → test final (prompt courant figé, fixtures/b3/) + règle de décision figée
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
const require_ = (p: string) => readFileSync(p, 'utf8');
import { VAR_DIR } from '../budget/factory.js';
import { blindReviewGrid, comparisonMarkdown, computeModelMetrics, latestRecords, type GroundTruthItem, type Timing } from '../evaluation/compare.js';
import type { AnalysisRecord, PublicationInput } from '../types.js';
import { PROMPT_VERSION } from '../prompt.js';
import { selectComparableRuns, type RunFile } from '../evaluation/compare.js';
import { B2_PROMPT_VERSION } from '../config/quotas.js';
import { decide, humanScoresFromGrid, validateReviewGrid, type DecisionRule, type ReviewGrid } from '../evaluation/decision.js';
import { verifyB3Freeze } from '../evaluation/b3-freeze.js';

const phaseArg = process.argv.slice(2).find((a) => a.startsWith('--phase='))?.split('=')[1] ?? 'B2';
if (phaseArg !== 'B2' && phaseArg !== 'B3') {
  console.error('--phase doit valoir B2 ou B3');
  process.exit(2);
}
const B3 = phaseArg === 'B3';
const promptVersion = B3 ? PROMPT_VERSION : B2_PROMPT_VERSION;
const fixtures = B3 ? { gt: '../../fixtures/b3/ground-truth.json', pubs: '../../fixtures/b3/publications.json' } : { gt: '../../fixtures/ground-truth.json', pubs: '../../fixtures/evaluation-set.json' };
const out = B3 ? { md: 'b3-comparison.md', json: 'b3-comparison.json', grid: 'b3-summary-review.blind.json', key: 'b3-summary-review.key.json' } : { md: 'model-comparison.md', json: 'model-comparison.json', grid: 'summary-review.blind.json', key: 'summary-review.key.json' };
if (B3) {
  const f = await verifyB3Freeze();
  if (!f.ok) {
    console.error(`Jeu B3 non conforme au gel : ${f.problem}`);
    process.exit(3);
  }
}

const runsDir = `${VAR_DIR}runs/`;
const files = existsSync(runsDir) ? (await readdir(runsDir)).filter((f) => f.endsWith('.json')).sort() : [];
if (!files.length) {
  console.log('Aucun résultat local dans var/runs/ : rien à comparer.');
  process.exit(0);
}
const all: RunFile[] = [];
for (const f of files) all.push({ file: f, ...(JSON.parse(await readFile(`${runsDir}${f}`, 'utf8')) as Omit<RunFile, 'file'>) });
const { kept, ignored } = selectComparableRuns(all, promptVersion, B3 ? 'final' : 'full');
for (const i of ignored) console.log(`Ignoré : ${i.file} (${i.reason})`);
if (!kept.length) {
  console.log(`Aucune exécution ${phaseArg} avec le prompt ${promptVersion} : rien à comparer.`);
  process.exit(0);
}
const runs: { records: AnalysisRecord[]; timings: Timing[] }[] = kept.map((r) => ({ records: r.report.records, timings: r.report.timings ?? [] }));
const gt = (JSON.parse(await readFile(new URL(fixtures.gt, import.meta.url), 'utf8')) as { items: GroundTruthItem[] }).items;
const pubs = (JSON.parse(await readFile(new URL(fixtures.pubs, import.meta.url), 'utf8')) as { items: PublicationInput[] }).items;
const byModel = latestRecords(runs);
const timings = runs.flatMap((r) => r.timings);
const metrics = [...byModel.entries()].map(([m, recs]) => computeModelMetrics(m, recs, gt, pubs, timings));
const md = `# Comparaison des modèles — résultats locaux\n\n> Généré le ${new Date().toISOString()} à partir de ${kept.length} exécution(s) ${phaseArg} (prompt ${promptVersion}). Fichier local (var/), non versionné. Les contrôles de résumé sont indicatifs ; la revue humaine fait foi.\n\n${comparisonMarkdown(metrics)}`;
await mkdir(`${VAR_DIR}reports/`, { recursive: true });
await mkdir(`${VAR_DIR}review/`, { recursive: true });
const { grid, key } = blindReviewGrid(byModel, gt, pubs, Math.random, phaseArg);
const gridPath = `${VAR_DIR}review/${out.grid}`;
const keyPath = `${VAR_DIR}review/${out.key}`;
// Une grille déjà commencée (relecteur ou note renseignés) n'est jamais écrasée ; une grille vierge est régénérée.
const started = existsSync(gridPath) && (() => {
  const g = JSON.parse(require_(gridPath)) as { reviewer: unknown; items: { candidates: { scores: Record<string, unknown> }[] }[] };
  return g.reviewer !== null || g.items.some((i) => i.candidates.some((c) => Object.values(c.scores).some((v) => v !== null)));
})();
if (!started) {
  await writeFile(gridPath, JSON.stringify(grid, null, 2));
  await writeFile(keyPath, JSON.stringify(key, null, 2));
} else console.log(`Grille déjà commencée, conservée telle quelle : ${gridPath}`);

if (!B3) {
  await writeFile(`${VAR_DIR}reports/${out.md}`, md);
  await writeFile(`${VAR_DIR}reports/${out.json}`, JSON.stringify(metrics, null, 2));
  console.log(md);
  console.log(`\nÉcrit : ${VAR_DIR}reports/${out.md}, ${gridPath}`);
} else {
  // B3 : REVUE HUMAINE À L'AVEUGLE OBLIGATOIRE. Tant que la grille n'est pas complète et valide, les indicateurs par
  // modèle (statuts, exclusions, résumés produits…) permettraient de deviner la correspondance A/B : ils restent
  // SCELLÉS (fichier local non affiché) ; la correspondance n'est jamais lue ; aucune décision n'est rendue.
  const g = JSON.parse(require_(gridPath)) as ReviewGrid;
  const problems = validateReviewGrid(g);
  if (problems.length) {
    await writeFile(`${VAR_DIR}reports/b3-comparison.SEALED.json`, JSON.stringify({ warning: 'SCELLÉ : ne pas ouvrir avant la fin de la revue humaine à l’aveugle (indices sur la correspondance A/B).', metrics }, null, 2));
    const all = [...byModel.values()].flat();
    const statuses: Record<string, number> = {};
    for (const r of all) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    const total = Math.round(all.reduce((sum, r) => sum + (r.costEur ?? 0), 0) * 1e6) / 1e6;
    console.log(`B3 : ${all.length} enregistrements (statuts, tous modèles confondus : ${Object.entries(statuses).map(([k, v]) => `${k} ${v}`).join(', ')}), coût total ${total} €.`);
    console.log(`Grille de revue à l’aveugle : ${gridPath} (${g.items.length} publications, ${g.items.reduce((n, i) => n + i.candidates.length, 0)} résumés).`);
    console.log(`Indicateurs par modèle SCELLÉS et décision NON RENDUE : revue humaine obligatoire. Points restant à compléter (${problems.length}) :`);
    for (const p of problems.slice(0, 15)) console.log(`  · ${p}`);
    if (problems.length > 15) console.log(`  · … ${problems.length - 15} autre(s)`);
  } else {
    const human = humanScoresFromGrid(g, JSON.parse(require_(keyPath)));
    await writeFile(`${VAR_DIR}reports/${out.md}`, md);
    await writeFile(`${VAR_DIR}reports/${out.json}`, JSON.stringify(metrics, null, 2));
    console.log(md);
    const rule = JSON.parse(await readFile(new URL('../../fixtures/b3/decision-rule.json', import.meta.url), 'utf8')) as DecisionRule;
    const evidence = [...byModel.entries()].map(([model, records]) => ({ model, records, metrics: metrics.find((m) => m.model === model)! }));
    const decision = decide(evidence, gt, pubs, rule, human);
    await writeFile(`${VAR_DIR}reports/b3-decision.json`, JSON.stringify(decision, null, 2));
    console.log(`\nDÉCISION ${decision.provisional ? 'PROVISOIRE' : 'DÉFINITIVE'} : ${decision.chosen ?? 'aucune'} — ${decision.basis}`);
    for (const r of decision.provisionalReasons) console.log(`  · ${r}`);
    for (const sc of decision.scores) console.log(`  ${sc.model} : ${sc.total}/100 ${JSON.stringify(sc.criteria)}${sc.eliminations.length ? ` ÉLIMINÉ : ${sc.eliminations.join(' ; ')}` : ''}`);
  }
}
