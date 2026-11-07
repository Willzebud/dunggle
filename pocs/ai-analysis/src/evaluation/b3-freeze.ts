/**
 * Gel du test final B3 : les publications, la vérité de référence, la règle de décision ET la version du prompt
 * sont figées AVANT tout appel réel. Toute modification change l'empreinte et fait refuser l'exécution B3
 * (simulation comprise), jusqu'à une nouvelle validation explicite (mise à jour relue de B3_FREEZE).
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PROMPT_VERSION } from '../prompt.js';

export const B3_FILES = ['publications.json', 'ground-truth.json', 'decision-rule.json'] as const;

export const B3_FREEZE = Object.freeze({
  /** SHA-256 de la concaténation « nom\ncontenu\n » des trois fichiers, dans l'ordre de B3_FILES. */
  sha256: '37cc22da5653ce5e00aa63994ff62e22d2b731dc6523c41981d85f15e56023fa',
  /** Version du prompt figée avec le jeu (src/prompt.ts). */
  promptVersion: 'bc786201b88a',
  frozenAt: '2026-11-07',
});

export async function b3Sha256(dir: URL = new URL('../../fixtures/b3/', import.meta.url)): Promise<string> {
  const h = createHash('sha256');
  for (const f of B3_FILES) h.update(`${f}\n`).update(await readFile(new URL(f, dir))).update('\n');
  return h.digest('hex');
}

export async function verifyB3Freeze(dir?: URL): Promise<{ ok: boolean; sha256: string; problem: string | null }> {
  const sha256 = await b3Sha256(dir);
  if (sha256 !== B3_FREEZE.sha256) return { ok: false, sha256, problem: `empreinte ${sha256.slice(0, 12)}… ≠ empreinte figée ${B3_FREEZE.sha256.slice(0, 12)}… (fixtures B3 modifiées après le gel)` };
  if (PROMPT_VERSION !== B3_FREEZE.promptVersion) return { ok: false, sha256, problem: `prompt ${PROMPT_VERSION} ≠ prompt figé ${B3_FREEZE.promptVersion}` };
  return { ok: true, sha256, problem: null };
}
