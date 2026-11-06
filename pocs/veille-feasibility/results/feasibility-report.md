# POC 1 — Rapport de faisabilité de la collecte de veille

- **Exécution** : 2026-11-06T13:24:13.024Z → 2026-11-06T13:24:34.116Z (Node.js v22.23.2)
- **Requêtes HTTP effectuées** : 29 (passage unique, séquentiel, 750 ms entre requêtes)
- **User-Agent** : `VeilleTechPOC/0.1 (feasibility study; low-volume, single-run; Node.js fetch)`
- **Token GitHub** : non utilisé (accès anonyme)
- Toutes les données ci-dessous proviennent des réponses réelles des sources au moment de l’exécution.

## 1. Synthèse par source

| # | Source | Catégorie | Statut | Publications (collectées / dans le flux) | Dernière publication | Problèmes éventuels |
|---|---|---|---|---|---|---|
| 1 | Angular Blog | Angular | ✅ OK | 10 / 10 | 2026-10-23 | Page d'accueil inaccessible pour la découverte (403) ; Ni ETag ni Last-Modified : pas de requête conditionnelle possible |
| 2 | GitHub angular/angular | Angular | ✅ OK | 10 / 10 | 2026-11-05 | 4/10 releases sont des pré-versions (next/rc/beta) |
| 3 | GitHub angular/components | Angular | ✅ OK | 10 / 10 | 2026-11-04 | 5/10 releases sont des pré-versions (next/rc/beta) |
| 4 | OpenAI News | Intelligence artificielle | ✅ OK | 10 / 1366 | 2026-11-05 | Ni ETag ni Last-Modified : pas de requête conditionnelle possible ; Contenu limité (médiane 150 caractères) : résumé limité au titre/extrait |
| 5 | Google DeepMind Blog | Intelligence artificielle | ✅ OK | 10 / 100 | 2026-11-05 | Contenu limité (médiane 84 caractères) : résumé limité au titre/extrait |
| 6 | Hugging Face Blog | Intelligence artificielle | ✅ OK | 10 / 899 | 2026-11-06 | Contenu insuffisant (médiane 0 caractères) : résumé limité au titre/extrait |
| 7 | Google Research Blog | Intelligence artificielle | ✅ OK | 10 / 100 | 2026-11-05 | Le champ <description> ne contient que le nom de la catégorie, pas de résumé ni de contenu ; Contenu insuffisant (médiane 15 caractères) : résumé limité au titre/extrait |
| 8 | Simon Willison | Agents IA | ✅ OK | 10 / 30 | 2026-11-05 | Aucun |
| 9 | OpenAI Agents SDK (Python) | Agents IA | ✅ OK | 10 / 10 | 2026-11-03 | 1/10 releases sont des pré-versions (next/rc/beta) |
| 10 | LangGraph | Agents IA | ✅ OK | 10 / 10 | 2026-11-06 | Aucun |
| 11 | MCP TypeScript SDK | Agents IA | ✅ OK | 10 / 10 | 2026-10-23 | Aucun |
| 12 | Claude Code | Agents IA | ✅ OK | 10 / 10 | 2026-11-04 | Aucun |
| 13 | TypeScript Blog (Microsoft) | Angular | ✅ OK | 10 / 10 | 2026-10-20 | Aucun |
| 14 | Google Project Zero | Innovations numériques | ✅ OK | 10 / 10 | 2026-10-27 | Aucun |
| 15 | One Useful Thing (Ethan Mollick) | Transformations et prospective | ✅ OK | 10 / 20 | 2026-10-20 | Aucun |
| 16 | MIT Technology Review | Transformations et prospective | ✅ OK | 7 / 10 | 2026-11-06 | Aucun |
| 17 | IEEE Spectrum — Robotics | Innovations numériques | ✅ OK | 10 / 30 | 2026-11-04 | Aucun |

Statut : **OK** = recommandée pour le MVP ; **PARTIEL** = accessible mais avec une réserve bloquante (dates, fraîcheur, robots.txt…) ; **ÉCHEC** = inaccessible ou inexploitable. Depuis le POC 1.1, l’absence de contenu n’est plus bloquante : elle détermine le mode d’exploitation (FULL / PARTIAL / MINIMAL, voir `content-extraction-report.md`).

