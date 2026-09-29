require('dotenv').config();

// Runs once, before any test file, and decides which database this whole run
// uses. It exists to stop two concurrent runs destroying each other.
//
// THE PROBLEM IT SOLVES. Every test file's afterEach wipes every collection, so
// a shared test database means two simultaneous runs delete each other's
// fixtures mid-test. That does not fail loudly or consistently — it surfaces as
// a user who was just created failing to log in seconds later, or an
// authenticated agent suddenly getting 401 "Session expired" because
// User.findById now returns null, or a query returning fewer rows than were
// inserted. Every one of those reads like a real defect in the code under test,
// and three separate phantom bugs were chased across two sessions before the
// pattern was recognised. Taking turns by hand works right up until someone
// forgets, and the cost of forgetting is paid in misdiagnosis, not in a clear
// error.
//
// THE RULE. A unique database per run by default; an explicitly configured
// TEST_MONGODB_URI is honoured exactly as given. Someone who points the suite at
// a named database means that database — this must not silently redirect them —
// and they own any collision that follows.
//
// WHY THE ENV VAR IS WRITTEN BACK. The name is computed once, here, and written
// into process.env so tests/setup.js (which connects) and tests/globalTeardown.js
// (which drops) read an identical value and cannot disagree about which database
// to use and destroy. Computing it independently in each place would work under
// --runInBand, where they share a process and therefore a pid — and would break
// the moment the suite ran with parallel workers, because those are separate
// processes: teardown would then drop a database no worker ever touched, leaking
// one per run and destroying nothing it meant to.
//
// RESIDUE. globalTeardown drops the database it created, so a completed run
// leaves nothing. A run that is KILLED outright leaves its database behind;
// those are identifiable by the prefix below and can be dropped by hand. This
// deliberately does NOT sweep old ones automatically: a sweep cannot distinguish
// an abandoned database from one belonging to a run still in flight, and
// deleting a live run's data is precisely the failure this file exists to
// prevent.
const DB_PREFIX = 'foodrush_test';
const DEFAULT_HOST = 'mongodb://127.0.0.1:27017';

module.exports = async function globalSetup() {
  if (process.env.TEST_MONGODB_URI) {
    // Explicitly configured — used verbatim, including its database name.
    return;
  }

  // pid distinguishes concurrent runs on one machine; the random suffix covers
  // the case where a pid is reused after a killed run left its database behind.
  const unique = `${DB_PREFIX}_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  process.env.TEST_MONGODB_URI = `${DEFAULT_HOST}/${unique}`;

  // Printed because an operator who has to clean up after a killed run needs to
  // know the name, and because a surprising database name should never be a
  // silent default.
  console.log(`[jest] test database for this run: ${unique}`);
};

module.exports.DB_PREFIX = DB_PREFIX;
