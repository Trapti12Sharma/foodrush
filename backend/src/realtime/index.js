const { Server } = require('socket.io');
const { getAllowedOrigins, toOrigin } = require('../config/cors');
const { socketAuthMiddleware } = require('./socketAuth');
const { registerSocketHandlers } = require('./socketHandlers');
const { setIO } = require('./io');

// Attaches Socket.IO to the SAME http.Server Express is already listening on —
// no second port, no second process. CORS reads from the exact function
// app.js's own `cors` middleware uses (config/cors.js), so the two can never
// drift out of sync, and — per instruction — this is never origin: '*' with
// credentials: an exact allow-list, credentialed, exactly like the REST API.
function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin(origin, callback) {
        if (!origin) return callback(null, true); // non-browser client (a native app, a test) — no Origin header to check
        const normalized = toOrigin(origin);
        callback(null, Boolean(normalized) && getAllowedOrigins().includes(normalized));
      },
      credentials: true,
    },
  });

  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    registerSocketHandlers(io, socket);
  });

  setIO(io);
  return io;
}

module.exports = { initSocket };
