import type { ContentPolicy } from '../types.js';

/**
 * Politique de transmission du contenu à une IA externe, par source.
 *
 * Règles :
 * - L'absence de restriction détectée ne vaut PAS autorisation : par défaut, `metadata-only`.
 * - `full-allowed` et `excerpt-only` exigent une vérification documentée (`verification`), sinon la
 *   configuration est refusée par validatePolicies() (et par les tests).
 * - Les signaux techniques (robots.txt visant des robots d'IA) sont consignés séparément des conditions
 *   contractuelles et des droits applicables, qui n'ont été vérifiés pour aucune source (docs/content-reuse.md).
 */
export interface PolicyEntry {
  sourceId: string;
  policy: ContentPolicy;
  /** Signaux techniques mesurés (POC 1.2 / consolidation). Informatifs : ils ne valent ni interdiction ni autorisation. */
  technicalSignals: string[];
  /** Statut des conditions d'utilisation / droits : 'non vérifié' tant qu'aucune revue n'a eu lieu. */
  termsStatus: 'non vérifié' | 'vérifié' | 'sans objet (synthétique)';
  /** Obligatoire pour full-allowed / excerpt-only. */
  verification?: { verifiedBy: string; verifiedAt: string; evidence: string };
  rationale: string;
}

const UNVERIFIED = 'Aucune vérification des conditions d’utilisation ni des droits : politique restrictive par défaut.';

