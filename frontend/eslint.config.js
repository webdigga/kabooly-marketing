import js from '@eslint/js'
import ts from 'typescript-eslint'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['src/**/*.{ts,tsx}', 'test/**/*.{ts,tsx}', 'vite.config.ts', 'vitest.config.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
      parser: ts.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': ts.plugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...ts.configs.strictTypeChecked.rules,
      ...ts.configs.stylisticTypeChecked.rules,
      ...reactHooks.configs['recommended-latest'].rules,
      ...reactRefresh.configs.vite.rules,
      // The same ceilings as the worker (worker/eslint.config.js), so one
      // standard covers the whole repo. A component is a function, so the
      // line limit is generous enough for JSX.
      complexity: ['error', 10],
      'max-depth': ['error', 3],
      'max-nested-callbacks': ['error', 3],
      'max-params': ['error', 4],
      'max-lines-per-function': ['error', { max: 120, skipBlankLines: true, skipComments: true, IIFEs: true }],
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
      eqeqeq: ['error', 'always'],
      curly: ['error', 'multi-line'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',
      'prefer-arrow-callback': 'error',
      'no-implicit-coercion': 'error',
      'no-else-return': ['error', { allowElseIf: false }],
      'no-lonely-if': 'error',
      'no-nested-ternary': 'error',
      'no-param-reassign': 'error',
      'no-return-assign': 'error',
      'no-sequences': 'error',
      'no-unneeded-ternary': 'error',
      'no-useless-return': 'error',
      'no-useless-concat': 'error',
      'no-useless-rename': 'error',
      'default-case-last': 'error',
      'guard-for-in': 'error',
      'no-alert': 'error',
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-bitwise': 'error',
      'no-multi-assign': 'error',
      'no-undef-init': 'error',
      radix: 'error',
      yoda: 'error',
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // Test suites legitimately hold long describe blocks and deep
    // callbacks, and their helpers export render utilities alongside
    // components.
    files: ['test/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'max-lines-per-function': 'off',
      'max-lines': 'off',
      'max-nested-callbacks': ['error', 5],
    },
  },
  {
    // Context files export both the provider and its hook.
    files: ['src/context/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
])
