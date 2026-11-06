# Sécurité des appels IA — règles pour Dunggle (POC et futur backend NestJS)

> Document de référence. Ce qui est **implémenté** aujourd’hui se trouve dans `pocs/ai-analysis/` (voir `reports/phase-b-security-audit.md`). Les règles marquées **[NestJS]** sont à appliquer lors du développement de l’API.

## Principes

1. **Les clés restent côté serveur.** Elles sont lues depuis l’environnement ou un gestionnaire de secrets au moment de l’appel, jamais écrites dans un fichier suivi, un journal, une réponse HTTP ni un message d’erreur.
2. **Les publications sont des données non fiables.** Leur contenu ne peut modifier ni le budget, ni le modèle, ni ses paramètres, ni le nombre d’appels. La sortie du modèle est validée et ne déclenche aucune action.
3. **Tout appel payant passe par le garde budgétaire persistant** (réservation du maximum, idempotence, arrêt sur incertitude). Aucun chemin de code ne l’évite.
4. **Les limites des fournisseurs sont indépendantes et indispensables.** Le garde applicatif ne protège pas contre une clé volée utilisée ailleurs.
5. **Pas de relance automatique non budgétée.** SDK configurés avec `maxRetries: 0` ; toute nouvelle tentative est une nouvelle réservation.

## Règles pour le futur backend [NestJS]

| Règle | Détail |
|---|---|
| Authentification | Toute route qui déclenche (directement ou non) une analyse exige un utilisateur authentifié, avec un rôle administrateur pour l’analyse manuelle. Aucune route publique ne déclenche d’appel IA |
| Paramètres côté serveur uniquement | Le client ne fournit jamais le modèle, `max_tokens`, la politique de contenu, le budget ni le texte à analyser : seulement l’identifiant d’une publication déjà collectée |
| File de traitement | Les analyses passent par une file persistante à **un seul consommateur** (ou un verrou distribué) ; l’idempotence (modèle × publication × version du prompt) est imposée en base par une contrainte d’unicité |
| Budget en base | Le registre budgétaire (réservations, coûts incertains, compteur monotone) migre en base transactionnelle (MongoDB avec transactions, ou équivalent), en conservant les mêmes invariants et le journal en ajout seul |
| Limitation de débit | Par utilisateur et globale sur les routes déclenchant des analyses ; le scheduler a un verrou d’exécution unique |
| Secrets | Variables d’environnement du déploiement ou gestionnaire de secrets ; jamais dans l’image, le dépôt ou la configuration Angular ; rotation et expiration courtes |
| Frontend Angular | Aucune clé, aucun appel direct aux fournisseurs ; seul le backend parle aux API IA |
| Journalisation | Masquage systématique (`redactSecrets`) ; pas de corps de requête ni de réponse brute dans les journaux de production |
| CORS et en-têtes | Origine du frontend uniquement ; pas d’en-tête d’autorisation renvoyé |
| Erreurs | Messages génériques côté client ; détails masqués côté serveur |
| Surveillance | Rapprochement régulier entre le registre et les consoles des fournisseurs ; alerte sur tout coût incertain non réconcilié |

## Procédure en cas de clé exposée

1. Révoquer la clé dans la console (Anthropic : désactiver ou supprimer la clé, ou archiver le workspace ; OpenAI : révoquer depuis la page API keys).
2. Créer une nouvelle clé dédiée et la fournir par l’environnement.
3. Vérifier la consommation récente dans les consoles.
4. Si la clé a été committée, la considérer comme compromise même après suppression du commit : l’historique et les copies distantes la conservent.
