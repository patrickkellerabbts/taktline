'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Target,
  ChevronDown,
  ChevronRight,
  Indent,
  Outdent,
  Link as LinkIcon,
  AlertTriangle,
  Calendar,
  GitCompareArrows,
  Layers,
  Search,
  PanelRight,
  Diamond,
  MoreHorizontal,
  Minus,
  Plus,
  RotateCcw,
  Crosshair,
} from 'lucide-react';
import { Inspector } from './Inspector';
import { MilestoneInspector, type MilestoneForInspector } from './MilestoneInspector';
import { AssigneeAvatars } from './AssigneeAvatars';
import { updateWorkPackageAction } from '@/app/projects/[id]/gantt/actions';
import { computeCriticalPath } from '@/lib/gantt/critical-path';
import { findDependencyConflicts } from '@/lib/gantt/dependency-validation';
import { savePreferencesAction } from '@/lib/preferences-actions';
import { useMediaQuery, BP } from '@/lib/hooks/useMediaQuery';
import { startOfDay, addDays, diffDays, isWeekend } from '@/lib/gantt/dates';
import {
  PINCH_SENSITIVITY_DEFAULT,
  PINCH_SMOOTHING_DEFAULT,
  PINCH_LOCK_MS_DEFAULT,
} from '@/lib/preferences';
import { GanttPrintView } from './GanttPrintView';

// ─── Datenmodell ────────────────────────────────────────────────────────────

export type GanttLabel = {
  name: string;
  color?: string;
};

export type GanttAssignee = {
  id: number;
  username: string;
  name: string;
  avatarUrl?: string;
};

export type GanttBar = {
  id: string;
  text: string;
  gitlabIssueIid: number;
  start: Date;
  end: Date;
  progress: number; // 0–1
  state: 'opened' | 'closed' | string;
  isSummary: boolean;
  parentId: string | null;
  // Optionale Referenz auf den zugeordneten Meilenstein (unsere Milestone.id).
  // Beim Sync aus dem GitLab-Issue.milestone aufgelöst.
  milestoneId?: string | null;
  labels?: GanttLabel[];
  assignees?: GanttAssignee[];
  // Baseline (eingefrorener Plan-Stand) für Plan-vs-Ist-Vergleich.
  // Beide müssen gesetzt sein damit eine Baseline-Bar gerendert wird.
  baselineStart?: Date | null;
  baselineEnd?: Date | null;
  // Cached Merge Requests + Pipeline-Status (vom Sync gefüllt).
  mergeRequests?: GanttMergeRequest[];
};

export type GanttMergeRequest = {
  iid: number;
  title: string;
  state: string;
  sourceBranch: string | null;
  targetBranch: string | null;
  webUrl: string;
  authorName: string | null;
  authorAvatarUrl: string | null;
  pipeline: { id: number; status: string; webUrl: string } | null;
  lastSyncedAt: Date;
};

// Berechnet die sichtbare Reihenfolge der Bars als geordnete Liste
// mit Tiefen-Info, unter Beachtung von collapsed-Parents.
function buildVisibleTree(
  bars: GanttBar[],
  collapsed: Set<string>,
): Array<{ bar: GanttBar; depth: number; hasChildren: boolean }> {
  const childrenByParent = new Map<string | null, GanttBar[]>();
  for (const bar of bars) {
    const arr = childrenByParent.get(bar.parentId) ?? [];
    arr.push(bar);
    childrenByParent.set(bar.parentId, arr);
  }
  const result: Array<{ bar: GanttBar; depth: number; hasChildren: boolean }> = [];
  function walk(parentId: string | null, depth: number) {
    const children = childrenByParent.get(parentId);
    if (!children) return;
    for (const bar of children) {
      const hasChildren = childrenByParent.has(bar.id);
      result.push({ bar, depth, hasChildren });
      if (hasChildren && !collapsed.has(bar.id)) {
        walk(bar.id, depth + 1);
      }
    }
  }
  walk(null, 0);
  // Orphans: Bars whose parentId verweist auf einen nicht-vorhandenen Bar.
  // Können auftreten wenn Filter aktiv ist. Diese rendern wir auf Ebene 0.
  const seen = new Set(result.map((r) => r.bar.id));
  for (const bar of bars) {
    if (!seen.has(bar.id)) {
      const hasChildren = childrenByParent.has(bar.id);
      result.push({ bar, depth: 0, hasChildren });
    }
  }
  return result;
}

export type GanttMilestone = {
  id: string;
  text: string;
  gitlabMilestoneId: number;
  date: Date | null;
  description?: string | null;
  state?: string;
  isGroupMilestone?: boolean;
};

export type GanttDependency = {
  id: string;
  predecessorId: string;
  successorId: string;
  type: 'FS' | 'SS' | 'FF' | 'SF';
  lagDays: number;
};

type Props = {
  bars: GanttBar[];
  milestones: GanttMilestone[];
  dependencies?: GanttDependency[];
  // Vollständige Project-Label-Palette aus dem Cache (auch ungenutzte).
  // Wird im Inspector mit den aus-bars-aggregierten Labels gemerged.
  projectLabels?: GanttLabel[];
  gitlabBaseUrl?: string;
  gitlabProjectPath?: string;
  projectInternalId: string;
  // Optionale WP-ID die beim Mount vorausgewählt wird — z.B. wenn der User
  // aus einem Notification-Link oder der Resource-View kommt mit ?wp=<id>
  initialSelectedId?: string;
  // Analoge Variante für Meilensteine via ?ms=<id>
  initialSelectedMilestoneId?: string;
  // Display-Settings aus URL + User-Preferences (page.tsx merged beides).
  // undefined heißt "nicht gesetzt → Default".
  initialDisplay?: {
    showDeps?: boolean;
    showCrit?: boolean;
    showWeekends?: boolean;
    showBaseline?: boolean;
    density?: Density;
    zoom?: Zoom;
    filter?: StatusFilter;
    leftColWidth?: number;
    inspectorWidth?: number;
    leftListCollapsed?: boolean;
    closeInspectorOnEmptyClick?: boolean;
    pinchSensitivity?: number;
    pinchSmoothing?: number;
    pinchLockMs?: number;
  };
};

// ─── Zoom-Stufen ────────────────────────────────────────────────────────────

type Zoom = 'day' | 'week' | 'month' | 'quarter';
const ZOOMS: Record<Zoom, { pxPerDay: number; label: string }> = {
  day: { pxPerDay: 32, label: 'Tag' },
  week: { pxPerDay: 9, label: 'Woche' },
  month: { pxPerDay: 2.6, label: 'Monat' },
  quarter: { pxPerDay: 0.9, label: 'Quartal' },
};

type StatusFilter = 'all' | 'open' | 'done';
type Density = 'comfort' | 'compact';

const HEADER_HEIGHT = 40;
const PADDING_DAYS = 7;
const MILESTONE_SIZE = 12;

// ─── Hilfsfunktionen ────────────────────────────────────────────────────────

