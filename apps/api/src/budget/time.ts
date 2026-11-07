/**
 * Clés de jour et de mois civils en Europe/Paris. La conversion passe par Intl (base IANA) : minuit
 * correspond à 23:00 UTC en heure d'hiver et 22:00 UTC en heure d'été, y compris les jours de changement d'heure.
 */
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });

export function parisDay(d: Date): string {
  return DAY.format(d); // AAAA-MM-JJ
}

export function parisMonth(d: Date): string {
  return parisDay(d).slice(0, 7); // AAAA-MM
}
