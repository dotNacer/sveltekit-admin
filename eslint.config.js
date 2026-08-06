import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
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
// eslint-plugin-svelte is intentionally absent: src/lib/ ships zero .svelte files, so
// the plugin would only lint the demo route.
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
  }
);
