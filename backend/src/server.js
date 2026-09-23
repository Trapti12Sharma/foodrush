require('dotenv').config();

const { assertEnv } = require('./config/env');

// Fail fast (before touching the database) if required configuration is missing or malformed.
assertEnv();

const http = require('http');
const app = require('./app');
const connectDB = require('./config/db');
const { initSocket } = require('./realtime');

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    await connectDB();
    // An explicit http.Server (rather than app.listen()) so Socket.IO can attach
    // to the SAME server/port — no second process, no second port to expose on
    // Render. Express keeps handling every existing HTTP route exactly as before.
    const httpServer = http.createServer(app);
    initSocket(httpServer);
    httpServer.listen(PORT, () => {
      console.log(`FoodRush backend listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();

process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection:', err);
});
