// GPT News -- Energy & Geopolitical Intelligence.
//
// A NEW page. It adds a route and one entry in the nav and touches nothing
// else: every other page keeps its own styling, data and behaviour exactly as
// it was. All the reasoning lives in utils/gptNewsEngine.ts and all the
// rendering in components/GptNewsKit.tsx, so this page can be reworked on its
// own later.
//
// Upstream load: this page reuses queries the app ALREADY polls (news, prices,
// global markets, EIA, market status, the econ calendar) via their shared React
// Query keys, so opening it does not multiply upstream calls. The only new
// network call is /api/macro-markets (Yahoo, server-cached 2 minutes, nothing
// to do with the Upstox quota). Live option premiums are OFF by default and
// only start when the trader turns them on.
//
// Honesty rules, taken from the specification and enforced in code rather than
// in prose: no headline, source, price or timestamp is ever synthesized; a
// missing figure renders as "not available" with the reason; interpretations
// and estimates are labelled as such; and a reading of NORMAL or LOW on the
// risk monitors always says it means "nothing reported", never "verified safe".

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Newspaper, RefreshCw, Search, Settings2, X, Zap, Siren, Fuel, Flame, Globe2, BarChart3,
  Briefcase, CalendarClock, History, Brain, Bell, Sun, Moon, ShieldAlert, CloudSun,
} from "lucide-react";
import {
  useNewsFeed, usePrices, useGlobalMarkets, useMacroMarkets, useEnergyData,
  useMarketStatus, useNewsTrade, useOptionsAnalytics,
} from "../api/hooks";
import {
  buildGptNewsItems, sortItems, breakingItems, applyFilters, countryRisks, chokepointReads,
  weatherRead, crudePanel, ngPanel, intelligenceFor, sessionInfo, openingBiasEstimate,
  upcomingEvents, readPosition, evaluateAlerts, sanitizePositions, DEFAULT_POSITIONS, DEFAULT_ALERT_RULES, EMPTY_FILTERS,
  type GptCategory, type FilterState, type PositionInput, type Bias, type AlertRule,
} from "../utils/gptNewsEngine";
import {
  Panel, SectionTitle, Chip, BreakingCard, NewsRow, MarketTile, BiasPanelCard, CountryCard,
  ChokepointCard, WeatherCard, EiaCard, TimelineList, IntelligenceCard, EventRow, PositionCard,
  SourceHealth, EmptyState, SkeletonRows, GN, BIAS_COLOR,
} from "../components/GptNewsKit";
import { formatAge, ageMinutes, formatStamp } from "../utils/aiFlashEngine";
import type { PriceCard } from "../types";
import type { MacroQuote } from "../api/client";

const TABS: { key: GptCategory | "all"; label: string; icon: typeof Fuel }[] = [
  { key: "all", label: "All", icon: Newspaper },
  { key: "crude", label: "Crude Oil", icon: Fuel },
  { key: "gas", label: "Natural Gas", icon: Flame },
  { key: "war", label: "War & Geo", icon: ShieldAlert },
  { key: "opec", label: "OPEC", icon: Globe2 },
  { key: "lng", label: "LNG", icon: Zap },
  { key: "weather", label: "Weather", icon: CloudSun },
];

const TIME_FILTERS: { key: FilterState["time"]; label: string }[] = [
  { key: "all", label: "All" },
  { key: "15m", label: "15 min" },
  { key: "1h", label: "1 hour" },
  { key: "4h", label: "4 hours" },
  { key: "today", label: "Today" },
];
const ASSET_FILTERS: { key: FilterState["asset"]; label: string }[] = [
  { key: "all", label: "All" },
  { key: "CRUDE", label: "Crude" },
  { key: "NG", label: "Gas" },
  { key: "BOTH", label: "Both" },
];
const IMPACT_FILTERS: { key: FilterState["impact"]; label: string }[] = [
  { key: "all", label: "All" },
  { key: "very_high", label: "Very high" },
  { key: "high", label: "High+" },
  { key: "medium", label: "Medium+" },
  { key: "low", label: "Low+" },
];
const SOURCE_FILTERS = [
  { key: "all", label: "All" },
  { key: "reuters", label: "Reuters" },
  { key: "bloomberg", label: "Bloomberg" },
  { key: "eia", label: "Official (EIA)" },
  { key: "cnbc", label: "CNBC" },
];
const SEARCH_SUGGESTIONS = ["Iran", "Hormuz", "Saudi", "oil", "crude", "natural gas", "LNG", "Qatar", "Houthi", "OPEC", "EIA", "weather"];
const REFRESH_CHOICES = [15_000, 30_000, 60_000, 300_000];
const INITIAL_ROWS = 15;

// ---- Browser-local settings (spec section 31). Nothing leaves the device. ----
function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        // A private window with storage blocked must not break the page.
      }
    },
    [key]
  );
  return [value, set];
}

/**
 * What /api/prices can actually return. The shared PriceCard type describes the
 * happy path only; on a failure the worker sends `{ symbol, error }` with none
 * of the numeric fields, so this page models both shapes and shows the worker's
 * own reason instead of guessing why a price is missing.
 */
type ErroredPriceCard = Partial<PriceCard> & Pick<PriceCard, "symbol"> & { error?: string };

/**
 * Anything that is not a real, finite number becomes null. Several API types in
 * this app declare fields as required numbers that the worker can legitimately
 * omit on an error response, so nothing numeric is taken on trust here.
 */
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Formats a macro quote in its own unit, or returns null so the tile shows why it is missing. */
function macroValue(price: number | null, unit: MacroQuote["unit"]): string | null {
  if (price === null) return null;
  if (unit === "pct") return `${price.toFixed(2)}%`;
  if (unit === "inr") return `₹${price.toFixed(2)}`;
  if (unit === "usd") return `$${price.toLocaleString("en-US")}`;
  return price.toFixed(2);
}

