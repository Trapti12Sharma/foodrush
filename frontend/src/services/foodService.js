import api from './api';

export const foodService = {
  list: (params) => api.get('/foods', { params }).then((r) => r.data),
  getById: (id) => api.get(`/foods/${id}`).then((r) => r.data.food),
  create: (payload) => api.post('/foods', payload).then((r) => r.data.food),
  update: (id, payload) => api.put(`/foods/${id}`, payload).then((r) => r.data.food),
  remove: (id) => api.delete(`/foods/${id}`),
};