function fmtDateShort(d: Date): string {
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function fmtMonth(d: Date): string {
  return d.toLocaleDateString('de-DE', { month: 'short', year: 'numeric' });
}

function fmtMonthFull(d: Date): string {
  return d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
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

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// ─── Komponente ─────────────────────────────────────────────────────────────

const DEFAULT_LEFT_COL_WIDTH = 540;
const MIN_LEFT_COL_WIDTH = 280;
const MAX_LEFT_COL_WIDTH = 900;
const DEFAULT_INSPECTOR_WIDTH = 340;
const MIN_INSPECTOR_WIDTH = 240;
const MAX_INSPECTOR_WIDTH = 900;

// Breakpoints für die responsive Spalten in der linken Liste.
const COL_SHOW_DAUER_MIN = 440;
const COL_SHOW_START_MIN = 360;
const COL_LABELS_AS_DOTS_MAX = 550;

// Liefert das gridTemplateColumns + die Sichtbarkeits-Flags für eine
// gegebene Listen-Breite. Verändert sich kontinuierlich beim Drag des
// Splitters.
function leftColLayout(width: number): {
  template: string;
  showDauer: boolean;
  showStart: boolean;
  labelsAsDots: boolean;
} {
  const showDauer = width >= COL_SHOW_DAUER_MIN;
  const showStart = width >= COL_SHOW_START_MIN;
  const labelsAsDots = width < COL_LABELS_AS_DOTS_MAX;
  // Spalten: chevron-platzhalter (28) | ID (40) | AUFGABE (1fr)
  //          | DAUER (56)? | START (78)? | ENDE (78) | ZUST. (48)
  const cols = ['28px', '40px', '1fr'];
  if (showDauer) cols.push('56px');
  if (showStart) cols.push('78px');
  cols.push('78px', '48px');
  return { template: cols.join(' '), showDauer, showStart, labelsAsDots };
}

type DragState = {
  id: string;
  mode: 'move' | 'left' | 'right';
  startClientX: number;
  deltaDays: number;
  origStart: Date;
  origEnd: Date;
};

type PickerMode =
  | { kind: 'parent'; sourceId: string }
  | { kind: 'dependency'; sourceId: string; depType: 'FS' | 'SS' | 'FF' | 'SF' }
  | null;

export function GanttView({
  bars,
  milestones,
  dependencies = [],
  projectLabels = [],
  gitlabBaseUrl,
  gitlabProjectPath,
  projectInternalId,
  initialSelectedId,
  initialSelectedMilestoneId,
  initialDisplay,
}: Props) {
  const [zoom, setZoom] = useState<Zoom>(initialDisplay?.zoom ?? 'week');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StatusFilter>(initialDisplay?.filter ?? 'all');
  const [showWeekends, setShowWeekends] = useState(initialDisplay?.showWeekends ?? true);
  const [density, setDensity] = useState<Density>(initialDisplay?.density ?? 'comfort');
  const [showDeps, setShowDeps] = useState(initialDisplay?.showDeps ?? true);
  const [showCrit, setShowCrit] = useState(initialDisplay?.showCrit ?? false);
  const [showBaseline, setShowBaseline] = useState(initialDisplay?.showBaseline ?? false);
  // Breite der linken Liste — per Drag am Splitter verstellbar, persistiert
  // in den User-Preferences. Wird nur im Wide-Mode angewendet (im Narrow-Mode
  // ist die Liste 100% breit).
  const [leftColWidth, setLeftColWidth] = useState<number>(
    Math.min(
      MAX_LEFT_COL_WIDTH,
      Math.max(MIN_LEFT_COL_WIDTH, initialDisplay?.leftColWidth ?? DEFAULT_LEFT_COL_WIDTH),
    ),
  );
  const splitterDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  // Inspector-Width per Drag am rechten Splitter verstellbar.
  const [inspectorWidth, setInspectorWidth] = useState<number>(
    Math.min(
      MAX_INSPECTOR_WIDTH,
      Math.max(
        MIN_INSPECTOR_WIDTH,
        initialDisplay?.inspectorWidth ?? DEFAULT_INSPECTOR_WIDTH,
      ),
    ),
  );
  const inspectorDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  // Linke Liste komplett ausblenden (via Splitter-Toggle).
  const [leftListCollapsed, setLeftListCollapsed] = useState<boolean>(
    initialDisplay?.leftListCollapsed ?? false,
  );
  // Print-Modus: wenn true, wird parallel zur Live-View die GanttPrintView
  // gemountet. Live-View ist via @media print hidden, Print-View nur im
  // Print-Modus sichtbar. Wir triggern window.print() im next-frame nach Mount.
  const [printing, setPrinting] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  // Wenn die Seite mit ?wp=<id> aufgerufen wird (z.B. aus der Resource-View)
  // wird der Inspector direkt mit diesem WP geöffnet.
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  // Milestone-Selection (mutually exclusive zu selectedId: nur Inspector
  // ODER MilestoneInspector wird gerendert).
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(
    initialSelectedMilestoneId ?? null,
  );
  // Cluster-Picker für Days mit mehreren Meilensteinen auf demselben Datum:
  // statt blind den ersten zu öffnen zeigen wir eine Auswahl-Liste.
  const [clusterPicker, setClusterPicker] = useState<{
    screenX: number;
    screenY: number;
    items: GanttMilestone[];
  } | null>(null);

  function selectMilestone(id: string) {
    setSelectedMilestoneId(id);
    setSelectedId(null);
    setClusterPicker(null);
    if (!inspectorOpen) setInspectorOpen(true);
    // Tracking-Ref analog zu selectBar (siehe dort für Details).
    lastScrolledMilestoneRef.current = id;
  }
  function closeMilestoneInspector() {
    setSelectedMilestoneId(null);
  }

  function onMilestoneClusterClick(group: GanttMilestone[], anchorEl: Element) {
    if (group.length === 1) {
      selectMilestone(group[0].id);
      return;
    }
    const r = anchorEl.getBoundingClientRect();
    setClusterPicker({
      screenX: r.left + r.width / 2,
      screenY: r.bottom + 6,
      items: group,
    });
  }

  // Cluster-Picker schließen via ESC / Outside-Click
  useEffect(() => {
    if (!clusterPicker) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setClusterPicker(null);
    }
    function onMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest('.milestone-cluster-picker')) setClusterPicker(null);
    }
    window.addEventListener('keydown', onKey);
    // setTimeout damit der initial-opening-click nicht direkt wieder schließt
    const t = setTimeout(() => window.addEventListener('mousedown', onMouseDown), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onMouseDown);
      clearTimeout(t);
    };
  }, [clusterPicker]);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Optimistische Updates: bleiben aktiv bis der Server-Refresh die neuen
  // Daten via Props nachliefert. Verhindert das "Flackern zurück" nach Drag.
  const [optimistic, setOptimistic] = useState<Record<string, { start: Date; end: Date }>>({});
  // Hierarchie: collapsed-Set der Parent-IDs.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Responsive: unter 1200px wird die Ribbon kollabiert (Mehr-Dropdown) und
  // die Panes als Tab-Switch dargestellt.
  const isNarrow = useMediaQuery(BP.NARROW);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [activePane, setActivePane] = useState<'list' | 'timeline'>('timeline');

  function toggleCollapse(id: string) {
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function collapseAll(parents: string[]) {
    setCollapsed(new Set(parents));
  }
  function expandAll() {
    setCollapsed(new Set());
  }

  // Indent: setze Parent auf den vorherigen Sibling (gleiche Tiefe + gleicher Parent)
  function indentSelected() {
    if (!selectedId) return;
    const idx = visibleNodes.findIndex((n) => n.bar.id === selectedId);
    if (idx <= 0) return;
    const cur = visibleNodes[idx];
    if (cur.bar.isSummary) return;
    let newParent: GanttBar | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      const candidate = visibleNodes[i];
      if (candidate.depth === cur.depth && candidate.bar.parentId === cur.bar.parentId) {
        newParent = candidate.bar;
        break;
      }
      if (candidate.depth < cur.depth) break;
    }
    if (!newParent) return;
    void updateWorkPackageAction(cur.bar.id, { parentIid: newParent.gitlabIssueIid });
  }

  // Outdent: neuer Parent = Großeltern-Bar (oder null falls Parent eine Wurzel ist)
  function outdentSelected() {
    if (!selectedId) return;
    const cur = bars.find((b) => b.id === selectedId);
    if (!cur || !cur.parentId) return;
    const parent = bars.find((b) => b.id === cur.parentId);
    if (!parent) return;
    const grand = parent.parentId ? bars.find((b) => b.id === parent.parentId) : null;
    const newIid = grand ? grand.gitlabIssueIid : null;
    void updateWorkPackageAction(cur.id, { parentIid: newIid });
  }

  const selectedBar = selectedId ? bars.find((b) => b.id === selectedId) ?? null : null;

  // Optimistic-Overrides leeren wenn Props (Server-Refresh) sie eingeholt haben.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOptimistic((cur) => {
      const next: typeof cur = {};
      let changed = false;
      for (const [id, ov] of Object.entries(cur)) {
        const bar = bars.find((b) => b.id === id);
        if (!bar) { changed = true; continue; }
        if (
          bar.start.getTime() === ov.start.getTime() &&
          bar.end.getTime() === ov.end.getTime()
        ) {
          changed = true;
        } else {
          next[id] = ov;
        }
      }
      return changed ? next : cur;
    });
  }, [bars]);

  // Splitter-Drag: globale mousemove/mouseup-Listener, damit der Drag auch
  // dann weiterläuft wenn der Cursor den Splitter verlässt.
  function startLeftColResize(e: React.MouseEvent) {
    e.preventDefault();
    splitterDragRef.current = { startX: e.clientX, startWidth: leftColWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(ev: MouseEvent) {
      const drag = splitterDragRef.current;
      if (!drag) return;
      const delta = ev.clientX - drag.startX;
      const next = Math.max(
        MIN_LEFT_COL_WIDTH,
        Math.min(MAX_LEFT_COL_WIDTH, drag.startWidth + delta),
      );
      setLeftColWidth(next);
    }
    function onUp() {
      splitterDragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Inspector-Drag: zieht den Splitter zwischen Gantt und Inspector. Drag
  // nach LINKS = Inspector breiter, nach RECHTS = schmaler (umgekehrte
  // Vorzeichen-Logik im Vergleich zum left-Splitter).
  function startInspectorResize(e: React.MouseEvent) {
    e.preventDefault();
    inspectorDragRef.current = { startX: e.clientX, startWidth: inspectorWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(ev: MouseEvent) {
      const drag = inspectorDragRef.current;
      if (!drag) return;
      const delta = ev.clientX - drag.startX;
      const next = Math.max(
        MIN_INSPECTOR_WIDTH,
        Math.min(MAX_INSPECTOR_WIDTH, drag.startWidth - delta),
      );
      setInspectorWidth(next);
    }
    function onUp() {
      inspectorDragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function selectBar(id: string) {
    setSelectedId(id);
    // Falls vorher ein Meilenstein im Inspector war: clearen, sonst bleibt
    // dessen Edit-Panel über dem WP-Inspector liegen.
    setSelectedMilestoneId(null);
    if (!inspectorOpen) setInspectorOpen(true);
    // Smart-Scroll: bringt die Bar in die Viewport falls sie aktuell nicht
    // sichtbar ist. force=false → re-zentriert nicht wenn schon im Blick.
    setPendingScroll({ id, force: false });
    // Tracking-Ref für den initialSelectedId-Effekt aktualisieren. Wenn der
    // User intern via Click navigiert hat, soll ein späterer revalidate
    // (Label-Action, Sync etc.) NICHT erneut auf diese Bar zentrieren —
    // history.replaceState in der URL triggert keinen Re-Render, aber der
    // nächste RSC-Refresh sieht das ?wp=<id> dann erstmals als Prop, was
    // sonst zum "Spring zu Bar"-Verhalten führen würde.
    lastScrolledForRef.current = id;
  }

  // Click-Handler: im Picker-Modus → pickTarget, sonst normale Selektion
  function handleTaskClick(id: string) {
    if (pickerMode) {
      pickTarget(id);
    } else {
      selectBar(id);
    }
  }

  // Picker-Aktionen — werden vom Inspector aus aufgerufen.
  function startPickParent(sourceId: string) {
    setPickerMode({ kind: 'parent', sourceId });
  }
  function startPickDependency(sourceId: string, depType: 'FS' | 'SS' | 'FF' | 'SF') {
    setPickerMode({ kind: 'dependency', sourceId, depType });
  }
  function cancelPicker() {
    setPickerMode(null);
  }

  // ESC bricht Picker-Modus ab
  useEffect(() => {
    if (!pickerMode) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPickerMode(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickerMode]);

  // Klick im Picker-Modus → entsprechende Action, dann Modus beenden
  function pickTarget(targetId: string) {
    if (!pickerMode) return;
    if (targetId === pickerMode.sourceId) {
      setPickerMode(null);
      return;
    }
    const target = bars.find((b) => b.id === targetId);
    if (!target) {
      setPickerMode(null);
      return;
    }
    if (pickerMode.kind === 'parent') {
      void updateWorkPackageAction(pickerMode.sourceId, {
        parentIid: target.gitlabIssueIid,
      });
    } else {
      // Aktuelle Vorgänger lesen, neuen ergänzen
      const sourceDeps = (
        // Hinweis: dependencies-Prop ist hier closure-bound; bei kurz aufeinander
        // folgenden Picks bezieht sich das auf den Server-Refresh-Zustand.
        dependencies.filter((d) => d.successorId === pickerMode.sourceId)
      ).map((d) => {
        const pred = bars.find((b) => b.id === d.predecessorId);
        return pred
          ? { predecessorIid: pred.gitlabIssueIid, type: d.type, lagDays: d.lagDays }
          : null;
      }).filter((x): x is { predecessorIid: number; type: 'FS' | 'SS' | 'FF' | 'SF'; lagDays: number } => x !== null);
      sourceDeps.push({
        predecessorIid: target.gitlabIssueIid,
        type: pickerMode.depType,
        lagDays: 0,
      });
      void updateWorkPackageAction(pickerMode.sourceId, { dependencies: sourceDeps });
    }
    setPickerMode(null);
  }

  // Zwei-Pane-Layout: linke Liste scrollt nur vertikal,
  // rechte Timeline horizontal + vertikal. Top-Right (Date-Axis) wird
  // synchron mit Right-Body horizontal mitgescrollt.
  const leftListRef = useRef<HTMLDivElement>(null);
  const topRightRef = useRef<HTMLDivElement>(null);
  const rightBodyRef = useRef<HTMLDivElement>(null);
  // Letzter px/Tag-Wert des Zoom-Preserve-Effects. Steht hier oben bei den
  // übrigen Refs, damit die Scroll-Helper es setzen können ohne auf eine
  // spätere Deklaration vorzugreifen.
  const prevPxPerDayRef = useRef<number | null>(null);

  const rowH = density === 'compact' ? 24 : 28;
  const barH = density === 'compact' ? 14 : 18;
  const barPadY = (rowH - barH) / 2;

  const basePxPerDay = ZOOMS[zoom].pxPerDay;

  // Rechte Pane-Breite messen, damit Timeline bei niedrigen Zoom-Stufen den
  // verfügbaren Platz ausfüllt statt klein in der Ecke zu hängen.
  // Wenn isNarrow/activePane wechseln, kann sich die Pane (un-)mounten —
  // daher als Deps, damit ResizeObserver am neuen Element andocken kann.
  useEffect(() => {
    const el = rightBodyRef.current;
    if (!el) return;
    const update = () => {
      // Im Narrow-Mode (Tab-Switch) ist die Liste nicht sichtbar, daher
      // entspricht availableWidth direkt dem Right-Body. Im Wide-Mode wird
      // leftColWidth addiert, weil die Liste links daneben Platz wegnimmt.
      const offset = isNarrow ? 0 : leftColWidth;
      setAvailableWidth(el.clientWidth + offset);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isNarrow, activePane]);

  // Filter (Status + Suche). Hierarchie wird separat via collapsed angewendet.
  const filteredBars = useMemo(() => {
    return bars.filter((b) => {
      if (filter === 'open' && b.state !== 'opened') return false;
      if (filter === 'done' && b.state !== 'closed') return false;
      if (query) {
        const q = query.toLowerCase();
        if (!b.text.toLowerCase().includes(q) && !String(b.gitlabIssueIid).includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [bars, filter, query]);

  // Sichtbarer Baum: respektiert collapsed-Set, gibt Depth + hasChildren mit.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const visibleNodes = useMemo(
    () => buildVisibleTree(filteredBars, collapsed),
    [filteredBars, collapsed],
  );
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const visibleBars = useMemo(() => visibleNodes.map((n) => n.bar), [visibleNodes]);

  // Meilensteine belegen (wenn vorhanden) die erste Timeline-Row, alle
  // Task-Rows verschieben sich entsprechend nach unten.
  const milestoneRowCount = milestones.length > 0 ? 1 : 0;

  // Meilensteine pro Tag gruppieren — verhindert dass mehrere sich am selben
  // Datum überlappen und unsichtbar werden. Bewusst außerhalb des JSX: im
  // Render-Body dürfen die Click-Handler der Diamanten Refs anfassen.
  const milestoneDayGroups = useMemo(() => {
    const byDay = new Map<string, GanttMilestone[]>();
    for (const m of milestones) {
      if (!m.date) continue;
      const key = toDayKey(m.date);
      const arr = byDay.get(key) ?? [];
      arr.push(m);
      byDay.set(key, arr);
    }
    return Array.from(byDay.entries());
  }, [milestones]);

  // Kritischer Pfad (CPM über FS-Dependencies)
  const criticalIds = useMemo(
    () => computeCriticalPath({ bars, dependencies }),
    [bars, dependencies],
  );

  // Anzahl Bars mit gesetzter Baseline — Toggle ist disabled wenn keine
  // Baseline existiert (sonst hätte er keinen sichtbaren Effekt).
  const baselineCount = useMemo(
    () => bars.filter((b) => b.baselineStart && b.baselineEnd).length,
    [bars],
  );

  // Dependency-Konflikte: WP-Daten widersprechen einer Dependency-Constraint.
  // parentId wird mitgegeben damit die Lib Parent↔Child-Dependencies ignorieren
  // kann (Parent-Datum ist Aggregat → Constraint dagegen unauflösbar).
  const dependencyConflicts = useMemo(
    () =>
      findDependencyConflicts(
        bars.map((b) => ({
          id: b.id,
          start: b.start,
          end: b.end,
          text: b.text,
          gitlabIssueIid: b.gitlabIssueIid,
          parentId: b.parentId,
        })),
        dependencies,
      ),
    [bars, dependencies],
  );
  // Set der successor-IDs für schnelles Lookup im TaskRow + Inspector
  const conflictedWpIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of dependencyConflicts) s.add(c.successorId);
    return s;
  }, [dependencyConflicts]);

  // Sortierte Listen für die Status-Bar-Popovers
  const openBars = useMemo(
    () =>
      bars
        .filter((b) => b.state !== 'closed' && !b.isSummary)
        .sort((a, b) => a.end.getTime() - b.end.getTime()),
    [bars],
  );
  const doneBars = useMemo(
    () =>
      bars
        .filter((b) => b.state === 'closed')
        .sort((a, b) => b.end.getTime() - a.end.getTime()),
    [bars],
  );
  const milestonesSorted = useMemo(
    () =>
      [...milestones].sort((a, b) => {
        const ax = a.date?.getTime() ?? Infinity;
        const bx = b.date?.getTime() ?? Infinity;
        return ax - bx;
      }),
    [milestones],
  );

  // Helper: WP selektieren, aufklappen, scrollen, Inspector öffnen.
  // Schließt das Status-Bar-Popover automatisch.
  function jumpToBar(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      let cursor: string | null = bars.find((b) => b.id === id)?.parentId ?? null;
      for (let i = 0; cursor && i < 100; i++) {
        next.delete(cursor);
        cursor = bars.find((b) => b.id === cursor)?.parentId ?? null;
      }
      return next;
    });
    setSelectedId(id);
    setSelectedMilestoneId(null);
    setStatusBarPopover(null);
    if (!inspectorOpen) setInspectorOpen(true);
    setPendingScroll({ id, force: true });
  }
  function jumpToMilestone(id: string) {
    setSelectedMilestoneId(id);
    setSelectedId(null);
    setStatusBarPopover(null);
    if (!inspectorOpen) setInspectorOpen(true);
    // Horizontal-Scroll auf das Milestone-Datum (vertikal nicht nötig — die
    // Diamanten sitzen alle in der ersten Timeline-Row).
    setPendingMilestoneScroll(id);
  }

  // Pending-Scroll für Meilensteine (analog zu pendingScroll für WPs).
  const [pendingMilestoneScroll, setPendingMilestoneScroll] = useState<string | null>(null);
  function scrollToMilestoneId(id: string): boolean {
    if (!range || !rightBodyRef.current) return false;
    const m = milestones.find((x) => x.id === id);
    if (!m || !m.date) return false;
    const x = diffDays(range.start, startOfDay(m.date)) * pxPerDay;
    const el = rightBodyRef.current;
    el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
    if (topRightRef.current) topRightRef.current.scrollLeft = el.scrollLeft;
    prevPxPerDayRef.current = pxPerDay;
    return true;
  }
  // Popover-State für die Status-Bar. Vier mögliche Popovers (Konflikte,
  // Offene/Fertige WPs, Meilensteine) — mutually exclusive damit immer nur
  // eines gleichzeitig offen ist.
  type StatusPop = 'conflicts' | 'open' | 'done' | 'milestones' | null;
  const [statusBarPopover, setStatusBarPopover] = useState<StatusPop>(null);
  // Pending-Scroll-Target: wird gesetzt wenn die Auswahl programmatisch
  // wechselt (z.B. via Konflikt-Popover) und der Scroll erst nach einem
  // Re-Render durchgeführt werden kann (Parents müssen ggf. aufklappen).
  // Ein useEffect weiter unten reagiert auf visibleNodes-Updates.
  // force=true zentriert immer (externe Navigation); force=false nur wenn
  // die Bar nicht in der Viewport ist (normaler In-App-Click).
  const [pendingScroll, setPendingScroll] = useState<{ id: string; force: boolean } | null>(null);
  useEffect(() => {
    if (!statusBarPopover) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setStatusBarPopover(null);
    }
    function onMouseDown(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest('.statusbar-popover') && !t.closest('.statusbar-trigger')) {
        setStatusBarPopover(null);
      }
    }
    window.addEventListener('keydown', onKey);
    const setupTimer = setTimeout(() => window.addEventListener('mousedown', onMouseDown), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onMouseDown);
      clearTimeout(setupTimer);
    };
  }, [statusBarPopover]);

  // Bekannte Assignees/Labels aus allen WPs aggregieren (für Inspector-Picker)
  const knownAssignees = useMemo(() => {
    const map = new Map<number, { id: number; username: string; name: string }>();
    for (const b of bars) {
      for (const a of b.assignees ?? []) {
        if (!map.has(a.id)) map.set(a.id, { id: a.id, username: a.username, name: a.name });
      }
    }
    return Array.from(map.values());
  }, [bars]);

  const knownLabels = useMemo(() => {
    // Project-Labels-Cache als Basis (vollständige Palette mit Farben).
    // WP-Labels nur als Fallback für Labels die noch nicht im Cache sind
    // (z.B. zwischen zwei Syncs in GitLab neu erstellt + sofort angewendet).
    const map = new Map<string, { name: string; color?: string }>();
    for (const l of projectLabels) {
      map.set(l.name, { name: l.name, color: l.color });
    }
    for (const b of bars) {
      for (const l of b.labels ?? []) {
        if (!map.has(l.name)) map.set(l.name, { name: l.name, color: l.color });
      }
    }
    return Array.from(map.values());
  }, [bars, projectLabels]);

  // Alle Bars mit Kindern — für "Alle zu/auf"-Buttons.
  const allParentIds = useMemo(() => {
    const set = new Set<string>();
    for (const b of bars) {
      if (b.parentId) set.add(b.parentId);
    }
    return Array.from(set);
  }, [bars]);

  // Leitet sich über visibleBars vom collapsed-Set ab, das beim Auf-/Zuklappen
  // kopiert-und-mutiert wird — dieselbe Kette wegen der visibleNodes/visibleBars
  // schon ausgenommen sind. Der Compiler kann die Memoisierung darum nicht
  // nachbauen; das manuelle useMemo muss bleiben (range hängt an mehreren
  // Effect-Deps und darf nicht bei jedem Render neu entstehen).
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const range = useMemo(() => {
    if (visibleBars.length === 0 && milestones.length === 0) return null;
    const dates: number[] = [];
    for (const b of visibleBars) {
      dates.push(b.start.getTime());
      dates.push(b.end.getTime());
    }
    for (const m of milestones) if (m.date) dates.push(m.date.getTime());
    const start = addDays(startOfDay(new Date(Math.min(...dates))), -PADDING_DAYS);
    const end = addDays(startOfDay(new Date(Math.max(...dates))), PADDING_DAYS);
    return { start, end, totalDays: diffDays(start, end) + 1 };
  }, [visibleBars, milestones]);

  // Manueller Zoom-Override aus der Status-Bar (+/- Buttons + Slider).
  // null = "kein Override, nutze Preset-basierte Berechnung". Wird gecleart
  // wenn der User einen Preset im Ribbon klickt.
  const [manualPxPerDay, setManualPxPerDay] = useState<number | null>(null);

  // Effektive px/Tag: manueller Override > Preset-Default + Container-Fill.
  // Bei Preset-only füllt der Gantt den ganzen Container; bei vielen Tagen
  // scrollt es horizontal.
  const pxPerDay = useMemo(() => {
    if (manualPxPerDay !== null) return manualPxPerDay;
    if (!range) return basePxPerDay;
    if (availableWidth <= 0) return basePxPerDay;
    // Im Narrow-Mode (kein Left-Pane) ist availableWidth bereits der reine
    // Right-Body. Im Wide-Mode wurde leftColWidth addiert (siehe useEffect
    // oben) und muss hier wieder abgezogen werden.
    const leftWidth = isNarrow ? 0 : leftColWidth;
    const timelineSpace = Math.max(0, availableWidth - leftWidth - 4); // -4 für Scrollbar etc.
    const minToFill = timelineSpace / range.totalDays;
    return Math.max(basePxPerDay, minToFill);
  }, [manualPxPerDay, basePxPerDay, range, availableWidth, isNarrow]);

  // Min/Max für den Slider — verhindert komplett unbrauchbare Zustände
  // (zu klein: Bars unsichtbar; zu groß: nichts mehr verglichen).
  const MIN_PX_PER_DAY = 1;
  const MAX_PX_PER_DAY = 200;
  function adjustZoom(factor: number) {
    setManualPxPerDay((cur) => {
      const base = cur ?? pxPerDay;
      const next = base * factor;
      return Math.max(MIN_PX_PER_DAY, Math.min(MAX_PX_PER_DAY, next));
    });
  }

  function scrollToToday() {
    if (!range || !rightBodyRef.current) return;
    const today = startOfDay(new Date());
    if (today < range.start || today > range.end) return;
    const x = diffDays(range.start, today) * pxPerDay;
    const el = rightBodyRef.current;
    el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
    if (topRightRef.current) topRightRef.current.scrollLeft = el.scrollLeft;
  }

  // Effektive Dates für eine Bar: Drag-Vorschau oder Optimistic-Override.
  function effectiveDates(bar: GanttBar): { start: Date; end: Date } {
    if (drag && drag.id === bar.id) {
      const d = drag.deltaDays;
      const s = addDays(drag.origStart, drag.mode === 'right' ? 0 : d);
      const e = addDays(drag.origEnd, drag.mode === 'left' ? 0 : d);
      if (drag.mode === 'left' && e.getTime() - s.getTime() < 86_400_000) {
        return { start: addDays(e, -1), end: e };
      }
      if (drag.mode === 'right' && e.getTime() - s.getTime() < 86_400_000) {
        return { start: s, end: addDays(s, 1) };
      }
      return { start: s, end: e };
    }
    const o = optimistic[bar.id];
    if (o) return o;
    return { start: bar.start, end: bar.end };
  }

  // Scroll-into-view für eine Bar. Standard-Verhalten (force=false): scrollt
  // nur wenn die Bar AKTUELL außerhalb der Viewport-Range liegt — vermeidet
  // dass ein Click auf eine sichtbare Row die Liste unnötig neu zentriert.
  // force=true zentriert immer (für externe Navigation: URL-Param, Konflikt-
  // Popover, Bell-Notification etc.).
  function scrollToBarId(id: string, options?: { force?: boolean }): boolean {
    if (!range || !rightBodyRef.current || !leftListRef.current) return false;
    const bar = bars.find((b) => b.id === id);
    if (!bar) return false;
    const rowIdx = visibleNodes.findIndex((n) => n.bar.id === id);
    if (rowIdx < 0) return false;

    const force = options?.force ?? false;
    const eff = effectiveDates(bar);
    const barLeft = diffDays(range.start, startOfDay(eff.start)) * pxPerDay;
    const barRight = (diffDays(range.start, startOfDay(eff.end)) + 1) * pxPerDay;
    const barCenter = (barLeft + barRight) / 2;
    const el = rightBodyRef.current;

    // Horizontal: zentrieren wenn force ODER die Bar (oder ein Teil davon)
    // nicht in der aktuellen Viewport-Range sichtbar ist
    const visL = el.scrollLeft;
    const visR = visL + el.clientWidth;
    if (force || barRight < visL || barLeft > visR) {
      el.scrollLeft = Math.max(0, barCenter - el.clientWidth / 2);
      if (topRightRef.current) topRightRef.current.scrollLeft = el.scrollLeft;
      // prevPxPerDayRef syncen damit der Zoom-Preserve-Effect das nicht
      // sofort wieder revertiert
      prevPxPerDayRef.current = pxPerDay;
    }

    // Vertikal: zentrieren wenn force ODER die Row nicht im sichtbaren
    // Bereich der Task-Liste ist
    const targetY = (milestoneRowCount + rowIdx) * rowH;
    const listEl = leftListRef.current;
    const visT = listEl.scrollTop;
    const visB = visT + listEl.clientHeight;
    if (force || targetY + rowH < visT || targetY > visB) {
      listEl.scrollTop = Math.max(0, targetY - listEl.clientHeight / 2);
      el.scrollTop = listEl.scrollTop;
    }
    return true;
  }

  // Beim ersten Mount auf "heute" zentrieren. Danach bei Zoom-Änderung NICHT
  // mehr zurückspringen — stattdessen den Mittelpunkt der Viewport-Datums-
  // Range beibehalten (so wirkt Zoom wie ein "rein-/raus-zoomen" auf das was
  // der User gerade betrachtet, statt jedes Mal nach today zu rasen).
  // Dep-Stabilisierung: range-Object wird bei jedem revalidate neu erzeugt
  // (neue Reference, gleiche Werte) → würde Effect unnötig triggern und das
  // Bild "springen" lassen. Stattdessen auf primitive Zeitstempel achten.
  const rangeStart = range?.start.getTime();
  const rangeEnd = range?.end.getTime();
  useEffect(() => {
    if (!rightBodyRef.current || !range) return;
    const el = rightBodyRef.current;
    const prev = prevPxPerDayRef.current;
    if (prev === null) {
      const today = startOfDay(new Date());
      if (today >= range.start && today <= range.end) {
        const x = diffDays(range.start, today) * pxPerDay;
        el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
      } else {
        el.scrollLeft = 0;
      }
    } else if (prev !== pxPerDay) {
      const centerDays = (el.scrollLeft + el.clientWidth / 2) / prev;
      el.scrollLeft = Math.max(0, centerDays * pxPerDay - el.clientWidth / 2);
    }
    if (topRightRef.current) topRightRef.current.scrollLeft = el.scrollLeft;
    prevPxPerDayRef.current = pxPerDay;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- range absichtlich nicht referentially abhängig, nutzen die primitiven start/end-Timestamps
  }, [zoom, rangeStart, rangeEnd, pxPerDay]);

  // Prop → State sync für initial-Selection. Notwendig wenn der User schon
  // auf der Gantt-Page ist und auf einen Bell/Notification-Link mit anderem
  // ?wp=<id> oder ?ms=<id> klickt — Next.js navigiert ohne Re-Mount der
  // Komponente, also muss useState explizit aktualisiert werden.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (initialSelectedId) setSelectedId(initialSelectedId);
  }, [initialSelectedId]);
  useEffect(() => {
    if (initialSelectedMilestoneId) setSelectedMilestoneId(initialSelectedMilestoneId);
  }, [initialSelectedMilestoneId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // State → URL sync: ?wp=<id> bzw. ?ms=<id> spiegelt die Auswahl. WP und MS
  // sind mutually exclusive — gemeinsame Effect garantiert dass nicht beide
  // gleichzeitig in der URL stehen. history.replaceState statt router.replace
  // damit kein RSC-Refetch passiert (Selection ist Client-State).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (selectedId) {
      url.searchParams.set('wp', selectedId);
      url.searchParams.delete('ms');
    } else if (selectedMilestoneId) {
      url.searchParams.set('ms', selectedMilestoneId);
      url.searchParams.delete('wp');
    } else {
      url.searchParams.delete('wp');
      url.searchParams.delete('ms');
    }
    if (url.toString() !== window.location.href) {
      window.history.replaceState({}, '', url.toString());
    }
  }, [selectedId, selectedMilestoneId]);

  // Display-Settings → URL. Nur nicht-Default-Werte werden geschrieben damit
  // die URL clean bleibt. Defaults: deps=on, crit=off, weekends=on, density=comfort.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const setOrDel = (key: string, value: string | null) => {
      if (value === null) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    };
    setOrDel('deps', showDeps ? null : '0');
    setOrDel('crit', showCrit ? '1' : null);
    setOrDel('weekends', showWeekends ? null : '0');
    setOrDel('density', density === 'compact' ? 'compact' : null);
    if (url.toString() !== window.location.href) {
      window.history.replaceState({}, '', url.toString());
    }
  }, [showDeps, showCrit, showWeekends, density]);

  // Display-Settings → User.preferences in der DB. Debounced damit Toggle-
  // Spam nicht 5 DB-Writes pro Sekunde verursacht. firstRunRef verhindert dass
  // beim Mount sofort gespeichert wird (Werte kommen ja schon aus den Prefs).
  const firstPrefsRunRef = useRef(true);
  useEffect(() => {
    if (firstPrefsRunRef.current) {
      firstPrefsRunRef.current = false;
      return;
    }
    const handle = setTimeout(() => {
      void savePreferencesAction({
        showDeps,
        showCrit,
        showWeekends,
        showBaseline,
        density,
        filter,
        zoom,
        leftColWidth,
        inspectorWidth,
        leftListCollapsed,
      });
    }, 500);
    return () => clearTimeout(handle);
  }, [showDeps, showCrit, showWeekends, showBaseline, density, filter, zoom, leftColWidth, inspectorWidth, leftListCollapsed]);

  // ── Print-Trigger ──────────────────────────────────────────────────
  // Lauscht auf das Custom-Event `taktline:gantt-print` (vom ExportButton
  // dispatched). Setzt printing=true → React rendert die GanttPrintView.
  // Im nächsten Frame wird window.print() aufgerufen, damit das DOM für die
  // Print-Engine fertig ist. `afterprint` cleant up.
  useEffect(() => {
    function onPrintRequest() {
      setPrinting(true);
    }
    window.addEventListener('taktline:gantt-print', onPrintRequest);
    return () => window.removeEventListener('taktline:gantt-print', onPrintRequest);
  }, []);

  useEffect(() => {
    if (!printing) return;
    function onAfterPrint() {
      setPrinting(false);
    }
    window.addEventListener('afterprint', onAfterPrint);
    // Browser braucht einen Frame um die Print-View vor dem print()-Call zu
    // mounten. requestAnimationFrame + 0ms setTimeout = solider Fallback.
    const raf = requestAnimationFrame(() => {
      setTimeout(() => window.print(), 0);
    });
    return () => {
      window.removeEventListener('afterprint', onAfterPrint);
      cancelAnimationFrame(raf);
    };
  }, [printing]);

  // ── Pinch-Zoom via Trackpad ─────────────────────────────────────────
  // macOS-Trackpads schicken Pinch-Gesten als wheel-Event mit ctrlKey=true.
  // Wir fangen das ab, verhindern den Browser-Zoom und passen stattdessen
  // pxPerDay an — mit dem Mauspointer als Anchor, damit das Datum unter
  // dem Finger an gleicher Stelle bleibt.
  // Native Listener mit `passive: false` ist nötig damit preventDefault
  // den Browser-Zoom blockieren kann (React's onWheel ist passiv).
  // Der Pinch-Anchor wird im wheel-handler in einem Ref festgehalten und im
  // useLayoutEffect (synchron nach dem React-Render, vor dem Paint)
  // verarbeitet — sonst gibt es ein 1-Frame-Lag zwischen pxPerDay-Update und
  // scrollLeft-Korrektur, was als Zittern sichtbar wird.
  const pinchAnchorRef = useRef<{ dayAtCursor: number; cursorOffsetX: number } | null>(null);
  // Pinch-Aktivitäts-Zeitstempel: während eines Pinch (ctrlKey-wheel-Events)
  // sendet das macOS-Trackpad parallel auch normale wheel-events (deltaY)
  // weil die Finger sich auch translatorisch bewegen. Die würden den
  // Container scrollen während wir gerade zoomen → sichtbares Zittern.
  // Solution: solange ctrlKey-Events fliessen, ALLE wheel-Events
  // unterdrücken (Pinch-Lock-Fenster, ~150ms ab letztem ctrlKey-Event).
  const pinchActiveUntilRef = useRef<number>(0);
  // Pinch-Zoom Smoothing via Inertia/Low-Pass:
  // Trackpad-Pinch sendet deltaY oft jitterig — innerhalb weniger ms kommen
  // mal +2, mal -1, mal +3 → das Bild zittert wenn man jeden Wert direkt
  // appliziert. Wir akkumulieren deltaY in einem Ref und applizieren in
  // jedem Frame nur einen Bruchteil (~25%) davon; der Rest klingt in
  // folgenden Frames aus. Hochfrequente Oszillationen werden so geglättet,
  // während die Geste insgesamt natürlich folgt.
  const pinchPendingRef = useRef<{
    deltaY: number;
    cursorOffsetX: number;
  } | null>(null);
  const pinchRafRef = useRef<number | null>(null);
  // pxPerDay via Ref damit der wheel-Handler nicht bei jeder Zoom-Änderung
  // re-mounten muss (was sonst die laufende Inertia-Animation unterbrechen
  // und stale RAF-Refs hinterlassen würde).
  const pxPerDayRef = useRef(pxPerDay);
  // Pinch-Tuning via User-Prefs. Refs damit Änderungen sofort wirken ohne
  // den wheel-Listener neu zu mounten.
  const pinchSensitivityRef = useRef(
    initialDisplay?.pinchSensitivity ?? PINCH_SENSITIVITY_DEFAULT,
  );
  const pinchSmoothingRef = useRef(
    initialDisplay?.pinchSmoothing ?? PINCH_SMOOTHING_DEFAULT,
  );
  const pinchLockMsRef = useRef(initialDisplay?.pinchLockMs ?? PINCH_LOCK_MS_DEFAULT);
  useLayoutEffect(() => {
    pxPerDayRef.current = pxPerDay;
  });
  useLayoutEffect(() => {
    pinchSensitivityRef.current =
      initialDisplay?.pinchSensitivity ?? PINCH_SENSITIVITY_DEFAULT;
    pinchSmoothingRef.current =
      initialDisplay?.pinchSmoothing ?? PINCH_SMOOTHING_DEFAULT;
    pinchLockMsRef.current = initialDisplay?.pinchLockMs ?? PINCH_LOCK_MS_DEFAULT;
  }, [
    initialDisplay?.pinchSensitivity,
    initialDisplay?.pinchSmoothing,
    initialDisplay?.pinchLockMs,
  ]);
  useEffect(() => {
    const el = rightBodyRef.current;
    if (!el) return;
    const EPSILON = 0.05;
    function flushPinch() {
      pinchRafRef.current = null;
      const pending = pinchPendingRef.current;
      if (!pending) return;
      const applyDelta = pending.deltaY * pinchSmoothingRef.current;
      const remaining = pending.deltaY - applyDelta;
      const target = rightBodyRef.current;
      if (!target) {
        pinchPendingRef.current = null;
        return;
      }
      const curPxPerDay = pxPerDayRef.current;
      // Frisch lesen — während der Inertia-Auslauf-Frames ändert sich
      // scrollLeft durch unser eigenes useLayoutEffect, der Anchor muss
      // dieser Änderung folgen sonst driftet das Bild jeden Frame.
      const cursorXInContent = pending.cursorOffsetX + target.scrollLeft;
      const dayAtCursor = cursorXInContent / curPxPerDay;
      // Zoom-Empfindlichkeit. Inertia (LERP) glättet bereits, daher hier
      // spürbar. Negatives deltaY = zoom in, positiv = zoom out.
      const factor = Math.exp(-applyDelta * pinchSensitivityRef.current);
      const newPxPerDay = Math.max(
        MIN_PX_PER_DAY,
        Math.min(MAX_PX_PER_DAY, curPxPerDay * factor),
      );
      if (newPxPerDay !== curPxPerDay) {
        pinchAnchorRef.current = {
          dayAtCursor,
          cursorOffsetX: pending.cursorOffsetX,
        };
        setManualPxPerDay(newPxPerDay);
      }
      if (Math.abs(remaining) > EPSILON) {
        pinchPendingRef.current = { ...pending, deltaY: remaining };
        pinchRafRef.current = requestAnimationFrame(flushPinch);
        // Lock-Fenster NICHT mitziehen — sonst fühlt es sich nach Lag an
        // wenn der User nach Pinch-Ende sofort scrollen will. Inertia darf
        // visuell weiterklingen während Scroll-Events schon wieder
        // durchgehen; der 150ms Lock ab letztem ctrlKey-Event reicht aus
        // um die echten Trackpad-Auslauf-Events zu filtern.
      } else {
        pinchPendingRef.current = null;
      }
    }
    function onWheel(e: WheelEvent) {
      const now = performance.now();
      if (e.ctrlKey) {
        e.preventDefault();
        // Pinch-Lock: solange ctrlKey-Events fliessen + Puffer nach Ende
        // damit Trackpad-Auslauf-Events nicht den Container scrollen
        // lassen. Wert ist über die Pref `pinchLockMs` justierbar.
        pinchActiveUntilRef.current = now + pinchLockMsRef.current;
        const target = rightBodyRef.current;
        if (!target) return;
        const rect = target.getBoundingClientRect();
        const cursorOffsetX = e.clientX - rect.left;
        const prev = pinchPendingRef.current;
        pinchPendingRef.current = {
          deltaY: (prev?.deltaY ?? 0) + e.deltaY,
          cursorOffsetX,
        };
        if (pinchRafRef.current === null) {
          pinchRafRef.current = requestAnimationFrame(flushPinch);
        }
      } else if (now < pinchActiveUntilRef.current) {
        e.preventDefault();
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (pinchRafRef.current !== null) {
        cancelAnimationFrame(pinchRafRef.current);
        pinchRafRef.current = null;
      }
      pinchPendingRef.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    const anchor = pinchAnchorRef.current;
    if (!anchor) return;
    pinchAnchorRef.current = null;
    const t = rightBodyRef.current;
    if (!t) return;
    const newX = anchor.dayAtCursor * pxPerDay;
    t.scrollLeft = Math.max(0, newX - anchor.cursorOffsetX);
    if (topRightRef.current) topRightRef.current.scrollLeft = t.scrollLeft;
  }, [pxPerDay]);

  // Scroll auf den ausgewählten Bar wenn sich initialSelectedId ändert
  // (sowohl bei Mount mit ?wp=<id> als auch bei späterer URL-Navigation).
  // Per-Value-Memo via Ref: pro initialSelectedId nur ein einziges Mal scrollen
  // — verhindert dass spätere visibleNodes-Updates (z.B. Filter ändern) den
  // Bar wieder ungewollt zentrieren.
  const lastScrolledForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialSelectedId) return;
    if (lastScrolledForRef.current === initialSelectedId) return;
    if (scrollToBarId(initialSelectedId, { force: true })) {
      lastScrolledForRef.current = initialSelectedId;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- absichtlich nicht alle Deps
  }, [initialSelectedId, range, visibleNodes]);

  // Pending-Scroll: programmatische Navigation (Konflikt-Popover) setzt eine
  // Ziel-ID; sobald visibleNodes diese ID enthält (nach evtl. Re-Render mit
  // aufgeklappten Parents), scrollen wir und resetten den Pending-State.
  useEffect(() => {
    if (!pendingScroll) return;
    if (scrollToBarId(pendingScroll.id, { force: pendingScroll.force })) {
      setPendingScroll(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- absichtlich nicht alle Deps
  }, [pendingScroll, visibleNodes, range]);

  // Initial-Scroll für ?ms=<id> beim Page-Mount oder Navigation
  const lastScrolledMilestoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialSelectedMilestoneId) return;
    if (lastScrolledMilestoneRef.current === initialSelectedMilestoneId) return;
    if (scrollToMilestoneId(initialSelectedMilestoneId)) {
      lastScrolledMilestoneRef.current = initialSelectedMilestoneId;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- absichtlich nicht alle Deps
  }, [initialSelectedMilestoneId, range]);

  // Pending-Scroll auf einen Meilenstein (z.B. nach Click im Status-Bar-Popover)
  useEffect(() => {
    if (!pendingMilestoneScroll) return;
    if (scrollToMilestoneId(pendingMilestoneScroll)) {
      setPendingMilestoneScroll(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- absichtlich nicht alle Deps
  }, [pendingMilestoneScroll, range]);

  // PointerDown auf Bar startet Drag (Modus aus Klick-Zone).
  function startDrag(bar: GanttBar, mode: DragState['mode'], clientX: number) {
    if (bar.isSummary) return; // Summary folgt Kindern
    setSelectedId(bar.id);
    if (!inspectorOpen) setInspectorOpen(true);
    const eff = effectiveDates(bar);
    setDrag({
      id: bar.id,
      mode,
      startClientX: clientX,
      deltaDays: 0,
      origStart: eff.start,
      origEnd: eff.end,
    });
  }

  const persistDrag = async (cur: DragState, eff: { start: Date; end: Date }) => {
    const patch: Parameters<typeof updateWorkPackageAction>[1] = {};
    if (cur.mode !== 'right') patch.startDate = toIsoDate(eff.start);
    if (cur.mode !== 'left') patch.endDate = toIsoDate(eff.end);
    const res = await updateWorkPackageAction(cur.id, patch);
    if (!res.ok) {
      // Optimistic-Override entfernen, Bar springt zurück
      setOptimistic((o) => {
        const next = { ...o };
        delete next[cur.id];
        return next;
      });
    }
  };

  // Window-Listener für Drag-Move + Drag-End (sauberer als SVG-Element-Listener,
  // damit Drag nicht abbricht wenn Maus die Bar verlässt).
  useEffect(() => {
    if (!drag) return;
    function onMove(e: PointerEvent) {
      const dx = e.clientX - drag!.startClientX;
      const deltaDays = Math.round(dx / pxPerDay);
      setDrag((cur) => (cur ? { ...cur, deltaDays } : null));
    }
    function onUp() {
      const cur = drag;
      setDrag(null);
      if (!cur || cur.deltaDays === 0) return;
      const eff: { start: Date; end: Date } = {
        start: addDays(cur.origStart, cur.mode === 'right' ? 0 : cur.deltaDays),
        end: addDays(cur.origEnd, cur.mode === 'left' ? 0 : cur.deltaDays),
      };
      if (eff.end.getTime() - eff.start.getTime() < 86_400_000) {
        if (cur.mode === 'left') eff.start = addDays(eff.end, -1);
        else if (cur.mode === 'right') eff.end = addDays(eff.start, 1);
      }
      setOptimistic((o) => ({ ...o, [cur.id]: eff }));
      void persistDrag(cur, eff);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, pxPerDay]);

  // Scroll-Sync zwischen den drei Bereichen.
  function onRightScroll(e: React.UIEvent<HTMLDivElement>) {
    const t = e.currentTarget;
    if (topRightRef.current && topRightRef.current.scrollLeft !== t.scrollLeft) {
      topRightRef.current.scrollLeft = t.scrollLeft;
    }
    if (leftListRef.current && leftListRef.current.scrollTop !== t.scrollTop) {
      leftListRef.current.scrollTop = t.scrollTop;
    }
  }

  function onLeftScroll(e: React.UIEvent<HTMLDivElement>) {
    const t = e.currentTarget;
    if (rightBodyRef.current && rightBodyRef.current.scrollTop !== t.scrollTop) {
      rightBodyRef.current.scrollTop = t.scrollTop;
    }
  }

  const counts = useMemo(
    () => ({
      total: bars.length,
      open: bars.filter((b) => b.state === 'opened').length,
      done: bars.filter((b) => b.state === 'closed').length,
      milestones: milestones.length,
    }),
    [bars, milestones],
  );

  if (!range) {
    return (
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          padding: 48,
          textAlign: 'center',
          color: 'var(--color-ink-3)',
          fontSize: 13,
        }}
      >
        Keine Aufgaben gefunden.
      </div>
    );
  }

  const timelineWidth = range.totalDays * pxPerDay;
  const today = startOfDay(new Date());
  const todayX =
    today >= range.start && today <= range.end
      ? diffDays(range.start, today) * pxPerDay
      : null;

  const totalRows = milestoneRowCount + visibleNodes.length;
  const timelineHeight = totalRows * rowH;

  return (
    <>
    <div
      className="gantt-printable"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        flex: 1,
        minWidth: 0,
        width: '100%',
      }}
    >
      {/* ─── Ribbon-Toolbar ─────────────────────────────────── */}
      <div className="ribbon">
        {/* Zeitachse — immer sichtbar */}
        <div className="ribbon__group">
          <div className="ribbon__tools">
            <button type="button" className="tool" onClick={scrollToToday} title="Auf heute scrollen">
              <Target size={16} />
              <span>Heute</span>
            </button>
            <div className="seg" style={{ height: 24, marginLeft: 4 }}>
              {(Object.keys(ZOOMS) as Zoom[]).map((z) => (
                <button
                  key={z}
                  type="button"
                  aria-pressed={zoom === z}
                  onClick={() => {
                    setZoom(z);
                    setManualPxPerDay(null); // Override clearen — User wählt explizit Preset
                  }}
                >
                  {ZOOMS[z].label}
                </button>
              ))}
            </div>
          </div>
          <div className="ribbon__label">Zeitachse</div>
        </div>

        {/* HIERARCHIE + ANZEIGE: auf ≥1200px inline, auf <1200px in "Mehr ▾" */}
        {!isNarrow && (
          <>
            <div className="ribbon__group">
              <div className="ribbon__tools">
                <HierarchyTools
                  selectedId={selectedId}
                  expandAll={expandAll}
                  collapseAll={() => collapseAll(allParentIds)}
                  indentSelected={indentSelected}
                  outdentSelected={outdentSelected}
                />
              </div>
              <div className="ribbon__label">Hierarchie</div>
            </div>

            <div className="ribbon__group">
              <div className="ribbon__tools">
                <DisplayTools
                  showDeps={showDeps}
                  setShowDeps={setShowDeps}
                  showCrit={showCrit}
                  setShowCrit={setShowCrit}
                  criticalCount={criticalIds.size}
                  showWeekends={showWeekends}
                  setShowWeekends={setShowWeekends}
                  showBaseline={showBaseline}
                  setShowBaseline={setShowBaseline}
                  baselineCount={baselineCount}
                  density={density}
                  setDensity={setDensity}
                />
              </div>
              <div className="ribbon__label">Anzeige</div>
            </div>
          </>
        )}

        {isNarrow && (
          <div className="ribbon__group" style={{ position: 'relative' }}>
            <div className="ribbon__tools">
              <button
                type="button"
                className="tool"
                onClick={() => setMoreMenuOpen((v) => !v)}
                aria-expanded={moreMenuOpen}
                title="Hierarchie- und Anzeige-Optionen"
              >
                <MoreHorizontal size={16} />
                <span>Mehr</span>
              </button>
            </div>
            <div className="ribbon__label">Optionen</div>
            {moreMenuOpen && (
              <RibbonMorePopover onClose={() => setMoreMenuOpen(false)}>
                <RibbonMoreSection title="Hierarchie">
                  <HierarchyTools
                    selectedId={selectedId}
                    expandAll={() => {
                      expandAll();
                      setMoreMenuOpen(false);
                    }}
                    collapseAll={() => {
                      collapseAll(allParentIds);
                      setMoreMenuOpen(false);
                    }}
                    indentSelected={() => {
                      indentSelected();
                      setMoreMenuOpen(false);
                    }}
                    outdentSelected={() => {
                      outdentSelected();
                      setMoreMenuOpen(false);
                    }}
                  />
                </RibbonMoreSection>
                <RibbonMoreSection title="Anzeige">
                  <DisplayTools
                    showDeps={showDeps}
                    setShowDeps={setShowDeps}
                    showCrit={showCrit}
                    setShowCrit={setShowCrit}
                    criticalCount={criticalIds.size}
                    showWeekends={showWeekends}
                    setShowWeekends={setShowWeekends}
                    showBaseline={showBaseline}
                    setShowBaseline={setShowBaseline}
                    baselineCount={baselineCount}
                    density={density}
                    setDensity={setDensity}
                  />
                </RibbonMoreSection>
              </RibbonMorePopover>
            )}
          </div>
        )}

        {/* Suche & Filter */}
        <div className="ribbon__group" style={{ flex: 1, minWidth: 220 }}>
          <div className="ribbon__tools" style={{ width: '100%' }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: 260 }}>
              <Search
                size={13}
                style={{
                  position: 'absolute',
                  left: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--color-ink-3)',
                }}
              />
              <input
                className="input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Aufgaben durchsuchen …"
                style={{ width: '100%', paddingLeft: 28 }}
              />
            </div>
            <div className="seg" style={{ height: 24 }}>
              {(['all', 'open', 'done'] as StatusFilter[]).map((f) => (
                <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'Alle' : f === 'open' ? 'Offen' : 'Fertig'}
                </button>
              ))}
            </div>
          </div>
          <div className="ribbon__label">Suche &amp; Filter</div>
        </div>

        {/* Panels */}
        <div className="ribbon__group" style={{ borderRight: 'none' }}>
          <div className="ribbon__tools">
            <button
              type="button"
              className="tool"
              aria-pressed={inspectorOpen}
              onClick={() => setInspectorOpen((v) => !v)}
              title="Inspektor-Panel ein/aus"
            >
              <PanelRight size={16} />
              <span>Inspektor</span>
            </button>
          </div>
          <div className="ribbon__label">Panels</div>
        </div>
      </div>

      {/* Picker-Modus-Banner */}
      {pickerMode && (() => {
        const sourceBar = bars.find((b) => b.id === pickerMode.sourceId);
        const label =
          pickerMode.kind === 'parent'
            ? `Klicke ein Work Package an, das als Parent für „${sourceBar?.text ?? '?'}" gesetzt werden soll.`
            : `Klicke ein Work Package an, das als ${pickerMode.depType}-Vorgänger für „${sourceBar?.text ?? '?'}" hinzugefügt werden soll.`;
        return (
          <div
            style={{
              height: 36,
              flexShrink: 0,
              background: 'var(--color-accent-soft)',
              borderBottom: '1px solid #f5cba0',
              display: 'flex',
              alignItems: 'center',
              padding: '0 14px',
              gap: 12,
              fontSize: 12,
              color: 'var(--color-accent-h)',
            }}
          >
            <span style={{ fontWeight: 600 }}>Picker-Modus</span>
            <span style={{ flex: 1 }}>{label}</span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--color-ink-3)' }}>
              <kbd className="kbd">ESC</kbd> zum Abbrechen
            </span>
            <button
              type="button"
              className="btn btn--sm"
              onClick={cancelPicker}
            >
              Abbrechen
            </button>
          </div>
        );
      })()}

      {/* ─── Body-Container (Gantt + optionaler Inspector rechts) ── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Tab-Switch nur im Narrow-Mode — auf ≥1200px werden beide Panes
            nebeneinander gezeigt. */}
        {isNarrow && (
          <div
            style={{
              flexShrink: 0,
              borderBottom: '1px solid var(--color-border)',
              background: 'var(--color-surface-2)',
              padding: '6px 10px',
              display: 'flex',
              gap: 4,
            }}
          >
            <div className="seg" style={{ height: 26 }}>
              <button
                type="button"
                aria-pressed={activePane === 'list'}
                onClick={() => setActivePane('list')}
              >
                Liste
              </button>
              <button
                type="button"
                aria-pressed={activePane === 'timeline'}
                onClick={() => setActivePane('timeline')}
              >
                Timeline
              </button>
            </div>
          </div>
        )}
        {(() => {
          // Layout für die linke Liste anhand der aktuellen Breite. Im Narrow-
          // Mode tut sich nichts (volle Breite), wir nutzen einfach die Standard-
          // Breite für die Layout-Berechnung. Sonst hängt's am leftColWidth.
          const colLayout = leftColLayout(isNarrow ? DEFAULT_LEFT_COL_WIDTH : leftColWidth);
          return (
        <div style={{ flex: 1, display: 'flex', minHeight: 0, minWidth: 0 }}>
          {/* ─── LINKE PANE: Spalten-Header + Task-Liste ──────────────
              Im Wide-Mode mit leftListCollapsed=true wird die Pane gar nicht
              gerendert — der Splitter bleibt sichtbar damit man sie wieder
              einblenden kann. */}
          {(!isNarrow || activePane === 'list') && !(leftListCollapsed && !isNarrow) && (
          <div
            style={{
              width: isNarrow ? '100%' : leftColWidth,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              // Im Wide-Mode visualisiert der Splitter (sibling) die Trennlinie.
              borderRight: 'none',
              minHeight: 0,
            }}
          >
            <div
              style={{
                height: HEADER_HEIGHT,
                flexShrink: 0,
                background: 'var(--color-surface-3)',
                borderBottom: '1px solid var(--color-border-2)',
                display: 'grid',
                gridTemplateColumns: colLayout.template,
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--color-ink-2)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              <ColHead />
              <ColHead>ID</ColHead>
              <ColHead>Aufgabe</ColHead>
              {colLayout.showDauer && <ColHead right>Dauer</ColHead>}
              {colLayout.showStart && <ColHead>Start</ColHead>}
              <ColHead>Ende</ColHead>
              <ColHead center last>Zust.</ColHead>
            </div>
            <div
              ref={leftListRef}
              onScroll={onLeftScroll}
              className="scroll-host"
              style={{
                flex: 1,
                overflowY: 'auto',
                overflowX: 'hidden',
                background: 'var(--color-surface)',
              }}
            >
              {milestones.length > 0 && (() => {
                const withDate = milestones.filter((m) => m.date !== null);
                const withoutDate = milestones.filter((m) => m.date === null);
                return (
                  <div
                    className="tbl-row"
                    title={
                      withoutDate.length > 0
                        ? `Ohne Termin in GitLab: ${withoutDate.map((m) => `%${m.gitlabMilestoneId} ${m.text}`).join(', ')}`
                        : undefined
                    }
                    style={{
                      height: rowH,
                      background: 'var(--color-surface-2)',
                      display: 'grid',
                      gridTemplateColumns: colLayout.template,
                      color: 'var(--color-ink-3)',
                      fontStyle: 'italic',
                      fontSize: 11,
                    }}
                  >
                    <span />
                    <span />
                    <span style={{ padding: '0 8px', display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                      <Diamond size={11} style={{ color: 'var(--color-status-milestone)' }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        Meilensteine ({withDate.length}
                        {withoutDate.length > 0 ? ` · ${withoutDate.length} ohne Termin` : ''})
                      </span>
                    </span>
                    {/* Trailing-Spans entsprechend der aktiven Spalten-Anzahl */}
                    {Array.from({
                      length:
                        2 + (colLayout.showDauer ? 1 : 0) + (colLayout.showStart ? 1 : 0),
                    }).map((_, i) => (
                      <span key={i} />
                    ))}
                  </div>
                );
              })()}
              {visibleNodes.map((node, i) => (
                <TaskRow
                  key={node.bar.id}
                  bar={node.bar}
                  index={i}
                  rowH={rowH}
                  depth={node.depth}
                  hasChildren={node.hasChildren}
                  collapsed={collapsed.has(node.bar.id)}
                  onToggleCollapse={toggleCollapse}
                  isSelected={selectedId === node.bar.id}
                  onSelect={handleTaskClick}
                  onHover={setHoveredId}
                  pickerActive={
                    pickerMode !== null && pickerMode.sourceId !== node.bar.id
                  }
                  pickerSource={pickerMode?.sourceId === node.bar.id}
                  hasConflict={conflictedWpIds.has(node.bar.id)}
                  colLayout={colLayout}
                />
              ))}
              {/* Spacer für horizontalen Scrollbar der rechten Pane,
                  damit beide vertikal exakt gleich enden */}
              <div style={{ height: 10 }} />
            </div>
          </div>
          )}

          {/* ─── Splitter zwischen den Panes ─────────────────────────
              Im Narrow-Mode (Tab-Switch) entfällt der Splitter weil nur
              eine Pane gleichzeitig sichtbar ist. Visualisierung über
              das ::before-Pseudo-Element (sichtbare 1px-Linie immer da,
              wird bei :hover/:active dicker + orange). */}
          {!isNarrow && (
            <div
              onMouseDown={leftListCollapsed ? undefined : startLeftColResize}
              role="separator"
              aria-orientation="vertical"
              aria-label="Listen-Breite verstellen"
              title={leftListCollapsed ? undefined : 'Linke Liste verstellen (Drag)'}
              className={`gantt-splitter${leftListCollapsed ? ' gantt-splitter--collapsed' : ''}`}
            >
              <button
                type="button"
                className="gantt-splitter__toggle"
                aria-label={leftListCollapsed ? 'Liste einblenden' : 'Liste ausblenden'}
                title={leftListCollapsed ? 'Liste einblenden' : 'Liste ausblenden'}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setLeftListCollapsed((v) => !v);
                }}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  aria-hidden="true"
                  style={{
                    transform: leftListCollapsed ? 'rotate(180deg)' : undefined,
                    transition: 'transform .15s',
                  }}
                >
                  <path
                    d="M6.5 1L2.5 5L6.5 9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          )}

          {/* ─── RECHTE PANE: Datums-Achse + SVG-Timeline ───────────── */}
          {(!isNarrow || activePane === 'timeline') && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              minHeight: 0,
            }}
          >
            <div
              ref={topRightRef}
              style={{
                height: HEADER_HEIGHT,
                flexShrink: 0,
                overflow: 'hidden',
                background: 'var(--color-surface-3)',
                borderBottom: '1px solid var(--color-border-2)',
              }}
            >
              <div style={{ width: timelineWidth }}>
                <DateAxisHeader range={range} zoom={zoom} pxPerDay={pxPerDay} width={timelineWidth} />
              </div>
            </div>
            <div
              ref={rightBodyRef}
              onScroll={onRightScroll}
              className="scroll-host"
              onClick={(e) => {
                // Klick auf leeren Bereich (nicht auf Bar/Diamond/etc.) →
                // Inspector schliessen. Bars+Milestones markieren ihre eigene
                // <g>-Hülle mit data-interactive="1" — Klicks darin werden
                // ignoriert (deren eigener onClick übernimmt die Selektion).
                // Im Picker-Modus nicht clearen damit Cancel via Inspector
                // erreichbar bleibt. Verhalten via User-Setting abschaltbar.
                if (pickerMode) return;
                if (initialDisplay?.closeInspectorOnEmptyClick === false) return;
                const target = e.target as Element | null;
                if (target && target.closest('[data-interactive="1"]')) return;
                setSelectedId(null);
                setSelectedMilestoneId(null);
                setInspectorOpen(false);
              }}
              style={{
                flex: 1,
                overflow: 'auto',
              }}
            >
            <svg
              width={timelineWidth}
              height={timelineHeight}
              style={{ display: 'block' }}
            >
              {/* Clip-Paths pro Bar, damit Text nicht überläuft */}
              <defs>
                <marker
                  id="dep-arrow"
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="4"
                  orient="auto"
                  markerUnits="userSpaceOnUse"
                >
                  <polygon points="0 0, 8 4, 0 8" fill="#76746c" />
                </marker>
                <marker
                  id="dep-arrow-crit"
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="4"
                  orient="auto"
                  markerUnits="userSpaceOnUse"
                >
                  <polygon points="0 0, 8 4, 0 8" fill="#b42318" />
                </marker>
                {/* Schraffur-Pattern für Baseline-Bars. Diagonale Striche
                    sind eindeutig nicht mit Dependency-Pfeilen verwechselbar. */}
                <pattern
                  id="baseline-hatch"
                  patternUnits="userSpaceOnUse"
                  width="5"
                  height="5"
                  patternTransform="rotate(45)"
                >
                  <rect width="5" height="5" fill="#e7e5e4" />
                  <line x1="0" y1="0" x2="0" y2="5" stroke="#57534e" strokeWidth="1.5" />
                </pattern>
                {visibleNodes.map((node, i) => {
                  const bar = node.bar;
                  const rowIdx = milestoneRowCount + i;
                  const eff = effectiveDates(bar);
                  const x = diffDays(range.start, startOfDay(eff.start)) * pxPerDay;
                  const rawWidth =
                    (diffDays(startOfDay(eff.start), startOfDay(eff.end)) + 1) * pxPerDay;
                  const width = Math.max(3, rawWidth);
                  const y = rowIdx * rowH + barPadY;
                  return (
                    <clipPath key={`clip-${bar.id}`} id={`bar-clip-${bar.id}`}>
                      <rect x={x + 4} y={y} width={Math.max(0, width - 8)} height={barH} />
                    </clipPath>
                  );
                })}
              </defs>
              <Background
                range={range}
                pxPerDay={pxPerDay}
                zoom={zoom}
                height={timelineHeight}
                showWeekends={showWeekends}
              />

              {/* Hover-Highlight (synchron mit linker Liste) */}
              {hoveredId && (() => {
                const idx = visibleNodes.findIndex((n) => n.bar.id === hoveredId);
                if (idx === -1) return null;
                const rowIdx = milestoneRowCount + idx;
                return (
                  <rect
                    x={0}
                    y={rowIdx * rowH}
                    width={timelineWidth}
                    height={rowH}
                    fill="var(--color-hover)"
                    pointerEvents="none"
                  />
                );
              })()}

              {/* Row-Trennlinien */}
              {Array.from({ length: totalRows }).map((_, i) => (
                <line
                  key={i}
                  x1={0}
                  x2={timelineWidth}
                  y1={(i + 1) * rowH}
                  y2={(i + 1) * rowH}
                  stroke="var(--color-grid-line)"
                  strokeWidth={1}
                  pointerEvents="none"
                />
              ))}

              {todayX !== null && (
                <line
                  x1={todayX}
                  x2={todayX}
                  y1={0}
                  y2={timelineHeight}
                  stroke="var(--color-today-line)"
                  strokeWidth={1.5}
                  pointerEvents="none"
                />
              )}

              {milestoneDayGroups.map(([key, group]) => {
                const date = group[0].date as Date;
                const x = diffDays(range.start, startOfDay(date)) * pxPerDay;
                const y = rowH / 2;
                const count = group.length;
                const titleText = group
                  .map((m) => `%${m.gitlabMilestoneId} ${m.text}`)
                  .join('\n');
                // Click: bei einzelnem Meilenstein direkt öffnen, bei
                // Cluster (count > 1) Auswahl-Popover anzeigen.
                return (
                  <g
                    key={key}
                    data-interactive="1"
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => onMilestoneClusterClick(group, e.currentTarget)}
                  >
                    <polygon
                      points={`${x},${y - MILESTONE_SIZE / 2} ${x + MILESTONE_SIZE / 2},${y} ${x},${y + MILESTONE_SIZE / 2} ${x - MILESTONE_SIZE / 2},${y}`}
                      fill={selectedMilestoneId === group[0].id ? 'var(--color-accent)' : 'var(--color-status-milestone)'}
                      stroke="#713f12"
                      strokeWidth={1}
                    />
                    {count > 1 && (
                      <>
                        <circle
                          cx={x + MILESTONE_SIZE / 2 + 2}
                          cy={y - MILESTONE_SIZE / 2 - 2}
                          r={6}
                          fill="#b42318"
                          stroke="#fff"
                          strokeWidth={1}
                        />
                        <text
                          x={x + MILESTONE_SIZE / 2 + 2}
                          y={y - MILESTONE_SIZE / 2 - 2}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={8}
                          fontWeight={700}
                          fill="#fff"
                          style={{ pointerEvents: 'none', userSelect: 'none' }}
                        >
                          {count}
                        </text>
                      </>
                    )}
                    <title>
                      {fmtDateShort(date)} ({count}× Meilenstein){'\n'}
                      {titleText}
                    </title>
                  </g>
                );
              })}

              {/* Dependency-Pfeile zwischen Bars (FS/SS/FF/SF) */}
              {showDeps && (() => {
                const posByBarId = new Map<string, { x: number; width: number; rowIdx: number }>();
                visibleNodes.forEach((node, i) => {
                  const rowIdx = milestoneRowCount + i;
                  const eff = effectiveDates(node.bar);
                  const x = diffDays(range.start, startOfDay(eff.start)) * pxPerDay;
                  const rawWidth =
                    (diffDays(startOfDay(eff.start), startOfDay(eff.end)) + 1) * pxPerDay;
                  const width = Math.max(3, rawWidth);
                  posByBarId.set(node.bar.id, { x, width, rowIdx });
                });
                return dependencies.map((dep) => {
                  const pred = posByBarId.get(dep.predecessorId);
                  const succ = posByBarId.get(dep.successorId);
                  if (!pred || !succ) return null;
                  const isCritical =
                    showCrit &&
                    dep.type === 'FS' &&
                    criticalIds.has(dep.predecessorId) &&
                    criticalIds.has(dep.successorId);
                  return (
                    <DependencyArrow
                      key={dep.id}
                      type={dep.type}
                      pred={pred}
                      succ={succ}
                      rowH={rowH}
                      barH={barH}
                      barPadY={barPadY}
                      critical={isCritical}
                    />
                  );
                });
              })()}

              {visibleNodes.map((node, i) => {
                const bar = node.bar;
                const rowIdx = milestoneRowCount + i;
                const eff = effectiveDates(bar);
                const x = diffDays(range.start, startOfDay(eff.start)) * pxPerDay;
                const rawWidth =
                  (diffDays(startOfDay(eff.start), startOfDay(eff.end)) + 1) * pxPerDay;
                const width = Math.max(3, rawWidth);
                const y = rowIdx * rowH + barPadY;
                const colors = barColor(bar.state, bar.isSummary);
                const progressWidth = width * Math.min(1, Math.max(0, bar.progress));
                const radius = bar.isSummary ? 1 : 3;
                const isSelected = selectedId === bar.id;
                const isDragging = drag?.id === bar.id;
                const isCritical = showCrit && criticalIds.has(bar.id);
                const edgeSize = bar.isSummary ? 0 : Math.min(8, width / 3);
                const canDrag = !bar.isSummary;

                // Baseline (Plan-Bar) wenn aktiviert und beide Felder
                // gesetzt. Schmale graue Bar unter der Hauptbar im
                // Padding-Bereich.
                const renderBaseline =
                  showBaseline &&
                  !bar.isSummary &&
                  bar.baselineStart &&
                  bar.baselineEnd;
                let baselineX = 0;
                let baselineWidth = 0;
                if (renderBaseline) {
                  baselineX = diffDays(range.start, startOfDay(bar.baselineStart!)) * pxPerDay;
                  baselineWidth = Math.max(
                    2,
                    (diffDays(
                      startOfDay(bar.baselineStart!),
                      startOfDay(bar.baselineEnd!),
                    ) + 1) * pxPerDay,
                  );
                }
                // Baseline-Höhe so dass sie noch in den Row-Padding-Bereich
                // unter der Hauptbar passt. Bei compact (rowH=24, barH=14)
                // bleiben unten 5px Padding → 4px Baseline + 1px Lücke passt.
                const baselineH = 4;
                const baselineY = y + barH + 1;

                return (
                  <g
                    key={bar.id}
                    data-interactive="1"
                    style={{ cursor: pickerMode ? 'crosshair' : canDrag ? 'grab' : 'pointer' }}
                    onClick={() => {
                      // Click ohne Drag-Movement = nur Selektion / Picker
                      if (!isDragging) handleTaskClick(bar.id);
                    }}
                  >
                    {/* Baseline-Bar (schmal, grau, unter der Hauptbar). Wenn
                        die Baseline mit dem aktuellen Stand identisch ist,
                        liegt sie genau unter der Hauptbar — sichtbar wird
                        sie nur bei Abweichung (links/rechts hängend). */}
                    {renderBaseline && (
                      <rect
                        x={baselineX}
                        y={baselineY}
                        width={baselineWidth}
                        height={baselineH}
                        rx={1}
                        ry={1}
                        fill="url(#baseline-hatch)"
                        stroke="#57534e"
                        strokeWidth={0.5}
                        pointerEvents="none"
                      >
                        <title>
                          {`Plan: ${fmtDateShort(bar.baselineStart!)} – ${fmtDateShort(bar.baselineEnd!)}`}
                        </title>
                      </rect>
                    )}
                    {/* Critical-Halo (unter Selection-Halo damit Selection sichtbar bleibt) */}
                    {isCritical && (
                      <rect
                        x={x - 2}
                        y={y - 2}
                        width={width + 4}
                        height={barH + 4}
                        rx={radius + 2}
                        ry={radius + 2}
                        fill="none"
                        stroke="var(--color-status-blocked)"
                        strokeWidth={2}
                      />
                    )}
                    {/* Selection-Halo */}
                    {isSelected && (
                      <rect
                        x={x - 2}
                        y={y - 2}
                        width={width + 4}
                        height={barH + 4}
                        rx={radius + 2}
                        ry={radius + 2}
                        fill="none"
                        stroke="var(--color-accent)"
                        strokeWidth={1.5}
                      />
                    )}
                    <rect
                      x={x}
                      y={y}
                      width={width}
                      height={barH}
                      rx={radius}
                      ry={radius}
                      fill={colors.fill}
                      stroke={colors.stroke}
                      strokeWidth={0.5}
                    />
                    {progressWidth > 0 && (
                      <rect
                        x={x}
                        y={y}
                        width={progressWidth}
                        height={barH}
                        rx={radius}
                        ry={radius}
                        fill={colors.progress}
                      />
                    )}
                    {/* Endmarken bei Summary-Bars */}
                    {bar.isSummary && (
                      <>
                        <polygon
                          points={`${x},${y + barH} ${x},${y} ${x + 4},${y + barH}`}
                          fill={colors.fill}
                        />
                        <polygon
                          points={`${x + width},${y + barH} ${x + width},${y} ${x + width - 4},${y + barH}`}
                          fill={colors.fill}
                        />
                      </>
                    )}
                    {/* Bar-Label */}
                    {width >= 40 && (
                      <text
                        x={x + 6}
                        y={y + barH / 2}
                        dominantBaseline="central"
                        fontSize={barH >= 18 ? 11 : 10}
                        fontWeight={500}
                        fill="#ffffff"
                        clipPath={`url(#bar-clip-${bar.id})`}
                        style={{ pointerEvents: 'none', userSelect: 'none' }}
                      >
                        {width < 90
                          ? `#${bar.gitlabIssueIid}`
                          : `#${bar.gitlabIssueIid}  ${bar.text}`}
                      </text>
                    )}
                    <title>
                      {bar.text}
                      {'\n'}
                      {fmtDateShort(eff.start)} – {fmtDateShort(eff.end)}
                      {'\n'}
                      Progress: {Math.round(bar.progress * 100)}%
                    </title>

                    {/* Drag / Resize Interaction Zones (transparent overlays) */}
                    {canDrag && (
                      <>
                        {edgeSize > 2 && (
                          <rect
                            x={x}
                            y={y}
                            width={edgeSize}
                            height={barH}
                            fill="transparent"
                            style={{ cursor: 'ew-resize' }}
                            onPointerDown={(e) => {
                              if (e.button !== 0) return;
                              e.stopPropagation();
                              startDrag(bar, 'left', e.clientX);
                            }}
                          />
                        )}
                        <rect
                          x={x + edgeSize}
                          y={y}
                          width={Math.max(0, width - 2 * edgeSize)}
                          height={barH}
                          fill="transparent"
                          style={{ cursor: 'grab' }}
                          onPointerDown={(e) => {
                            if (e.button !== 0) return;
                            e.stopPropagation();
                            startDrag(bar, 'move', e.clientX);
                          }}
                        />
                        {edgeSize > 2 && (
                          <rect
                            x={x + width - edgeSize}
                            y={y}
                            width={edgeSize}
                            height={barH}
                            fill="transparent"
                            style={{ cursor: 'ew-resize' }}
                            onPointerDown={(e) => {
                              if (e.button !== 0) return;
                              e.stopPropagation();
                              startDrag(bar, 'right', e.clientX);
                            }}
                          />
                        )}
                      </>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
          )}
      </div>
          );
        })()}

      {/* ─── Status-Bar ─────────────────────────────────────── */}
      <div
        style={{
          height: 28,
          flexShrink: 0,
          background: 'var(--color-surface-2)',
          borderTop: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          gap: 16,
          fontSize: 11,
          color: 'var(--color-ink-2)',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="mono tabnum">{filteredBars.length}/{counts.total + counts.milestones}</span>
          <span style={{ color: 'var(--color-ink-3)' }}>sichtbar</span>
        </span>
        <StatusBarCount
          label="offen"
          count={counts.open}
          icon={<span className="dot dot--open" />}
          active={statusBarPopover === 'open'}
          onClick={() => setStatusBarPopover((p) => (p === 'open' ? null : 'open'))}
        >
          {statusBarPopover === 'open' && (
            <StatusBarPopover title={`${openBars.length} offene Aufgaben`}>
              {openBars.map((b) => (
                <PopoverWpRow
                  key={b.id}
                  bar={b}
                  onClick={() => jumpToBar(b.id)}
                  showEnd
                />
              ))}
            </StatusBarPopover>
          )}
        </StatusBarCount>
        <StatusBarCount
          label="fertig"
          count={counts.done}
          icon={<span className="dot dot--done" />}
          active={statusBarPopover === 'done'}
          onClick={() => setStatusBarPopover((p) => (p === 'done' ? null : 'done'))}
        >
          {statusBarPopover === 'done' && (
            <StatusBarPopover title={`${doneBars.length} fertige Aufgaben`}>
              {doneBars.map((b) => (
                <PopoverWpRow key={b.id} bar={b} onClick={() => jumpToBar(b.id)} />
              ))}
            </StatusBarPopover>
          )}
        </StatusBarCount>
        <StatusBarCount
          label="Meilensteine"
          count={counts.milestones}
          icon={<Diamond size={10} style={{ color: 'var(--color-status-milestone)' }} />}
          active={statusBarPopover === 'milestones'}
          onClick={() =>
            setStatusBarPopover((p) => (p === 'milestones' ? null : 'milestones'))
          }
        >
          {statusBarPopover === 'milestones' && (
            <StatusBarPopover title={`${milestonesSorted.length} Meilensteine`}>
              {milestonesSorted.map((m) => (
                <PopoverMilestoneRow
                  key={m.id}
                  milestone={m}
                  onClick={() => jumpToMilestone(m.id)}
                />
              ))}
            </StatusBarPopover>
          )}
        </StatusBarCount>
        {dependencyConflicts.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="statusbar-trigger"
              onClick={() =>
                setStatusBarPopover((p) => (p === 'conflicts' ? null : 'conflicts'))
              }
              aria-expanded={statusBarPopover === 'conflicts'}
              title="Alle Konflikte anzeigen"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '2px 6px',
                margin: '-2px -6px',
                border: 'none',
                background:
                  statusBarPopover === 'conflicts' ? 'var(--color-surface-3)' : 'transparent',
                cursor: 'pointer',
                fontSize: 11,
                fontFamily: 'inherit',
                color: 'var(--color-status-blocked)',
                fontWeight: 600,
                borderRadius: 'var(--r-2)',
              }}
            >
              <AlertTriangle size={10} />
              <span className="mono tabnum">{dependencyConflicts.length}</span>
              <span>Konflikt{dependencyConflicts.length === 1 ? '' : 'e'}</span>
            </button>
            {statusBarPopover === 'conflicts' && (
              <div
                className="statusbar-popover"
                role="dialog"
                aria-label="Dependency-Konflikte"
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 6px)',
                  left: 0,
                  width: 'min(480px, 90vw)',
                  maxHeight: 'min(60vh, 400px)',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--r-3)',
                  boxShadow: 'var(--shadow-2)',
                  zIndex: 70,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--color-border)',
                    background: 'var(--color-surface-2)',
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--color-status-blocked)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <AlertTriangle size={11} />
                  <span>{dependencyConflicts.length} Konflikte</span>
                </div>
                <div style={{ overflowY: 'auto' }}>
                  {dependencyConflicts.map((c) => {
                    const succ = bars.find((b) => b.id === c.successorId);
                    const pred = bars.find((b) => b.id === c.predecessorId);
                    if (!succ) return null;
                    return (
                      <button
                        key={c.dependencyId}
                        type="button"
                        onClick={() => jumpToBar(c.successorId)}
                        className="bell-row"
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                          width: '100%',
                          padding: '10px 12px',
                          border: 'none',
                          borderTop: '1px solid var(--color-border)',
                          background: 'transparent',
                          cursor: 'pointer',
                          textAlign: 'left',
                          fontFamily: 'inherit',
                          fontSize: 12,
                          color: 'var(--color-ink)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span
                            className="mono"
                            style={{ fontSize: 11, color: 'var(--color-ink-3)' }}
                          >
                            #{succ.gitlabIssueIid}
                          </span>
                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {succ.text}
                          </span>
                          <span
                            className="mono"
                            style={{
                              fontSize: 10,
                              padding: '1px 5px',
                              background: '#fef2f2',
                              color: 'var(--color-status-blocked)',
                              borderRadius: 3,
                              fontWeight: 600,
                              flexShrink: 0,
                            }}
                          >
                            {c.type}
                            {c.lagDays !== 0 ? `+${c.lagDays}d` : ''}
                          </span>
                          <span
                            className="mono"
                            style={{
                              fontSize: 10,
                              color: 'var(--color-status-blocked)',
                              fontWeight: 600,
                              flexShrink: 0,
                            }}
                          >
                            {c.daysOverlap}d
                          </span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--color-ink-3)', paddingLeft: 22 }}>
                          {c.successorField === 'start' ? 'Start' : 'Ende'} vor erwartetem{' '}
                          {fmtDateShort(c.expectedDate)}
                          {pred && (
                            <>
                              {' — Vorgänger '}
                              <span className="mono">#{pred.gitlabIssueIid}</span> {pred.text}
                            </>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
        <div style={{ flex: 1 }} />
        {/* Manueller Zoom: -/+ Buttons + Slider + Reset (wenn Override aktiv) */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {/* Auf aktuelle Auswahl zentrieren — WP oder Milestone */}
          <button
            type="button"
            onClick={() => {
              if (selectedId) {
                scrollToBarId(selectedId, { force: true });
              } else if (selectedMilestoneId) {
                scrollToMilestoneId(selectedMilestoneId);
              }
            }}
            disabled={!selectedId && !selectedMilestoneId}
            title={
              selectedId
                ? 'Auf ausgewählte Aufgabe zentrieren'
                : selectedMilestoneId
                  ? 'Auf ausgewählten Meilenstein zentrieren'
                  : 'Keine Auswahl'
            }
            aria-label="Auswahl zentrieren"
            style={{
              width: 18,
              height: 18,
              padding: 0,
              border: '1px solid var(--color-border-2)',
              background: 'var(--color-surface)',
              borderRadius: 'var(--r-1)',
              cursor:
                !selectedId && !selectedMilestoneId ? 'not-allowed' : 'pointer',
              opacity: !selectedId && !selectedMilestoneId ? 0.4 : 1,
              color: 'var(--color-ink-2)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Crosshair size={11} />
          </button>
          <button
            type="button"
            onClick={() => adjustZoom(1 / 1.25)}
            title="Verkleinern"
            aria-label="Zoom verkleinern"
            disabled={pxPerDay <= MIN_PX_PER_DAY + 0.01}
            style={{
              width: 18,
              height: 18,
              padding: 0,
              border: '1px solid var(--color-border-2)',
              background: 'var(--color-surface)',
              borderRadius: 'var(--r-1)',
              cursor: pxPerDay <= MIN_PX_PER_DAY + 0.01 ? 'not-allowed' : 'pointer',
              fontSize: 11,
              lineHeight: 1,
              color: 'var(--color-ink-2)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Minus size={11} />
          </button>
          <input
            type="range"
            min={MIN_PX_PER_DAY}
            max={MAX_PX_PER_DAY}
            step={0.5}
            value={pxPerDay}
            onChange={(e) => setManualPxPerDay(Number(e.target.value))}
            aria-label="Zoom-Slider"
            style={{ width: 100, accentColor: 'var(--color-accent)' }}
          />
          <button
            type="button"
            onClick={() => adjustZoom(1.25)}
            title="Vergrößern"
            aria-label="Zoom vergrößern"
            disabled={pxPerDay >= MAX_PX_PER_DAY - 0.01}
            style={{
              width: 18,
              height: 18,
              padding: 0,
              border: '1px solid var(--color-border-2)',
              background: 'var(--color-surface)',
              borderRadius: 'var(--r-1)',
              cursor: pxPerDay >= MAX_PX_PER_DAY - 0.01 ? 'not-allowed' : 'pointer',
              fontSize: 11,
              lineHeight: 1,
              color: 'var(--color-ink-2)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Plus size={11} />
          </button>
          <button
            type="button"
            onClick={() => setManualPxPerDay(null)}
            disabled={manualPxPerDay === null}
            title={
              manualPxPerDay === null
                ? 'Zoom ist auf Auto (Preset-basiert)'
                : 'Zoom auf Preset zurücksetzen'
            }
            aria-label="Zoom auf Auto zurücksetzen"
            style={{
              padding: '0 4px',
              height: 18,
              border: '1px solid var(--color-border-2)',
              background: 'var(--color-surface)',
              borderRadius: 'var(--r-1)',
              cursor: manualPxPerDay === null ? 'not-allowed' : 'pointer',
              opacity: manualPxPerDay === null ? 0.4 : 1,
              fontSize: 10,
              color: 'var(--color-ink-3)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <RotateCcw size={9} />
            auto
          </button>
          {/* Label-Block mit FIXED width damit Schwankungen der px/d-Zahl
              (z.B. 9.0 → 11.6) nicht die Slider/Buttons links davon
              verschieben. Numerische Teile als inline-block mit fester
              Breite + tabnum für konsistente Zifferpositionen. */}
          <span
            className="mono"
            style={{
              color: 'var(--color-ink-3)',
              width: 150,
              textAlign: 'right',
              flexShrink: 0,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            {ZOOMS[zoom].label}
            {' · '}
            <span style={{ display: 'inline-block', width: 38, textAlign: 'right' }}>
              {pxPerDay.toFixed(1)}
            </span>
            {' px/d'}
          </span>
        </div>
      </div>
        </div>
        {(() => {
          if (!inspectorOpen) return null;
          // Milestone-Inspector wird angezeigt wenn ein Diamant ausgewählt
          // ist. Create-Flow läuft über NewMilestoneButton im SubHeader
          // (eigener Modal-Dialog), nicht über den Slide-Out.
          const selectedMs = selectedMilestoneId
            ? milestones.find((m) => m.id === selectedMilestoneId) ?? null
            : null;

          const inspectorEl = selectedMs ? (
            <MilestoneInspector
              mode={{
                kind: 'edit',
                milestone: {
                  id: selectedMs.id,
                  gitlabMilestoneId: selectedMs.gitlabMilestoneId,
                  title: selectedMs.text,
                  description: selectedMs.description ?? null,
                  dueDate: selectedMs.date,
                  state: selectedMs.state ?? 'active',
                  isGroupMilestone: selectedMs.isGroupMilestone ?? false,
                } satisfies MilestoneForInspector,
              }}
              projectInternalId={projectInternalId}
              gitlabBaseUrl={gitlabBaseUrl}
              gitlabProjectPath={gitlabProjectPath}
              allBars={bars}
              onJumpToBar={jumpToBar}
              onClose={closeMilestoneInspector}
              fullWidth={isNarrow}
              width={inspectorWidth}
            />
          ) : (
            <Inspector
              task={selectedBar}
              allBars={bars}
              dependencies={dependencies}
              conflicts={dependencyConflicts.filter(
                (c) => c.successorId === selectedId,
              )}
              knownAssignees={knownAssignees}
              knownLabels={knownLabels}
              pickerActive={pickerMode !== null}
              onStartPickParent={startPickParent}
              onStartPickDependency={startPickDependency}
              onClose={() => setInspectorOpen(false)}
              gitlabBaseUrl={gitlabBaseUrl}
              gitlabProjectPath={gitlabProjectPath}
              fullWidth={isNarrow}
              width={inspectorWidth}
            />
          );

          if (isNarrow) {
            return (
              <div
                className="inspector-drawer-backdrop"
                onClick={() => {
                  setInspectorOpen(false);
                  closeMilestoneInspector();
                }}
                role="presentation"
              >
                <div
                  className="inspector-drawer"
                  onClick={(e) => e.stopPropagation()}
                  role="dialog"
                  aria-label="Inspektor"
                >
                  {inspectorEl}
                </div>
              </div>
            );
          }
          // Wide-Mode: Splitter zwischen Gantt-Pane und Inspector damit der
          // User die Inspector-Breite per Drag verstellen kann (analog zur
          // linken Liste).
          return (
            <>
              <div
                onMouseDown={startInspectorResize}
                role="separator"
                aria-orientation="vertical"
                aria-label="Inspector-Breite verstellen"
                title="Inspector-Breite verstellen (Drag)"
                className="gantt-splitter"
              />
              {inspectorEl}
            </>
          );
        })()}
      </div>
      {clusterPicker && (
        <div
          className="milestone-cluster-picker"
          role="dialog"
          aria-label="Meilenstein wählen"
          style={{
            position: 'fixed',
            top: clusterPicker.screenY,
            left: clusterPicker.screenX,
            transform: 'translateX(-50%)',
            minWidth: 240,
            maxWidth: 360,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--r-3)',
            boxShadow: 'var(--shadow-2)',
            zIndex: 70,
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <div
            style={{
              padding: '6px 10px',
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--color-ink-3)',
            }}
          >
            {clusterPicker.items.length} Meilensteine an diesem Tag
          </div>
          {clusterPicker.items.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => selectMilestone(m.id)}
              className="bell-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 12,
                fontFamily: 'inherit',
                color: 'var(--color-ink)',
                textAlign: 'left',
                borderRadius: 'var(--r-2)',
                width: '100%',
              }}
            >
              <Diamond
                size={11}
                style={{
                  color:
                    m.state === 'closed'
                      ? 'var(--color-ink-4)'
                      : 'var(--color-status-milestone)',
                  flexShrink: 0,
                }}
              />
              <span
                className="mono"
                style={{ fontSize: 10, color: 'var(--color-ink-3)', flexShrink: 0 }}
              >
                %{m.gitlabMilestoneId}
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  textDecoration: m.state === 'closed' ? 'line-through' : 'none',
                  color: m.state === 'closed' ? 'var(--color-ink-3)' : 'var(--color-ink)',
                }}
              >
                {m.text}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>

    {/* Print-View: in einem Portal direkt am <body> verankert damit das
        App-Layout sie nie wahrnimmt. Visibility wird über @media print
        gesteuert — Live-View hidden im Print-Modus, Print-Mount sichtbar.
        Inline-display:none als Sicherheitsnetz falls die CSS-Regel zu spät
        lädt oder von einer anderen Regel überschrieben wird. */}
    {printing && typeof document !== 'undefined' &&
      createPortal(
        <div className="gantt-print-mount" style={{ display: 'none' }}>
          <GanttPrintView
            bars={bars}
            milestones={milestones}
            dependencies={dependencies ?? []}
            projectName={gitlabProjectPath ?? 'Projekt'}
          />
        </div>,
        document.body,
      )}
    </>
  );
}

// ─── Sub-Komponenten ────────────────────────────────────────────────────────

// Klickbarer Count in der Status-Bar (offen/fertig/Meilensteine). Wrap-Div
// dient als position:relative-Anker für ein optional als child gerendertes
// Popover.
function StatusBarCount({
  label,
  count,
  icon,
  active,
  onClick,
  children,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="statusbar-trigger"
        onClick={onClick}
        aria-expanded={active}
        title={`${count} ${label} — Liste anzeigen`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 6px',
          margin: '-2px -6px',
          border: 'none',
          background: active ? 'var(--color-surface-3)' : 'transparent',
          cursor: 'pointer',
          fontSize: 11,
          fontFamily: 'inherit',
          color: 'var(--color-ink-2)',
          borderRadius: 'var(--r-2)',
        }}
      >
        {icon}
        <span className="mono tabnum">{count}</span>
        <span>{label}</span>
      </button>
      {children}
    </div>
  );
}

// Generischer Popover-Container für die Status-Bar (oben-rechts vom Trigger).
function StatusBarPopover({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="statusbar-popover"
      role="dialog"
      aria-label={title}
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 6px)',
        left: 0,
        width: 'min(440px, 90vw)',
        maxHeight: 'min(60vh, 400px)',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--r-3)',
        boxShadow: 'var(--shadow-2)',
        zIndex: 70,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface-2)',
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--color-ink-2)',
        }}
      >
        {title}
      </div>
      <div style={{ overflowY: 'auto' }}>{children}</div>
    </div>
  );
}

function PopoverWpRow({
  bar,
  onClick,
  showEnd,
}: {
  bar: GanttBar;
  onClick: () => void;
  showEnd?: boolean;
}) {
  const endStr = showEnd ? fmtDateShort(bar.end) : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="bell-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '8px 12px',
        border: 'none',
        borderTop: '1px solid var(--color-border)',
        background: 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'inherit',
        fontSize: 12,
        color: 'var(--color-ink)',
      }}
    >
      <span
        className={`dot ${bar.state === 'closed' ? 'dot--done' : 'dot--open'}`}
        style={{ flexShrink: 0 }}
      />
      <span className="mono" style={{ fontSize: 10, color: 'var(--color-ink-3)', flexShrink: 0 }}>
        #{bar.gitlabIssueIid}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textDecoration: bar.state === 'closed' ? 'line-through' : 'none',
          color: bar.state === 'closed' ? 'var(--color-ink-3)' : 'var(--color-ink)',
        }}
      >
        {bar.text}
      </span>
      {endStr && (
        <span
          className="mono"
          style={{ fontSize: 10, color: 'var(--color-ink-3)', flexShrink: 0 }}
        >
          {endStr}
        </span>
      )}
    </button>
  );
}

function PopoverMilestoneRow({
  milestone,
  onClick,
}: {
  milestone: GanttMilestone;
  onClick: () => void;
}) {
  const isClosed = milestone.state === 'closed';
  return (
    <button
      type="button"
      onClick={onClick}
      className="bell-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '8px 12px',
        border: 'none',
        borderTop: '1px solid var(--color-border)',
        background: 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'inherit',
        fontSize: 12,
        color: 'var(--color-ink)',
      }}
    >
      <Diamond
        size={11}
        style={{
          color: isClosed ? 'var(--color-ink-4)' : 'var(--color-status-milestone)',
          flexShrink: 0,
        }}
      />
      <span className="mono" style={{ fontSize: 10, color: 'var(--color-ink-3)', flexShrink: 0 }}>
        %{milestone.gitlabMilestoneId}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textDecoration: isClosed ? 'line-through' : 'none',
          color: isClosed ? 'var(--color-ink-3)' : 'var(--color-ink)',
        }}
      >
        {milestone.text}
      </span>
      <span className="mono" style={{ fontSize: 10, color: 'var(--color-ink-3)', flexShrink: 0 }}>
        {milestone.date ? fmtDateShort(milestone.date) : 'kein Datum'}
      </span>
    </button>
  );
}

// Hierarchie-Tools — werden auf ≥1200px in der Ribbon-Gruppe gerendert,
// auf <1200px im "Mehr ▾"-Popover.
function HierarchyTools({
  selectedId,
  expandAll,
  collapseAll,
  indentSelected,
  outdentSelected,
}: {
  selectedId: string | null;
  expandAll: () => void;
  collapseAll: () => void;
  indentSelected: () => void;
  outdentSelected: () => void;
}) {
  return (
    <>
      <button type="button" className="tool" onClick={expandAll} title="Alle Gruppen aufklappen">
        <ChevronDown size={16} />
        <span>Alle auf</span>
      </button>
      <button type="button" className="tool" onClick={collapseAll} title="Alle Gruppen einklappen">
        <ChevronRight size={16} />
        <span>Alle zu</span>
      </button>
      <button
        type="button"
        className="tool"
        onClick={indentSelected}
        disabled={!selectedId}
        title="Ausgewähltes Work Package unter dem vorherigen einrücken"
        style={!selectedId ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
      >
        <Indent size={16} />
        <span>Einrücken</span>
      </button>
      <button
        type="button"
        className="tool"
        onClick={outdentSelected}
        disabled={!selectedId}
        title="Ausgewähltes Work Package eine Ebene rausrücken"
        style={!selectedId ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
      >
        <Outdent size={16} />
        <span>Ausrücken</span>
      </button>
    </>
  );
}

// Anzeige-Tools — symmetrisch zu HierarchyTools.
function DisplayTools({
  showDeps,
  setShowDeps,
  showCrit,
  setShowCrit,
  criticalCount,
  showWeekends,
  setShowWeekends,
  showBaseline,
  setShowBaseline,
  baselineCount,
  density,
  setDensity,
}: {
  showDeps: boolean;
  setShowDeps: (fn: (v: boolean) => boolean) => void;
  showCrit: boolean;
  setShowCrit: (fn: (v: boolean) => boolean) => void;
  criticalCount: number;
  showWeekends: boolean;
  setShowWeekends: (fn: (v: boolean) => boolean) => void;
  showBaseline: boolean;
  setShowBaseline: (fn: (v: boolean) => boolean) => void;
  baselineCount: number;
  density: Density;
  setDensity: (fn: (d: Density) => Density) => void;
}) {
  return (
    <>
      <button
        type="button"
        className="tool"
        aria-pressed={showDeps}
        onClick={() => setShowDeps((v) => !v)}
        title="Abhängigkeits-Pfeile zwischen Bars"
      >
        <LinkIcon size={16} />
        <span>Pfeile</span>
      </button>
      <button
        type="button"
        className="tool"
        aria-pressed={showCrit}
        onClick={() => setShowCrit((v) => !v)}
        title={
          criticalCount > 0
            ? `${criticalCount} kritische Aufgaben auf FS-Pfad`
            : 'Keine FS-Abhängigkeiten — kein kritischer Pfad'
        }
        disabled={criticalCount === 0}
        style={criticalCount === 0 ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
      >
        <AlertTriangle size={16} />
        <span>Kritisch</span>
      </button>
      <button
        type="button"
        className="tool"
        aria-pressed={showWeekends}
        onClick={() => setShowWeekends((v) => !v)}
        title="Wochenenden hervorheben"
      >
        <Calendar size={16} />
        <span>Wochenende</span>
      </button>
      <button
        type="button"
        className="tool"
        aria-pressed={showBaseline && baselineCount > 0}
        onClick={() => setShowBaseline((v) => !v)}
        title={
          baselineCount > 0
            ? `Baseline-Bars für ${baselineCount} Aufgaben anzeigen`
            : 'Noch keine Baseline gesetzt — über Projekt-Menü einfrieren'
        }
        disabled={baselineCount === 0}
        style={baselineCount === 0 ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
      >
        <GitCompareArrows size={16} />
        <span>Baseline</span>
      </button>
      <button
        type="button"
        className="tool"
        aria-pressed={density === 'compact'}
        onClick={() => setDensity((d) => (d === 'compact' ? 'comfort' : 'compact'))}
        title="Dichte umschalten"
      >
        <Layers size={16} />
        <span>Kompakt</span>
      </button>
    </>
  );
}

// Popover-Container für den "Mehr ▾" Knopf in der Ribbon. Backdrop schließt
// das Menü beim Klick außerhalb.
function RibbonMorePopover({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: 'calc(100% + 4px)',
        left: 0,
        minWidth: 280,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--r-3)',
        boxShadow: 'var(--shadow-2)',
        padding: 8,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {children}
    </div>
  );
}

function RibbonMoreSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--color-ink-3)',
          fontWeight: 600,
          padding: '2px 4px 6px',
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>{children}</div>
    </div>
  );
}

function ColHead({
  children,
  right,
  center,
  last,
}: {
  children?: React.ReactNode;
  right?: boolean;
  center?: boolean;
  last?: boolean;
}) {
  return (
    <div
      style={{
        padding: '0 8px',
        borderRight: last ? 'none' : '1px solid var(--color-border)',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: right ? 'flex-end' : center ? 'center' : 'flex-start',
      }}
    >
      {children}
    </div>
  );
}

function TaskRow({
  bar,
  index,
  rowH,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
  isSelected,
  onSelect,
  onHover,
  pickerActive = false,
  pickerSource = false,
  hasConflict = false,
  colLayout,
}: {
  bar: GanttBar;
  index: number;
  rowH: number;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: (id: string) => void;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
  pickerActive?: boolean;
  pickerSource?: boolean;
  hasConflict?: boolean;
  colLayout: ReturnType<typeof leftColLayout>;
}) {
  return (
    <div
      onClick={() => onSelect?.(bar.id)}
      onMouseEnter={() => onHover?.(bar.id)}
      onMouseLeave={() => onHover?.(null)}
      className={`tbl-row ${bar.isSummary ? 'is-summary' : ''} ${isSelected ? 'is-selected' : ''}`}
      style={{
        height: rowH,
        display: 'grid',
        gridTemplateColumns: colLayout.template,
        cursor: pickerActive ? 'crosshair' : pickerSource ? 'not-allowed' : 'pointer',
        opacity: pickerSource ? 0.4 : 1,
        background:
          pickerActive
            ? 'var(--color-accent-soft)'
            : isSelected
              ? undefined
              : index % 2 === 1 && !bar.isSummary
                ? 'var(--color-surface-2)'
                : undefined,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRight: '1px solid var(--color-grid-line)',
          fontSize: 10,
          color: 'var(--color-ink-4)',
        }}
        className="mono"
      >
        {index + 1}
      </div>
      <div
        style={{
          padding: '0 6px',
          display: 'flex',
          alignItems: 'center',
          borderRight: '1px solid var(--color-grid-line)',
          fontSize: 11,
          color: 'var(--color-ink-3)',
        }}
        className="mono"
      >
        #{bar.gitlabIssueIid}
      </div>
      <div
        style={{
          padding: '0 8px',
          paddingLeft: 8 + depth * 16,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          borderRight: '1px solid var(--color-grid-line)',
          minWidth: 0,
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse?.(bar.id);
            }}
            style={{
              width: 16,
              height: 16,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-ink-2)',
              flexShrink: 0,
            }}
            title={collapsed ? 'Aufklappen' : 'Einklappen'}
          >
            {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
        ) : (
          <span style={{ width: 16, flexShrink: 0 }} />
        )}
        {!bar.isSummary && (
          <span
            className={`dot ${bar.state === 'closed' ? 'dot--done' : 'dot--open'}`}
            style={{ flexShrink: 0 }}
          />
        )}
        {hasConflict && (
          <AlertTriangle
            size={11}
            style={{ color: 'var(--color-status-blocked)', flexShrink: 0 }}
            aria-label="Dependency-Konflikt"
          />
        )}
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 12.5,
            fontWeight: bar.isSummary ? 600 : 500,
          }}
        >
          {bar.text}
        </span>
        {bar.labels && bar.labels.length > 0 && (
          <LabelChips labels={bar.labels} asDots={colLayout.labelsAsDots} />
        )}
      </div>
      {colLayout.showDauer && (
        <div
          style={{
            padding: '0 8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            borderRight: '1px solid var(--color-grid-line)',
            fontSize: 11,
            color: 'var(--color-ink-2)',
          }}
          className="mono"
        >
          {Math.max(1, diffDays(bar.start, bar.end))} d
        </div>
      )}
      {colLayout.showStart && (
        <div
          style={{
            padding: '0 6px',
            display: 'flex',
            alignItems: 'center',
            borderRight: '1px solid var(--color-grid-line)',
            fontSize: 11,
            color: 'var(--color-ink-2)',
          }}
          className="mono"
        >
          {fmtDateShort(bar.start)}
        </div>
      )}
      <div
        style={{
          padding: '0 6px',
          display: 'flex',
          alignItems: 'center',
          borderRight: '1px solid var(--color-grid-line)',
          fontSize: 11,
          color: 'var(--color-ink-2)',
        }}
        className="mono"
      >
        {fmtDateShort(bar.end)}
      </div>
      <div
        style={{
          padding: '0 6px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
        }}
      >
        <AssigneeAvatars assignees={bar.assignees ?? []} size="sm" max={2} />
      </div>
    </div>
  );
}

