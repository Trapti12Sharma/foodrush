import api from './api';

export const adminService = {
  getDashboard: () => api.get('/admin/dashboard').then((r) => r.data),
  listUsers: (params) => api.get('/admin/users', { params }).then((r) => r.data),
  setUserActive: (id, isActive) => api.patch(`/admin/users/${id}/status`, { isActive }).then((r) => r.data.user),
  listRestaurants: (params) => api.get('/admin/restaurants', { params }).then((r) => r.data),
  approveRestaurant: (id) => api.patch(`/admin/restaurants/${id}/approve`).then((r) => r.data.restaurant),
  setRestaurantActive: (id, isActive) =>
    api.patch(`/admin/restaurants/${id}/status`, { isActive }).then((r) => r.data.restaurant),
  listOrders: (params) => api.get('/admin/orders', { params }).then((r) => r.data),
};
