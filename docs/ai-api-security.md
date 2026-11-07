# Sécurité des appels IA — règles pour Dunggle

> Document de référence. Ces règles ont été implémentées et auditées dans le POC 2 ([audit de sécurité B.0](../pocs/ai-analysis/reports/phase-b-security-audit.md)), puis reprises dans le backend `apps/api` ([conception](backend-design.md)). Les règles marquées **[NestJS]** s’appliqueront à la future API HTTP.

## Principes

1. **Les clés restent côté serveur.** Elles sont lues depuis l’environnement ou un gestionnaire de secrets au moment de l’appel, jamais écrites dans un fichier suivi, un journal, une réponse HTTP ni un message d’erreur.
2. **Les publications sont des données non fiables.** Leur contenu ne peut modifier ni le budget, ni le modèle, ni ses paramètres, ni le nombre d’appels. La sortie du modèle est validée et ne déclenche aucune action.
3. **Tout appel payant passe par le garde budgétaire persistant** (réservation du maximum, idempotence, arrêt sur incertitude). Aucun chemin de code ne l’évite.
4. **Les limites des fournisseurs sont indépendantes et indispensables.** Le garde applicatif ne protège pas contre une clé volée utilisée ailleurs.
5. **Pas de relance automatique non budgétée.** SDK configurés avec `maxRetries: 0` ; toute nouvelle tentative est une nouvelle réservation.
6. **Quotas d’appels persistants**, vérifiés avec le budget dans la même transaction : 20 par jour (Europe/Paris), 10 par exécution, 500 par mois en production. Ils comptent les tentatives transmises, tous fournisseurs confondus.
7. **Aucune activation permanente des appels réels.** Une exécution réelle consomme une autorisation locale à usage unique (15 minutes, non versionnée) ; l’activation n’existe qu’en mémoire.

## Règles pour le futur backend [NestJS]

| Règle | Détail |
|---|---|
| Authentification | Toute route qui déclenche (directement ou non) une analyse exige un utilisateur authentifié, avec un rôle administrateur pour l’analyse manuelle. Aucune route publique ne déclenche d’appel IA |
| Paramètres côté serveur uniquement | Le client ne fournit jamais le modèle, `max_tokens`, la politique de contenu, le budget ni le texte à analyser : seulement l’identifiant d’une publication déjà collectée |
| File de traitement | Les analyses passent par une file persistante à **un seul consommateur** (ou un verrou distribué) ; l’idempotence (modèle × publication × version du prompt) est imposée en base par une contrainte d’unicité |
| Budget en base | Le registre budgétaire (réservations, coûts incertains, compteur monotone) migre en base transactionnelle (MongoDB avec transactions, ou équivalent), en conservant les mêmes invariants et le journal en ajout seul |
| Limitation de débit | Par utilisateur et globale sur les routes déclenchant des analyses ; le scheduler a un verrou d’exécution unique |
| Quotas | Reprendre `PRODUCTION_QUOTAS` (20/jour Europe/Paris, 10/exécution, 500/mois) et la file `selectPending` (couverture obligatoire en premier, 100 candidates par cycle, expiration à 14 jours) ; compteurs en base, dans la même transaction que le budget |
| Activation | En production, l’activation provient de la configuration du déploiement, revue et non modifiable par l’API ; jamais d’une requête client |
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
