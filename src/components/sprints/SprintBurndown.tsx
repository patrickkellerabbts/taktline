'use client';

import { useMemo, useState } from 'react';
import type { BoardCard } from '@/components/board/BoardView';
import type { SprintInfo } from '@/lib/agile/sprints';

// Sprint-Burndown: Was ist am Ende jedes Tages noch offen, gegen die Ideallinie.
// Gerechnet aus den Abschlusszeitpunkten in GitLab, deshalb ohne tägliche
// Schnappschüsse. Grenze: Der Umfang ist der heutige. Wer mitten im Sprint
// Tasks ergänzt oder neu schätzt, verschiebt die ganze Kurve.
//
// Drei Einheiten: Stunden (Task-Schätzungen), Tasks (Anzahl, braucht keine
// Schätzung) und Story Points. SP fallen erst, wenn die ganze Story fertig
// ist; Tasks und Stunden zeigen den Fortschritt innerhalb des Sprints.

type Unit = 'hours' | 'tasks' | 'points';

type Point = { date: string; remaining: number | null; ideal: number };

const W = 560;
const H = 150;
const PAD = { top: 12, right: 54, bottom: 22, left: 34 };

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function days(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < 120) {
    out.push(isoDay(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Offen am Ende des Tages `day`: nicht geschlossen oder erst danach. */
function openAt(closedAt: string | null, day: string): boolean {
  return closedAt === null || closedAt.slice(0, 10) > day;
}

function series(sprint: SprintInfo, cards: BoardCard[], unit: Unit, today: string): { points: Point[]; total: number } {
  const items =
    unit === 'hours'
      ? cards.flatMap((c) => c.tasks).map((t) => ({ size: (t.estimateSeconds ?? 0) / 3600, closedAt: t.closedAt }))
      : unit === 'tasks'
        ? cards.flatMap((c) => c.tasks).map((t) => ({ size: 1, closedAt: t.closedAt }))
        : cards.filter((c) => c.isStory).map((c) => ({ size: c.storyPoints ?? 0, closedAt: c.closedAt }));
  const total = items.reduce((sum, i) => sum + i.size, 0);
  const span = days(sprint.startDate, sprint.endDate);
  const last = Math.max(1, span.length - 1);
  return {
    total,
    points: span.map((date, i) => ({
      date,
      ideal: total - (total * i) / last,
      // Zukunft bleibt leer, sonst sähe der Plan wie ein Ergebnis aus.
      remaining: date > today ? null : items.reduce((sum, it) => sum + (openAt(it.closedAt, date) ? it.size : 0), 0),
    })),
  };
}

function fmt(n: number, unit: Unit): string {
  const v = Number.isInteger(n) ? String(n) : n.toFixed(1);
  if (unit === 'hours') return `${v} h`;
  if (unit === 'tasks') return `${v} ${n === 1 ? 'Task' : 'Tasks'}`;
  return `${v} SP`;
}

export function SprintBurndown({ sprint, cards }: { sprint: SprintInfo; cards: BoardCard[] }) {
  const tasks = cards.flatMap((c) => c.tasks);
  const hasTasks = tasks.length > 0;
  const hasHours = tasks.some((t) => t.estimateSeconds);
  const unestimated = tasks.filter((t) => !t.estimateSeconds).length;
  // Stunden nur, wenn alles geschätzt ist; sonst fehlt ein Teil der Arbeit in der Kurve.
  const [unit, setUnit] = useState<Unit>(hasHours && unestimated === 0 ? 'hours' : hasTasks ? 'tasks' : 'points');
  const [hover, setHover] = useState<number | null>(null);
  const today = isoDay(new Date());
  const { points, total } = useMemo(() => series(sprint, cards, unit, today), [sprint, cards, unit, today]);

  if (total === 0) {
    return (
      <p className="burndown__empty">
        Burndown erscheint, sobald die Stories im Sprint Story Points oder Tasks haben.
      </p>
    );
  }

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const max = total * 1.08;
  const x = (i: number) => PAD.left + (innerW * i) / Math.max(1, points.length - 1);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const actual = points.filter((p) => p.remaining !== null);
  const lastActual = actual.at(-1);
  const pathActual = actual.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.remaining as number).toFixed(1)}`).join(' ');
  const shown = hover === null ? null : points[hover];
  const behind = lastActual && lastActual.remaining !== null && lastActual.remaining > lastActual.ideal + total * 0.1;

  return (
    <div className="burndown">
      <div className="burndown__hd">
        <span className="burndown__title">Sprint-Burndown</span>
        {lastActual && (
          <span className="burndown__now mono tabnum">
            noch {fmt(lastActual.remaining as number, unit)} von {fmt(total, unit)}
          </span>
        )}
        {behind && <span className="chip chip--warn">hinter der Ideallinie</span>}
        {unit === 'hours' && unestimated > 0 && (
          <span className="chip" title="Diese Tasks zählen im Stunden-Burndown nicht mit. Die Ansicht „Tasks“ zählt sie.">
            {unestimated} ohne Schätzung
          </span>
        )}
        <div style={{ flex: 1 }} />
        <div className="seg" role="group" aria-label="Einheit">
          <button type="button" aria-pressed={unit === 'hours'} onClick={() => setUnit('hours')} disabled={!hasHours}>
            Stunden
          </button>
          <button type="button" aria-pressed={unit === 'tasks'} onClick={() => setUnit('tasks')} disabled={!hasTasks}>
            Tasks
          </button>
          <button type="button" aria-pressed={unit === 'points'} onClick={() => setUnit('points')}>
            Story Points
          </button>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="burndown__svg"
        role="img"
        aria-label={`Burndown ${sprint.name}: ${lastActual ? `noch ${fmt(lastActual.remaining as number, unit)}` : 'noch nicht begonnen'} von ${fmt(total, unit)}`}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(total * f)} y2={y(total * f)} className="burndown__grid" />
            <text x={PAD.left - 6} y={y(total * f) + 3} textAnchor="end" className="burndown__tick">
              {Math.round(total * f)}
            </text>
          </g>
        ))}
        <line x1={x(0)} y1={y(total)} x2={x(points.length - 1)} y2={y(0)} className="burndown__ideal" />
        <text x={x(points.length - 1) + 6} y={y(0) + 3} className="burndown__label">
          Ideal
        </text>
        {actual.length > 0 && <path d={pathActual} className="burndown__actual" />}
        {lastActual && (
          <>
            <circle cx={x(actual.length - 1)} cy={y(lastActual.remaining as number)} r={4} className="burndown__dot" />
            <text x={x(actual.length - 1) + 8} y={y(lastActual.remaining as number) + 4} className="burndown__label burndown__label--ist">
              Ist
            </text>
          </>
        )}
        {[0, points.length - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : 'end'} className="burndown__tick">
            {points[i].date.slice(8, 10)}.{points[i].date.slice(5, 7)}.
          </text>
        ))}
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} className="burndown__cross" />
        )}
        {points.map((p, i) => (
          <rect
            key={p.date}
            x={x(i) - innerW / Math.max(1, points.length - 1) / 2}
            y={PAD.top}
            width={innerW / Math.max(1, points.length - 1)}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      <div className="burndown__tip" aria-live="polite">
        {shown ? (
          <>
            <b>
              {shown.date.slice(8, 10)}.{shown.date.slice(5, 7)}.
            </b>{' '}
            {shown.remaining === null ? 'liegt in der Zukunft' : `offen ${fmt(shown.remaining, unit)}`} · Ideal {fmt(shown.ideal, unit)}
          </>
        ) : (
          'Über die Kurve fahren für einzelne Tage'
        )}
      </div>
    </div>
  );
}
