/**
 * Native VoIP audio session manager for WhatsApp calls.
 *
 * Uses ONLY react-native-incall-manager — expo-av's Audio.setAudioModeAsync
 * is intentionally NOT used here.
 *
 * WHY: On Android, expo-av's setAudioModeAsync with playThroughEarpieceAndroid:true
 * puts AudioManager into MODE_IN_CALL (telephony mode). react-native-webrtc uses
 * MODE_IN_COMMUNICATION (VoIP mode). Switching between these two modes mid-call
 * corrupts the audio pipeline and produces the repeating "doo doo" buzz. Keeping
 * a single audio manager (InCallManager) prevents this conflict entirely.
 *
 * On iOS, the same applies: expo-av sets AVAudioSession category independently
 * from InCallManager, causing category conflicts that result in audio glitches.
 *
 * InCallManager is specifically designed to work alongside react-native-webrtc
 * and handles all necessary audio session configuration for both platforms.
 */

import { setCallActive } from './callState';

export { isCallActive } from './callState';

let incallStarted = false;

async function getInCallManager(): Promise<typeof import('react-native-incall-manager').default | null> {
  try {
    const mod = await import('react-native-incall-manager');
    return mod.default;
  } catch {
    return null;
  }
}

/**
 * Call before creating the WebRTC offer.
 * Sets up InCallManager for a VoIP audio call with no local ringback.
 *
 * CRITICAL — audio routing:
 *   We DISABLE auto-routing (auto: false) and FORCE earpiece (loudspeaker off).
 *
 *   Why: with auto:true, InCallManager defaults to the loudspeaker when the
 *   proximity sensor doesn't engage (phone is face-up on a table during testing).
 *   The loudspeaker is loud enough that the device's microphone picks it up,
 *   creating an acoustic feedback loop. This loop is what produces the loud
 *   continuous "buzzer" sound during the call.
 *
 *   The earpiece (top-of-phone speaker) is intentionally quiet enough that
 *   the mic CANNOT pick it up — no feedback, no buzz. Just like a regular
 *   phone call.
 *
 *   To switch to speakerphone DURING a call (e.g. for a UI button), call
 *   setCallSpeakerphone(true). For testing, hold the phone to your ear.
 */
export async function beginCallAudioSession(): Promise<void> {
  setCallActive(true);

  const InCall = await getInCallManager();
  if (!InCall) return;

  try {
    InCall.start({ media: 'audio', auto: false, ringback: '' });
    InCall.stopRingback();
    InCall.setForceSpeakerphoneOn(false);
    InCall.setSpeakerphoneOn(false);
    incallStarted = true;
  } catch {
    incallStarted = false;
  }
}

/** Stop all in-call tones once the remote media stream is live. */
export async function stopCallRingbackAndTones(): Promise<void> {
  const InCall = await getInCallManager();
  if (!InCall) return;
  try {
    InCall.stopRingback();
    InCall.stopRingtone();
  } catch {
    // ignore
  }
}

/** Explicitly route audio to loudspeaker (call from UI toggle if desired). */
export async function setCallSpeakerphone(on: boolean): Promise<void> {
  const InCall = await getInCallManager();
  if (!InCall) return;
  try {
    InCall.setForceSpeakerphoneOn(on);
  } catch {
    // ignore
  }
}

/** Full tear-down — stop all tones and release InCallManager. */
export async function endCallAudioSession(): Promise<void> {
  setCallActive(false);

  const InCall = await getInCallManager();
  if (InCall && incallStarted) {
    try {
      InCall.stopRingback();
      InCall.stopRingtone();
      InCall.stop();
    } catch {
      // ignore
    }
    incallStarted = false;
  }
}
