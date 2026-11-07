/**
 * Activation LOCALE, TEMPORAIRE et À USAGE UNIQUE des appels réels (remplace toute activation permanente).
 *
 * 1. `npm run poc2:authorize -- --phase=B1 --models=… --max-eur=… --confirm="AUTORISER B1 <montant> EUR"`
 *    écrit `var/real-call-grant.json` (ignoré par Git, droits 600), valable 15 minutes.
 * 2. `evaluate:real --real` CONSOMME l'autorisation (renommage atomique : un seul processus peut l'obtenir),
 *    vérifie qu'elle correspond exactement à la commande, puis crée une activation EN MÉMOIRE.
 * 3. L'activation meurt avec le processus : rien ne persiste après l'exécution.
 * Les adaptateurs n'acceptent qu'une activation créée par ce module (impossible à fabriquer à la main).
 */
import { mkdir, readFile, rename, writeFile, open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { POC_PHASES, type PocPhase, type PocPhaseQuotas } from '../config/quotas.js';
import { CANDIDATE_MODEL_KEYS } from '../config/models.js';

export const GRANT_TTL_MS = 15 * 60_000;
/**
 * Durée maximale d'une exécution avec une activation donnée, PAR PHASE (jamais permanente, toujours en mémoire).
 * B.1 : 2 appels → 30 minutes. B.2 : 90 minutes. Depuis l'incident 429, une requête OpenAI part au moins 75 s
 * après la fin de la précédente : la reprise (69 appels) est estimée à environ 52 minutes en régime typique.
 * L'exécution est refusée avant tout appel si la durée typique, marge de 25 % comprise, dépasse la validité.
 * Une activation expirée en cours d'exécution fait refuser les appels suivants AVANT envoi (sûr, mais incomplet).
 */
export const ACTIVATION_TTL_MS_BY_PHASE: Readonly<Record<PocPhase, number>> = Object.freeze({ B1: 30 * 60_000, B2: 90 * 60_000, B3: 45 * 60_000 });
/** Plafond absolu, toutes phases confondues. */
export const ACTIVATION_TTL_MAX_MS = 90 * 60_000;
/** @deprecated conservé pour compatibilité : durée B.1. */
export const ACTIVATION_TTL_MS = ACTIVATION_TTL_MS_BY_PHASE.B1;

export interface RealCallGrant {
  version: 1;
  phase: PocPhase;
  models: string[];
  maxEur: number;
  createdAt: string;
  expiresAt: string;
  nonce: string;
}

export class ActivationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActivationError';
  }
}

const issued = new WeakSet<object>();

/** Activation en mémoire. Ne peut être créée que par consumeGrant() (marque privée). */
export class RealCallActivation {
  private constructor(
    readonly phase: PocPhase,
    readonly models: readonly string[],
    readonly maxEur: number,
    readonly nonce: string,
    readonly validUntil: number,
  ) {
    Object.freeze(this);
  }
  /** @internal */
  static issue(g: RealCallGrant, now: number): RealCallActivation {
    const ttl = Math.min(ACTIVATION_TTL_MS_BY_PHASE[g.phase] ?? ACTIVATION_TTL_MS_BY_PHASE.B1, ACTIVATION_TTL_MAX_MS);
    const a = new RealCallActivation(g.phase, Object.freeze([...g.models]), g.maxEur, g.nonce, now + ttl);
    issued.add(a);
    return a;
  }
}

/** Vérifie qu'une activation est authentique, non expirée et couvre le modèle. */
export function activationAllows(a: unknown, modelKey: string, now = Date.now()): string | null {
  if (!a || typeof a !== 'object' || !issued.has(a)) return 'Aucune activation valide (autorisation locale à usage unique requise)';
  const act = a as RealCallActivation;
  if (now > act.validUntil) return 'Activation expirée';
  if (!act.models.includes(modelKey)) return `Activation non valable pour ${modelKey}`;
  return null;
}

export const confirmationPhrase = (phase: PocPhase, maxEur: number) => `AUTORISER ${phase} ${maxEur} EUR`;
const grantPath = (dir: string) => `${dir}real-call-grant.json`;

