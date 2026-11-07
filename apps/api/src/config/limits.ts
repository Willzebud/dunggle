/**
 * Limites et hypothèses figées de l'application (copiées du POC 2, config/budget.ts).
 * L1 : estimation des tokens utilisée par le prompt. L3 complète ce fichier (plafonds, quotas, temporisation).
 */

/** Estimation TYPIQUE (projections) : 1 token pour 3 caractères. Ce n'est PAS une borne haute. */
export const CHARS_PER_TOKEN_TYPICAL = 3;

/**
 * Marge forfaitaire ajoutée à la borne en octets : formatage des messages et prompt système injecté
 * par la sortie structurée (les deux fournisseurs l'ajoutent ; sa taille n'est pas publiée).
 * Hypothèse à confirmer par l'usage réel en phase B ; un dépassement est enregistré comme dette.
 */
export const PROVIDER_OVERHEAD_TOKENS = 2000;
