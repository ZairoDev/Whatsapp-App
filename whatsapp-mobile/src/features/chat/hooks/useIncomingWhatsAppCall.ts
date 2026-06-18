import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket, joinWhatsAppCallsRoom, joinWhatsAppPhone } from '../../../services';
import { WhatsAppCallSession, extractCallSessionFromPayload } from '../../../services/whatsappCallSession';
import { isCallActive } from '../../../services/callAudioSession';
import { useChatStore } from '../chat.store';
import type { PhoneConfig } from '../types';
import type { WhatsAppArea } from '../services';
import {
  answerIncomingWhatsAppCall,
  fetchIceServers,
  rejectIncomingWhatsAppCall,
  terminateWhatsAppCall,
} from '../services';

export type IncomingCallPhase =
  | 'idle'
  | 'ringing'
  | 'accepting'
  | 'active'
  | 'ending';

export interface IncomingCallInfo {
  callId: string;
  /** Caller's WhatsApp number (E.164 digits) */
  from?: string;
  conversationId?: string;
  area: WhatsAppArea;
  phoneNumberId?: string;
}

function isTerminalStatus(st: string): boolean {
  const s = st.toLowerCase();
  return (
    s === 'completed' ||
    s === 'terminated' ||
    s === 'failed' ||
    s === 'missed' ||
    s === 'rejected' ||
    s === 'busy' ||
    s === 'cancelled' ||
    s === 'canceled'
  );
}

function resolveAreaFromPhoneId(
  phoneNumberId: string | undefined,
  configs: PhoneConfig[] | null,
): WhatsAppArea {
  if (!phoneNumberId || !configs?.length) return 'athens';
  const cfg = configs.find((c) => String(c.phoneNumberId) === String(phoneNumberId));
  if (!cfg) return 'athens';
  const raw = cfg.area;
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') return 'athens';
  const area = first.split(',')[0]?.toLowerCase().trim();
  return area || 'athens';
}

