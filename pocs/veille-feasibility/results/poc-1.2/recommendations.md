# POC 1.2 — Recommandations

> **Mesuré** : HTTP, robots.txt, formats, dates, contenu des flux, échantillons. **Estimé** : volumes, proportions, couverture, tokens et coûts.
> Les décisions s'appuient sur la revue manuelle des échantillons (`manual-review.json`), plus fiable que la grille déterministe pour trancher (voir § 5).
> **Rien n'a été ajouté à `sources.config.ts`.** Ces recommandations restent à valider.

## 1. Les 12 sources existantes : toutes conservées

Aucune modification. Deux points sont à traiter au POC 2, sans changer les sources :
- **OpenAI News** : environ 30 % de témoignages clients et 20 % d'annonces corporate dans l'échantillon. Il faut le motif `promotional` de la taxonomie, sans retirer la source, qui reste la seule source officielle d'OpenAI.
- **Angular Blog** : c'est un récapitulatif hebdomadaire, qui recoupe en partie les releases GitHub. Il faut déduplication et regroupement dans « Mises à jour ».

## 2. Sources complémentaires recommandées (5)

| Source | Domaine | Pourquoi | Mesures clés | Utiles / semaine (estimé, revue manuelle) |
|---|---|---|---|---|
| **TypeScript Blog** | A — Angular | Comble la lacune la plus nette en priorité maximale ; source officielle | RSS, 200, robots ✅, FULL 10/10, 10/10 utiles | ~0,2 (beta, RC, majeures → « Mises à jour ») |
| **Google Project Zero** | D — cybersécurité | Recherche offensive de référence : des ruptures, pas des actualités | Atom découvert (blogspot → `projectzero.google`), FULL 10/10, 10/10 utiles | ~0,25 (environ 1 par mois) |
| **One Useful Thing** (Mollick) | E — travail ; C — agents | Analyses empiriques et indépendantes de l'IA au travail et des agents | RSS Substack, FULL 20/20, ~18/20 utiles | ~0,3 |
| **MIT Technology Review** | E — prospective ; IA ; robotique | Seul candidat couvrant largement l'impact des technologies, avec un regard indépendant des éditeurs | RSS, FULL 9/10, ~3,2/jour, 3/10 utiles, 3 digests | ~6–7, avec un filtre déterministe sur « The Download » |
| **IEEE Spectrum — Robotics** | D — robotique | Couverture robotique substantielle (humanoïdes, sécurité, benchmarks), absente aujourd'hui | RSS thématique, FULL 28/30, ~0,33/jour, ~13/30 utiles plus 11 « Video Friday » | ~1 (+0,8 Video Friday) |

**Option, non incluse dans le total** : **IEEE Spectrum — Semiconductors** (D — matériel). Environ 14 articles utiles sur 30, mais un volume faible (~0,17/jour) et une part de politique industrielle. À ajouter si le matériel devient prioritaire.

## 3. Sources rejetées

