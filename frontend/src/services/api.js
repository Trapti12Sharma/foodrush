import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  withCredentials: true, // send/receive the httpOnly auth cookie
});

// AuthContext registers a callback here instead of api.js importing AuthContext
// directly, which would create a circular dependency (context needs api, api
// would need context).
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

api.interceptors.response.use(
  (response) => response.data, // unwrap {success, message, data} once, here
  (error) => {
    const status = error.response?.status;
    const message = error.response?.data?.message || error.message || 'Something went wrong';
    const errors = error.response?.data?.errors || [];
    const data = error.response?.data?.data; // e.g. cart's cross-restaurant conflict payload

    if (status === 401 && onUnauthorized) onUnauthorized();

    return Promise.reject({ status, message, errors, data });
  }
);

export default api;