## 2. Grille de faisabilité

| Source | Accessible | Exploitable | Dates fiables | Récente | Contenu pour résumé IA | Mode d’exploitation (F/P/M) | Auth. requise | MVP |
|---|---|---|---|---|---|---|---|---|
| Angular Blog | Oui | Oui | Oui | active (13 j) | suffisant (médiane 3159 car.) | FULL (10/0/0) | Non | **Oui** |
| GitHub angular/angular | Oui | Oui | Oui | active (0 j) | suffisant (médiane 4710 car.) | FULL (7/3/0) | Non | **Oui** |
| GitHub angular/components | Oui | Oui | Oui | active (2 j) | suffisant (médiane 1044 car.) | PARTIAL (0/10/0) | Non | **Oui** |
| OpenAI News | Oui | Oui | Oui | active (0 j) | limité (médiane 150 car.) | PARTIAL (0/10/0) | Non | **Oui** |
| Google DeepMind Blog | Oui | Oui | Oui | active (0 j) | limité (médiane 84 car.) | PARTIAL (0/6/4) | Non | **Oui** |
| Hugging Face Blog | Oui | Oui | Oui | active (0 j) | insuffisant (médiane 0 car.) | MINIMAL (0/0/10) | Non | **Oui** |
| Google Research Blog | Oui | Oui | Oui | active (0 j) | insuffisant (médiane 15 car.) | MINIMAL (0/0/10) | Non | **Oui** |
| Simon Willison | Oui | Oui | Oui | active (0 j) | suffisant (médiane 511 car.) | PARTIAL (3/7/0) | Non | **Oui** |
| OpenAI Agents SDK (Python) | Oui | Oui | Oui | active (2 j) | suffisant (médiane 6121 car.) | FULL (9/1/0) | Non | **Oui** |
| LangGraph | Oui | Oui | Oui | active (0 j) | suffisant (médiane 403 car.) | PARTIAL (0/10/0) | Non | **Oui** |
| MCP TypeScript SDK | Oui | Oui | Oui | active (13 j) | suffisant (médiane 1159 car.) | PARTIAL (4/5/1) | Non | **Oui** |
| Claude Code | Oui | Oui | Oui | active (2 j) | suffisant (médiane 10146 car.) | FULL (9/0/1) | Non | **Oui** |
| TypeScript Blog (Microsoft) | Oui | Oui | Oui | active (16 j) | suffisant (médiane 23082 car.) | FULL (10/0/0) | Non | **Oui** |
| Google Project Zero | Oui | Oui | Oui | active (10 j) | suffisant (médiane 19521 car.) | FULL (10/0/0) | Non | **Oui** |
| One Useful Thing (Ethan Mollick) | Oui | Oui | Oui | active (16 j) | suffisant (médiane 10563 car.) | FULL (10/0/0) | Non | **Oui** |
| MIT Technology Review | Oui | Oui | Oui | active (0 j) | suffisant (médiane 4818 car.) | FULL (6/1/0) | Non | **Oui** |
| IEEE Spectrum — Robotics | Oui | Oui | Oui | active (1 j) | suffisant (médiane 5600 car.) | FULL (9/1/0) | Non | **Oui** |

Seuils : récente ≤ 30 j, peu active ≤ 90 j ; contenu suffisant ≥ 300 caractères de texte, limité ≥ 80. Mode d’exploitation = niveau de contenu majoritaire des publications du flux (F/P/M = nombre de publications FULL/PARTIAL/MINIMAL), avant extraction éventuelle de la page.

## 3. Détail par source

### Angular Blog — ✅ OK

- URL configurée : https://blog.angular.dev/
- URL effective : https://blog.angular.dev/feed (format : rss)
- Requête : `GET https://blog.angular.dev/` → 403, text/html; charset=UTF-8, 5609 octets, 352 ms
- Requête : `GET https://blog.angular.dev/feed` → 200, text/xml; charset=UTF-8, 61172 octets, 362 ms
- Requête : `GET https://blog.angular.dev/robots.txt` → 200, text/plain, 890 octets, 98 ms
- robots.txt : robots.txt lu ; aucune règle ne bloque ce chemin
- ⚠️ robots.txt exclut des robots d’IA (signal de réutilisation) : GPTBot, ClaudeBot, Applebot-Extended, Bytespider, meta-externalagent, Amazonbot
- Dates : Dates présentes, valides et cohérentes
- Authentification : Aucune authentification requise
- Restrictions / limites : Page d'accueil inaccessible pour la découverte (403) ; Ni ETag ni Last-Modified : pas de requête conditionnelle possible
- Remarques : Test des chemins conventionnels : /feed, /rss.xml, /feed.xml
- Volume estimé : 0.07 / jour — 2 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 10 éléments)
- Recommandée pour le MVP : **Oui**

