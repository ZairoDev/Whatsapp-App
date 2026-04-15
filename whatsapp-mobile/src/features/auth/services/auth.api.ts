import type { LoginResponse, VerifyOtpResponse, ResendOtpResponse } from '../types';

const AUTH_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://adminstro.in/api';
const TIMEOUT_MS = 15000;

type ApiError = Error & {
  response?: Response;
  status?: number;
  data?: unknown;
};

async function request<T>(
  path: string,
  body: object,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${AUTH_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(extraHeaders ?? {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = (await res.json().catch(() => ({}))) as T | { error?: string };
    if (!res.ok) {
      const err: ApiError = new Error(typeof (data as { error?: string }).error === 'string' ? (data as { error?: string }).error : 'Request failed');
      err.response = res;
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data as T;
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error) {
      const apiErr = e as ApiError;
      if (e.name === 'AbortError') {
        apiErr.message = 'Request timed out. Please check your connection and try again.';
      }
      throw e;
    }
    throw e;
  }
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>('/employeelogin', { email, password });
}

export async function verifyOtp(otp: string, email: string): Promise<VerifyOtpResponse> {
  // Backend derives email from the Referer header: referer?.split(\"otp/\")[1]
  // Mobile doesn't set this automatically, so we fake a web-like referer here.
  const referer = `https://mobile-app/otp/${email}`;
  return request<VerifyOtpResponse>(
    '/verify-otp',
    { otp },
    { referer },
  );

}

export async function resendOtp(email: string): Promise<ResendOtpResponse> {
  return request<ResendOtpResponse>('/resend-otp', { email });
}

export async function employeeLogout(token: string): Promise<{ message?: string; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${AUTH_BASE_URL}/employeeLogout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    if (!res.ok) {
      const err: ApiError = new Error(
        typeof data.error === 'string' ? data.error : 'Logout failed'
      );
      (err as ApiError).response = res;
      (err as ApiError).status = res.status;
      (err as ApiError).data = data;
      throw err;
    }
    return data;
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error) {
      const apiErr = e as ApiError;
      if (e.name === 'AbortError') {
        apiErr.message = 'Request timed out. Please check your connection and try again.';
      }
      throw e;
    }
    throw e;
  }
}

function isApiError(err: unknown): err is ApiError {
  return err instanceof Error && 'status' in err;
}

export function getLoginErrorMessage(err: unknown): string {
  if (isApiError(err)) {
    const data = err.data as { error?: string } | undefined;
    const msg = data?.error;
    if (typeof msg === 'string' && msg) return msg;
    if (err.status === 401) return 'Invalid email or password.';
    if (err.status === 404) return 'Service not found. Please try again later.';
    if (err.message?.includes('timed out')) return err.message;
    if (err.message) return err.message;
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return 'Request timed out. Please check your connection and try again.';
  }
  return 'Something went wrong. Please try again later.';
}

export function getVerifyOtpErrorMessage(err: unknown): string {
  if (isApiError(err)) {
    const data = err.data as { error?: string } | undefined;
    const msg = data?.error;
    if (typeof msg === 'string' && msg) return msg;
  }
  return 'Verification failed. Please try again.';
}
