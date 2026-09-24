// ESLint flat config for the app and the shared workbook package (the spike is not linted).
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/dev-dist/**', '**/node_modules/**', 'spike/**', 'tools/**', 'app/public/**', 'app/e2e-screenshots/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['app/**/*.{ts,tsx}', 'packages/**/*.ts'],
    languageOptions: { ecmaVersion: 2023, globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      // the ported workbook library uses short-circuit statements such as `a ? b++ : c++`
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
    },
  },
  {
    files: ['**/*.{js,mjs}', 'app/vite.config.ts', 'app/e2e/**', 'app/scripts/**', '**/*.test.{ts,tsx}', 'packages/workbook/src/testTemplate.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
);
