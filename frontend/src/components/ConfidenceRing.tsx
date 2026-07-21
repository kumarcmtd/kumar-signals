function ringColor(score: number): string {
  if (score >= 95) return "#065f46"; // dark green
  if (score >= 90) return "#059669"; // green
  if (score >= 80) return "#eab308"; // yellow
  if (score >= 70) return "#f97316"; // orange
  return "#dc2626"; // red
}

export function ConfidenceRing({ score, size = 96 }: { score: number; size?: number }) {
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(Math.max(score, 0), 100) / 100);
  const color = ringColor(score);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={radius} stroke="#e5e7eb" strokeWidth={stroke} fill="none" />
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
        style={{ transition: "stroke-dashoffset 500ms ease, stroke 500ms ease" }}
      />
      <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.24} fontWeight={800} fill={color}>
        {Math.round(score)}
      </text>
      <text x="50%" y="66%" textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.11} fill="#6b7280">
        confidence
      </text>
    </svg>
  );
}
