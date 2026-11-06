# POC 1.2 — Taxonomie proposée pour le POC 2

> Spécification conceptuelle. Aucune classification par LLM n'est implémentée à ce stade. Le POC 2 utilisera ces codes comme sortie structurée attendue du modèle.

## 1. Thématiques (`themes`, multi-valuées)

| Code | Périmètre | Priorité |
|---|---|---|
| `ANGULAR` | Angular, TypeScript, RxJS, Signals, CLI, outils de l'écosystème | Maximale |
| `AI` | Modèles, capacités, IA générative, multimodalité, recherche appliquée, open source, API | Maximale |
| `AI_AGENTS` | Frameworks agentiques, MCP et protocoles, orchestration, agents autonomes, outils de développement assistés par IA, automatisation | Maximale |
| `DIGITAL_INNOVATION` | Quantique, robotique, cybersécurité, matériel, nouveaux paradigmes logiciels, produits réellement innovants, transformations du travail et réglementation à impact technique | Sélective |

Une publication peut porter plusieurs thématiques. Exemple : « GPT-6 Cyber » → `AI` + `DIGITAL_INNOVATION/cybersecurity`. La prospective (domaine E) est rattachée à `DIGITAL_INNOVATION` par ses sous-thématiques.

## 2. Sous-thématiques (`subthemes`, liste extensible)

| Code | Libellé | Thématique(s) usuelle(s) |
|---|---|---|
| `quantum_computing` | Informatique quantique | DIGITAL_INNOVATION |
| `robotics` | Robotique | DIGITAL_INNOVATION, AI |
| `cybersecurity` | Cybersécurité | DIGITAL_INNOVATION |
| `hardware` | Matériel, semi-conducteurs | DIGITAL_INNOVATION |
| `software_architecture` | Architecture et paradigmes logiciels | ANGULAR, DIGITAL_INNOVATION |
| `ai_models` | Modèles d'IA | AI |
| `ai_tools` | Outils et API d'IA | AI, AI_AGENTS |
| `agent_frameworks` | Frameworks agentiques, MCP | AI_AGENTS |
| `automation` | Automatisation | AI_AGENTS |
| `future_of_work` | Futur du travail | DIGITAL_INNOVATION, AI_AGENTS |
| `technology_adoption` | Adoption et usages | DIGITAL_INNOVATION |
| `emerging_products` | Produits émergents | DIGITAL_INNOVATION |
| `regulation` *(proposé)* | Réglementation à impact technique concret | DIGITAL_INNOVATION |
| `typescript` *(proposé)* | TypeScript et le langage | ANGULAR |

Règles d'extension :
- Les codes sont en `snake_case`, stables et jamais réutilisés.
- Un nouveau code est ajouté dans une table de référence, sans migration des données existantes.
- Le modèle peut proposer `other:<libellé>` ; une revue manuelle décide ensuite de la création d'un code.

## 3. Type de publication (`type`, une valeur principale)

