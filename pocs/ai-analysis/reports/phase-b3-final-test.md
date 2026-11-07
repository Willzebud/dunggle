# Audit de B.2 et préparation du test final B3

> **Mise à jour du 2026-11-07 : B3 exécuté et conclu. Résultat et limites au § 8.** GPT-6 Luna est retenu pour Dunggle selon le protocole B3.
>
> 2026-11-07, préparation (§ 1 à 7, texte d'origine conservé) : travail **entièrement hors ligne** ; aucun appel API, aucune autorisation créée ; quotas et budget inchangés ; résultats B.1/B.2 non modifiés. À ce stade, la phase B3 était configurée mais **inactive**.
>
> **Conflit d'intérêts à garder en tête :** cette analyse a été préparée par Claude, un modèle d'Anthropic, comme Haiku 5.5. Pour limiter ce biais, la décision finale repose sur une règle mécanique figée avant les tests (§ 4) et sur une revue humaine à l'aveugle, pas sur mon jugement. La lecture qualitative du § 1.4 n'est pas une évaluation humaine.

## 1. Ce que B.2 permet déjà de conclure

### 1.1 Effets du protocole : ce qui n'est pas une erreur des modèles

| Biais | Effet constaté | Conséquence |
|---|---|---|
| Les fixtures étaient signalées comme fictives à 4 endroits : le titre « [SYNTHÉTIQUE] », le texte « aucune de ces informations n'est réelle », la source « Fixtures synthétiques Dunggle », les URL `example.invalid`, auxquels s'ajoutent des versions absurdes (Angular 99, MCP 2099-01). | Luna exclut `angular-99` (pertinence 0) et `logical-qubits` (pertinence 5) en invoquant le caractère fictif. Ses résumés OrionVision et MCP le mentionnent, dont un point clé sur 4. Haiku le signale aussi dans ses justifications et écrit au conditionnel (« ajouterait », « imposerait »). | Les deux faux négatifs de conservation de Luna, 2 de ses 3 résumés manquants et une partie des avertissements « niveau de contenu » sont des **artefacts**, pas des erreurs de sélection éditoriale. |
| La couverture obligatoire est imposée par le code (par source), pas par le modèle. | 11 sur 11 pour les deux modèles. | Ce résultat **ne départage pas** les modèles. |
| Les limites de sortie n'étaient **pas indiquées dans le prompt** : 5 points clés au maximum, résumé de 1 200 caractères au maximum, longueur de l'extrait. Le schéma ne peut pas les exprimer (`maxItems` et `maxLength` ne sont pas pris en charge par Anthropic). | Haiku a produit 6 points clés pour OrionVision (sortie rejetée). Le résumé de Luna pour OrchestraJS était plus long que l'extrait (supprimé). | Ces deux défauts viennent d'abord d'un **défaut du prompt**. B.2 ne permet pas de les attribuer à un modèle (§ 6). |
| Les 30 publications réelles sont en métadonnées seules, et les 6 résumés attendus portent sur des fixtures françaises. | Aucun résumé sur un contenu réaliste (les sources réelles sont surtout en anglais). | La qualité des résumés reste **non mesurée** dans des conditions réalistes (§ 1.5). |

Rien n'a été modifié rétroactivement : ni les réponses des modèles, ni la vérité de référence. Les indicateurs B.2 restent reproductibles (`npm run compare`, prompt B.2 `96c4c96347de`), à l'identique.

### 1.2 Vraies différences sur les 29 publications réelles analysées (métadonnées seules, la condition actuelle de production)

| Constat | Haiku 5.5 | GPT-6 Luna |
|---|---|---|
| Actualités importantes réelles (bande « high ») dans la bonne bande | **5 sur 9** : GPT-6 Cyber, Genie 4, Cosmos 3 à 55 et One Useful Thing à 60 sont sous-notés | **8 sur 9** (One Useful Thing à 65) |
| Actualités réelles manquées (exclues) | 0 | 0 |
| Publications « medium » surnotées (surtout des versions de routine) | 7 | 9 (souvent 85). Effet limité : le code place les versions dans « Mises à jour » de toute façon. |
| Cas clients promotionnels exclus | 1 sur 2 (Cult.fit conservé) | 2 sur 2 |
| Exclusions réelles à tort | 0 | 0 |
| Confiance en métadonnées seules | 0,54 en moyenne, abaissée comme demandé | 0,59 en moyenne, mais jusqu'à 0,96 sur des versions sans contenu |
| Cas ambigus | Exclut « Quoting Paul Ford » (acceptable) | Le conserve (acceptable) |

**Conclusion partielle :**
- Avec des métadonnées seules, aucun des deux modèles ne manque d'actualité réelle.
- Luna classe mieux les annonces importantes d'IA et a exclu les deux cas clients. Haiku a laissé passer Cult.fit et calibre mieux sa confiance.
- Ces écarts portent sur 4 publications au plus et un seul passage. C'est une **tendance**, pas une preuve.

### 1.3 Coût et latence : non décisifs

- **Haiku :** 0,000405 € par publication ; médiane 1,8 s par appel.
- **Luna :** 0,000249 € par publication, soit environ 40 % de moins ; médiane 3,6 s par appel.

Au volume maximal de production (500 publications par mois), cela représente 0,20 € contre 0,12 € par mois, très loin du budget opérationnel de 8 €. Pour un traitement par lots, la latence n'a pas d'importance.

### 1.4 Lecture qualitative des résumés B.2 (assistée par Claude, NON humaine, non à l'aveugle)

Notes de 0 à 2 selon la grille de `reports/summary-evaluation-grid.md`, dans l'ordre : exactitude / informations essentielles / absence d'invention / respect du niveau de contenu / français / concision.

| Publication | Haiku | Luna |
|---|---|---|
| angular-99 | 2/2/2/2/2/2 | aucun résumé (exclusion par artefact) |
| orion-multimodal | sortie invalide (6 points clés) | 2/**1**/2/2/2/2 : omet le score de référence 81,4 contre 76,0 |
| mcp-async-tasks | **1**/2/2/2/2/2 : conditionnel injustifié | 2/2/2/2/2/**1** : un point clé consacré au caractère fictif |
| orchestrajs-32 (extrait) | 2/2/2/2/2/2 | **0** en respect du niveau de contenu : plus long que l'extrait, supprimé |
| logical-qubits | 2/2/2/2/2/2 | aucun résumé (exclusion par artefact) |
| regional-agents-rules (extrait) | **1**/2/2/2/2/2 : « imposerait » au lieu de « impose » | 2/2/2/2/2/2 |

Bilan :
- Aucune invention matérielle ni aucun chiffre faux n'a été trouvé dans les 8 résumés produits.
- Sur les 2 seules paires comparables, la qualité est équivalente. Haiku est un peu plus complet, Luna plus fidèle au mode des verbes.
- **Cette lecture ne permet pas de choisir un modèle**, et elle ne remplace pas la revue humaine.

La grille humaine à l'aveugle de B.2 reste disponible (`var/review/summary-review.blind.json`, 6 publications), mais je ne recommande pas d'y consacrer du temps :
- elle est contaminée par les mentions de fiction ;
- l'aveugle y est faible, car les tournures de début de résumé trahissent le modèle.

La revue humaine utile est celle de B3 (§ 3.4).

### 1.5 Le jeu de test reflète-t-il les conditions futures de Dunggle ?

En partie seulement.
- Les **17 sources réelles sont en `metadata-only`** : aucune autorisation de réutilisation n'est vérifiée.
- **Tant que cette situation dure, Dunggle de production ne produit aucun résumé.** Seuls comptent la sélection, le classement et la classification à partir du titre et des métadonnées.
- La qualité des résumés ne deviendra un critère opérationnel qu'à partir du moment où au moins une source aura une politique `full-allowed` ou `excerpt-only` vérifiée.

Le test B3 couvre donc les deux régimes :
- **8 publications réelles en métadonnées seules**, la condition actuelle ;
- **7 contenus synthétiques**, simulant des sources dont la réutilisation est autorisée (texte intégral) ou limitée à un extrait, avec des textes **en anglais** comme les vraies sources.

## 2. Ce qui reste réellement incertain

1. **La qualité et la fidélité des résumés sur un contenu propre**, c'est-à-dire les critères prioritaires 2 et 3 : 2 paires comparables seulement, contaminées.
2. **Le respect des limites une fois qu'elles sont communiquées** : la sortie invalide de Haiku et le résumé trop long de Luna disparaissent-ils ?
3. **La sous-notation des annonces majeures d'IA par Haiku** : est-elle systématique, ou était-ce le hasard de 3 titres ?
4. **L'exclusion des contenus promotionnels** quand le texte complet est disponible, et sur un deuxième échantillon de cas clients.
5. **Le comportement quand l'information manque** : tendance à inventer.
6. **La stabilité.** Les modèles ne sont pas déterministes et B3 ne fait qu'un passage : un écart de quelques points reste dans le bruit. La règle de décision en tient compte (marge de 5 points, départage par priorités).

## 3. Jeu de test proposé : 15 publications, figées

**Fichiers figés :**
- `fixtures/b3/publications.json` (entrées) ;
- `fixtures/b3/ground-truth.json` (réponses attendues, rédigées avant tout appel) ;
- `fixtures/b3/decision-rule.json` (critères et seuils).

L'empreinte SHA-256 `37cc22da5653…` (recalculée le 2026-11-07 après l'ajout des règles de preuve des inventions et de revue obligatoire dans `decision-rule.json`) et la version du prompt `bc786201b88a` sont figées dans `src/evaluation/b3-freeze.ts`. Une simulation ou une exécution B3 est **refusée** si un seul octet de ces fichiers, ou le prompt, a changé.

