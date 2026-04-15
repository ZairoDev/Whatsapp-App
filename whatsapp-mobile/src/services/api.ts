import axios, { AxiosHeaders, AxiosInstance, AxiosRequestConfig } from 'axios';
import { API_CONFIG } from '../constants';
import { useAuthStore } from '../features/auth/auth.store';

function isSessionTokenInvalid(status: number | undefined, message: string): boolean {
  if (status !== 401 && status !== 403) return false;
  const msg = (message || '').toLowerCase();
  // Only treat *actual* employee/JWT auth failures as a reason to clear session.
  // WhatsApp/Meta integration can also surface as 401/403 but should not log out the employee.
  return (
    msg.includes('jwt') ||
    msg.includes('token expired') ||
    msg.includes('invalid token') ||
    msg.includes('unauthorized') ||
    msg.includes('not authorized') ||
    msg.includes('session expired')
  );
}

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
      // Axios v1 may represent headers as an AxiosHeaders instance (with .set()),
      // while older versions use a plain object. Support both safely.
      const h: any = config.headers;
      if (h && typeof h.set === 'function') {
        h.set('Authorization', `Bearer ${token}`);
      } else {
        const headers = AxiosHeaders.from((config.headers ?? {}) as any);
        headers.set('Authorization', `Bearer ${token}`);
        config.headers = headers;
      }
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
      const reason =
        typeof error?.message === 'string' && error.message
          ? ` (${error.message})`
          : '';
      const netError = new Error(`Network error — please check your internet connection.${reason}`);
      (netError as any).isNetworkError = true;
      return Promise.reject(netError);
    }

    // Only clear auth state when we are confident the employee session is invalid.
    if (isSessionTokenInvalid(status, serverMsg)) {
      await useAuthStore.getState().markSessionExpired();
      return Promise.reject(error);
    }

    return Promise.reject(error);
  }
);

export type ApiRequestConfig = AxiosRequestConfig;
export default api;
