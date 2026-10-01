import api from './api';

export const couponService = {
  // What a signed-in customer can actually use right now at this restaurant —
  // already filtered server-side for active/unexpired/not-globally-exhausted/
  // not-personally-exhausted (see coupon.service.js#listAvailableForCustomer).
  listAvailable: (restaurantId) => api.get('/coupons/available', { params: { restaurantId } }).then((r) => r.data.coupons),
};