export async function createGrant(
  p: { phase: PocPhase; models: string[]; maxEur: number; confirm: string },
  dir: string,
  now = new Date(),
  /** Table des phases : configuration versionnée par défaut (toutes fermées) ; injectable uniquement par code (tests). */
  phases: Readonly<Record<PocPhase, Readonly<PocPhaseQuotas>>> = POC_PHASES,
): Promise<RealCallGrant> {
  if (!(p.phase in phases)) throw new ActivationError(`Phase inconnue : ${p.phase}`);
  if (!phases[p.phase].active) throw new ActivationError(`Phase ${p.phase} inactive : aucune autorisation ne peut être créée avant son activation explicite`);
  if (!p.models.length || p.models.some((m) => !CANDIDATE_MODEL_KEYS.includes(m))) throw new ActivationError('Modèles non candidats');
  if (!(p.maxEur > 0 && p.maxEur <= 0.5)) throw new ActivationError('Montant maximal hors bornes (> 0 et ≤ 0,50 €)');
  if (p.confirm !== confirmationPhrase(p.phase, p.maxEur)) throw new ActivationError(`Confirmation incorrecte : tapez exactement « ${confirmationPhrase(p.phase, p.maxEur)} »`);
  await mkdir(dir, { recursive: true });
  const g: RealCallGrant = { version: 1, phase: p.phase, models: [...p.models], maxEur: p.maxEur, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + GRANT_TTL_MS).toISOString(), nonce: randomUUID() };
  // 'wx' : échoue si une autorisation existe déjà (pas d'écrasement silencieux).
  let fh;
  try {
    fh = await open(grantPath(dir), 'wx', 0o600);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new ActivationError('Une autorisation existe déjà (var/real-call-grant.json) : utilisez-la ou supprimez-la');
    throw e;
  }
  await fh.writeFile(JSON.stringify(g, null, 2));
  await fh.close();
  return g;
}

/** Lecture sans consommation (affichage des prérequis). */
export async function peekGrant(dir: string): Promise<RealCallGrant | null> {
  try {
    return JSON.parse(await readFile(grantPath(dir), 'utf8')) as RealCallGrant;
  } catch {
    return null;
  }
}

export function grantMismatch(g: RealCallGrant | null, expected: { phase: PocPhase; models: string[]; maxEur: number }, now = new Date()): string | null {
  if (!g) return 'Aucune autorisation locale (npm run poc2:authorize …)';
  if (g.version !== 1) return 'Autorisation de version inconnue';
  if (now.getTime() > Date.parse(g.expiresAt)) return `Autorisation expirée (${g.expiresAt})`;
  if (g.phase !== expected.phase) return `Autorisation délivrée pour la phase ${g.phase}, pas ${expected.phase}`;
  if (expected.models.some((m) => !g.models.includes(m))) return `Modèles non couverts par l’autorisation (${g.models.join(', ')})`;
  if (expected.maxEur > g.maxEur) return `Montant demandé ${expected.maxEur} € > montant autorisé ${g.maxEur} €`;
  return null;
}

/**
 * Consomme l'autorisation : renommage atomique (un seul processus réussit), puis vérification.
 * Une autorisation consommée ne peut jamais être réutilisée, même si la vérification échoue.
 */
export async function consumeGrant(dir: string, expected: { phase: PocPhase; models: string[]; maxEur: number }, now = new Date()): Promise<RealCallActivation> {
  await mkdir(`${dir}grants/`, { recursive: true });
  const used = `${dir}grants/consumed-${now.getTime()}-${randomUUID()}.json`;
  try {
    await rename(grantPath(dir), used);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new ActivationError('Aucune autorisation locale disponible (déjà consommée ?)');
    throw e;
  }
  const g = JSON.parse(await readFile(used, 'utf8')) as RealCallGrant;
  const why = grantMismatch(g, expected, now);
  await writeFile(used, JSON.stringify({ ...g, consumedAt: now.toISOString(), rejected: why }, null, 2));
  if (why) throw new ActivationError(`Autorisation refusée (et détruite) : ${why}`);
  return RealCallActivation.issue(g, now.getTime());
}
