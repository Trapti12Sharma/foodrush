import api from './api';

export const deliveryPartnerService = {
  create: (payload) => api.post('/delivery-partners', payload).then((r) => r.data.deliveryPartner),
  getMe: () => api.get('/delivery-partners/me').then((r) => r.data.deliveryPartner),
  updateMe: (payload) => api.put('/delivery-partners/me', payload).then((r) => r.data.deliveryPartner),
  setAvailability: (availability) =>
    api.patch('/delivery-partners/me/availability', { availability }).then((r) => r.data.deliveryPartner),
  updateLocation: (latitude, longitude, accuracy) =>
    api.patch('/delivery-partners/me/location', { latitude, longitude, accuracy }).then((r) => r.data.deliveryPartner),
};
