/**
 * Préparation du test final B3 (hors ligne, aucun réseau) : jeu figé sans mention de fiction transmise,
 * politiques de contenu, gel par empreinte, phase B3 (activée sur autorisation), consignes de longueur, conservation locale des sorties
 * rejetées, règle de décision (éliminations, écart, départage, artefacts de protocole, revue humaine).
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { forbidNetwork } from './helpers.js';
import { resolveInput } from '../src/content-policy.js';
import { validatePolicies } from '../src/config/content-policies.js';
import { coverageFor } from '../src/config/coverage.js';
import { buildPrompt, PROMPT_VERSION, SYSTEM_PROMPT } from '../src/prompt.js';
import { LIMITS } from '../src/schema.js';
import { B3_FILES, B3_FREEZE, verifyB3Freeze } from '../src/evaluation/b3-freeze.js';
import { B2_PROMPT_VERSION, POC_PHASES, phaseForMode } from '../src/config/quotas.js';
import { BudgetGuard, BudgetRefusedError } from '../src/budget/guard.js';
import { MemoryBudgetStore } from '../src/budget/store.js';
import { DEFAULT_LIMITS } from '../src/config/budget.js';
import { createGrant, confirmationPhrase, ActivationError, ACTIVATION_TTL_MS_BY_PHASE } from '../src/security/activation.js';
import { parseArgs } from '../src/runner/args.js';
import { planRun } from '../src/runner/plan.js';
import { CALL_LATENCY_ASSUMPTIONS_MS, estimateRunDurationMs, realRunBlockers } from '../src/runner/run.js';
import { MockAdapter, mockOutput } from '../src/adapters/mock.js';
import { analyzePublication } from '../src/pipeline.js';
import { computeModelMetrics, type GroundTruthItem } from '../src/evaluation/compare.js';
import { decide, humanScoresFromGrid, protocolArtifacts, validateReviewGrid, type DecisionRule, type HumanScores, type ModelEvidence, type ReviewGrid } from '../src/evaluation/decision.js';
import { blindReviewGrid, latestRecords } from '../src/evaluation/compare.js';
import type { AnalysisRecord, PublicationInput } from '../src/types.js';

before(forbidNetwork);
const HAIKU = 'anthropic-haiku-5-5';
const LUNA = 'openai-gpt-6-luna';
const dir = new URL('../fixtures/b3/', import.meta.url);
const load = <T>(f: string) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as T;
const pubs = load<{ items: (PublicationInput & { provenance?: string })[] }>('publications.json').items;
const gt = load<{ items: (GroundTruthItem & { category: string; uncertaintyResolved: string; acceptableExclusions: (string | null)[] })[] }>('ground-truth.json').items;
const rule = load<DecisionRule & { protocolArtifact: { pattern: string } }>('decision-rule.json');

// ================================================================ 1. Jeu figé
test('Jeu B3 : 10 à 15 publications, vérité de référence alignée, toutes les catégories demandées', () => {
  assert.ok(pubs.length >= 10 && pubs.length <= 15, `${pubs.length} publications`);
  assert.deepEqual(gt.map((g) => g.id), pubs.map((p) => p.id));
  assert.equal(new Set(pubs.map((p) => p.id)).size, pubs.length, 'identifiants uniques');
  assert.equal(new Set(pubs.map((p) => p.url)).size, pubs.length, 'URL uniques');
  for (const g of gt) assert.ok(g.category && g.uncertaintyResolved, `${g.id} : catégorie et incertitude documentées`);
  const cats = gt.map((g) => g.category).join(' | ');
  for (const c of ['importante facile à manquer', 'marketing', 'ambiguë', 'obligatoire', 'résumé précis', 'insuffisantes', 'extrait limité']) assert.ok(cats.includes(c), `catégorie « ${c} »`);
  assert.ok(gt.filter((g) => g.important).length >= 6, 'actualités importantes');
  assert.ok(gt.filter((g) => g.coveragePolicy === 'mandatory').every((g) => coverageFor(g.id.split(':')[0]) === 'mandatory'));
  assert.ok(gt.filter((g) => g.coveragePolicy === 'mandatory').length >= 2);
  assert.ok(gt.filter((g) => g.editorialDecision === 'must_exclude').length >= 2);
});

test('Jeu B3 : publications réelles en métadonnées seules, synthétiques sur des sources dédiées et domaine réservé', () => {
  for (const p of pubs) {
    if (!p.synthetic) {
      assert.equal(p.text ?? null, null, `${p.id} : aucun texte d’article réel`);
      assert.equal(resolveInput(p).mode, 'metadata', `${p.id} : métadonnées uniquement`);
    } else {
      assert.ok(p.sourceId.startsWith('b3-synthetic-'), p.id);
      assert.match(new URL(p.url).hostname, /\.example$/, `${p.id} : domaine réservé RFC 2606`);
      assert.ok(p.provenance, `${p.id} : provenance interne`);
    }
  }
  assert.deepEqual(validatePolicies(), []);
});

test('Jeu B3 : AUCUNE mention de fiction dans ce qui est transmis aux modèles (provenance interne jamais envoyée)', () => {
  const re = /\b(fictifs?|fictives?|synth[ée]tiques?|synthetic|fixtures?|fictional|fictitious|hypoth[ée]tiques?|hypothetical|fake|not real|pas r[ée]elles?|POC|Dunggle|dummy|lorem)\b/i;
  for (const p of pubs) {
    const sent = JSON.parse(buildPrompt(p, resolveInput(p)).user) as { untrustedPublication: Record<string, unknown> };
    const u = sent.untrustedPublication;
    for (const f of ['title', 'source', 'text']) assert.doesNotMatch(String(u[f] ?? ''), re, `${p.id}.${f}`);
    assert.doesNotMatch(new URL(p.url).pathname, re, `${p.id}.url`);
    const user = buildPrompt(p, resolveInput(p)).user;
    assert.ok(!user.includes('provenance') && !user.includes('"synthetic"') && !user.includes('b3-synthetic'), `${p.id} : métadonnées internes non transmises`);
  }
  // Le motif d'artefact figé ne se déclenche sur aucun texte transmis : seule une sortie de modèle peut le déclencher.
  const art = new RegExp(rule.protocolArtifact.pattern, 'iu');
  for (const p of pubs.filter((x) => x.synthetic)) assert.doesNotMatch(`${p.title} ${p.sourceName} ${p.text ?? ''}`, art, p.id);
});

test('Jeu B3 : modes de contenu (intégral, extrait borné avec longueur maximale communiquée)', () => {
  for (const p of pubs.filter((x) => x.synthetic)) {
    const input = resolveInput(p);
    const payload = JSON.parse(buildPrompt(p, input).user) as { summaryMaxChars: number | null; contentProvided: string };
    if (p.sourceId === 'b3-synthetic-excerpt') {
      assert.equal(input.mode, 'excerpt');
      assert.equal(payload.summaryMaxChars, input.text!.length, `${p.id} : longueur maximale = extrait`);
    } else {
      assert.equal(input.mode, 'full');
      assert.equal(payload.summaryMaxChars, null);
    }
  }
  const tess = pubs.find((p) => p.id === 'b3:tessaline-forms-5')!;
  assert.ok((tess.text ?? '').split(/[.;:]/).length > LIMITS.maxKeyPoints + 3, 'plus de faits que de points clés autorisés');
});

// ================================================================ 2. Gel
test('Gel B3 : empreinte et version du prompt vérifiées ; toute modification est détectée', async () => {
  const ok = await verifyB3Freeze();
  assert.equal(ok.ok, true, ok.problem ?? '');
  assert.equal(B3_FREEZE.promptVersion, PROMPT_VERSION);
  const tmp = await mkdtemp(join(tmpdir(), 'dunggle-b3-'));
  for (const f of B3_FILES) await copyFile(new URL(f, dir), join(tmp, f));
  const g = JSON.parse(readFileSync(join(tmp, 'ground-truth.json'), 'utf8'));
  g.items[0].relevanceBands = ['medium', 'high'];
  await writeFile(join(tmp, 'ground-truth.json'), JSON.stringify(g, null, 2));
  const bad = await verifyB3Freeze(pathToFileURL(`${tmp}/`));
  assert.equal(bad.ok, false);
  assert.match(bad.problem!, /modifiées après le gel/);
});

// ================================================================ 3. Phase B3 clôturée et désactivée, quota distinct conservé
test('Phase B3 : clôturée et désactivée (2026-11-07) ; aucune réservation ni autorisation possible ; quota distinct 15 / 30 conservé', async () => {
  assert.equal(POC_PHASES.B3.active, false);
  assert.deepEqual([POC_PHASES.B3.perModelMax, POC_PHASES.B3.totalMax], [15, 30]);
  assert.equal(phaseForMode('final'), 'B3');
  const g = new BudgetGuard(new MemoryBudgetStore());
  await assert.rejects(g.reserve({ modelKey: LUNA, inputTokensEstimate: 1000, idempotencyKey: `${LUNA}|b3:0|${PROMPT_VERSION}`, quota: { scope: 'trial', phase: 'B3', runId: 'b3-0' } }), (e: unknown) => e instanceof BudgetRefusedError && e.code === 'quota-phase-inactive');
  // Même avec la phrase de confirmation exacte, aucune autorisation locale ne peut être créée.
  const tmp = `${await mkdtemp(join(tmpdir(), 'dunggle-grant-'))}/`;
  await assert.rejects(createGrant({ phase: 'B3', models: [HAIKU, LUNA], maxEur: 0.06, confirm: 'AUTORISER B3 0.06 EUR' }, tmp), (e: unknown) => e instanceof ActivationError && /Phase B3 inactive/.test((e as Error).message));
});

test('Plan B3 (simulation) : 30 appels sur un registre simulé, coût maximal borné, exécution réelle bloquée (phase inactive)', async () => {
  const ledger = new MemoryBudgetStore();
  const g = new BudgetGuard(ledger, DEFAULT_LIMITS);
  const args = parseArgs(['--mode=final', '--dry-run']);
  const plan = planRun(args, pubs, g, null);
  assert.equal(plan.phase, 'B3');
  assert.equal(plan.calls.length, 30);
  assert.equal(plan.calls.filter((c) => c.modelKey === HAIKU).length, 15);
  assert.ok(plan.totalMaxEur > 0 && plan.totalMaxEur <= 0.06, `coût maximal ${plan.totalMaxEur} €`);
  const typical = estimateRunDurationMs(plan, CALL_LATENCY_ASSUMPTIONS_MS.typical);
  assert.ok(typical * 1.25 <= ACTIVATION_TTL_MS_BY_PHASE.B3, `durée typique ${Math.round(typical / 60000)} min, marge 25 % ≤ 45 min`);
  const real = parseArgs(['--mode=final', '--real', `--confirm-max-eur=${plan.totalMaxEur}`]);
  const blockers = await realRunBlockers(real, plan, { guard: g, adapterFor: () => { throw new Error('jamais appelé'); }, env: {} });
  assert.ok(blockers.some((b) => /Phase B3 inactive/.test(b)), 'phase désactivée : exécution réelle bloquée');
});

// ================================================================ 4. Prompt et diagnostic
test('Prompt : limites de longueur communiquées (cause du défaut Haiku sur OrionVision) ; version distincte de B.2', () => {
  assert.match(SYSTEM_PROMPT, new RegExp(`de 0 à ${LIMITS.maxKeyPoints} éléments`));
  assert.match(SYSTEM_PROMPT, new RegExp(`${LIMITS.maxSummaryChars} caractères au plus`));
  assert.match(SYSTEM_PROMPT, /summaryMaxChars/);
  assert.notEqual(PROMPT_VERSION, B2_PROMPT_VERSION, 'nouvelle clé d’idempotence : aucun résultat B.2 réutilisé ni écrasé');
});

test('Sortie rejetée et résumé supprimé : conservés localement pour diagnostic, jamais réinjectés', async () => {
  const guard = new BudgetGuard(new MemoryBudgetStore());
  const tess = pubs.find((p) => p.id === 'b3:tessaline-forms-5')!;
  const six = mockOutput({ themes: ['ANGULAR'], subthemes: [], type: 'release', summary: 'Résumé.', keyPoints: ['a', 'b', 'c', 'd', 'e', 'f'] });
  const r1 = await analyzePublication(tess, { adapter: new MockAdapter(() => ({ rawText: six, usage: { inputTokens: 10, outputTokens: 10 }, stopReason: 'end_turn' })), guard });
  assert.equal(r1.status, 'invalid-output');
  assert.equal(r1.analysis, null, 'aucune correction silencieuse');
  assert.equal(r1.rejectedRawOutput, six);
  const korvo = pubs.find((p) => p.id === 'b3:korvo-24')!;
  const long = 'x'.repeat((korvo.text ?? '').length + 5);
  const r2 = await analyzePublication(korvo, { adapter: new MockAdapter(() => ({ rawText: mockOutput({ themes: ['AI_AGENTS'], subthemes: [], type: 'release', summary: long, keyPoints: ['k'] }), usage: { inputTokens: 10, outputTokens: 10 }, stopReason: 'end_turn' })), guard });
  assert.equal(r2.analysis!.summary, null);
  assert.deepEqual(r2.analysis!.keyPoints, []);
  assert.equal(r2.droppedSummary!.summary, long);
  assert.ok(r2.droppedSummary!.reasons.includes('summary-longer-than-excerpt'));
});

// ================================================================ 5. Règle de décision
const pubById = new Map(pubs.map((p) => [p.id, p]));
const BAND_MID = { high: 85, medium: 55, low: 10 } as const;
/** Enregistrement « parfait » conforme à la vérité de référence, surchargeable. */
function ideal(model: string, g: GroundTruthItem & { acceptableExclusions: (string | null)[] }, over: Partial<AnalysisRecord['analysis']> & { status?: AnalysisRecord['status']; violations?: string[] } = {}): AnalysisRecord {
  const p = pubById.get(g.id)!;
  const input = resolveInput(p);
  const exclusion = g.editorialDecision === 'must_exclude' ? (g.acceptableExclusions.find((x) => x) as string) : null;
  const facts = g.referenceFacts ?? [];
  const summary = (g.summaryExpected === true || g.summaryExpected === 'if-kept') && !exclusion ? `La publication présente ${facts.join(' et ')} pour les équipes.` : null;
  const { status = 'analyzed', violations = [], ...a } = over;
  const analysis = { themes: g.themes.length ? g.themes : ['AI'], subthemes: [], type: g.types[0], relevance: BAND_MID[(g.relevanceBands ?? [g.relevance])[0]], novelty: g.novelty[0], confidence: 0.6, relevanceReason: 'Raison.', summary, keyPoints: summary ? ['Point.'] : [], exclusionReason: exclusion, ...a } as NonNullable<AnalysisRecord['analysis']>;
  const section = status !== 'analyzed' ? 'pending' : analysis.exclusionReason ? 'excluded' : g.sections[0];
  return { publicationId: g.id, sourceId: p.sourceId, url: p.url, title: p.title, synthetic: p.synthetic, contentLevel: p.contentLevel, contentPolicy: input.policy, coveragePolicy: g.coveragePolicy, inputMode: input.mode, status, section: section as AnalysisRecord['section'], analysis: status === 'analyzed' ? analysis : null, violations, model, costEur: 0.0005, costUncertain: false } as AnalysisRecord;
}
function evidence(model: string, tweak: (id: string) => Parameters<typeof ideal>[2] = () => ({}), msPerCall = 2000, cost = 0.0005): ModelEvidence {
  const records = gt.map((g) => ({ ...ideal(model, g, tweak(g.id)), costEur: cost }));
  const timings = records.map((r) => ({ modelKey: model, publicationId: r.publicationId, ms: msPerCall }));
  return { model, records, metrics: computeModelMetrics(model, records, gt, pubs, timings) };
}
const IMPORTANT = gt.filter((g) => g.important).map((g) => g.id);
const ALL2 = { factual_accuracy: 2, essential_information: 2, no_invented_claims: 2, content_level_respect: 2, french_quality: 2, concision_usefulness: 2 };
/** Revue humaine complète (toutes notes à 2) pour les résumés autorisés des deux modèles. */
function fullHuman(): HumanScores {
  const h: HumanScores = {};
  for (const g of gt.filter((x) => x.summaryAllowed)) h[g.id] = { [HAIKU]: { ...ALL2 }, [LUNA]: { ...ALL2 } };
  return h;
}
const invention = (claim: string) => ({ claim, sourceCheck: 'absent' as const, justification: 'Le texte source ne mentionne nulle part cette information.' });

