# Réutilisation du contenu : restrictions non résolues

> État au 2026-11-06, après l'intégration des 17 sources. Ce document recense les **signaux techniques mesurés** et ce qui **reste à vérifier**. Ce n'est pas un avis juridique.

## Ce que les POC vérifient (techniquement)

- **robots.txt** de chaque domaine : les règles du groupe `User-agent: *` pour notre accès, et depuis la consolidation, la détection des **robots d'IA exclus du site entier** (`aiCrawlersDisallowed` dans `sources-report.json`).
- Les en-têtes `X-Robots-Tag`, `meta robots` et `tdm-reservation`, seulement sur les pages extraites (POC 1.1). Aucun signal restrictif n'a été trouvé sur ces pages.
- Les protections anti-bot (challenge Cloudflare) : signalées, jamais contournées.

## Signaux mesurés par source

| Source | Accès automatisé | Texte intégral disponible | Signal de réutilisation par une IA |
|---|---|---|---|
| Angular Blog (Medium) | Flux ✅ ; pages 403 (anti-bot) | Oui, dans le flux | ⚠️ robots.txt exclut GPTBot, ClaudeBot, Applebot-Extended, Bytespider, meta-externalagent, Amazonbot |
| MIT Technology Review | Flux ✅ ; pages ✅ | Oui, dans le flux | ⚠️ robots.txt exclut 14 robots d'IA (GPTBot, ClaudeBot, anthropic-ai, CCBot, Google-Extended, PerplexityBot…) |
| IEEE Spectrum — Robotics | Flux ✅ ; pages ✅ | Oui, dans le flux | ⚠️ robots.txt exclut 11 robots d'IA (GPTBot, ClaudeBot, anthropic-ai, CCBot, Google-Extended…) |
| OpenAI News | Flux ✅ ; pages 403 (anti-bot) | Non (extrait ~150 car.) | Aucun signal dans robots.txt ; pages non vérifiables |
| Hugging Face, Google Research | Flux ✅ ; pages ✅ (extraction validée au POC 1.1) | Par extraction de la page | Aucun signal détecté |
| DeepMind, Simon Willison, TypeScript Blog, Project Zero, One Useful Thing | Flux ✅ | Oui ou partiel, dans le flux | Aucun signal détecté |
| 6 dépôts GitHub (releases) | API officielle ✅ | Notes de release | Conditions de l'API GitHub et licences des dépôts à vérifier |

Ces robots d'IA ne visent pas notre User-Agent : l'accès reste techniquement autorisé. Mais exclure des robots d'IA exprime une **opposition de l'éditeur à la réutilisation de ses contenus par des IA**. En droit européen, l'exception de fouille de textes et de données (directive 2019/790, art. 4) cède devant une réservation exprimée « de manière appropriée », par exemple par des moyens lisibles par machine. L'interprétation de ce signal relève d'un avis juridique.

## Restrictions non résolues

1. **Conditions d'utilisation et droit d'auteur** : aucune n'a été vérifiée, pour aucune des 17 sources. Le stockage du texte intégral et son envoi à un fournisseur de LLM doivent être validés pour chaque source.
2. **Angular Blog, MIT Technology Review, IEEE Spectrum** : signal explicite d'opposition aux robots d'IA. Il faut décider si leur texte intégral peut être envoyé à un LLM au POC 2.
3. **Pages protégées** (Angular Blog, OpenAI) : les liens sont conservés et cliquables, mais leur validité ne peut pas être vérifiée automatiquement.
4. **Résumés affichés dans le dashboard** : la longueur et la forme acceptables d'un résumé généré à partir d'un article protégé restent à définir (courte citation, lien vers l'original).

## Mise en œuvre au POC 2 (phase A)

Les politiques par source sont implémentées dans `pocs/ai-analysis/src/config/content-policies.ts`. Les 17 sources sont en `metadata-only`, car aucune autorisation n’a été vérifiée (voir `pocs/ai-analysis/reports/content-policy.md`).

## Option initialement proposée

Ajouter une politique par source, par exemple `aiContentPolicy: 'full' | 'metadata-only'`. Les trois sources signalées seraient en `metadata-only` par défaut (titre, date, URL, catégories et court extrait du flux) jusqu'à validation. Elles restent ainsi dans la veille, conformément à la règle « jamais exclue faute de contenu », sans que leur texte intégral soit envoyé au modèle.