**Mêmes conditions pour les deux modèles :**
- mêmes entrées, même prompt, même schéma ;
- même limite de 800 tokens en sortie ;
- même pipeline et mêmes critères.

| # | Publication | Catégorie | Incertitude résolue |
|---|---|---|---|
| 1 | DeepMind, « Gemini Omni 1.2 Flash » (réel, MINIMAL) | importante, facile à manquer | Sous-notation par Haiku des annonces de modèles (n° 3) |
| 2 | Google Research, « The sleep framework… continual learning » (réel, MINIMAL) | importante, facile à manquer | Recherche IA présentée par un titre technique (n° 3) |
| 3 | OpenAI, « Franklin Templeton uses OpenAI… » (réel) | marketing à exclure | Haiku a laissé passer Cult.fit (n° 4) |
| 4 | OpenAI, « Merge builds… with OpenAI technology » (réel) | marketing à exclure | Deuxième échantillon de cas client (n° 4) |
| 5 | OpenAI, « A thousand fewer paths to root » (réel) | ambiguë | Titre vague : sujet inventé dans la justification ? (observation qualitative, non notée) |
| 6 | Angular Blog, « Free Book Chapters, Better Testing Control, and Smart MCP Configuration! » (réel) | source obligatoire | Contrôle de la couverture obligatoire avec le nouveau prompt |
| 7 | OpenAI Agents SDK v0.24.0-alpha.6 (réel) | source obligatoire de routine | Surnotation des versions par Luna |
| 8 | Project Zero, « Fuzzers vs. AI… » (réel) | importante, facile à manquer | Intérêt IA d'une source sécurité sélective |
| 9 | Tessaline Forms 5.0 (synthétique, texte intégral, environ 10 faits) | résumé technique précis + limite de 5 points clés | Fidélité sur un texte dense ; respect de la limite communiquée (n° 1 et n° 2) |
| 10 | Nembra-V2 (synthétique, texte intégral, chiffres) | importante, IA | Chiffres, limites, non-invention : code d'entraînement non publié, prix non annoncé (n° 1) |
| 11 | Korvo 2.4 (synthétique, extrait de 326 caractères) | extrait limité | Respect de `summaryMaxChars` (n° 2) |
| 12 | Avis de sécurité Halvard (synthétique, extrait de 255 caractères) | importante, facile à manquer | Reconnaissance d'un avis de sécurité court ; aucun ajout, par exemple un CVE inventé (n° 1) |
| 13 | Brightwell Agents (synthétique, texte intégral promotionnel) | marketing à exclure | Exclusion avec texte complet malgré le vocabulaire « agents IA » (n° 4) |
| 14 | Quillmark CLI 3.0 (synthétique, texte très pauvre) | informations insuffisantes | Aucune fonctionnalité inventée ; pas d'exclusion faute de contenu (n° 5) |
| 15 | « Why I stopped letting coding agents write my tests » (synthétique) | ambiguë, opinion chiffrée | Ne pas présenter un retour d'expérience comme une étude (n° 1) |

