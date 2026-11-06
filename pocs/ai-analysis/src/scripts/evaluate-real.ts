/**
 * Exécuteur de la phase B.
 *   npm run evaluate:real                                  → simulation (défaut) du smoke test des deux modèles
 *   npm run evaluate:real -- --mode=full --dry-run         → simulation de l'évaluation complète
 *   npm run evaluate:real -- --mode=smoke --real --confirm-max-eur=<€>     → appels réels : exige une autorisation
 *                                                            locale à usage unique (npm run poc2:authorize)
 * La simulation n'écrit RIEN dans le registre budgétaire ; elle affiche le plan, le coût maximal et les blocages.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { DEFAULT_LIMITS } from '../config/budget.js';
import { PHASE_QUOTA_EXCEPTIONS, phaseModelMax, phaseTotalMax } from '../config/quotas.js';
import { MODELS } from '../config/models.js';
import { BudgetGuard } from '../budget/guard.js';
import { MemoryBudgetStore, type LedgerState } from '../budget/store.js';
import { createPersistentGuard, VAR_DIR, verifyLedgerIntegrity } from '../budget/factory.js';
import { AnthropicAdapter, OpenAIAdapter } from '../adapters/real.js';
import { consumeGrant, grantMismatch, peekGrant, type RealCallActivation } from '../security/activation.js';
import { ArgsError, parseArgs } from '../runner/args.js';
import { planRun } from '../runner/plan.js';
import { executeRun, realRunBlockers } from '../runner/run.js';
import { smokeChecks, type SmokeGroundTruth } from '../runner/smoke-checks.js';
import { redactSecrets } from '../security/redact.js';
import type { PublicationInput } from '../types.js';
import { EnvFileError, loadLocalEnv } from '../security/env-file.js';
import { apiKeyConfigured, apiKeyFormatProblem } from '../adapters/real.js';

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (e) {
  if (e instanceof ArgsError) {
    console.error(`Arguments refusés : ${e.message}`);
    process.exit(2);
  }
  throw e;
}

// Clés API : environnement du shell (prioritaire), sinon pocs/ai-analysis/.env (non versionné, droits 600).
// Aucune valeur n'est jamais affichée ni journalisée : seulement les noms des variables.
const envPath = new URL('../../.env', import.meta.url).pathname;
try {
  const r = loadLocalEnv(envPath);
  if (r.found) console.log(`Fichier .env : ${r.loaded.length ? `chargé (${r.loaded.join(', ')})` : 'aucune nouvelle variable'}${r.keptFromShell.length ? ` ; conservées depuis le shell : ${r.keptFromShell.join(', ')}` : ''}${r.ignored.length ? ` ; ignorées : ${r.ignored.join(', ')}` : ''}`);
} catch (e) {
  if (e instanceof EnvFileError) {
    console.error(`Fichier .env refusé : ${e.message}`);
    process.exit(2);
  }
  throw e;
}
console.log(`Clés détectées (valeurs non affichées) : Anthropic ${apiKeyConfigured('anthropic') ? 'oui' : 'non'}, OpenAI ${apiKeyConfigured('openai') ? 'oui' : 'non'}`);
for (const p of ['anthropic', 'openai'] as const) {
  const f = apiKeyFormatProblem(p);
  if (f) console.warn(`⚠️ ${f}`);
}

const items = (JSON.parse(await readFile(new URL('../../fixtures/evaluation-set.json', import.meta.url), 'utf8')) as { items: PublicationInput[] }).items;
const ledgerPath = `${VAR_DIR}budget-ledger.json`;
let ledger: LedgerState | null = null;
if (existsSync(ledgerPath)) ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) as LedgerState;

// Simulation : garde en mémoire initialisé depuis une COPIE du registre (aucune écriture sur disque).
// Réel : garde persistant, après vérification d'intégrité du registre contre le journal.
const guard = args.real ? await createPersistentGuard() : new BudgetGuard(new MemoryBudgetStore(ledger ?? undefined), DEFAULT_LIMITS);
if (!args.real) await verifyLedgerIntegrity(VAR_DIR).catch((e) => console.warn(`⚠️ ${e.message}`));

const plan = planRun(args, items, guard, ledger);
let activation: RealCallActivation | null = null;
const adapterFor = (k: string) =>
  MODELS[k].provider === 'anthropic' ? new AnthropicAdapter(MODELS[k], undefined, activation) : new OpenAIAdapter(MODELS[k], undefined, activation);
const baseDeps = { guard, adapterFor, env: process.env };

console.log(`Mode : ${args.mode} | ${args.real ? 'RÉEL demandé' : 'simulation (aucun appel)'} | modèles : ${args.models.join(', ')}`);
console.log(`Appels prévus : ${plan.calls.length} (plafond ${plan.maxCalls}) | doublons retirés : ${plan.duplicatesRemoved} | écartés : ${plan.skipped.length}`);
for (const c of plan.calls) console.log(`  - ${c.modelKey} × ${c.publication.id} : borne d’entrée ${c.inputTokensUpperBound} tokens, sortie ≤ ${DEFAULT_LIMITS.maxOutputTokensPerRequest}, coût maximal réservé ${c.maxCostEur.toFixed(6)} €`);
for (const s of plan.skipped.slice(0, 10)) console.log(`  · écarté ${s.key} : ${s.reason}`);
const phaseUsed = ledger?.quotas?.phases?.[plan.phase];
const phaseExceptions = PHASE_QUOTA_EXCEPTIONS.filter((e) => e.phase === plan.phase);
console.log(`Quotas de la phase ${plan.phase} (cumulatifs) : ${phaseUsed?.total ?? 0}/${phaseTotalMax(plan.phase)} appels utilisés ; par modèle : ${args.models.map((m) => `${m} ${phaseUsed?.perModel?.[m] ?? 0}/${phaseModelMax(plan.phase, m)}`).join(', ')}`);
for (const e of phaseExceptions) console.log(`  Exception de quota : +${e.extraCalls} tentative pour ${e.modelKey} (incident ${e.incident.requestId}, HTTP ${e.incident.httpStatus}, non facturé) — ${e.approval}`);
console.log(`COÛT MAXIMAL DU PLAN : ${plan.totalMaxEur.toFixed(6)} € (budget d’essai : ${DEFAULT_LIMITS.trialTotalCapEur} €, déjà dépensé : ${(ledger?.trial.spentEur ?? 0).toFixed(6)} €)`);

const blockers = await realRunBlockers(args, plan, baseDeps);
const grantProblem = grantMismatch(await peekGrant(VAR_DIR), { phase: plan.phase, models: args.models, maxEur: args.confirmMaxEur ?? plan.totalMaxEur });
if (grantProblem) blockers.push(`Autorisation locale : ${grantProblem}`);
if (!args.real) {
  console.log(`\nPrérequis d’une exécution réelle non remplis (${blockers.length}) :`);
  for (const b of blockers) console.log(`  ✗ ${b}`);
  process.exit(0);
}

if (blockers.length) {
  console.error('\nExécution réelle REFUSÉE (aucune réservation, aucun appel, autorisation non consommée) :');
  for (const b of blockers) console.error(`  ✗ ${b}`);
  process.exit(3);
}
// Tous les prérequis sont remplis : l'autorisation est CONSOMMÉE (usage unique), l'activation n'existe qu'en mémoire.
activation = await consumeGrant(VAR_DIR, { phase: plan.phase, models: args.models, maxEur: args.confirmMaxEur! });
const report = await executeRun(args, plan, { ...baseDeps, activation });
activation = null;
if (!report.executed) {
  console.error('\nExécution réelle REFUSÉE (aucune réservation, aucun appel) :');
  for (const b of report.blockers) console.error(`  ✗ ${b}`);
  process.exit(3);
}
await mkdir(`${VAR_DIR}runs/`, { recursive: true });
const runFile = `${VAR_DIR}runs/${new Date().toISOString().replace(/[:.]/g, '-')}-${args.mode}.json`;
await writeFile(runFile, redactSecrets(JSON.stringify({ args, quotaExceptions: phaseExceptions, plan: { ...plan, calls: plan.calls.map((c) => ({ modelKey: c.modelKey, publicationId: c.publication.id, maxCostEur: c.maxCostEur })) }, report }, null, 2)));
if (args.mode === 'smoke') {
  const gt = (JSON.parse(await readFile(new URL('../../fixtures/ground-truth.json', import.meta.url), 'utf8')) as { items: (SmokeGroundTruth & { id: string })[] }).items;
  for (const rec of report.records) {
    const call = plan.calls.find((c) => c.publication.id === rec.publicationId && c.modelKey === rec.model)!;
    console.log(`\nSmoke test ${rec.model} :`);
    for (const ch of smokeChecks(rec, call.publication, gt.find((g) => g.id === rec.publicationId)!, call.maxCostEur)) console.log(`  ${ch.ok === null ? '·' : ch.ok ? '✓' : '✗'} ${ch.check} : ${ch.detail}`);
  }
}
console.log(`\n${report.records.length} appel(s), dépense comptée ${report.spentEur} €${report.stoppedReason ? `, arrêt : ${report.stoppedReason}` : ''}. Résultats : ${runFile}`);
