/**
 * Masquage des secrets dans tout texte destiné à un journal, un rapport ou un message d'erreur.
 * Couvre les formats de clés connus et, surtout, les valeurs EXACTES des clés présentes dans l'environnement.
 */
const SECRET_ENV_VARS = ['OPENAI_API_KEY', 'OPENAI_ADMIN_KEY', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_ADMIN_KEY'];

const PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g, // Anthropic (clés API et admin)
  /sk-(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{16,}/g, // OpenAI
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
  /((?:x-api-key|authorization|api[_-]?key)["']?\s*[:=]\s*["']?)[^\s"',}]{8,}/gi,
];

export function redactSecrets(input: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = input;
  for (const name of SECRET_ENV_VARS) {
    const v = env[name]?.trim();
    if (v && v.length >= 8) out = out.split(v).join(`[${name} masquée]`);
  }
  for (const re of PATTERNS) out = out.replace(re, (_m, prefix) => (typeof prefix === 'string' && prefix && !prefix.startsWith('sk') && !prefix.startsWith('-') ? `${prefix}[secret masqué]` : '[secret masqué]'));
  return out;
}

/** Applique redactSecrets à toutes les chaînes d'un objet sérialisable (copie). */
export function redactDeep<T>(value: T, env: NodeJS.ProcessEnv = process.env): T {
  if (typeof value === 'string') return redactSecrets(value, env) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, env)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactDeep(v, env)])) as T;
  }
  return value;
}
