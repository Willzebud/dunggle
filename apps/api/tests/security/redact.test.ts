import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactDeep, redactSecrets } from '../../src/security/redact.js';

test('masquage : formats connus (OpenAI, Anthropic, Bearer, en-têtes) et valeurs exactes de l’environnement, GITHUB_TOKEN compris', () => {
  const env = { OPENAI_API_KEY: 'valeur-openai-exacte-123456', GITHUB_TOKEN: 'ghp_valeurGithubExacte987654' } as NodeJS.ProcessEnv;
  const s = redactSecrets('a sk-proj-ABCDEFGHIJKLMNOPQRSTUV b sk-ant-api03-abcdefghij c Bearer zyxwvutsrqponmlk d authorization: secretvalue123 e valeur-openai-exacte-123456 f ghp_valeurGithubExacte987654', env);
  for (const leaked of ['ABCDEFGHIJKLMNOPQRSTUV', 'api03-abcdefghij', 'zyxwvutsrqponmlk', 'secretvalue123', 'valeur-openai-exacte-123456', 'ghp_valeurGithubExacte987654']) assert.ok(!s.includes(leaked), leaked);
  const deep = redactDeep({ a: ['sk-proj-ABCDEFGHIJKLMNOPQRSTUV'], n: 1 }, env);
  assert.ok(!JSON.stringify(deep).includes('ABCDEFGHIJKLMNOPQRSTUV') && deep.n === 1);
  assert.match(deep.a[0], /\[secret masqué\]/);
});
