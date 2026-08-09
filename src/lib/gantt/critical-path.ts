// Critical-Path-Method (CPM) für Gantt-Bars.
//
// Vereinfachung in V1: betrachten nur FS-Dependencies (Finish-to-Start), da
// SS/FF/SF im typischen PM-Workflow seltener und der Algorithmus damit
// einfacher und vorhersagbarer ist. Bei Bedarf kann das später erweitert werden.
//
// Algorithmus:
//   Project-End  = max(bar.end)
//   LF(task)     = min über alle FS-Nachfolger s von: s.LS - lag*1day
//                 oder Project-End falls keine Nachfolger
//   LS(task)     = LF(task) - duration
//   Slack(task)  = LF(task) - task.end
//   Kritisch    = Slack <= toleranceDays
//
// Tasks ohne irgendeine FS-Beziehung würden alle gleich behandelt und mit
// Slack 0 markiert wenn sie zufällig auf Project-End enden — das wäre kein
// echter kritischer Pfad. Daher filtern wir am Ende: nur Tasks die selbst
// in einer FS-Kette stehen werden als kritisch markiert.

const MS_PER_DAY = 86_400_000;

export type CpmInput = {
  bars: Array<{
    id: string;
    start: Date;
    end: Date;
  }>;
  dependencies: Array<{
    predecessorId: string;
    successorId: string;
    type: 'FS' | 'SS' | 'FF' | 'SF';
    lagDays: number;
  }>;
};

export function computeCriticalPath({ bars, dependencies }: CpmInput): Set<string> {
  const barById = new Map(bars.map((b) => [b.id, b]));

  // FS-Nachfolger und FS-Vorgänger pro Task
  const fsSuccessors = new Map<string, Array<{ id: string; lag: number }>>();
  const fsPredecessors = new Map<string, Array<{ id: string; lag: number }>>();
  for (const d of dependencies) {
    if (d.type !== 'FS') continue;
    if (!barById.has(d.predecessorId) || !barById.has(d.successorId)) continue;
    const succArr = fsSuccessors.get(d.predecessorId) ?? [];
    succArr.push({ id: d.successorId, lag: d.lagDays });
    fsSuccessors.set(d.predecessorId, succArr);
    const predArr = fsPredecessors.get(d.successorId) ?? [];
    predArr.push({ id: d.predecessorId, lag: d.lagDays });
    fsPredecessors.set(d.successorId, predArr);
  }

  if (fsSuccessors.size === 0 && fsPredecessors.size === 0) {
    return new Set();
  }

  // Tasks die in mindestens einer FS-Kette sind (egal ob als Vorgänger oder
  // Nachfolger). Nur diese können auf dem kritischen Pfad liegen.
  const inFsNetwork = new Set<string>();
  for (const id of fsSuccessors.keys()) inFsNetwork.add(id);
  for (const id of fsPredecessors.keys()) inFsNetwork.add(id);

  // Project-End: spätestes Bar-Ende im FS-Netz (sonst global, falls Netz leer)
  let projectEnd = -Infinity;
  for (const id of inFsNetwork) {
    const bar = barById.get(id);
    if (bar) projectEnd = Math.max(projectEnd, bar.end.getTime());
  }
  if (projectEnd === -Infinity) {
    projectEnd = Math.max(...bars.map((b) => b.end.getTime()));
  }

  // LF (latest finish) rekursiv mit Memoization
  const lfCache = new Map<string, number>();
  const visiting = new Set<string>();
  function getLF(taskId: string): number {
    const cached = lfCache.get(taskId);
    if (cached !== undefined) return cached;
    if (visiting.has(taskId)) {
      // Zirkel-Schutz
      return projectEnd;
    }
    visiting.add(taskId);
    const successors = fsSuccessors.get(taskId) ?? [];
    let lf: number;
    if (successors.length === 0) {
      lf = projectEnd;
    } else {
      lf = Infinity;
      for (const s of successors) {
        const succBar = barById.get(s.id);
        if (!succBar) continue;
        const succLF = getLF(s.id);
        const succDuration = Math.max(0, succBar.end.getTime() - succBar.start.getTime());
        const succLS = succLF - succDuration;
        const candidate = succLS - s.lag * MS_PER_DAY;
        if (candidate < lf) lf = candidate;
      }
      if (lf === Infinity) lf = projectEnd;
    }
    visiting.delete(taskId);
    lfCache.set(taskId, lf);
    return lf;
  }

  const critical = new Set<string>();
  const toleranceMs = MS_PER_DAY; // 1 Tag Toleranz für Rundungs-Effekte
  for (const id of inFsNetwork) {
    const bar = barById.get(id);
    if (!bar) continue;
    const lf = getLF(id);
    const slack = lf - bar.end.getTime();
    if (slack <= toleranceMs) {
      critical.add(id);
    }
  }
  return critical;
}
