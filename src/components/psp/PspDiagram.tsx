'use client';

import { forwardRef } from 'react';
import { rolledProgress, type PspNode } from '@/lib/psp';

// PSP als Baumdiagramm in der klassischen Form: Projekt oben, die erste Ebene
// (Teilprojekte) nebeneinander, alles darunter eingerückt untereinander. So
// bleibt der Plan auch mit vielen Arbeitspaketen lesbar und passt auf eine
// Berichtsseite. Reines SVG mit festen Farben, damit der Export ohne das
// Stylesheet der App gleich aussieht.

const PAD = 20;
const COL_W = 212;
const COL_GAP = 20;
const ROOT_W = 280;
const ROOT_H = 48;
const BOX_H = 60;
const ROW_GAP = 10;
const INDENT = 18;
const LEVEL1_Y = PAD + ROOT_H + 44;

const C = {
  ink: '#1c1b18',
  muted: '#76746c',
  line: '#b9b6ad',
  border: '#d9d7d1',
  surface: '#ffffff',
  rootFill: '#1c1b18',
  rootInk: '#ffffff',
  level1Fill: '#fff1e6',
  level1Stroke: '#f2b78f',
  doneFill: '#eef7f0',
  doneStroke: '#b9dcc3',
  track: '#ecebe7',
  progress: '#e8590c',
  progressDone: '#1a7f37',
  select: '#e8590c',
};

const FONT = 'Inter, ui-sans-serif, system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';

type Box = { node: PspNode; x: number; y: number; w: number; parentBox: Box | null };

export function layoutPsp(roots: PspNode[]) {
  const boxes: Box[] = [];
  let bottom = LEVEL1_Y + BOX_H;
  roots.forEach((root, col) => {
    const x = PAD + col * (COL_W + COL_GAP);
    const top: Box = { node: root, x, y: LEVEL1_Y, w: COL_W, parentBox: null };
    boxes.push(top);
    let y = LEVEL1_Y + BOX_H + ROW_GAP;
    const walk = (node: PspNode, parentBox: Box) => {
      for (const child of node.children) {
        const indent = child.depth * INDENT;
        const box: Box = { node: child, x: x + indent, y, w: COL_W - indent, parentBox };
        boxes.push(box);
        y += BOX_H + ROW_GAP;
        walk(child, box);
      }
    };
    walk(root, top);
    bottom = Math.max(bottom, y - ROW_GAP);
  });
  const columnsW = Math.max(roots.length, 1) * (COL_W + COL_GAP) - COL_GAP;
  const width = Math.max(columnsW, ROOT_W) + PAD * 2;
  return { boxes, width, height: bottom + PAD };
}