### GitHub angular/angular — ✅ OK

- URL configurée : https://api.github.com/repos/angular/angular/releases
- URL effective : https://api.github.com/repos/angular/angular/releases?per_page=10 (format : json)
- Requête : `GET https://api.github.com/repos/angular/angular/releases?per_page=10` → 200, application/json; charset=utf-8, 89708 octets, 552 ms
- Dates : Dates présentes, valides et cohérentes
- Authentification : Non requise. API GitHub : 60 req/h avec la configuration actuelle (sans token : 60/h par IP, 5000/h avec token), restant 57
- Restrictions / limites : Quota API GitHub (60 req/h sans token) ; 4/10 releases sont des pré-versions (next/rc/beta)
- Volume estimé : 0.35 / jour — Flux tronqué : 10 publications en 28.8 j (approximation, échantillon court)
- Recommandée pour le MVP : **Oui**

### GitHub angular/components — ✅ OK

- URL configurée : https://api.github.com/repos/angular/components/releases
- URL effective : https://api.github.com/repos/angular/components/releases?per_page=10 (format : json)
- Requête : `GET https://api.github.com/repos/angular/components/releases?per_page=10` → 200, application/json; charset=utf-8, 29629 octets, 362 ms
- Dates : Dates présentes, valides et cohérentes
- Authentification : Non requise. API GitHub : 60 req/h avec la configuration actuelle (sans token : 60/h par IP, 5000/h avec token), restant 56
- Restrictions / limites : Quota API GitHub (60 req/h sans token) ; 5/10 releases sont des pré-versions (next/rc/beta)
- Volume estimé : 0.33 / jour — Flux tronqué : 10 publications en 29.9 j (approximation, échantillon court)
- Recommandée pour le MVP : **Oui**

### OpenAI News — ✅ OK

- URL configurée : https://openai.com/news/rss.xml
- URL effective : https://openai.com/news/rss.xml (format : rss)
- Requête : `GET https://openai.com/news/rss.xml` → 200, text/xml; charset=utf-8, 831593 octets, 333 ms
- Requête : `GET https://openai.com/robots.txt` → 200, text/plain; charset=utf-8, 98 octets, 78 ms
- robots.txt : robots.txt lu ; règle « Allow: / »
- Dates : Dates présentes, valides et cohérentes
- Authentification : Aucune authentification requise
- Restrictions / limites : Ni ETag ni Last-Modified : pas de requête conditionnelle possible ; Contenu limité (médiane 150 caractères) : résumé limité au titre/extrait
- Remarques : 4 publication(s) partagent un identifiant natif : identification par URL normalisée pour celles-ci
- Volume estimé : 2.8 / jour — 84 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 1366 éléments)
- Recommandée pour le MVP : **Oui**

### Google DeepMind Blog — ✅ OK

- URL configurée : https://deepmind.google/blog/rss.xml
- URL effective : https://deepmind.google/blog/rss.xml (format : rss)
- Requête : `GET https://deepmind.google/blog/rss.xml` → 200, application/xml, 70178 octets, 323 ms
- Requête : `GET https://deepmind.google/robots.txt` → 200, text/plain, 69 octets, 99 ms
- robots.txt : robots.txt lu ; règle « Allow: / »
- Dates : Dates présentes, valides et cohérentes
- Authentification : Aucune authentification requise
- Restrictions / limites : Contenu limité (médiane 84 caractères) : résumé limité au titre/extrait
- Volume estimé : 0.37 / jour — 11 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 100 éléments)
- Recommandée pour le MVP : **Oui**

### Hugging Face Blog — ✅ OK

