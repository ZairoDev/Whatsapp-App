/**
 * Auth API and store types.
 * Matches backend employeelogin / verify-otp responses.
 */
export interface TokenInterface {
  token?: string;
  id?: string;        // ← add this
  userId?: string;
  name?: string;      // ← add this
  email?: string;
  role?: string;
  allotedArea?: string[];  // ← add this
  expiresAt?: number;
  [key: string]: unknown;
}

export interface LoginResponse {
  otpRequired?: boolean;
  message?: string;
  token?: string;
  tokenData?: TokenInterface;
  user?: Record<string, unknown>;
  error?: string;
  [key: string]: unknown;
}

export interface VerifyOtpResponse {
  token?: string;
  tokenData?: TokenInterface;
  user?: Record<string, unknown>;
  error?: string;
  [key: string]: unknown;
}

/** Build store token from API response (handles token at root or inside tokenData). */
export function toTokenData(res: Record<string, unknown>): TokenInterface | null {
  // Token is at root level in your backend response
  const token = res.token as string | undefined;
  
  if (!token) return null;

  // Merge tokenData fields + token into one object
  const data = (res.tokenData && typeof res.tokenData === 'object')
    ? res.tokenData as Record<string, unknown>
    : {};

  return {
    ...data,
    token,
  } as TokenInterface;
}

export interface ResendOtpResponse {
  message?: string;
  error?: string;
}
