import babelParser from '@babel/eslint-parser';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'android/**', '.superpowers/**'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          babelrc: false,
          configFile: false,
          parserOpts: { plugins: ['typescript', 'jsx'] },
        },
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-constant-condition': 'error',
      'no-debugger': 'error',
      'no-eval': 'error',
    },
  },
];
