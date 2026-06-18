/**
 * WebRTC session for WhatsApp Cloud API voice calls (business-initiated).
 * Requires a development build with react-native-webrtc linked (NOT Expo Go).
 *
 * Parity with the Adminstro web app:
 *   - Accepts TURN ice servers (fetched from /api/whatsapp/ice-servers)
 *   - iceCandidatePoolSize: 10 for faster gathering
 *   - iceTransportPolicy: "all" (both host + relay)
 *   - Mono 48 kHz microphone capture (matches OPUS native rate)
 *   - Audio sender capped at 64 kbps with networkPriority: high (matches web)
 *   - 25 s ICE gather timeout for TURN, 20 s for STUN-only
 *   - Aborts if clean SDP has zero public candidates
 *   - Sends clean OPUS-only SDP to Meta (raw SDP stays local for WebRTC)
 */

import Constants from 'expo-constants';
import {
  beginCallAudioSession,
  endCallAudioSession,
  stopCallRingbackAndTones,
} from './callAudioSession';
import {
  buildCleanAnswerForMeta,
  buildCleanOfferForMeta,
  sanitizeMetaAnswerSdp,
  sanitizeIncomingOfferSdpForMobile,
} from './callingSdp';

export type CallSessionStatus = 'idle' | 'connecting' | 'connected' | 'ended' | 'failed';

export type CallSessionCallbacks = {
  onStatus?: (status: CallSessionStatus) => void;
  onError?: (message: string) => void;
  onRemoteAudioReady?: () => void;
};

function normalizeSdp(sdp: string): string {
  return sdp.includes('\r\n') ? sdp : sdp.replace(/\n/g, '\r\n');
}

function hasRelayCandidates(servers: RTCIceServer[]): boolean {
  return servers.some((s) => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    return urls.some(
      (u) => typeof u === 'string' && (u.startsWith('turn:') || u.startsWith('turns:'))
    );
  });
}

type RtcModule = typeof import('react-native-webrtc');

async function loadRtc(): Promise<RtcModule> {
  const isExpoGo = Constants.appOwnership === 'expo';
  if (isExpoGo) {
    throw new Error(
      'Voice calls do not work in Expo Go.\n\n' +
        'Install the development build on your phone instead:\n' +
        '  eas build --profile development --platform android\n' +
        'then scan the QR code / install the APK on your device.'
    );
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-webrtc') as RtcModule;
    if (!mod?.RTCPeerConnection) {
      throw new Error(
        'react-native-webrtc is linked but RTCPeerConnection is undefined. ' +
          'Rebuild the native binary: eas build --profile development --platform android'
      );
    }
    return mod;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`react-native-webrtc failed to load: ${reason}`);
  }
}

function waitForIceGathering(
  pc: { iceGatheringState?: string; addEventListener: (type: string, fn: () => void) => void },
  timeoutMs: number
): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') done();
    });
  });
}

/**
 * Cap audio sender bitrate at 64 kbps with high network priority.
 * Mirrors the web's per-sender tuning — gives noticeably better OPUS fidelity
 * for voice without stressing the connection (Meta handles the relay).
 *
 * Without a bitrate cap, react-native-webrtc may default to a much higher
 * bitrate that the network cannot sustain, causing packet loss → audio
 * artifacts that sound like buzzing or static.
 */
async function tuneAudioSender(
  pc: import('react-native-webrtc').RTCPeerConnection
): Promise<void> {
  try {
    const audioSender = pc.getSenders().find((s) => s.track?.kind === 'audio');
    if (!audioSender) return;

    const params = audioSender.getParameters() as {
      encodings?: Array<{ maxBitrate?: number; networkPriority?: string }>;
    };
    if (!params.encodings?.length) params.encodings = [{}];
    const enc = params.encodings[0];
    if (enc) {
      enc.maxBitrate = 64_000;
      enc.networkPriority = 'high';
    }
    await audioSender.setParameters(params as never);
  } catch {
    // optional tuning — safe to ignore if unsupported
  }
}

export class WhatsAppCallSession {
  private pc: import('react-native-webrtc').RTCPeerConnection | null = null;
  private localStream: import('react-native-webrtc').MediaStream | null = null;
  private status: CallSessionStatus = 'idle';
  private callbacks: CallSessionCallbacks = {};
  private appliedAnswerHash: string | null = null;
  private remoteAudioReady = false;

  setCallbacks(callbacks: CallSessionCallbacks) {
    this.callbacks = callbacks;
  }

