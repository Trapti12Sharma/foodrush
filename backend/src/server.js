require('dotenv').config();

const { assertEnv } = require('./config/env');

// Fail fast (before touching the database) if required configuration is missing or malformed.
assertEnv();

const http = require('http');
const app = require('./app');
const connectDB = require('./config/db');
const { initSocket } = require('./realtime');
const platformSettingService = require('./services/platformSetting.service');

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    await connectDB();
    // M17 — create/load the platform settings singleton before serving traffic, so
    // the first order placed does not pay for it. Best-effort: a failure here is
    // logged and start-up continues, because getSettings() creates the row on
    // first use anyway and refusing to boot over a warm-up would be worse.
    await platformSettingService.warmCache();
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
