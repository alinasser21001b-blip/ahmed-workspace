import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Lint rules that encode architecture decisions, not style preferences.
 * Formatting is left alone; these rules exist to catch things that are actually
 * wrong.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.expo/**',
      '**/coverage/**',
      'apps/mobile/dist/**',
      // Build output: the packaged API function, three megabytes of bundled
      // dependencies. Linting it says nothing about this codebase and drowns
      // anything that does.
      'netlify/functions/**',
      // The frozen design handoff's visual reference. `support.js` is a browser
      // artifact exported by the design tool, not source we author or ship —
      // it is evidence of what was approved. Linting it reports 88 browser
      // globals and says nothing about this codebase.
      'docs/design-handoff/reference/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Unused vars are usually a leftover from a refactor; `_`-prefixed ones
      // are intentional.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` defeats the point of a typed contract layer.
      '@typescript-eslint/no-explicit-any': 'error',
      // Empty catch blocks are legitimate here (best-effort cleanup), but they
      // must be written deliberately with a comment.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-console': 'off',
    },
  },
  {
    // Repositories are the only place SQL belongs. Services and routes calling
    // the database directly is the boundary violation this rule exists to catch.
    files: ['apps/api/src/modules/**/*.service.ts', 'apps/api/src/modules/**/*.routes.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '../../platform/db.js',
              importNames: ['query', 'queryRows', 'queryOne'],
              message:
                'Raw queries belong in a repository. Services may use withTransaction; routes may not touch the database at all.',
            },
          ],
        },
      ],
    },
  },
  {
    // The client is React. `exhaustive-deps` catches the exact class of bug
    // that made a freshly-published post fail to appear in the feed, so it is
    // an error rather than a warning — and the two places we deliberately
    // diverge carry an explicit disable comment explaining why.
    files: ['apps/mobile/**/*.ts', 'apps/mobile/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['**/*.test.ts', '**/test/**/*.ts', '**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    /*
     * Plain Node scripts (E2E drivers, tooling) run outside the bundlers and
     * use Node globals directly.
     *
     * The browser globals are here too, and legitimately: the bodies of
     * `page.evaluate(...)` callbacks are serialised and executed inside the
     * page, so `document` and `window` are exactly right in that scope even
     * though the surrounding file runs in Node.
     */
    files: ['**/e2e/**/*.mjs', '**/scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        document: 'readonly',
        window: 'readonly',
        localStorage: 'readonly',
        getComputedStyle: 'readonly',
        // Node 22 provides these natively; the E2E drivers use them directly.
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        WebSocket: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
      },
    },
  },
);