  private setStatus(next: CallSessionStatus) {
    this.status = next;
    this.callbacks.onStatus?.(next);
  }

  getStatus(): CallSessionStatus {
    return this.status;
  }

  /**
   * Create an SDP offer to send to Meta.
   *
   * Flow (matches Adminstro web's handleAudioCall exactly):
   *   1. Begin native audio session (InCallManager)
   *   2. Build RTCPeerConnection with provided ICE servers
   *   3. getUserMedia (mono 48 kHz, EC/NS/AGC on)
   *   4. addTrack for the mic
   *   5. Cap audio sender to 64 kbps
   *   6. createOffer() with NO options (default behavior)
   *   7. setLocalDescription(rawOffer)
   *   8. Wait for ICE gathering (20–25 s)
   *   9. Build CLEAN OPUS-only SDP from gathered localDescription
   *  10. Abort if no public candidates
   *  11. Return clean SDP to send to Meta
   */
  async createOffer(iceServers: RTCIceServer[] = []): Promise<{ sdpType: 'offer'; sdp: string }> {
    await this.cleanup();
    this.appliedAnswerHash = null;
    this.remoteAudioReady = false;
    await beginCallAudioSession();

    const { mediaDevices, RTCPeerConnection } = await loadRtc();

    const fallbackServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ];
    const effectiveServers = iceServers.length > 0 ? iceServers : fallbackServers;
    const relayConfigured = hasRelayCandidates(effectiveServers);
    const gatherTimeoutMs = relayConfigured ? 25_000 : 20_000;

    console.log('[WhatsAppCall] ICE config:', {
      servers: effectiveServers.length,
      relay: relayConfigured,
      gatherTimeoutMs,
    });

    this.pc = new RTCPeerConnection({
      iceServers: effectiveServers,
      iceTransportPolicy: 'all',
      iceCandidatePoolSize: 10,
    } as RTCConfiguration);

    const pc = this.pc as import('react-native-webrtc').RTCPeerConnection & {
      addEventListener(type: string, listener: (...args: unknown[]) => void): void;
    };

