import { SETTINGS } from './sources.config.js';
import { ATOM_UPDATED_ONLY, DESCRIPTION_IS_CATEGORY } from './collectors/feed.js';
import type { ContentLevelCode } from './content-level.js';
import type { CollectResult, ContentLevel, FeasibilityAnalysis, Recency, SourceConfig, SourceReport, SourceStatus } from './types.js';

const DAY = 86_400_000;

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function isHttpUrl(u: string | null): boolean {
  if (!u) return false;
  try {
    return ['http:', 'https:'].includes(new URL(u).protocol);
  } catch {
    return false;
  }
}

export function analyze(source: SourceConfig, c: CollectResult, robots: SourceReport['robots']): FeasibilityAnalysis {
  const now = Date.now();
  const arts = c.articles;
  const restrictions: string[] = [];

  // --- Accessibilité : au moins une réponse 2xx dans un format exploitable ---
  const okFormat = ['rss', 'atom', 'rdf', 'json'].includes(c.format);
  const accessible = okFormat && c.requests.some((t) => t.status !== null && t.status >= 200 && t.status < 300);

  // --- Exploitabilité : titres et URL valides, identifiants uniques ---
  const wellFormed = arts.filter((a) => a.title.trim() && isHttpUrl(a.url));
  const uniqueIds = new Set(arts.map((a) => a.id)).size === arts.length;
  const exploitable = accessible && arts.length > 0 && wellFormed.length / arts.length >= 0.9 && uniqueIds;
  if (arts.length && !uniqueIds) restrictions.push('Identifiants non uniques');
  const fallbackIds = arts.filter((a) => a.nativeIdOrigin !== 'source').length;
  if (fallbackIds) restrictions.push(`${fallbackIds} publication(s) sans identifiant natif (repli sur URL/titre)`);

  // --- Fiabilité des dates ---
  const datesNotes: string[] = [];
  const dated = arts.filter((a) => a.publishedAt).map((a) => new Date(a.publishedAt!).getTime());
  const missing = arts.length - dated.length;
  const future = dated.filter((t) => t > now + DAY).length;
  const ancient = dated.filter((t) => t < Date.UTC(2005, 0, 1)).length;
  const allIdentical = dated.length > 1 && new Set(dated).size === 1;
  const allJustNow = dated.length > 1 && dated.every((t) => Math.abs(now - t) < 3_600_000);
  if (missing) datesNotes.push(`${missing} publication(s) sans date valide`);
  if (future) datesNotes.push(`${future} date(s) dans le futur`);
  if (ancient) datesNotes.push(`${ancient} date(s) antérieure(s) à 2005`);
  if (allIdentical) datesNotes.push('Toutes les dates sont identiques');
  if (allJustNow) datesNotes.push('Toutes les dates égalent l’heure de collecte (dates générées ?)');
  if (c.warnings.includes(ATOM_UPDATED_ONLY)) datesNotes.push(ATOM_UPDATED_ONLY);
  const datesReliable = arts.length > 0 && missing === 0 && future === 0 && ancient === 0 && !allIdentical && !allJustNow;
  if (datesReliable && datesNotes.length === 0) datesNotes.push('Dates présentes, valides et cohérentes');

  // --- Fraîcheur ---
  const latest = dated.length ? Math.max(...dated) : null;
  const daysSince = latest !== null ? Math.max(0, Math.floor((now - latest) / DAY)) : null;
  const recency: Recency =
    daysSince === null ? 'inconnue' : daysSince <= SETTINGS.activeDays ? 'active' : daysSince <= SETTINGS.lowActivityDays ? 'peu-active' : 'inactive';

  // --- Contenu disponible pour un résumé IA ---
  const medianLen = median(arts.map((a) => a.contentLength));
  const content: ContentLevel =
    medianLen >= SETTINGS.contentSufficientChars ? 'suffisant' : medianLen >= SETTINGS.contentLimitedChars ? 'limité' : 'insuffisant';

  // --- Authentification et limites ---
  let authRequired = c.authRequired;
  let authNotes = 'Aucune authentification requise';
  if (source.type === 'github-releases') {
    const rl = c.requests.find((t) => t.rateLimit)?.rateLimit;
    authNotes = `Non requise. API GitHub : ${rl?.limit ?? '?'} req/h avec la configuration actuelle (${
      SETTINGS.githubToken ? 'avec token' : 'sans token : 60/h par IP, 5000/h avec token'
    }), restant ${rl?.remaining ?? '?'}`;
    restrictions.push('Quota API GitHub (60 req/h sans token)');
  }
  if (authRequired) authNotes = 'Authentification requise (HTTP 401)';

  if (c.requests.some((t) => t.redirected)) restrictions.push('Redirection HTTP (suivie)');
  for (const w of c.warnings) if (w.startsWith('Content-Type non XML')) restrictions.push(w);
  for (const w of c.warnings) if (w.includes('pré-versions')) restrictions.push(w);
  for (const w of c.warnings) if (w === DESCRIPTION_IS_CATEGORY || w.startsWith("Page d'accueil inaccessible")) restrictions.push(w);
  if (robots?.checked && robots.allowed === false) restrictions.push(`robots.txt interdit ce chemin (${robots.note})`);
  const main = c.requests[c.requests.length - 1];
  if (main && main.status === 200 && !main.cacheHeaders.etag && !main.cacheHeaders.lastModified) {
    restrictions.push('Ni ETag ni Last-Modified : pas de requête conditionnelle possible');
  }
  if (c.itemsInFeed > 0 && c.itemsInFeed < SETTINGS.maxArticlesPerSource) {
    restrictions.push(`Le flux ne contient que ${c.itemsInFeed} publication(s)`);
  }
  if (content !== 'suffisant' && arts.length) {
    restrictions.push(`Contenu ${content} (médiane ${medianLen} caractères) : résumé limité au titre/extrait`);
  }

  // --- Mode d'exploitation (POC 1.1) : disponibilité du contenu, sans lien avec la pertinence ---
  const levelDistribution: Record<ContentLevelCode, number> = { FULL: 0, PARTIAL: 0, MINIMAL: 0 };
  for (const a of arts) if (a.contentLevel) levelDistribution[a.contentLevel]++;
  const n = arts.length || 1;
  const exploitationMode: ContentLevelCode =
    levelDistribution.FULL / n >= 0.5 ? 'FULL' : (levelDistribution.FULL + levelDistribution.PARTIAL) / n >= 0.5 ? 'PARTIAL' : 'MINIMAL';

  // --- Recommandation et statut ---
  // POC 1.1 : un contenu absent n'exclut plus une source. Titre + URL + date fiables suffisent
  // pour un fonctionnement en mode MINIMAL ; le niveau de contenu est porté par exploitationMode.
  const recommendedForMvp =
    accessible &&
    exploitable &&
    datesReliable &&
    (recency === 'active' || recency === 'peu-active') &&
    robots?.allowed !== false &&
    !authRequired;

  let status: SourceStatus;
  if (!accessible || !exploitable) status = 'ÉCHEC';
  else if (recommendedForMvp) status = 'OK';
  else status = 'PARTIEL';

  const { perDay, method } = estimateDailyVolume(c);

  return {
    accessible,
    exploitable,
    datesReliable,
    datesNotes,
    recency,
    daysSinceLastPublication: daysSince,
    content,
    medianContentLength: medianLen,
    authRequired,
    authNotes,
    restrictions,
    recommendedForMvp,
    status,
    estimatedPerDay: perDay,
    estimationMethod: method,
    exploitationMode,
    levelDistribution,
  };
}

