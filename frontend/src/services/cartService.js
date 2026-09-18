import api from './api';

export const cartService = {
  get: () => api.get('/cart').then((r) => r.data.cart),
  addItem: (payload) => api.post('/cart/items', payload).then((r) => r.data.cart),
  updateItem: (id, quantity) => api.put(`/cart/items/${id}`, { quantity }).then((r) => r.data.cart),
  removeItem: (id) => api.delete(`/cart/items/${id}`).then((r) => r.data.cart),
  clear: () => api.delete('/cart').then((r) => r.data.cart),
  applyCoupon: (code) => api.post('/cart/coupon', { code }).then((r) => r.data.cart),
  removeCoupon: () => api.delete('/cart/coupon').then((r) => r.data.cart),
};
