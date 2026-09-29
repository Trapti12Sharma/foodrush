module.exports = {
  testEnvironment: 'node',
  // globalSetup picks this run's database name and writes it into process.env,
  // so setup.js and globalTeardown.js cannot disagree about which database to
  // connect to and which to drop. See tests/globalSetup.js for why a unique
  // database per run is the default.
  globalSetup: '<rootDir>/tests/globalSetup.js',
  globalTeardown: '<rootDir>/tests/globalTeardown.js',
  testTimeout: 20000,
};
