// User-Präferenzen: shape + load/save Helper.
//
// Werte werden als JSON-Blob in User.preferences persistiert. Frei-form damit
// neue Settings ohne Schema-Migration dazukommen können. Konsumenten validieren
// Felder defensiv (jeder Wert kann null/undefined oder anderem Typ sein).

export type Density = 'comfort' | 'compact';
export type StatusFilter = 'all' | 'open' | 'done';
export type Zoom = 'day' | 'week' | 'month' | 'quarter';

export type UserPreferences = {
  density?: Density;
  showDeps?: boolean;
  showCrit?: boolean;
  showWeekends?: boolean;
  // Baseline (Plan-vs-Ist) im Gantt anzeigen — zweite gedämpfte Bar
  // hinter der aktuellen.
  showBaseline?: boolean;
  filter?: StatusFilter;
  zoom?: Zoom;
  // Breite der linken Task-Liste im Gantt (px). Per Drag am Splitter setzbar.
  leftColWidth?: number;
  // Breite des Inspector-Panels rechts (px). Per Drag am Splitter setzbar.
  inspectorWidth?: number;
  // true = linke Task-Liste komplett ausgeblendet (Splitter bleibt sichtbar
  // damit man sie wieder einblenden kann).
  leftListCollapsed?: boolean;
  // true (Default) = Klick in den leeren Gantt-Bereich schliesst den
  // Inspector. false = Inspector bleibt offen (User muss ihn manuell zu).
  closeInspectorOnEmptyClick?: boolean;
  // ID des zuletzt geöffneten Projekts. Wird genutzt um den "Gantt"-Nav-Link
  // direkt in das letzte Projekt zu springen — sonst landet man auf der
  // Projekt-Übersicht.
  lastOpenedProjectId?: string;
  // Pinch-Zoom-Empfindlichkeit (Trackpad). Konstante in factor=exp(-d*x).
  // Default 0.03; höher = aggressiver Zoom pro Geste.
  pinchSensitivity?: number;
  // Inertia-Smoothing für Pinch (LERP-Faktor pro Frame). 1.0 = sofort,
  // niedriger = weicheres Ausklingen. Default 0.25.
  pinchSmoothing?: number;
  // Pinch-Lock-Fenster nach letztem ctrlKey-Event (ms). Verhindert dass
  // normale Scroll-Events während/kurz nach dem Pinch durchschlagen.
  // Default 150.
  pinchLockMs?: number;
};

// Defaults damit Konsumenten ohne null-Checks arbeiten können.
export const PINCH_SENSITIVITY_DEFAULT = 0.03;
export const PINCH_SMOOTHING_DEFAULT = 0.25;
export const PINCH_LOCK_MS_DEFAULT = 100;

export function parsePreferences(raw: unknown): UserPreferences {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: UserPreferences = {};
  if (r.density === 'compact' || r.density === 'comfort') out.density = r.density;
  if (typeof r.showDeps === 'boolean') out.showDeps = r.showDeps;
  if (typeof r.showCrit === 'boolean') out.showCrit = r.showCrit;
  if (typeof r.showWeekends === 'boolean') out.showWeekends = r.showWeekends;
  if (typeof r.showBaseline === 'boolean') out.showBaseline = r.showBaseline;
  if (r.filter === 'all' || r.filter === 'open' || r.filter === 'done') out.filter = r.filter;
  if (r.zoom === 'day' || r.zoom === 'week' || r.zoom === 'month' || r.zoom === 'quarter') {
    out.zoom = r.zoom;
  }
  if (typeof r.leftColWidth === 'number' && r.leftColWidth >= 200 && r.leftColWidth <= 1200) {
    out.leftColWidth = Math.round(r.leftColWidth);
  }
  if (typeof r.inspectorWidth === 'number' && r.inspectorWidth >= 240 && r.inspectorWidth <= 900) {
    out.inspectorWidth = Math.round(r.inspectorWidth);
  }
  if (typeof r.leftListCollapsed === 'boolean') out.leftListCollapsed = r.leftListCollapsed;
  if (typeof r.closeInspectorOnEmptyClick === 'boolean') {
    out.closeInspectorOnEmptyClick = r.closeInspectorOnEmptyClick;
  }
  if (typeof r.lastOpenedProjectId === 'string' && r.lastOpenedProjectId.length > 0) {
    out.lastOpenedProjectId = r.lastOpenedProjectId;
  }
  if (typeof r.pinchSensitivity === 'number' && r.pinchSensitivity > 0 && r.pinchSensitivity <= 0.2) {
    out.pinchSensitivity = r.pinchSensitivity;
  }
  if (typeof r.pinchSmoothing === 'number' && r.pinchSmoothing > 0 && r.pinchSmoothing <= 1) {
    out.pinchSmoothing = r.pinchSmoothing;
  }
  if (typeof r.pinchLockMs === 'number' && r.pinchLockMs >= 0 && r.pinchLockMs <= 1000) {
    out.pinchLockMs = Math.round(r.pinchLockMs);
  }
  return out;
}
