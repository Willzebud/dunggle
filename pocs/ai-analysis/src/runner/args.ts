import { CANDIDATE_MODEL_KEYS } from '../config/models.js';

export interface RunArgs {
  models: string[];
  mode: 'smoke' | 'full' | 'final';
  /** Vrai par défaut : sans --real, aucun appel n'est possible. */
  dryRun: boolean;
  real: boolean;
  /** Montant maximal que l'utilisateur accepte explicitement pour CETTE exécution (€). */
  confirmMaxEur: number | null;
  /** Peut seulement ABAISSER le plafond d'appels de l'exécution, jamais l'augmenter. */
  maxCalls: number | null;
}

export class ArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArgsError';
  }
}

const ALLOWED = ['--model', '--mode', '--dry-run', '--real', '--confirm-max-eur', '--max-calls'];

/**
 * Analyse STRICTE des arguments : toute option inconnue (ex. --trial-cap, --no-budget, --limit) est
 * refusée. Aucun argument ne permet de relever un plafond budgétaire ni de désactiver le garde.
 */
export function parseArgs(argv: string[]): RunArgs {
  const out: RunArgs = { models: [...CANDIDATE_MODEL_KEYS], mode: 'smoke', dryRun: true, real: false, confirmMaxEur: null, maxCalls: null };
  const seen = new Set<string>();
  let explicitDry = false;
  for (const raw of argv) {
    const [name, value, ...rest] = raw.split('=');
    if (!ALLOWED.includes(name)) throw new ArgsError(`Option inconnue ou interdite : ${name}`);
    if (rest.length) throw new ArgsError(`Valeur invalide : ${raw}`);
    if (seen.has(name)) throw new ArgsError(`Option répétée : ${name}`);
    seen.add(name);
    switch (name) {
      case '--model':
        if (value === 'all') out.models = [...CANDIDATE_MODEL_KEYS];
        else if (value && CANDIDATE_MODEL_KEYS.includes(value)) out.models = [value];
        else throw new ArgsError(`Modèle non candidat : ${value} (autorisés : ${CANDIDATE_MODEL_KEYS.join(', ')}, all)`);
        break;
      case '--mode':
        if (value !== 'smoke' && value !== 'full' && value !== 'final') throw new ArgsError('--mode doit valoir smoke, full ou final');
        out.mode = value;
        break;
      case '--dry-run':
        if (value !== undefined) throw new ArgsError('--dry-run ne prend pas de valeur');
        explicitDry = true;
        break;
      case '--real':
        if (value !== undefined) throw new ArgsError('--real ne prend pas de valeur');
        out.real = true;
        break;
      case '--confirm-max-eur': {
        const n = Number(value);
        if (!value || !Number.isFinite(n) || n <= 0 || n > 0.5) throw new ArgsError('--confirm-max-eur doit être un montant > 0 et ≤ 0,50 € (budget d’essai)');
        out.confirmMaxEur = n;
        break;
      }
      case '--max-calls': {
        const n = Number(value);
        if (!value || !Number.isInteger(n) || n < 1) throw new ArgsError('--max-calls doit être un entier ≥ 1');
        out.maxCalls = n;
        break;
      }
    }
  }
  if (explicitDry && out.real) throw new ArgsError('--dry-run et --real sont incompatibles');
  out.dryRun = !out.real;
  return out;
}