- URL configurée : https://huggingface.co/blog/feed.xml
- URL effective : https://huggingface.co/blog/feed.xml (format : rss)
- Requête : `GET https://huggingface.co/blog/feed.xml` → 200, application/rss+xml; charset=utf-8, 265669 octets, 348 ms
- Requête : `GET https://huggingface.co/robots.txt` → 200, text/plain, 68 octets, 185 ms
- robots.txt : robots.txt lu ; règle « Allow: / »
- Dates : Dates présentes, valides et cohérentes
- Authentification : Aucune authentification requise
- Restrictions / limites : Contenu insuffisant (médiane 0 caractères) : résumé limité au titre/extrait
- Volume estimé : 0.9 / jour — 27 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 899 éléments)
- Recommandée pour le MVP : **Oui**

### Google Research Blog — ✅ OK

- URL configurée : https://research.google/blog/rss/
- URL effective : https://research.google/blog/rss/ (format : rss)
- Requête : `GET https://research.google/blog/rss/` → 200, application/rss+xml; charset=utf-8, 78411 octets, 569 ms
- Requête : `GET https://research.google/robots.txt` → 200, text/plain, 68 octets, 171 ms
- robots.txt : robots.txt lu ; règle « Allow: / »
- Dates : Dates présentes, valides et cohérentes
- Authentification : Aucune authentification requise
- Restrictions / limites : Le champ <description> ne contient que le nom de la catégorie, pas de résumé ni de contenu ; Contenu insuffisant (médiane 15 caractères) : résumé limité au titre/extrait
- Volume estimé : 0.33 / jour — 10 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 100 éléments)
- Recommandée pour le MVP : **Oui**

### Simon Willison — ✅ OK

- URL configurée : https://simonwillison.net/atom/everything/
- URL effective : https://simonwillison.net/atom/everything/ (format : atom)
- Requête : `GET https://simonwillison.net/atom/everything/` → 200, application/xml; charset=utf-8, 119092 octets, 300 ms
- Requête : `GET https://simonwillison.net/robots.txt` → 200, text/plain, 136 octets, 103 ms
- robots.txt : robots.txt lu ; aucune règle ne bloque ce chemin
- Dates : Dates présentes, valides et cohérentes
- Authentification : Aucune authentification requise
- Volume estimé : 2.18 / jour — Flux tronqué : 30 publications en 13.7 j (approximation, échantillon court)
- Recommandée pour le MVP : **Oui**

### OpenAI Agents SDK (Python) — ✅ OK

- URL configurée : https://api.github.com/repos/openai/openai-agents-python/releases
- URL effective : https://api.github.com/repos/openai/openai-agents-python/releases?per_page=10 (format : json)
- Requête : `GET https://api.github.com/repos/openai/openai-agents-python/releases?per_page=10` → 200, application/json; charset=utf-8, 133163 octets, 541 ms
- Dates : Dates présentes, valides et cohérentes
- Authentification : Non requise. API GitHub : 60 req/h avec la configuration actuelle (sans token : 60/h par IP, 5000/h avec token), restant 55
- Restrictions / limites : Quota API GitHub (60 req/h sans token) ; 1/10 releases sont des pré-versions (next/rc/beta)
- Volume estimé : 0.07 / jour — 2 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 10 éléments)
- Recommandée pour le MVP : **Oui**

### LangGraph — ✅ OK

- URL configurée : https://api.github.com/repos/langchain-ai/langgraph/releases
- URL effective : https://api.github.com/repos/langchain-ai/langgraph/releases?per_page=10 (format : json)
- Requête : `GET https://api.github.com/repos/langchain-ai/langgraph/releases?per_page=10` → 200, application/json; charset=utf-8, 24962 octets, 458 ms
- Dates : Dates présentes, valides et cohérentes
- Authentification : Non requise. API GitHub : 60 req/h avec la configuration actuelle (sans token : 60/h par IP, 5000/h avec token), restant 54
- Restrictions / limites : Quota API GitHub (60 req/h sans token)
- Volume estimé : 0.93 / jour — Flux tronqué : 10 publications en 10.7 j (approximation, échantillon court)
- Recommandée pour le MVP : **Oui**

### MCP TypeScript SDK — ✅ OK