export const CONTENT_POLICIES: PolicyEntry[] = [
  // --- Angular ---
  { sourceId: 'angular-blog', policy: 'metadata-only', termsStatus: 'non vérifié',
    technicalSignals: ['robots.txt (Medium) : exclut GPTBot, ClaudeBot, Applebot-Extended, Bytespider, meta-externalagent, Amazonbot', 'pages article protégées par Cloudflare (403)'],
    rationale: `${UNVERIFIED} Signal explicite d’opposition aux robots d’IA (source à vigilance renforcée).` },
  { sourceId: 'gh-angular', policy: 'metadata-only', termsStatus: 'non vérifié', technicalSignals: ['API officielle GitHub'],
    rationale: `${UNVERIFIED} Notes de release : licence du dépôt et conditions de l’API GitHub à vérifier.` },
  { sourceId: 'gh-angular-components', policy: 'metadata-only', termsStatus: 'non vérifié', technicalSignals: ['API officielle GitHub'],
    rationale: `${UNVERIFIED} Notes de release : licence du dépôt et conditions de l’API GitHub à vérifier.` },
  { sourceId: 'typescript-blog', policy: 'metadata-only', termsStatus: 'non vérifié', technicalSignals: ['aucun robot d’IA exclu dans robots.txt'], rationale: UNVERIFIED },
  // --- IA ---
  { sourceId: 'openai-news', policy: 'metadata-only', termsStatus: 'non vérifié', technicalSignals: ['pages article protégées par Cloudflare (403)'], rationale: UNVERIFIED },
  { sourceId: 'deepmind-blog', policy: 'metadata-only', termsStatus: 'non vérifié', technicalSignals: ['aucun robot d’IA exclu dans robots.txt'], rationale: UNVERIFIED },
  { sourceId: 'huggingface-blog', policy: 'metadata-only', termsStatus: 'non vérifié', technicalSignals: ['aucun robot d’IA exclu dans robots.txt'], rationale: UNVERIFIED },
  { sourceId: 'google-research', policy: 'metadata-only', termsStatus: 'non vérifié', technicalSignals: ['aucun robot d’IA exclu dans robots.txt'], rationale: UNVERIFIED },
  // --- Agents IA ---
  { sourceId: 'simon-willison', policy: 'metadata-only', termsStatus: 'non vérifié', technicalSignals: ['aucun robot d’IA exclu dans robots.txt'], rationale: UNVERIFIED },
  { sourceId: 'gh-openai-agents', policy: 'metadata-only', termsStatus: 'non vérifié', technicalSignals: ['API officielle GitHub'], rationale: UNVERIFIED },
  { sourceId: 'gh-langgraph', policy: 'metadata-only', termsStatus: 'non vérifié', technicalSignals: ['API officielle GitHub'], rationale: UNVERIFIED },
  { sourceId: 'gh-mcp-ts-sdk', policy: 'metadata-only', termsStatus: 'non vérifié', technicalSignals: ['API officielle GitHub'], rationale: UNVERIFIED },
  { sourceId: 'gh-claude-code', policy: 'metadata-only', termsStatus: 'non vérifié', technicalSignals: ['API officielle GitHub'], rationale: UNVERIFIED },
  // --- Sélectives (POC 1.2) ---
  { sourceId: 'project-zero', policy: 'metadata-only', termsStatus: 'non vérifié', technicalSignals: ['pas de robots.txt (404)'], rationale: UNVERIFIED },
  { sourceId: 'one-useful-thing', policy: 'metadata-only', termsStatus: 'non vérifié', technicalSignals: ['aucun robot d’IA exclu dans robots.txt'], rationale: UNVERIFIED },
  { sourceId: 'mit-tech-review', policy: 'metadata-only', termsStatus: 'non vérifié',
    technicalSignals: ['robots.txt : exclut 14 robots d’IA (GPTBot, ChatGPT-User, ClaudeBot, anthropic-ai, CCBot, Google-Extended, PerplexityBot…)', 'texte intégral présent dans le flux'],
    rationale: `${UNVERIFIED} Signal explicite d’opposition aux robots d’IA (source à vigilance renforcée).` },
  { sourceId: 'ieee-robotics', policy: 'metadata-only', termsStatus: 'non vérifié',
    technicalSignals: ['robots.txt : exclut 11 robots d’IA (GPTBot, ClaudeBot, anthropic-ai, CCBot, Google-Extended…)', 'texte intégral présent dans le flux'],
    rationale: `${UNVERIFIED} Signal explicite d’opposition aux robots d’IA (source à vigilance renforcée).` },

  // --- Sources synthétiques (fixtures de test uniquement, jamais présentées comme réelles) ---
  { sourceId: 'synthetic-fixtures', policy: 'full-allowed', termsStatus: 'sans objet (synthétique)', technicalSignals: [],
    verification: { verifiedBy: 'POC 2 Phase A', verifiedAt: '2026-11-06', evidence: 'Textes rédigés pour le POC (fixtures/evaluation-set.json, synthetic: true) ; aucun contenu tiers.' },
    rationale: 'Contenus synthétiques rédigés pour tester les résumés FULL et PARTIAL.' },
  // Test final B3 : contenus rédigés pour le POC, SANS mention de fiction dans le texte transmis (la provenance
  // est conservée dans les champs internes `synthetic` / `provenance`, jamais envoyés aux modèles).
  { sourceId: 'b3-synthetic-full', policy: 'full-allowed', termsStatus: 'sans objet (synthétique)', technicalSignals: [],
    verification: { verifiedBy: 'POC 2 préparation B3', verifiedAt: '2026-11-07', evidence: 'Textes rédigés pour le POC (fixtures/b3/publications.json, synthetic: true) ; organisations et produits inventés ; aucun contenu tiers.' },
    rationale: 'Contenus synthétiques B3 : résumés en texte intégral, exclusion promotionnelle, informations insuffisantes.' },
  { sourceId: 'b3-synthetic-excerpt', policy: 'excerpt-only', termsStatus: 'sans objet (synthétique)', technicalSignals: [],
    verification: { verifiedBy: 'POC 2 préparation B3', verifiedAt: '2026-11-07', evidence: 'Textes rédigés pour le POC (fixtures/b3/publications.json, synthetic: true) ; aucun contenu tiers.' },
    rationale: 'Contenus synthétiques B3 : simule une source dont seule la reprise d’un extrait est autorisée.' },
  { sourceId: 'synthetic-blocked', policy: 'blocked', termsStatus: 'sans objet (synthétique)', technicalSignals: [],
    rationale: 'Source fictive servant à vérifier qu’aucun appel externe n’est fait pour une source bloquée.' },
];

/** Politique appliquée à une source inconnue : la plus restrictive qui conserve la publication. */
export const DEFAULT_POLICY: ContentPolicy = 'metadata-only';

export function policyFor(sourceId: string): PolicyEntry {
  return (
    CONTENT_POLICIES.find((p) => p.sourceId === sourceId) ?? {
      sourceId,
      policy: DEFAULT_POLICY,
      termsStatus: 'non vérifié',
      technicalSignals: [],
      rationale: 'Source absente de la configuration : politique par défaut metadata-only.',
    }
  );
}

/** Refuse toute politique permissive sans vérification documentée. */
export function validatePolicies(entries: PolicyEntry[] = CONTENT_POLICIES): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.sourceId)) errors.push(`${e.sourceId} : politique dupliquée`);
    seen.add(e.sourceId);
    if ((e.policy === 'full-allowed' || e.policy === 'excerpt-only') && !e.verification) {
      errors.push(`${e.sourceId} : ${e.policy} sans vérification documentée`);
    }
    if ((e.policy === 'full-allowed' || e.policy === 'excerpt-only') && e.termsStatus === 'non vérifié') {
      errors.push(`${e.sourceId} : ${e.policy} alors que les conditions sont « non vérifié »`);
    }
  }
  return errors;
}
