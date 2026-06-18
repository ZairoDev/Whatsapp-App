/**
 * SDP helpers for WhatsApp Cloud API calls on React Native.
 * Ported from the Adminstro web `callingSdp.ts` — keeps parity so both
 * platforms send the same minimal RFC 8866 SDP to Meta.
 *
 * Meta requirements (official docs + dualhook.com/docs/calling-business-initiated):
 *   - OPUS only (48 kHz) + telephone-event/8000 for DTMF
 *   - ptime:20, single SSRC, SHA-256 fingerprint (uppercase)
 *   - a=setup:active
 *   - Public IPv4 srflx or relay ICE candidates only (no host, no mDNS, no IPv6)
 *
 * WHY THIS MATTERS: If the mobile sends a raw SDP (which includes G711/PCMA/PCMU),
 * Meta may negotiate G711 instead of OPUS. Decoding G711 at 8 kHz alongside OPUS
 * 48 kHz produces the repeating "doo doo" buzz heard during the call.
 */

// ---------------------------------------------------------------------------
// ICE candidate filtering — mirrors web classifyIceCandidate
// ---------------------------------------------------------------------------

function parseIceCandidateLine(line: string): {
  typ: string;
  priority: number;
  transport: string;
  address: string;
} | null {
  const m = line.match(
    /^a=candidate:\S+\s+\d+\s+(\S+)\s+(\d+)\s+(\S+)\s+\d+\s+typ\s+(\S+)/i,
  );
  if (!m) return null;
  return {
    transport: m[1].toLowerCase(),
    priority: Number(m[2]),
    address: m[3],
    typ: m[4].toLowerCase(),
  };
}

function isValidMetaCandidate(line: string): boolean {
  const p = parseIceCandidateLine(line);
  if (!p) return false;
  if (/\.local$/i.test(p.address)) return false; // mDNS
  if (p.address.includes(':')) return false;       // IPv6
  if (p.typ === 'host') return false;
  if (p.typ === 'srflx') return p.transport === 'udp';
  if (p.typ === 'relay') {
    return p.transport === 'udp' || p.transport === 'tcp' || p.transport === 'tls';
  }
  return false;
}

function sortCandidates(lines: string[]): string[] {
  const srflx: { line: string; pri: number }[] = [];
  const relay: { line: string; pri: number }[] = [];
  for (const line of lines) {
    const p = parseIceCandidateLine(line);
    if (!p) continue;
    if (p.typ === 'srflx') srflx.push({ line, pri: p.priority });
    else if (p.typ === 'relay') relay.push({ line, pri: p.priority });
  }
  srflx.sort((a, b) => b.pri - a.pri);
  relay.sort((a, b) => b.pri - a.pri);
  return [...srflx.map((x) => x.line), ...relay.map((x) => x.line)];
}

// ---------------------------------------------------------------------------
// Build a minimal RFC 8866 SDP offer for Meta (OPUS-only, clean ICE)
// ---------------------------------------------------------------------------

/**
 * Given the localDescription SDP after ICE gathering, build a brand-new
 * minimal SDP that Meta accepts.  The ICE/DTLS credentials are preserved
 * so the WebRTC handshake still works when Meta returns the SDP answer.
 *
 * This is the mobile equivalent of the web's `buildCleanWhatsAppOfferDetailed`.
 */
