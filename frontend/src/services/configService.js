import api from './api';

export const configService = {
  get: () => api.get('/config').then((r) => r.data),
};
