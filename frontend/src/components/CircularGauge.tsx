import { useEffect, useState } from "react";

function gaugeColor(score: number): string {
  if (score >= 85) return "#00E676";
  if (score >= 65) return "#00C2FF";
  if (score >= 45) return "#FFC107";
  return "#FF4D4F";
}

// Animates from 0 up to `value` once on mount / whenever value changes,
// via requestAnimationFrame -- no fabricated precision, just an honest
// count-up of a real already-computed score.
export function CircularGauge({
  value,
  size = 120,
  label,
  sublabel,
  suffix = "",
}: {
  value: number;
  size?: number;
  label?: string;
  sublabel?: string;
  suffix?: string;
}) {
  const [animated, setAnimated] = useState(0);
  const target = Math.max(0, Math.min(100, value));

  useEffect(() => {
    let raf: number;
    const start = performance.now();
    const duration = 900;
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimated(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  const stroke = Math.max(6, size * 0.07);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - animated / 100);
  const color = gaugeColor(target);

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,.08)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ filter: `drop-shadow(0 0 6px ${color}66)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-black" style={{ fontSize: size * 0.24, color }}>
          {Math.round(animated)}
          {suffix}
        </span>
        {label && <span className="text-[9px] text-[#9AA4B2] font-semibold uppercase tracking-wide mt-0.5">{label}</span>}
        {sublabel && <span className="text-[9px] text-[#9AA4B2]">{sublabel}</span>}
      </div>
    </div>
  );
}
