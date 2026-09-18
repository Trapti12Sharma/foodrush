import api from './api';

export const uploadService = {
  uploadImage: (file) => {
    const formData = new FormData();
    formData.append('image', file);
    return api.post('/uploads/image', formData).then((r) => r.data.url);
  },
};
