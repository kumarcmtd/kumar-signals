// Thin wrappers around the browser Notification API and a short beep via
// Web Audio -- both are best-effort and silently no-op wherever unsupported
// (older WebViews, iOS home-screen PWAs without permission, etc.) rather
// than throwing and breaking the alert engine that calls them.

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof Notification === "undefined") return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

export function fireBrowserNotification(title: string, body: string): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/favicon.svg", tag: title });
  } catch {
    // ignore -- some browsers throw when the page isn't in a secure context
  }
}

// One shared AudioContext. Phones block sound from a web page until the user
// has touched it, and a context created later -- when an alert fires with
// nobody touching the screen -- often starts "suspended" and plays nothing.
// So the context is created and resumed on the first tap anywhere, and every
// alert reuses it.
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (audioCtx) return audioCtx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    audioCtx = new Ctor();
  } catch {
    audioCtx = null;
  }
  return audioCtx;
}

export function unlockAlertAudio(): void {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => undefined);
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", unlockAlertAudio, { once: true, capture: true });
}

export const DEFAULT_ALERT_VOLUME = 80;

/**
 * Three rising beeps (~1 s), plus a vibration where the phone supports it.
 * `volume` is 0-100. The old single soft 0.4 s tone at 15% was easy to miss.
 * The phone's own media volume still applies on top of this.
 */
export function playAlertSound(volume: number = DEFAULT_ALERT_VOLUME): void {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate([200, 100, 200, 100, 350]);
  } catch {
    // ignore
  }
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => undefined);
    const level = Math.max(0, Math.min(100, volume)) / 100;
    if (level === 0) return;
    // Perceived loudness is roughly logarithmic, so square the slider; 100%
    // is a full-scale square wave, the loudest a plain tone gets.
    const peak = Math.max(0.0002, level * level * 0.9);
    const notes = [880, 1175, 1568];
    notes.forEach((freq, i) => {
      const start = ctx.currentTime + i * 0.28;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.25);
    });
  } catch {
    // ignore -- audio can be blocked until the user interacts with the page
  }
}
