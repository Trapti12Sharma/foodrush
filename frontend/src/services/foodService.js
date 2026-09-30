import api from './api';

export const foodService = {
  list: (params) => api.get('/foods', { params }).then((r) => r.data),
  getById: (id) => api.get(`/foods/${id}`).then((r) => r.data.food),
  create: (payload) => api.post('/foods', payload).then((r) => r.data.food),
  update: (id, payload) => api.put(`/foods/${id}`, payload).then((r) => r.data.food),
  remove: (id) => api.delete(`/foods/${id}`),
  // Uploads and persists in one request — the old image is only removed
  // server-side once this succeeds (backend/src/routes/food.routes.js).
  uploadImage: (id, file) => {
    const formData = new FormData();
    formData.append('image', file);
    return api.post(`/foods/${id}/image`, formData).then((r) => r.data.food);
  },
  deleteImage: (id) => api.delete(`/foods/${id}/image`).then((r) => r.data.food),
};