test('Décision : SANS revue humaine complète, aucune décision n’est rendue, même provisoire', () => {
  const d = decide([evidence(HAIKU, undefined, 2000, 0.0006), evidence(LUNA, undefined, 2000, 0.0004)], gt, pubs, rule, null);
  assert.equal(d.chosen, null);
  assert.equal(d.provisional, true);
  assert.equal(d.validated, false);
  assert.match(d.provisionalReasons[0], /OBLIGATOIRE/);
  assert.match(d.basis, /revue humaine à l’aveugle obligatoire/);
});

test('Décision : deux modèles parfaits et identiques, revue humaine complète → départage par le coût, décision définitive', () => {
  const d = decide([evidence(HAIKU, undefined, 2000, 0.0006), evidence(LUNA, undefined, 2000, 0.0004)], gt, pubs, rule, fullHuman());
  assert.equal(d.provisional, false);
  assert.equal(d.chosen, LUNA);
  assert.match(d.basis, /coût/);
  assert.equal(d.validated, true);
});

test('Décision : deux actualités importantes exclues → élimination, l’autre modèle est retenu', () => {
  const bad = evidence(HAIKU, (id) => (id === IMPORTANT[0] || id === IMPORTANT[1] ? { exclusionReason: 'off_topic' } : {}));
  const d = decide([bad, evidence(LUNA)], gt, pubs, rule, fullHuman());
  assert.match(d.scores.find((s) => s.model === HAIKU)!.eliminations.join(), /actualités importantes exclues/);
  assert.equal(d.chosen, LUNA);
  assert.equal(d.basis, 'seul modèle sans critère éliminatoire');
});