function LabelChips({ labels, asDots = false }: { labels: GanttLabel[]; asDots?: boolean }) {
  const titleAttr = labels.map((l) => l.name).join(', ');
  if (asDots) {
    // Kompakt-Modus für schmale Listen: 6px farbige Kreise statt Chips.
    // Max 4 Dots, danach "+N" als Overflow-Marker.
    const MAX_DOTS = 4;
    const visible = labels.slice(0, MAX_DOTS);
    const overflow = labels.length - MAX_DOTS;
    return (
      <span
        style={{ display: 'inline-flex', gap: 2, flexShrink: 0, alignItems: 'center' }}
        title={titleAttr}
      >
        {visible.map((l) => (
          <span
            key={l.name}
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: l.color ?? '#a09e95',
            }}
          />
        ))}
        {overflow > 0 && (
          <span style={{ fontSize: 9, color: 'var(--color-ink-4)' }}>+{overflow}</span>
        )}
      </span>
    );
  }
  const MAX = 2;
  const visible = labels.slice(0, MAX);
  const overflow = labels.length - MAX;
  return (
    <span style={{ display: 'inline-flex', gap: 3, flexShrink: 0 }} title={titleAttr}>
      {visible.map((l) => (
        <span
          key={l.name}
          style={{
            display: 'inline-block',
            padding: '1px 5px',
            borderRadius: 8,
            fontSize: 9,
            fontWeight: 600,
            textTransform: 'lowercase',
            maxWidth: 70,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            ...chipStyle(l.color),
          }}
        >
          {l.name}
        </span>
      ))}
      {overflow > 0 && (
        <span style={{ fontSize: 9, color: 'var(--color-ink-4)' }}>+{overflow}</span>
      )}
    </span>
  );
}

