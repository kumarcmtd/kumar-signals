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
export const DEFAULT_ALERT_SECONDS = 5;
export const ALERT_SECONDS_OPTIONS = [2, 5, 10, 20, 30] as const;

let playing: { osc: OscillatorNode; gain: GainNode; timer: ReturnType<typeof setTimeout> } | null = null;

function stopOnTap(): void {
  stopAlertSound();
}

/** Stops a sounding alarm now (a tap anywhere does the same). */
export function stopAlertSound(): void {
  window.removeEventListener("pointerdown", stopOnTap, true);
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(0);
  } catch {
    // ignore
  }
  if (!playing) return;
  const p = playing;
  playing = null;
  clearTimeout(p.timer);
  try {
    p.gain.gain.cancelScheduledValues(0);
    p.gain.gain.value = 0;
    p.osc.stop();
  } catch {
    // already stopped
  }
}

/**
 * An alarm-style siren -- a square wave sweeping 900-1800 Hz twice a second,
 * the range the ear hears loudest -- through a compressor so it plays at the
 * highest level the phone allows, for `seconds`, with vibration alongside.
 * `volume` is 0-100; the phone's media volume still applies on top. A tap
 * anywhere stops it early.
 */
export function playAlertSound(volume: number = DEFAULT_ALERT_VOLUME, seconds: number = DEFAULT_ALERT_SECONDS): void {
  stopAlertSound();
  const dur = Math.max(1, Math.min(60, seconds));
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      const pattern: number[] = [];
      for (let t = 0; t < dur * 1000; t += 700) pattern.push(450, 250);
      navigator.vibrate(pattern);
    }
  } catch {
    // ignore
  }
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => undefined);
    const level = Math.max(0, Math.min(100, volume)) / 100;
    if (level === 0) return;
    // Perceived loudness is roughly logarithmic, so square the slider.
    const peak = Math.max(0.0002, level * level);
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 6;
    comp.ratio.value = 12;
    comp.attack.value = 0.003;
    comp.release.value = 0.1;
    osc.type = "square";
    osc.frequency.setValueAtTime(900, t0);
    for (let t = 0; t < dur; t += 0.5) {
      osc.frequency.linearRampToValueAtTime(1800, t0 + t + 0.25);
      osc.frequency.linearRampToValueAtTime(900, t0 + t + 0.5);
    }
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.03);
    gain.gain.setValueAtTime(peak, t0 + dur - 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(comp);
    comp.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    playing = { osc, gain, timer: setTimeout(() => stopAlertSound(), dur * 1000 + 100) };
    // Let the tap that started a test finish first, then any tap stops it.
    setTimeout(() => {
      if (playing) window.addEventListener("pointerdown", stopOnTap, { capture: true, once: true });
    }, 300);
  } catch {
    // ignore -- audio can be blocked until the user interacts with the page
  }
}
