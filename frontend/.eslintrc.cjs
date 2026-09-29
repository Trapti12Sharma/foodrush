// ESLint 8 config (the version pinned in package.json). Previously missing, which
// made `npm run lint` fail outright.
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  extends: ['eslint:recommended', 'plugin:react/recommended', 'plugin:react/jsx-runtime', 'plugin:react-hooks/recommended'],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  settings: { react: { version: 'detect' } },
  ignorePatterns: ['dist', 'node_modules'],
  rules: {
    'react/prop-types': 'off', // this codebase doesn't use PropTypes
    'react/no-unescaped-entities': 'off', // apostrophes in JSX text are valid and intended
    'no-unused-vars': ['error', { ignoreRestSiblings: true }], // `const { omitted, ...rest } = obj` is a deliberate idiom
  },
  // M20 — describe/it/expect come from Vitest's `globals: true` (vite.config.js),
  // so they are real at runtime but invisible to ESLint. Declared only for test
  // files, deliberately: if these were in the top-level `env` then a stray
  // `describe(...)` left in application code would lint clean and ship.
  overrides: [
    {
      files: ['src/**/*.test.{js,jsx}', 'src/test/**/*.{js,jsx}'],
      env: { node: true },
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
  ],
};
