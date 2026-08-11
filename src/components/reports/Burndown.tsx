'use client';

// Burndown: Restbestand offener Arbeitspakete über die Zeit, dreimal —
// eingefrorene Baseline, aktueller Plan, tatsächliche Abschlüsse.
//
// Farbwahl: die Ist-Linie trägt als einzige den Akzent, die beiden Plan-Linien
// sind Referenz und treten in Grautönen zurück (die hellere zusätzlich
// gestrichelt). Alle drei sind ausserdem am Linienende beschriftet, Identität
// hängt also nicht an der Farbe allein.
//
// Bewusst client-seitig: der Fadenkreuz-Tooltip ist bei drei übereinander
// laufenden Linien der einzige Weg, an einem bestimmten Datum abzulesen, wie
// weit Plan und Ist auseinanderliegen.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { BurndownPoint } from '@/lib/reports';

type Props = {
  points: BurndownPoint[];
  /** Anzahl Pakete, deren Abschlusszeitpunkt geschätzt ist (kein closed_at). */
  estimated?: number;
};

// Feste Höhe, gemessene Breite. Eine viewBox mit width="100%" würde die Höhe
// mitskalieren — bei 1374px Breite wären das 427px Chart, und die Karte
// sprengte jede Zeile neben sich.
const CHART_H = 200;
const FALLBACK_W = 900;
const PAD = { top: 16, right: 116, bottom: 30, left: 40 };
const BOX_PAD_X = 14;

const SERIES = [
  { key: 'actual', label: 'Ist', color: 'var(--color-accent)', dash: undefined },
  { key: 'planCurrent', label: 'Plan', color: 'var(--color-ink-2)', dash: undefined },
  { key: 'planBaseline', label: 'Baseline', color: 'var(--color-ink-4)', dash: '5 4' },
] as const;

