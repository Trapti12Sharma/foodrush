import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import toast from '@/utils/toast';
import { useAuth } from './AuthContext';
import { notificationService } from '../services/notificationService';
import { createSocket } from '../services/socketService';

const NotificationContext = createContext(null);

// One persistent socket connection for the whole authenticated session — unlike
// useOrderTracking's per-tracking-session socket, this lives as long as `user`
// does. The server decides the recipient (every authenticated connection joins
// its own user:<id> room automatically — see realtime/socketHandlers.js); the
// client never asks for, or could ask for, anyone else's notifications.
export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const socketRef = useRef(null);

  const refresh = useCallback(() => {
    notificationService
      .list({ limit: 10 })
      .then((res) => setNotifications(res.notifications))
      .catch(() => {});
    notificationService
      .unreadCount()
      .then(setUnreadCount)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      return undefined;
    }

    refresh();

    const socket = createSocket();
    socketRef.current = socket;
    socket.connect();
    socket.on('notification:new', (payload) => {
      // Normalized to the same `_id` shape the REST list already uses (the
      // server's socket payload uses a plain `id`), so every consumer of this
      // list can treat both sources identically.
      const notification = { ...payload, _id: payload.id, readAt: null };
      setNotifications((prev) => [notification, ...prev].slice(0, 20));
      setUnreadCount((prev) => prev + 1);
      toast(notification.title, { icon: '🔔' });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // Reconnects only when the signed-in user actually changes (login/logout/
    // switch account) — not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?._id]);

  const markAsRead = useCallback(async (id) => {
    await notificationService.markAsRead(id);
    setNotifications((prev) => prev.map((n) => (n._id === id ? { ...n, readAt: n.readAt || new Date().toISOString() } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
  }, []);

  const markAllAsRead = useCallback(async () => {
    await notificationService.markAllAsRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
    setUnreadCount(0);
  }, []);

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, refresh, markAsRead, markAllAsRead }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within a NotificationProvider');
  return ctx;
}