- URL configurée : https://api.github.com/repos/modelcontextprotocol/typescript-sdk/releases
- URL effective : https://api.github.com/repos/modelcontextprotocol/typescript-sdk/releases?per_page=10 (format : json)
- Requête : `GET https://api.github.com/repos/modelcontextprotocol/typescript-sdk/releases?per_page=10` → 200, application/json; charset=utf-8, 40790 octets, 419 ms
- Dates : Dates présentes, valides et cohérentes
- Authentification : Non requise. API GitHub : 60 req/h avec la configuration actuelle (sans token : 60/h par IP, 5000/h avec token), restant 53
- Restrictions / limites : Quota API GitHub (60 req/h sans token)
- Volume estimé : 0.27 / jour — 8 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 10 éléments)
- Recommandée pour le MVP : **Oui**

### Claude Code — ✅ OK

- URL configurée : https://api.github.com/repos/anthropics/claude-code/releases
- URL effective : https://api.github.com/repos/anthropics/claude-code/releases?per_page=10 (format : json)
- Requête : `GET https://api.github.com/repos/anthropics/claude-code/releases?per_page=10` → 200, application/json; charset=utf-8, 262928 octets, 460 ms
- Dates : Dates présentes, valides et cohérentes
- Authentification : Non requise. API GitHub : 60 req/h avec la configuration actuelle (sans token : 60/h par IP, 5000/h avec token), restant 52
- Restrictions / limites : Quota API GitHub (60 req/h sans token)
- Volume estimé : 0.64 / jour — Flux tronqué : 10 publications en 15.6 j (approximation, échantillon court)
- Recommandée pour le MVP : **Oui**

### TypeScript Blog (Microsoft) — ✅ OK

- URL configurée : https://devblogs.microsoft.com/typescript/feed/
- URL effective : https://devblogs.microsoft.com/typescript/feed/ (format : rss)
- Requête : `GET https://devblogs.microsoft.com/typescript/feed/` → 200, application/rss+xml; charset=UTF-8, 365868 octets, 261 ms
- Requête : `GET https://devblogs.microsoft.com/robots.txt` → 200, text/plain; charset=utf-8, 9636 octets, 58 ms
- robots.txt : robots.txt lu ; aucune règle ne bloque ce chemin
- Dates : Dates présentes, valides et cohérentes
- Authentification : Aucune authentification requise
- Volume estimé : 0.03 / jour — 1 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 10 éléments)
- Recommandée pour le MVP : **Oui**

### Google Project Zero — ✅ OK

- URL configurée : https://projectzero.google/feed.xml
- URL effective : https://projectzero.google/feed.xml (format : atom)
- Requête : `GET https://projectzero.google/feed.xml` → 200, text/xml, 901883 octets, 435 ms
- Requête : `GET https://projectzero.google/robots.txt` → 404, text/html; charset=UTF-8, 1571 octets, 111 ms
- robots.txt : pas de robots.txt (404) : aucune restriction déclarée ; aucune règle ne bloque ce chemin
- Dates : Dates présentes, valides et cohérentes
- Authentification : Aucune authentification requise
- Volume estimé : 0.03 / jour — 1 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 10 éléments)
- Recommandée pour le MVP : **Oui**

### One Useful Thing (Ethan Mollick) — ✅ OK

- URL configurée : https://www.oneusefulthing.org/feed
- URL effective : https://www.oneusefulthing.org/feed (format : rss)
- Requête : `GET https://www.oneusefulthing.org/feed` → 200, application/xml; charset=utf-8, 922268 octets, 296 ms
- Requête : `GET https://www.oneusefulthing.org/robots.txt` → 200, text/plain; charset=utf-8, 605 octets, 191 ms
- robots.txt : robots.txt lu ; aucune règle ne bloque ce chemin
- Dates : Dates présentes, valides et cohérentes
- Authentification : Aucune authentification requise
- Volume estimé : 0.03 / jour — 1 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 20 éléments)
- Recommandée pour le MVP : **Oui**

### MIT Technology Review — ✅ OK

