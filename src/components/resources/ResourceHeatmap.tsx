'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, X } from 'lucide-react';
import type {
  Contribution,
  ResourceUser,
  ResourceWeek,
  WeekKey,
} from '@/lib/resources';

// Serialisierte Variante (Server→Client). Map → Object, Date → string.
export type SerializedMatrix = {
  weeks: Array<{ key: string; isoYear: number; isoWeek: number; startDate: string }>;
  users: ResourceUser[];
  cells: Record<
    string,
    Record<
      string,
      {
        percent: number;
        contributions: Array<Omit<Contribution, 'startDate' | 'endDate'> & {
          startDate: string;
          endDate: string;
        }>;
      }
    >
  >;
};

type Cell = { percent: number; contributions: Contribution[] };
type Popover = { user: ResourceUser; week: ResourceWeek; cell: Cell };

const ROW_HEIGHT = 36;
const CELL_WIDTH = 56;
const NAME_COL_WIDTH = 220;
const HEADER_HEIGHT = 44;

export function ResourceHeatmap({ data }: { data: SerializedMatrix }) {
  // Server-Daten in interne Form deserialisieren
  const weeks: ResourceWeek[] = data.weeks.map((w) => ({
    ...w,
    startDate: new Date(w.startDate),
  }));
  const cells = new Map<number, Map<WeekKey, Cell>>();
  for (const [uidStr, weekObj] of Object.entries(data.cells)) {
    const m = new Map<WeekKey, Cell>();
    for (const [wk, cell] of Object.entries(weekObj)) {
      m.set(wk, {
        percent: cell.percent,
        contributions: cell.contributions.map((c) => ({
          ...c,
          startDate: new Date(c.startDate),
          endDate: new Date(c.endDate),
        })),
      });
    }
    cells.set(Number(uidStr), m);
  }

  const [popover, setPopover] = useState<Popover | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popover) return;
    function onMouseDown(e: MouseEvent) {
      if (!popRef.current?.contains(e.target as Node)) setPopover(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPopover(null);
    }
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [popover]);

  if (data.users.length === 0) {
    return <EmptyState />;
  }

  // Aktuelle KW finden (für Highlight)
  const now = new Date();
  const currentWeekIdx = weeks.findIndex((w) => {
    const end = new Date(w.startDate);
    end.setDate(end.getDate() + 6);
    return now >= w.startDate && now <= end;
  });

  // Min/Max der Issue-Counts ermitteln — Farbskala ist relativ zu den
  // tatsächlich vorkommenden Werten in dieser Sicht.
  let minCount = Infinity;
  let maxCount = 0;
  for (const m of cells.values()) {
    for (const c of m.values()) {
      const n = c.contributions.length;
      if (n > 0 && n < minCount) minCount = n;
      if (n > maxCount) maxCount = n;
    }
  }
  if (minCount === Infinity) minCount = 0;

  return (
    <div style={{ flex: 1, overflow: 'auto', position: 'relative', minHeight: 0 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `${NAME_COL_WIDTH}px repeat(${weeks.length}, ${CELL_WIDTH}px)`,
          fontSize: 11,
          width: 'max-content',
        }}
      >
        {/* Header-Row */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            left: 0,
            zIndex: 3,
            height: HEADER_HEIGHT,
            background: 'var(--color-surface-3)',
            borderBottom: '2px solid var(--color-border-2)',
            borderRight: '2px solid var(--color-border-2)',
            padding: '6px 12px',
            display: 'flex',
            alignItems: 'center',
            fontWeight: 600,
            color: 'var(--color-ink-2)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontSize: 10,
          }}
        >
          Person
        </div>
        {weeks.map((w, i) => (
          <div
            key={w.key}
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 2,
              height: HEADER_HEIGHT,
              background:
                i === currentWeekIdx ? 'var(--color-selected)' : 'var(--color-surface-3)',
              borderBottom: '2px solid var(--color-border-2)',
              borderRight: '1px solid var(--color-border)',
              padding: '4px 4px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              color: 'var(--color-ink-3)',
            }}
            title={`KW ${w.isoWeek} (${fmtWeekRange(w.startDate)})`}
          >
            <span className="mono" style={{ fontWeight: 600, color: 'var(--color-ink)' }}>
              {w.isoWeek}
            </span>
            <span style={{ fontSize: 9 }}>{fmtMonthShort(w.startDate)}</span>
          </div>
        ))}

        {/* Data-Rows */}
        {data.users.map((u, rowIdx) => {
          const rowBg = rowIdx % 2 === 0 ? 'var(--color-surface)' : 'var(--color-surface-2)';
          const userCells = cells.get(u.gitlabUserId) ?? new Map<WeekKey, Cell>();
          return (
            <UserRowFragment
              key={u.gitlabUserId}
              user={u}
              weeks={weeks}
              userCells={userCells}
              rowBg={rowBg}
              currentWeekIdx={currentWeekIdx}
              minCount={minCount}
              maxCount={maxCount}
              onCellClick={(w, c) => setPopover({ user: u, week: w, cell: c })}
            />
          );
        })}
      </div>

      {popover && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Auslastungs-Details"
          style={{
            position: 'fixed',
            top: '20vh',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'min(520px, 92vw)',
            maxHeight: '60vh',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--r-3)',
            boxShadow: 'var(--shadow-2)',
            zIndex: 80,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              borderBottom: '1px solid var(--color-border)',
              background: 'var(--color-surface-2)',
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                {popover.user.name} · KW {popover.week.isoWeek}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>
                <span className="mono" style={{ color: 'var(--color-ink)', fontWeight: 600 }}>
                  {popover.cell.contributions.length}
                </span>{' '}
                Aufgabe{popover.cell.contributions.length === 1 ? '' : 'n'}
                {' · '}
                <span className="mono">{fmtWeekRange(popover.week.startDate)}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPopover(null)}
              aria-label="Schließen"
              style={{
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: 'var(--color-ink-3)',
                padding: 4,
              }}
            >
              <X size={14} />
            </button>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {popover.cell.contributions.map((c) => (
              <Link
                key={c.workPackageId}
                href={`/projects/${c.projectId}/gantt?wp=${c.workPackageId}`}
                onClick={() => setPopover(null)}
                className="bell-row"
                style={{
                  textDecoration: 'none',
                  color: 'var(--color-ink)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--color-border)',
                  fontSize: 12,
                }}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    color: 'var(--color-ink-3)',
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  #{c.gitlabIssueIid}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.title}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--color-ink-3)' }}>
                    {c.projectName} · {fmtSpan(c.startDate, c.endDate)}
                  </div>
                </div>
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    flexShrink: 0,
                    marginTop: 1,
                    color: 'var(--color-ink-2)',
                  }}
                >
                  {c.percent}%
                </span>
                <ExternalLink
                  size={11}
                  style={{ color: 'var(--color-ink-4)', flexShrink: 0, marginTop: 3 }}
                />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UserRowFragment({
  user,
  weeks,
  userCells,
  rowBg,
  currentWeekIdx,
  minCount,
  maxCount,
  onCellClick,
}: {
  user: ResourceUser;
  weeks: ResourceWeek[];
  userCells: Map<WeekKey, Cell>;
  rowBg: string;
  currentWeekIdx: number;
  minCount: number;
  maxCount: number;
  onCellClick: (week: ResourceWeek, cell: Cell) => void;
}) {
  return (
    <>
      <div
        style={{
          position: 'sticky',
          left: 0,
          zIndex: 1,
          height: ROW_HEIGHT,
          background: rowBg,
          borderBottom: '1px solid var(--color-border)',
          borderRight: '2px solid var(--color-border-2)',
          padding: '0 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Avatar user={user} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--color-ink)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {user.name}
          </div>
          {user.username && (
            <div className="mono" style={{ fontSize: 10, color: 'var(--color-ink-3)' }}>
              @{user.username}
            </div>
          )}
        </div>
      </div>
      {weeks.map((w, i) => {
        const cell = userCells.get(w.key);
        const count = cell?.contributions.length ?? 0;
        const score = scoreOf(count, minCount, maxCount);
        return (
          <button
            key={w.key}
            type="button"
            onClick={() => cell && onCellClick(w, cell)}
            disabled={!cell}
            className="resource-cell"
            style={{
              height: ROW_HEIGHT,
              border: 'none',
              borderBottom: '1px solid var(--color-border)',
              borderRight: '1px solid var(--color-border)',
              background: count === 0
                ? i === currentWeekIdx
                  ? 'var(--color-selected)'
                  : 'transparent'
                : gradientColor(score),
              color: count === 0 ? 'var(--color-ink)' : textForScore(score),
              fontSize: 11,
              fontFamily: 'inherit',
              fontWeight: 600,
              cursor: cell ? 'pointer' : 'default',
              padding: 0,
              transition: 'filter .08s',
            }}
            title={
              cell
                ? `${count} Aufgabe${count === 1 ? '' : 'n'} in KW ${w.isoWeek}`
                : undefined
            }
          >
            {count > 0 ? count : ''}
          </button>
        );
      })}
    </>
  );
}

function Avatar({ user }: { user: ResourceUser }) {
  if (user.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- GitLab-Avatar-URL, kein next/image-Bedarf
      <img
        src={user.avatarUrl}
        alt=""
        width={24}
        height={24}
        style={{ borderRadius: '50%', flexShrink: 0 }}
      />
    );
  }
  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div
      style={{
        width: 24,
        height: 24,
        borderRadius: '50%',
        background: 'var(--color-surface-3)',
        color: 'var(--color-ink-2)',
        fontSize: 10,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 460, color: 'var(--color-ink-3)' }}>
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--color-ink)',
            marginBottom: 8,
          }}
        >
          Keine zugewiesenen Aufgaben
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.6 }}>
          Aufgaben in den nächsten Wochen haben keine Zuweisungen. Sobald in
          GitLab Assignees auf Issues gesetzt sind (oder explizite{' '}
          <span className="mono">allocations:</span> im{' '}
          <span className="mono">gantt-meta</span>-Block), erscheinen sie hier.
        </p>
        <p style={{ fontSize: 12, lineHeight: 1.6, marginTop: 16, color: 'var(--color-ink-3)' }}>
          Default: jeder Assignee zählt mit 100% während der Laufzeit des WPs.
          Mit einem expliziten Allocation-Block lässt sich das auf z.B. 50%
          feinjustieren:
        </p>
        <pre
          style={{
            marginTop: 12,
            padding: 10,
            background: 'var(--color-surface-3)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--r-2)',
            fontSize: 11,
            textAlign: 'left',
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-ink-2)',
            whiteSpace: 'pre-wrap',
          }}
        >{`<!-- gantt-meta:v1
allocations:
  - gitlab_user_id: 5
    percent: 50
-->`}</pre>
      </div>
    </div>
  );
}

