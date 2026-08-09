// Druck-spezifische Gantt-Ansicht — eigenständige, deklarative SVG-Komponente
// die so dimensioniert ist dass sie auf eine A3-Landscape-Seite passt.
//
// Auto-Skalierung-Strategie:
//   1. Wir wählen pxPerDay so, dass die Timeline exakt die verfügbare Breite
//      ausfüllt (Print-Width abzüglich Task-Liste).
//   2. Die intrinsische Höhe ergibt sich aus Task-Count × rowH. Wenn die
//      grösser ist als die A3-Höhe, skalieren wir per CSS `zoom` proportional
//      runter (Breite + Höhe gleichmässig kleiner).
//
// Das Ergebnis: Single Page, kein Scroll, alles sichtbar — wenn auch bei
// 200+ Tasks irgendwann nicht mehr lesbar. User-Verantwortung.

import { startOfDay, addDays, diffDays, isWeekend } from '@/lib/gantt/dates';
import type { GanttBar, GanttMilestone, GanttDependency } from './GanttView';

// A3 Landscape (420×297mm) bei 5mm Rand = 410×287mm.
// Bei 96 dpi: 410mm ≈ 1550px, 287mm ≈ 1085px.
const PRINT_WIDTH = 1550;
const PRINT_HEIGHT = 1085;

// Layout-Konstanten (px).
const LEFT_COL_WIDTH = 220;
const HEADER_HEIGHT = 50;
const DATE_AXIS_HEIGHT = 40;
const MILESTONE_ROW_HEIGHT = 22;
const MILESTONE_SIZE = 9;
// Zeilen-Höhe wird dynamisch berechnet: ideal 18px, schrumpft bei vielen
// Tasks runter bis minimal 7px damit alles auf eine Seite passt. Bar-Höhe
// und Schriftgrösse skalieren proportional mit.
const ROW_HEIGHT_IDEAL = 18;
const ROW_HEIGHT_MIN = 7;

type Props = {
  bars: GanttBar[];
  milestones: GanttMilestone[];
  dependencies: GanttDependency[];
  projectName: string;
};

