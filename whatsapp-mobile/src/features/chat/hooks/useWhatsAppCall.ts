import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { getSocket, joinWhatsAppCallsRoom, leaveWhatsAppCallsRoom } from '../../../services';
import { WhatsAppCallSession, extractCallSessionFromPayload } from '../../../services/whatsappCallSession';
import type { WhatsAppArea } from '../services';
import {
  fetchCallPermissions,
  fetchIceServers,
  sendCallPermissionRequest,
  startWhatsAppCall,
  terminateWhatsAppCall,
} from '../services';

export type OutgoingCallPhase =
  | 'idle'
  | 'checking'
  | 'requesting_permission'
  | 'connecting'
  | 'ringing'
  | 'active'
  | 'ending'
  | 'error';

export interface UseWhatsAppCallParams {
  area: WhatsAppArea;
  conversationId: string;
  participantWaId: string;
  conversationName?: string;
  enabled: boolean;
}

function isTerminalCallStatus(status: string): boolean {
  const s = status.toLowerCase();
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

export function useWhatsAppCall({
  area,
  conversationId,
  participantWaId,
  conversationName,
  enabled,
}: UseWhatsAppCallParams) {
  const [phase, setPhase] = useState<OutgoingCallPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);

  const sessionRef = useRef(new WhatsAppCallSession());
  const activeCallIdRef = useRef<string | null>(null);
  const outboundConversationIdRef = useRef<string | null>(null);

  const reset = useCallback(async () => {
    await sessionRef.current.cleanup();
    activeCallIdRef.current = null;
    outboundConversationIdRef.current = null;
    setActiveCallId(null);
    setPhase('idle');
    setError(null);
    leaveWhatsAppCallsRoom();
  }, []);

  const endCall = useCallback(async () => {
    const callId = activeCallIdRef.current;
    setPhase('ending');
    try {
      if (callId) {
        await terminateWhatsAppCall({
          callId,
          area,
          conversationId,
        });
      }
    } catch {
      // still tear down local media
    } finally {
      await reset();
    }
  }, [area, conversationId, reset]);

  const applySdpAnswer = useCallback(
    async (data: Record<string, unknown>) => {
      const extracted = extractCallSessionFromPayload(data);
      if (!extracted?.sdp?.trim()) return;

      const convId = extracted.conversationId;
      const pendingConv = outboundConversationIdRef.current;
      if (pendingConv && convId && convId !== pendingConv) return;

      const callId = extracted.callId;
      if (callId && activeCallIdRef.current && callId !== activeCallIdRef.current) return;

      try {
        await sessionRef.current.applyRemoteAnswer(
          extracted.sdp,
          extracted.sdpType ?? 'answer'
        );
        if (callId) {
          activeCallIdRef.current = callId;
          setActiveCallId(callId);
        }
        setPhase('active');
        setError(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to connect audio';
        setError(msg);
        setPhase('error');
        await endCall();
      }
    },
    [endCall]
  );

  const handleCallStatus = useCallback(
    async (data: Record<string, unknown>) => {
      const extracted = extractCallSessionFromPayload(data);
      if (!extracted) return;

      const callId = extracted.callId;
      if (callId && activeCallIdRef.current && callId !== activeCallIdRef.current) {
        return;
      }

      const st = String(extracted.callStatus ?? extracted.event ?? '').toLowerCase();
      if (!st) return;

      if (st === 'ringing' || st === 'ring') {
        setPhase((prev) => (prev === 'active' ? prev : 'ringing'));
        return;
      }

      if (st === 'accepted' || st === 'connect' || st === 'connected') {
        setPhase('active');
        return;
      }

      if (isTerminalCallStatus(st)) {
        await reset();
      }
    },
    [reset]
  );

  useEffect(() => {
    if (!enabled) return;

    joinWhatsAppCallsRoom();

    const onSdpAnswer = (data: unknown) => {
      if (!data || typeof data !== 'object') return;
      void applySdpAnswer(data as Record<string, unknown>);
    };

    const onCallStatus = (data: unknown) => {
      if (!data || typeof data !== 'object') return;
      void handleCallStatus(data as Record<string, unknown>);
    };

    const onCallMissed = (data: unknown) => {
      if (!data || typeof data !== 'object') return;
      const extracted = extractCallSessionFromPayload(data);
      if (extracted?.callId && activeCallIdRef.current && extracted.callId !== activeCallIdRef.current) {
        return;
      }
      Alert.alert('Missed call', 'The call was not answered.');
      void reset();
    };

    const attach = (socket: ReturnType<typeof getSocket>) => {
      if (!socket) return false;
      socket.off('whatsapp-call-sdp-answer', onSdpAnswer);
      socket.off('whatsapp-call-status', onCallStatus);
      socket.off('whatsapp-call-missed', onCallMissed);
      socket.on('whatsapp-call-sdp-answer', onSdpAnswer);
      socket.on('whatsapp-call-status', onCallStatus);
      socket.on('whatsapp-call-missed', onCallMissed);
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
        socket.off('whatsapp-call-sdp-answer', onSdpAnswer);
        socket.off('whatsapp-call-status', onCallStatus);
        socket.off('whatsapp-call-missed', onCallMissed);
      }
    };
  }, [enabled, applySdpAnswer, handleCallStatus, reset]);

  useEffect(() => {
    return () => {
      void sessionRef.current.cleanup();
      leaveWhatsAppCallsRoom();
    };
  }, []);

  const requestPermission = useCallback(async () => {
    setPhase('requesting_permission');
    setError(null);
    try {
      await sendCallPermissionRequest({
        area,
        to: participantWaId,
        conversationId,
        bodyText: conversationName
          ? `Hi ${conversationName}, we'd like permission to call you on WhatsApp.`
          : undefined,
      });
      setPhase('idle');
      Alert.alert(
        'Permission requested',
        'The customer will receive a call permission message in WhatsApp.'
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to request call permission';
      setError(msg);
      setPhase('error');
      throw e;
    }
  }, [area, conversationId, conversationName, participantWaId]);

  const startCall = useCallback(async () => {
    if (!enabled || !participantWaId) return;
    if (phase !== 'idle' && phase !== 'error') return;

    setPhase('checking');
    setError(null);
    joinWhatsAppCallsRoom();

    try {
      const permissions = await fetchCallPermissions({
        area,
        userWaId: participantWaId,
      });

      if (!permissions.canMakeCalls) {
        throw new Error('Your account cannot place WhatsApp calls');
      }

      if (!permissions.canStartCall) {
        if (permissions.canRequestPermission) {
          setPhase('idle');
          return new Promise<void>((resolve, reject) => {
            Alert.alert(
              'Call permission needed',
              'This customer has not granted call permission yet. Send a permission request in chat?',
              [
                { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
                {
                  text: 'Send request',
                  onPress: () => {
                    requestPermission().then(resolve).catch(reject);
                  },
                },
              ]
            );
          });
        }
        throw new Error(
          permissions.permissionStatus === 'no_permission'
            ? 'Customer has not granted call permission'
            : 'Cannot start a call right now (rate limit or permission)'
        );
      }

      outboundConversationIdRef.current = conversationId;
      setPhase('connecting');

      // Fetch TURN + STUN credentials from the backend (same as the web app).
      // Without TURN, the mobile may gather zero public candidates and Meta
      // cannot reach the device, causing dropped audio or buzzing.
      const iceServers = await fetchIceServers();
      const offer = await sessionRef.current.createOffer(iceServers);

      const result = await startWhatsAppCall({
        area,
        to: participantWaId,
        conversationId,
        session: offer,
      });

      const callId = result.callId;
      if (!callId) {
        throw new Error('Call started but no call ID was returned');
      }

      activeCallIdRef.current = callId;
      setActiveCallId(callId);
      setPhase('ringing');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to start call';
      setError(msg);
      setPhase('error');
      await sessionRef.current.cleanup();
      activeCallIdRef.current = null;
      outboundConversationIdRef.current = null;
      setActiveCallId(null);
      throw e;
    }
  }, [
    area,
    conversationId,
    enabled,
    participantWaId,
    phase,
    requestPermission,
  ]);

  const inCall =
    phase === 'connecting' ||
    phase === 'ringing' ||
    phase === 'active' ||
    phase === 'ending';

  return {
    phase,
    error,
    activeCallId,
    inCall,
    startCall,
    endCall,
    requestPermission,
    reset,
  };
}