/** A percent as text, or "n/a" -- never a number pulled off a failed response. */
function pct(v: number | null): string {
  return v === null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

const DARK = { panel: "#14161F", panel2: "#1B1E2A", border: "rgba(255,255,255,.09)", text: "#F2F4F8", muted: "rgba(242,244,248,.66)", faint: "rgba(242,244,248,.40)" };
const LIGHT = { panel: "#FFFFFF", panel2: "#F4F6FA", border: "rgba(15,23,42,.12)", text: "#0F172A", muted: "rgba(15,23,42,.68)", faint: "rgba(15,23,42,.45)" };

export function GptNews() {
  const [theme, setTheme] = useLocalState<"dark" | "light">("gptnews:theme", "dark");
  const [fastMode, setFastMode] = useLocalState<boolean>("gptnews:fast", false);
  const [refreshMs, setRefreshMs] = useLocalState<number>("gptnews:refresh", 30_000);
  const [storedPositions, setPositions] = useLocalState<PositionInput[]>("gptnews:positions", DEFAULT_POSITIONS);
  const [enabledAlerts, setEnabledAlerts] = useLocalState<string[]>("gptnews:alerts", DEFAULT_ALERT_RULES.map((r) => r.id));
  const [customRules, setCustomRules] = useLocalState<AlertRule[]>("gptnews:customAlerts", []);
  const [trackPremium, setTrackPremium] = useLocalState<boolean>("gptnews:trackPremium", false);

  // localStorage is untrusted input -- an older or half-edited blob must not
  // be able to crash the page, so it is validated before anything renders it.
  const positions = useMemo(() => sanitizePositions(storedPositions), [storedPositions]);

  const [tab, setTab] = useState<GptCategory | "all">("all");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rawQuery, setRawQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Debounced search (spec section 32) -- typing must never re-filter the whole
  // feed on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setFilters((f) => ({ ...f, query: rawQuery })), 250);
    return () => clearTimeout(id);
  }, [rawQuery]);

  // Keeps the relative ages ticking between network refetches, so "3 min ago"
  // never sits frozen at whatever it was when the payload landed.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 20_000);
    return () => clearInterval(id);
  }, []);

  const news = useNewsFeed();
  const prices = usePrices();
  const global = useGlobalMarkets();
  const macro = useMacroMarkets();
  const energy = useEnergyData();
  const status = useMarketStatus();
  const newsTrade = useNewsTrade();
  const crudeChain = useOptionsAnalytics("CRUDEOIL", trackPremium);
  const ngChain = useOptionsAnalytics("NATURALGAS", trackPremium);

  // Honour the chosen refresh interval on top of the shared hook cadence: the
  // shared queries poll on their own schedule, this just pulls them forward.
  useEffect(() => {
    const id = setInterval(() => news.refetch(), refreshMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshMs]);

  const events = news.data?.events;
  const articles = news.data?.articles;
  const items = useMemo(() => buildGptNewsItems(events ?? [], articles ?? []), [events, articles]);

  const breaking = useMemo(() => breakingItems(items), [items]);
  const weather = useMemo(() => weatherRead(items), [items]);

  const eiaCrudeBias: Bias | undefined = energy.data?.crude ? (energy.data.crude.direction === "draw" ? "bullish" : "bearish") : undefined;
  const eiaStorageBias: Bias | undefined = energy.data?.ngStorage ? (energy.data.ngStorage.direction === "draw" ? "bullish" : "bearish") : undefined;

  const crude = useMemo(() => crudePanel(items, eiaCrudeBias), [items, eiaCrudeBias]);
  const ng = useMemo(() => ngPanel(items, weather, eiaStorageBias), [items, weather, eiaStorageBias]);
  const countries = useMemo(() => countryRisks(items), [items]);
  const chokepoints = useMemo(() => chokepointReads(items), [items]);

  const visible = useMemo(() => {
    const withTab = applyFilters(items, { ...filters, category: tab === "all" ? filters.category : tab });
    // Fast Mode (spec section 18): breaking headlines first and newest at the
    // top; otherwise the feed is ranked by market importance.
    return sortItems(withTab, fastMode ? "newest" : "importance");
  }, [items, filters, tab, fastMode]);

  const rows = expanded ? visible : visible.slice(0, INITIAL_ROWS);

  const timeline = useMemo(
    () => [...items].filter((i) => i.ageMin <= 720).sort((a, b) => a.ageMin - b.ageMin).slice(0, 12),
    [items]
  );

  // IMPORTANT: PriceCard declares `ltp` and `changePercent` as required
  // numbers, but the worker genuinely returns `{ symbol, error }` for a price
  // it could not fetch (market closed, no Upstox token, not enough history).
  // TypeScript therefore cannot catch a missing field here -- reading
  // .toLocaleString() straight off one crashed this whole page. Every value
  // taken off a price card goes through num() from here on.
  const mcxCrude = prices.data?.find((p) => p.symbol === "CRUDEOIL") as ErroredPriceCard | undefined;
  const mcxNg = prices.data?.find((p) => p.symbol === "NATURALGAS") as ErroredPriceCard | undefined;
  const crudeLtp = num(mcxCrude?.ltp);
  const ngLtp = num(mcxNg?.ltp);
  const crudePct = num(mcxCrude?.changePercent);
  const ngPct = num(mcxNg?.changePercent);
  const wti = global.data?.find((q) => q.symbol === "CL=F");
  const brent = global.data?.find((q) => q.symbol === "BZ=F");
  const henryHub = global.data?.find((q) => q.symbol === "NG=F");

  const session = useMemo(() => sessionInfo(), []);
  const crudeOpening = useMemo(() => openingBiasEstimate(global.data ?? [], "CRUDEOIL"), [global.data]);
  const ngOpening = useMemo(() => openingBiasEstimate(global.data ?? [], "NATURALGAS"), [global.data]);
  const calendar = useMemo(() => upcomingEvents(newsTrade.data?.calendar?.events ?? []), [newsTrade.data]);

  // ---- Alerts (spec section 19) ----
  const allRules = useMemo(() => [...DEFAULT_ALERT_RULES, ...customRules], [customRules]);
  const enabledSet = useMemo(() => new Set(enabledAlerts), [enabledAlerts]);
  const prevPrices = useRef<Record<string, number | null>>({});
  const notifiedRef = useRef<Set<string>>(new Set());
  const [fired, setFired] = useState<ReturnType<typeof evaluateAlerts>>([]);

  const priceMap = useMemo(
    () => ({ CRUDEOIL: crudeLtp, NATURALGAS: ngLtp, WTI: num(wti?.price), HENRYHUB: num(henryHub?.price) }),
    [crudeLtp, ngLtp, wti?.price, henryHub?.price]
  );
  const changeMap = useMemo(
    () => ({ CRUDEOIL: crudePct, NATURALGAS: ngPct, WTI: num(wti?.changePercent), HENRYHUB: num(henryHub?.changePercent) }),
    [crudePct, ngPct, wti?.changePercent, henryHub?.changePercent]
  );

  useEffect(() => {
    const hits = evaluateAlerts(allRules, enabledSet, { prices: priceMap, changePcts: changeMap, items, previousPrices: prevPrices.current });
    prevPrices.current = { ...priceMap };
    if (hits.length === 0) return;
    // dedupeKey is the identity of the OCCURRENCE, so a percent threshold that
    // stays breached all day banners once rather than on every poll.
    const fresh = hits.filter((h) => !notifiedRef.current.has(h.dedupeKey));
    if (fresh.length === 0) return;
    setFired((prev) => [...fresh, ...prev.filter((p) => !fresh.some((h) => h.dedupeKey === p.dedupeKey))].slice(0, 6));
    // Browser notification, only if the trader already granted permission --
    // this never prompts on its own, and never repeats the same occurrence.
    const canNotify = typeof Notification !== "undefined" && Notification.permission === "granted";
    for (const h of fresh) {
      notifiedRef.current.add(h.dedupeKey);
      if (canNotify) {
        try {
          new Notification(`GPT News · ${h.label}`, { body: h.detail });
        } catch {
          // Some browsers throw outside a service worker; the in-page banner still shows.
        }
      }
    }
  }, [allRules, enabledSet, priceMap, changeMap, items]);

  const tokens = theme === "dark" ? DARK : LIGHT;
  const fetchedAge = news.data?.fetchedAt ? ageMinutes(news.data.fetchedAt) : null;
  const feedDown = Boolean(news.error) || (news.data ? !news.data.available : false);

  const position = (id: string) => positions.find((p) => p.id === id);
  const savePosition = (next: PositionInput) => setPositions(positions.map((p) => (p.id === next.id ? next : p)));

  const premiumFor = (p: PositionInput): number | null => {
    const chain = p.symbol === "CRUDEOIL" ? crudeChain.data : ngChain.data;
    const row = chain?.rows?.find((r) => r.strike === p.strike);
    if (!row) return null;
    return (p.optSide === "CE" ? row.call.ltp : row.put.ltp) ?? null;
  };
  const premiumNoteFor = (p: PositionInput) => {
    if (!trackPremium) return "Live premium tracking is off — turn it on in Settings to see premium and P&L.";
    const chain = p.symbol === "CRUDEOIL" ? crudeChain : ngChain;
    if (chain.isLoading) return "Loading the option chain…";
    if (chain.error) return `Option chain unavailable: ${(chain.error as Error).message}`;
    return `Strike ${p.strike} is not in the current option chain window, so no live premium is available for it.`;
  };

  return (
    <div
      className="-mx-4 -mt-4 px-4 pt-3 pb-8 min-h-screen space-y-4"
      style={
        {
          background: theme === "dark" ? "linear-gradient(180deg,#0A0B10,#0E1018 45%,#0A0B10)" : "linear-gradient(180deg,#EEF2F8,#F7F9FC 45%,#EEF2F8)",
          color: tokens.text,
          "--gn-panel": tokens.panel,
          "--gn-panel-2": tokens.panel2,
          "--gn-border": tokens.border,
          "--gn-text": tokens.text,
          "--gn-muted": tokens.muted,
          "--gn-faint": tokens.faint,
        } as React.CSSProperties
      }
    >
      {/* ---- Header (spec section 3) ---- */}
      <header className="sticky top-0 z-20 -mx-4 px-4 pt-1 pb-2" style={{ background: theme === "dark" ? "#0A0B10F2" : "#EEF2F8F2", backdropFilter: "blur(8px)" }}>
        <div className="flex items-center gap-2">
          <Newspaper size={20} style={{ color: GN.accent }} />
          <div className="min-w-0">
            <h1 className="text-[17px] font-black leading-none">GPT News</h1>
            <p className="text-[9px] leading-tight mt-0.5" style={{ color: tokens.faint }}>Energy &amp; Geopolitical Intelligence</p>
          </div>
          <span className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => setSearchOpen((o) => !o)} aria-label="Search news" className="p-1.5 rounded-lg" style={{ background: tokens.panel2, color: tokens.muted }}>
              <Search size={14} />
            </button>
            <button type="button" onClick={() => setSettingsOpen(true)} aria-label="GPT News settings" className="p-1.5 rounded-lg" style={{ background: tokens.panel2, color: tokens.muted }}>
              <Settings2 size={14} />
            </button>
            <button type="button" onClick={() => news.refetch()} aria-label="Refresh now" className="p-1.5 rounded-lg" style={{ background: tokens.panel2, color: tokens.muted }}>
              <RefreshCw size={14} className={news.isFetching ? "motion-safe:animate-spin" : ""} />
            </button>
          </span>
        </div>

        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className="flex items-center gap-1 text-[9.5px] font-bold" style={{ color: feedDown ? GN.bear : GN.bull }}>
            <span className="relative flex w-1.5 h-1.5">
              {!feedDown && <span className="absolute inline-flex w-full h-full rounded-full motion-safe:animate-ping" style={{ background: GN.bull }} />}
              <span className="relative inline-flex w-1.5 h-1.5 rounded-full" style={{ background: feedDown ? GN.bear : GN.bull }} />
            </span>
            {feedDown ? "FEED DOWN" : "LIVE"}
          </span>
          <span className="text-[9.5px]" style={{ color: tokens.faint }}>
            {fetchedAge !== null ? `Updated ${formatAge(fetchedAge)}` : "Waiting for the first update"}
          </span>
          <span className="text-[9.5px]" style={{ color: tokens.faint }}>
            · MCX {status.data?.isOpen ? "open" : "closed"} {status.data?.timeLabel ? `· ${status.data.timeLabel}` : ""}
          </span>
          <button
            type="button"
            onClick={() => setFastMode(!fastMode)}
            className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg text-[9.5px] font-black"
            style={fastMode ? { background: GN.warn, color: "#0A0B10" } : { background: tokens.panel2, color: tokens.muted }}
          >
            <Zap size={10} /> Fast mode {fastMode ? "on" : "off"}
          </button>
        </div>

        {searchOpen && (
          <div className="mt-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl" style={{ background: tokens.panel2 }}>
              <Search size={13} style={{ color: tokens.faint }} />
              <input
                autoFocus
                value={rawQuery}
                onChange={(e) => setRawQuery(e.target.value)}
                placeholder="Search headlines and sources…"
                className="flex-1 bg-transparent outline-none text-[12px]"
                style={{ color: tokens.text }}
              />
              {rawQuery && (
                <button type="button" onClick={() => setRawQuery("")} aria-label="Clear search">
                  <X size={13} style={{ color: tokens.faint }} />
                </button>
              )}
            </div>
            <div className="flex gap-1 overflow-x-auto no-scrollbar mt-1.5">
              {SEARCH_SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => setRawQuery(s)} className="shrink-0 px-2 py-1 rounded-lg text-[9.5px] font-bold" style={{ background: tokens.panel2, color: tokens.muted }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Category tabs */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar mt-2 -mx-1 px-1">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10.5px] font-black transition-colors"
              style={tab === key ? { background: GN.accent, color: "#0A0B10" } : { background: tokens.panel2, color: tokens.muted }}
            >
              <Icon size={11} />
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* ---- Live alerts banner ---- */}
      {fired.length > 0 && (
        <section className="space-y-1.5">
          {fired.map((a) => (
            <div key={a.dedupeKey} className="rounded-xl px-2.5 py-2 flex items-start gap-1.5" style={{ background: `${a.severity === "critical" ? GN.shock : GN.warn}18`, border: `1px solid ${a.severity === "critical" ? GN.shock : GN.warn}55` }}>
              <Bell size={12} className="shrink-0 mt-0.5" style={{ color: a.severity === "critical" ? GN.shock : GN.warn }} />
              <div className="min-w-0 flex-1">
                <p className="text-[10.5px] font-black" style={{ color: a.severity === "critical" ? GN.shock : GN.warn }}>{a.label}</p>
                <p className="text-[9.5px] leading-snug" style={{ color: tokens.muted }}>{a.detail}</p>
              </div>
              <button type="button" onClick={() => setFired(fired.filter((f) => f.dedupeKey !== a.dedupeKey))} aria-label="Dismiss alert">
                <X size={12} style={{ color: tokens.faint }} />
              </button>
            </div>
          ))}
        </section>
      )}

      {/* ---- Feed failure (spec section 34: degrade, never break) ---- */}
      {feedDown && (
        <Panel className="px-3 py-2.5" tone={`${GN.bear}55`}>
          <p className="text-[11.5px] font-black" style={{ color: GN.bear }}>Live feed unavailable</p>
          <p className="text-[10px] leading-snug mt-0.5" style={{ color: tokens.muted }}>
            {fetchedAge !== null ? `Last successful update ${formatAge(fetchedAge)}.` : "There has been no successful update yet in this session."}{" "}
            {(news.error as Error | null)?.message ?? news.data?.error ?? ""} Everything below is either the last good data or is shown as unavailable — nothing has been filled in.
          </p>
        </Panel>
      )}

      {/* ---- 1. BREAKING (spec sections 6 and 39) ---- */}
      <section>
        <SectionTitle
          icon={<Siren size={13} style={{ color: GN.shock }} />}
          title="Breaking"
          note="Level 4+ stories from the last 3 hours, corroborated or from an official source. Nothing unconfirmed is promoted here."
        />
        {news.isLoading ? (
          <SkeletonRows n={2} />
        ) : breaking.length === 0 ? (
          <EmptyState
            title="Nothing is breaking right now"
            detail="No story in the feed clears the Level 4 bar in the last 3 hours. That is a genuinely quiet tape, not a loading state."
          />
        ) : (
          <div className="space-y-2.5">
            {breaking.map((i) => (
              <BreakingCard key={i.id} item={i} />
            ))}
            {/* Spec section 23: never invent a before/after price around a headline. */}
            <p className="text-[9px] leading-snug px-1" style={{ color: tokens.faint }}>
              Before/after price reaction for an individual headline is not measured — this app keeps no tick history stamped against each story, so MCX reaction per headline is unavailable rather
              than estimated. Today's move so far: MCX Crude {pct(crudePct)}, MCX Natural Gas {pct(ngPct)}, WTI {pct(num(wti?.changePercent))}.
            </p>
          </div>
        )}
      </section>

      {/* ---- 2 & 3. Crude and Gas bias panels (spec sections 9, 10, 39) ---- */}
      <section className="space-y-2.5">
        <SectionTitle icon={<BarChart3 size={13} style={{ color: GN.accent }} />} title="Signal panels" note="A read on news pressure only. It knows nothing about the chart." />
        <BiasPanelCard panel={crude} />
        <BiasPanelCard panel={ng} />
      </section>

      {/* ---- 4. My positions (spec sections 8, 36, 37) ---- */}
      <section className="space-y-2.5">
        <SectionTitle
          icon={<Briefcase size={13} style={{ color: GN.accent }} />}
          title="My trades"
          note="Your own positions, stored only on this device. Levels are yours to watch — they are not predictions."
          right={
            <button
              type="button"
              onClick={() => setTrackPremium(!trackPremium)}
              className="shrink-0 px-2 py-1 rounded-lg text-[9px] font-black"
              style={trackPremium ? { background: GN.bull, color: "#0A0B10" } : { background: tokens.panel2, color: tokens.muted }}
            >
              Live premium {trackPremium ? "on" : "off"}
            </button>
          }
        />
        {positions.map((p) => (
          <PositionCard
            key={p.id}
            read={readPosition(p, p.symbol === "CRUDEOIL" ? crudeLtp : ngLtp, premiumFor(p), p.symbol === "CRUDEOIL" ? crude : ng)}
            onEdit={() => setEditingId(p.id)}
            premiumNote={premiumNoteFor(p)}
          />
        ))}
      </section>

      {/* ---- 5. Geopolitical risk (spec sections 11, 12, 13) ---- */}
      <section className="space-y-2.5">
        <SectionTitle
          icon={<Globe2 size={13} style={{ color: GN.warn }} />}
          title="Global energy risk monitor"
          note="Risk is read from headlines actually in the feed. LOW means nothing has been reported — it is not a verified all-clear."
        />
        <div className="grid grid-cols-2 gap-1.5">
          {countries.map((c) => (
            <CountryCard key={c.key} c={c} />
          ))}
        </div>
        {chokepoints.map((cp) => (
          <ChokepointCard key={cp.key} read={cp} />
        ))}
      </section>

      {/* ---- Weather + EIA data (spec sections 14, 15, 16) ---- */}
      <section className="space-y-2.5">
        <SectionTitle icon={<CloudSun size={13} style={{ color: GN.accent }} />} title="Fundamentals" />
        <WeatherCard read={weather} />
        <EiaCard
          title="EIA Crude Inventories"
          unitLabel="barrels"
          available={Boolean(energy.data?.crude)}
          error={energy.data?.error ?? (energy.error as Error | null)?.message}
          latestValue={energy.data?.crude?.latestValue ?? null}
          priorValue={energy.data?.crude?.priorValue ?? null}
          changeValue={energy.data?.crude?.changeValue ?? null}
          direction={energy.data?.crude?.direction ?? null}
          bias={eiaCrudeBias ?? "neutral"}
          note="Official EIA figures, compared against the PRIOR REPORT. No analyst consensus is shown: the free EIA/FRED APIs do not publish one, and inventing an 'expected' number would be a fabrication. Gasoline, distillates and Cushing are not in the connected series."
        />
        <EiaCard
          title="EIA Natural Gas Storage"
          unitLabel="Bcf"
          available={Boolean(energy.data?.ngStorage)}
          error={energy.data?.error ?? (energy.error as Error | null)?.message}
          latestValue={energy.data?.ngStorage?.latestValue ?? null}
          priorValue={energy.data?.ngStorage?.priorValue ?? null}
          changeValue={energy.data?.ngStorage?.changeValue ?? null}
          direction={energy.data?.ngStorage?.direction ?? null}
          bias={eiaStorageBias ?? "neutral"}
          note="Official EIA working-gas figures versus the prior report. The 5-year average comparison and the last-10-reports history are not in the connected series, so they are left out rather than approximated."
        />
      </section>

      {/* ---- Market dashboard (spec section 7) ---- */}
      <section>
        <SectionTitle
          icon={<BarChart3 size={13} style={{ color: GN.accent }} />}
          title="Market data"
          note="Live data — separate from news and from any interpretation above."
        />
        <div className="grid grid-cols-2 gap-1.5">
          <MarketTile label="WTI" sub="NYMEX · $" value={num(wti?.price) === null ? null : `$${wti!.price!.toFixed(2)}`} changePct={num(wti?.changePercent)} unavailable={wti?.error ?? "No quote"} />
          <MarketTile label="Brent" sub="ICE · $" value={num(brent?.price) === null ? null : `$${brent!.price!.toFixed(2)}`} changePct={num(brent?.changePercent)} unavailable={brent?.error ?? "No quote"} />
          <MarketTile label="MCX Crude" sub={mcxCrude?.tradingSymbol ?? "₹ / barrel"} value={crudeLtp === null ? null : `₹${crudeLtp.toLocaleString("en-IN")}`} changePct={crudePct} unavailable={mcxCrude?.error ?? "No live price"} />
          <MarketTile label="Henry Hub" sub="NYMEX · $" value={num(henryHub?.price) === null ? null : `$${henryHub!.price!.toFixed(2)}`} changePct={num(henryHub?.changePercent)} unavailable={henryHub?.error ?? "No quote"} />
          <MarketTile label="MCX Natural Gas" sub={mcxNg?.tradingSymbol ?? "₹ / mmBtu"} value={ngLtp === null ? null : `₹${ngLtp.toLocaleString("en-IN")}`} changePct={ngPct} unavailable={mcxNg?.error ?? "No live price"} />
          {(macro.data?.quotes ?? []).map((q) => (
            <MarketTile
              key={q.symbol}
              label={q.short}
              sub={q.name}
              value={macroValue(num(q.price), q.unit)}
              changePct={num(q.changePercent)}
              spark={Array.isArray(q.spark) ? q.spark.filter((p) => typeof p === "number" && Number.isFinite(p)) : []}
              unavailable={q.error ?? "No quote"}
            />
          ))}
        </div>
        {macro.isLoading && <p className="text-[9.5px] mt-1.5" style={{ color: tokens.faint }}>Loading the macro backdrop…</p>}
      </section>

      {/* ---- Next MCX session / weekend risk (spec sections 24, 25) ---- */}
      {!status.data?.isOpen && (
        <section className="space-y-2.5">
          <SectionTitle icon={<CalendarClock size={13} style={{ color: GN.warn }} />} title={session.isWeekend ? "Weekend risk monitor" : "Next MCX energy session"} />
          <Panel className="px-3 py-2.5">
            <p className="text-[11px] font-bold" style={{ color: tokens.text }}>
              MCX Crude and Natural Gas next trade {session.nextSessionLabel}
              {session.minutesToOpen !== null && session.minutesToOpen < 1440 && ` — in about ${Math.floor(session.minutesToOpen / 60)}h ${session.minutesToOpen % 60}m`}.
            </p>
            <p className="text-[9.5px] mt-0.5" style={{ color: tokens.faint }}>
              Overseas benchmarks keep trading in the meantime. MCX holidays are not in this app's calendar, so a holiday can push this later.
            </p>

            <div className="mt-2 space-y-1.5">
              {[{ label: "Crude Oil", est: crudeOpening }, { label: "Natural Gas", est: ngOpening }].map(({ label, est }) => (
                <div key={label} className="rounded-xl px-2.5 py-2" style={{ background: "var(--gn-panel-2)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10.5px] font-bold" style={{ color: tokens.text }}>{label} — estimated opening bias</span>
                    <Chip color={BIAS_COLOR[est.bias]}>{est.available ? est.label : "N/A"}</Chip>
                  </div>
                  <p className="text-[9.5px] leading-snug mt-1" style={{ color: tokens.muted }}>{est.detail}</p>
                  {est.drivers.map((d) => (
                    <p key={d.name} className="text-[9px]" style={{ color: tokens.faint }}>
                      {d.name}: {d.changePct >= 0 ? "+" : ""}{d.changePct.toFixed(2)}%
                    </p>
                  ))}
                </div>
              ))}
            </div>

            <p className="text-[9.5px] mt-2 px-2 py-1.5 rounded-lg leading-snug" style={{ background: `${GN.warn}18`, color: GN.warn }}>
              This is an ESTIMATE of direction from overseas moves, not a guaranteed opening price.
            </p>

            {session.isWeekend && (
              <div className="mt-2 pt-2 border-t" style={{ borderColor: tokens.border }}>
                <p className="text-[9.5px] font-black uppercase mb-1" style={{ color: tokens.muted }}>Weekend catalysts in the feed</p>
                {(() => {
                  const bull = items.filter((i) => i.direction === "bullish" && i.priority >= 3).slice(0, 3);
                  const bear = items.filter((i) => i.direction === "bearish" && i.priority >= 3).slice(0, 3);
                  if (bull.length === 0 && bear.length === 0) {
                    return <p className="text-[10px]" style={{ color: tokens.faint }}>Nothing above Level 3 has landed this weekend.</p>;
                  }
                  return (
                    <>
                      {bull.map((i) => <p key={i.id} className="text-[9.5px] leading-snug" style={{ color: tokens.muted }}>🟢 {i.headline}</p>)}
                      {bear.map((i) => <p key={i.id} className="text-[9.5px] leading-snug" style={{ color: tokens.muted }}>🔴 {i.headline}</p>)}
                    </>
                  );
                })()}
              </div>
            )}
          </Panel>
        </section>
      )}

      {/* ---- The feed itself (spec sections 17, 27, 28) ---- */}
      <section>
        <SectionTitle
          icon={<Newspaper size={13} style={{ color: GN.accent }} />}
          title={fastMode ? "Feed — newest first" : "Feed — by market importance"}
          right={<span className="text-[9.5px] shrink-0" style={{ color: tokens.faint }}>{visible.length} of {items.length}</span>}
        />

        {/* Filter rows */}
        <div className="space-y-1.5 mb-2">
          {([
            ["Time", TIME_FILTERS, filters.time, (v: string) => setFilters({ ...filters, time: v as FilterState["time"] })],
            ["Asset", ASSET_FILTERS, filters.asset, (v: string) => setFilters({ ...filters, asset: v as FilterState["asset"] })],
            ["Impact", IMPACT_FILTERS, filters.impact, (v: string) => setFilters({ ...filters, impact: v as FilterState["impact"] })],
            ["Source", SOURCE_FILTERS, filters.source, (v: string) => setFilters({ ...filters, source: v })],
          ] as const).map(([label, options, current, onPick]) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold w-[38px] shrink-0" style={{ color: tokens.faint }}>{label}</span>
              <div className="flex gap-1 overflow-x-auto no-scrollbar">
                {options.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => onPick(o.key)}
                    className="shrink-0 px-2 py-1 rounded-lg text-[9.5px] font-bold"
                    style={current === o.key ? { background: GN.accent, color: "#0A0B10" } : { background: tokens.panel2, color: tokens.muted }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {news.isLoading ? (
          <SkeletonRows n={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nothing matches these filters"
            detail={items.length === 0 ? "No scoreable energy stories have come through the feeds in the last 48 hours." : "Try widening the time window or clearing the search."}
          />
        ) : (
          <div className="space-y-2">
            {rows.map((i) => (
              <NewsRow key={i.id} item={i} fast={fastMode} />
            ))}
          </div>
        )}

        {visible.length > INITIAL_ROWS && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="w-full mt-2 py-2.5 rounded-xl text-[11px] font-bold active:scale-[.98] transition-transform"
            style={{ background: tokens.panel2, color: tokens.muted }}
          >
            {expanded ? "Show less" : `Show all ${visible.length}`}
          </button>
        )}
      </section>

      {/* ---- Timeline (spec section 22) ---- */}
      <section>
        <SectionTitle icon={<History size={13} style={{ color: GN.accent }} />} title="Latest events" note="Chronological, IST, last 12 hours." />
        <Panel className="px-3 py-2.5">
          <TimelineList items={timeline} />
        </Panel>
      </section>

      {/* ---- Upcoming events (spec section 26) ---- */}
      <section>
        <SectionTitle icon={<CalendarClock size={13} style={{ color: GN.accent }} />} title="Economic &amp; energy calendar" />
        <Panel className="px-3 py-1.5">
          {calendar.map((e) => (
            <EventRow key={`${e.name}-${e.whenIso}`} e={e} />
          ))}
        </Panel>
        <p className="text-[9px] leading-snug mt-1.5 px-1" style={{ color: tokens.faint }}>
          The two EIA rows come from the EIA's standing weekly schedule (Wednesday and Thursday releases) and shift on US public holidays. Other releases appear only when the FRED calendar is
          configured on the server. OPEC meetings, speeches and LNG announcements have no connected feed, so they are not listed rather than guessed.
        </p>
      </section>

      {/* ---- GPT Market Intelligence (spec section 35) ---- */}
      <section className="space-y-2.5">
        <SectionTitle icon={<Brain size={13} style={{ color: GN.accent }} />} title="GPT market intelligence" note="Fact, interpretation and estimate are kept separate on purpose." />
        <IntelligenceCard block={intelligenceFor(crude)} />
        <IntelligenceCard block={intelligenceFor(ng)} />
      </section>

      <SourceHealth sourceStatus={news.data?.sourceStatus ?? []} lastUpdateLabel={news.data?.fetchedAt ? `Feed last checked ${formatStamp(news.data.fetchedAt)}` : null} />

      <p className="text-[9.5px] leading-relaxed text-center px-2" style={{ color: tokens.faint }}>
        Educational reference only, not financial advice. Scoring is rule-based, so the same headline always scores the same way. No headline, source, price or timestamp on this page is ever
        invented — anything unavailable is labelled as unavailable. Bias readings describe news pressure, not a guaranteed direction, and nothing here promises a profit. Brent is not WTI, Henry Hub
        is not MCX Natural Gas, and an option premium is not the underlying commodity.
      </p>

      {/* ---- Settings sheet (spec section 31) ---- */}
      {settingsOpen && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="GPT News settings">
          <div className="absolute inset-0 bg-black/55" onClick={() => setSettingsOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 max-w-lg mx-auto max-h-[85vh] overflow-y-auto rounded-t-2xl px-4 pt-3 pb-[max(20px,env(safe-area-inset-bottom))]" style={{ background: tokens.panel, border: `1px solid ${tokens.border}` }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[14px] font-black" style={{ color: tokens.text }}>GPT News settings</p>
              <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close settings">
                <X size={16} style={{ color: tokens.muted }} />
              </button>
            </div>

            <p className="text-[9.5px] mb-3" style={{ color: tokens.faint }}>
              Name: GPT News · Currency: INR · Timezone: Asia/Kolkata · Default assets: Crude Oil and Natural Gas. Everything here is stored on this device only.
            </p>

            <div className="mb-3">
              <p className="text-[10px] font-black uppercase mb-1.5" style={{ color: tokens.muted }}>Appearance</p>
              <div className="flex gap-1.5">
                {(["dark", "light"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setTheme(t)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10.5px] font-bold" style={theme === t ? { background: GN.accent, color: "#0A0B10" } : { background: tokens.panel2, color: tokens.muted }}>
                    {t === "dark" ? <Moon size={11} /> : <Sun size={11} />} {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-3">
              <p className="text-[10px] font-black uppercase mb-1.5" style={{ color: tokens.muted }}>Refresh interval</p>
              <div className="flex gap-1.5 flex-wrap">
                {REFRESH_CHOICES.map((ms) => (
                  <button key={ms} type="button" onClick={() => setRefreshMs(ms)} className="px-3 py-1.5 rounded-lg text-[10.5px] font-bold" style={refreshMs === ms ? { background: GN.accent, color: "#0A0B10" } : { background: tokens.panel2, color: tokens.muted }}>
                    {ms < 60_000 ? `${ms / 1000} sec` : `${ms / 60_000} min`}
                  </button>
                ))}
              </div>
              <p className="text-[9px] mt-1" style={{ color: tokens.faint }}>The server caches news for 60 seconds, so polling faster than that re-serves the same generation.</p>
            </div>

            <div className="mb-3">
              <p className="text-[10px] font-black uppercase mb-1.5" style={{ color: tokens.muted }}>Live option premium</p>
              <button type="button" onClick={() => setTrackPremium(!trackPremium)} className="px-3 py-1.5 rounded-lg text-[10.5px] font-bold" style={trackPremium ? { background: GN.bull, color: "#0A0B10" } : { background: tokens.panel2, color: tokens.muted }}>
                {trackPremium ? "On" : "Off"}
              </button>
              <p className="text-[9px] mt-1" style={{ color: tokens.faint }}>Off by default. The option chain is the heaviest call this app makes, so this page does not request it unless you ask.</p>
            </div>

            <div className="mb-3">
              <p className="text-[10px] font-black uppercase mb-1.5" style={{ color: tokens.muted }}>Notifications</p>
              <button
                type="button"
                onClick={() => { if (typeof Notification !== "undefined") void Notification.requestPermission(); }}
                className="px-3 py-1.5 rounded-lg text-[10.5px] font-bold"
                style={{ background: tokens.panel2, color: tokens.muted }}
              >
                {typeof Notification !== "undefined" && Notification.permission === "granted" ? "Browser notifications allowed" : "Allow browser notifications"}
              </button>
            </div>

            <div className="mb-3">
              <p className="text-[10px] font-black uppercase mb-1.5" style={{ color: tokens.muted }}>Alerts</p>
              <div className="space-y-1">
                {allRules.map((r) => {
                  const on = enabledSet.has(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setEnabledAlerts(on ? enabledAlerts.filter((id) => id !== r.id) : [...enabledAlerts, r.id])}
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg"
                      style={{ background: tokens.panel2 }}
                    >
                      <span className="text-[10.5px] text-left" style={{ color: tokens.text }}>{r.label}</span>
                      <span className="text-[9px] font-black shrink-0" style={{ color: on ? GN.bull : tokens.faint }}>{on ? "ON" : "OFF"}</span>
                    </button>
                  );
                })}
              </div>
              <CustomAlertForm
                onAdd={(rule) => {
                  setCustomRules([...customRules, rule]);
                  setEnabledAlerts([...enabledAlerts, rule.id]);
                }}
                tokens={tokens}
              />
            </div>

            <button type="button" onClick={() => setSettingsOpen(false)} className="w-full py-2.5 rounded-xl text-[12px] font-black" style={{ background: GN.accent, color: "#0A0B10" }}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* ---- Position editor ---- */}
      {editingId && position(editingId) && (
        <PositionEditor
          value={position(editingId)!}
          tokens={tokens}
          onCancel={() => setEditingId(null)}
          onSave={(next) => {
            savePosition(next);
            setEditingId(null);
          }}
        />
      )}
    </div>
  );
}

type Tokens = typeof DARK;

function CustomAlertForm({ onAdd, tokens }: { onAdd: (rule: AlertRule) => void; tokens: Tokens }) {
  const [symbol, setSymbol] = useState<"CRUDEOIL" | "NATURALGAS">("CRUDEOIL");
  const [level, setLevel] = useState("");
  return (
    <div className="flex items-center gap-1.5 mt-1.5">
      <button type="button" onClick={() => setSymbol(symbol === "CRUDEOIL" ? "NATURALGAS" : "CRUDEOIL")} className="px-2 py-1.5 rounded-lg text-[9.5px] font-bold shrink-0" style={{ background: tokens.panel2, color: tokens.muted }}>
        {symbol === "CRUDEOIL" ? "Crude" : "Gas"}
      </button>
      <input
        inputMode="decimal"
        value={level}
        onChange={(e) => setLevel(e.target.value)}
        placeholder="Custom price level"
        className="flex-1 min-w-0 px-2 py-1.5 rounded-lg text-[10.5px] outline-none"
        style={{ background: tokens.panel2, color: tokens.text }}
      />
      <button
        type="button"
        disabled={!Number.isFinite(Number(level)) || level.trim() === ""}
        onClick={() => {
          const value = Number(level);
          onAdd({ id: `custom-${symbol}-${value}-${Date.now()}`, kind: "price", symbol, value, label: `${symbol === "CRUDEOIL" ? "MCX Crude" : "MCX Natural Gas"} crosses ₹${value.toLocaleString("en-IN")}` });
          setLevel("");
        }}
        className="px-2.5 py-1.5 rounded-lg text-[9.5px] font-black shrink-0 disabled:opacity-40"
        style={{ background: GN.accent, color: "#0A0B10" }}
      >
        Add
      </button>
    </div>
  );
}

function PositionEditor({ value, tokens, onSave, onCancel }: { value: PositionInput; tokens: Tokens; onSave: (v: PositionInput) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(value);
  const [levelsText, setLevelsText] = useState(value.levels.map((l) => `${l.price} ${l.label}`).join("\n"));

  const field = (label: string, key: "strike" | "lots" | "avgPremium", step: string) => (
    <label className="block">
      <span className="text-[9.5px] font-bold" style={{ color: tokens.faint }}>{label}</span>
      <input
        inputMode="decimal"
        step={step}
        value={String(draft[key])}
        onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
        className="w-full mt-0.5 px-2 py-1.5 rounded-lg text-[11px] outline-none"
        style={{ background: tokens.panel2, color: tokens.text }}
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Edit position">
      <div className="absolute inset-0 bg-black/55" onClick={onCancel} />
      <div className="absolute bottom-0 left-0 right-0 max-w-lg mx-auto max-h-[85vh] overflow-y-auto rounded-t-2xl px-4 pt-3 pb-[max(20px,env(safe-area-inset-bottom))]" style={{ background: tokens.panel, border: `1px solid ${tokens.border}` }}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[14px] font-black" style={{ color: tokens.text }}>{draft.symbol === "CRUDEOIL" ? "Crude Oil" : "Natural Gas"} position</p>
          <button type="button" onClick={onCancel} aria-label="Close editor"><X size={16} style={{ color: tokens.muted }} /></button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {field("Strike", "strike", "1")}
          {field("Lots", "lots", "1")}
          {field("Avg premium", "avgPremium", "0.05")}
        </div>

        <div className="grid grid-cols-2 gap-2 mt-2">
          <label className="block">
            <span className="text-[9.5px] font-bold" style={{ color: tokens.faint }}>Side</span>
            <button type="button" onClick={() => setDraft({ ...draft, optSide: draft.optSide === "CE" ? "PE" : "CE" })} className="w-full mt-0.5 px-2 py-1.5 rounded-lg text-[11px] font-black" style={{ background: tokens.panel2, color: tokens.text }}>
              {draft.optSide}
            </button>
          </label>
          <label className="block">
            <span className="text-[9.5px] font-bold" style={{ color: tokens.faint }}>Expiry</span>
            <input
              type="date"
              value={draft.expiry}
              onChange={(e) => setDraft({ ...draft, expiry: e.target.value })}
              className="w-full mt-0.5 px-2 py-1.5 rounded-lg text-[11px] outline-none"
              style={{ background: tokens.panel2, color: tokens.text }}
            />
          </label>
        </div>

        <label className="block mt-2">
          <span className="text-[9.5px] font-bold" style={{ color: tokens.faint }}>Monitoring levels — one per line, "price label"</span>
          <textarea
            rows={6}
            value={levelsText}
            onChange={(e) => setLevelsText(e.target.value)}
            className="w-full mt-0.5 px-2 py-1.5 rounded-lg text-[11px] outline-none font-mono"
            style={{ background: tokens.panel2, color: tokens.text }}
          />
        </label>
        <p className="text-[9px] mt-1" style={{ color: tokens.faint }}>These are your own levels to watch. They are never treated as targets or predictions.</p>

        <div className="flex gap-2 mt-3">
          <button type="button" onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-[12px] font-black" style={{ background: tokens.panel2, color: tokens.muted }}>Cancel</button>
          <button
            type="button"
            onClick={() =>
              onSave({
                ...draft,
                levels: levelsText
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .map((line) => {
                    const [price, ...rest] = line.split(/\s+/);
                    return { price: Number(price), label: rest.join(" ") || "Level" };
                  })
                  .filter((l) => Number.isFinite(l.price)),
              })
            }
            className="flex-1 py-2.5 rounded-xl text-[12px] font-black"
            style={{ background: GN.accent, color: "#0A0B10" }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