export function buildCleanOfferForMeta(
  localSdp: string,
  dtlsRole: 'active' | 'passive' = 'active',
): string {
  const lines = localSdp.split(/\r?\n/);

  let iceUfrag = '';
  let icePwd = '';
  let fingerprintHash = '';
  let mid = '0';
  let ssrcCname = '';
  const rawCandidates: string[] = [];
  let inAudio = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');

    if (/^m=/.test(line)) {
      inAudio = /^m=audio\b/.test(line);
      continue;
    }

    // Fingerprint can appear at session or media level
    if (/^a=fingerprint:sha-256\s/i.test(line) && !fingerprintHash) {
      fingerprintHash = line.replace(/^a=fingerprint:\S+\s+/i, '').trim();
      continue;
    }

    if (!inAudio) continue;

    if (/^a=ice-ufrag:/i.test(line) && !iceUfrag) {
      iceUfrag = line.slice('a=ice-ufrag:'.length).trim();
    } else if (/^a=ice-pwd:/i.test(line) && !icePwd) {
      icePwd = line.slice('a=ice-pwd:'.length).trim();
    } else if (/^a=fingerprint:sha-256\s/i.test(line) && !fingerprintHash) {
      fingerprintHash = line.replace(/^a=fingerprint:\S+\s+/i, '').trim();
    } else if (/^a=mid:/i.test(line)) {
      mid = line.slice('a=mid:'.length).trim();
    } else if (/^a=candidate:/i.test(line)) {
      rawCandidates.push(line);
    } else if (/^a=ssrc:\d+\s+cname:/i.test(line) && !ssrcCname) {
      ssrcCname = line;
    }
  }

  // Fallback: if we couldn't extract credentials the call will fail anyway,
  // but return the sanitized raw SDP so the caller gets a useful error from Meta.
  if (!iceUfrag || !icePwd || !fingerprintHash) {
    console.warn('[callingSdp] Could not extract ICE/DTLS credentials from localDescription');
    return sanitizeRawSdpForMeta(localSdp);
  }

  const kept = sortCandidates(rawCandidates.filter(isValidMetaCandidate));
  if (kept.length === 0) {
    console.warn('[callingSdp] No public IPv4 srflx/relay candidates — call may fail');
  }

  const sessionId = String(Date.now()).slice(-10);

  const out = [
    'v=0',
    `o=- ${sessionId} 2 IN IP4 0.0.0.0`,
    's=-',
    't=0 0',
    `a=group:BUNDLE ${mid}`,
    // Audio m-line: ONLY opus(111) + telephone-event(126)
    'm=audio 9 UDP/TLS/RTP/SAVPF 111 126',
    'c=IN IP4 0.0.0.0',
    'a=rtcp:9 IN IP4 0.0.0.0',
    `a=ice-ufrag:${iceUfrag}`,
    `a=ice-pwd:${icePwd}`,
    `a=fingerprint:SHA-256 ${fingerprintHash}`,
    `a=setup:${dtlsRole}`,
    `a=mid:${mid}`,
    'a=sendrecv',
    'a=rtcp-mux',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=1',
    'a=ptime:20',
    'a=rtpmap:126 telephone-event/8000',
    'a=fmtp:126 0-15',
    ...kept,
    'a=end-of-candidates',
  ];
  if (ssrcCname) out.push(ssrcCname);
  out.push(''); // trailing CRLF

  return out.join('\r\n');
}

/**
 * Build clean SDP answer for Meta (customer-initiated / incoming calls).
 *
 * Uses a=setup:active — the business endpoint MUST always be the DTLS client
 * (active role) regardless of call direction.  When react-native-webrtc calls
 * createAnswer() after an actpass offer it internally picks active; we keep
 * that role so the local DTLS state machine and the SDP we send to Meta agree.
 * Using passive here would create a deadlock where both sides wait for the
 * other to initiate the DTLS handshake.
 */
export function buildCleanAnswerForMeta(localSdp: string): string {
  return buildCleanOfferForMeta(localSdp, 'active');
}

// ---------------------------------------------------------------------------
// Fallback sanitizer (strips non-RFC-8866 attrs, keeps all codecs)
// ---------------------------------------------------------------------------

function sanitizeRawSdpForMeta(sdp: string): string {
  if (!sdp.trim()) return sdp;
  const out: string[] = [];
  let inAudio = false;
  let ptimeAdded = false;

  for (const rawLine of sdp.split(/\r?\n/)) {
    let line = rawLine.replace(/\s+$/, '');

    if (/^m=/.test(line)) {
      inAudio = /^m=audio\b/.test(line);
      ptimeAdded = false;
    }

    if (/^a=extmap-allow-mixed$/i.test(line)) continue;
    if (/^a=extmap:/i.test(line)) continue;
    if (/^a=rtcp-fb:/i.test(line)) continue;
    if (/^a=rtcp-rsize$/i.test(line)) continue;

    if (/^a=fingerprint:/i.test(line)) {
      const m = line.match(/^a=fingerprint:(\S+)\s+(.+)$/i);
      if (m) {
        const algo = m[1].toLowerCase().replace(/-/g, '');
        if (algo !== 'sha256') continue;
        out.push(`a=fingerprint:SHA-256 ${m[2].trim()}`);
      }
      continue;
    }

    if (/^a=setup:actpass$/i.test(line)) line = 'a=setup:active';

    out.push(line);

    if (inAudio && !ptimeAdded && /^a=rtcp-mux$/i.test(line)) {
      out.push('a=ptime:20');
      ptimeAdded = true;
    }
  }

  return out.join('\r\n');
}