/**
 * Estimation du nombre de publications par jour à partir des dates observées.
 * - Si le flux contient des publications plus anciennes que la fenêtre de 30 jours,
 *   la fenêtre est entièrement couverte : N(30 j) / 30.
 * - Sinon le flux est tronqué : N / (âge de la plus ancienne publication), approximation.
 */
export function estimateDailyVolume(c: CollectResult): { perDay: number | null; method: string } {
  const now = Date.now();
  const times = c.allDates.filter((d): d is string => !!d).map((d) => new Date(d).getTime()).filter((t) => t <= now + DAY);
  if (times.length === 0) return { perDay: null, method: 'Non calculable (aucune date exploitable)' };
  const windowDays = 30;
  const inWindow = times.filter((t) => now - t <= windowDays * DAY).length;
  if (inWindow < times.length) {
    return {
      perDay: inWindow / windowDays,
      method: `${inWindow} publication(s) sur les ${windowDays} derniers jours (fenêtre couverte par le flux de ${times.length} éléments)`,
    };
  }
  const oldest = Math.min(...times);
  const spanDays = Math.max(1, (now - oldest) / DAY);
  return {
    perDay: times.length / spanDays,
    method: `Flux tronqué : ${times.length} publications en ${spanDays.toFixed(1)} j (approximation, échantillon court)`,
  };
}
