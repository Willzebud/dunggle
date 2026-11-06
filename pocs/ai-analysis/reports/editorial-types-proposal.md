# Types de publication — règle éditoriale

> Rédigé le 2026-11-06 après B.1, puis **validé avec des précisions** (voir § 6, qui prévaut sur les §§ 2 à 5). Appliqué au prompt et à la vérité de référence.

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

## 6. Décisions validées (2026-11-06) — appliquées

1. Le type principal décrit l’**événement dominant** de la publication.
2. Un nouveau modèle d’IA rendu accessible (API ou poids ouverts) relève généralement de `product`.
3. Une nouvelle version d’un modèle existant **peut** relever de `release`. Ce type n’est plus interdit aux modèles, contrairement au § 2.
4. Une publication essentiellement scientifique relève de `research`, même si elle présente un modèle.
5. Genie 4 : `research` conservé, faute de disponibilité établie.
6. Spécifications MCP : `feature` pour une nouvelle fonctionnalité, `release` pour une version logicielle réellement livrée.
7. Billets TypeScript et Angular : `feature` pour une annonce fonctionnelle, `technical_analysis` pour une explication technique.
8. Video Friday : `product` si la disponibilité du produit est établie, sinon `research` selon le contenu.
9. Le type des publications exclues n’entre pas dans le score principal.
10. Option 1 : les définitions sont ajoutées au prompt, et OrionVision est réanalysée en B.2 avec le même prompt que les 36 autres publications.

**Prompt :** chaque type est défini dans `SYSTEM_PROMPT`, sur le critère de l’événement dominant.

**Vérité de référence :** 4 modifications, justifiées par le contenu et indépendantes des sorties des modèles (tracées dans `changeLog`) :

| Fixture | Avant | Après | Justification |
|---|---|---|---|
| OrionVision (synthétique) | research, product | **product**, release, research | Modèle rendu accessible (poids ouverts). Le texte cite « la version précédente du même laboratoire », donc `release` est acceptable ; le rapport technique rend `research` acceptable |
| Gemini 4 Carbon | product, research | **product**, release, research | Nouveau modèle ; « 4 » désigne une nouvelle version d’une famille existante |
| Cosmos 3 Open Models | product, research | **product**, release, research | Modèles ouverts ; nouvelle version d’une famille existante |
| Video Friday (Spot) | product, research | **research**, product | Démonstration dont la disponibilité n’est pas établie |

Toutes les autres fixtures sont inchangées, y compris Genie 4, MCP 2099-01, les billets Angular et GPT-6 Cyber. Le jeu reste cohérent : 0 incohérence au contrôle `poc2:prepare`.

**Ambiguïtés restantes** (n’affectent que l’indicateur « type principal », les deux types restant acceptables) :
- « An update on Angular’s TypeScript 7-powered Compiler » : titre seul. `feature` est conservé en principal, mais un point d’avancement peut relever de `technical_analysis`.
- « Signal Value Transforms, Routing Essentials, and Video Extension » : un récapitulatif mêle plusieurs annonces. `feature` est conservé.
- GPT-6 Cyber : variante spécialisée d’une famille existante. `product` est conservé ; `release` n’est pas ajouté faute d’indication de nouvelle version dans les métadonnées.
