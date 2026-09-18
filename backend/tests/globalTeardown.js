require('dotenv').config();
const mongoose = require('mongoose');

// Runs once, in its own process, after the entire suite finishes — separate
// from the shared in-band connection every test file uses via setup.js, so it
// can safely drop the test database without racing a still-open connection.
module.exports = async function globalTeardown() {
  const uri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/foodrush_test';
  const connection = await mongoose.createConnection(uri).asPromise();
  await connection.dropDatabase();
  await connection.close();
};
