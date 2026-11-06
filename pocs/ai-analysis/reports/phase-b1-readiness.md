# POC 2 — Préparation de B.1 (phase B.0.1 : quotas et activation sécurisée)

> État au 2026-11-06, après la phase B.0.1. Aucun appel payant n’a été effectué. Ce document complète `phase-b-security-audit.md`.

## 1. Quotas d’appels

Les quotas comptent les **tentatives d’appels réels**, pas les publications. Ils sont globaux et partagés entre fournisseurs : une analyse par deux modèles compte pour deux appels. Ils sont vérifiés **dans la même transaction atomique que le budget**, persistés dans le registre (`var/budget-ledger.json`) et protégés par le même contrôle d’intégrité. Ils ne sont jamais remis à zéro au redémarrage.

| Périmètre | Quota | Valeur | Fenêtre |
|---|---|---|---|
| Production (`operational`) | Appels par jour | **20** | jour civil Europe/Paris |
| | Appels par exécution | **10** | identifiant d’exécution |
| | Appels par mois | **500** | mois civil Europe/Paris |
| | Budget opérationnel / absolu | **8 € / 10 €** | mois civil UTC (facturation) |
| POC B.1 (`trial`) | Appels par modèle / au total | **1 / 2** | cumulatif, jamais remis à zéro |
| POC B.2 (`trial`) | Appels par modèle / au total | **37 / 74** | cumulatif, jamais remis à zéro |
| POC (B.1 + B.2) | Budget cumulé | **0,50 €** | cumulatif |

**Ce qui compte comme tentative :** toute requête transmise au fournisseur, même si elle échoue (5xx, délai dépassé, refus 4xx) ou si sa facturation est incertaine. Seule une requête **certainement non transmise** est décomptée : clé absente, modèle non validé, aucune activation.

**Règles distinctes pour le POC :** les quotas de production (20/jour, 10/exécution) ne s’appliquent pas au POC, pour ne pas fausser le protocole de comparaison (B.2 couvre 74 analyses). Le POC a ses propres quotas de phase, et le budget de 0,50 € est partagé entre B.1 et B.2. En B.2, la fixture déjà analysée en B.1 n’est pas refacturée : il reste 36 nouveaux appels par modèle.

**Fuseau Europe/Paris :** jours et mois via la base IANA (`Intl`). Minuit correspond à 23:00 UTC en hiver et 22:00 UTC en été. Le 29 mars dure 23 heures et le 25 octobre 25 heures, sans remise à zéro pendant l’heure répétée (testé).

## 2. Dépassement d’un quota

- Nouveaux appels refusés (`quota-daily`, `quota-run`, `quota-monthly`, `quota-phase-total`, `quota-phase-model`), avec la raison inscrite au journal d’usage.
- Statut `refused-quota` : la publication **n’est pas marquée analysée** (aucune entrée dans le registre) et reste candidate au cycle suivant. Aucune relance automatique.
- L’exécution s’arrête dès le premier refus de quota.
- Couverture éditoriale obligatoire préservée : une release d’une source obligatoire non analysée reste visible dans « Mises à jour » (avec le marqueur `mandatory-coverage-unanalyzed`).

**Politique des publications en attente** (production, `selectPending`) :
- couverture obligatoire en premier, puis les plus récentes ;
- au plus **100** candidates par cycle, le surplus attendant le cycle suivant (sans suppression) ;
- au-delà de **14 jours**, une publication non analysée reste visible (métadonnées) mais n’est plus proposée à l’IA.

## 3. Activation des appels réels : locale, temporaire, à usage unique

La constante `REAL_CALLS_ENABLED` est **supprimée** : aucune activation permanente, aucun commit d’activation.

1. **Autorisation** (dans votre terminal, aucune clé ni aucun appel) :
   `npm run poc2:authorize -- --phase=B1 --models=anthropic-haiku-5-5,openai-gpt-6-luna --max-eur=0.004 --confirm="AUTORISER B1 0.004 EUR"`
   Crée `var/real-call-grant.json` : ignoré par Git, droits 600, valable **15 minutes**. Refusée si la phrase n’est pas exacte ou si une autorisation existe déjà.
2. **Exécution** : `evaluate:real --real` vérifie d’abord tous les autres prérequis sans toucher à l’autorisation. Puis il la **consomme** par renommage atomique (un seul processus peut l’obtenir), vérifie qu’elle correspond exactement à la commande (phase, modèles, montant ≤ autorisé), et crée une activation **en mémoire** valable au plus 30 minutes.
3. **Après l’exécution**, l’activation disparaît avec le processus. L’autorisation consommée est archivée dans `var/grants/` pour l’audit et n’est plus utilisable. Une seconde exécution exige une nouvelle autorisation.