**Contenus synthétiques sans mention de fiction :**
- Rien de ce qui est transmis aux modèles (titre, source, URL, texte) ne contient de mention de fiction. Un test le vérifie, en contrôlant le message réellement construit.
- La provenance reste dans les champs internes `synthetic` et `provenance`, jamais transmis.
- Les organisations et produits sont inventés. Ces publications ne doivent **jamais** être présentées comme des actualités réelles.

**URL synthétiques et biais du domaine `.example` (conservé volontairement) :**
- Les 7 URL synthétiques utilisent des sous-domaines de `.example`, TLD réservé à la documentation par la RFC 2606 et RFC 6761 (par exemple `https://korvo.example/releases/2.4.0`). Elles sont **non trompeuses** : elles ne peuvent appartenir à personne, ne se résolvent pas et n'imitent aucun site réel. Un vrai domaine aurait pu usurper une identité ou orienter vers un site tiers.
- **Biais possible :** un modèle qui connaît ce TLD peut en déduire qu'il s'agit d'un exemple et changer son comportement (exclusion, prudence, mention du caractère fictif). C'est le seul indice de fiction qui reste transmis.
- **Pourquoi il reste limité :** contrairement à B.2, le titre, la source et le texte ne contiennent plus aucune mention de fiction, et le domaine n'apparaît que dans le champ `url`. Les 8 publications réelles gardent leurs vraies URL.
- **Comment il est mesuré et neutralisé :** le motif d'artefact figé détecte `example.` et `.example` dans les justifications, résumés et points clés. Une publication touchée est neutralisée **pour les deux modèles**. Au-delà de 2 publications neutralisées, les critères de résumé sont déclarés non concluants.
- **Asymétrie possible :** si un seul modèle réagit au domaine sans le mentionner (par exemple une exclusion silencieuse), la règle ne le détecte pas. Le rapport post-exécution signalera donc toute exclusion d'une publication synthétique `must_keep`, avec sa justification, pour que vous puissiez en juger.

