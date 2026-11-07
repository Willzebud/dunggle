import { policyFor } from '../config/content-policies.js';
import type { ContentLevel, ContentPolicy, InputMode, PublicationInput } from './types.js';

/** Plafonds de texte transmis au modèle (le budget borne aussi les tokens par requête). */
export const INPUT_LIMITS = {
  fullMaxChars: 6000,
  excerptMaxChars: 400,
};

export interface ResolvedInput {
  policy: ContentPolicy;
  mode: InputMode;
  /** Texte réellement transmis (null en metadata / none). */
  text: string | null;
  summaryAllowed: boolean;
  /** Indique au modèle que le résumé doit rester strictement limité à l'extrait. */
  summaryLimitedToExcerpt: boolean;
  reason: string;
}

/**
 * Croise DEUX dimensions indépendantes :
 * - le niveau de contenu disponible (FULL / PARTIAL / MINIMAL, mesuré au POC 1.1) ;
 * - la politique de réutilisation de la source (ce qui PEUT être envoyé).
 * Le mode retenu est le plus restrictif des deux.
 */
export function resolveInput(pub: PublicationInput, policyOverride?: ContentPolicy): ResolvedInput {
  const policy = policyOverride ?? policyFor(pub.sourceId).policy;
  const text = (pub.text ?? '').replace(/\s+/g, ' ').trim();
  const level: ContentLevel = pub.contentLevel;

  if (policy === 'blocked') {
    return { policy, mode: 'none', text: null, summaryAllowed: false, summaryLimitedToExcerpt: false, reason: 'Source bloquée : aucun appel externe' };
  }
  if (policy === 'metadata-only' || level === 'MINIMAL' || !text) {
    const why = policy === 'metadata-only' ? 'Politique metadata-only' : level === 'MINIMAL' ? 'Contenu MINIMAL' : 'Aucun texte disponible localement';
    return { policy, mode: 'metadata', text: null, summaryAllowed: false, summaryLimitedToExcerpt: false, reason: `${why} : titre et métadonnées uniquement, aucun résumé` };
  }
  if (policy === 'excerpt-only' || level === 'PARTIAL') {
    return {
      policy, mode: 'excerpt', text: truncate(text, INPUT_LIMITS.excerptMaxChars), summaryAllowed: true, summaryLimitedToExcerpt: true,
      reason: policy === 'excerpt-only' ? 'Politique excerpt-only : extrait borné' : 'Contenu PARTIAL : résumé limité à l’extrait',
    };
  }
  return { policy, mode: 'full', text: truncate(text, INPUT_LIMITS.fullMaxChars), summaryAllowed: true, summaryLimitedToExcerpt: false, reason: 'FULL autorisé : résumé fondé sur le texte' };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}
