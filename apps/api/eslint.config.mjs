import { base, moduleBoundaries } from '@vyuha/config/eslint';

export default [
  ...base,
  ...moduleBoundaries,
  {
    files: ['**/*.ts'],
    rules: {
      // Nest controllers and providers are instantiated by the framework, so
      // the class itself is never referenced by name in our own code.
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
];