**Règle d'artefact, figée :**
- Si un modèle évoque malgré tout le caractère fictif ou de test d'une publication synthétique, celle-ci est neutralisée **pour les deux modèles**.
- Au-delà de 2 publications neutralisées, les critères liés aux résumés sont déclarés non concluants et la décision devient provisoire.
- Le motif ne se déclenche sur aucun texte transmis : c'est vérifié par un test. La phrase « synthetic data » du texte Nembra a été retirée pour cette raison.

### 3.4 Revue humaine à l'aveugle (B3), obligatoire

- **Quand :** après l'exécution, `npm run compare -- --phase=B3` produit la grille `var/review/b3-summary-review.blind.json`.
- **Volume :** au plus 6 publications, de 1 à 2 résumés chacune, soit environ 20 minutes.
- **Critères :** les 6 critères existants, notés de 0 à 2, identiques pour les deux modèles.
- **Aveugle :** la correspondance des étiquettes A/B (`b3-summary-review.key.json`) n'est lue par le programme que lorsque la grille est entièrement remplie et qu'un relecteur est renseigné.
- **La revue est OBLIGATOIRE avant toute décision.** Tant que la grille n'est pas complète et validée :
  - aucune décision n'est rendue, même provisoire ;
  - les indicateurs par modèle restent **scellés** dans `var/reports/b3-comparison.SEALED.json`, sans être affichés, car les statuts, exclusions et résumés produits par modèle permettraient de deviner la correspondance A/B ;
  - la commande n'affiche que des totaux tous modèles confondus et la liste des points restant à compléter.
- **Ce que je ne ferai pas :** je ne saisirai aucune note à votre place, je n'ouvrirai pas `b3-summary-review.key.json` et je ne vous communiquerai aucun résultat par modèle et par publication avant la fin de votre revue. Après l'exécution, je vous donnerai seulement les totaux (appels, coût, statuts agrégés, incidents éventuels) et le chemin de la grille.
- **Consignes intégrées à la grille :** définition de l'invention matérielle et de ce qui n'en est pas une (reformulation, traduction, omission, nuance). Les notes sont toutes vides au départ et aucun nom de modèle n'y figure.

### 3.5 Invention matérielle : vérification explicite et justification documentée

Une invention ne peut éliminer un modèle que si le relecteur l'a **documentée** dans le champ `inventions` du candidat :

