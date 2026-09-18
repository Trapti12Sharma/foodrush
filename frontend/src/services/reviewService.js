import api from './api';

export const reviewService = {
  listForRestaurant: (restaurantId, params) =>
    api.get(`/restaurants/${restaurantId}/reviews`, { params }).then((r) => r.data),
  create: (payload) => api.post('/reviews', payload).then((r) => r.data.review),
  update: (id, payload) => api.put(`/reviews/${id}`, payload).then((r) => r.data.review),
  remove: (id) => api.delete(`/reviews/${id}`),
};