- URL configurée : https://www.technologyreview.com/feed/
- URL effective : https://www.technologyreview.com/feed/ (format : rss)
- Requête : `GET https://www.technologyreview.com/feed/` → 200, application/rss+xml; charset=UTF-8, 103341 octets, 155 ms
- Requête : `GET https://www.technologyreview.com/robots.txt` → 200, text/plain; charset=utf-8, 1920 octets, 52 ms
- robots.txt : robots.txt lu ; aucune règle ne bloque ce chemin
- ⚠️ robots.txt exclut des robots d’IA (signal de réutilisation) : GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, Claude-Web, anthropic-ai, CCBot, Google-Extended, Applebot-Extended, Bytespider, PerplexityBot, meta-externalagent, Amazonbot, cohere-ai
- Règle éditoriale : 3 publication(s) exclue(s), conservée(s) dans `articles.json > excluded` (« The Download: Texas’s fragile AI boom and energy policy shifts », « The Download: blended meat, restored sight, and the agentic web », « The Download: controlling AI agents and “Super Intelligence” loyalty tests »)
- Dates : Dates présentes, valides et cohérentes
- Authentification : Aucune authentification requise
- Volume estimé : 3.21 / jour — Flux tronqué : 10 publications en 3.1 j (approximation, échantillon court)
- Recommandée pour le MVP : **Oui**

### IEEE Spectrum — Robotics — ✅ OK

- URL configurée : https://spectrum.ieee.org/feeds/topic/robotics.rss
- URL effective : https://spectrum.ieee.org/feeds/topic/robotics.rss (format : rss)
- Requête : `GET https://spectrum.ieee.org/feeds/topic/robotics.rss` → 200, application/rss+xml; charset=utf-8, 383043 octets, 521 ms
- Requête : `GET https://spectrum.ieee.org/robots.txt` → 200, text/plain, 2781 octets, 62 ms
- robots.txt : robots.txt lu ; aucune règle ne bloque ce chemin
- ⚠️ robots.txt exclut des robots d’IA (signal de réutilisation) : GPTBot, ClaudeBot, anthropic-ai, CCBot, Google-Extended, Applebot-Extended, Bytespider, PerplexityBot, meta-externalagent, Amazonbot, cohere-ai
- Règle éditoriale : 4 compilation(s) récurrente(s) marquée(s), conservée(s) dans `articles`
- Dates : Dates présentes, valides et cohérentes
- Authentification : Aucune authentification requise
- Volume estimé : 0.33 / jour — 10 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 30 éléments)
- Recommandée pour le MVP : **Oui**

## 4. Bilan par catégorie

| Catégorie | Priorité | Sources testées | Sources OK | Objectif ≥ 3 | Volume estimé / jour |
|---|---|---|---|---|---|
| Angular | Maximale | 4 | 4 | ✅ Atteint | ~0.8 |
| Intelligence artificielle | Maximale | 4 | 4 | ✅ Atteint | ~4.4 |
| Agents IA | Maximale | 5 | 5 | ✅ Atteint | ~4.1 |
| Innovations numériques | Sélective | 2 | 2 | Sans objectif | ~0.4 |
| Transformations et prospective | Sélective | 2 | 2 | Sans objectif | ~3.2 |

**Angular** : 4/4 sources OK (Angular Blog, GitHub angular/angular, GitHub angular/components, TypeScript Blog (Microsoft)).

**Intelligence artificielle** : 4/4 sources OK (OpenAI News, Google DeepMind Blog, Hugging Face Blog, Google Research Blog).

**Agents IA** : 5/5 sources OK (Simon Willison, OpenAI Agents SDK (Python), LangGraph, MCP TypeScript SDK, Claude Code).

**Innovations numériques** : 2/2 sources OK (Google Project Zero, IEEE Spectrum — Robotics).

**Transformations et prospective** : 2/2 sources OK (One Useful Thing (Ethan Mollick), MIT Technology Review).

## 5. Estimation du volume quotidien

**Total estimé : ~12.9 nouvelles publications par jour** (≈ 387 par mois), sources en échec exclues.

