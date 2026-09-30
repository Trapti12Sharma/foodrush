import { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { createSocket } from '../services/socketService';

// status: 'connecting' | 'live' | 'unavailable' | 'ended'
// 'unavailable' covers every reason there's nothing to show (not authorized, no
// rider assigned, socket failed) — the caller doesn't need to distinguish them,
// it just shows one friendly "location unavailable" state either way.
// `onEnded` (optional) fires once when tracking:ended arrives — the page uses
// this to reload the order itself (e.g. OUT_FOR_DELIVERY -> DELIVERED, OTP
// section hidden) without waiting for a manual refresh. Read via a ref so
// passing a fresh inline function every render doesn't re-run the effect.
export function useOrderTracking(orderId, enabled, onEnded) {
  const [status, setStatus] = useState('connecting');
  const [location, setLocation] = useState(null);
  const [rider, setRider] = useState(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  // Guards state updates arriving after the effect has already torn down
  // (unmount, or `enabled` flipping off) — a stale async response must never
  // resurrect state for a tracking session that's no longer active.
  const activeRef = useRef(false);

  useEffect(() => {
    if (!enabled || !orderId) return undefined;
    activeRef.current = true;
    setStatus('connecting');

    // The snapshot loads first so a page refresh / first open shows the last
    // known position immediately, before any live event has arrived.
    api
      .get(`/orders/${orderId}/tracking`)
      .then((res) => {
        if (!activeRef.current) return;
        const snapshot = res.data;
        if (snapshot.rider) setRider(snapshot.rider);
        if (snapshot.location) setLocation(snapshot.location);
        if (!snapshot.tracking) setStatus('unavailable');
      })
      .catch(() => {
        if (activeRef.current) setStatus('unavailable');
      });

    const socket = createSocket();
    socket.connect();

    socket.on('connect', () => {
      socket.emit('join:order', { orderId }, (res) => {
        if (!activeRef.current) return;
        if (!res?.ok) setStatus('unavailable');
      });
    });
    socket.on('connect_error', () => activeRef.current && setStatus('unavailable'));
    socket.on('disconnect', () => activeRef.current && setStatus((prev) => (prev === 'ended' ? prev : 'connecting')));
    socket.on('location:update', (payload) => {
      if (!activeRef.current || payload.orderId !== orderId) return;
      setLocation({ latitude: payload.latitude, longitude: payload.longitude, accuracy: payload.accuracy, updatedAt: payload.updatedAt });
      setStatus('live');
    });
    socket.on('tracking:ended', (payload) => {
      if (!activeRef.current || payload.orderId !== orderId) return;
      setStatus('ended');
      onEndedRef.current?.(payload);
    });

    return () => {
      activeRef.current = false;
      socket.disconnect();
    };
  }, [orderId, enabled]);

  return { status, location, rider };
}
