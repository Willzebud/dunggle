import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { forbidNetwork, mockOutput, pub } from '../helpers.js';
import { validateAnalysis, ANALYSIS_JSON_SCHEMA } from '../../src/analysis/schema.js';
import { resolveInput } from '../../src/analysis/content-policy.js';
import { CONTENT_POLICIES, policyFor, validatePolicies } from '../../src/config/content-policies.js';

before(forbidNetwork);

// ------------------------------------------------------------------ schéma (repris du POC 2)
test('schéma : sortie valide acceptée, y compris multi-thématique', () => {
  const r = validateAnalysis(mockOutput({ themes: ['AI', 'AI_AGENTS', 'DIGITAL_INNOVATION'], subthemes: ['agent_frameworks', 'cybersecurity', 'other:protocoles'] }));
  assert.equal(r.ok, true, r.errors.join(' ; '));
  assert.deepEqual(r.value!.themes, ['AI', 'AI_AGENTS', 'DIGITAL_INNOVATION']);
});

test('schéma : bornes relevance / novelty / confidence vérifiées localement', () => {
  for (const [over, field] of [
    [{ relevance: 101 }, 'relevance'], [{ relevance: -1 }, 'relevance'], [{ relevance: 50.5 }, 'relevance'],
    [{ novelty: 0 }, 'novelty'], [{ novelty: 6 }, 'novelty'], [{ confidence: 1.2 }, 'confidence'], [{ confidence: 'haute' }, 'confidence'],
  ] as [Record<string, unknown>, string][]) {
    const r = validateAnalysis(mockOutput(over));
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.ok(r.errors.some((e) => e.startsWith(field)), `${field} : ${r.errors.join(' ; ')}`);
  }
});

test('schéma : champs inconnus, manquants, thématique inconnue, motif inconnu refusés', () => {
  assert.equal(validateAnalysis(mockOutput({ extra: 1 })).ok, false);
  const missing = JSON.parse(mockOutput());
  delete missing.summary;
  assert.equal(validateAnalysis(missing).ok, false);
  assert.equal(validateAnalysis(mockOutput({ themes: ['CRYPTO'] })).ok, false);
  assert.equal(validateAnalysis(mockOutput({ exclusionReason: 'low_importance' })).ok, false);
  assert.equal(validateAnalysis(mockOutput({ subthemes: ['n importe quoi !!'] })).ok, false);
  assert.equal(validateAnalysis('{pas du json').ok, false);
});

test('schéma : limites de longueur strictes (rejet, jamais de troncature)', () => {
  assert.equal(validateAnalysis(mockOutput({ summary: 'x'.repeat(1201) })).ok, false);
  assert.equal(validateAnalysis(mockOutput({ summary: 'Résumé.', keyPoints: ['a', 'b', 'c', 'd', 'e', 'f'] })).ok, false);
  assert.equal(validateAnalysis(mockOutput({ summary: 'Résumé.', keyPoints: ['x'.repeat(241)] })).ok, false);
  assert.equal(validateAnalysis(mockOutput({ themes: ['AI', 'ANGULAR', 'AI_AGENTS', 'DIGITAL_INNOVATION', 'AI'] })).ok, false);
});

test('schéma : keyPoints interdits quand summary est null ; thèmes vides seulement avec un motif d’exclusion', () => {
  assert.equal(validateAnalysis(mockOutput({ summary: null, keyPoints: ['point'] })).ok, false);
  assert.equal(validateAnalysis(mockOutput({ themes: [], exclusionReason: null })).ok, false);
  assert.equal(validateAnalysis(mockOutput({ themes: [], exclusionReason: 'funding_only' })).ok, true);
});

test('schéma : sentinelles fournisseur ("" et "none") converties en null', () => {
  const r = validateAnalysis(mockOutput({ summary: '', keyPoints: [], exclusionReason: 'none' }));
  assert.equal(r.ok, true, r.errors.join(' ; '));
  assert.equal(r.value!.summary, null);
  assert.equal(r.value!.exclusionReason, null);
});

