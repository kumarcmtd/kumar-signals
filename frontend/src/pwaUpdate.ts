// Keeps the installed app on the newest version.
//
// The service worker was registered by a bare one-line script: a new version
// installed itself in the background, but the page already open -- and an
// installed phone app stays open for days -- kept running the OLD code until
// it was fully closed, sometimes twice. So a fix could be live on the server
// while the phone still showed the previous page.
//
// Now: registered through vite-plugin-pwa's own helper in autoUpdate mode,
// which reloads the page the moment a new version takes over, and asks for an
// update every 30 minutes and whenever the app comes back to the front.

import { registerSW } from "virtual:pwa-register";

const CHECK_EVERY_MS = 30 * 60_000;

export function startPwaUpdates(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => {
        reg.update().catch(() => undefined);
      };
      setInterval(check, CHECK_EVERY_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    },
  });
}
