import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Shared flat config. Apps extend this and add their own boundary rules.
 */
export const base = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      // CLAUDE.md §4: no `any`, no non-null assertions on API data.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // CLAUDE.md §6: never silently swallow an error.
      'no-empty': ['error', { allowEmptyCatch: false }],

      // CLAUDE.md §3: no emojis anywhere, including code comments.
      // \p{Extended_Pictographic} covers the emoji blocks without catching
      // ordinary punctuation or accented Latin.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/\\p{Extended_Pictographic}/u]',
          message: 'No emojis (CLAUDE.md §3). Use a lucide-react icon.',
        },
      ],
    },
  },
  {
    // Test files legitimately reach for loose typing against fixtures.
    files: ['**/*.spec.ts', '**/*.test.ts', '**/test/**'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/drizzle/**', '**/coverage/**'],
  },
);

/**
 * Technical design §1: `modules/*` may import `platform/*`; `platform/*` must
 * never import `modules/*`; modules must never import each other.
 *
 * Enforced on the import specifier string, which covers both the `@/modules/x`
 * alias form and the `../../modules/x` relative form.
 */
export const moduleBoundaries = [
  {
    files: ['src/platform/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/modules/**', '@/modules/*', '@/modules/**'],
              message:
                'platform/ must never import from modules/ (technical design §1). ' +
                'If attendance needs to hand something to the platform, invert it: ' +
                'the platform defines the interface, the module implements it.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/modules/*/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Any modules/<name>/ path other than the importer's own. Sibling
              // modules communicate through the platform event bus only.
              group: ['**/modules/*/**', '@/modules/*/**'],
              message:
                'Modules must not import each other (technical design §1). ' +
                'Use the platform event bus. Within your own module, use a relative import.',
            },
          ],
        },
      ],
    },
  },
];