export function useIncomingWhatsAppCall() {
  const [phase, setPhase] = useState<IncomingCallPhase>('idle');
  const [incomingCall, setIncomingCall] = useState<IncomingCallInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef(new WhatsAppCallSession());
  const callRef = useRef<IncomingCallInfo | null>(null);
  // Store the remote SDP without triggering re-renders
  const remoteSdpRef = useRef<string | null>(null);

  const reset = useCallback(async () => {
    await sessionRef.current.cleanup();
    callRef.current = null;
    remoteSdpRef.current = null;
    setIncomingCall(null);
    setPhase('idle');
    setError(null);
  }, []);

  const endCall = useCallback(async () => {
    const call = callRef.current;
    setPhase('ending');
    try {
      if (call?.callId) {
        await terminateWhatsAppCall({
          callId: call.callId,
          area: call.area,
          conversationId: call.conversationId,
          phoneNumberId: call.phoneNumberId,
        });
      }
    } catch {
      // still tear down local media
    } finally {
      await reset();
    }
  }, [reset]);

  const declineCall = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    setPhase('ending');
    try {
      await rejectIncomingWhatsAppCall({
        callId: call.callId,
        area: call.area,
        conversationId: call.conversationId,
        phoneNumberId: call.phoneNumberId,
      });
    } catch {
      // still tear down
    } finally {
      await reset();
    }
  }, [reset]);

  const acceptCall = useCallback(async () => {
    const call = callRef.current;
    const remoteSdp = remoteSdpRef.current;
    if (!call || !remoteSdp) return;

    console.log('[IncomingCall] accepting callId:', call.callId, 'area:', call.area);
    setPhase('accepting');
    setError(null);

    try {
      const iceServers = await fetchIceServers();
      console.log('[IncomingCall] ICE servers loaded:', iceServers.length);

      const answer = await sessionRef.current.answerOffer(remoteSdp, iceServers);
      console.log('[IncomingCall] SDP answer built, sdpType:', answer.sdpType);

      await answerIncomingWhatsAppCall({
        callId: call.callId,
        area: call.area,
        conversationId: call.conversationId,
        phoneNumberId: call.phoneNumberId,
        session: answer,
      });

      console.log('[IncomingCall] answer sent to backend — call active');
      setPhase('active');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to answer call';
      console.error('[IncomingCall] acceptCall failed:', msg);
      setError(msg);
      await sessionRef.current.cleanup();
      setPhase('idle');
    }
  }, []);

  // Subscribe to phone rooms whenever configs become available in the store.
  const phoneConfigs = useChatStore((s) => s.phoneConfigs);
  useEffect(() => {
    if (!phoneConfigs?.length) return;
    phoneConfigs.forEach((cfg) => {
      if (cfg.phoneNumberId) joinWhatsAppPhone(cfg.phoneNumberId);
    });
  }, [phoneConfigs]);

  // Global socket listener for incoming calls — runs for the lifetime of the component.
  useEffect(() => {
    // Join the global calls room AND any phone rooms already in the store.
    joinWhatsAppCallsRoom();
    const configs = useChatStore.getState().phoneConfigs ?? [];
    configs.forEach((cfg) => {
      if (cfg.phoneNumberId) joinWhatsAppPhone(cfg.phoneNumberId);
    });

    const onIncomingCall = (data: unknown) => {
      if (!data || typeof data !== 'object') return;

      // Don't interrupt an active outgoing call
      if (isCallActive()) return;

      // If already handling an incoming call, ignore duplicate events
      if (callRef.current) return;

      const payload = data as Record<string, unknown>;
      const extracted = extractCallSessionFromPayload(data);

      // Do NOT .trim() the SDP — the trailing \r\n is part of the RFC 4566 format.
      // Android's strict libwebrtc parser returns nullptr (→ "SessionDescription is NULL")
      // when the last SDP line has no CRLF terminator.
      const remoteSdp = extracted?.sdp ?? (typeof payload.sdp === 'string' ? payload.sdp : '');
      if (!remoteSdp) {
        console.warn('[IncomingCall] event missing SDP, ignoring');
        return;
      }

      const sdpType = extracted?.sdpType ?? 'offer';
      if (sdpType !== 'offer') {
        console.warn('[IncomingCall] expected offer SDP, got:', sdpType);
        return;
      }

      const callId =
        extracted?.callId ??
        (typeof payload.callId === 'string' ? payload.callId : undefined);
      if (!callId) {
        console.warn('[IncomingCall] event missing callId, ignoring');
        return;
      }

      const phoneNumberId =
        (typeof payload.phoneNumberId === 'string' ? payload.phoneNumberId : undefined) ??
        (typeof payload.phone_number_id === 'string' ? payload.phone_number_id : undefined);

      const from =
        (typeof payload.from === 'string' ? payload.from : undefined) ??
        (typeof payload.caller === 'string' ? payload.caller : undefined);

      const configs = useChatStore.getState().phoneConfigs;
      const area = resolveAreaFromPhoneId(phoneNumberId, configs);

      const callInfo: IncomingCallInfo = {
        callId,
        from,
        conversationId: extracted?.conversationId,
        area,
        phoneNumberId,
      };

      callRef.current = callInfo;
      remoteSdpRef.current = remoteSdp;
      setIncomingCall(callInfo);
      setPhase('ringing');
    };

    const onCallStatus = (data: unknown) => {
      // Only care if we have an active incoming call
      if (!callRef.current) return;
      if (!data || typeof data !== 'object') return;

      const extracted = extractCallSessionFromPayload(data);
      if (!extracted) return;

      // Ignore status events for a different call
      if (
        extracted.callId &&
        callRef.current.callId &&
        extracted.callId !== callRef.current.callId
      ) {
        return;
      }

      const st = String(extracted.callStatus ?? extracted.event ?? '').toLowerCase();
      if (!st) return;

      if (st === 'accepted' || st === 'connect' || st === 'connected') {
        setPhase('active');
        return;
      }

      if (isTerminalStatus(st)) {
        void reset();
      }
    };

    const attach = (socket: ReturnType<typeof getSocket>) => {
      if (!socket) return false;
      socket.off('whatsapp-call-incoming-offer', onIncomingCall);
      socket.off('whatsapp-call-status', onCallStatus);
      socket.on('whatsapp-call-incoming-offer', onIncomingCall);
      socket.on('whatsapp-call-status', onCallStatus);
      return true;
    };

    let attached = attach(getSocket());
    const poll = attached
      ? null
      : setInterval(() => {
          if (attach(getSocket())) {
            if (poll) clearInterval(poll);
          }
        }, 400);

    return () => {
      if (poll) clearInterval(poll);
      const socket = getSocket();
      if (socket) {
        socket.off('whatsapp-call-incoming-offer', onIncomingCall);
        socket.off('whatsapp-call-status', onCallStatus);
      }
    };
  }, [reset]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      void sessionRef.current.cleanup();
    };
  }, []);

  const inCall = phase === 'accepting' || phase === 'active' || phase === 'ending';

  return {
    phase,
    incomingCall,
    error,
    inCall,
    acceptCall,
    declineCall,
    endCall,
    reset,
  };
}
