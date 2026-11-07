/**
 * Conservation du texte selon la politique de droits de la source (conception, correction 1).
 *
 * Le texte présent dans un flux est lu EN MÉMOIRE uniquement pour mesurer la disponibilité du contenu (longueur,
 * niveau FULL / PARTIAL / MINIMAL). Il n'est conservé, transmis ou utilisé pour une empreinte que si la politique
 * l'autorise, et jamais au-delà des bornes de transmission à l'IA :
 * - full-allowed : description et texte borné (6 000 caractères) ;
 * - excerpt-only : extrait borné (400 caractères), description bornée de même ;
 * - metadata-only, blocked, source inconnue : AUCUN texte ni description.
 * Aucune requête supplémentaire n'est jamais faite pour obtenir du texte (pas d'extraction de page en V1).
 */
import { policyFor } from '../config/content-policies.js';
import { INPUT_LIMITS } from '../analysis/content-policy.js';
import type { ContentPolicy } from '../analysis/types.js';

export function textRetentionLimit(sourceId: string, policy: ContentPolicy = policyFor(sourceId).policy): number {
  const p = policy;
  if (p === 'full-allowed') return INPUT_LIMITS.fullMaxChars;
  if (p === 'excerpt-only') return INPUT_LIMITS.excerptMaxChars;
  return 0;
}

export function retainText(sourceId: string, description: string | null, fullText: string, policy: ContentPolicy = policyFor(sourceId).policy): { description: string | null; text: string | null } {
  const max = textRetentionLimit(sourceId, policy);
  if (max === 0) return { description: null, text: null };
  const bound = (s: string) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);
  return { description: description ? bound(description) : null, text: fullText ? bound(fullText) : null };
}
