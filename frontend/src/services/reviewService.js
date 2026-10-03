import api from './api';

export const reviewService = {
  listForRestaurant: (restaurantId, params) =>
    api.get(`/restaurants/${restaurantId}/reviews`, { params }).then((r) => r.data),
  // Owner-scoped: returns ALL statuses (PENDING/APPROVED/REJECTED/HIDDEN)
  // so the owner can see customer reviews that are still awaiting moderation.
  listForOwner: (restaurantId, params) =>
    api.get(`/restaurants/${restaurantId}/reviews/owner`, { params }).then((r) => r.data),
  create: (payload) => api.post('/reviews', payload).then((r) => r.data.review),
  update: (id, payload) => api.put(`/reviews/${id}`, payload).then((r) => r.data.review),
  remove: (id) => api.delete(`/reviews/${id}`),
  report: (id, reason) => api.post(`/reviews/${id}/report`, { reason }),
  reply: (id, text) => api.put(`/reviews/${id}/reply`, { text }).then((r) => r.data.review),
  removeReply: (id) => api.delete(`/reviews/${id}/reply`).then((r) => r.data.review),
};
