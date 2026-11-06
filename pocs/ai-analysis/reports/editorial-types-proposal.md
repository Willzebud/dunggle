# Types de publication — proposition de règle éditoriale (à valider)

> Rédigé le 2026-11-06 après B.1. **Proposition : rien n’est encore appliqué.** La vérité de référence (`fixtures/ground-truth.json`) et le prompt sont inchangés.

## 1. Constat

- Le prompt liste les types (`release`, `feature`, `research`, `product`, `breakthrough`, `technical_analysis`, `prospective_analysis`, `security_advisory`) **sans les définir**. Chaque modèle applique donc sa propre interprétation.
- En B.1, les deux modèles ont classé OrionVision en `release`. La vérité de référence accepte `research` ou `product`, avec `research` en premier.
- La vérité de référence liste plusieurs types acceptables par publication. Le premier élément est considéré comme le type principal par l’indicateur « type principal ».

## 2. Règle proposée

On retient le **premier type qui s’applique**, dans cet ordre :

| Ordre | Type | Définition proposée | Exemples du jeu |
|---|---|---|---|
| 1 | `security_advisory` | Divulgation d’une vulnérabilité, d’un exploit ou d’un correctif de sécurité | Project Zero, Pixel 10 |
| 2 | `release` | Livraison **versionnée** d’un logiciel existant (bibliothèque, framework, SDK, CLI, langage), identifiée par un numéro de version ou une étiquette, y compris les préversions. **Ne s’applique pas aux modèles d’IA.** | Angular 21.2.26, TypeScript 7.0, llm 0.37.1, Angular 99 (fictif) |
| 3 | `feature` | Une capacité nouvelle d’un produit, d’un framework ou d’une spécification existants, présentée pour elle-même et non comme une annonce de version | Billets du blog Angular, MCP 2099-01 (fictif) |
| 4 | `product` | Mise à disposition d’un nouveau produit, service ou **modèle** (API ou poids ouverts), y compris une nouvelle génération d’une famille de modèles | GPT-6 Cyber, Gemini 4 Carbon, Cosmos 3 |
| 5 | `breakthrough` | Résultat expérimental présenté comme une première ou le franchissement d’un seuil | 48 qubits logiques (fictif) |
| 6 | `research` | Publication dont l’objet principal est une connaissance (article, méthode, étude), sans mise à disposition comme événement principal | Hypertension et capteurs portables |
| 7 | `technical_analysis` | Explication approfondie du fonctionnement ou de la construction d’un système | Sécurité des robots, *data lineage* |
| 8 | `prospective_analysis` | Essai, opinion argumentée, politique publique ou impact sociétal tourné vers l’avenir | *Agency and Agents*, règles régionales (fictif) |

**Types secondaires :** les autres types plausibles restent acceptables. L’indicateur « type acceptable » les compte comme corrects ; l’indicateur « type principal » exige le premier.

**Publications exclues :** levées de fonds, acquisitions et cas clients n’ont pas de type naturel. On propose de **ne pas évaluer le type des publications exclues**. Le module de comparaison évalue déjà le type uniquement sur les publications `must_keep` conservées.

## 3. OrionVision : type principal proposé `product`

- L’événement principal est la **mise à disposition** d’un nouveau modèle : poids publiés sous Apache-2.0, exécutable sur une carte grand public.
- Le rapport technique, le banc d’essai et la publication du code justifient `research` en **type secondaire**.
- `release` ne convient pas selon la règle proposée : OrionVision n’est pas une nouvelle version d’un logiciel existant, et la règle réserve `release` aux logiciels versionnés.
- **Modification proposée de la vérité de référence :** `types: ["research", "product"]` devient `["product", "research"]`, simple réordonnancement. Ce changement découle de la règle, et non de la sortie des modèles : ceux-ci ont répondu `release`, ce qui reste refusé.

## 4. Application aux 39 fixtures

Avec cette règle, **une seule vérité de référence change : OrionVision (réordonnancement)**. Les 38 autres sont cohérentes avec leur type principal actuel. Leur liste de types acceptables ne change pas.

Ambiguïtés soumises à votre validation :

| # | Question | Fixtures concernées | Proposition |
|---|---|---|---|
| A | Un modèle d’IA publié (poids ou API) est-il une `release` ou un `product` ? | OrionVision, Cosmos 3, Gemini 4 Carbon, GPT-6 Cyber | `product` en principal ; **`release` non acceptée** (sinon le type perd son sens pour les mises à jour logicielles) |
| B | Une nouvelle génération présentée sans disponibilité claire : `research` ou `product` ? | Genie 4 (vérité actuelle : `research` puis `product`) | Garder `research` en principal : métadonnées seules, disponibilité inconnue |
| C | Une révision datée de spécification : `feature` ou `release` ? | MCP 2099-01 (fictif) | `feature` (une spécification n’est pas un logiciel versionné) |
| D | Un billet d’ingénierie sur un compilateur : `feature` ou `technical_analysis` ? | « An update on Angular’s TypeScript 7-powered Compiler » | Garder `feature` en principal, `technical_analysis` acceptable |
| E | Compilation de vidéos de démonstration | Video Friday (Spot) | Garder `product` en principal, `research` acceptable |
| F | Type des publications exclues | Cult.fit, Flipsnack, Pierre, Lumio, énergie, The Download | Non évalué |

## 5. Conséquence sur le prompt et sur OrionVision (décision à prendre)

Ajouter ces définitions au prompt rendra l’indicateur de type significatif. Mais cela change `PROMPT_VERSION`, qui fait partie de la clé d’idempotence. Trois options :

1. **Définitions ajoutées, OrionVision réanalysée en B.2** : +1 appel par modèle, soit 37 par modèle et 74 au total, exactement le quota B.2. Environ +0,003 € au maximum. Comparaison homogène, mais OrionVision est facturée une seconde fois.
2. **Définitions ajoutées, résultat B.1 d’OrionVision réutilisé** : aucun appel en plus, mais 1 publication sur 37 évaluée avec un autre prompt. Demande une petite adaptation du plan.
3. **Prompt inchangé** : B.2 mesure les modèles sans définitions, et l’écart sur les types reste attendu.

Sans décision, l’état actuel correspond à l’option 3 : prompt inchangé et OrionVision non replanifiée.
