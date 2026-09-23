import { useCallback, useEffect, useRef, useState } from 'react';
import { createSocket } from '../services/socketService';

// Mirrors the server's own default (LOCATION_UPDATE_MIN_INTERVAL_MS) — this is a
// courtesy to avoid emitting more often than the server would ever accept
// anyway; the server enforces its own minimum independently regardless of what
// a client sends, so this constant being out of sync would degrade to wasted
// emits, never a security issue.
const EMIT_MIN_INTERVAL_MS = 5000;

// state: 'idle' | 'requesting' | 'sharing' | 'denied' | 'unavailable' | 'timeout' | 'unsupported' | 'error'
export function useLocationSharing(assignmentId) {
  const [state, setState] = useState('idle');
  const [lastSentAt, setLastSentAt] = useState(null);
  const socketRef = useRef(null);
  const watchIdRef = useRef(null);
  const lastEmitRef = useRef(0);

  const stop = useCallback(() => {
    if (watchIdRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setState('idle');
  }, []);

  const start = useCallback(() => {
    if (!navigator.geolocation) {
      setState('unsupported');
      return;
    }
    setState('requesting');

    const socket = createSocket();
    socketRef.current = socket;
    socket.connect();
    socket.on('connect', () => socket.emit('join:delivery', { assignmentId }));

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setState('sharing');
        const now = Date.now();
        if (now - lastEmitRef.current < EMIT_MIN_INTERVAL_MS) return;
        lastEmitRef.current = now;

        const { latitude, longitude, accuracy } = position.coords;
        socketRef.current?.emit('rider:location', { latitude, longitude, accuracy }, (res) => {
          if (res?.ok) setLastSentAt(new Date());
        });
      },
      (err) => {
        // GeolocationPositionError codes: 1 permission denied, 2 position unavailable, 3 timeout.
        if (err.code === 1) setState('denied');
        else if (err.code === 3) setState('timeout');
        else setState('unavailable');
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }, [assignmentId]);

  // Stop sharing on unmount — never leave a watch/socket running after the
  // component that started it is gone.
  useEffect(() => stop, [stop]);

  return { state, lastSentAt, start, stop };
}
