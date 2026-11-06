# POC 1.1 — Extraction de contenu et publications incomplètes

- **Exécution** : 2026-11-06T12:28:19.423Z → 2026-11-06T12:28:36.111Z
- **Méthode** : vérification de robots.txt, puis une requête GET par page autorisée, puis extraction générique avec Mozilla Readability (aucune règle propre à un site). Dates lues dans les métadonnées standard (Open Graph, JSON-LD, <time>).
- **User-Agent** : `VeilleTechPOC/0.1 (feasibility study; low-volume, single-run; Node.js fetch)` ; 750 ms entre requêtes ; aucun appel à un LLM ; aucun contournement.
- Toutes les valeurs proviennent des réponses réelles au moment de l’exécution.

## 1. Extraction : 6 publications testées

| # | Source | Publication (URL originale) | HTTP | robots.txt | Caractères flux → page | Niveau flux → page | Date | Erreurs / restrictions |
|---|---|---|---|---|---|---|---|---|
| 1 | Hugging Face Blog | [Egyptian and Nigerian English join the Open ASR Leaderboard](https://huggingface.co/blog/open-asr-leaderboard-liva) | 200 | ✅ autorisé | 0 → **2021** | MINIMAL → **FULL** | Cohérente avec le flux (écart 0 h) | Aucune |
| 2 | Hugging Face Blog | [New NVIDIA Cosmos 3 Open Models for Interactive World Simulation](https://huggingface.co/blog/nvidia/cosmos-interactive-world-simulation) | 200 | ✅ autorisé | 0 → **9315** | MINIMAL → **FULL** | Cohérente avec le flux (écart 0 h) | Aucune |
| 3 | Hugging Face Blog | [A Closer Look at Phonon TTS. Launching High-Quality On-Device Speech That Tops the Benchmarks.](https://huggingface.co/blog/phonon-tts) | 200 | ✅ autorisé | 0 → **8331** | MINIMAL → **FULL** | Cohérente avec le flux (écart 0 h) | Aucune |
| 4 | Google Research Blog | [Detecting signs of hypertension using wearable sensors](https://research.google/blog/detecting-signs-of-hypertension-using-wearable-sensors/) | 200 | ✅ autorisé | 19 → **8585** | MINIMAL → **FULL** | Date absente de la page (date du flux conservée) | Aucune |
| 5 | Google Research Blog | [Agile Deliberation: How AI helps humans define the gray areas](https://research.google/blog/agile-deliberation-how-ai-helps-humans-define-the-gray-areas/) | 200 | ✅ autorisé | 22 → **10443** | MINIMAL → **FULL** | Date absente de la page (date du flux conservée) | Aucune |
| 6 | Google Research Blog | [The sleep framework: A new way for LLMs to retain knowledge in continual learning](https://research.google/blog/the-sleep-framework-a-new-way-for-llms-to-retain-knowledge-in-continual-learning/) | 200 | ✅ autorisé | 20 → **9384** | MINIMAL → **FULL** | Date absente de la page (date du flux conservée) | Aucune |

**Contrôles de correspondance avec l’article (texte extrait) :**

| # | Titre extrait | Titre conforme au flux | Couverture du titre dans le texte | Similarité max. avec une autre page de la source | Début du texte extrait |
|---|---|---|---|---|---|
| 1 | Egyptian and Nigerian English join the Open ASR Leaderboard | ✅ (100 %) | 100 % | 0 % | « Back to Articles A few months ago, we added private data to the Open ASR Leaderboard: 11 splits from Appen and DataOceanAI covering scripted and conversational … » |
| 2 | New NVIDIA Cosmos 3 Open Models for Interactive World Simulation | ✅ (100 %) | 100 % | 0 % | « TL;DR NVIDIA Cosmos world model development platform adds four new open-weight checkpoints to its Cosmos 3 model family for generating interactive world simulat… » |
| 3 | A Closer Look at Phonon TTS. Launching High-Quality On-Device Speech That Tops the Benchmarks. | ✅ (100 %) | 45 % | 0 % | « Two weeks ago, we opened up Phonon, our small text-to-speech model that runs on your own device. It needs no server and no network, and what you type stays with… » |
| 4 | Detecting signs of hypertension using wearable sensors | ✅ (100 %) | 100 % | 0 % | « Hypertension (i.e., high blood pressure), often called the "silent killer”, affects over one billion people globally, yet more than half of adults with the cond… » |
| 5 | Agile Deliberation: How AI helps humans define the gray areas | ✅ (100 %) | 100 % | 0 % | « Machine learning models learn to recognize the world around us from examples labeled by humans. Underlying this process is an assumption that the person doing t… » |
| 6 | The sleep framework: A new way for LLMs to retain knowledge in continual learning | ✅ (100 %) | 88 % | 0 % | « Modern LLMs achieve impressive performance via pre-training and in-context learning (ICL). However, once deployed, they remain largely static, operating with a … » |

Un texte est rejeté (MINIMAL) s’il est identique à plus de 50 % (5-grammes) à celui d’une autre page de la même source, ce qui indique un contenu générique. Il est aussi rejeté si la correspondance avec l’article n’est pas établie : il faut soit qu’au moins 50 % des mots significatifs du titre figurent dans le texte, soit (règle « titre long ») qu’au moins 4 mots du titre y figurent **et** que le titre de la page corresponde à celui du flux (≥ 60 %).

> **Calibration** : lors d’une première exécution, la règle reposait uniquement sur la couverture du titre (≥ 50 %). L’article Hugging Face « A Closer Look at Phonon TTS… » a alors été classé MINIMAL alors que le texte extrait était bien l’article (titre de page identique, aucune similarité avec les autres pages) : son titre marketing est long et seuls 45 % de ses mots apparaissent dans le texte. La règle « titre long » a été ajoutée pour corriger ce faux négatif. Elle exige toujours que le texte contienne plusieurs mots du titre.

### Comparaison des deux sources

| Source | Pages autorisées / testées | HTTP 200 | Extraction FULL | Médiane caractères extraits | Date dans la page | Signaux d’usage |
|---|---|---|---|---|---|---|
| Hugging Face Blog | 3/3 | 3/3 | 3/3 | 8331 | 3/3 | Aucun |
| Google Research Blog | 3/3 | 3/3 | 3/3 | 9384 | 0/3 | Aucun |

### Recommandation par source

- **Hugging Face Blog** : **Conserver, en mode FULL avec extraction de la page.** 3/3 articles extraits en entier (médiane 8331 caractères). Cela coûte une requête de plus par publication, autorisée par robots.txt. Si l’extraction échoue, la publication repasse en MINIMAL (titre, date et lien fiables). Les conditions d’utilisation du site restent à valider humainement : ce POC ne vérifie que robots.txt et les signaux techniques.
- **Google Research Blog** : **Conserver, en mode FULL avec extraction de la page.** 3/3 articles extraits en entier (médiane 9384 caractères). Cela coûte une requête de plus par publication, autorisée par robots.txt. Si l’extraction échoue, la publication repasse en MINIMAL (titre, date et lien fiables). Les conditions d’utilisation du site restent à valider humainement : ce POC ne vérifie que robots.txt et les signaux techniques.

## 2. Conservation et vérification des URL

**Contrôles sans requête, sur les 120 publications de `articles.json` :**

- URL présentes et valides : **120/120** (HTTPS : 120/120)
- URL pointant vers une page d’accueil ou de liste : **0**
- Doublons détectés après normalisation : **0**
- URL contenant des paramètres de suivi : **10** (angular-blog : source)

Exemple : l’URL de consultation reste intacte, seule la clé de déduplication est nettoyée :

```
url      : https://blog.angular.dev/from-running-edge-rendered-angular-apps-on-cloudflare-workers-to-crafting-lifelike-speech-with-67513b4b85e1?source=rss----447683c3d9a3---4
dedupKey : blog.angular.dev/from-running-edge-rendered-angular-apps-on-cloudflare-workers-to-crafting-lifelike-speech-with-67513b4b85e1
```

**Vérification HTTP réelle (les 6 pages extraites, plus la publication la plus récente de chacune des 10 autres sources) :**

| Source | URL originale | HTTP | Redirection | Verdict du lien | Pointe vers l’article |
|---|---|---|---|---|---|
| Hugging Face Blog | https://huggingface.co/blog/open-asr-leaderboard-liva | 200 | Non | OK | ✅ |
| Hugging Face Blog | https://huggingface.co/blog/nvidia/cosmos-interactive-world-simulation | 200 | Non | OK | ✅ |
| Hugging Face Blog | https://huggingface.co/blog/phonon-tts | 200 | Non | OK | ✅ |
| Google Research Blog | https://research.google/blog/detecting-signs-of-hypertension-using-wearable-sensors/ | 200 | Non | OK | ✅ |
| Google Research Blog | https://research.google/blog/agile-deliberation-how-ai-helps-humans-define-the-gray-areas/ | 200 | Non | OK | ✅ |
| Google Research Blog | https://research.google/blog/the-sleep-framework-a-new-way-for-llms-to-retain-knowledge-in-continual-learning/ | 200 | Non | OK | ✅ |
| Angular Blog | https://blog.angular.dev/from-running-edge-rendered-angular-apps-on-cloudflare-workers-to-crafting-lifelike-speech-with-67513b4b85e1?source=rss----447683c3d9a3---4 | 403 | Non | BLOQUÉ (anti-bot) | ✅ |
| GitHub angular/angular | https://github.com/angular/angular/releases/tag/v22.3.0-next.4 | 200 | Non | OK | ✅ |
| GitHub angular/components | https://github.com/angular/components/releases/tag/v22.3.0-next.5 | 200 | Non | OK | ✅ |
| OpenAI News | https://openai.com/index/cultfit-builds-with-codex | 403 | Non | BLOQUÉ (anti-bot) | ✅ |
| Google DeepMind Blog | https://deepmind.google/blog/gemini-omni-12-flash-fast-and-cost-effective-with-longer-clips/ | 200 | → https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemini-omni-1-2-flash/?utm_source=deepmind.google&utm_medium=referral&utm_campaign=gdm&utm_content= | OK (redirection vers la publication, autre URL) | ✅ |
| Simon Willison | https://simonwillison.net/2026/Nov/5/paul-ford/ | 200 | Non | OK | ✅ |
| OpenAI Agents SDK (Python) | https://github.com/openai/openai-agents-python/releases/tag/v0.24.0-alpha.6 | 200 | Non | OK | ✅ |
| LangGraph | https://github.com/langchain-ai/langgraph/releases/tag/cli%3D%3D0.4.42 | 200 | Non | OK | ✅ |
| MCP TypeScript SDK | https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.4.0 | 200 | Non | OK | ✅ |
| Claude Code | https://github.com/anthropics/claude-code/releases/tag/v2.1.318 | 200 | Non | OK | ✅ |

⚠️ **Liens à signaler** : Angular Blog (BLOQUÉ (anti-bot)) ; OpenAI News (BLOQUÉ (anti-bot)).

Règle retenue : `url` = lien exact fourni par la source, jamais modifié (bouton « Lire l’article »). `dedupKey` = forme normalisée sans `utm_*`, `fbclid`, `gclid`, `source=rss…` (Medium), fragment, `www` ni slash final ; elle sert uniquement à la déduplication. Si une redirection mène vers une autre page ou vers l’accueil, ou si le lien renvoie une erreur 4xx/5xx, il faut le signaler sans le réécrire.

## 3. Classification technique du contenu (FULL / PARTIAL / MINIMAL)

> Cette classification mesure uniquement la **disponibilité** du contenu. Elle ne mesure pas sa **pertinence**, qui sera évaluée par l’IA au POC 2. Une publication MINIMAL peut être très pertinente.

Critères appliqués dans l’ordre (`src/content-level.ts`) :

1. **Qualité** : le texte passe en MINIMAL s’il est vide, s’il ne fait que répéter le titre, s’il se réduit à une étiquette de catégorie ou s’il est générique (identique à d’autres pages). Pour une page extraite, il passe aussi en MINIMAL si la correspondance avec l’article n’est pas établie (couverture du titre ≥ 50 %, ou au moins 4 mots du titre retrouvés avec un titre de page conforme au flux).
2. **FULL** : au moins 1200 caractères **et** au moins 180 mots de texte valide.
3. **PARTIAL** : au moins 60 caractères **et** au moins 8 mots de texte valide.
4. **MINIMAL** : tout le reste (titre, URL et éventuellement date et métadonnées).

Le niveau d’une publication est le meilleur niveau entre le contenu du flux et le contenu extrait de la page.

**Répartition des 120 publications selon le contenu du flux seul, et mode atteignable :**

| Source | FULL | PARTIAL | MINIMAL | Mode via le flux | Page testée | Mode atteignable |
|---|---|---|---|---|---|---|
| Angular Blog | 10 | 0 | 0 | FULL | 1 page : non extraite (BLOQUÉ (anti-bot)) | **FULL** |
| GitHub angular/angular | 7 | 3 | 0 | FULL | lien OK ; contenu fourni par l’API (extraction inutile) | **FULL** |
| GitHub angular/components | 0 | 10 | 0 | PARTIAL | lien OK ; contenu fourni par l’API (extraction inutile) | **PARTIAL** |
| OpenAI News | 0 | 10 | 0 | PARTIAL | 1 page : non extraite (BLOQUÉ (anti-bot)) | **PARTIAL** |
| Google DeepMind Blog | 0 | 6 | 4 | PARTIAL | 1 page : FULL (6660 car., indicatif) | **FULL** (avec extraction) |
| Hugging Face Blog | 0 | 0 | 10 | MINIMAL | 3/3 pages FULL | **FULL** (avec extraction) |
| Google Research Blog | 0 | 0 | 10 | MINIMAL | 3/3 pages FULL | **FULL** (avec extraction) |
| Simon Willison | 3 | 7 | 0 | PARTIAL | 1 page : PARTIAL (682 car., indicatif) | **PARTIAL** |
| OpenAI Agents SDK (Python) | 9 | 1 | 0 | FULL | lien OK ; contenu fourni par l’API (extraction inutile) | **FULL** |
| LangGraph | 0 | 10 | 0 | PARTIAL | lien OK ; contenu fourni par l’API (extraction inutile) | **PARTIAL** |
| MCP TypeScript SDK | 4 | 5 | 1 | PARTIAL | lien OK ; contenu fourni par l’API (extraction inutile) | **PARTIAL** |
| Claude Code | 9 | 0 | 1 | FULL | lien OK ; contenu fourni par l’API (extraction inutile) | **FULL** |

Pour les autres sources, le niveau atteignable avec extraction repose sur **une seule page** : c’est une indication, pas une validation. Pour les dépôts GitHub, le niveau est celui des notes de release fournies par l’API.

## 4. Trois niveaux d’exploitation (comportement cible)

| Niveau | Données disponibles | Traitement futur (POC 2 et suivants) |
|---|---|---|
| **FULL** (complet) | Titre, URL originale, date, contenu détaillé | Analyse de pertinence par IA, classification thématique, résumé, points clés |
| **PARTIAL** (partiel) | Titre, URL originale, date, extrait court | Classification thématique, estimation de pertinence, résumé **strictement limité** à l’extrait |
| **MINIMAL** | Titre, URL originale, éventuellement date et métadonnées | Pertinence estimée sur le titre et les métadonnées uniquement, **aucun résumé**, conservation si la pertinence est suffisante |

**Règle fondamentale** : une publication n’est **jamais** exclue parce que son contenu est inaccessible. Elle ne peut être exclue que si elle est manifestement hors sujet, ce qui relève de la pertinence et non de la disponibilité. Le niveau de contenu sert à choisir le traitement, pas à filtrer.

Garde-fous contre le contenu fictif, à reprendre au POC 2 :
- Le prompt reçoit le niveau (`contentLevel`) et l’instruction de n’utiliser que le texte fourni.
- En MINIMAL, aucun champ « résumé » n’est demandé au modèle ; le dashboard affiche « Contenu non analysé ».
- En PARTIAL, le résumé ne doit pas dépasser l’information de l’extrait (contrôle possible : longueur du résumé ≤ longueur de l’extrait).

## 5. Comportement attendu du dashboard (à implémenter plus tard)

| Élément | FULL | PARTIAL | MINIMAL |
|---|---|---|---|
| Titre | ✅ | ✅ | ✅ |
| Source | ✅ | ✅ | ✅ |
| Date | ✅ | ✅ | ✅ si disponible |
| Contenu affiché | Résumé IA et points clés | Informations disponibles (extrait, résumé limité) | Mention « Contenu non analysé » |
| Pertinence | Score de pertinence | Pertinence estimée | Pertinence estimée sur le titre et les métadonnées |
| Bouton « Lire l’article » | ✅ | ✅ | ✅ |

- Le bouton ouvre **toujours l’URL originale exacte** (`url`), jamais `dedupKey` ni une URL reconstruite.
- Les publications MINIMAL restent **éligibles aux rapports quotidiens** si leur pertinence estimée dépasse le seuil retenu.
- Un badge de niveau (Complet / Partiel / Minimal) indique à l’utilisateur la profondeur d’analyse, à ne pas confondre avec la pertinence.
- Un lien signalé comme cassé (4xx/5xx, redirection vers l’accueil) reste affiché, avec un avertissement.

## 6. Synthèse

**1. Extraction fiable du contenu ?**
- Hugging Face Blog : ✅ oui sur l’échantillon (3/3 FULL, médiane 8331 caractères, titre et texte conformes à l’article). robots.txt : 3/3 pages autorisées. Date trouvée dans la page : 3/3.
- Google Research Blog : ✅ oui sur l’échantillon (3/3 FULL, médiane 9384 caractères, titre et texte conformes à l’article). robots.txt : 3/3 pages autorisées. Date trouvée dans la page : 0/3.
- Limite : l’échantillon ne compte que 3 pages par source. Un changement de gabarit HTML pourrait dégrader l’extraction, d’où le repli automatique en MINIMAL.

**2. Les publications sans contenu restent-elles exploitables en mode minimal ?**
- ✅ Oui. 120/120 publications ont un titre, une URL valide et une date fiable, ce qui est le socle du mode MINIMAL. Aucun résumé n’est produit dans ce mode.

**3. Limites techniques identifiées**
- L’extraction double le nombre de requêtes pour les sources concernées (une par nouvelle publication) ; il faut la limiter aux nouvelles publications et respecter un délai entre requêtes.
- Readability est générique : il peut inclure des légendes ou des blocs annexes, ou manquer du contenu chargé en JavaScript. Le contrôle de correspondance titre/texte limite ce risque sans l’éliminer.
- Les contrôles de pertinence du texte (couverture du titre, similarité entre pages) sont heuristiques : ils détectent les cas grossiers (page générique, mauvaise page), pas les extractions partielles subtiles.
- robots.txt ne remplace pas les conditions d’utilisation : la réutilisation du texte intégral (stockage, envoi à un LLM) doit être validée juridiquement, notamment l’opt-out TDM en droit européen.
- Pages non vérifiables automatiquement : Angular Blog (BLOQUÉ (anti-bot)) ; OpenAI News (BLOQUÉ (anti-bot)). Ces liens restent conservés et cliquables.
- Le niveau atteignable des autres sources repose sur une seule page chacune.
- Le contrôle de correspondance par les mots du titre ne fonctionne pas pour les titres réduits à un numéro de version (releases GitHub : « 2.4.0 », « v2.1.318 »). C’est sans conséquence ici, puisque le contenu GitHub vient de l’API et non de la page, mais ce contrôle ne doit pas être appliqué à ce type de titre.

**4. Sources à remplacer**
- Aucune source n’a besoin d’être remplacée pour des raisons d’accès : toutes fournissent un titre, une URL et une date fiables.
- Pour enrichir la catégorie IA en contenu FULL **sans extraction**, il faudrait des flux avec contenu intégral. Sur les 12 sources, 4 sont FULL via le flux seul.

**5. Conséquences pour le futur système de veille**
- Le modèle de données doit porter `contentLevel` (disponibilité) **et** un score de pertinence distinct.
- Le pipeline devient : collecte du flux → classification du niveau → extraction de la page si autorisée et utile → reclassification → analyse IA adaptée au niveau.
- Le coût IA dépend du niveau : une publication MINIMAL coûte environ le prompt plus le titre, une publication FULL coûte jusqu’à la troncature du contenu.

## 7. Impact sur le budget du POC 2 (projection, aucun appel IA)

Mêmes hypothèses que `feasibility-report.md` (troncature à 6000 caractères, 400 tokens de prompt, 150 tokens de sortie, prix **hypothétiques**).

| Scénario de prix (hypothétique) | Flux seul | Avec extraction HF + Google Research |
|---|---|---|
| Petit modèle économique (0.15 $ / 0.6 $ par M) | ~0.05 $/mois | ~0.06 $/mois |
| Modèle intermédiaire (1 $ / 5 $ par M) | ~0.39 $/mois | ~0.44 $/mois |
| Grand modèle (3 $ / 15 $ par M) | ~1.16 $/mois | ~1.33 $/mois |

Tokens d’entrée : ~0.18 M/mois avec le flux seul, ~0.23 M/mois avec extraction.

Mécanismes de maîtrise du budget à prévoir au POC 2 :
- **Plafond mensuel applicatif** strictement inférieur à 10 € (ex. 8 €), avec une marge pour les retraitements.
- **Quota quotidien** = plafond restant ÷ jours restants. Chaque appel est comptabilisé en tokens réels (usage renvoyé par l’API) avant le suivant.
- **Arrêt automatique** dès que le quota du jour ou le plafond du mois est atteint : les publications restent stockées avec le statut « en attente d’analyse » et ne sont jamais supprimées.
- **Ordre de traitement** suggéré quand le quota approche : MINIMAL et PARTIAL d’abord (peu coûteux), puis FULL. Ce choix reste à arbitrer au POC 2.
