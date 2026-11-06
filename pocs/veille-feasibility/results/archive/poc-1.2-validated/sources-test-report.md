# POC 1.2 — Tests techniques des sources candidates

- **Collecte** : 2026-11-06T12:55:03.180Z → 2026-11-06T12:55:16.067Z ; variantes IEEE : 2026-11-06T12:56:15.298Z (rapports régénérés hors ligne depuis `candidates-raw.json`)
- **Mesuré** = issu des réponses réelles. **Estimé** = calcul ou projection à partir de ces mesures.

## Synthèse (mesuré)

| Source | Type | Statut | HTTP | robots.txt | Publications (échantillon / flux) | Dates fiables | Dernière | Volume / jour (estimé) | Contenu du flux | Extraction HTML (1 page) | URL vers l’article |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TypeScript Blog (Microsoft) | rss | OK | 200 | ✅ | 10 / 10 | Oui | 2026-10-20 | 0.03 | FULL (10/0/0) | non nécessaire (flux FULL) | 10/10 |
| IEEE Spectrum | rss | OK | 200 | ✅ | 30 / 30 | Oui | 2026-11-05 | 0.90 | FULL (28/2/0) | non nécessaire (flux FULL) | 30/30 |
| Quanta Magazine | rss | OK | 200 | ✅ | 5 / 5 | Oui | 2026-11-04 | 0.56 | PARTIAL (0/5/0) | 200 → FULL (15174 car.) | 5/5 |
| Google Project Zero | atom | ÉCHEC | 200 | ✅ | 10 / 10 | Oui | 2026-10-27 | 0.03 | FULL (10/0/0) | non nécessaire (flux FULL) | 10/10 |
| MIT Technology Review | rss | OK | 200 | ✅ | 10 / 10 | Oui | 2026-11-06 | 3.23 | FULL (9/1/0) | non nécessaire (flux FULL) | 10/10 |
| The Quantum Insider | rss | OK | 200 | ✅ | 10 / 10 | Oui | 2026-11-06 | 10.00 | FULL (10/0/0) | non nécessaire (flux FULL) | 10/10 |
| Ars Technica | rss | OK | 200 | ✅ | 20 / 20 | Oui | 2026-11-06 | 12.22 | FULL (11/9/0) | non nécessaire (flux FULL) | 20/20 |
| One Useful Thing (Ethan Mollick) | rss | OK | 200 | ✅ | 20 / 20 | Oui | 2026-10-20 | 0.03 | FULL (20/0/0) | non nécessaire (flux FULL) | 20/20 |
| IEEE Spectrum — Robotics | rss | OK | 200 | ✅ | 30 / 30 | Oui | 2026-11-04 | 0.33 | FULL (28/2/0) | non nécessaire (flux FULL) | 30/30 |
| IEEE Spectrum — Semiconductors | rss | OK | 200 | ✅ | 30 / 30 | Oui | 2026-10-23 | 0.17 | FULL (29/1/0) | non nécessaire (flux FULL) | 30/30 |

Contenu du flux : mode majoritaire et répartition FULL/PARTIAL/MINIMAL (critères de `src/content-level.ts`, POC 1.1). Extraction HTML : Readability, 1 page la plus récente, uniquement si robots.txt l’autorise.

## Détail par source

### TypeScript Blog (Microsoft)

- Lacune visée : TypeScript (priorité A) : aucune source dédiée, alors que les versions TS conditionnent Angular
- URL configurée : https://devblogs.microsoft.com/typescript/feed/ → effective : https://devblogs.microsoft.com/typescript/feed/
- `GET https://devblogs.microsoft.com/typescript/feed/` → 200, application/rss+xml; charset=UTF-8, 365868 o
- `GET https://devblogs.microsoft.com/robots.txt` → 200, text/plain; charset=utf-8, 9636 o
- robots.txt : robots.txt lu ; aucune règle ne bloque ce chemin
- Dates : Dates présentes, valides et cohérentes ; fraîcheur : active (16 j)
- Volume : 1 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 10 éléments)
- Limites : Le flux ne contient que 10 publication(s)
- Conditions d’utilisation : à vérifier humainement (robots.txt ne vaut pas licence de réutilisation du texte).