Les adaptateurs réels n’acceptent qu’une activation émise par ce mécanisme : un objet fabriqué à la main est rejeté (testé).

**Une exécution réelle exige simultanément :**
- une autorisation locale valide pour la phase ;
- `--real` ;
- `--confirm-max-eur` supérieur ou égal au coût maximal du plan, et inférieur ou égal au montant autorisé ;
- les clés API dans l’environnement ;
- des modèles `validated` ;
- des quotas de phase disponibles ;
- un budget d’essai disponible ;
- un registre cohérent (intégrité, aucun coût incertain, aucune réservation ouverte).

## 4. Tests exécutés (2026-11-06)

| Vérification | Résultat |
|---|---|
| Compilation (2 workspaces) | ✅ |
| Tests POC 1 | ✅ 11/11 |
| Tests POC 2 (dont **18 tests de quotas et d’activation**, 27 tests de sécurité) | ✅ 126/126 |
| Scénarios budgétaires | ✅ 14/14 |
| Cohérence du jeu d’évaluation | ✅ |
| Scan des secrets | ✅ |
| CLI : simulation, refus en mode réel (code 3), autorisation avec mauvaise phrase (code 2, aucun fichier créé) | ✅ |

Cas couverts :
- 21e appel quotidien refusé, 11e appel de l’exécution refusé, 501e appel mensuel refusé ;
- partage entre fournisseurs ;
- deux gardes concurrents et trois processus distincts (jamais plus de 20) ;
- changement de jour (minuit Paris et non UTC), changement de mois, heures d’été et d’hiver ;
- redémarrage ;
- timeout après envoi (compté), refus 4xx (compté, non facturé), refus avant envoi (décompté) ;
- contournements : multiplication des exécutions, adaptateur réel sans quota, activation fabriquée, autorisation réutilisée, expirée, de mauvaise phase, de mauvais modèle ou de montant insuffisant ;
- reprise des publications en attente le lendemain ;
- file d’attente (priorité, expiration, plafond) ;
- B.1 puis B.2 sans remise à zéro.

## 5. Limites connues

- Les quotas de production sont prêts mais ne seront branchés sur un scheduler qu’avec le backend NestJS (la file d’attente `selectPending` est fournie, pas le scheduler).
- Le budget mensuel suit le mois UTC (facturation), les quotas le mois Europe/Paris : la nuit du dernier jour du mois, les deux fenêtres diffèrent d’une à deux heures.
- L’ancien garde-fou de 200 analyses par jour UTC reste actif en plus des nouveaux quotas (il ne peut que restreindre).
- Une personne ayant accès au poste pourrait supprimer à la fois le registre et le journal : non détectable localement. Seules les limites des fournisseurs protègent alors.
- Le contrôle « 4xx = non facturé » repose sur le comportement documenté des fournisseurs, sans garantie formelle ; tout autre échec est compté comme incertain.

## 6. Plan exact de B.1 (après votre autorisation explicite)

Coût maximal réservé : **0,001411 €** (Haiku 5.5) + **0,001639 €** (GPT-6 Luna) = **0,003050 €**. Quotas B.1 : 2 appels.

1. Réglages des consoles (voir `phase-b-security-audit.md` § 7) et clés dédiées.
2. Dans un terminal :
   ```bash
   read -rs ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY
   read -rs OPENAI_API_KEY && export OPENAI_API_KEY
   npm run poc2:evaluate                         # simulation : ne doit plus signaler que l’autorisation et --real
   npm run poc2:authorize -- --phase=B1 --models=anthropic-haiku-5-5,openai-gpt-6-luna --max-eur=0.004 --confirm="AUTORISER B1 0.004 EUR"
   npm run poc2:evaluate -- --mode=smoke --real --confirm-max-eur=0.004
   ```
3. Lire la liste de contrôle affichée pour chaque modèle (authentification, schéma, classification, résumé, tokens facturés, cache, coût ≤ réservé).
4. Comparer avec les consoles des fournisseurs, puis remplir `review/phase-b-manual-review.template.json` (copie dans `var/`).
5. En cas de coût incertain : ne rien relancer, relever l’usage réel dans la console, puis réconcilier.
