import api from './api';

export const addressService = {
  list: () => api.get('/addresses').then((r) => r.data.addresses),
  create: (payload) => api.post('/addresses', payload).then((r) => r.data.address),
  update: (id, payload) => api.put(`/addresses/${id}`, payload).then((r) => r.data.address),
  remove: (id) => api.delete(`/addresses/${id}`),
};
