import { CHARS_PER_TOKEN_CONSERVATIVE } from './config/budget.js';
import type { ResolvedInput } from './content-policy.js';
import { ANALYSIS_JSON_SCHEMA } from './schema.js';
import { EXCLUSION_REASONS, PUBLICATION_TYPES, SUBTHEMES, THEMES } from './taxonomy.js';
import type { PublicationInput } from './types.js';

/** Consignes stables (préfixe identique d'une requête à l'autre : compatible avec la mise en cache de prompt). */
export const SYSTEM_PROMPT = `Tu classes des publications pour Dunggle, une veille technologique personnelle.

Priorités maximales : Angular et son écosystème (versions, fonctionnalités, breaking changes, RFC, TypeScript, RxJS, Signals, outils) ; intelligence artificielle (modèles, capacités, recherche appliquée, outils et API, multimodalité, open source) ; agents IA et automatisation (frameworks, MCP, orchestration, agents autonomes, outils de développement assistés par IA, usages concrets).
Priorité sélective : innovations numériques (quantique, robotique, cybersécurité de rupture, architectures, matériel, nouveaux paradigmes logiciels, transformations des métiers liées aux technologies).
Dunggle n'est pas un agrégateur généraliste.

Réponds uniquement par l'objet JSON demandé.
- themes : une ou plusieurs valeurs parmi ${THEMES.join(', ')}.
- subthemes : parmi ${SUBTHEMES.join(', ')}, ou "other:<libellé>".
- type : parmi ${PUBLICATION_TYPES.join(', ')}.
- relevance (0–100) : intérêt PERSONNEL pour ce profil. Une mise à jour Angular mineure peut valoir 80 même si sa nouveauté est faible.
- novelty (1–5) : importance technologique de la nouveauté, évaluée SÉPARÉMENT de la pertinence.
- confidence (0–1) : ta confiance dans la classification ; baisse-la quand seules les métadonnées sont fournies.
- relevanceReason : une phrase en français, fondée uniquement sur les informations fournies.
- summary / keyPoints : en français, UNIQUEMENT à partir du texte fourni. Si aucun texte n'est fourni, summary = null et keyPoints = []. Si le texte est un extrait, ne dépasse pas ce qu'il contient. N'invente aucun fait, chiffre, nom ou date.
- exclusionReason : null, ou un motif parmi ${EXCLUSION_REASONS.join(', ')}. N'exclus jamais une publication parce que son contenu est absent ou que sa nouveauté est faible. Les levées de fonds, résultats financiers, nominations, classements et contenus promotionnels sans nouveauté technique sont exclus.`;

export interface BuiltPrompt {
  system: string;
  user: string;
  inputTokensEstimate: number;
}

export function buildPrompt(pub: PublicationInput, input: ResolvedInput): BuiltPrompt {
  const payload = {
    publication: {
      title: pub.title,
      source: pub.sourceName,
      publishedAt: pub.publishedAt,
      url: pub.url,
      categories: pub.categories ?? [],
      editorialNote: pub.editorial ? `${pub.editorial.action} : ${pub.editorial.reason}` : null,
    },
    contentProvided: input.mode,
    summaryAllowed: input.summaryAllowed,
    summaryLimitedToExcerpt: input.summaryLimitedToExcerpt,
    text: input.text,
  };
  const user = JSON.stringify(payload);
  const chars = SYSTEM_PROMPT.length + user.length + JSON.stringify(ANALYSIS_JSON_SCHEMA).length;
  return { system: SYSTEM_PROMPT, user, inputTokensEstimate: Math.ceil(chars / CHARS_PER_TOKEN_CONSERVATIVE) };
}
