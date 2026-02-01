module.exports = {
  root: true,
  extends: 'airbnb-base',
  env: {
    browser: true,
  },
  parser: '@babel/eslint-parser',
  parserOptions: {
    allowImportExportEverywhere: true,
    sourceType: 'module',
    requireConfigFile: false,
  },
  rules: {
    'import/extensions': ['error', { js: 'always' }], // require js file extensions in imports
    'linebreak-style': ['error', 'unix'], // enforce unix linebreaks
    'no-param-reassign': [2, { props: false }], // allow modifying properties of param
    'no-use-before-define': ['error', { functions: false }], // allow function hoisting
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }], // allow unused args starting with _
    'no-restricted-syntax': 'off', // allow for...of loops
    'no-shadow': 'warn', // warn instead of error for shadowed variables
    'prefer-destructuring': 'warn', // warn instead of error
    'padded-blocks': 'off', // disable padded blocks rule
  },
};
