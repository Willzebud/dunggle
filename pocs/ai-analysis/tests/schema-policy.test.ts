import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { forbidNetwork, pub } from './helpers.js';
import { validateAnalysis, ANALYSIS_JSON_SCHEMA } from '../src/schema.js';
import { mockOutput } from '../src/adapters/mock.js';
import { resolveInput } from '../src/content-policy.js';
import { CONTENT_POLICIES, policyFor, validatePolicies } from '../src/config/content-policies.js';

before(forbidNetwork);

// ------------------------------------------------------------------ schéma
test('schéma : sortie valide acceptée, y compris multi-thématique', () => {
  const r = validateAnalysis(mockOutput({ themes: ['AI', 'AI_AGENTS', 'DIGITAL_INNOVATION'], subthemes: ['agent_frameworks', 'cybersecurity', 'other:protocoles'] }));
  assert.equal(r.ok, true, r.errors.join(' ; '));
  assert.deepEqual(r.value!.themes, ['AI', 'AI_AGENTS', 'DIGITAL_INNOVATION']);
});

test('schéma : bornes relevance / novelty / confidence vérifiées localement', () => {
  for (const [over, field] of [
    [{ relevance: 101 }, 'relevance'],
    [{ relevance: -1 }, 'relevance'],
    [{ relevance: 50.5 }, 'relevance'],
    [{ novelty: 0 }, 'novelty'],
    [{ novelty: 6 }, 'novelty'],
    [{ confidence: 1.2 }, 'confidence'],
    [{ confidence: 'haute' }, 'confidence'],
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

test('schéma : keyPoints interdits quand summary est null ; thèmes vides seulement avec un motif d’exclusion', () => {
  assert.equal(validateAnalysis(mockOutput({ summary: null, keyPoints: ['point'] })).ok, false);
  assert.equal(validateAnalysis(mockOutput({ themes: [], exclusionReason: null })).ok, false);
  assert.equal(validateAnalysis(mockOutput({ themes: [], exclusionReason: 'funding_only' })).ok, true);
});

test('schéma JSON fournisseur : additionalProperties:false, tous les champs requis, aucune contrainte numérique', () => {
  assert.equal(ANALYSIS_JSON_SCHEMA.additionalProperties, false);
  assert.deepEqual([...ANALYSIS_JSON_SCHEMA.required].sort(), Object.keys(ANALYSIS_JSON_SCHEMA.properties).sort());
  const s = JSON.stringify(ANALYSIS_JSON_SCHEMA);
  for (const k of ['minimum', 'maximum', 'minLength', 'maxLength', 'multipleOf']) assert.ok(!s.includes(`"${k}"`), k);
});

// ------------------------------------------------------------------ politiques
test('politiques : configuration valide, aucune politique permissive sans vérification', () => {
  assert.deepEqual(validatePolicies(), []);
  assert.deepEqual(validatePolicies([{ sourceId: 'x', policy: 'full-allowed', termsStatus: 'non vérifié', technicalSignals: [], rationale: '' }]).length, 2);
});

test('politiques : les 17 sources réelles sont en metadata-only (aucune autorisation vérifiée)', () => {
  const real = CONTENT_POLICIES.filter((p) => !p.sourceId.startsWith('synthetic'));
  assert.equal(real.length, 17);
  assert.ok(real.every((p) => p.policy === 'metadata-only'));
  for (const id of ['angular-blog', 'mit-tech-review', 'ieee-robotics']) {
    assert.ok(policyFor(id).technicalSignals.some((s) => s.includes('robots')), `${id} : signal robots.txt documenté`);
  }
});

test('politiques : source inconnue → metadata-only par défaut', () => {
  assert.equal(policyFor('source-inconnue').policy, 'metadata-only');
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

test('politique : metadata-only et MINIMAL ne transmettent aucun texte et interdisent le résumé', () => {
  for (const r of [resolveInput(pub(), 'metadata-only'), resolveInput(pub({ contentLevel: 'MINIMAL' }), 'full-allowed')]) {
    assert.equal(r.text, null);
    assert.equal(r.summaryAllowed, false);
  }
  const ex = resolveInput(pub(), 'excerpt-only');
  assert.ok(ex.text!.length <= 400);
  assert.equal(ex.summaryLimitedToExcerpt, true);
});

test('politique : une publication réelle (sans texte versionné) n’envoie que des métadonnées', () => {
  const real = pub({ synthetic: false, sourceId: 'mit-tech-review', text: 'Texte intégral hypothétique présent localement.' });
  const r = resolveInput(real);
  assert.equal(r.mode, 'metadata');
  assert.equal(r.text, null);
});
