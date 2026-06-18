/** Structured error body returned by Adminstro WhatsApp routes (send-message, send-template, etc.). */
export type WhatsAppApiErrorBody = {
  error?: string;
  message?: string;
  hint?: string;
  code?: string;
  channelId?: string | null;
  channelName?: string | null;
  phoneNumberId?: string;
  hasAccessToken?: boolean;
  warning?: string;
  metaUnavailable?: boolean;
  upstreamMessage?: string;
};

/** Extract the best user-facing message from an axios/API error. */
export function getApiErrorMessage(error: unknown, fallback = 'Request failed'): string {
  if (!error || typeof error !== 'object') return fallback;
  const err = error as { message?: string; response?: { data?: WhatsAppApiErrorBody } };
  const data = err.response?.data;
  if (typeof data?.error === 'string' && data.error.trim()) return data.error.trim();
  if (typeof data?.hint === 'string' && data.hint.trim()) return data.hint.trim();
  if (typeof data?.message === 'string' && data.message.trim()) return data.message.trim();
  if (typeof data?.warning === 'string' && data.warning.trim()) return data.warning.trim();
  if (typeof err.message === 'string' && err.message.trim()) return err.message.trim();
  return fallback;
}

export function getApiErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const data = (error as { response?: { data?: WhatsAppApiErrorBody } }).response?.data;
  return typeof data?.code === 'string' ? data.code : undefined;
}
