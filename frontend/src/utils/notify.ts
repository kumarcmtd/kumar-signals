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

/** "tone" = the owner's own ringtone (public/sounds/alert-tone.mp3); "siren" = the built-in alarm. */
export type AlertTone = "tone" | "siren";
export const DEFAULT_ALERT_TONE: AlertTone = "tone";
const TONE_URL = "/sounds/alert-tone.mp3";

let playing: { source: AudioScheduledSourceNode; gain: GainNode; timer: ReturnType<typeof setTimeout> } | null = null;
// Bumped on every play/stop, so a ringtone still loading when a newer play or
// a stop happens never starts late.
let playToken = 0;

// The ringtone is fetched and decoded once, then reused for every alert.
// `boost` scales it so its loudest moment reaches full volume: a WhatsApp
// recording typically peaks around a third of full scale (this one at 0.32).
interface Tone {
  buffer: AudioBuffer;
  boost: number;
}
let toneBuffer: Promise<Tone | null> | null = null;
function loadTone(ctx: AudioContext): Promise<Tone | null> {
  if (!toneBuffer) {
    toneBuffer = fetch(TONE_URL)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b) => ctx.decodeAudioData(b))
      .then((buffer) => {
        let peak = 0;
        for (let c = 0; c < buffer.numberOfChannels; c++) {
          const d = buffer.getChannelData(c);
          for (let i = 0; i < d.length; i += 8) peak = Math.max(peak, Math.abs(d[i]));
        }
        return { buffer, boost: peak > 0.01 ? Math.min(4, 0.95 / peak) : 1 };
      })
      .catch(() => {
        toneBuffer = null; // try again next time
        return null;
      });
  }
  return toneBuffer;
}

function stopOnTap(): void {
  stopAlertSound();
}

/** Stops a sounding alarm now (a tap anywhere does the same). */
export function stopAlertSound(): void {
  playToken++;
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
    p.source.stop();
  } catch {
    // already stopped
  }
}

function compressorFor(ctx: AudioContext): DynamicsCompressorNode {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 6;
  comp.ratio.value = 12;
  comp.attack.value = 0.003;
  comp.release.value = 0.1;
  return comp;
}

function sirenSource(ctx: AudioContext, t0: number, dur: number): AudioScheduledSourceNode {
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(900, t0);
  for (let t = 0; t < dur; t += 0.5) {
    osc.frequency.linearRampToValueAtTime(1800, t0 + t + 0.25);
    osc.frequency.linearRampToValueAtTime(900, t0 + t + 0.5);
  }
  return osc;
}

/**
 * Plays the alert for `seconds` with vibration alongside: the owner's
 * ringtone (looped if the length is longer than the tone), or an alarm-style
 * siren -- a square wave sweeping 900-1800 Hz, where the ear hears loudest.
 * Both go through a compressor so they play at the highest level the phone
 * allows. `volume` is 0-100; the phone's media volume still applies on top.
 * A tap anywhere stops it early. If the ringtone cannot load, the siren
 * plays instead, so an alert is never silent.
 */
export function playAlertSound(volume: number = DEFAULT_ALERT_VOLUME, seconds: number = DEFAULT_ALERT_SECONDS, tone: AlertTone = DEFAULT_ALERT_TONE): void {
  stopAlertSound();
  const token = playToken;
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
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => undefined);
  const level = Math.max(0, Math.min(100, volume)) / 100;
  if (level === 0) return;

  const start = (tone: Tone | null) => {
    if (token !== playToken) return; // stopped or replaced while loading
    try {
      const t0 = ctx.currentTime;
      let source: AudioScheduledSourceNode;
      // Perceived loudness is roughly logarithmic, so square the slider. The
      // tone is lifted to full scale by its measured boost; the compressor
      // keeps it from distorting.
      let peak: number;
      if (tone) {
        const src = ctx.createBufferSource();
        src.buffer = tone.buffer;
        src.loop = true;
        source = src;
        peak = Math.max(0.0002, level * level * tone.boost);
      } else {
        source = sirenSource(ctx, t0, dur);
        peak = Math.max(0.0002, level * level);
      }
      const gain = ctx.createGain();
      const comp = compressorFor(ctx);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.03);
      gain.gain.setValueAtTime(peak, t0 + dur - 0.15);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      source.connect(gain);
      gain.connect(comp);
      comp.connect(ctx.destination);
      source.start(t0);
      source.stop(t0 + dur + 0.05);
      playing = { source, gain, timer: setTimeout(() => stopAlertSound(), dur * 1000 + 100) };
      // Let the tap that started a test finish first, then any tap stops it.
      setTimeout(() => {
        if (playing) window.addEventListener("pointerdown", stopOnTap, { capture: true, once: true });
      }, 300);
    } catch {
      // ignore -- audio can be blocked until the user interacts with the page
    }
  };

  if (tone === "tone") loadTone(ctx).then(start);
  else start(null);
}

/** Starts loading the ringtone early, so the first alert is not delayed. */
export function preloadAlertTone(): void {
  const ctx = getAudioContext();
  if (ctx) void loadTone(ctx);
}