    pc.addEventListener('connectionstatechange', () => {
      const state = pc.connectionState;
      console.log('[WhatsAppCall] connectionState:', state);
      if (state === 'connected') this.setStatus('connected');
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        if (this.status !== 'ended') this.setStatus('failed');
      }
    });

    pc.addEventListener('iceconnectionstatechange', () => {
      console.log('[WhatsAppCall] iceConnectionState:', pc.iceConnectionState);
    });

    pc.addEventListener('track', () => {
      console.log('[WhatsAppCall] remote track received');
      if (this.remoteAudioReady) return;
      this.remoteAudioReady = true;
      void stopCallRingbackAndTones();
      this.setStatus('connected');
      this.callbacks.onRemoteAudioReady?.();
    });

    try {
      this.localStream = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        } as unknown as boolean,
        video: false,
      });
    } catch {
      throw new Error('Microphone permission is required to place a call');
    }

    this.localStream.getTracks().forEach((track) => {
      this.pc!.addTrack(track, this.localStream!);
    });

    // Cap bitrate at 64 kbps with high priority (matches the web app)
    await tuneAudioSender(this.pc);

    // createOffer() with NO options — matches web's behavior exactly.
    // Passing voiceActivityDetection: true can cause periodic comfort-noise
    // (CN) packet insertion that sounds like a "doo doo" buzz in the earpiece.
    const rawOffer = await this.pc.createOffer({});
    await this.pc.setLocalDescription(rawOffer);

    console.log('[WhatsAppCall] Waiting for ICE gathering…');
    await waitForIceGathering(
      pc as Parameters<typeof waitForIceGathering>[0],
      gatherTimeoutMs
    );
    console.log('[WhatsAppCall] ICE gathering done');

    const gatheredSdp = this.pc.localDescription?.sdp ?? rawOffer.sdp ?? '';
    const cleanSdp = buildCleanOfferForMeta(normalizeSdp(gatheredSdp));

    if (!cleanSdp) throw new Error('Failed to build SDP offer (empty)');

    if (!cleanSdp.includes('a=candidate:')) {
      throw new Error(
        'No public ICE candidates available. ' +
          'The device may be behind a symmetric NAT or firewall that blocks STUN/TURN. ' +
          'Check your network connection.'
      );
    }

    const candidateCount = (cleanSdp.match(/^a=candidate:/gm) ?? []).length;
    console.log('[WhatsAppCall] Clean SDP has', candidateCount, 'public candidate(s)');

    this.setStatus('connecting');
    return { sdpType: 'offer', sdp: cleanSdp };
  }

  /**
   * Answer an incoming (customer-initiated) WhatsApp call.
   *
   * Flow:
   *   1. Begin native audio session
   *   2. Create RTCPeerConnection
   *   3. Set Meta's SDP offer as remote description
   *   4. getUserMedia (mono 48 kHz)
   *   5. addTrack + cap sender to 64 kbps
   *   6. createAnswer() + setLocalDescription
   *   7. Wait for ICE gathering (20–25 s)
   *   8. Build clean OPUS-only SDP answer (a=setup:passive)
   *   9. Return clean SDP to send back to Meta
   */
  async answerOffer(
    remoteSdpRaw: string,
    iceServers: RTCIceServer[] = [],
  ): Promise<{ sdpType: 'answer'; sdp: string }> {
    await this.cleanup();
    this.appliedAnswerHash = null;
    this.remoteAudioReady = false;
    await beginCallAudioSession();

    const { mediaDevices, RTCPeerConnection } = await loadRtc();

    const fallbackServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ];
    const effectiveServers = iceServers.length > 0 ? iceServers : fallbackServers;
    const relayConfigured = hasRelayCandidates(effectiveServers);
    const gatherTimeoutMs = relayConfigured ? 25_000 : 20_000;

    console.log('[WhatsAppCall] (incoming) ICE config:', {
      servers: effectiveServers.length,
      relay: relayConfigured,
      gatherTimeoutMs,
    });

    this.pc = new RTCPeerConnection({
      iceServers: effectiveServers,
      iceTransportPolicy: 'all',
      iceCandidatePoolSize: 10,
    } as RTCConfiguration);

    const pc = this.pc as import('react-native-webrtc').RTCPeerConnection & {
      addEventListener(type: string, listener: (...args: unknown[]) => void): void;
    };

    pc.addEventListener('connectionstatechange', () => {
      const state = pc.connectionState;
      console.log('[WhatsAppCall] (incoming) connectionState:', state);
      if (state === 'connected') this.setStatus('connected');
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        if (this.status !== 'ended') this.setStatus('failed');
      }
    });

    pc.addEventListener('iceconnectionstatechange', () => {
      console.log('[WhatsAppCall] (incoming) iceConnectionState:', pc.iceConnectionState);
    });

    pc.addEventListener('track', () => {
      console.log('[WhatsAppCall] (incoming) remote track received');
      if (this.remoteAudioReady) return;
      this.remoteAudioReady = true;
      void stopCallRingbackAndTones();
      this.setStatus('connected');
      this.callbacks.onRemoteAudioReady?.();
    });

    // Set remote description (Meta's SDP offer) BEFORE creating the answer.
    //
    // We normalize line endings first, then apply sanitizeIncomingOfferSdpForMobile
    // which:
    //   1. Removes a=extmap-allow-mixed, a=extmap:*, a=rtcp-fb:*, a=rtcp-rsize
    //      (Chrome-specific or RTCP-feedback attrs that Android's strict libwebrtc
    //       SDP parser rejects — causing "SessionDescription is NULL" from native).
    //   2. Keeps only SHA-256 fingerprints (uppercase).
    //   3. Always appends a trailing CRLF — RFC 4566 requires CRLF on every field
    //      including the last; Android's SdpDeserialize returns nullptr without it.
    //
    // IMPORTANT: pass a plain RTCSessionDescriptionInit object, NOT new RTCSessionDescription().
    // On some Android builds the constructor returns NULL even with valid SDP; the plain
    // object bypasses that and lets the native bridge do the wrapping itself.
    const normalizedOffer = normalizeSdp(remoteSdpRaw);
    const sanitizedOffer = sanitizeIncomingOfferSdpForMobile(normalizedOffer);

    console.log('[WhatsAppCall] (incoming) offer SDP length:', sanitizedOffer.length);
    console.log('[WhatsAppCall] (incoming) offer SDP preview:', sanitizedOffer.slice(0, 300));

    if (!sanitizedOffer.trim()) {
      throw new Error('Incoming call offer SDP is empty after sanitization');
    }
    if (!/^m=audio\b/m.test(sanitizedOffer)) {
      throw new Error('Incoming call offer SDP has no audio m-line');
    }

    await this.pc.setRemoteDescription({ type: 'offer', sdp: sanitizedOffer } as any);

    try {
      this.localStream = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        } as unknown as boolean,
        video: false,
      });
    } catch {
      throw new Error('Microphone permission is required to answer a call');
    }

    this.localStream.getTracks().forEach((track) => {
      this.pc!.addTrack(track, this.localStream!);
    });

    await tuneAudioSender(this.pc);

    const rawAnswer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(rawAnswer);

    console.log('[WhatsAppCall] (incoming) Waiting for ICE gathering…');
    await waitForIceGathering(
      pc as Parameters<typeof waitForIceGathering>[0],
      gatherTimeoutMs
    );
    console.log('[WhatsAppCall] (incoming) ICE gathering done');

    const gatheredSdp = this.pc.localDescription?.sdp ?? rawAnswer.sdp ?? '';
    const cleanSdp = buildCleanAnswerForMeta(normalizeSdp(gatheredSdp));

    if (!cleanSdp) throw new Error('Failed to build SDP answer (empty)');

    if (!cleanSdp.includes('a=candidate:')) {
      throw new Error(
        'No public ICE candidates for incoming call answer. Check network connection.'
      );
    }

    const candidateCount = (cleanSdp.match(/^a=candidate:/gm) ?? []).length;
    console.log('[WhatsAppCall] (incoming) clean answer has', candidateCount, 'candidate(s)');

    this.setStatus('connecting');
    return { sdpType: 'answer', sdp: cleanSdp };
  }

  /** Apply Meta's SDP answer from the `whatsapp-call-sdp-answer` socket event. */
  async applyRemoteAnswer(sdp: string, sdpType: 'answer' | 'offer' = 'answer'): Promise<void> {
    if (!this.pc) {
      throw new Error('No active call session');
    }

    const sanitized = sanitizeMetaAnswerSdp(normalizeSdp(sdp));
    const hash = sanitized.slice(0, 512);
    if (this.appliedAnswerHash === hash) return;
    this.appliedAnswerHash = hash;

    await loadRtc(); // ensures module is available in dev builds
    await this.pc.setRemoteDescription({ type: sdpType, sdp: sanitized } as any);

    await stopCallRingbackAndTones();

    if (!this.remoteAudioReady) {
      this.remoteAudioReady = true;
      this.setStatus('connected');
      this.callbacks.onRemoteAudioReady?.();
    }
  }

  async cleanup(): Promise<void> {
    this.setStatus('ended');
    this.appliedAnswerHash = null;
    this.remoteAudioReady = false;
    try {
      this.localStream?.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    this.localStream = null;
    try {
      this.pc?.close();
    } catch {
      // ignore
    }
    this.pc = null;
    this.status = 'idle';
    await endCallAudioSession();
  }
}

