import api from './api';

export const authService = {
  register: (payload) => api.post('/auth/register', payload).then((r) => r.data.user),
  login: (payload) => api.post('/auth/login', payload).then((r) => r.data.user),
  logout: () => api.post('/auth/logout'),
  getMe: () => api.get('/auth/me').then((r) => r.data.user),
};
