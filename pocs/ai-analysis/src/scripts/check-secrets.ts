/**
 * Vérification des secrets avant commit (à lancer manuellement : npm run check:secrets).
 * Analyse les fichiers suivis ET indexés par Git (hors package-lock.json) et signale :
 * - les formats de clés API connus ; les fichiers .env, journaux et registres budgétaires suivis.
 * Code de sortie 1 si un problème est trouvé.
 */
import { execFileSync } from 'node:child_process';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const files = execFileSync('git', ['ls-files', '--cached'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
const problems: string[] = [];

const forbiddenFiles = [/(^|\/)\.env(\.(?!example$)[^/]*)?$/, /(^|\/)var\//, /budget-ledger\.json$/, /usage-log\.jsonl$/, /\.pem$/, /\.key$/];
for (const f of files) if (forbiddenFiles.some((re) => re.test(f))) problems.push(`Fichier interdit suivi par Git : ${f}`);

const pattern = 'sk-ant-[A-Za-z0-9_-]{8,}|sk-(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY';
try {
  const out = execFileSync('git', ['grep', '--cached', '-nIE', pattern, '--', '.', ':!package-lock.json', ':!**/check-secrets.ts', ':!**/redact.ts', ':!**/*.test.ts'], { cwd: root, encoding: 'utf8' });
  for (const line of out.split('\n').filter(Boolean)) problems.push(`Secret potentiel : ${line.slice(0, 160)}`);
} catch (e) {
  if ((e as { status?: number }).status !== 1) throw e; // 1 = aucune correspondance
}

if (problems.length) {
  console.error(`❌ ${problems.length} problème(s) :\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`✅ Aucun secret ni fichier sensible dans les ${files.length} fichiers suivis.`);
