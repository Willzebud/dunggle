/**
 * Utilitaires d'URL.
 * - L'URL originale (`url`) n'est JAMAIS modifiée : c'est le lien « Lire l'article ».
 * - `dedupKey` est une forme normalisée utilisée uniquement pour la déduplication.
 */

/** Paramètres de suivi supprimés pour la déduplication. */
const TRACKING_PARAMS: { name: RegExp; value?: RegExp; why: string }[] = [
  { name: /^utm_/i, why: 'campagnes (utm_*)' },
  { name: /^(fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|mkt_tok|ref_src)$/i, why: 'identifiants de clic / emailing' },
  // Medium (blog.angular.dev) ajoute ?source=rss----<id>---4 aux liens du flux
  { name: /^source$/i, value: /^rss/i, why: 'source=rss… (Medium)' },
];

export function isValidHttpUrl(u: string | null | undefined): u is string {
  if (!u) return false;
  try {
    const p = new URL(u);
    return (p.protocol === 'https:' || p.protocol === 'http:') && !!p.hostname;
  } catch {
    return false;
  }
}

/** Clé de déduplication : hôte en minuscules, sans www, sans fragment, sans paramètres de suivi, sans slash final. */
export function dedupKey(u: string): { key: string; removed: string[] } {
  const p = new URL(u);
  const removed: string[] = [];
  for (const [k, v] of [...p.searchParams.entries()]) {
    if (TRACKING_PARAMS.some((t) => t.name.test(k) && (!t.value || t.value.test(v)))) {
      p.searchParams.delete(k);
      removed.push(k);
    }
  }
  p.searchParams.sort();
  p.hash = '';
  const host = p.hostname.toLowerCase().replace(/^www\./, '');
  const path = p.pathname.length > 1 ? p.pathname.replace(/\/+$/, '') : '';
  const qs = p.searchParams.toString();
  return { key: `${host}${path}${qs ? `?${qs}` : ''}`, removed };
}

/**
 * Indique si une URL ressemble à une page d'accueil / de liste plutôt qu'à une publication :
 * chemin vide, ou identique au chemin de la page de liste de la source (ex. /blog, /releases).
 */
export function looksLikeHomepage(u: string, listingUrls: string[] = []): boolean {
  const p = new URL(u);
  const path = p.pathname.replace(/\/+$/, '');
  if (path === '') return true;
  return listingUrls.some((l) => {
    try {
      const lp = new URL(l);
      return lp.hostname === p.hostname && lp.pathname.replace(/\/+$/, '') === path;
    } catch {
      return false;
    }
  });
}

/** Compare deux URL en ignorant le schéma, www, le slash final et les paramètres de suivi. */
export function sameResource(a: string, b: string): boolean {
  try {
    return dedupKey(a).key === dedupKey(b).key;
  } catch {
    return false;
  }
}