| Champ | Contenu | Contrôle automatique |
|---|---|---|
| `claim` | passage EXACT copié du résumé ou des points clés | doit figurer tel quel dans la sortie du candidat |
| `sourceCheck` | `absent` (la source ne le dit pas) ou `contradicted` (la source dit autre chose) | valeur obligatoire ; un passage marqué `absent` mais présent tel quel dans la source est refusé |
| `justification` | explication en référence au texte source | 20 caractères au moins |

- **Ne sont pas des inventions :** une reformulation ou une traduction fidèle, une omission (critère « informations essentielles »), une approximation sans conséquence ou un changement de nuance (« exactitude » à 1), une extrapolation légère et signalée (« absence d'invention » à 1).
- **Cohérence imposée :** une note 0 en « absence d'invention » sans invention documentée, ou une invention documentée sans note 0, fait **refuser** la grille. La correspondance A/B n'est alors pas lue.
- Seules les inventions documentées entrent dans le seuil éliminatoire. Les contrôles automatiques (chiffres absents, affirmations interdites) restent **indicatifs** : ils peuvent attirer votre attention, mais n'éliminent jamais un modèle à eux seuls.

## 4. Critères et seuils de décision définitifs

Pondération sur 100, appliquée par `src/evaluation/decision.ts` :

| Priorité | Critère | Poids | Mesure |
|---|---|---|---|
| 1 | Couverture des actualités importantes | **30** | 8 publications marquées `important` : 1 si visible et dans la bande de pertinence acceptée (ou au-dessus), 0,5 si visible mais sous-notée, 0 si exclue ou non analysée |
| 2 | Exactitude factuelle et absence d'invention | **25** | Moyenne des notes humaines « exactitude » et « absence d'invention » sur les résumés livrés |
| 3 | Qualité des résumés | **20** | Moyenne humaine des notes « informations essentielles », « niveau de contenu », « français » et « concision » sur les résumés attendus ; un résumé attendu mais absent ou supprimé compte 0 |
| 4 | Fiabilité des sorties structurées | **10** | 10 × (1 − 3 × (invalides + 0,5 × résumés supprimés par une règle) / appels). Les erreurs du fournisseur sont exclues. |
| 5 | Classification | **10** | Décisions de conservation et d'exclusion 40 %, types 20 %, thèmes 20 %, nouveauté 10 %, rubrique 10 % |
| 6 | Coût et latence | **5** | 3 points pour le coût et 2 pour la latence médiane, en proportion du meilleur des deux modèles |

**Seuils éliminatoires (un seul suffit) :**
- au moins **2 actualités importantes exclues** ;
- au moins **1 invention matérielle confirmée par la revue humaine et documentée** (passage exact, vérification contre la source, justification ; § 3.5) ;
- au moins **2 sorties structurées invalides** sur 15 ;
- un coût mensuel projeté supérieur à 8 € à 500 publications par mois.

**Règle de choix :**
1. Si un seul modèle n'est pas éliminé, il est retenu.
2. Si aucun n'est éliminé et que l'écart est d'au moins **5 points**, le mieux noté est retenu : il domine nettement.
3. Si l'écart est inférieur à 5 points (résultats proches), on prend le plus fiable sur les priorités, dans l'ordre :
   1. couverture des actualités importantes ;
   2. exactitude ;
   3. sorties structurées ;
   4. résumés ;
   5. classification.

   Le premier critère où l'écart atteint au moins 10 % de son poids décide. Une actualité importante manquée (3,75 points) départage ; une simple sous-notation (1,9 point) ne départage pas.
4. Sinon, le moins cher est retenu. Le choix est remplaçable ultérieurement.
5. Sans revue humaine complète et validée, **aucune décision n'est rendue**.
6. Si les deux modèles sont éliminés, **aucun modèle n'est validé**. On retient provisoirement celui qui a le moins de critères éliminatoires, puis on applique le même ordre. Les mesures de prudence sont maintenues (résumés désactivés tant que le défaut n'est pas corrigé). **Aucune nouvelle campagne n'est proposée automatiquement.**

## 5. Appels et coût maximal

