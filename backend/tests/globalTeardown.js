require('dotenv').config();
const mongoose = require('mongoose');

// Runs once, in its own process, after the entire suite finishes — separate
// from the shared in-band connection every test file uses via setup.js, so it
// can safely drop the test database without racing a still-open connection.
module.exports = async function globalTeardown() {
  // Set by tests/globalSetup.js — the SAME value tests/setup.js connected with,
  // which is the whole point of computing it in one place. Dropping a database
  // is irreversible, so if that value is somehow absent this refuses to guess a
  // name rather than dropping one that might belong to someone else.
  const uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    console.error('Test teardown: TEST_MONGODB_URI is unset — refusing to guess which database to drop. Nothing was deleted.');
    return;
  }

  const connection = await mongoose.createConnection(uri).asPromise();
  await connection.dropDatabase();
  await connection.close();
};
