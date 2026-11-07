import type { SourceConfig } from '../collection/types.js';

/**
 * Sources collectées (17), copiées du POC 1 (validées aux POC 1, 1.1 et 1.2).
 * Chaque source DOIT avoir une politique de droits (config/content-policies.ts) ; la couverture obligatoire est
 * fixée dans config/coverage.ts. La cohérence des trois fichiers est vérifiée par les tests.
 */
export const SOURCES: SourceConfig[] = [
  // Angular
  { id: 'angular-blog', name: 'Angular Blog', category: 'angular', type: 'feed-discovery', url: 'https://blog.angular.dev/' },
  { id: 'gh-angular', name: 'GitHub angular/angular', category: 'angular', type: 'github-releases', url: 'https://api.github.com/repos/angular/angular/releases' },
  { id: 'gh-angular-components', name: 'GitHub angular/components', category: 'angular', type: 'github-releases', url: 'https://api.github.com/repos/angular/components/releases' },

  // Intelligence artificielle
  { id: 'openai-news', name: 'OpenAI News', category: 'ia', type: 'feed', url: 'https://openai.com/news/rss.xml' },
  { id: 'deepmind-blog', name: 'Google DeepMind Blog', category: 'ia', type: 'feed', url: 'https://deepmind.google/blog/rss.xml' },
  { id: 'huggingface-blog', name: 'Hugging Face Blog', category: 'ia', type: 'feed', url: 'https://huggingface.co/blog/feed.xml' },
  { id: 'google-research', name: 'Google Research Blog', category: 'ia', type: 'feed', url: 'https://research.google/blog/rss/' },

  // Agents IA
  { id: 'simon-willison', name: 'Simon Willison', category: 'agents', type: 'feed', url: 'https://simonwillison.net/atom/everything/' },
  { id: 'gh-openai-agents', name: 'OpenAI Agents SDK (Python)', category: 'agents', type: 'github-releases', url: 'https://api.github.com/repos/openai/openai-agents-python/releases' },
  { id: 'gh-langgraph', name: 'LangGraph', category: 'agents', type: 'github-releases', url: 'https://api.github.com/repos/langchain-ai/langgraph/releases' },
  { id: 'gh-mcp-ts-sdk', name: 'MCP TypeScript SDK', category: 'agents', type: 'github-releases', url: 'https://api.github.com/repos/modelcontextprotocol/typescript-sdk/releases' },
  { id: 'gh-claude-code', name: 'Claude Code', category: 'agents', type: 'github-releases', url: 'https://api.github.com/repos/anthropics/claude-code/releases' },

  // --- Sources complémentaires validées au POC 1.2 (voir results/poc-1.2/recommendations.md) ---
  { id: 'typescript-blog', name: 'TypeScript Blog (Microsoft)', category: 'angular', type: 'feed', url: 'https://devblogs.microsoft.com/typescript/feed/' },
  // Flux Atom découvert au POC 1.2 (googleprojectzero.blogspot.com redirige vers projectzero.google).
  // Le flux réutilise parfois le même <id> pour deux articles : identification par URL normalisée.
  { id: 'project-zero', name: 'Google Project Zero', category: 'innovation', type: 'feed', url: 'https://projectzero.google/feed.xml', idStrategy: 'normalized-url' },
  { id: 'one-useful-thing', name: 'One Useful Thing (Ethan Mollick)', category: 'prospective', type: 'feed', url: 'https://www.oneusefulthing.org/feed' },
  { id: 'mit-tech-review', name: 'MIT Technology Review', category: 'prospective', type: 'feed', url: 'https://www.technologyreview.com/feed/' },
  { id: 'ieee-robotics', name: 'IEEE Spectrum — Robotics', category: 'innovation', type: 'feed', url: 'https://spectrum.ieee.org/feeds/topic/robotics.rss' },
];

/** Réglages de la collecte : un passage séquentiel et poli, deux cycles par jour. */
export const COLLECTION_SETTINGS = Object.freeze({
  maxArticlesPerSource: 10,
  timeoutMs: 15_000,
  /** Pause minimale entre deux requêtes HTTP (exécution séquentielle). */
  delayBetweenRequestsMs: 750,
  maxBodyBytes: 5 * 1024 * 1024,
  userAgent: process.env.DUNGGLE_USER_AGENT?.trim() || 'Dunggle/0.1 (personal tech watch; low-volume, twice daily; Node.js fetch)',
  githubToken: process.env.GITHUB_TOKEN?.trim() || undefined,
});
