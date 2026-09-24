import api from './api';

export const deliveryEarningService = {
  // { items, pagination, summary: {totalEarned, pendingSettlement, settledAmount} }
  myEarnings: (params) => api.get('/delivery-partners/me/earnings', { params }).then((r) => r.data),
  myEarningById: (id) => api.get(`/delivery-partners/me/earnings/${id}`).then((r) => r.data.earning),
};