| Code | Définition |
|---|---|
| `release` | Nouvelle version d'un outil (majeure, mineure, patch, beta, RC) |
| `feature` | Nouvelle fonctionnalité ou capacité d'un produit existant |
| `research` | Résultat de recherche, article scientifique, benchmark |
| `product` | Nouveau produit ou service |
| `breakthrough` | Avancée marquante (record, première, capacité inédite) |
| `technical_analysis` | Analyse technique approfondie (architecture, retour d'expérience, post-mortem) |
| `prospective_analysis` | Analyse de l'impact sur le travail, l'économie ou la société, avec un lien technologique explicite |
| `security_advisory` | Vulnérabilité, avis de sécurité, recherche offensive |

## 4. Dimensions indépendantes

Ces trois dimensions sont **orthogonales** et ne doivent jamais être combinées en un seul score.

| Dimension | Valeurs | Calculée par | Rôle |
|---|---|---|---|
| `relevance` (pertinence personnelle) | 0–100 | IA (POC 2), à partir du profil Dunggle | Décide si la publication intéresse l'utilisateur |
| `novelty` (importance de la nouveauté) | 1 = mineure … 5 = rupture | IA (POC 2) | Distingue une mise à jour d'une avancée majeure |
| `contentLevel` (disponibilité du contenu) | `FULL` / `PARTIAL` / `MINIMAL` | Déterministe (POC 1.1, `content-level.ts`) | Choisit le traitement (résumé complet, limité ou aucun) |

Exemple : `typescript 7.1 beta` → relevance 90, novelty 2, FULL. Une RC de TypeScript est très pertinente pour Dunggle, même si sa nouveauté est faible.

## 5. Rubrique « Mises à jour »

- **Règle** : les publications `ANGULAR`, `AI` ou `AI_AGENTS` de type `release`, ou de `novelty` ≤ 2, ne sont **jamais exclues** pour faible importance. Elles vont dans la rubrique **« Mises à jour »**, regroupées par outil (ex. « Angular 22.3.0-next.4 → next.5 »).
- Le flux principal du dashboard met en avant `novelty` ≥ 3, ou `relevance` élevée.
- Les pré-versions (`next`, `rc`, `beta`) restent visibles dans « Mises à jour » et sont filtrables.

## 6. Exclusions (motifs explicites, `exclusionReason`)

Une publication ne peut être écartée que pour l'un de ces motifs, jamais pour un contenu inaccessible. Elle est conservée en base avec son motif, ce qui permet de l'auditer.

| Code | Motif |
|---|---|
| `funding_only` | Levée de fonds ou valorisation sans innovation notable |
| `leadership` | Nomination de dirigeant |
| `acquisition_no_tech` | Acquisition sans impact technologique identifiable |
| `ranking` | Classement générique de startups |
| `promotional` | Contenu promotionnel ou témoignage client sans nouveauté concrète |
| `rumor` | Rumeur non vérifiée |
| `financial_news` | Actualité financière générale (résultats, bourse) |
| `opinion_no_analysis` | Opinion sans analyse substantielle |
| `duplicate` | Annonce répétée sans information nouvelle (même `dedupKey` ou même sujet déjà couvert) |
| `off_topic` | Sans lien avec une évolution technologique |

**Critère central** : l'intérêt de l'innovation, pas la notoriété de l'entreprise. Une startup inconnue qui démontre une capacité nouvelle est pertinente, alors qu'une levée record sans technologie nouvelle ne l'est pas.

## 7. Cas ambigus observés (POC 1.2) et règle proposée

| Cas | Exemple réel | Règle proposée |
|---|---|---|
| Politique industrielle avec contenu technique | « The U.S. Just Bet $1 Billion on Quantum Chip Manufacturing » | Retenir si l'article décrit une capacité technique, sinon `financial_news` |
| Contrat ou partenariat | « Toshiba Secures UK Contract to Develop Quantum Networking » | Retenir seulement si une technologie ou un résultat est décrit |
| Témoignage client d'un laboratoire | « Cult.fit builds operational muscle with Codex » | `promotional`, sauf si un usage inédit est documenté |
| Compilation hebdomadaire | « Video Friday », « The Download » | Type `digest` (proposé) : affiché dans « Mises à jour » ou fusionné, jamais résumé comme un article |
| Essai d'analyste sans mot-clé | « The Dot and the Swarm » (Mollick) | Utiliser le contenu complet (FULL) : le titre seul ne suffit pas |

## 8. Esquisse de la sortie attendue du POC 2

```json
{
  "themes": ["AI_AGENTS", "DIGITAL_INNOVATION"],
  "subthemes": ["agent_frameworks", "future_of_work"],
  "type": "prospective_analysis",
  "relevance": 78,
  "novelty": 3,
  "contentLevel": "FULL",
  "section": "main",
  "exclusionReason": null,
  "summary": "… (absent si contentLevel = MINIMAL)"
}
```
