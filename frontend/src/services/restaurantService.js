import api from './api';

export const restaurantService = {
  list: (params) => api.get('/restaurants', { params }).then((r) => r.data),
  // Restaurants around a point with distance, ETA estimate and filters (see the API docs).
  nearby: (params) => api.get('/restaurants/nearby', { params }).then((r) => r.data),
  // Cities that currently have live restaurants — a location picker that needs no Google key.
  cities: () => api.get('/restaurants/cities').then((r) => r.data.cities),
  // { deliverable: true | false | null, distanceKm, radiusKm } — null means it can't be measured.
  deliveryCheck: (id, latitude, longitude) => api.post(`/restaurants/${id}/delivery-check`, { latitude, longitude }).then((r) => r.data),
  getById: (id) => api.get(`/restaurants/${id}`).then((r) => r.data.restaurant),
  listMine: () => api.get('/restaurants/mine').then((r) => r.data.restaurants),
  create: (payload) => api.post('/restaurants', payload).then((r) => r.data.restaurant),
  update: (id, payload) => api.put(`/restaurants/${id}`, payload).then((r) => r.data.restaurant),
  remove: (id) => api.delete(`/restaurants/${id}`),
  getDashboard: (id) => api.get(`/restaurants/${id}/dashboard`).then((r) => r.data),
  // M16 — date-ranged analytics for one restaurant the caller owns. `params` is
  // { preset } or { preset: 'custom', startDate, endDate }, plus an optional
  // `limit` for how many top menu items to return.
  getAnalytics: (id, params) => api.get(`/restaurants/${id}/analytics`, { params }).then((r) => r.data),
  // `type` is one of image | coverImage | logo. Uploads and persists in one request
  // (see backend/src/routes/restaurant.routes.js) — the old image is only removed
  // server-side once this succeeds.
  uploadImage: (id, type, file) => {
    const formData = new FormData();
    formData.append('image', file);
    return api.post(`/restaurants/${id}/images/${type}`, formData).then((r) => r.data.restaurant);
  },
  deleteImage: (id, type) => api.delete(`/restaurants/${id}/images/${type}`).then((r) => r.data.restaurant),
  // M14 — submit (or resubmit) business-verification documents for admin review.
  // Never touches isApproved/isActive itself.
  submitKyc: (id, payload) => api.post(`/restaurants/${id}/kyc/submit`, payload).then((r) => r.data.restaurant),
  // This restaurant's OWN coupons only — never the platform/city-wide ones an
  // admin manages via couponService. `restaurant`/`city`/`fundedBy` are forced
  // server-side from the URL, not accepted from `payload`.
  listCoupons: (id, params) => api.get(`/restaurants/${id}/coupons`, { params }).then((r) => r.data),
  createCoupon: (id, payload) => api.post(`/restaurants/${id}/coupons`, payload).then((r) => r.data.coupon),
  updateCoupon: (id, couponId, payload) => api.patch(`/restaurants/${id}/coupons/${couponId}`, payload).then((r) => r.data.coupon),
};
