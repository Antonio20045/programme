module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'security'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:security/recommended-legacy',
  ],
  rules: {
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'security/detect-non-literal-fs-filename': 'warn',
    'security/detect-child-process': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'error',
  },
  ignorePatterns: ['node_modules/', 'dist/', 'packages/gateway/'],
}