| Élément | Valeur (simulation en lecture seule sur le registre réel, inchangé) |
|---|---|
| Appels | **30 au maximum** (15 Haiku, 15 Luna), aucune relance automatique |
| Coût maximal réservé | **0,051248 €**. Autorisation recommandée : **0,06 €**. |
| Budget | 0,024638 € dépensés ; au moins 0,424 € restants après B3 sur 0,50 € |
| Quota | Phase **B3 distincte** : 15 par modèle, 30 au total. Compteurs B.1 (3) et B.2 (75) conservés. |
| Durée estimée | Environ 22 minutes en régime typique, 34 minutes dans le pire cas. La temporisation OpenAI est de 75 s après la fin de chaque requête. Validité d'activation B3 : 45 minutes. |
| État actuel | **B3 inactif** : le garde budgétaire refuse toute réservation (`quota-phase-inactive`), la création d'autorisation est refusée, et la simulation affiche le blocage |

**Procédure, uniquement après votre feu vert explicite (commandes exactes, depuis la racine du dépôt `dunggle/`) :**

1. Activation de la phase par un commit relu (je le fais sur votre feu vert) : `POC_PHASES.B3.active` passe à `true` dans `pocs/ai-analysis/src/config/quotas.ts`. Rien d'autre ne change, et l'empreinte du jeu figé n'est pas touchée.
2. Simulation de contrôle en lecture seule, qui doit afficher 30 appels, 0,051248 € et le jeu figé vérifié :
   `npm run poc2:evaluate -- --mode=final --dry-run`
3. Autorisation locale à usage unique, valable 15 minutes :
   `npm run poc2:authorize -- --phase=B3 --models=anthropic-haiku-5-5,openai-gpt-6-luna --max-eur=0.06 --confirm="AUTORISER B3 0.06 EUR"`
4. Exécution réelle (environ 22 minutes, arrêt immédiat sur erreur bloquante ou coût incertain, aucune relance) :
   `npm run poc2:evaluate -- --mode=final --real --confirm-max-eur=0.06`
5. Préparation de la grille (indicateurs par modèle scellés, aucune décision) :
   `npm run poc2:compare -- --phase=B3`
6. **Votre** revue humaine à l'aveugle dans `pocs/ai-analysis/var/review/b3-summary-review.blind.json` : renseigner `reviewer`, toutes les notes, et documenter chaque invention éventuelle (§ 3.5).
7. Levée de l'aveugle et décision : `npm run poc2:compare -- --phase=B3`, qui écrit `var/reports/b3-decision.json`.

## 6. Corrections de code effectuées (hors ligne, testées)

| Correction | Raison |
|---|---|
| Le prompt indique les limites : 1 à 4 thèmes, 6 sous-thèmes au plus, résumé de 1 200 caractères au plus, 0 à 5 points clés de 240 caractères au plus, raison de 400 caractères au plus. Le message transmet `summaryMaxChars` quand le résumé est limité à un extrait. | C'est la cause première des défauts OrionVision et OrchestraJS. La validation reste stricte, sans correction silencieuse. Nouvelle version du prompt `bc786201b88a` : les clés d'idempotence de B.2 ne sont ni réutilisées ni écrasées. |
| **Aucune normalisation automatique du contenu.** | Tronquer les points clés à 5, ou couper un résumé trop long, supprimerait ou altérerait le contenu produit par le modèle. Je l'écarte pour l'évaluation. En production, une troncature tracée des points clés pourrait se discuter plus tard comme mode dégradé. |
| Conservation **locale** (dans `var/`, hors Git, jamais affichée) du texte brut d'une sortie rejetée (`rejectedRawOutput`) et d'un résumé supprimé par une règle (`droppedSummary`, avec ses motifs). | Les sorties de Haiku sur OrionVision et de Luna sur OrchestraJS n'ont pas été conservées. Leur cause exacte ne peut donc plus être vérifiée. |
| Phase `B3` (mode `final`) avec le champ `active: false`, refus dans le garde budgétaire, dans l'autorisation et dans les blocages d'exécution. Validité d'activation de 45 minutes. | Quota distinct préparé sans être activé. |
| `fixtures/b3/`, politiques `b3-synthetic-full` et `b3-synthetic-excerpt` (sans objet, synthétiques), gel par empreinte. | Le jeu de test est figé avant les appels. |
| `src/evaluation/decision.ts` et `npm run compare -- --phase=B3`, qui écrit `var/reports/b3-decision.json`. | La règle de décision est figée et appliquée de façon identique aux deux modèles. |
| Revue humaine obligatoire : sans grille complète et validée, aucune décision ; indicateurs par modèle scellés ; correspondance A/B jamais lue (`validateReviewGrid` avant toute lecture). | Garantie demandée le 2026-11-07. |
| Inventions documentées (`inventions` : passage exact, `absent` ou `contradicted`, justification), avec contrôles automatiques de cohérence ; consignes invention / omission / reformulation dans la grille. | Garantie demandée le 2026-11-07 : une reformulation ou une omission n'est jamais comptée comme hallucination. |
| `npm run compare` relit toujours B.2 avec son prompt historique `96c4c96347de`. | B.2 reste reproductible alors que le prompt a changé : indicateurs identiques vérifiés. |

