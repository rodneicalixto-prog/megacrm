import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Um runner so para os dois lados: as libs do frontend (que usam o alias `@/` e
// imports sem extensao, resolvidos pelo Vite) e os adapters das Edge Functions
// (TypeScript puro, sem API do Deno nas funcoes testadas).
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // Os globais do runtime Deno precisam existir antes de qualquer import de
    // Edge Function — ver tests/unit/setup-deno.ts.
    setupFiles: ['tests/unit/setup-deno.ts'],
  },
});
