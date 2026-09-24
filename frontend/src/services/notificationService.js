import api from './api';

export const notificationService = {
  list: (params) => api.get('/notifications', { params }).then((r) => r.data),
  unreadCount: () => api.get('/notifications/unread-count').then((r) => r.data.count),
  getById: (id) => api.get(`/notifications/${id}`).then((r) => r.data.notification),
  markAsRead: (id) => api.post(`/notifications/${id}/read`).then((r) => r.data.notification),
  markAllAsRead: () => api.post('/notifications/read-all').then((r) => r.data),
  getPreferences: () => api.get('/notification-preferences').then((r) => r.data.preferences),
  updatePreferences: (payload) => api.put('/notification-preferences', payload).then((r) => r.data.preferences),
};