| Source | Raison principale (mesurée sur l'échantillon) |
|---|---|
| **The Quantum Insider** | **0/10 utile** à la revue manuelle : financements, contrats, partenariats, chiffre d'affaires. Environ 10 publications par jour, soit le bruit éditorial que la consigne demande d'exclure. La grille déterministe le surestimait (30 %) |
| **Ars Technica** | **2/20 utiles** (les deux articles sécurité) pour ~12 publications par jour : espace, automobile, gadgets, politique, faits divers |
| **IEEE Spectrum (flux principal)** | **3/27** publications récentes utiles (carrière, vie de l'IEEE, contenus sponsorisés), plus 3 articles de 2022 bloqués dans le flux. Remplacé par les flux thématiques |
| **Quanta Magazine** | **1/5** utile : physique et biologie fondamentales. Le flux ne compte que 5 éléments. L'extraction fonctionne (FULL, 15 174 caractères), mais l'éditorial ne correspond pas à Dunggle |

## 4. Points techniques à retenir

- **Project Zero** : le flux Atom attribue le même `<id>` à deux articles différents (« A Deep Dive into the GetProcessHandleFromHwnd API » et « Bypassing Administrator Protection… »). Les URL sont uniques : pour cette source, il faut utiliser `dedupKey` (URL) comme identifiant. C'est aussi pour cela que le POC la marque « ÉCHEC » (identifiants non uniques), alors qu'elle est exploitable.
- **IEEE Spectrum** : des publications anciennes restent bloquées en fin de flux. L'estimation sur 30 jours suppose une fenêtre couverte et sous-estime le flux principal (~0,9/jour mesuré, contre ~1,3/jour sur les 27 publications récentes).
- **MIT Technology Review** : « The Download » est un digest quotidien de ses propres articles, donc un doublon interne. Il faut le filtrer par préfixe de titre, de façon déterministe.
- **Contenu intégral dans les flux** : MIT TR, IEEE, Mollick et Project Zero publient le texte complet dans le flux. Le stockage et l'envoi de ce texte à un LLM restent à valider au regard des conditions d'utilisation de chaque site ; robots.txt n'autorise que l'accès.
- **Doublons** : aucun doublon d'URL ou de titre avec les 12 sources sur l'échantillon. Les seuls doublons trouvés opposent le flux principal IEEE à ses flux thématiques, ce qui est attendu. Le risque de **même sujet** (une annonce OpenAI ou DeepMind reprise par MIT TR) n'est pas mesurable avec 10 publications par source. Il faudra un regroupement par sujet au POC 2.

## 5. Fiabilité de la grille déterministe

- Elle surestime les sources financières : The Quantum Insider passe de 30 % utiles à la grille à 0 % à la revue manuelle, car « contract to develop » est lu comme une nouveauté.
- Elle sous-estime les essais aux titres peu explicites : One Useful Thing passe de 35 % à ~90 %, et Project Zero de 50 % à 100 %.
- Après calibration (règle du contexte de source), elle reste utile pour **ordonner** les sources et repérer les motifs (digest, finance), mais **pas pour décider** seule. Conclusion pour le POC 2 : un pré-filtre par mots-clés ne doit pas exclure de publication. Le tri doit être fait par l'IA, sur le titre et le contenu.

## 6. Couverture avant / après (détail dans `coverage-report.md`)

| Domaine | Avant | Après (+5) | Commentaire |
|---|---|---|---|
| Angular | ✅ releases | ✅ + TypeScript | RFC (GraphQL avec token) et RxJS toujours absents |
| IA | ✅ | ✅ + regard indépendant (MIT TR, Mollick) | Anthropic, Meta et Mistral sans flux officiel |
| Agents IA | ✅ outils | ✅ + usages et impact (Mollick, MIT TR) | — |
| Robotique | ❌ | ✅ IEEE Robotics, MIT TR | Volume modeste mais substantiel |
| Cybersécurité | ⚠️ IA seulement | ⚠️ Project Zero (rare, ~1/mois) | **Lacune partielle** : pas de source sur les ruptures ou campagnes majeures hors recherche Google |
| Quantique | ❌ | ⚠️ marginal (MIT TR, Google Research) | **Lacune** : aucun candidat satisfaisant |
| Matériel | ❌ | ⚠️ marginal (option IEEE Semiconductors) | Lacune si l'option n'est pas retenue |
| Prospective / travail | ⚠️ | ✅ MIT TR, Mollick | — |
| Réglementation | ❌ | ⚠️ marginal (MIT TR) | Lacune assumée (priorité sélective) |
| Nouveaux produits | ❌ | ❌ | **Lacune** : Ars Technica rejeté pour bruit ; aucun candidat ne détecte les produits sans flot commercial |

La veille n'est **pas exhaustive** : ces domaines deviennent détectables, sans garantie de couverture.

## 7. Volume et coûts (détail dans `volume-estimation.md`)

| | Avant (12) | Après (12 + 5) |
|---|---|---|
| Publications / jour (estimé) | ~9,3 | **~13** |
| Publications / mois | ~280 | **~390** |
| Utiles / jour (grille) | ~5,0 | ~6,2 |
| Tokens d'entrée / mois (analyse complète) | ~0,23 M | **~0,42 M** |
| Coût projeté, prix hypothétiques (petit / intermédiaire / grand modèle) | 0,06 / 0,44 / 1,33 $ | **0,10 / 0,71 / 2,14 $** |

Le surplus vient surtout de MIT Technology Review (~3,2/jour, articles longs). Même avec le grand modèle hypothétique et une marge ×3, la projection (~6–7 $/mois) reste sous 10 €. Le tri préalable sur titre (scénario B) **n'économise rien** à ce volume, car presque tout est conservé et le tri ajoute son propre coût.

## 8. Prochaines actions proposées (hors POC 2)

1. Valider la liste des 5 sources, plus l'option semi-conducteurs, puis les ajouter à `sources.config.ts` dans une étape dédiée.
2. Revue humaine des cas ambigus (`editorial-quality-report.md`, § Cas ambigus).
3. Plus tard, éventuellement : tester le blog Google Quantum AI ou IBM Quantum (quantique) et une source sécurité plus fréquente, comme Google Threat Intelligence ou Trail of Bits, si les flux existent.

## 9. Recommandation pour le POC 2

**GO**, sous réserve de valider la liste des sources :
- Les 12 sources existantes, plus les 5 recommandées, sont accessibles, datées et en contenu FULL dans le flux, sans contournement.
- Le volume reste maîtrisé (~13/jour) et compatible avec 10 €/mois, même avec une marge importante.
- La taxonomie, les trois dimensions indépendantes et la rubrique « Mises à jour » sont spécifiées (`taxonomy.md`).
- **Réserves** : quantique, nouveaux produits et sécurité généraliste restent faiblement couverts. Les proportions éditoriales reposent sur de petits échantillons (5 à 30 publications). Les conditions d'utilisation du texte intégral restent à vérifier.