### IEEE Spectrum

- Lacune visée : Robotique, matériel, semi-conducteurs, quantique : aucune couverture hors IA
- URL configurée : https://spectrum.ieee.org/feeds/feed.rss → effective : https://spectrum.ieee.org/feeds/feed.rss
- `GET https://spectrum.ieee.org/feeds/feed.rss` → 200, application/rss+xml; charset=utf-8, 414113 o
- `GET https://spectrum.ieee.org/robots.txt` → 200, text/plain, 2781 o
- robots.txt : robots.txt lu ; aucune règle ne bloque ce chemin
- Dates : Dates présentes, valides et cohérentes ; fraîcheur : active (0 j)
- Volume : 27 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 30 éléments)
- Conditions d’utilisation : à vérifier humainement (robots.txt ne vaut pas licence de réutilisation du texte).

### Quanta Magazine

- Lacune visée : Percées en informatique théorique et physique quantique
- URL configurée : https://www.quantamagazine.org/feed/ → effective : https://www.quantamagazine.org/feed/
- `GET https://www.quantamagazine.org/feed/` → 200, application/rss+xml; charset=UTF-8, 11137 o
- `GET https://www.quantamagazine.org/robots.txt` → 200, text/plain; charset=utf-8, 121 o
- robots.txt : robots.txt lu ; aucune règle ne bloque ce chemin
- Dates : Dates présentes, valides et cohérentes ; fraîcheur : active (1 j)
- Volume : Flux tronqué : 5 publications en 8.9 j (approximation, échantillon court)
- Limites : Le flux ne contient que 5 publication(s)
- Extraction : https://www.quantamagazine.org/new-research-tests-whether-ai-models-know-their-own-thoughts-20261104/ → HTTP 200, 15174 caractères, niveau FULL
- Conditions d’utilisation : à vérifier humainement (robots.txt ne vaut pas licence de réutilisation du texte).

### Google Project Zero

- Lacune visée : Cybersécurité : ruptures techniques (recherche de vulnérabilités), aucune source dédiée
- URL configurée : https://googleprojectzero.blogspot.com/ → effective : https://projectzero.google/feed.xml
- `GET https://googleprojectzero.blogspot.com/` → 200 (→ https://projectzero.google/), text/html, 48127 o
- `GET https://projectzero.google/feed.xml` → 200, text/xml, 901883 o
- `GET https://projectzero.google/robots.txt` → 404, text/html; charset=UTF-8, 1571 o
- robots.txt : pas de robots.txt (404) : aucune restriction déclarée ; aucune règle ne bloque ce chemin
- Dates : Dates présentes, valides et cohérentes ; fraîcheur : active (10 j)
- Volume : 1 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 10 éléments)
- Limites : Identifiants non uniques ; Redirection HTTP (suivie) ; Le flux ne contient que 10 publication(s)
- Remarques : Redirection page d'accueil : https://googleprojectzero.blogspot.com/ → https://projectzero.google/ ; Flux découvert via <link rel="alternate"> : https://projectzero.google/feed.xml
- Conditions d’utilisation : à vérifier humainement (robots.txt ne vaut pas licence de réutilisation du texte).

### MIT Technology Review

- Lacune visée : Prospective : impact de l’IA et des technologies sur le travail et la société
- URL configurée : https://www.technologyreview.com/feed/ → effective : https://www.technologyreview.com/feed/
- `GET https://www.technologyreview.com/feed/` → 200, application/rss+xml; charset=UTF-8, 103341 o
- `GET https://www.technologyreview.com/robots.txt` → 200, text/plain; charset=utf-8, 1920 o
- robots.txt : robots.txt lu ; aucune règle ne bloque ce chemin
- Dates : Dates présentes, valides et cohérentes ; fraîcheur : active (0 j)
- Volume : Flux tronqué : 10 publications en 3.1 j (approximation, échantillon court)
- Limites : Le flux ne contient que 10 publication(s)
- Conditions d’utilisation : à vérifier humainement (robots.txt ne vaut pas licence de réutilisation du texte).

### The Quantum Insider

