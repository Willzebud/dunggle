/**
 * L'application ne dépend JAMAIS du code expérimental : aucun import ni chemin vers `pocs/`, dans le code comme
 * dans les tests. Les composants validés des POC sont repris par copie (docs/backend-design.md).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME, APP_VERSION } from '../src/version.js';

const root = fileURLToPath(new URL('..', import.meta.url));
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

test('Aucun import ni chemin vers pocs/ dans apps/api (src et tests)', () => {
  const offenders = [...files(join(root, 'src')), ...files(join(root, 'tests'))].filter((f) => {
    const s = readFileSync(f, 'utf8');
    return /from\s+['"][^'"]*pocs\//.test(s) || /import\(\s*['"][^'"]*pocs\//.test(s) || /require\(\s*['"][^'"]*pocs\//.test(s) || /@dunggle\/(ai-analysis|veille-feasibility)/.test(s);
  });
  assert.deepEqual(offenders, []);
});

test('package.json : aucune dépendance vers un workspace de POC', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  assert.ok(!Object.keys(deps).some((d) => d.startsWith('@dunggle/')), JSON.stringify(deps));
  assert.equal(pkg.name, APP_NAME);
  assert.equal(pkg.version, APP_VERSION);
});
