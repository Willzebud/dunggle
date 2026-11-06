import type { SourceConfig } from '../types.js';

/**
 * POC 1.2 — Sources candidates (NON ajoutées à la configuration définitive `sources.config.ts`).
 * Chaque candidat cible une lacune identifiée lors de l'audit des 12 sources existantes.
 */
export interface CandidateSource extends SourceConfig {
  /** Domaines Dunggle visés */
  targets: string[];
  /** Lacune comblée */
  gap: string;
  kind: 'officiel' | 'laboratoire' | 'média spécialisé' | 'média tech' | 'analyste';
}

export const CANDIDATES: CandidateSource[] = [
  {
    id: 'typescript-blog', name: 'TypeScript Blog (Microsoft)', category: 'angular', type: 'feed',
    url: 'https://devblogs.microsoft.com/typescript/feed/', kind: 'officiel',
    targets: ['ANGULAR'], gap: 'TypeScript (priorité A) : aucune source dédiée, alors que les versions TS conditionnent Angular',
  },
  {
    id: 'ieee-spectrum', name: 'IEEE Spectrum', category: 'innovation', type: 'feed',
    url: 'https://spectrum.ieee.org/feeds/feed.rss', kind: 'média spécialisé',
    targets: ['ROBOTICS', 'HARDWARE', 'QUANTUM', 'AI'], gap: 'Robotique, matériel, semi-conducteurs, quantique : aucune couverture hors IA',
  },
  {
    id: 'quanta-magazine', name: 'Quanta Magazine', category: 'innovation', type: 'feed',
    url: 'https://www.quantamagazine.org/feed/', kind: 'média spécialisé',
    targets: ['QUANTUM', 'SOFTWARE', 'AI'], gap: 'Percées en informatique théorique et physique quantique',
  },
  {
    id: 'project-zero', name: 'Google Project Zero', category: 'innovation', type: 'feed-discovery',
    url: 'https://googleprojectzero.blogspot.com/', kind: 'laboratoire',
    targets: ['SECURITY'], gap: 'Cybersécurité : ruptures techniques (recherche de vulnérabilités), aucune source dédiée',
  },
  {
    id: 'mit-tech-review', name: 'MIT Technology Review', category: 'prospective', type: 'feed',
    url: 'https://www.technologyreview.com/feed/', kind: 'média spécialisé',
    targets: ['AI', 'FUTURE_OF_WORK', 'REGULATION', 'QUANTUM', 'ROBOTICS'], gap: 'Prospective : impact de l’IA et des technologies sur le travail et la société',
  },
  {
    id: 'quantum-insider', name: 'The Quantum Insider', category: 'innovation', type: 'feed',
    url: 'https://thequantuminsider.com/feed/', kind: 'média spécialisé',
    targets: ['QUANTUM'], gap: 'Quantique : actualité spécialisée (test du bruit business/financement)',
  },
  {
    id: 'ars-technica', name: 'Ars Technica', category: 'innovation', type: 'feed',
    url: 'https://feeds.arstechnica.com/arstechnica/index', kind: 'média tech',
    targets: ['SECURITY', 'HARDWARE', 'AI', 'EMERGING_PRODUCTS'], gap: 'Nouveaux produits et sécurité grand public (test d’un média tech généraliste)',
  },
  {
    id: 'one-useful-thing', name: 'One Useful Thing (Ethan Mollick)', category: 'prospective', type: 'feed',
    url: 'https://www.oneusefulthing.org/feed', kind: 'analyste',
    targets: ['FUTURE_OF_WORK', 'AI', 'AI_AGENTS'], gap: 'Transformation du travail par l’IA et les agents (analyse de fond)',
  },
];

/** Taille de l'échantillon éditorial par candidat (issu du seul téléchargement du flux). */
export const SAMPLE_SIZE = 30;

/**
 * Candidates recommandées après revue des résultats (renseigné après le premier passage,
 * puis rapports régénérés avec `--offline`). N'affecte PAS `sources.config.ts`.
 */
export const RECOMMENDED_IDS: string[] = ['typescript-blog', 'project-zero', 'one-useful-thing', 'mit-tech-review', 'ieee-robotics'];

/** Variantes testées après revue : flux thématiques IEEE (le flux principal s'est révélé trop bruyant). */
export const CANDIDATE_VARIANTS: CandidateSource[] = [
  {
    id: 'ieee-robotics', name: 'IEEE Spectrum — Robotics', category: 'innovation', type: 'feed',
    url: 'https://spectrum.ieee.org/feeds/topic/robotics.rss', kind: 'média spécialisé',
    targets: ['ROBOTICS'], gap: 'Variante thématique d’IEEE Spectrum : robotique',
  },
  {
    id: 'ieee-semiconductors', name: 'IEEE Spectrum — Semiconductors', category: 'innovation', type: 'feed',
    url: 'https://spectrum.ieee.org/feeds/topic/semiconductors.rss', kind: 'média spécialisé',
    targets: ['HARDWARE'], gap: 'Variante thématique d’IEEE Spectrum : semi-conducteurs / matériel',
  },
];
