import api from './api';

export const restaurantService = {
  list: (params) => api.get('/restaurants', { params }).then((r) => r.data),
  getById: (id) => api.get(`/restaurants/${id}`).then((r) => r.data.restaurant),
  listMine: () => api.get('/restaurants/mine').then((r) => r.data.restaurants),
  create: (payload) => api.post('/restaurants', payload).then((r) => r.data.restaurant),
  update: (id, payload) => api.put(`/restaurants/${id}`, payload).then((r) => r.data.restaurant),
  remove: (id) => api.delete(`/restaurants/${id}`),
  getDashboard: (id) => api.get(`/restaurants/${id}/dashboard`).then((r) => r.data),
};
