import api from './api';

export const orderService = {
  // { order, razorpay } — razorpay is null for COD, or {orderId, amount, currency, keyId} for ONLINE.
  create: (payload) => api.post('/orders', payload).then((r) => r.data),
  list: (params) => api.get('/orders', { params }).then((r) => r.data),
  getById: (id) => api.get(`/orders/${id}`).then((r) => r.data.order),
  updateStatus: (id, status) => api.patch(`/orders/${id}/status`, { status }).then((r) => r.data.order),
  cancel: (id, reason) => api.post(`/orders/${id}/cancel`, { reason }).then((r) => r.data.order),
  // A fresh Razorpay order for an ONLINE order that hasn't been paid yet (bank decline, closed
  // Checkout, etc.) — same { order, razorpay } shape as create().
  retryPayment: (id) => api.post(`/orders/${id}/retry-payment`).then((r) => r.data),
  verifyPayment: (id, payload) => api.post(`/orders/${id}/verify-payment`, payload).then((r) => r.data.order),
  // { available, otp?, expiresAt?, attemptsRemaining?, locked? } — otp is present only while available.
  getDeliveryOtp: (id) => api.get(`/orders/${id}/delivery-otp`).then((r) => r.data),
};