// ─── Payload parser ────────────────────────────────────────────────────────

export function extractCallSessionFromPayload(payload: unknown): {
  conversationId?: string;
  callId?: string;
  event?: string;
  callStatus?: string;
  sdp?: string;
  sdpType?: 'answer' | 'offer';
} | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;

  const conversationId =
    (root.conversationId as string) ?? (root.conversation_id as string) ?? undefined;

  const callId =
    (root.callId as string) ??
    (root.call_id as string) ??
    (Array.isArray(root.calls) && (root.calls[0] as Record<string, unknown>)?.id
      ? String((root.calls[0] as Record<string, unknown>).id)
      : undefined);

  const event =
    (root.event as string) ??
    (Array.isArray(root.calls) && (root.calls[0] as Record<string, unknown>)?.event
      ? String((root.calls[0] as Record<string, unknown>).event)
      : undefined);

  const callStatus =
    (root.callStatus as string) ?? (root.call_status as string) ?? (root.status as string);

  const session =
    (root.session as Record<string, unknown> | undefined) ??
    (Array.isArray(root.calls)
      ? ((root.calls[0] as Record<string, unknown>)?.session as
          | Record<string, unknown>
          | undefined)
      : undefined);

  const sdp =
    (typeof root.sdp === 'string' ? root.sdp : undefined) ??
    (session?.sdp as string | undefined);

  if (!sdp?.trim()) {
    if (conversationId || callId || event || callStatus) {
      return { conversationId, callId, event, callStatus };
    }
    return null;
  }

  const rawType = String(
    root.sdpType ??
      root.sdp_type ??
      session?.sdp_type ??
      session?.sdpType ??
      'answer'
  ).toLowerCase();
  const sdpType = rawType === 'offer' ? 'offer' : 'answer';

  return { conversationId, callId, event, callStatus, sdp, sdpType };
}