test('schéma JSON fournisseur : additionalProperties:false, tous les champs requis, aucune contrainte numérique', () => {
  assert.equal(ANALYSIS_JSON_SCHEMA.additionalProperties, false);
  assert.deepEqual([...ANALYSIS_JSON_SCHEMA.required].sort(), Object.keys(ANALYSIS_JSON_SCHEMA.properties).sort());
  const s = JSON.stringify(ANALYSIS_JSON_SCHEMA);
  for (const k of ['minimum', 'maximum', 'minLength', 'maxLength', 'multipleOf']) assert.ok(!s.includes(`"${k}"`), k);
});

// ------------------------------------------------------------------ politiques de droits
test('politiques : configuration valide ; aucune politique permissive sans vérification documentée', () => {
  assert.deepEqual(validatePolicies(), []);
  assert.equal(validatePolicies([{ sourceId: 'x', policy: 'full-allowed', termsStatus: 'non vérifié', technicalSignals: [], rationale: '' }]).length, 2);
  assert.equal(validatePolicies([{ sourceId: 'x', policy: 'excerpt-only', termsStatus: 'non vérifié', technicalSignals: [], rationale: '' }]).length, 2);
  assert.equal(validatePolicies([{ sourceId: 'x', policy: 'metadata-only', termsStatus: 'non vérifié', technicalSignals: [], rationale: '' }, { sourceId: 'x', policy: 'blocked', termsStatus: 'non vérifié', technicalSignals: [], rationale: '' }]).length, 1, 'doublon refusé');
});

test('politiques : exactement les 17 sources réelles, toutes en metadata-only, aucune source synthétique', () => {
  assert.equal(CONTENT_POLICIES.length, 17);
  assert.ok(CONTENT_POLICIES.every((p) => p.policy === 'metadata-only' && p.termsStatus === 'non vérifié'));
  for (const id of ['angular-blog', 'mit-tech-review', 'ieee-robotics']) {
    assert.ok(policyFor(id).technicalSignals.some((s) => s.includes('robots')), `${id} : signal robots.txt documenté`);
  }
});

test('politiques : source inconnue → metadata-only par défaut', () => {
  assert.equal(policyFor('source-inconnue').policy, 'metadata-only');
  assert.equal(resolveInput(pub()).mode, 'metadata');
});

test('politique × niveau : indépendants, le plus restrictif l’emporte', () => {
  const full = pub({ contentLevel: 'FULL' });
  assert.equal(resolveInput(full, 'full-allowed').mode, 'full');
  assert.equal(resolveInput(full, 'excerpt-only').mode, 'excerpt');
  assert.equal(resolveInput(full, 'metadata-only').mode, 'metadata');
  assert.equal(resolveInput(full, 'blocked').mode, 'none');
  assert.equal(resolveInput(pub({ contentLevel: 'PARTIAL' }), 'full-allowed').mode, 'excerpt');
  assert.equal(resolveInput(pub({ contentLevel: 'MINIMAL' }), 'full-allowed').mode, 'metadata');
  assert.equal(resolveInput(pub({ text: null }), 'full-allowed').mode, 'metadata');
});

test('politique : metadata-only et MINIMAL ne transmettent aucun texte et interdisent le résumé ; extrait borné', () => {
  for (const r of [resolveInput(pub(), 'metadata-only'), resolveInput(pub({ contentLevel: 'MINIMAL' }), 'full-allowed')]) {
    assert.equal(r.text, null);
    assert.equal(r.summaryAllowed, false);
  }
  const ex = resolveInput(pub(), 'excerpt-only');
  assert.ok(ex.text!.length <= 400);
  assert.equal(ex.summaryLimitedToExcerpt, true);
  assert.ok(resolveInput(pub({ text: 'y'.repeat(9000) }), 'full-allowed').text!.length <= 6000);
});

test('politique : une source réelle n’envoie que des métadonnées, même si du texte est présent localement', () => {
  const r = resolveInput(pub({ synthetic: false, sourceId: 'mit-tech-review', text: 'Texte intégral hypothétique présent localement.' }));
  assert.equal(r.mode, 'metadata');
  assert.equal(r.text, null);
});
