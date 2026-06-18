/**
 * WhatsApp Cloud API calling — matches POST/GET /api/whatsapp/call on the backend.
 */
import api from '../../../services/api';

// ─── ICE servers ─────────────────────────────────────────────────────────────

const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

/**
 * Fetch short-lived Metered TURN + Google STUN credentials from the backend.
 * Mirrors what the web app fetches from GET /api/whatsapp/ice-servers.
 * Falls back to Google STUN only if the API call fails.
 */
export async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const { data } = await api.get<{
      servers?: RTCIceServer[];
      relayConfigured?: boolean;
    }>('/whatsapp/ice-servers');

    const servers = data?.servers;
    if (Array.isArray(servers) && servers.length > 0) {
      console.log('[ice-servers] loaded', servers.length, 'servers, relay:', data?.relayConfigured);
      return servers;
    }
  } catch (e) {
    console.warn('[ice-servers] fetch failed — falling back to Google STUN:', e);
  }
  return FALLBACK_ICE_SERVERS;
}
import type { WhatsAppArea } from './index';

async function ensurePhoneId(area: WhatsAppArea, phoneId?: string): Promise<string> {
  const { ensurePhoneId: resolve } = await import('./index');
  return resolve(area, phoneId);
}

export type CallAction =
  | 'permission_request'
  | 'start_call'
  | 'terminate_call'
  | 'notify'
  | 'answer_incoming_call'
  | 'reject_incoming_call';

export interface CallPermissionState {
  canMakeCalls: boolean;
  canStartCall: boolean;
  canRequestPermission: boolean;
  permissionStatus: string;
  raw?: unknown;
}

export interface StartCallResult {
  callId?: string;
  type?: string;
  data?: unknown;
}

function isMongoObjectId(id: string | undefined | null): boolean {
  if (!id) return false;
  return /^[a-fA-F0-9]{24}$/.test(id);
}

function formatE164Digits(phone: string): string {
  return phone.replace(/\D/g, '').trim();
}

/** Parse Meta call_permissions payload nested under GET /whatsapp/call `data`. */
export function parseCallPermissionState(metaPayload: unknown): CallPermissionState {
  const root = (metaPayload ?? {}) as Record<string, unknown>;
  const permission = (root.permission ?? {}) as Record<string, unknown>;
  const status = String(permission.status ?? 'no_permission');
  const actions = Array.isArray(root.actions) ? root.actions : [];

  const findAction = (name: string) =>
    actions.find((a) => String((a as Record<string, unknown>).action_name) === name) as
      | Record<string, unknown>
      | undefined;

  const startCallAction = findAction('start_call');
  const requestAction = findAction('send_call_permission_request');

  const canStartCall =
    status === 'temporary' || Boolean(startCallAction?.can_perform_action === true);
  const canRequestPermission = Boolean(requestAction?.can_perform_action === true);

  return {
    canMakeCalls: true,
    canStartCall,
    canRequestPermission,
    permissionStatus: status,
    raw: metaPayload,
  };
}

export async function fetchCallPermissions(params: {
  area: WhatsAppArea;
  userWaId: string;
  phoneNumberId?: string;
}): Promise<CallPermissionState> {
  const waId = formatE164Digits(params.userWaId);
  if (!waId) throw new Error('Missing recipient WhatsApp ID');

  const phoneNumberId = await ensurePhoneId(params.area, params.phoneNumberId);
  if (!phoneNumberId) throw new Error('No WhatsApp phone configured for this area');

  const { data } = await api.get<{
    success?: boolean;
    canMakeCalls?: boolean;
    data?: unknown;
    error?: string;
  }>('/whatsapp/call', {
    params: { phoneNumberId, userWaId: waId },
  });

  if (data?.error) throw new Error(data.error);
  if (data?.canMakeCalls === false) {
    return {
      canMakeCalls: false,
      canStartCall: false,
      canRequestPermission: false,
      permissionStatus: 'no_permission',
      raw: data,
    };
  }

  const parsed = parseCallPermissionState(data?.data);
  return {
    ...parsed,
    canMakeCalls: true,
    raw: data?.data,
  };
}

