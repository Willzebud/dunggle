/**
 * Crée une autorisation LOCALE, TEMPORAIRE (15 min) et À USAGE UNIQUE pour une phase du POC.
 *   npm run poc2:authorize -- --phase=B1 --models=anthropic-haiku-5-5,openai-gpt-6-luna --max-eur=0.004 \
 *     --confirm="AUTORISER B1 0.004 EUR"
 * Le fichier var/real-call-grant.json (ignoré par Git) est consommé par la prochaine exécution `--real`.
 * Cette commande ne fait aucun appel et ne contient aucun secret.
 */
import { VAR_DIR } from '../budget/factory.js';
import { ActivationError, confirmationPhrase, createGrant } from '../security/activation.js';
import { POC_PHASES, type PocPhase } from '../config/quotas.js';

const opts: Record<string, string> = {};
for (const raw of process.argv.slice(2)) {
  const i = raw.indexOf('=');
  const name = i < 0 ? raw : raw.slice(0, i);
  if (!['--phase', '--models', '--max-eur', '--confirm'].includes(name) || i < 0) {
    console.error(`Option inconnue ou sans valeur : ${raw}`);
    process.exit(2);
  }
  opts[name] = raw.slice(i + 1);
}
const phase = opts['--phase'] as PocPhase;
const maxEur = Number(opts['--max-eur']);
const models = (opts['--models'] ?? '').split(',').filter(Boolean);
try {
  const g = await createGrant({ phase, models, maxEur, confirm: opts['--confirm'] ?? '' }, VAR_DIR);
  console.log(`Autorisation créée pour ${g.phase} : modèles ${g.models.join(', ')}, montant maximal ${g.maxEur} €, valable jusqu’à ${g.expiresAt} (usage unique).`);
  console.log(`Lancez maintenant : npm run poc2:evaluate -- --mode=${POC_PHASES[g.phase].mode} --real --confirm-max-eur=${g.maxEur}`);
} catch (e) {
  if (e instanceof ActivationError) {
    console.error(`Autorisation refusée : ${e.message}`);
    if (Number.isFinite(maxEur) && phase in POC_PHASES && POC_PHASES[phase].active) console.error(`Phrase attendue : ${confirmationPhrase(phase, maxEur)}`);
    process.exit(2);
  }
  throw e;
}
