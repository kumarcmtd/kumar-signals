import { useEffect } from "react";

// Keeps the screen from locking while the app is open and the switch is on.
//
// A locked phone freezes this web page: timers stop and no sound can start,
// so the in-app alert (and its ringtone) cannot fire. For trading at a desk
// with the phone charging, holding the screen awake keeps the page -- and its
// alerts -- running. Uses the standard Screen Wake Lock API; where it is not
// supported this does nothing, and the browser drops the lock by itself
// whenever the app is hidden, so it is re-taken on return.
export function useKeepScreenOn(enabled: boolean): void {
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
    if (!enabled || !nav.wakeLock) return;
    let lock: { release(): Promise<void> } | null = null;
    let cancelled = false;

    const take = () => {
      if (document.visibilityState !== "visible") return;
      nav.wakeLock!
        .request("screen")
        .then((l) => {
          if (cancelled) void l.release();
          else lock = l;
        })
        .catch(() => undefined); // e.g. battery saver on -- nothing to do
    };
    take();
    document.addEventListener("visibilitychange", take);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", take);
      if (lock) void lock.release().catch(() => undefined);
    };
  }, [enabled]);
}

export function keepScreenOnSupported(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}