export async function postWhatsAppCall(body: Record<string, unknown>): Promise<{
  success?: boolean;
  type?: string;
  callId?: string;
  message?: string;
  error?: string;
  data?: unknown;
}> {
  const { data } = await api.post('/whatsapp/call', body);
  if (data?.error) {
    throw new Error(String(data.error));
  }
  return data;
}

export async function sendCallPermissionRequest(params: {
  area: WhatsAppArea;
  to: string;
  conversationId?: string;
  phoneNumberId?: string;
  bodyText?: string;
}): Promise<void> {
  const to = formatE164Digits(params.to);
  if (!to) throw new Error('Recipient phone is required');

  const phoneNumberId = await ensurePhoneId(params.area, params.phoneNumberId);
  const body: Record<string, unknown> = {
    action: 'permission_request',
    to,
    phoneNumberId,
  };
  if (isMongoObjectId(params.conversationId)) {
    body.conversationId = params.conversationId;
  }
  if (params.bodyText?.trim()) {
    body.bodyText = params.bodyText.trim();
  }

  await postWhatsAppCall(body);
}

export async function startWhatsAppCall(params: {
  area: WhatsAppArea;
  to?: string;
  session: { sdpType: 'offer'; sdp: string };
  conversationId?: string;
  phoneNumberId?: string;
}): Promise<StartCallResult> {
  const hasConversation = isMongoObjectId(params.conversationId);
  const to = params.to ? formatE164Digits(params.to) : '';
  if (!hasConversation && !to) {
    throw new Error('Recipient phone or conversationId is required');
  }

  const body: Record<string, unknown> = {
    action: 'start_call',
    session: {
      sdpType: params.session.sdpType,
      sdp: params.session.sdp,
    },
  };
  if (to) body.to = to;
  if (hasConversation) {
    body.conversationId = params.conversationId;
    body.bizOpaqueCallbackData = params.conversationId;
  } else {
    const phoneNumberId = await ensurePhoneId(params.area, params.phoneNumberId);
    body.phoneNumberId = phoneNumberId;
  }

  const data = await postWhatsAppCall(body);
  return {
    callId: data.callId as string | undefined,
    type: data.type,
    data: data.data,
  };
}

export async function terminateWhatsAppCall(params: {
  callId: string;
  area: WhatsAppArea;
  conversationId?: string;
  phoneNumberId?: string;
}): Promise<void> {
  const phoneNumberId = await ensurePhoneId(params.area, params.phoneNumberId);
  const body: Record<string, unknown> = {
    action: 'terminate_call',
    callId: params.callId,
    phoneNumberId,
  };
  if (isMongoObjectId(params.conversationId)) {
    body.conversationId = params.conversationId;
  }
  await postWhatsAppCall(body);
}

/** Accept an incoming WhatsApp call (customer-initiated). */
export async function answerIncomingWhatsAppCall(params: {
  callId: string;
  area: WhatsAppArea;
  session: { sdpType: 'answer'; sdp: string };
  conversationId?: string;
  phoneNumberId?: string;
}): Promise<void> {
  const phoneNumberId = await ensurePhoneId(params.area, params.phoneNumberId);
  const body: Record<string, unknown> = {
    action: 'answer_incoming_call',
    callId: params.callId,
    phoneNumberId,
    session: {
      sdpType: params.session.sdpType,
      sdp: params.session.sdp,
    },
  };
  if (isMongoObjectId(params.conversationId)) {
    body.conversationId = params.conversationId;
  }
  await postWhatsAppCall(body);
}

/** Reject / decline an incoming WhatsApp call (customer-initiated). */
export async function rejectIncomingWhatsAppCall(params: {
  callId: string;
  area: WhatsAppArea;
  conversationId?: string;
  phoneNumberId?: string;
}): Promise<void> {
  const phoneNumberId = await ensurePhoneId(params.area, params.phoneNumberId);
  const body: Record<string, unknown> = {
    action: 'reject_incoming_call',
    callId: params.callId,
    phoneNumberId,
  };
  if (isMongoObjectId(params.conversationId)) {
    body.conversationId = params.conversationId;
  }
  await postWhatsAppCall(body);
}
