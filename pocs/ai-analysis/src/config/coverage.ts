/**
 * Couverture obligatoire : indépendante de la pertinence et de la nouveauté calculées par l'IA.
 *
 * `mandatory` : canaux officiels des technologies prioritaires (Angular, TypeScript, MCP, frameworks
 *   agentiques suivis, Claude Code). Leurs publications restent TOUJOURS visibles (au minimum dans
 *   « Mises à jour »), même avec une pertinence moyenne, une nouveauté faible, une exclusion proposée
 *   par le modèle ou une analyse impossible (budget, erreur fournisseur).
 * `selective` : toutes les autres sources ; leur visibilité dépend de l'analyse.
 *
 * La couverture obligatoire ne neutralise PAS :
 * - les politiques de contenu (une source bloquée n'est jamais envoyée à une IA) ;
 * - les règles éditoriales déterministes explicitement justifiées (src/editorial-rules.ts du POC 1) ;
 * - l'exclusion pour doublon avéré (`duplicate`).
 * Elle est déterminée par la SOURCE, jamais par les thématiques renvoyées par le modèle.
 */
export type CoveragePolicy = 'mandatory' | 'selective';

export const MANDATORY_COVERAGE_SOURCES: Record<string, string> = {
  'angular-blog': 'Blog officiel Angular',
  'gh-angular': 'Releases angular/angular',
  'gh-angular-components': 'Releases angular/components',
  'typescript-blog': 'Annonces officielles TypeScript',
  'gh-openai-agents': 'Releases OpenAI Agents SDK (framework agentique suivi)',
  'gh-langgraph': 'Releases LangGraph (framework agentique suivi)',
  'gh-mcp-ts-sdk': 'Releases MCP TypeScript SDK',
  'gh-claude-code': 'Releases Claude Code (outil de développement assisté par IA)',
};

export function coverageFor(sourceId: string): CoveragePolicy {
  return sourceId in MANDATORY_COVERAGE_SOURCES ? 'mandatory' : 'selective';
}
