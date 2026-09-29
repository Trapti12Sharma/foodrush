require('dotenv').config();
const mongoose = require('mongoose');

// A dedicated test database on the same local MongoDB used in development —
// never the real `foodrush` database, so a bug in a test cannot touch real data.
// Each file's afterEach wipes every collection for inter-test isolation, and the
// whole test database is dropped once at the very end by globalTeardown.js (a
// separate process, so it cannot race a still-running file's connection).
//
// ONE CONNECTION PER TEST FILE, NOT ONE PER RUN. This comment used to say the
// connection was shared across files because jest.config.js runs everything
// in-band, and that was wrong: --runInBand shares a PROCESS, but Jest still
// gives every test file its own module registry, so each file gets a fresh
// `mongoose` instance whose readyState starts at 0 and connects again. Verified
// by instrumenting the branch below — every file logged "connecting", none ever
// logged "reusing".
//
// That mattered, because nothing here used to close those connections. With ~36
// test files a run left ~36 open connection pools in the worker process, so the
// worker never went idle and both the jest parent and its worker survived the
// run — including runs that exited 0 and printed "Force exiting Jest", since
// --forceExit kills the main process without reaping the worker. Three days of
// those accumulated into 52 abandoned processes holding 3.16 GB on a 15.7 GB
// machine, which paged mongod's working set out and produced exactly the
// symptoms that were being blamed on two sessions contending for the database:
// multi-minute stalls, MongoNetworkTimeoutError, and failing test NAMES changing
// between identical invocations. The afterAll below is what stops it recurring.
const TEST_MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/foodrush_test';

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(TEST_MONGODB_URI);
  }

  // WAIT FOR INDEXES BEFORE ANY TEST RUNS. Mongoose builds indexes in the
  // background after connecting, so a fast test can outrun them — and unlike a
  // missing plain index, which only costs a collection scan, a missing 2dsphere
  // makes $geoNear THROW ("$geoNear requires a 2d or 2dsphere index, but none
  // were found"). Rider dispatch catches that error by design (no rider must
  // ever block a restaurant's status change), so the failure surfaced only as an
  // order with no offer and a confusing undefined further down the test.
  //
  // This was latent for as long as the geo tests have existed: they passed
  // because bcrypt at cost 12 made everything slow enough for the index to win
  // the race. Dropping the test cost to 4 (see models/User.js) removed that
  // accidental delay and exposed it. Model.init() resolves once a model's
  // indexes are actually built, so awaiting all of them makes the guarantee
  // explicit rather than timing-dependent.
  //
  // Every model the test file pulled in is already registered by now: Jest
  // evaluates the file's top-level requires (helpers -> app -> routes ->
  // services -> models) before it runs any beforeAll.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
});

// Closes this file's connection pool so the worker can go idle once the file
// finishes. Guarded on readyState because a file whose beforeAll failed to
// connect would otherwise throw here and mask the real error, and wrapped in
// try/catch because a teardown failure must never turn a passing run red — a
// leaked connection is a resource problem, not a test result.
afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    try {
      await mongoose.disconnect();
    } catch (err) {
      console.error('Test teardown: mongoose.disconnect() failed:', err.message);
    }
  }
});

module.exports = { TEST_MONGODB_URI };