**Vérifications :**
- `npm run typecheck` : 0 erreur ;
- `npm test` : **185 sur 185**, dont 19 tests dans `tests/b3-preparation.test.ts` ;
- `npm run budget:scenarios` : 14 scénarios, 0 échec ;
- `npm run check:secrets` : aucun secret ;
- simulation B3 : le registre, le journal et le fichier de temporisation sont identiques, octet pour octet, avant et après ;
- B.2 reproductible (`npm run compare`) : indicateurs identiques au rapport B.2 ;
- état persistant : 0,024638 € dépensés, 0 réservation, 0 coût incertain ; quotas B.1 3/3, B.2 75/75, B3 0/30 (inactive).

## 7. Recommandation

**Je recommande un seul test final B3 (30 appels, 0,06 € au maximum), sans autre campagne ensuite.** Trois raisons :
1. Les critères prioritaires 2 et 3 (exactitude des résumés, qualité) ne sont **pas mesurés** de façon exploitable par B.2. Or ils compteront dès qu'une source sera autorisée.
2. Le prompt de production a changé, avec les limites désormais communiquées. Quel que soit le modèle retenu, il serait déployé avec un prompt **jamais testé** sans B3.
3. Le coût est négligeable et la règle de décision est figée. B3 aboutira donc à une décision, provisoire ou définitive, sans nouvelle itération.

**Si vous préférez choisir dès maintenant :**
- Sur les preuves de B.2, et uniquement pour le régime actuel en métadonnées seules (aucun résumé), **GPT-6 Luna** a un léger avantage sur les critères 1 et 5 : il classe mieux les annonces importantes, exclut les cas clients, et coûte moins cher.
- Ce choix serait **provisoire et remplaçable**.
- Il faudrait garder les résumés non validés pour les deux modèles.

J'arrête ici. Aucun appel ni aucune nouvelle phase n'aura lieu sans votre autorisation explicite.

## 8. Résultat de B3 et décision (2026-11-07)

### 8.1 Exécution

- **Activation de la phase :** commit `5be4619`, B3 uniquement. Simulation conforme, puis autorisation locale à usage unique.
- **Appels :** 30 sur 30 autorisés (15 par modèle), une seule exécution. Aucune relance, aucune erreur fournisseur, aucun arrêt anticipé. Délai minimal de 75 s entre deux appels OpenAI respecté.
- **Statuts :** 28 analyses valides et 2 sorties structurées invalides, rejetées sans correction.
- **Coût réel de B3 : 0,011615 €**, pour un plafond de 0,06 € (réservation maximale : 0,051248 €).
- **Budget du POC :** 0,036253 € dépensés sur 0,50 €, soit **0,463747 € restants**. Aucune réservation ouverte, aucun coût incertain, quota B3 consommé (30/30).

### 8.2 Revue humaine à l'aveugle

- **Relecteur :** l'utilisateur (initiales `WR`).
- **Grille :** 4 publications, 7 résumés étiquetés A/B. Notes de 0 à 2 sur 6 critères.
- **Garantie d'aveugle :** la correspondance A/B n'a été lue qu'après la validation automatique de la grille complète.
- **Aucune invention documentée** pour l'un ou l'autre modèle.
- **Moyennes humaines très proches :** Haiku 5.5 à 33/36 sur 3 résumés (1,83/2), Luna à 45/48 sur 4 résumés (1,875/2).
- La grille, la correspondance et les sorties restent locales, dans `var/`, hors Git.

### 8.3 Scores selon la règle figée (§ 4)