test('Décision : deux sorties invalides → élimination ; une seule → pénalité sans élimination', () => {
  const two = evidence(HAIKU, (id) => (id === 'b3:tessaline-forms-5' || id === 'b3:nembra-v2' ? { status: 'invalid-output' } : {}));
  const one = evidence(LUNA, (id) => (id === 'b3:tessaline-forms-5' ? { status: 'invalid-output' } : {}));
  const d = decide([two, one], gt, pubs, rule, fullHuman());
  const h = d.scores.find((s) => s.model === HAIKU)!;
  const l = d.scores.find((s) => s.model === LUNA)!;
  assert.match(h.eliminations.join(), /sorties structurées invalides/);
  assert.equal(l.eliminations.length, 0);
  assert.ok(l.criteria.structuredReliability < rule.weights.structuredReliability);
  assert.equal(d.chosen, LUNA);
});

test('Décision : résultats proches → une actualité importante manquée départage (priorité 1), pas une simple sous-notation', () => {
  // Haiku exclut UNE actualité importante (sous le seuil éliminatoire), mais il est moins cher et plus rapide.
  const l = evidence(LUNA, undefined, 4000, 0.0005);
  const missed = evidence(HAIKU, (id) => (id === IMPORTANT[0] ? { exclusionReason: 'off_topic' } : {}), 1000, 0.0003);
  const d = decide([missed, l], gt, pubs, rule, fullHuman());
  const [sh, sl] = [d.scores.find((s) => s.model === HAIKU)!, d.scores.find((s) => s.model === LUNA)!];
  assert.equal(sh.eliminations.length, 0);
  assert.ok(Math.abs(sh.total - sl.total) < rule.closeMarginPoints, 'résultats proches');
  assert.equal(d.chosen, LUNA);
  assert.match(d.basis, /importantCoverage/);
  // Une actualité importante seulement sous-notée (toujours visible) ne suffit pas à départager : le coût l'emporte.
  const under = evidence(HAIKU, (id) => (id === IMPORTANT[0] ? { relevance: 55 } : {}), 1000, 0.0003);
  const d2 = decide([under, l], gt, pubs, rule, fullHuman());
  assert.equal(d2.chosen, HAIKU);
  assert.match(d2.basis, /coût/);
});

