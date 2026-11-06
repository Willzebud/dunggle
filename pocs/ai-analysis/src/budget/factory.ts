import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LIMITS, type BudgetLimits } from '../config/budget.js';
import { BudgetGuard, JsonlUsageLogger } from './guard.js';
import { FileBudgetStore } from './store.js';

/** Dossier local ignoré par Git (état budgétaire, journal d'usage, résultats). */
export const VAR_DIR = fileURLToPath(new URL('../../var/', import.meta.url));

export class LedgerIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerIntegrityError';
  }
}

/**
 * Détecte une réinitialisation ou une restauration du registre budgétaire : le journal d'usage est en
 * ajout seul, et chaque réservation y laisse un événement « reserved ». Si le journal compte plus de
 * réservations que le compteur monotone du registre (ou si le registre a disparu), on refuse de continuer.
 * Limite : quelqu'un qui supprime À LA FOIS le registre et le journal n'est pas détecté (voir rapport).
 */
export async function verifyLedgerIntegrity(dir: string): Promise<{ reservedInLog: number; sequence: number | null }> {
  let log = '';
  try {
    log = await readFile(`${dir}usage-log.jsonl`, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const reservedInLog = log.split('\n').filter((l) => l.includes('"event":"reserved"')).length;
  let sequence: number | null = null;
  try {
    const ledger = JSON.parse(await readFile(`${dir}budget-ledger.json`, 'utf8')) as { sequence?: number; reservations?: object };
    sequence = ledger.sequence ?? Object.keys(ledger.reservations ?? {}).length;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new LedgerIntegrityError(`Registre budgétaire illisible : ${(e as Error).message}`);
  }
  if (sequence === null && reservedInLog > 0) {
    throw new LedgerIntegrityError(`Registre budgétaire absent alors que le journal contient ${reservedInLog} réservation(s) : réinitialisation refusée`);
  }
  if (sequence !== null && reservedInLog > sequence) {
    throw new LedgerIntegrityError(`Registre budgétaire en retard sur le journal (${sequence} < ${reservedInLog} réservations) : restauration ou modification suspectée`);
  }
  return { reservedInLog, sequence };
}

/**
 * Garde budgétaire PERSISTANTE à utiliser pour tout appel réel : registre partagé entre processus
 * (verrou fichier), survivant aux redémarrages, vérifié contre le journal en ajout seul.
 */
export async function createPersistentGuard(limits: Readonly<BudgetLimits> = DEFAULT_LIMITS, dir = VAR_DIR): Promise<BudgetGuard> {
  await verifyLedgerIntegrity(dir);
  return new BudgetGuard(new FileBudgetStore(`${dir}budget-ledger.json`), limits, new JsonlUsageLogger(`${dir}usage-log.jsonl`));
}
