// As Edge Functions registram `Deno.serve(handler)` no fim do modulo. Importar
// qualquer uma num teste executa essa linha, entao os globais do runtime
// precisam existir — o serve vira no-op e o handler exportado e chamado direto.
const env: Record<string, string> = {
  SUPABASE_URL: 'https://fake.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role',
  CRYPTO_KEY: 'f'.repeat(64),
};

(globalThis as Record<string, unknown>).Deno = {
  env: { get: (key: string) => env[key] },
  serve: () => {},
};

(globalThis as Record<string, unknown>).EdgeRuntime = {
  waitUntil: () => {},
};
