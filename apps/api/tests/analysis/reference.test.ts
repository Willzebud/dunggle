/**
 * Tests de RÉFÉRENCE (correction 5 de la conception) : le prompt, le schéma et la taxonomie validés en B3 sont
 * figés. Les valeurs ci-dessous ont été calculées sur le POC 2 (tag poc-final) ; toute modification de l'un de ces
 * éléments fait échouer ces tests. Une évolution volontaire exige : décision explicite, nouvelle version du prompt,
 * mise à jour de ces valeurs dans le même commit et mention dans docs/backend-design.md § 8.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { forbidNetwork } from '../helpers.js';
import { buildPrompt, PROMPT_VERSION, SYSTEM_PROMPT, FIELD_LIMITS } from '../../src/analysis/prompt.js';
import { ANALYSIS_JSON_SCHEMA, LIMITS } from '../../src/analysis/schema.js';
import { EXCLUSION_REASONS, PUBLICATION_TYPES, SUBTHEMES, THEMES } from '../../src/analysis/taxonomy.js';
import { INPUT_LIMITS, resolveInput } from '../../src/analysis/content-policy.js';
import type { PublicationInput } from '../../src/analysis/types.js';

before(forbidNetwork);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Publication synthétique du jeu B3 (rédigée pour le POC, aucun contenu tiers). */
const TESSALINE: PublicationInput = {
  id: 'b3:tessaline-forms-5', synthetic: true, sourceId: 'b3-synthetic-full', sourceName: 'Tessaline Blog', sourceType: 'feed',
  url: 'https://tessaline.example/blog/tessaline-forms-5',
  title: 'Tessaline Forms 5.0: signal-based forms, async validators and a new migration path',
  publishedAt: '2026-11-04T09:00:00.000Z', contentLevel: 'FULL',
  text: "Tessaline Forms 5.0 is now available on npm. This major release of our form library for Angular rebuilds the form model on top of Angular signals: every control now exposes value, status and errors as read-only signals, and the previous observable streams are kept behind a compatibility flag until version 6.0. Async validators can now be cancelled automatically when the value changes again; in our benchmark of a 200-field form, this reduced redundant HTTP validation calls by 63%. The release also adds typed form arrays, a debounce option per control, and server-side rendering support for error messages. Breaking changes: the FormStateService class is removed (deprecated since 4.2), the minimum supported Angular version is now 21.0, and the default update strategy changes from 'change' to 'blur' for text inputs. An automated migration is provided through ng update and covers the FormStateService removal but not the update strategy change, which must be reviewed manually. Version 4.x will receive security fixes until June 2027. Known limitation: file inputs are not yet supported by the signal model and still use the legacy API.",
};
/** Publication réelle du jeu B3, en métadonnées seules. */
const FRANKLIN: PublicationInput = {
  id: 'openai-news:https://openai.com/index/franklin-templeton', synthetic: false, sourceId: 'openai-news', sourceName: 'OpenAI News', sourceType: 'feed',
  url: 'https://openai.com/index/franklin-templeton', title: 'Franklin Templeton uses OpenAI to support investment research',
  publishedAt: '2026-11-05T00:00:00.000Z', contentLevel: 'PARTIAL',
};

test('Prompt B3 figé : PROMPT_VERSION bc786201b88a, empreintes du prompt système et du schéma', () => {
  assert.equal(PROMPT_VERSION, 'bc786201b88a');
  assert.equal(sha(SYSTEM_PROMPT), '28a4bdcd374886b99f41658ed68ac8b42f05bc4a4a5bf85e207097edbd7ce902');
  assert.equal(sha(JSON.stringify(ANALYSIS_JSON_SCHEMA)), '0ab2669dde586cca5f61708a30531a117a33883a0f07d51ae817730fdf5261c2');
});

test('Limites, taxonomie et bornes d’entrée figées', () => {
  assert.deepEqual({ ...LIMITS }, { maxThemes: 4, maxSubthemes: 6, maxSummaryChars: 1200, maxKeyPoints: 5, maxKeyPointChars: 240, maxReasonChars: 400 });
  assert.deepEqual([...THEMES], ['ANGULAR', 'AI', 'AI_AGENTS', 'DIGITAL_INNOVATION']);
  assert.equal(sha(JSON.stringify([SUBTHEMES, EXCLUSION_REASONS, PUBLICATION_TYPES])), '19c09d37b0626437a2426ea42dd3313e9d34281b6e2994c0d99c96719a608807');
  assert.deepEqual({ ...INPUT_LIMITS }, { fullMaxChars: 6000, excerptMaxChars: 400 });
  assert.deepEqual({ ...FIELD_LIMITS }, { title: 300, source: 100, url: 500, category: 60, categories: 10 });
});

test('Message envoyé au modèle identique au POC pour des publications types (texte intégral, extrait, métadonnées)', () => {
  assert.equal(sha(buildPrompt(TESSALINE, resolveInput(TESSALINE, 'full-allowed')).user), 'd62461c8cf9acd76968b463b8d489eab4139fcd39f48133da8cd98ebeadded03');
  assert.equal(sha(buildPrompt(TESSALINE, resolveInput(TESSALINE, 'excerpt-only')).user), '9ab8804bb560a1474332449237ad25ce7856fdaeb775df950dfac233c5626f7d');
  assert.equal(sha(buildPrompt(FRANKLIN, resolveInput(FRANKLIN)).user), '866dabdac7c0f2ded74f9d970d9ac4064a9c6d4c38dcee881996a1759d6c6f9e');
});
