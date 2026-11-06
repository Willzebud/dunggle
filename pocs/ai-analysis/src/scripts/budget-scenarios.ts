/**
 * Scénarios budgétaires exécutables (aucun appel réel) → reports/budget-scenarios.md
 *   npm run budget:scenarios
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetGuard, BudgetRefusedError, MemoryUsageLogger } from '../budget/guard.js';
import { FileBudgetStore, MemoryBudgetStore } from '../budget/store.js';
import { DEFAULT_LIMITS, type BudgetLimits } from '../config/budget.js';
import { CANDIDATE_MODEL_KEYS, MODELS } from '../config/models.js';

const now = () => new Date('2026-11-06T10:00:00.000Z');
const L = (o: Partial<BudgetLimits> = {}) => ({ ...DEFAULT_LIMITS, ...o });
const rows: [string, string, string, boolean][] = [];
const check = (name: string, expected: string, observed: string, ok: boolean) => rows.push([name, expected, observed, ok]);
const codeOf = async (p: Promise<unknown>) => p.then(() => 'accepté', (e) => (e instanceof BudgetRefusedError ? `refus ${e.code}` : `erreur ${(e as Error).message}`));

// 1. Concurrence en mémoire
{
  const g = new BudgetGuard(new MemoryBudgetStore(), L({ trialTotalCapEur: 0.05 }), undefined, now);
  const r = await Promise.allSettled(Array.from({ length: 100 }, () => g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 100 })));
  const ok = r.filter((x) => x.status === 'fulfilled').length;
  const s = await g.snapshot();
  check('100 réservations simultanées, plafond 0,05 € (0,005125 € chacune)', '9 acceptées, réservé ≤ 0,05 €', `${ok} acceptées, réservé ${s.trial.reservedEur} €`, ok === 9 && s.trial.reservedEur <= 0.05);
}
// 2. Concurrence fichier (deux gardes, un registre)
{
  const dir = await mkdtemp(join(tmpdir(), 'dunggle-scen-'));
  const path = join(dir, 'ledger.json');
  const a = new BudgetGuard(new FileBudgetStore(path), L({ trialTotalCapEur: 0.03 }), undefined, now);
  const b = new BudgetGuard(new FileBudgetStore(path), L({ trialTotalCapEur: 0.03 }), undefined, now);
  const r = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => (i % 2 ? a : b).reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 100 })));
  const ok = r.filter((x) => x.status === 'fulfilled').length;
  check('30 réservations via deux gardes sur un même fichier, plafond 0,03 €', '5 acceptées', `${ok} acceptées`, ok === 5);
  await rm(dir, { recursive: true, force: true });
}
// 3. Dépassement, quota, tarif inconnu, requête trop grande
{
  const g = new BudgetGuard(new MemoryBudgetStore(), L({ dailyMaxAnalyses: 1 }), undefined, now);
  await g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 10 });
  const c = await codeOf(g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 10 }));
  check('2e analyse avec un quota quotidien de 1', 'refus daily-limit', c, c === 'refus daily-limit');
  const g2 = new BudgetGuard(new MemoryBudgetStore(), L(), undefined, now);
  const u = await codeOf(g2.reserve({ modelKey: 'mock-unpriced', inputTokensEstimate: 10 }));
  check('Modèle sans tarif vérifié', 'refus unknown-pricing', u, u === 'refus unknown-pricing');
  const big = await codeOf(g2.reserve({ modelKey: 'anthropic-haiku-5-5', inputTokensEstimate: 120_000 }));
  check('Entrée de 120 000 tokens (plafond 16 000)', 'refus request-too-large', big, big === 'refus request-too-large');
  const g3 = new BudgetGuard(new MemoryBudgetStore(), L({ trialTotalCapEur: 0.001 }), undefined, now);
  const t = await codeOf(g3.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 100 }));
  check('Réservation dont le maximum dépasse le budget d’essai restant', 'refus trial-cap', t, t === 'refus trial-cap');
}
// 4. Échec fournisseur et réconciliation
{
  const log = new MemoryUsageLogger();
  const g = new BudgetGuard(new MemoryBudgetStore(), L(), log, now);
  const r = await g.reserve({ modelKey: 'anthropic-haiku-5-5', inputTokensEstimate: 3000 });
  const charged = await g.markUncertain(r.id, 'timeout sans usage');
  check('Timeout après envoi, usage inconnu', `facturé au maximum (${r.estimatedMaxEur} €), marqué incertain`, `${charged} €, incertain ${(await g.snapshot()).months['2026-11'].uncertainEur} €`, charged === r.estimatedMaxEur);
  const r2 = await g.reserve({ modelKey: 'anthropic-haiku-5-5', inputTokensEstimate: 3000 });
  const actual = await g.reconcile(r2.id, { inputTokens: 2400, outputTokens: 300 });
  check('Réconciliation (2 400 entrée / 300 sortie, Haiku 5.5)', '0,00039 € (= (2400×0,10 + 300×0,50)/1e6)', `${actual} €`, actual === 0.00039);
  const rel = await codeOf(g.release(r.id, 'tentative de libération d’un coût incertain'));
  check('Libérer un coût incertain', 'refus unknown-reservation (jamais libéré)', rel, rel === 'refus unknown-reservation');
}
// 5. Dette : coût réel supérieur à l'estimation
{
  const g = new BudgetGuard(new MemoryBudgetStore(), L({ trialTotalCapEur: 0.02 }), undefined, now);
  const r = await g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 100, maxOutputTokens: 100 });
  const actual = await g.reconcile(r.id, { inputTokens: 15_000, outputTokens: 2_000 });
  const next = await codeOf(g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 10 }));
  check('Coût réel (0,025 €) > estimation (0,00075 €), budget d’essai 0,02 €', 'dette enregistrée, appel suivant refusé', `dépense ${actual} €, appel suivant : ${next}`, next === 'refus trial-cap');
}
// 6. Changement de mois civil
{
  let t = new Date('2026-10-31T23:59:30Z');
  const g = new BudgetGuard(new MemoryBudgetStore(), L({ monthlyOperationalCapEur: 0.006, monthlyHardCapEur: 0.006, trialTotalCapEur: 0.006 }), undefined, () => t);
  const r = await g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 100, scope: 'operational' });
  t = new Date('2026-11-01T00:00:30Z');
  await g.reconcile(r.id, { inputTokens: 100, outputTokens: 100 });
  const s = await g.snapshot();
  const nov = await codeOf(g.reserve({ modelKey: 'mock-cheap', inputTokensEstimate: 100, scope: 'operational' }));
  check('Réservation le 31/10 à 23:59, réconciliée le 01/11', 'imputée à octobre ; novembre repart de zéro', `octobre ${s.months['2026-10'].spentEur} €, novembre : ${nov}`, nov === 'accepté' && s.months['2026-10'].spentEur > 0);
}

// 5. Projections avec les tarifs vérifiés (pire cas par requête)
const g = new BudgetGuard(new MemoryBudgetStore(), L(), undefined, now);
const proj = CANDIDATE_MODEL_KEYS.map((k) => {
  const worst = g.estimateMaxCostEur(k, DEFAULT_LIMITS.maxInputTokensPerRequest);
  const typical = g.estimateMaxCostEur(k, 3600); // borne haute typique d'une requête « métadonnées »
  return { k, worst, typical };
});

const out: string[] = ['# POC 2 — Phase A : tests et scénarios budgétaires', ''];
out.push(`> Généré par \`npm run budget:scenarios\` le ${new Date().toISOString().slice(0, 10)}. Aucun appel réel ; modèle fictif \`mock-cheap\` (1 $ / 5 $ par M de tokens) pour exercer les plafonds.`, '');
out.push('## Paramètres appliqués', '');
out.push(`| Paramètre | Valeur |`, '|---|---|');
out.push(`| Maximum absolu mensuel | ${DEFAULT_LIMITS.monthlyHardCapEur} € |`, `| Budget opérationnel mensuel (appliqué) | ${DEFAULT_LIMITS.monthlyOperationalCapEur} € |`, `| Budget total des essais du POC | ${DEFAULT_LIMITS.trialTotalCapEur} € |`);
out.push(`| Analyses par jour (max) | ${DEFAULT_LIMITS.dailyMaxAnalyses} |`, `| Tokens d’entrée / sortie par requête (max) | ${DEFAULT_LIMITS.maxInputTokensPerRequest} / ${DEFAULT_LIMITS.maxOutputTokensPerRequest} |`, `| Marge de sécurité | ×${DEFAULT_LIMITS.safetyMultiplier} |`, `| Conversion | 1 USD = ${DEFAULT_LIMITS.eurPerUsd} EUR (borne haute prudente) |`, '');
out.push('## Scénarios exécutés', '');
out.push('| Scénario | Attendu | Observé | Résultat |', '|---|---|---|---|');
for (const [n, e, o, ok] of rows) out.push(`| ${n} | ${e} | ${o} | ${ok ? '✅' : '❌'} |`);
out.push('', '## Projection avec les tarifs vérifiés (2026-11-06)', '');
out.push(`| Modèle | Coût max d’une requête au plafond (${DEFAULT_LIMITS.maxInputTokensPerRequest} / ${DEFAULT_LIMITS.maxOutputTokensPerRequest} tokens) | Coût max d’une requête « métadonnées » (borne ~3 600 tokens) | Analyses au pire cas dans 0,50 € | Analyses au pire cas dans 8 €/mois |`);
out.push('|---|---|---|---|---|');
for (const p of proj) out.push(`| ${MODELS[p.k].modelId} | ${p.worst.toFixed(6)} € | ${p.typical.toFixed(6)} € | ${Math.floor(0.5 / p.worst)} | ${Math.floor(8 / p.worst)} |`);
out.push('', 'À environ 390 publications par mois (POC 1.2), même le pire cas (≈ 1 € par mois) reste très inférieur au budget opérationnel. Le plafond qui s’applique en premier en pratique est le budget d’essai de 0,50 €.', '');
out.push('## Tests automatisés correspondants', '', 'Fichiers `tests/budget.test.ts` et `tests/budget-audit.test.ts` (phase A.1 : borne haute d’entrée, coût maximal, normalisation des tokens de raisonnement, palier long contexte, modèle non validé, coût incertain jamais libéré, dette, changement de mois, persistance après redémarrage, interruption de processus, verrou orphelin). `tests/budget.test.ts` (exécuté par `npm test`) : estimation, tarif inconnu, requête trop grande, limites incohérentes, budget d’essai, plafonds mensuels, quota quotidien, réconciliation / libération / coût incertain, coût réel supérieur à l’estimation, réservations orphelines, concurrence en mémoire, concurrence via fichier, concurrence entre **trois processus distincts**, journal JSON Lines. `tests/pipeline.test.ts` couvre les échecs fournisseur de bout en bout.', '');
out.push('## Limites', '');
out.push('- La comptabilité interne est une **estimation prudente**. Elle ne garantit pas la facture : configurer aussi les plafonds de dépense dans les consoles Anthropic et OpenAI avant la phase B.');
out.push('- Le verrou fichier suppose un système de fichiers local (pas de NFS). Un verrou orphelin n’est jamais cassé automatiquement : il bloque les analyses jusqu’à une intervention manuelle.');
out.push('- Les tarifs sont figés dans `src/config/models.ts` : ils doivent être revérifiés avant chaque campagne d’essais.');
out.push('- Les tokens de réflexion ou de raisonnement sont comptés en sortie et bornés par le plafond de 800 tokens. Une réponse tronquée par ce plafond est facturée, puis rejetée comme sortie invalide.', '- Audit détaillé et protections fournisseurs : `reports/budget-audit.md`.', '');
await writeFile(new URL('../../reports/budget-scenarios.md', import.meta.url), out.join('\n'));
const failed = rows.filter((r) => !r[3]).length;
console.log(`budget-scenarios.md : ${rows.length} scénarios, ${failed} échec(s)`);
if (failed) process.exitCode = 1;
