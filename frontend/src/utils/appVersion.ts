// "App version": when the running copy of the app was built, in IST. Lets
// the trader confirm the phone has the latest update (an open page can keep
// running an older copy until it reloads).

export function appVersionLabel(): string {
  const iso = typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : null;
  if (!iso) return "dev";
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}
