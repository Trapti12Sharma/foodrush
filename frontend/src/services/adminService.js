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
  createCoupon: (payload) => api.post('/coupons', payload).then((r) => r.data.coupon),
  listCoupons: (params) => api.get('/coupons', { params }).then((r) => r.data),
  updateCoupon: (id, payload) => api.patch(`/coupons/${id}`, payload).then((r) => r.data.coupon),
  listDeliveryPartners: (params) => api.get('/admin/delivery-partners', { params }).then((r) => r.data),
  getDeliveryPartner: (id) => api.get(`/admin/delivery-partners/${id}`).then((r) => r.data.deliveryPartner),
  approveDeliveryPartnerKyc: (id) => api.patch(`/admin/delivery-partners/${id}/approve-kyc`).then((r) => r.data.deliveryPartner),
  rejectDeliveryPartnerKyc: (id, reason) =>
    api.patch(`/admin/delivery-partners/${id}/reject-kyc`, { reason }).then((r) => r.data.deliveryPartner),
  suspendDeliveryPartner: (id, reason) =>
    api.patch(`/admin/delivery-partners/${id}/suspend`, { reason }).then((r) => r.data.deliveryPartner),
  reactivateDeliveryPartner: (id) => api.patch(`/admin/delivery-partners/${id}/reactivate`).then((r) => r.data.deliveryPartner),
  listDeliveryAssignments: (params) => api.get('/admin/delivery-assignments', { params }).then((r) => r.data),
  listEligibleRiders: (orderId) => api.get(`/admin/orders/${orderId}/eligible-riders`).then((r) => r.data.riders),
  assignOrder: (orderId, deliveryPartnerId) =>
    api.post(`/admin/orders/${orderId}/assign`, deliveryPartnerId ? { deliveryPartnerId } : {}).then((r) => r.data.assignment),
  cancelDeliveryAssignment: (id, reason) => api.patch(`/admin/delivery-assignments/${id}/cancel`, { reason }).then((r) => r.data.assignment),
};