function chipStyle(hex?: string): React.CSSProperties {
  if (!hex) return { backgroundColor: '#ebeae5', color: '#76746c' };
  const lum = luminance(hex);
  return {
    backgroundColor: hex,
    color: lum > 0.6 ? '#1f1f23' : '#ffffff',
  };
}

function luminance(hex: string): number {
  const m = hex.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return 0;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// ─── Dependency-Arrow (FS/SS/FF/SF mit Elbow-Path) ─────────────────────────

function DependencyArrow({
  type,
  pred,
  succ,
  rowH,
  barH,
  barPadY,
  critical = false,
}: {
  type: 'FS' | 'SS' | 'FF' | 'SF';
  pred: { x: number; width: number; rowIdx: number };
  succ: { x: number; width: number; rowIdx: number };
  rowH: number;
  barH: number;
  barPadY: number;
  critical?: boolean;
}) {
  const predLeft = pred.x;
  const predRight = pred.x + pred.width;
  const succLeft = succ.x;
  const succRight = succ.x + succ.width;
  const predMidY = pred.rowIdx * rowH + barPadY + barH / 2;
  const succMidY = succ.rowIdx * rowH + barPadY + barH / 2;

  // Start/End-Punkte je Typ
  let sx: number;
  let ex: number;
  let endDir: 1 | -1; // Richtung des Arrowheads (rechts oder links)
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
  const stubLen = 8;
  const finalX = endDir === 1 ? ex - 4 : ex + 4;

  // Path-Berechnung: Right-angle elbow.
  // Wenn der direkte Weg nicht passt (Ziel "hinter" dem Start), Looping nötig.
  const forward = (endDir === 1 && finalX > sx + startDir * stubLen) ||
                  (endDir === -1 && finalX < sx + startDir * stubLen);
  let d: string;
  if (forward) {
    d = `M ${sx} ${predMidY}
         L ${sx + startDir * stubLen} ${predMidY}
         L ${sx + startDir * stubLen} ${succMidY}
         L ${finalX} ${succMidY}`;
  } else {
    // Looping um die Bars rum
    const detourY = predMidY < succMidY
      ? Math.max(predMidY, succMidY) + rowH / 2
      : Math.min(predMidY, succMidY) - rowH / 2;
    d = `M ${sx} ${predMidY}
         L ${sx + startDir * stubLen} ${predMidY}
         L ${sx + startDir * stubLen} ${detourY}
         L ${finalX - endDir * stubLen} ${detourY}
         L ${finalX - endDir * stubLen} ${succMidY}
         L ${finalX} ${succMidY}`;
  }

  return (
    <path
      d={d}
      stroke={critical ? 'var(--color-status-blocked)' : '#76746c'}
      strokeWidth={critical ? 1.75 : 1}
      fill="none"
      markerEnd={critical ? 'url(#dep-arrow-crit)' : 'url(#dep-arrow)'}
      style={{ pointerEvents: 'none' }}
    />
  );
}

function barColor(
  state: string,
  isSummary: boolean,
): { fill: string; stroke: string; progress: string } {
  if (isSummary) {
    return { fill: '#2b2a26', stroke: '#000', progress: '#000' };
  }
  if (state === 'closed') {
    // Hellgrüne Basis, sehr dunkler Progress-Overlay
    return { fill: '#22c55e', stroke: '#15803d', progress: '#052e16' };
  }
  // Helleres Blau als Basis, sehr dunkler Navy als Progress-Overlay
  return { fill: '#3b82f6', stroke: '#1e40af', progress: '#0c1e54' };
}

// ─── Background (Wochenenden + Grid) ───────────────────────────────────────

function Background({
  range,
  pxPerDay,
  zoom,
  height,
  showWeekends,
}: {
  range: { start: Date; totalDays: number };
  pxPerDay: number;
  zoom: Zoom;
  height: number;
  showWeekends: boolean;
}) {
  const drawWeekends = showWeekends && zoom === 'day';
  const gridStepDays = zoom === 'day' ? 1 : zoom === 'week' ? 7 : zoom === 'month' ? 30 : 90;

  const weekendRects: number[] = [];
  const gridXs: number[] = [];
  let cursor = startOfDay(range.start);
  for (let i = 0; i < range.totalDays; i++) {
    if (drawWeekends && isWeekend(cursor)) weekendRects.push(i * pxPerDay);
    if (i % gridStepDays === 0) gridXs.push(i * pxPerDay);
    cursor = addDays(cursor, 1);
  }

  return (
    <>
      {weekendRects.map((x) => (
        <rect
          key={x}
          x={x}
          y={0}
          width={pxPerDay}
          height={height}
          fill="#f5f5f4"
          pointerEvents="none"
        />
      ))}
      {gridXs.map((x) => (
        <line
          key={x}
          x1={x}
          x2={x}
          y1={0}
          y2={height}
          stroke="var(--color-grid-line)"
          strokeWidth={0.5}
          pointerEvents="none"
        />
      ))}
    </>
  );
}

// ─── Date-Axis Header ──────────────────────────────────────────────────────

function DateAxisHeader({
  range,
  zoom,
  pxPerDay,
  width,
}: {
  range: { start: Date; totalDays: number };
  zoom: Zoom;
  pxPerDay: number;
  width: number;
}) {
  type Tick = { x: number; width: number; label: string };

  const { majors, minors } = useMemo(() => {
    const majors: Tick[] = [];
    const minors: Tick[] = [];

    if (zoom === 'day') {
      let monthStart = 0;
      let key = `${range.start.getFullYear()}-${range.start.getMonth()}`;
      let cursor = startOfDay(range.start);
      for (let i = 0; i < range.totalDays; i++) {
        const k = `${cursor.getFullYear()}-${cursor.getMonth()}`;
        if (k !== key) {
          majors.push({
            x: monthStart * pxPerDay,
            width: (i - monthStart) * pxPerDay,
            label: fmtMonthFull(addDays(range.start, monthStart)),
          });
          monthStart = i;
          key = k;
        }
        minors.push({ x: i * pxPerDay, width: pxPerDay, label: String(cursor.getDate()) });
        cursor = addDays(cursor, 1);
      }
      majors.push({
        x: monthStart * pxPerDay,
        width: (range.totalDays - monthStart) * pxPerDay,
        label: fmtMonthFull(addDays(range.start, monthStart)),
      });
    } else if (zoom === 'week') {
      let monthStart = 0;
      let key = `${range.start.getFullYear()}-${range.start.getMonth()}`;
      let cursor = startOfDay(range.start);
      for (let i = 0; i < range.totalDays; i++) {
        const k = `${cursor.getFullYear()}-${cursor.getMonth()}`;
        if (k !== key) {
          majors.push({
            x: monthStart * pxPerDay,
            width: (i - monthStart) * pxPerDay,
            label: fmtMonth(addDays(range.start, monthStart)),
          });
          monthStart = i;
          key = k;
        }
        if (cursor.getDay() === 1) {
          minors.push({ x: i * pxPerDay, width: 7 * pxPerDay, label: `KW${isoWeek(cursor)}` });
        }
        cursor = addDays(cursor, 1);
      }
      majors.push({
        x: monthStart * pxPerDay,
        width: (range.totalDays - monthStart) * pxPerDay,
        label: fmtMonth(addDays(range.start, monthStart)),
      });
    } else if (zoom === 'month') {
      let yearStart = 0;
      let year = range.start.getFullYear();
      let monthStartIdx = 0;
      let monthCursor = startOfDay(range.start);
      let cursor = startOfDay(range.start);
      for (let i = 0; i < range.totalDays; i++) {
        if (cursor.getFullYear() !== year) {
          majors.push({
            x: yearStart * pxPerDay,
            width: (i - yearStart) * pxPerDay,
            label: String(year),
          });
          yearStart = i;
          year = cursor.getFullYear();
        }
        if (cursor.getDate() === 1 && i !== monthStartIdx) {
          minors.push({
            x: monthStartIdx * pxPerDay,
            width: (i - monthStartIdx) * pxPerDay,
            label: monthCursor.toLocaleDateString('de-DE', { month: 'short' }),
          });
          monthStartIdx = i;
          monthCursor = cursor;
        }
        cursor = addDays(cursor, 1);
      }
      majors.push({
        x: yearStart * pxPerDay,
        width: (range.totalDays - yearStart) * pxPerDay,
        label: String(year),
      });
      minors.push({
        x: monthStartIdx * pxPerDay,
        width: (range.totalDays - monthStartIdx) * pxPerDay,
        label: monthCursor.toLocaleDateString('de-DE', { month: 'short' }),
      });
    } else {
      let yearStart = 0;
      let year = range.start.getFullYear();
      let qStart = 0;
      let qCursor = startOfDay(range.start);
      let cursor = startOfDay(range.start);
      for (let i = 0; i < range.totalDays; i++) {
        if (cursor.getFullYear() !== year) {
          majors.push({
            x: yearStart * pxPerDay,
            width: (i - yearStart) * pxPerDay,
            label: String(year),
          });
          yearStart = i;
          year = cursor.getFullYear();
        }
        if (cursor.getDate() === 1 && cursor.getMonth() % 3 === 0 && i !== qStart) {
          const q = Math.floor(qCursor.getMonth() / 3) + 1;
          minors.push({
            x: qStart * pxPerDay,
            width: (i - qStart) * pxPerDay,
            label: `Q${q}`,
          });
          qStart = i;
          qCursor = cursor;
        }
        cursor = addDays(cursor, 1);
      }
      majors.push({
        x: yearStart * pxPerDay,
        width: (range.totalDays - yearStart) * pxPerDay,
        label: String(year),
      });
      minors.push({
        x: qStart * pxPerDay,
        width: (range.totalDays - qStart) * pxPerDay,
        label: `Q${Math.floor(qCursor.getMonth() / 3) + 1}`,
      });
    }

    return { majors, minors };
  }, [range, zoom, pxPerDay]);

  return (
    <svg width={width} height={HEADER_HEIGHT} style={{ display: 'block' }}>
      {majors.map((m) => (
        <g key={`maj-${m.x}`}>
          <rect
            x={m.x}
            y={0}
            width={m.width}
            height={HEADER_HEIGHT / 2}
            fill="#ebeae5"
            stroke="#cfcec8"
            strokeWidth={0.5}
          />
          <text
            x={m.x + 6}
            y={HEADER_HEIGHT / 2 - 6}
            fill="#44423d"
            fontSize={11}
            fontWeight={600}
          >
            {m.label}
          </text>
        </g>
      ))}
      {minors.map((m) => (
        <g key={`min-${m.x}`}>
          <rect
            x={m.x}
            y={HEADER_HEIGHT / 2}
            width={m.width}
            height={HEADER_HEIGHT / 2}
            fill="#fafaf9"
            stroke="#e2e1dd"
            strokeWidth={0.5}
          />
          <text
            x={m.x + m.width / 2}
            y={HEADER_HEIGHT - 8}
            fill="#76746c"
            fontSize={10}
            textAnchor="middle"
          >
            {m.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
