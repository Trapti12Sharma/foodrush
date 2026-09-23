import api from './api';

export const deliveryAssignmentService = {
  myOffers: () => api.get('/delivery-assignments/me/offers').then((r) => r.data.offers),
  myCurrentDelivery: () => api.get('/delivery-assignments/me/current').then((r) => r.data.assignment),
  myAssignments: (params) => api.get('/delivery-assignments/me', { params }).then((r) => r.data),
  accept: (id) => api.patch(`/delivery-assignments/${id}/accept`).then((r) => r.data),
  reject: (id, reason) => api.patch(`/delivery-assignments/${id}/reject`, { reason }).then((r) => r.data.assignment),
  // { order, assignment } on success — throws (via api.js's interceptor) with a clear
  // message on wrong/expired/locked OTP, exactly like every other service call.
  verifyOtp: (id, otp) => api.post(`/delivery-assignments/${id}/verify-otp`, { otp }).then((r) => r.data),
};
