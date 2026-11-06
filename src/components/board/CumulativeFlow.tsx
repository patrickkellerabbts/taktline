'use client';

import { useMemo, useState } from 'react';
import { BOARD_COLUMNS, type BoardColumnId } from '@/lib/agile/board';
import type { FlowDay, WipLimits } from '@/lib/agile/flow-shared';

// Cumulative Flow Diagram: Karten pro Spalte über die Zeit, gestapelt von Done
// (unten) bis Offen (oben). Breiter werdende Bänder zeigen Stau, flache
// Done-Fläche zeigt, dass nichts fertig wird. Farben: eine Farbe, je weiter im
// Fluss, desto dunkler (ordinal, mit dem Palette-Validator geprüft).

const COLORS: Record<BoardColumnId, string> = {
  backlog: '#86b6ef',
  todo: '#5598e7',
  doing: '#2a78d6',
  review: '#1c5cab',
  done: '#104281',
};

// Von unten nach oben gestapelt.
const STACK: BoardColumnId[] = ['done', 'review', 'doing', 'todo', 'backlog'];

const W = 900;
const H = 300;
const PAD = { top: 12, right: 92, bottom: 26, left: 40 };

function label(id: BoardColumnId): string {
  return BOARD_COLUMNS.find((c) => c.id === id)?.title ?? id;
}

function fmtDate(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
}

export function CumulativeFlow({ days, wipLimits }: { days: FlowDay[]; wipLimits: WipLimits }) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = useMemo(() => days.map((d) => STACK.reduce((sum, id) => sum + d.counts[id], 0)), [days]);

  if (days.length < 2) {
    return (
      <div className="flow__empty">
        <b>Cumulative Flow Diagram</b>
        <p>
          Taktline hält ab jetzt jeden Tag fest, wie viele Karten in welcher Spalte liegen. Ab dem zweiten Tag entsteht hier
          das Diagramm. Breiter werdende Bänder zeigen Stau, eine flache Done-Fläche zeigt, dass nichts fertig wird.
        </p>
      </div>
    );
  }

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const max = Math.max(1, ...totals) * 1.05;
  const x = (i: number) => PAD.left + (innerW * i) / (days.length - 1);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

  // Für jede Schicht Unter- und Oberkante pro Tag.
  const layers = STACK.map((id, layer) => {
    const lower = days.map((d) => STACK.slice(0, layer).reduce((sum, s) => sum + d.counts[s], 0));
    const upper = days.map((d, i) => lower[i] + d.counts[id]);
    const top = upper.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const bottom = lower
      .map((v, i) => [i, v] as const)
      .reverse()
      .map(([i, v]) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`)
      .join(' ');
    return { id, d: `${top} ${bottom} Z`, lastMid: (lower.at(-1)! + upper.at(-1)!) / 2, lastSize: days.at(-1)!.counts[id] };
  });

  const last = days.at(-1)!;
  const shown = hover === null ? last : days[hover];
  const wip = (shown.counts.doing ?? 0) + (shown.counts.review ?? 0);
  const ticks = [0, Math.floor((days.length - 1) / 2), days.length - 1];

  return (
    <div className="flow">
      <div className="flow__hd">
        <span className="flow__title">Cumulative Flow</span>
        <span className="flow__sub">Karten pro Spalte, letzte {days.length} Tage</span>
        <div style={{ flex: 1 }} />
        <span className="flow__kpi">
          In Arbeit + Review am {fmtDate(shown.date)}: <b className="mono tabnum">{wip}</b>
          {wipLimits.doing || wipLimits.review ? (
            <span className="flow__muted"> (Limit {(wipLimits.doing ?? 0) + (wipLimits.review ?? 0) || '–'})</span>
          ) : null}
        </span>
      </div>
      <div className="flow__body">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="flow__svg"
          role="img"
          aria-label={`Cumulative Flow über ${days.length} Tage. Heute: ${STACK.map((id) => `${label(id)} ${last.counts[id]}`).join(', ')}`}
          onMouseLeave={() => setHover(null)}
        >
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y((max / 1.05) * f)} y2={y((max / 1.05) * f)} className="flow__grid" />
              <text x={PAD.left - 6} y={y((max / 1.05) * f) + 3} textAnchor="end" className="flow__tick">
                {Math.round((max / 1.05) * f)}
              </text>
            </g>
          ))}
          {layers.map((l) => (
            // 2px Flächen-Abstand zwischen den Bändern über die Kontur in Oberflächenfarbe.
            <path key={l.id} d={l.d} fill={COLORS[l.id]} stroke="var(--color-surface)" strokeWidth={1.5} strokeLinejoin="round" />
          ))}
          {layers.map(
            (l) =>
              l.lastSize > 0 && (
                <text key={`l-${l.id}`} x={W - PAD.right + 8} y={y(l.lastMid) + 4} className="flow__label">
                  {label(l.id)} {l.lastSize}
                </text>
              ),
          )}
          {ticks.map((i) => (
            <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'} className="flow__tick">
              {fmtDate(days[i].date)}
            </text>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} className="flow__cross" />}
          {days.map((d, i) => (
            <rect
              key={d.date}
              x={x(i) - innerW / (days.length - 1) / 2}
              y={PAD.top}
              width={innerW / (days.length - 1)}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>
        <table className="flow__table">
          <caption>{hover === null ? 'Heute' : fmtDate(shown.date)}</caption>
          <tbody>
            {[...STACK].reverse().map((id) => (
              <tr key={id}>
                <td>
                  <i style={{ background: COLORS[id] }} />
                  {label(id)}
                </td>
                <td className="mono tabnum">{shown.counts[id]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flow__help">
        So liest man es: Der Abstand zwischen zwei Bandgrenzen ist die Menge in Arbeit, der waagrechte Abstand ungefähr die
        Durchlaufzeit. Wird das Band „In Arbeit“ immer breiter, fängt das Team mehr an, als es fertig macht. Genau dagegen
        helfen die WIP-Limits in den Spaltenköpfen.
      </p>
    </div>
  );
}
