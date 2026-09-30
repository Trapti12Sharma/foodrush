import { io } from 'socket.io-client';

// Derives the bare origin (e.g. http://localhost:5000) from VITE_API_URL (e.g.
// .../api) — Socket.IO attaches to the same server/port as the REST API, not a
// separate one, so no new env var is needed just for this.
function socketBaseUrl() {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
  try {
    return new URL(apiUrl).origin;
  } catch {
    return 'http://localhost:5000';
  }
}

// One connection per active tracking/location-sharing session (a customer
// watching one order, a rider sharing location for one delivery) rather than a
// single app-wide singleton — simpler to reason about for this app's actual
// usage pattern, and avoids coordinating a shared connection's lifecycle across
// unrelated components. `withCredentials` sends the same httpOnly auth cookie
// the REST API already uses — no token is ever put in browser-readable storage.
export function createSocket() {
  return io(socketBaseUrl(), {
    withCredentials: true,
    autoConnect: false,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
}
