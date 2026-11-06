/**
 * Chargement local des clés API depuis `pocs/ai-analysis/.env` (non versionné), sans dépendance externe.
 *
 * Garanties :
 * - seules les variables de la liste blanche sont lues (les autres lignes sont ignorées) ;
 * - une variable déjà définie dans l'environnement du shell n'est jamais écrasée ;
 * - le fichier est refusé s'il est lisible par d'autres utilisateurs (droits attendus : 600) ;
 * - le fichier est refusé s'il n'est pas ignoré par Git (ou s'il est suivi) ;
 * - aucun message (succès, avertissement, erreur) ne contient une valeur : seulement des noms et des numéros de ligne.
 */
import { readFileSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';

export const ENV_FILE_ALLOWED_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'] as const;

export class EnvFileError extends Error {}

export interface EnvLoadResult {
  /** Le fichier existe et a été lu. */
  found: boolean;
  /** Variables chargées depuis le fichier. */
  loaded: string[];
  /** Variables déjà présentes dans l'environnement du shell (prioritaires, non écrasées). */
  keptFromShell: string[];
  /** Lignes ignorées (noms hors liste blanche ou lignes mal formées), sans valeur. */
  ignored: string[];
}

export interface EnvLoadOptions {
  env?: NodeJS.ProcessEnv;
  /** Vérifie que le fichier est ignoré par Git. Retourne true/false, ou null si Git est indisponible. */
  gitIgnored?: (path: string) => boolean | null;
}

export function defaultGitIgnored(path: string): boolean | null {
  const r = spawnSync('git', ['check-ignore', '-q', path], { cwd: dirname(path), stdio: 'ignore' });
  if (r.error || (r.status !== 0 && r.status !== 1)) return null; // pas un dépôt Git, ou Git absent
  return r.status === 0; // 0 : ignoré ; 1 : non ignoré (y compris s'il est suivi)
}

/** Analyse le contenu sans jamais renvoyer une valeur dans une erreur. */
export function parseEnvFile(content: string): { values: Map<string, string>; ignored: string[] } {
  const values = new Map<string, string>();
  const ignored: string[] = [];
  content.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m) {
      ignored.push(`ligne ${i + 1} (mal formée)`);
      return;
    }
    const [, name, rest] = m;
    if (!(ENV_FILE_ALLOWED_KEYS as readonly string[]).includes(name)) {
      ignored.push(`${name} (hors liste blanche)`);
      return;
    }
    let v = rest.trim();
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, ''); // commentaire en fin de ligne (hors guillemets)
    if (/\s/.test(v)) throw new EnvFileError(`${name} (ligne ${i + 1}) contient un espace : valeur probablement mal copiée`);
    if (v) values.set(name, v);
  });
  return { values, ignored };
}

export function loadLocalEnv(path: string, opts: EnvLoadOptions = {}): EnvLoadResult {
  const env = opts.env ?? process.env;
  const result: EnvLoadResult = { found: false, loaded: [], keptFromShell: [], ignored: [] };
  if (!existsSync(path)) return result;
  if (process.platform !== 'win32' && (statSync(path).mode & 0o077) !== 0) {
    throw new EnvFileError(`${path} est lisible par d’autres utilisateurs : exécuter « chmod 600 ${path} »`);
  }
  const ignoredByGit = (opts.gitIgnored ?? defaultGitIgnored)(path);
  if (ignoredByGit === false) throw new EnvFileError(`${path} n’est pas ignoré par Git (ou est suivi) : chargement refusé`);
  const { values, ignored } = parseEnvFile(readFileSync(path, 'utf8'));
  result.found = true;
  result.ignored = ignored;
  for (const [name, value] of values) {
    if (typeof env[name] === 'string' && env[name]!.trim()) {
      result.keptFromShell.push(name);
      continue;
    }
    env[name] = value;
    result.loaded.push(name);
  }
  return result;
}
