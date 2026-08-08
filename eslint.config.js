import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

// Flat config, deliberately small. Two choices worth explaining:
//
// 1. `tseslint.configs.recommended`, not `strictTypeChecked`. The library is built on
//    `prisma: any` on purpose (it introspects an unknown schema at runtime), so the
//    type-aware `no-unsafe-*` family would fire hundreds of times in handler.ts and
//    data.ts and be answered only with suppressions. `no-explicit-any` stays on as a
//    warning: a tracked debt count rather than a wall.
//
// 2. One type-aware rule is worth its config cost: `no-floating-promises`, in an async
//    request handler. It is scoped to the TypeScript sources below, which are the only
//    files covered by tsconfig.json.
//
// eslint-plugin-svelte lint les .svelte de src/lib/server/views/ — plus seulement
// la route de démo, depuis que les vues serveur sont de vrais composants Svelte.
//
// `no-console` stays off — the library uses console.warn/console.error by design.
export default tseslint.config(
  {
    ignores: [
      'dist/',
      '.svelte-kit/',
      'coverage/',
      'tests/fixtures/prisma/client/',
      'example/'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: { ...globals.node }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        // `coerceId(id, _model)` keeps an unused parameter on purpose, to document the
        // signature the callers pass.
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }]
    }
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error'
    }
  },
  {
    // `<script lang="ts">` blocks need the TS parser wired in explicitly, otherwise
    // eslint-plugin-svelte falls back to espree and chokes on typed `$props()` destructuring.
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser
      }
    },
    rules: {
      // `resolve()` is SvelteKit's client-side typed-routing helper for `<a href>` inside
      // page/layout components. These views are plain SSR HTML fragments rendered server-side
      // via `render()` from `svelte/server` — there is no SvelteKit router involved, so the
      // rule doesn't apply.
      'svelte/no-navigation-without-resolve': 'off'
    }
  }
);
