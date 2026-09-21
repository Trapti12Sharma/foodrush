import api from './api';

export const uploadService = {
  // `purpose` decides who may upload what: avatar (any signed-in user), or restaurant / food /
  // category (restaurant owners and restaurant-management staff) — enforced by the backend.
  uploadImage: (file, purpose = 'avatar') => {
    const formData = new FormData();
    formData.append('image', file);
    return api.post(`/uploads/image?purpose=${encodeURIComponent(purpose)}`, formData).then((r) => r.data.url);
  },
};
