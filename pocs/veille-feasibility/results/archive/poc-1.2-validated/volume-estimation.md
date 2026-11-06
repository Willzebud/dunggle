# POC 1.2 — Volume et projection des coûts

- **Collecte** : 2026-11-06T12:55:03.180Z → 2026-11-06T12:55:16.067Z ; variantes IEEE : 2026-11-06T12:56:15.298Z (rapports régénérés hors ligne depuis `candidates-raw.json`)
- **Mesuré** = issu des réponses réelles. **Estimé** = calcul ou projection à partir de ces mesures.

## Volumes (estimés à partir des dates mesurées)

| Périmètre | Sources | Publications / jour | / mois | Utiles / jour (Pertinent + MàJ) | Ambiguës / jour |
|---|---|---|---|---|---|
| Avant : 12 sources | 12 | 9.3 | 278 | 5 | 2.7 |
| Après : 12 + 5 recommandées | 17 | 13 | 389 | 6.2 | 3.5 |
| Toutes : 12 + 10 candidates testées (8 + 2 variantes IEEE) | 22 | 36.8 | 1104 | 12 | 12.6 |

## Volume par source candidate

| Source | Publications / jour | Méthode d’estimation | Caractères analysables (médiane flux / extraction) |
|---|---|---|---|
| ✅ TypeScript Blog (Microsoft) | 0.03 | 1 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 10 éléments) | 23082 / — |
| IEEE Spectrum | 0.90 | 27 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 30 éléments) | 6887 / — |
| Quanta Magazine | 0.56 | Flux tronqué : 5 publications en 8.9 j (approximation, échantillon court) | 434 / 15174 |
| ✅ Google Project Zero | 0.03 | 1 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 10 éléments) | 19521 / — |
| ✅ MIT Technology Review | 3.23 | Flux tronqué : 10 publications en 3.1 j (approximation, échantillon court) | 5156 / — |
| The Quantum Insider | 10.00 | Flux tronqué : 10 publications en 1.0 j (approximation, échantillon court) | 6321 / — |
| Ars Technica | 12.22 | Flux tronqué : 20 publications en 1.6 j (approximation, échantillon court) | 1228 / — |
| ✅ One Useful Thing (Ethan Mollick) | 0.03 | 1 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 20 éléments) | 11036 / — |
| ✅ IEEE Spectrum — Robotics | 0.33 | 10 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 30 éléments) | 5352 / — |
| IEEE Spectrum — Semiconductors | 0.17 | 5 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 30 éléments) | 6903 / — |

## Projection des tokens et coûts (aucun appel IA effectué)

Hypothèses (identiques aux POC 1/1.1) : 4 car./token, troncature 6000 car., 400 tokens de prompt, 150 tokens de sortie. Contenu = max(médiane du flux, médiane extraite si l’extraction FULL a été validée).
- **Scénario A** : analyse complète de chaque publication.
- **Scénario B** : tri préalable sur titre + métadonnées pour toutes (~440 tokens entrée / 30 sortie), puis analyse complète seulement des publications PERTINENT / MISE_A_JOUR / AMBIGU. Les autres restent stockées (jamais supprimées) avec leur évaluation de pertinence issue du tri.

| Périmètre | Tokens entrée / mois (A) | (B) | Petit modèle économique A / B | Modèle intermédiaire A / B | Grand modèle A / B |
|---|---|---|---|---|---|
| Avant : 12 sources | 0.23 M | 0.33 M | 0.06 $ / 0.08 $ | 0.44 $ / 0.55 $ | 1.33 $ / 1.65 $ |
| Après : 12 + 5 recommandées | 0.42 M | 0.49 M | 0.10 $ / 0.11 $ | 0.71 $ / 0.76 $ | 2.14 $ / 2.29 $ |
| Toutes : 12 + 10 candidates testées (8 + 2 variantes IEEE) | 1.34 M | 1.43 M | 0.30 $ / 0.30 $ | 2.17 $ / 2.15 $ | 6.51 $ / 6.45 $ |

Prix **hypothétiques** (USD par million de tokens) à remplacer par la grille réelle du fournisseur retenu au POC 2. Objectif : ≤ 10 €/mois d’appels IA, hors hébergement.

**Limites** : volumes issus d’un passage unique (flux tronqués pour les sources actives), proportions issues d’une grille par mots-clés, tokens estimés par la règle 4 caractères ≈ 1 token. Prévoir une marge ×2 à ×3 pour les retraitements, les publications plus longues et les erreurs d’estimation.
