import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { API_CONFIG } from '../constants';
import { useAuthStore } from '../features/auth/auth.store';

const api: AxiosInstance = axios.create({
  baseURL: API_CONFIG.BASE_URL,
  timeout: API_CONFIG.TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach Bearer token on every request.
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

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status: number | undefined = error?.response?.status;
    const url = error?.config?.url ?? 'unknown';
    const method = error?.config?.method?.toUpperCase() ?? '?';
    const serverMsg: string =
      error?.response?.data?.error ??
      error?.response?.data?.message ??
      error?.message ??
      '';

    console.warn(`[API ${status ?? 'NET'}] ${method} ${url} — ${serverMsg}`);

    // No HTTP response at all = pure network/timeout error.
    // Do NOT clear auth state — the device may simply be offline.
    if (!error?.response) {
      const netError = new Error(
        'Network error — please check your internet connection.'
      );
      (netError as any).isNetworkError = true;
      return Promise.reject(netError);
    }

    // Any HTTP 401 = token is definitively invalid/expired.
    if (status === 401) {
      await useAuthStore.getState().markSessionExpired();
      return Promise.reject(error);
    }

    // This backend returns HTTP 500 for expired/invalid tokens instead of 401.
    // Treat every 5xx as a session failure so the user is sent back to login
    // automatically rather than seeing a raw error string.
    if (status !== undefined && status >= 500) {
      await useAuthStore.getState().markSessionExpired();
      return Promise.reject(error);
    }

    return Promise.reject(error);
  }
);

export type ApiRequestConfig = AxiosRequestConfig;
export default api;
