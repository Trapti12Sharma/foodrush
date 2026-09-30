import api from './api';

export const authService = {
  register: (payload) => api.post('/auth/register', payload).then((r) => r.data.user),
  login: (payload) => api.post('/auth/login', payload).then((r) => r.data.user),
  logout: () => api.post('/auth/logout'),
  getMe: () => api.get('/auth/me').then((r) => r.data.user),
  updateProfile: (payload) => api.put('/auth/me', payload).then((r) => r.data.user),
  changePassword: (payload) => api.post('/auth/change-password', payload).then((r) => r.data.user),
  // Resolves with the server's generic message — identical whether or not the email is registered.
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }).then((r) => r.message),
  resetPassword: ({ token, password }) => api.post('/auth/reset-password', { token, password }).then((r) => r.message),
};
