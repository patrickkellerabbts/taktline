// Progress-Gauge: ein gefüllter Arc visualisiert den Fortschritt (0..100).
// Der Rest des Kreises ist grau. Optional kann ein kleines rotes Segment
// die Überfälligkeits-Quote markieren (overdueRatio 0..1) — das wird am
// Anfang des "verbleibend"-Bereichs gerendert.

type Props = {
  percent: number; // 0..100
  // Anteil der "verbleibenden" Aufgaben die überfällig sind (0..1). Wenn >0
  // wird der erste Teil des Rest-Arcs rot statt grau gerendert.
  overdueRatio?: number;
  size?: number;
  thickness?: number;
};

export function Donut({ percent, overdueRatio = 0, size = 140, thickness = 22 }: Props) {
  const clamped = Math.max(0, Math.min(100, percent));
  const r = size / 2;
  const cx = r;
  const cy = r;
  const radius = r - thickness / 2;

  // Verbleibender Anteil = 100% - clamped. Davon overdueRatio in rot.
  const remaining = 100 - clamped;
  const overdueShare = remaining * Math.max(0, Math.min(1, overdueRatio));
  const grayShare = remaining - overdueShare;

  // Drei Segmente: progress (grün-accent) → overdue (rot) → gray
  // Wir starten oben (12 Uhr = -90°) und gehen im Uhrzeigersinn.
  let cursor = -90;
  const segments: Array<{ key: string; pct: number; color: string }> = [];
  if (clamped > 0) {
    segments.push({ key: 'progress', pct: clamped, color: 'var(--color-status-done)' });
  }
  if (overdueShare > 0) {
    segments.push({ key: 'overdue', pct: overdueShare, color: 'var(--color-status-blocked)' });
  }
  if (grayShare > 0) {
    segments.push({ key: 'gray', pct: grayShare, color: 'var(--color-border)' });
  }

  // Wenn ALLES grau wäre (percent=0 + overdue=0), Mittel-Text anpassen
  if (segments.length === 0) {
    return (
      <svg width={size} height={size}>
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={thickness}
        />
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--color-ink-3)"
          fontSize="11"
        >
          keine Daten
        </text>
      </svg>
    );
  }

  return (
    <svg width={size} height={size}>
      {/* Background-Ring */}
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke="var(--color-border)"
        strokeWidth={thickness}
      />
      {/* Segmente */}
      {segments.length === 1 ? (
        // Edge-Case: 100% einer Farbe → Voller Kreis (SVG-Arc kann 360° nicht)
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={segments[0].color}
          strokeWidth={thickness}
        />
      ) : (
        segments.map((s) => {
          const sweep = (s.pct / 100) * 360;
          const startAngle = cursor;
          const endAngle = cursor + sweep;
          cursor += sweep;
          return (
            <path
              key={s.key}
              d={arcPath(cx, cy, radius, startAngle, endAngle)}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeLinecap="butt"
            />
          );
        })
      )}
      {/* Center-Text */}
      <text
        x={cx}
        y={cy - 6}
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--color-ink)"
        fontSize="22"
        fontWeight="700"
      >
        {Math.round(clamped)}%
      </text>
      <text
        x={cx}
        y={cy + 14}
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--color-ink-3)"
        fontSize="10"
        letterSpacing="0.06em"
        style={{ textTransform: 'uppercase' }}
      >
        FORTSCHRITT
      </text>
    </svg>
  );
}

function arcPath(
  cx: number,
  cy: number,
  r: number,
  startAngleDeg: number,
  endAngleDeg: number,
): string {
  const startRad = (startAngleDeg * Math.PI) / 180;
  const endRad = (endAngleDeg * Math.PI) / 180;
  const sx = cx + r * Math.cos(startRad);
  const sy = cy + r * Math.sin(startRad);
  const ex = cx + r * Math.cos(endRad);
  const ey = cy + r * Math.sin(endRad);
  const sweep = endAngleDeg - startAngleDeg;
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey}`;
}
