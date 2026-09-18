require('dotenv').config();
const mongoose = require('mongoose');

// A dedicated test database on the same local MongoDB used in development —
// never the real `foodrush` database, so a bug in a test can't touch real
// data. jest.config.js runs every file in-band (single process), so the
// connection is shared across test files rather than reconnecting per file;
// each file's afterEach still wipes every collection for inter-test isolation,
// and the whole test database is dropped once at the very end by
// globalTeardown.js (a separate process, so it can't race a still-running
// file's connection).
const TEST_MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/foodrush_test';

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(TEST_MONGODB_URI);
  }
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
});

module.exports = { TEST_MONGODB_URI };