export function GanttPrintView({ bars, milestones, dependencies, projectName }: Props) {
  // Bars hierarchisch sortieren — alle ausgeklappt, Children direkt unter
  // Parent. Wenn parentId auf einen nicht-existenten Bar verweist, behandeln
  // wir den Bar als Top-Level.
  const ordered = buildOrderedFlat(bars);

  // Range = min(start, milestoneDate) .. max(end, milestoneDate)
  const range = computeRange(bars, milestones);
  if (!range) {
    return (
      <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
        Keine Aufgaben oder Meilensteine vorhanden.
      </div>
    );
  }

  const milestoneRowCount = milestones.length > 0 ? 1 : 0;
  const milestoneOffsetY = milestoneRowCount > 0 ? MILESTONE_ROW_HEIGHT : 0;

  // Wieviel vertikalen Platz haben wir für die Task-Rows?
  const availableRowsHeight =
    PRINT_HEIGHT - HEADER_HEIGHT - DATE_AXIS_HEIGHT - milestoneOffsetY;

  // Row-Höhe dynamisch: ideal 18px; bei vielen Tasks runter bis Min, damit
  // alles vertikal passt. Bei wenig Tasks Cap nach oben — sonst werden
  // einzelne Zeilen riesig.
  const rowHeight = ordered.length > 0
    ? Math.max(
        ROW_HEIGHT_MIN,
        Math.min(ROW_HEIGHT_IDEAL, availableRowsHeight / ordered.length),
      )
    : ROW_HEIGHT_IDEAL;
  const barHeight = Math.max(3, rowHeight * 0.6);
  const barPadY = (rowHeight - barHeight) / 2;
  // Font-Size für Task-Titel: scaled mit rowHeight, aber begrenzt.
  const taskFontSize = Math.max(6, Math.min(10, rowHeight * 0.55));
  const taskIidFontSize = Math.max(5, Math.min(9, rowHeight * 0.5));

  const bodyHeight = milestoneOffsetY + ordered.length * rowHeight;

  const availableTimelineWidth = PRINT_WIDTH - LEFT_COL_WIDTH;
  const pxPerDay = availableTimelineWidth / range.totalDays;
  const timelineWidth = range.totalDays * pxPerDay;

  const today = startOfDay(new Date());
  const todayX =
    today >= range.start && today <= range.end
      ? diffDays(range.start, today) * pxPerDay
      : null;

  // Position-Lookup für Dependencies
  const posByBarId = new Map<string, { x: number; width: number; rowIdx: number }>();
  ordered.forEach(({ bar }, i) => {
    const x = diffDays(range.start, startOfDay(bar.start)) * pxPerDay;
    const w = Math.max(
      2,
      (diffDays(startOfDay(bar.start), startOfDay(bar.end)) + 1) * pxPerDay,
    );
    posByBarId.set(bar.id, { x, width: w, rowIdx: i });
  });

  const printDate = new Date().toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return (
    <div
      className="gantt-print-root"
      style={{
        width: PRINT_WIDTH,
        background: '#fff',
        color: '#1c1c1a',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif',
        fontSize: 11,
        lineHeight: 1.3,
      }}
    >
      {/* ── Header ───────────────────────────────────────── */}
      <div
        style={{
          height: HEADER_HEIGHT,
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          borderBottom: '1px solid #d6d3d1',
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>
            {projectName}
          </div>
          <div style={{ fontSize: 10, color: '#78716c', marginTop: 2 }}>
            Gantt-Übersicht · {ordered.length} Aufgabe{ordered.length === 1 ? '' : 'n'}
            {milestones.length > 0 ? ` · ${milestones.length} Meilenstein${milestones.length === 1 ? '' : 'e'}` : ''}
          </div>
        </div>
        <div style={{ fontSize: 10, color: '#78716c', textAlign: 'right' }}>
          <div>Stand: {printDate}</div>
          <div style={{ marginTop: 2 }}>
            {range.start.toLocaleDateString('de-DE')} – {range.end.toLocaleDateString('de-DE')}
          </div>
        </div>
      </div>

      {/* ── Date-Axis-Header + Task-Liste-Header ───────────────── */}
      <div style={{ display: 'flex', height: DATE_AXIS_HEIGHT }}>
        <div
          style={{
            width: LEFT_COL_WIDTH,
            borderRight: '1px solid #d6d3d1',
            borderBottom: '1px solid #d6d3d1',
            background: '#fafaf9',
            display: 'flex',
            alignItems: 'center',
            padding: '0 10px',
            fontSize: 9,
            fontWeight: 600,
            color: '#57534e',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Aufgabe
        </div>
        <div style={{ width: timelineWidth, borderBottom: '1px solid #d6d3d1' }}>
          <PrintDateAxis range={range} pxPerDay={pxPerDay} width={timelineWidth} />
        </div>
      </div>

      {/* ── Body: Liste + Timeline ─────────────────────────── */}
      <div style={{ display: 'flex' }}>
        {/* Linke Spalte */}
        <div
          style={{
            width: LEFT_COL_WIDTH,
            borderRight: '1px solid #d6d3d1',
            background: '#fff',
          }}
        >
          {milestoneRowCount > 0 && (
            <div
              style={{
                height: MILESTONE_ROW_HEIGHT,
                padding: '0 10px',
                display: 'flex',
                alignItems: 'center',
                fontSize: 9,
                color: '#a16207',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                borderBottom: '1px solid #f5f5f4',
              }}
            >
              Meilensteine
            </div>
          )}
          {ordered.map(({ bar, depth }) => (
            <div
              key={bar.id}
              style={{
                height: rowHeight,
                padding: '0 6px',
                paddingLeft: 10 + depth * 12,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                borderBottom: '1px solid #f5f5f4',
                overflow: 'hidden',
              }}
            >
              <span
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: taskIidFontSize,
                  color: '#78716c',
                  flexShrink: 0,
                  minWidth: 22,
                }}
              >
                #{bar.gitlabIssueIid}
              </span>
              <span
                style={{
                  fontSize: taskFontSize,
                  fontWeight: bar.isSummary ? 600 : 400,
                  color: bar.state === 'closed' ? '#78716c' : '#1c1c1a',
                  textDecoration: bar.state === 'closed' ? 'line-through' : undefined,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  flex: 1,
                  minWidth: 0,
                }}
                title={bar.text}
              >
                {bar.text}
              </span>
            </div>
          ))}
        </div>

        {/* Rechte Spalte: SVG-Timeline */}
        <svg
          width={timelineWidth}
          height={bodyHeight}
          style={{ display: 'block', background: '#fff' }}
        >
          <defs>
            <marker
              id="dep-arrow-print"
              markerWidth="6"
              markerHeight="6"
              refX="5"
              refY="3"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <polygon points="0 0, 6 3, 0 6" fill="#78716c" />
            </marker>
            {/* Clip-Paths damit Bar-Titel horizontal nicht über die Bar
                hinausragen. Vertikal aufs ganze Row-Feld erweitert damit
                Text mittig der Row positioniert werden kann (auch wenn die
                Bar selbst nur 60% der Row-Höhe ausmacht). */}
            {ordered.map(({ bar }, i) => {
              const pos = posByBarId.get(bar.id)!;
              const rowY = milestoneOffsetY + i * rowHeight;
              return (
                <clipPath key={`clip-${bar.id}`} id={`print-bar-clip-${bar.id}`}>
                  <rect
                    x={pos.x + 2}
                    y={rowY}
                    width={Math.max(0, pos.width - 4)}
                    height={rowHeight}
                  />
                </clipPath>
              );
            })}
          </defs>

          {/* Wochenend-Hintergrund (nur wenn pxPerDay gross genug — sonst
              wird's optisches Rauschen) */}
          {pxPerDay >= 4 && (
            <Weekends
              range={range}
              pxPerDay={pxPerDay}
              height={bodyHeight}
            />
          )}

          {/* Monat-Grid-Linien (vertikal) */}
          <MonthGridLines range={range} pxPerDay={pxPerDay} height={bodyHeight} />

          {/* Row-Trennlinien (horizontal) */}
          {Array.from({ length: ordered.length }).map((_, i) => (
            <line
              key={i}
              x1={0}
              x2={timelineWidth}
              y1={milestoneOffsetY + (i + 1) * rowHeight}
              y2={milestoneOffsetY + (i + 1) * rowHeight}
              stroke="#f5f5f4"
              strokeWidth={1}
            />
          ))}

          {/* Today-Line */}
          {todayX !== null && (
            <line
              x1={todayX}
              x2={todayX}
              y1={0}
              y2={bodyHeight}
              stroke="#dc2626"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
          )}

          {/* Milestones — nur Diamonds, ohne Labels.
              Bei der typischen Cluster-Dichte überlappen sich Labels auf A3
              total — die Position ist via x-Achse plus Task-Liste eindeutig
              genug. */}
          {milestoneRowCount > 0 &&
            milestones
              .filter((m) => m.date)
              .map((m) => {
                const x = diffDays(range.start, startOfDay(m.date!)) * pxPerDay;
                const y = MILESTONE_ROW_HEIGHT / 2;
                return (
                  <polygon
                    key={m.id}
                    points={`${x},${y - MILESTONE_SIZE / 2} ${x + MILESTONE_SIZE / 2},${y} ${x},${y + MILESTONE_SIZE / 2} ${x - MILESTONE_SIZE / 2},${y}`}
                    fill="#eab308"
                    stroke="#713f12"
                    strokeWidth={0.75}
                  >
                    <title>{m.text}</title>
                  </polygon>
                );
              })}

          {/* Dependencies (unter den Bars) */}
          {dependencies.map((dep) => {
            const pred = posByBarId.get(dep.predecessorId);
            const succ = posByBarId.get(dep.successorId);
            if (!pred || !succ) return null;
            return (
              <PrintDependencyArrow
                key={dep.id}
                type={dep.type}
                pred={pred}
                succ={succ}
                rowH={rowHeight}
                barH={barHeight}
                barPadY={barPadY}
                offsetY={milestoneOffsetY}
              />
            );
          })}

          {/* Bars */}
          {ordered.map(({ bar }, i) => {
            const pos = posByBarId.get(bar.id)!;
            const y = milestoneOffsetY + i * rowHeight + barPadY;
            const rowCenterY = milestoneOffsetY + i * rowHeight + rowHeight / 2;
            const colors = printBarColor(bar.state, bar.isSummary);
            const progressW = Math.max(0, Math.min(1, bar.progress)) * pos.width;
            // Font-Size relativ zur Row-Höhe damit Text auch bei kleinen
            // Bars (barHeight < 6) noch lesbar bleibt. Skaliert mit dem
            // verfügbaren vertikalen Platz.
            const labelFontSize = Math.max(5, Math.min(10, rowHeight * 0.6));
            // Inside-Label nur bei breiten Bars (sonst überschattet der
            // Text das Progress-Overlay). Bei schmalen Bars Text rechts
            // neben der Bar in dunkler Schrift.
            const textInside = pos.width >= 60;
            return (
              <g key={bar.id}>
                <rect
                  x={pos.x}
                  y={y}
                  width={pos.width}
                  height={barHeight}
                  rx={bar.isSummary ? 1 : 2}
                  ry={bar.isSummary ? 1 : 2}
                  fill={colors.fill}
                  stroke={colors.stroke}
                  strokeWidth={0.5}
                />
                {progressW > 0 && (
                  <rect
                    x={pos.x}
                    y={y}
                    width={progressW}
                    height={barHeight}
                    rx={bar.isSummary ? 1 : 2}
                    ry={bar.isSummary ? 1 : 2}
                    fill={colors.progress}
                  />
                )}
                {textInside ? (
                  <text
                    x={pos.x + 4}
                    y={rowCenterY}
                    dominantBaseline="central"
                    fontSize={labelFontSize}
                    fontWeight={500}
                    fill="#fff"
                    clipPath={`url(#print-bar-clip-${bar.id})`}
                  >
                    {bar.text}
                  </text>
                ) : (
                  // paint-order=stroke malt erst den weissen Stroke, dann den
                  // dunklen Fill obendrauf. Effekt: Weisser Halo um die
                  // Buchstaben, der Text bleibt auch über Pfeilen und anderen
                  // Bars klar lesbar — und braucht keinen rechteckigen
                  // Hintergrund der mit Wochenend-Schraffur kollidieren würde.
                  <text
                    x={pos.x + pos.width + 6}
                    y={rowCenterY}
                    dominantBaseline="central"
                    fontSize={labelFontSize}
                    fill="#44403c"
                    stroke="#fff"
                    strokeWidth={2.5}
                    paintOrder="stroke"
                    style={{ strokeLinejoin: 'round' }}
                  >
                    {bar.text}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ─── Hilfs-Komponenten ────────────────────────────────────────────────────

function PrintDateAxis({
  range,
  pxPerDay,
  width,
}: {
  range: { start: Date; end: Date; totalDays: number };
  pxPerDay: number;
  width: number;
}) {
  // Zwei-tier: oben Monate, unten Wochen-Nummern (oder Tage bei sehr grossem
  // pxPerDay).
  const months: Array<{ x: number; label: string }> = [];
  let cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
  while (cursor <= range.end) {
    const x = Math.max(0, diffDays(range.start, cursor) * pxPerDay);
    months.push({
      x,
      label: cursor.toLocaleDateString('de-DE', { month: 'short', year: 'numeric' }),
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  // Untere Zeile: Wochen-Ticks. Bei pxPerDay >= 10 Tages-Ticks, sonst
  // wöchentlich.
  const subTicks: Array<{ x: number; label: string }> = [];
  if (pxPerDay >= 10) {
    let d = startOfDay(range.start);
    while (d <= range.end) {
      const x = diffDays(range.start, d) * pxPerDay;
      subTicks.push({ x, label: String(d.getDate()) });
      d = addDays(d, 1);
    }
  } else {
    // Wochen — jeden Montag
    let d = startOfDay(range.start);
    while (d.getDay() !== 1) d = addDays(d, 1);
    while (d <= range.end) {
      const x = diffDays(range.start, d) * pxPerDay;
      subTicks.push({ x, label: `KW${isoWeek(d)}` });
      d = addDays(d, 7);
    }
  }

  return (
    <svg width={width} height={DATE_AXIS_HEIGHT} style={{ display: 'block' }}>
      {/* Monat-Zellen mit hellem Hintergrund */}
      {months.map((m, i) => {
        const nextX = i + 1 < months.length ? months[i + 1].x : width;
        return (
          <g key={m.x}>
            <rect
              x={m.x}
              y={0}
              width={nextX - m.x}
              height={DATE_AXIS_HEIGHT / 2}
              fill="#fafaf9"
              stroke="#e7e5e4"
              strokeWidth={0.5}
            />
            <text
              x={m.x + 4}
              y={14}
              fontSize={10}
              fontWeight={600}
              fill="#44403c"
            >
              {m.label}
            </text>
          </g>
        );
      })}
      {/* Sub-Ticks */}
      {subTicks.map((t) => (
        <g key={t.x}>
          <line
            x1={t.x}
            x2={t.x}
            y1={DATE_AXIS_HEIGHT / 2}
            y2={DATE_AXIS_HEIGHT}
            stroke="#e7e5e4"
            strokeWidth={0.5}
          />
          <text
            x={t.x + 2}
            y={DATE_AXIS_HEIGHT - 6}
            fontSize={8}
            fill="#78716c"
          >
            {t.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Weekends({
  range,
  pxPerDay,
  height,
}: {
  range: { start: Date; totalDays: number };
  pxPerDay: number;
  height: number;
}) {
  const rects: number[] = [];
  let cursor = startOfDay(range.start);
  for (let i = 0; i < range.totalDays; i++) {
    if (isWeekend(cursor)) rects.push(i * pxPerDay);
    cursor = addDays(cursor, 1);
  }
  return (
    <>
      {rects.map((x) => (
        <rect key={x} x={x} y={0} width={pxPerDay} height={height} fill="#f5f5f4" />
      ))}
    </>
  );
}

function MonthGridLines({
  range,
  pxPerDay,
  height,
}: {
  range: { start: Date; end: Date };
  pxPerDay: number;
  height: number;
}) {
  const lines: number[] = [];
  let cursor = new Date(range.start.getFullYear(), range.start.getMonth() + 1, 1);
  while (cursor <= range.end) {
    lines.push(diffDays(range.start, cursor) * pxPerDay);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return (
    <>
      {lines.map((x) => (
        <line
          key={x}
          x1={x}
          x2={x}
          y1={0}
          y2={height}
          stroke="#e7e5e4"
          strokeWidth={0.5}
        />
      ))}
    </>
  );
}

function PrintDependencyArrow({
  type,
  pred,
  succ,
  rowH,
  barH,
  barPadY,
  offsetY,
}: {
  type: 'FS' | 'SS' | 'FF' | 'SF';
  pred: { x: number; width: number; rowIdx: number };
  succ: { x: number; width: number; rowIdx: number };
  rowH: number;
  barH: number;
  barPadY: number;
  offsetY: number;
}) {
  const predLeft = pred.x;
  const predRight = pred.x + pred.width;
  const succLeft = succ.x;
  const succRight = succ.x + succ.width;
  const predMidY = offsetY + pred.rowIdx * rowH + barPadY + barH / 2;
  const succMidY = offsetY + succ.rowIdx * rowH + barPadY + barH / 2;

  let sx: number;
  let ex: number;
  let endDir: 1 | -1;
  switch (type) {
    case 'FS':
      sx = predRight;
      ex = succLeft;
      endDir = 1;
      break;
    case 'SS':
      sx = predLeft;
      ex = succLeft;
      endDir = 1;
      break;
    case 'FF':
      sx = predRight;
      ex = succRight;
      endDir = -1;
      break;
    case 'SF':
      sx = predLeft;
      ex = succRight;
      endDir = -1;
      break;
  }
  const startDir = sx === predRight ? 1 : -1;
  const stubLen = 6;
  const finalX = endDir === 1 ? ex - 3 : ex + 3;
  const forward =
    (endDir === 1 && finalX > sx + startDir * stubLen) ||
    (endDir === -1 && finalX < sx + startDir * stubLen);
  let d: string;
  if (forward) {
    d = `M ${sx} ${predMidY} L ${sx + startDir * stubLen} ${predMidY} L ${sx + startDir * stubLen} ${succMidY} L ${finalX} ${succMidY}`;
  } else {
    const detourY =
      predMidY < succMidY
        ? Math.max(predMidY, succMidY) + rowH / 2
        : Math.min(predMidY, succMidY) - rowH / 2;
    d = `M ${sx} ${predMidY} L ${sx + startDir * stubLen} ${predMidY} L ${sx + startDir * stubLen} ${detourY} L ${finalX - endDir * stubLen} ${detourY} L ${finalX - endDir * stubLen} ${succMidY} L ${finalX} ${succMidY}`;
  }
  return (
    <path
      d={d}
      stroke="#78716c"
      strokeWidth={0.75}
      fill="none"
      markerEnd="url(#dep-arrow-print)"
    />
  );
}

// ─── Helper ───────────────────────────────────────────────────────────────

function buildOrderedFlat(
  bars: GanttBar[],
): Array<{ bar: GanttBar; depth: number }> {
  const childrenByParent = new Map<string | null, GanttBar[]>();
  for (const bar of bars) {
    const arr = childrenByParent.get(bar.parentId) ?? [];
    arr.push(bar);
    childrenByParent.set(bar.parentId, arr);
  }
  const result: Array<{ bar: GanttBar; depth: number }> = [];
  function walk(parentId: string | null, depth: number) {
    const children = childrenByParent.get(parentId);
    if (!children) return;
    for (const bar of children) {
      result.push({ bar, depth });
      walk(bar.id, depth + 1);
    }
  }
  walk(null, 0);
  // Orphans (parent verweist auf nicht-vorhandenen Bar) — auf Top-Level
  // einsortieren damit nichts verloren geht.
  const seen = new Set(result.map((r) => r.bar.id));
  for (const bar of bars) {
    if (!seen.has(bar.id)) result.push({ bar, depth: 0 });
  }
  return result;
}

function computeRange(
  bars: GanttBar[],
  milestones: GanttMilestone[],
): { start: Date; end: Date; totalDays: number } | null {
  if (bars.length === 0 && milestones.length === 0) return null;
  const dates: number[] = [];
  for (const b of bars) {
    dates.push(b.start.getTime());
    dates.push(b.end.getTime());
  }
  for (const m of milestones) if (m.date) dates.push(m.date.getTime());
  if (dates.length === 0) return null;
  const start = addDays(startOfDay(new Date(Math.min(...dates))), -3);
  const end = addDays(startOfDay(new Date(Math.max(...dates))), 3);
  return { start, end, totalDays: diffDays(start, end) + 1 };
}

function printBarColor(
  state: string,
  isSummary: boolean,
): { fill: string; stroke: string; progress: string } {
  if (isSummary) {
    return { fill: '#44403c', stroke: '#1c1917', progress: '#1c1917' };
  }
  if (state === 'closed') {
    return { fill: '#86efac', stroke: '#16a34a', progress: '#15803d' };
  }
  return { fill: '#93c5fd', stroke: '#2563eb', progress: '#1d4ed8' };
}

function isoWeek(d: Date): number {
  const t = new Date(d);
  const dayNr = (d.getDay() + 6) % 7;
  t.setDate(t.getDate() - dayNr + 3);
  const firstThursday = t.valueOf();
  t.setMonth(0, 1);
  if (t.getDay() !== 4) t.setMonth(0, 1 + ((4 - t.getDay() + 7) % 7));
  return 1 + Math.ceil((firstThursday - t.valueOf()) / 604_800_000);
}