- Lacune visée : Quantique : actualité spécialisée (test du bruit business/financement)
- URL configurée : https://thequantuminsider.com/feed/ → effective : https://thequantuminsider.com/feed/
- `GET https://thequantuminsider.com/feed/` → 200, application/rss+xml; charset=UTF-8, 146822 o
- `GET https://thequantuminsider.com/robots.txt` → 200, text/plain; charset=UTF-8, 2731 o
- robots.txt : robots.txt lu ; aucune règle ne bloque ce chemin
- Dates : Dates présentes, valides et cohérentes ; fraîcheur : active (0 j)
- Volume : Flux tronqué : 10 publications en 1.0 j (approximation, échantillon court)
- Limites : Le flux ne contient que 10 publication(s)
- Conditions d’utilisation : à vérifier humainement (robots.txt ne vaut pas licence de réutilisation du texte).

### Ars Technica

- Lacune visée : Nouveaux produits et sécurité grand public (test d’un média tech généraliste)
- URL configurée : https://feeds.arstechnica.com/arstechnica/index → effective : https://feeds.arstechnica.com/arstechnica/index
- `GET https://feeds.arstechnica.com/arstechnica/index` → 200, text/xml; charset=utf-8, 75742 o
- `GET https://feeds.arstechnica.com/robots.txt` → 404, text/html, 518445 o
- robots.txt : pas de robots.txt (404) : aucune restriction déclarée ; aucune règle ne bloque ce chemin
- Dates : Dates présentes, valides et cohérentes ; fraîcheur : active (0 j)
- Volume : Flux tronqué : 20 publications en 1.6 j (approximation, échantillon court)
- Limites : Le flux ne contient que 20 publication(s)
- Conditions d’utilisation : à vérifier humainement (robots.txt ne vaut pas licence de réutilisation du texte).

### One Useful Thing (Ethan Mollick)

- Lacune visée : Transformation du travail par l’IA et les agents (analyse de fond)
- URL configurée : https://www.oneusefulthing.org/feed → effective : https://www.oneusefulthing.org/feed
- `GET https://www.oneusefulthing.org/feed` → 200, application/xml; charset=utf-8, 922268 o
- `GET https://www.oneusefulthing.org/robots.txt` → 200, text/plain; charset=utf-8, 605 o
- robots.txt : robots.txt lu ; aucune règle ne bloque ce chemin
- Dates : Dates présentes, valides et cohérentes ; fraîcheur : active (16 j)
- Volume : 1 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 20 éléments)
- Limites : Le flux ne contient que 20 publication(s)
- Conditions d’utilisation : à vérifier humainement (robots.txt ne vaut pas licence de réutilisation du texte).

### IEEE Spectrum — Robotics

- Lacune visée : Variante thématique d’IEEE Spectrum : robotique
- URL configurée : https://spectrum.ieee.org/feeds/topic/robotics.rss → effective : https://spectrum.ieee.org/feeds/topic/robotics.rss
- `GET https://spectrum.ieee.org/feeds/topic/robotics.rss` → 200, application/rss+xml; charset=utf-8, 383043 o
- `GET https://spectrum.ieee.org/robots.txt` → 200, text/plain, 2781 o
- robots.txt : robots.txt lu ; aucune règle ne bloque ce chemin
- Dates : Dates présentes, valides et cohérentes ; fraîcheur : active (1 j)
- Volume : 10 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 30 éléments)
- Conditions d’utilisation : à vérifier humainement (robots.txt ne vaut pas licence de réutilisation du texte).

### IEEE Spectrum — Semiconductors

- Lacune visée : Variante thématique d’IEEE Spectrum : semi-conducteurs / matériel
- URL configurée : https://spectrum.ieee.org/feeds/topic/semiconductors.rss → effective : https://spectrum.ieee.org/feeds/topic/semiconductors.rss
- `GET https://spectrum.ieee.org/feeds/topic/semiconductors.rss` → 200, application/rss+xml; charset=utf-8, 385574 o
- robots.txt : robots.txt lu ; aucune règle ne bloque ce chemin
- Dates : Dates présentes, valides et cohérentes ; fraîcheur : active (13 j)
- Volume : 5 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 30 éléments)
- Conditions d’utilisation : à vérifier humainement (robots.txt ne vaut pas licence de réutilisation du texte).