| Critère (poids) | Claude Haiku 5.5 | GPT-6 Luna |
|---|---|---|
| Couverture des actualités importantes (30) | 22,5 | **30** |
| Exactitude factuelle (25) | **25** | 23,44 |
| Qualité des résumés (20) | 6,5 | **11** |
| Fiabilité des sorties structurées (10) | 5 | **8** |
| Classification (10) | 8,38 | **9,7** |
| Coût et latence (5) | 3,4 | **4,47** |
| **Total** | **70,78** | **86,61** |
| Critère éliminatoire | **2 sorties invalides (seuil 2)** | aucun |

**Lecture des scores :**
- **Résumés.** Le score de résumé intègre le taux de résumés livrés : 3 sur 5 attendus pour Haiku, 4 sur 5 pour Luna. La qualité notée par le relecteur est presque identique.
- **Sorties invalides de Haiku.** Elles portent sur 2 publications importantes :
  - Nembra : sous-thème hors de la liste autorisée ;
  - Halvard : JSON invalide.

  Ces publications sont restées « en attente » et n'ont pas été exclues. C'est ce qui fait baisser la couverture importante de Haiku.
- **Classement.** Haiku a conservé une publication promotionnelle qui devait être exclue (Merge). Luna a respecté toutes les décisions éditoriales attendues. Rubrique correcte : 12/15 pour Haiku, 15/15 pour Luna.
- **Biais du domaine `.example`.** Aucune publication synthétique à conserver n'a été exclue. Brightwell, qui devait être exclue, l'a été par les deux modèles. Le biais observé en B.2 ne s'est pas reproduit.

**Coût et latence :**

| | Claude Haiku 5.5 | GPT-6 Luna |
|---|---|---|
| Coût des 15 publications | 0,007543 € | 0,004072 € |
| Coût mensuel projeté (390 à 500 publications) | 0,23 à 0,29 € | 0,11 à 0,14 € |
| Latence médiane | 2,4 s | 3,3 s |

Ces écarts restent très loin du seuil éliminatoire (8 €/mois).

### 8.4 Décision

**GPT-6 Luna est retenu pour Dunggle selon le protocole B3.**
- La décision est **définitive au sens de la règle figée** : grille humaine valide, aucun artefact de protocole neutralisé.
- Luna est le seul modèle sans critère éliminatoire.
- Sans l'élimination, Luna resterait devant de 15,8 points, au-delà de la marge de 5 points.

### 8.5 Limites : ce que ce résultat ne dit pas

Ce choix vaut **pour l'usage testé** : tri, classification et résumé en français de publications de veille, avec ce prompt (`bc786201b88a`), ce schéma de sortie et ce jeu. **Il ne se généralise pas** à d'autres tâches, d'autres langues, d'autres volumes ni à de futures versions des modèles.

- **Échantillon réduit.**
  - 15 publications, une seule exécution par modèle : la variabilité d'un appel à l'autre n'est pas mesurée.
  - Les 2 sorties invalides de Haiku suffisent à l'éliminer. Avec un échantillon de cette taille, ce résultat peut dépendre du hasard.
- **Revue humaine limitée.** 7 résumés sur 4 publications, notés par un seul relecteur. L'avantage de Luna en qualité de résumé n'est pas démontré : les notes humaines sont équivalentes.
- **Données synthétiques.**
  - 7 publications sur 15 sont synthétiques, sur des domaines `.example`.
  - Les 8 publications réelles sont en métadonnées seules, sans résumé.
  - La qualité des résumés sur de vrais articles complets n'est donc mesurée qu'indirectement.
- **Correctifs non testés.** Une erreur de sous-thème de Haiku pourrait relever d'une validation stricte que le prompt pourrait mieux expliciter, mais cela n'a pas été testé. La règle figée a été appliquée telle quelle, sans réinterprétation a posteriori.
- **Conflit d'intérêts.** L'analyse a été préparée par Claude, un modèle d'Anthropic. La décision repose sur la règle mécanique et la revue humaine.
- **Suivi recommandé en production.** Surveiller en continu :
  - le taux de sorties invalides ;
  - les exclusions d'actualités importantes ;
  - les résumés supprimés par les règles (2 chez Luna, 1 chez Haiku dans B3).

  Toute réévaluation passera par une nouvelle phase explicitement autorisée.

Aucune nouvelle campagne ni aucun appel supplémentaire n'est prévu.
