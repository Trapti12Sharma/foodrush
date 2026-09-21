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
};