test('Décision : invention confirmée par la revue humaine → élimination ; les deux éliminés → aucun modèle validé', () => {
  const ev = [evidence(HAIKU), evidence(LUNA)];
  const human = fullHuman();
  // Note 0 SANS invention documentée : ne compte pas comme invention (la grille correspondante serait refusée).
  human['b3:nembra-v2'][HAIKU] = { ...human['b3:nembra-v2'][HAIKU], no_invented_claims: 0 };
  assert.equal(decide(ev, gt, pubs, rule, human).scores.find((x) => x.model === HAIKU)!.eliminations.length, 0);
  human['b3:nembra-v2'][HAIKU] = { ...human['b3:nembra-v2'][HAIKU], no_invented_claims: 0, inventions: [invention('le code d’entraînement est publié')] };
  const d1 = decide(ev, gt, pubs, rule, human);
  assert.match(d1.scores.find((x) => x.model === HAIKU)!.eliminations.join(), /invention/);
  assert.equal(d1.provisional, false, 'revue humaine complète, aucun artefact');
  assert.equal(d1.chosen, LUNA);
  human['b3:korvo-24'][LUNA] = { ...human['b3:korvo-24'][LUNA], no_invented_claims: 0, inventions: [invention('prise en charge de MySQL')] };
  const d2 = decide(ev, gt, pubs, rule, human);
  assert.equal(d2.validated, false);
  assert.equal(d2.provisional, true);
  assert.match(d2.basis, /AUCUN modèle validé/);
});

