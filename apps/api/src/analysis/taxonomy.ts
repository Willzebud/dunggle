/**
 * Taxonomie Dunggle (validée au POC 1.2, copiée à l'identique du POC 2 ; voir docs/backend-design.md § 8).
 */
export const THEMES = ['ANGULAR', 'AI', 'AI_AGENTS', 'DIGITAL_INNOVATION'] as const;
export type Theme = (typeof THEMES)[number];

/** Sous-thématiques connues. La liste est extensible : `other:<libellé>` est accepté puis revu manuellement. */
export const SUBTHEMES = [
  'quantum_computing',
  'robotics',
  'cybersecurity',
  'hardware',
  'software_architecture',
  'ai_models',
  'ai_tools',
  'agent_frameworks',
  'automation',
  'future_of_work',
  'technology_adoption',
  'emerging_products',
  'regulation',
  'typescript',
] as const;
export type Subtheme = (typeof SUBTHEMES)[number] | `other:${string}`;

export const PUBLICATION_TYPES = [
  'release',
  'feature',
  'research',
  'product',
  'breakthrough',
  'technical_analysis',
  'prospective_analysis',
  'security_advisory',
] as const;
export type PublicationType = (typeof PUBLICATION_TYPES)[number];

/** Motifs d'exclusion explicites. Il n'existe pas de motif « contenu inaccessible » ni « faible importance ». */
export const EXCLUSION_REASONS = [
  'funding_only',
  'leadership',
  'acquisition_no_tech',
  'ranking',
  'promotional',
  'rumor',
  'financial_news',
  'opinion_no_analysis',
  'duplicate',
  'off_topic',
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export function isKnownSubtheme(s: string): boolean {
  return (SUBTHEMES as readonly string[]).includes(s) || /^other:[a-z0-9_ -]{2,40}$/i.test(s);
}