// ─── Color-Scale (relativ zu Min/Max der sichtbaren Counts) ─────────────
// score ∈ [0, 1] — 0 = minimum count, 1 = maximum count.
// Wenn min === max (alle Zellen gleich): alle bekommen score 0.5 (gelb).
function scoreOf(count: number, min: number, max: number): number {
  if (count <= 0) return 0;
  if (max <= min) return 0.5;
  return (count - min) / (max - min);
}

// Drei-Stop-Gradient grün → gelb → rot via RGB-Interpolation.
//   0.0 → #86efac (grün-300)
//   0.5 → #fbbf24 (amber-400)
//   1.0 → #ef4444 (red-500)
function gradientColor(score: number): string {
  const stops = [
    { at: 0, r: 134, g: 239, b: 172 },
    { at: 0.5, r: 251, g: 191, b: 36 },
    { at: 1, r: 239, g: 68, b: 68 },
  ];
  const clamped = Math.max(0, Math.min(1, score));
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (clamped >= a.at && clamped <= b.at) {
      const t = (clamped - a.at) / (b.at - a.at);
      const r = Math.round(a.r + (b.r - a.r) * t);
      const g = Math.round(a.g + (b.g - a.g) * t);
      const bl = Math.round(a.b + (b.b - a.b) * t);
      return `rgb(${r}, ${g}, ${bl})`;
    }
  }
  return `rgb(${stops[stops.length - 1].r}, ${stops[stops.length - 1].g}, ${stops[stops.length - 1].b})`;
}

// Lesbarkeits-Schwarz/Weiß abhängig vom Score (dunkler Background → weiß).
function textForScore(score: number): string {
  return score > 0.7 ? '#fff' : '#1c1b18';
}

// ─── Date-Formatter ─────────────────────────────────────────────────────
function fmtWeekRange(start: Date): string {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return fmtSpan(start, end);
}

function fmtSpan(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `${fmt(start)}–${fmt(end)}`;
}

function fmtMonthShort(d: Date): string {
  return d.toLocaleDateString('de-DE', { month: 'short' });
}
