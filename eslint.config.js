import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },

  // Frontend: React + browser.
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Regras da era React Compiler: sinalizam padrões legítimos e muito usados
      // nesta base (fetch em useEffect, Date.now() em useMemo). Ficam visíveis
      // como warning em vez de travar o gate — ver Fase 4 do PLANEJAMENTO.md.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
    },
  },

  // Serverless da Vercel, scripts de ops e configs: rodam no Node.
  {
    files: ['api/**/*.ts', 'scripts/**/*.mjs', 'tests/**/*.ts', '*.ts', '*.mjs'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },

  // Edge Functions: rodam em Deno. Os globais do runtime estão declarados em
  // supabase/functions/_deno.d.ts para o tsc; aqui só precisam existir.
  {
    files: ['supabase/functions/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, Deno: 'readonly', EdgeRuntime: 'readonly' },
    },
  },

  // Prefixo `_` marca "descartado de propósito" em toda a base: o
  // destructuring-para-omitir (`const { a: _omit, ...rest } = row`) do PostgREST
  // e o `catch (_err)` de quem só quer o caminho de fallback.
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // O harness de teste faz shim de fetch e do `res` do Node; tipar isso não
  // agrega e só empurraria para casts igualmente frouxos.
  {
    files: ['tests/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