| Source | Publications / jour | Méthode |
|---|---|---|
| Angular Blog | 0.07 | 2 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 10 éléments) |
| GitHub angular/angular | 0.35 | Flux tronqué : 10 publications en 28.8 j (approximation, échantillon court) |
| GitHub angular/components | 0.33 | Flux tronqué : 10 publications en 29.9 j (approximation, échantillon court) |
| OpenAI News | 2.8 | 84 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 1366 éléments) |
| Google DeepMind Blog | 0.37 | 11 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 100 éléments) |
| Hugging Face Blog | 0.9 | 27 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 899 éléments) |
| Google Research Blog | 0.33 | 10 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 100 éléments) |
| Simon Willison | 2.18 | Flux tronqué : 30 publications en 13.7 j (approximation, échantillon court) |
| OpenAI Agents SDK (Python) | 0.07 | 2 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 10 éléments) |
| LangGraph | 0.93 | Flux tronqué : 10 publications en 10.7 j (approximation, échantillon court) |
| MCP TypeScript SDK | 0.27 | 8 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 10 éléments) |
| Claude Code | 0.64 | Flux tronqué : 10 publications en 15.6 j (approximation, échantillon court) |
| TypeScript Blog (Microsoft) | 0.03 | 1 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 10 éléments) |
| Google Project Zero | 0.03 | 1 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 10 éléments) |
| One Useful Thing (Ethan Mollick) | 0.03 | 1 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 20 éléments) |
| MIT Technology Review | 3.21 | Flux tronqué : 10 publications en 3.1 j (approximation, échantillon court) |
| IEEE Spectrum — Robotics | 0.33 | 10 publication(s) sur les 30 derniers jours (fenêtre couverte par le flux de 30 éléments) |

**Limites de l’estimation :**
- Basée sur un seul passage : les flux ne contiennent qu’un nombre limité d’éléments récents et les releases GitHub sont limitées à 10 par dépôt, ce qui rend l’estimation imprécise pour les sources très actives (flux « tronqués »).
- L’activité est irrégulière (pics lors des sorties majeures, conférences, annonces) ; une moyenne sur 30 jours lisse ces pics.
- Les releases GitHub incluent des pré-versions et des correctifs mineurs, qui gonflent le volume sans forcément représenter une actualité à résumer.
- Une mesure fiable nécessiterait des collectes répétées (ex. quotidiennes) pendant plusieurs semaines, hors périmètre de ce POC.

## 6. Projection pour le POC 2 (aucun appel IA effectué)

Hypothèses : 4 caractères ≈ 1 token ; contenu tronqué à 6000 caractères ; 400 tokens de consignes ; 150 tokens de sortie par publication ; un seul appel par publication (pas de retraitement).

- Tokens d’entrée estimés : **~0.35 M / mois**
- Tokens de sortie estimés : **~0.06 M / mois**

| Scénario de prix (hypothétique, à vérifier) | Entrée $/M | Sortie $/M | Coût estimé / mois |
|---|---|---|---|
| Petit modèle économique | 0.15 | 0.6 | ~0.09 $ |
| Modèle intermédiaire | 1 | 5 | ~0.64 $ |
| Grand modèle | 3 | 15 | ~1.93 $ |

Ces prix sont des ordres de grandeur illustratifs et non une grille tarifaire officielle : ils devront être confrontés aux tarifs du fournisseur retenu au démarrage du POC 2.

## 7. Conclusion

- Critère « ≥ 3 sources fonctionnelles par catégorie » : ✅ atteint pour les catégories prioritaires (Angular 4/3, Intelligence artificielle 4/3, Agents IA 5/3).
- Sources gratuites : ✅ toutes les sources testées sont publiques et gratuites (flux RSS/Atom et API GitHub publique ; quota anonyme de 60 req/h largement suffisant pour 6 dépôts collectés quelques fois par jour).
- Contournement : ✅ aucun (pas de scraping, pas de contournement anti-bot ; robots.txt vérifié pour les flux).
- Budget IA : avec un modèle intermédiaire hypothétique, ~0.64 $/mois pour le volume mesuré (projection conservatrice : les publications exclues par règle éditoriale sont comptées dans le volume).
- Règles éditoriales ciblées : 3 publication(s) exclue(s) avec trace, 4 compilation(s) marquée(s) et conservée(s). Aucun filtre général par mot-clé.
- ⚠️ Signaux de réutilisation : le robots.txt de Angular Blog, MIT Technology Review, IEEE Spectrum — Robotics exclut des robots d’IA. À examiner avant d’envoyer leur texte intégral à un LLM.

**Verdict : GO pour le POC 2** (analyse et classification par IA sous 10 €/mois), sous réserve des points listés ci-dessus.
