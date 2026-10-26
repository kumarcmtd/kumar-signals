// "Where is the price now?" -- the AI chart at the very top of AI-Shoot, so
// opening the app answers it at a glance: the blinking live-price dot, green
// buy zones, red sell zones, and what to do there. Crude / NG switch,
// remembered on this phone.

import { useState } from "react";
import { useLocation } from "react-router-dom";
import { MapPin } from "lucide-react";
import { AiChart } from "../components/trust/AiChart";

type Sym = "CRUDEOIL" | "NATURALGAS";
const KEY = "priceMap.symbol";

function read(): Sym {
  try {
    return localStorage.getItem(KEY) === "NATURALGAS" ? "NATURALGAS" : "CRUDEOIL";
  } catch {
    return "CRUDEOIL";
  }
}

export function PriceMapStrip() {
  const { pathname } = useLocation();
  const [sym, setSymState] = useState<Sym>(read);
  if (pathname !== "/") return null;
  const setSym = (s: Sym) => {
    setSymState(s);
    try {
      localStorage.setItem(KEY, s);
    } catch {
      /* private mode */
    }
  };
  return (
    <section className="mb-4 rounded-3xl p-3 shadow-lg" style={{ background: "linear-gradient(135deg,#1E1B4B,#4C1D95 55%,#9D174D)" }}>
      <div className="flex items-center gap-2 px-1">
        <MapPin size={16} className="text-pink-200" />
        <p className="text-[13.5px] font-black text-white flex-1">Where is the price now?</p>
        {(["CRUDEOIL", "NATURALGAS"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSym(s)}
            className={`rounded-lg px-2.5 py-1 text-[11.5px] font-black ${sym === s ? "bg-white text-violet-800" : "bg-white/15 text-white/80"}`}
          >
            {s === "CRUDEOIL" ? "🛢️ Crude" : "🔥 NG"}
          </button>
        ))}
      </div>
      <AiChart key={sym} symbol={sym} plan={null} levels={null} />
    </section>
  );
}
