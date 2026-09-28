import api from './api';

export const reviewService = {
  listForRestaurant: (restaurantId, params) =>
    api.get(`/restaurants/${restaurantId}/reviews`, { params }).then((r) => r.data),
  create: (payload) => api.post('/reviews', payload).then((r) => r.data.review),
  update: (id, payload) => api.put(`/reviews/${id}`, payload).then((r) => r.data.review),
  remove: (id) => api.delete(`/reviews/${id}`),
  // M15 — report a review as inappropriate. `reason` is one of SPAM/ABUSIVE/
  // OFFENSIVE/FAKE/IRRELEVANT/OTHER.
  report: (id, reason) => api.post(`/reviews/${id}/report`, { reason }),
};