export function Burndown({ points, estimated = 0 }: Props) {
  const clipId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [width, setWidth] = useState(FALLBACK_W);

  // Breite messen statt skalieren: so bleiben Schrift und Linienstärken
  // unabhängig von der Kartenbreite gleich gross.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const model = useMemo(() => buildModel(points, width), [points, width]);

  if (!model) {
    return (
      <div style={{ padding: '16px 14px', fontSize: 12, color: 'var(--color-ink-3)', fontStyle: 'italic' }}>
        Keine Arbeitspakete mit Terminen — nichts zu zeichnen.
      </div>
    );
  }

  const { xs, plotW, plotH, yScale, yTicks, xTicks, todayX, lines, ends } = model;

  // Pointer → nächstgelegener Stützpunkt. 1:1, weil SVG-Koordinaten hier
  // Pixel sind.
  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const vx = e.clientX - rect.left;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < xs.length; i++) {
      const d = Math.abs(xs[i] - vx);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    setHoverIndex(best);
  }

  const hovered = hoverIndex != null ? points[hoverIndex] : null;

  return (
    <div ref={boxRef} style={{ position: 'relative', padding: `10px ${BOX_PAD_X}px 4px` }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${CHART_H}`}
        width={width}
        height={CHART_H}
        role="img"
        aria-label={`Burndown: ${points.length} Stichtage von ${points[0].date} bis ${points[points.length - 1].date}`}
        style={{ display: 'block', overflow: 'visible', touchAction: 'none' }}
        onPointerMove={onMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
          </clipPath>
        </defs>

        {/* Gridlines: hairline, durchgezogen, zurücktretend */}
        {yTicks.map((t) => {
          const y = yScale(t);
          return (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={y}
                y2={y}
                stroke={t === 0 ? 'var(--color-border-2)' : 'var(--color-border)'}
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y + 4}
                textAnchor="end"
                fontSize={11}
                fill="var(--color-ink-3)"
                className="mono"
              >
                {t}
              </text>
            </g>
          );
        })}

        {/* X-Achse: Monatswechsel */}
        {xTicks.map((t) => (
          <text
            key={t.x}
            x={t.x}
            y={CHART_H - PAD.bottom + 18}
            textAnchor="middle"
            fontSize={11}
            fill="var(--color-ink-3)"
            className="mono"
          >
            {t.label}
          </text>
        ))}

        {/* Heute */}
        {todayX != null && (
          <g>
            <line
              x1={todayX}
              x2={todayX}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--color-border-3)"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
            <text x={todayX} y={PAD.top - 5} textAnchor="middle" fontSize={10} fill="var(--color-ink-3)">
              heute
            </text>
          </g>
        )}

        {/* Linien — Ist zuletzt, damit sie oben liegt */}
        <g clipPath={`url(#${clipId})`} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round">
          {[...SERIES].reverse().map((s) => (
            <path key={s.key} d={lines[s.key]} stroke={s.color} strokeDasharray={s.dash} />
          ))}
        </g>

        {/* Endpunkte mit Surface-Ring + Direktbeschriftung */}
        {SERIES.map((s) => {
          const end = ends[s.key];
          if (!end) return null;
          return (
            <g key={s.key}>
              <circle cx={end.x} cy={end.y} r={4} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />
              <text
                x={end.x + 10}
                y={end.labelY + 4}
                fontSize={12}
                fontWeight={600}
                fill="var(--color-ink-2)"
              >
                {s.label}
                <tspan fill="var(--color-ink-3)" fontWeight={400}>
                  {' '}
                  {end.value}
                </tspan>
              </text>
            </g>
          );
        })}

        {/* Fadenkreuz */}
        {hoverIndex != null && (
          <line
            x1={xs[hoverIndex]}
            x2={xs[hoverIndex]}
            y1={PAD.top}
            y2={PAD.top + plotH}
            stroke="var(--color-ink-4)"
            strokeWidth={1}
          />
        )}
        {hoverIndex != null &&
          SERIES.map((s) => {
            const v = points[hoverIndex][s.key];
            if (v == null) return null;
            return (
              <circle
                key={s.key}
                cx={xs[hoverIndex]}
                cy={yScale(v)}
                r={4}
                fill={s.color}
                stroke="var(--color-surface)"
                strokeWidth={2}
              />
            );
          })}
      </svg>

      {hovered && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            // + BOX_PAD_X: absolute Position zählt ab der Padding-Kante des
            // Containers, die SVG-Koordinate erst ab dem Padding dahinter.
            left: xs[hoverIndex!] + BOX_PAD_X,
            transform:
              xs[hoverIndex!] > width * 0.6 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
            pointerEvents: 'none',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-2)',
            borderRadius: 4,
            padding: '6px 8px',
            fontSize: 11,
            boxShadow: '0 2px 8px rgb(0 0 0 / 0.08)',
            whiteSpace: 'nowrap',
            zIndex: 1,
          }}
        >
          <div className="mono" style={{ color: 'var(--color-ink-3)', marginBottom: 3 }}>
            {formatDate(hovered.date)}
          </div>
          {SERIES.map((s) => {
            const v = hovered[s.key];
            return (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    width: 10,
                    height: 2,
                    background: s.color,
                    flexShrink: 0,
                    opacity: v == null ? 0.4 : 1,
                  }}
                />
                <span style={{ color: 'var(--color-ink-2)', flex: 1 }}>{s.label}</span>
                <span className="mono tabnum" style={{ color: 'var(--color-ink)', fontWeight: 600 }}>
                  {v ?? '—'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {estimated > 0 && (
        <div style={{ fontSize: 10, color: 'var(--color-ink-3)', paddingTop: 4 }}>
          {estimated} {estimated === 1 ? 'Paket hat' : 'Pakete haben'} kein Abschlussdatum aus
          GitLab — dort zählt der letzte Sync.
        </div>
      )}
    </div>
  );
}

// ─── Geometrie ──────────────────────────────────────────────────────────


type Model = {
  xs: number[];
  plotW: number;
  plotH: number;
  yScale: (v: number) => number;
  yTicks: number[];
  xTicks: Array<{ x: number; label: string }>;
  todayX: number | null;
  lines: Record<string, string>;
  ends: Record<string, { x: number; y: number; labelY: number; value: number } | null>;
};

function buildModel(points: BurndownPoint[], width: number): Model | null {
  if (points.length < 2) return null;

  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = CHART_H - PAD.top - PAD.bottom;

  const xs = points.map((_, i) => PAD.left + (i / (points.length - 1)) * plotW);

  const peak = Math.max(
    ...points.map((p) => Math.max(p.planBaseline, p.planCurrent, p.actual ?? 0)),
  );
  const { yMax, yTicks } = niceScale(peak);
  const yScale = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  const lines: Record<string, string> = {};
  const ends: Model['ends'] = {};
  for (const s of SERIES) {
    const seg: string[] = [];
    // Bewusst eine for-Schleife: in einem forEach-Callback verliert TypeScript
    // die Zuweisung an lastPoint und verengt es auf null.
    let lastPoint: { x: number; y: number; value: number } | null = null;
    for (let i = 0; i < points.length; i++) {
      const v = points[i][s.key];
      // Ist-Linie endet heute: Lücke statt erfundener Fortsetzung.
      if (v == null) continue;
      const x = xs[i];
      const y = yScale(v);
      seg.push(`${seg.length === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
      lastPoint = { x, y, value: v };
    }
    lines[s.key] = seg.join(' ');
    ends[s.key] = lastPoint ? { ...lastPoint, labelY: lastPoint.y } : null;
  }
  spreadLabels(ends, plotH);

  // X-Ticks bei Monatswechseln, plus immer der erste Stichtag
  const xTicks: Array<{ x: number; label: string }> = [];
  let lastMonth = '';
  points.forEach((p, i) => {
    const month = p.date.slice(0, 7);
    if (i === 0 || month !== lastMonth) {
      xTicks.push({ x: xs[i], label: formatDate(p.date) });
      lastMonth = month;
    }
  });

  // Heute = letzter Stichtag mit Ist-Wert
  let todayX: number | null = null;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].actual != null) {
      todayX = xs[i];
      break;
    }
  }

  return { xs, plotW, plotH, yScale, yTicks, xTicks, todayX, lines, ends };
}

/**
 * Endbeschriftungen auseinanderziehen, wenn die Linien dicht beieinander
 * auslaufen — überlappender Text ist schlimmer als eine leicht versetzte
 * Beschriftung.
 */
function spreadLabels(ends: Model["ends"], plotH: number): void {
  const present = SERIES.map((s) => ends[s.key])
    .filter((e): e is NonNullable<Model['ends'][string]> => e != null)
    .sort((a, b) => a.labelY - b.labelY);
  const MIN_GAP = 15;
  for (let i = 1; i < present.length; i++) {
    const gap = present[i].labelY - present[i - 1].labelY;
    if (gap < MIN_GAP) present[i].labelY = present[i - 1].labelY + MIN_GAP;
  }
  // Wenn der Stapel unten aus dem Plot läuft, von unten her zurückschieben.
  const bottom = PAD.top + plotH;
  const overflow = present.length > 0 ? present[present.length - 1].labelY - bottom : 0;
  if (overflow > 0) {
    for (const e of present) e.labelY -= overflow;
  }
}

/**
 * Achsenskala mit ganzzahligen, runden Schritten (1/2/5 × Zehnerpotenz).
 * Ohne das kommen bei 27 Paketen Beschriftungen wie 8 / 15 / 23 heraus —
 * rechnerisch richtig und trotzdem unlesbar.
 */
function niceScale(peak: number): { yMax: number; yTicks: number[] } {
  const target = Math.max(1, peak);
  const raw = target / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const yMax = Math.ceil(target / step) * step;
  const yTicks: number[] = [];
  for (let t = 0; t <= yMax + 1e-9; t += step) yTicks.push(Math.round(t));
  return { yMax, yTicks };
}

function formatDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}.${m}.`;
}
