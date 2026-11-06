# POC 2 — Grille d’évaluation des résumés (préparée pour la phase B)

> Aucun LLM évaluateur. Les contrôles automatiques (`src/evaluation/summary-checks.ts`) sont **indicatifs** lorsqu’ils reposent sur des correspondances textuelles. La note de référence est la **revue manuelle** (`review/phase-b-manual-review.template.json`).

## Périmètre

- Seules les **fixtures synthétiques** autorisant un résumé sont évaluées sur ce point : 6 publications avec `summaryExpected: true`, dont deux extraits PARTIAL. Les 30 publications réelles sont en `metadata-only` : aucun résumé n’est attendu, et leur évaluation porte sur la classification.
- `summaryAllowed` : un résumé serait permis (politique × niveau de contenu). `summaryExpected` : un résumé doit effectivement être produit. Il vaut `false` pour une publication exclue (cas de `synthetic:lumio-funding`, test dédié au comportement d’exclusion), et `'if-kept'` lorsque la décision éditoriale est ambiguë.

## Critères (notés de 0 à 2)

| Critère | 0 — insuffisant | 1 — acceptable | 2 — bon | Contrôle automatique |
|---|---|---|---|---|
| **Exactitude factuelle** | Au moins un fait faux | Approximation sans conséquence | Tous les faits exacts | Indicatif : chiffres absents du texte fourni |
| **Informations essentielles** | L’essentiel manque | Partiel | Les faits de référence sont présents, éventuellement paraphrasés | Indicatif : faits de référence retrouvés textuellement (une paraphrase correcte peut échapper au contrôle) |
| **Absence d’invention** | Affirmation absente du texte | Extrapolation légère, signalée | Rien d’inventé | Indicatif : affirmations interdites retrouvées (une invention formulée autrement n’est pas détectée) |
| **Respect du niveau de contenu** | Résumé produit sans autorisation, ou dépassant l’extrait | — | Conforme (aucun résumé en métadonnées seules ou MINIMAL ; limité à l’extrait en PARTIAL) | **Fiable** : présence ou absence du résumé, longueur comparée à l’extrait |
| **Qualité du français** | Incompréhensible ou en anglais | Maladresses | Correct et naturel | Indicatif : langue estimée à partir des mots fréquents (ne juge ni la grammaire ni le style) |
| **Concision et utilité** | Verbeux ou inutile | Utile mais long | Court (≤ 4 phrases, ≤ 600 caractères) et utile pour décider de lire | Indicatif : longueur et nombre de phrases |

**Seuil proposé** pour retenir un modèle : moyenne ≥ 1,5 sur chaque critère, aucun 0 en exactitude, en absence d’invention ou en respect du niveau de contenu. Ce seuil est à valider par le propriétaire du projet.

## Limites d’un appel unique (classification + résumé)

Dunggle effectue **un seul appel** par publication. C’est le choix le plus simple et le moins coûteux.
- Le résumé éventuel est généré **avant** que la décision d’exclusion soit connue. La consigne demande au modèle de ne pas résumer une publication qu’il exclut, et le pipeline supprime tout résumé d’une publication exclue (`summary-on-excluded-dropped`). Les tokens d’un résumé inutile restent toutefois facturés, dans la limite du plafond de sortie de 800 tokens.
- Si une exclusion proposée par le modèle est annulée (couverture obligatoire), le résumé peut manquer, puisque le modèle s’est abstenu. La publication reste visible avec ses métadonnées. Un second appel ciblé ne serait justifié que si ce cas se révélait fréquent en phase B.
- La qualité du résumé et celle de la classification ne sont pas indépendantes : une erreur de compréhension affecte les deux.
- Un découpage en deux appels (classifier, puis résumer seulement les publications conservées) éviterait des résumés inutiles, mais doublerait le coût d’entrée sur les publications conservées. Il n’est pas retenu à ce stade.
