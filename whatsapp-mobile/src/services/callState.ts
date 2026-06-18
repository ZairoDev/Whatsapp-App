/**
 * Lightweight global call-state flag.
 *
 * Used to suppress notification sounds (buzzes, pings) while a WhatsApp
 * voice call is in progress.  Kept in its own module so both callAudioSession
 * and the notification handler can import it without a circular dependency.
 */

let _active = false;

export function setCallActive(active: boolean): void {
  _active = active;
}

export function isCallActive(): boolean {
  return _active;
}
