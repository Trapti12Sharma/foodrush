import api from './api';

export const orderService = {
  create: (payload) => api.post('/orders', payload).then((r) => r.data.order),
  list: (params) => api.get('/orders', { params }).then((r) => r.data),
  getById: (id) => api.get(`/orders/${id}`).then((r) => r.data.order),
  updateStatus: (id, status) => api.patch(`/orders/${id}/status`, { status }).then((r) => r.data.order),
  cancel: (id, reason) => api.post(`/orders/${id}/cancel`, { reason }).then((r) => r.data.order),
};