/** Bricht einen Titel grob nach Zeichenbreite um; höchstens zwei Zeilen. */
function wrap(text: string, width: number): string[] {
  const max = Math.max(8, Math.floor((width - 20) / 6.4));
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= max) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === 2) break;
  }
  if (lines.length < 2 && line) lines.push(line);
  const out = lines.slice(0, 2);
  const used = out.join(' ').length;
  if (used < text.length) {
    const last = out[out.length - 1] ?? '';
    out[out.length - 1] = `${last.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  }
  return out.map((l) => (l.length > max ? `${l.slice(0, max - 1)}…` : l));
}

type Props = {
  roots: PspNode[];
  projectName: string;
  selectedIid: number | null;
  onSelect?: (iid: number) => void;
};

export const PspDiagram = forwardRef<SVGSVGElement, Props>(function PspDiagram(
  { roots, projectName, selectedIid, onSelect },
  ref,
) {
  const { boxes, width, height } = layoutPsp(roots);
  const rootX = width / 2 - ROOT_W / 2;
  const busY = PAD + ROOT_H + 22;
  const level1 = boxes.filter((b) => b.parentBox === null);

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Projektstrukturplan ${projectName}`}
      style={{ fontFamily: FONT, display: 'block' }}
    >
      <rect x={0} y={0} width={width} height={height} fill={C.surface} />

      {/* Verbindungen: Projekt → erste Ebene über eine Sammelschiene. */}
      {level1.length > 0 && (
        <g stroke={C.line} strokeWidth={1.2} fill="none">
          <line x1={width / 2} y1={PAD + ROOT_H} x2={width / 2} y2={busY} />
          <line
            x1={Math.min(level1[0].x + COL_W / 2, width / 2)}
            y1={busY}
            x2={Math.max(level1[level1.length - 1].x + COL_W / 2, width / 2)}
            y2={busY}
          />
          {level1.map((b) => (
            <line key={b.node.iid} x1={b.x + COL_W / 2} y1={busY} x2={b.x + COL_W / 2} y2={b.y} />
          ))}
        </g>
      )}
      {/* Darunter: senkrecht vom Elternkasten, waagrecht zum Kind. */}
      <g stroke={C.line} strokeWidth={1.2} fill="none">
        {boxes
          .filter((b) => b.parentBox)
          .map((b) => {
            const p = b.parentBox!;
            const lx = p.x + 9;
            return <path key={b.node.iid} d={`M${lx},${p.y + BOX_H} V${b.y + BOX_H / 2} H${b.x}`} />;
          })}
      </g>

      <g>
        <rect x={rootX} y={PAD} width={ROOT_W} height={ROOT_H} rx={6} fill={C.rootFill} />
        <text x={width / 2} y={PAD + 19} textAnchor="middle" fontSize={10} fill="#bdbab1" fontFamily={MONO}>
          0 · PROJEKT
        </text>
        <text x={width / 2} y={PAD + 36} textAnchor="middle" fontSize={13} fontWeight={600} fill={C.rootInk}>
          {projectName.length > 38 ? `${projectName.slice(0, 37)}…` : projectName}
        </text>
      </g>

      {boxes.map((b) => {
        const n = b.node;
        const done = n.state === 'closed';
        const isLevel1 = b.parentBox === null;
        const progress = rolledProgress(n);
        const selected = selectedIid === n.iid;
        const lines = wrap(n.title, b.w);
        return (
          <g
            key={n.iid}
            data-iid={n.iid}
            onClick={onSelect ? () => onSelect(n.iid) : undefined}
            style={onSelect ? { cursor: 'pointer' } : undefined}
          >
            <title>{`${n.code} ${n.title} (#${n.iid})${n.start ? `, ${n.start} – ${n.end}` : ''}`}</title>
            <rect
              x={b.x + 0.5}
              y={b.y + 0.5}
              width={b.w - 1}
              height={BOX_H - 1}
              rx={5}
              fill={done ? C.doneFill : isLevel1 ? C.level1Fill : C.surface}
              stroke={selected ? C.select : done ? C.doneStroke : isLevel1 ? C.level1Stroke : C.border}
              strokeWidth={selected ? 2 : 1}
            />
            <text x={b.x + 10} y={b.y + 16} fontSize={10} fill={C.muted} fontFamily={MONO}>
              {n.code}
              <tspan dx={6}>#{n.iid}</tspan>
              {n.story && <tspan dx={6}>Story</tspan>}
              {done && <tspan dx={6} fill={C.progressDone}>✓</tspan>}
            </text>
            {lines.map((line, i) => (
              <text
                key={i}
                x={b.x + 10}
                y={b.y + 32 + i * 14}
                fontSize={12}
                fontWeight={n.children.length > 0 || isLevel1 ? 600 : 400}
                fill={C.ink}
              >
                {line}
              </text>
            ))}
            <rect x={b.x + 10} y={b.y + BOX_H - 8} width={b.w - 20} height={3} rx={1.5} fill={C.track} />
            {progress > 0 && (
              <rect
                x={b.x + 10}
                y={b.y + BOX_H - 8}
                width={((b.w - 20) * progress) / 100}
                height={3}
                rx={1.5}
                fill={done ? C.progressDone : C.progress}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
});
