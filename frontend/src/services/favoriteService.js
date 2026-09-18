import api from './api';

export const favoriteService = {
  list: () => api.get('/favorites').then((r) => r.data.restaurants),
  add: (restaurantId) => api.post(`/favorites/${restaurantId}`),
  remove: (restaurantId) => api.delete(`/favorites/${restaurantId}`),
};
