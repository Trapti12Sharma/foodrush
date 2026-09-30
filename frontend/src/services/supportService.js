import api from './api';

// Shared by the customer, delivery-partner and restaurant-owner support pages —
// the API is identical for all three; every ticket is scoped to "my own" on the
// backend regardless of which of these three roles is calling it.
export const supportService = {
  createTicket: (payload) => api.post('/support/tickets', payload).then((r) => r.data.ticket),
  myTickets: (params) => api.get('/support/tickets', { params }).then((r) => r.data),
  getTicket: (id) => api.get(`/support/tickets/${id}`).then((r) => r.data.ticket),
  addMessage: (id, payload) => api.post(`/support/tickets/${id}/messages`, payload).then((r) => r.data.ticket),
  closeTicket: (id) => api.patch(`/support/tickets/${id}/close`).then((r) => r.data.ticket),
};
