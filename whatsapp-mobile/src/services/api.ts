import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { API_CONFIG } from '../constants';
import { useAuthStore } from '../features/auth/auth.store';

/**
 * Configured axios instance for HTTP requests.
 * Attaches Bearer token from auth store for authenticated endpoints.
 */
const api: AxiosInstance = axios.create({
  baseURL: API_CONFIG.BASE_URL,
  timeout: API_CONFIG.TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach auth token so /whatsapp/conversations etc. return 200
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().tokenData?.token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor (e.g. handle 401, transform errors)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // if (error.response?.status === 401) { /* logout */ }
    return Promise.reject(error);
  }
);

export type ApiRequestConfig = AxiosRequestConfig;
export default api;