test('Décision : artefact de protocole (sortie évoquant la fiction) → publication neutralisée pour LES DEUX modèles', () => {
  const h = evidence(HAIKU);
  const l = evidence(LUNA, (id) => (id === 'b3:nembra-v2' ? { exclusionReason: 'off_topic', relevance: 0, summary: null, keyPoints: [], relevanceReason: 'Le texte semble être une publication fictive.' } : {}));
  const arts = protocolArtifacts([h, l], pubs, rule.protocolArtifact.pattern);
  assert.deepEqual(arts, [{ id: 'b3:nembra-v2', models: [LUNA] }]);
  const d = decide([h, l], gt, pubs, rule, fullHuman());
  assert.ok(!d.scores[0].details.importantItems.some((i) => i.id === 'b3:nembra-v2'));
  assert.equal(d.scores.find((s) => s.model === LUNA)!.eliminations.length, 0, 'aucune pénalité pour un artefact');
  assert.deepEqual(d.scores.find((s) => s.model === LUNA)!.criteria.importantCoverage, d.scores.find((s) => s.model === HAIKU)!.criteria.importantCoverage);
});

test('Revue humaine : grille incomplète, sans relecteur ou avec une invention non documentée → refusée, correspondance non lue', () => {
  const src = pubs.find((p) => p.id === 'b3:korvo-24')!.text!;
  const summary = 'Korvo 2.4 sauvegarde l’état de chaque étape dans SQLite ou Postgres et prend en charge MySQL.';
  const grid = (reviewer: string | null, scores: Record<string, number | null>, inventions?: ReturnType<typeof invention>[]): ReviewGrid => ({ reviewer, items: [{ publicationId: 'b3:korvo-24', sourceText: src, candidates: [{ label: 'A', summary, keyPoints: [], scores, inventions }] }] });
  const key = { 'b3:korvo-24': { A: HAIKU } };
  let keyRead = false;
  const spyKey = new Proxy(key, { get: (t, p) => { keyRead = true; return t[p as keyof typeof t]; } });
  assert.match(validateReviewGrid(grid(null, ALL2)).join(), /relecteur non renseigné/);
  assert.equal(humanScoresFromGrid(grid(null, ALL2), spyKey), null);
  assert.equal(keyRead, false, 'correspondance A/B jamais lue pour une grille invalide');
  assert.match(validateReviewGrid(grid('relecteur', { ...ALL2, french_quality: null })).join(), /manquante/);
  // Note 0 sans documentation : refusée.
  assert.match(validateReviewGrid(grid('relecteur', { ...ALL2, no_invented_claims: 0 })).join(), /sans invention documentée/);
  // Passage qui n'est pas dans le candidat, passage présent dans la source, justification trop courte, note incohérente.
  assert.match(validateReviewGrid(grid('relecteur', { ...ALL2, no_invented_claims: 0 }, [invention('prend en charge Redis')])).join(), /introuvable tel quel/);
  assert.match(validateReviewGrid(grid('relecteur', { ...ALL2, no_invented_claims: 0 }, [invention('Postgres')])).join(), /présent tel quel dans le texte source/);
  assert.match(validateReviewGrid(grid('relecteur', { ...ALL2, no_invented_claims: 0 }, [{ claim: 'prend en charge MySQL', sourceCheck: 'absent', justification: 'non' }])).join(), /justification/);
  assert.match(validateReviewGrid(grid('relecteur', { ...ALL2, no_invented_claims: 2 }, [invention('prend en charge MySQL')])).join(), /note « absence d'invention » ≠ 0/);
  // Invention correctement documentée : acceptée et transmise à la décision.
  const ok = grid('relecteur', { ...ALL2, no_invented_claims: 0 }, [invention('prend en charge MySQL')]);
  assert.deepEqual(validateReviewGrid(ok), []);
  assert.equal(humanScoresFromGrid(ok, key)!['b3:korvo-24'][HAIKU].inventions!.length, 1);
  // Reformulation sans invention (note 1 ou 2, aucune documentation) : acceptée.
  assert.deepEqual(validateReviewGrid(grid('relecteur', { ...ALL2, factual_accuracy: 1 })), []);
});

test('Grille B3 générée : consignes invention / omission / reformulation, champ « inventions », correspondance séparée', () => {
  const recs = [HAIKU, LUNA].flatMap((m) => evidence(m).records);
  const { grid, key } = blindReviewGrid(latestRecords([{ records: recs }]), gt, pubs, () => 0.3, 'B3');
  const g = grid as unknown as { instructions: string[]; reviewer: null; items: { publicationId: string; sourceText: string; candidates: { label: string; inventions: unknown[]; scores: Record<string, null> }[] }[] };
  assert.ok(g.instructions.some((i) => /NE SONT PAS des inventions/.test(i)) && g.instructions.some((i) => /omission/.test(i)));
  assert.equal(g.reviewer, null);
  assert.ok(g.items.length >= 4);
  for (const it of g.items) {
    assert.ok(it.sourceText, `${it.publicationId} : texte source fourni au relecteur`);
    for (const c of it.candidates) {
      assert.deepEqual(c.inventions, []);
      assert.ok(Object.values(c.scores).every((v) => v === null), 'aucune note pré-remplie');
    }
  }
  assert.ok(!JSON.stringify(grid).includes(HAIKU) && !JSON.stringify(grid).includes(LUNA), 'aucun nom de modèle dans la grille');
  assert.ok(Object.keys(key).length === g.items.length);
});

test('Règle figée : pondération sur 100, priorités dans l’ordre demandé', () => {
  const w = rule.weights;
  assert.equal(Object.values(w).reduce((s, x) => s + x, 0), 100);
  assert.ok(w.importantCoverage > w.factualAccuracy && w.factualAccuracy > w.summaryQuality && w.summaryQuality > w.costLatency);
  assert.ok(w.structuredReliability >= w.classification && w.classification > w.costLatency);
  assert.deepEqual(rule.tieBreakOrder.slice(0, 2), ['importantCoverage', 'factualAccuracy']);
});
