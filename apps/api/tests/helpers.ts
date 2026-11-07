/** Interdit tout accès réseau pendant les tests : un appel à fetch fait échouer le test. */
export const networkCalls: string[] = [];
export function forbidNetwork(): void {
  globalThis.fetch = (async (input: unknown) => {
    networkCalls.push(String(input));
    throw new Error(`Accès réseau interdit pendant les tests : ${String(input)}`);
  }) as typeof fetch;
}