// ---------------------------------------------------------------------------
// Sanitize Meta's SDP answer before setRemoteDescription
// ---------------------------------------------------------------------------

/**
 * Normalize Meta's SDP answer before applying to RTCPeerConnection.
 * Meta sometimes sends sha-384/sha-512 fingerprints which react-native-webrtc
 * may reject — keep only SHA-256 (uppercase).
 */
export function sanitizeMetaAnswerSdp(sdp: string): string {
  if (!sdp.trim()) return sdp;
  const out: string[] = [];
  for (const raw of sdp.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (/^a=fingerprint:/i.test(line)) {
      const m = line.match(/^a=fingerprint:(\S+)\s+(.*)$/i);
      if (m) {
        const algo = m[1].toLowerCase().replace(/-/g, '');
        if (algo !== 'sha256') continue;
        out.push(`a=fingerprint:SHA-256 ${m[2].trim()}`);
      }
      continue;
    }
    out.push(line);
  }
  return out.join('\r\n');
}

/**
 * Sanitize an incoming SDP *offer* from a customer (customer-initiated call)
 * before passing it to `setRemoteDescription` on Android.
 *
 * Android's libwebrtc SDP parser (SdpDeserialize in C++) is strict:
 *   - Unknown/malformed session-level attributes cause CreateSessionDescription
 *     to return nullptr, which surfaces as "SessionDescription is NULL."
 *   - Chrome's parser is lenient and silently ignores them, which is why the
 *     web app works with a lighter sanitizer.
 *
 * Attributes removed:
 *   - a=extmap-allow-mixed  (Chrome-specific session-level ext, causes parse null)
 *   - a=extmap:*            (RTP header extension map; not needed for answering)
 *   - a=rtcp-fb:*           (RTCP feedback; stripped so we don't advertise caps
 *                            we may not support on mobile)
 *   - a=rtcp-rsize          (reduced-size RTCP, not needed)
 *   - All non-SHA-256 fingerprint lines (sha-384/sha-512 are not supported)
 *
 * ICE credentials, DTLS fingerprint, codec descriptions, candidates, and
 * a=setup/mid/direction lines are preserved intact so the WebRTC handshake works.
 *
 * IMPORTANT: The output always ends with \r\n so that every SDP field is
 * properly CRLF-terminated. Android's SdpDeserialize may return nullptr if
 * the last line has no terminator.
 */
export function sanitizeIncomingOfferSdpForMobile(sdp: string): string {
  if (!sdp.trim()) return sdp;

  const out: string[] = [];

  for (const raw of sdp.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');

    // Chrome/WebRTC extensions that Android's strict SDP parser rejects
    if (/^a=extmap-allow-mixed$/i.test(line)) continue;
    if (/^a=extmap:/i.test(line)) continue;
    if (/^a=rtcp-fb:/i.test(line)) continue;
    if (/^a=rtcp-rsize$/i.test(line)) continue;

    // Keep only SHA-256 fingerprints (uppercase) — same rule as answers
    if (/^a=fingerprint:/i.test(line)) {
      const m = line.match(/^a=fingerprint:(\S+)\s+(.*)$/i);
      if (m) {
        const algo = m[1].toLowerCase().replace(/-/g, '');
        if (algo !== 'sha256') continue;
        out.push(`a=fingerprint:SHA-256 ${m[2].trim()}`);
      }
      continue;
    }

    out.push(line);
  }

  // Ensure the SDP ends with a proper CRLF-terminated empty line.
  // RFC 4566 requires every field (including the last) to be CRLF-terminated.
  // Android's strict libwebrtc SdpDeserialize returns nullptr when this is missing.
  if (out[out.length - 1] !== '') out.push('');

  return out.join('\r\n');
}

// ---------------------------------------------------------------------------
// ICE gathering wait
// ---------------------------------------------------------------------------

export function waitForIceGathering(
  pc: { iceGatheringState?: string; addEventListener: (type: string, fn: () => void) => void },
  timeoutMs = 8000,
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
