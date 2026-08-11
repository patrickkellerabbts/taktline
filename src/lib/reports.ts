// Reports-Aggregation für /reports.
//
// Zwei Funktionen:
//   - getProjectsOverview(): Übersichts-Tabelle über alle aktivierten Projekte
//   - getProjectDashboard(projectId): Drill-Down mit Donut, Top-Überfällige,
//     Meilensteinen und Velocity-Daten

import { prisma } from './db';
import { findDependencyConflicts } from './gantt/dependency-validation';

export type ProjectHealth = 'good' | 'warning' | 'bad';

export type ProjectOverviewRow = {
  id: string;
  name: string;
  lastFullSyncAt: Date | null;
  totalWps: number;
  openWps: number;
  doneWps: number;
  overdueWps: number;
  conflictsCount: number;
  donePercent: number; // 0..100 (gewichtet)
  nextMilestone: { id: string; title: string; date: Date | null } | null;
  health: ProjectHealth;
};

export type DashboardOverdueItem = {
  id: string;
  iid: number;
  title: string;
  endDate: Date;
  daysOverdue: number;
  assigneeInitials: string[];
};

export type DashboardMilestone = {
  id: string;
  title: string;
  dueDate: Date | null;
  state: string;
  daysUntil: number | null;
};

export type VelocityPoint = {
  weekStart: Date;
  isoWeek: number;
  closedCount: number;
  createdCount: number;
};

export type DashboardConflict = {
  successorIid: number;
  successorTitle: string;
  successorWpId: string;
  predecessorIid: number | null;
  predecessorTitle: string | null;
  type: string;
  daysOverlap: number;
};

export type DashboardResourceWarning = {
  gitlabUserId: number;
  name: string;
  isoWeek: number;
  weekStart: Date;
  count: number;
};

export type DashboardTopWp = {
  id: string;
  iid: number;
  title: string;
  endDate: Date;
  state: string;
  progressPercent: number;
  daysOverdue?: number; // nur für überfällige
};

/**
 * Ein Stichtag im Burndown. Alle drei Werte sind „wie viele Arbeitspakete
 * waren an diesem Tag noch offen" — dieselbe Einheit, dieselbe Achse.
 */
export type BurndownPoint = {
  /** yyyy-mm-dd */
  date: string;
  /** Nach eingefrorener Baseline geplanter Restbestand. */
  planBaseline: number;
  /** Nach aktuellen Fälligkeiten geplanter Restbestand. */
  planCurrent: number;
  /** Tatsächlicher Restbestand. Null für Tage in der Zukunft. */
  actual: number | null;
};

export type ProjectDashboard = ProjectOverviewRow & {
  overdueList: DashboardOverdueItem[];
  upcomingMilestones: DashboardMilestone[];
  donut: {
    overdueRatio: number; // 0..1, Anteil der ÜBRIGEN die überfällig sind
  };
  velocity: VelocityPoint[];
  burndown: BurndownPoint[];
  /** Anzahl geschlossener Pakete ohne closed_at aus GitLab — siehe buildBurndown. */
  burndownEstimated: number;
  conflicts: DashboardConflict[];
  resourceWarnings: DashboardResourceWarning[];
  topOpen: DashboardTopWp[];
  topDone: DashboardTopWp[];
  topOverdue: DashboardTopWp[];
};

// ─── Overview über alle Projekte ────────────────────────────────────────
export async function getProjectsOverview(): Promise<ProjectOverviewRow[]> {
  const now = new Date();

  const projects = await prisma.project.findMany({
    select: {
      id: true,
      nameCache: true,
      lastFullSyncAt: true,
      workPackages: {
        where: { deletedAt: null },
        select: {
          id: true,
          stateCache: true,
          startDate: true,
          endDate: true,
          progressPercent: true,
          parentId: true,
        },
      },
      milestones: {
        where: {
          OR: [{ dueDateCache: null }, { dueDateCache: { gte: now } }],
          stateCache: { not: 'closed' },
        },
        orderBy: { dueDateCache: 'asc' },
        select: { id: true, titleCache: true, dueDateCache: true },
        take: 1,
      },
    },
  });

  // Dependencies sammeln (für Konflikt-Count pro Projekt). Eine Query über alle
  // damit wir nicht N+1 schreiben — danach pro projectId gruppieren.
  const allWpIds = projects.flatMap((p) => p.workPackages.map((w) => w.id));
  const allDeps =
    allWpIds.length > 0
      ? await prisma.dependency.findMany({
          where: { predecessorId: { in: allWpIds } },
          select: {
            id: true,
            predecessorId: true,
            successorId: true,
            type: true,
            lagDays: true,
          },
        })
      : [];
  // Jedes Projekt bekommt nur die Deps wo Pred+Succ aus dem Projekt sind
  const wpIdToProjectId = new Map<string, string>();
  for (const p of projects) {
    for (const w of p.workPackages) wpIdToProjectId.set(w.id, p.id);
  }
  const depsByProject = new Map<string, typeof allDeps>();
  for (const d of allDeps) {
    const pid = wpIdToProjectId.get(d.predecessorId);
    if (!pid) continue;
    if (wpIdToProjectId.get(d.successorId) !== pid) continue;
    const arr = depsByProject.get(pid) ?? [];
    arr.push(d);
    depsByProject.set(pid, arr);
  }

  return projects
    .map((p) => {
      const wps = p.workPackages;
      const totalWps = wps.length;
      const openWps = wps.filter((w) => w.stateCache !== 'closed').length;
      const doneWps = totalWps - openWps;
      const overdueWps = wps.filter(
        (w) => w.stateCache !== 'closed' && w.endDate < now,
      ).length;
      // Gewichtete Fortschritts-Berechnung: closed-WPs zählen 100%, offene mit
      // ihrem progressPercent (aus gantt-meta). Liefert ein realistischeres
      // Bild als reines "wie viele sind closed".
      const donePercent = wpsWeightedDonePercent(wps);
      const conflictsCount = findDependencyConflicts(
        wps.map((w) => ({
          id: w.id,
          start: w.startDate,
          end: w.endDate,
          parentId: w.parentId,
        })),
        depsByProject.get(p.id) ?? [],
      ).length;

      const ms = p.milestones[0] ?? null;
      const nextMilestone = ms
        ? { id: ms.id, title: ms.titleCache, date: ms.dueDateCache }
        : null;

      return {
        id: p.id,
        name: p.nameCache,
        lastFullSyncAt: p.lastFullSyncAt,
        totalWps,
        openWps,
        doneWps,
        overdueWps,
        conflictsCount,
        donePercent,
        nextMilestone,
        health: computeHealth(overdueWps, totalWps, p.lastFullSyncAt, now, conflictsCount),
      };
    })
    .sort((a, b) => {
      // Sortierung: erst nach Health (worst first), dann nach name
      const order: Record<ProjectHealth, number> = { bad: 0, warning: 1, good: 2 };
      const ho = order[a.health] - order[b.health];
      if (ho !== 0) return ho;
      return a.name.localeCompare(b.name);
    });
}

// ─── Detail-Dashboard für ein einzelnes Projekt ──────────────────────────
export async function getProjectDashboard(
  projectId: string,
): Promise<ProjectDashboard | null> {
  const now = new Date();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      nameCache: true,
      lastFullSyncAt: true,
      workPackages: {
        where: { deletedAt: null },
        select: {
          id: true,
          gitlabIssueIid: true,
          titleCache: true,
          stateCache: true,
          startDate: true,
          endDate: true,
          baselineEndDate: true,
          closedAt: true,
          progressPercent: true,
          parentId: true,
          lastSyncedAt: true,
          assigneesCache: true,
        },
      },
      milestones: {
        orderBy: { dueDateCache: 'asc' },
        select: {
          id: true,
          titleCache: true,
          dueDateCache: true,
          stateCache: true,
        },
      },
    },
  });

  if (!project) return null;

  const wps = project.workPackages;
  const totalWps = wps.length;
  const openWps = wps.filter((w) => w.stateCache !== 'closed').length;
  const doneWps = totalWps - openWps;
  const overdueWps = wps.filter((w) => w.stateCache !== 'closed' && w.endDate < now);
  const overdueCount = overdueWps.length;
  const donePercent = wpsWeightedDonePercent(wps);

  // Top 5 überfällige nach daysOverdue desc
  const overdueList: DashboardOverdueItem[] = overdueWps
    .map((w) => ({
      id: w.id,
      iid: w.gitlabIssueIid,
      title: w.titleCache,
      endDate: w.endDate,
      daysOverdue: Math.ceil((now.getTime() - w.endDate.getTime()) / 86_400_000),
      assigneeInitials: extractInitials(w.assigneesCache),
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .slice(0, 5);

  // Meilensteine: zeigen alle offenen plus die letzten 2 closed für Kontext
  const upcomingMilestones: DashboardMilestone[] = project.milestones
    .filter(
      (m) => m.stateCache !== 'closed' || (m.dueDateCache && m.dueDateCache >= addDays(now, -30)),
    )
    .slice(0, 8)
    .map((m) => ({
      id: m.id,
      title: m.titleCache,
      dueDate: m.dueDateCache,
      state: m.stateCache,
      daysUntil: m.dueDateCache
        ? Math.ceil((m.dueDateCache.getTime() - now.getTime()) / 86_400_000)
        : null,
    }));

  // Velocity über die letzten VELOCITY_WEEKS Wochen — Approximation:
  //  - created: AuditLog action="work_package.create" in der KW
  //  - closed: AuditLog action="work_package.update" wo after.state="closed" in der KW
  const windowStart = addDays(now, -7 * VELOCITY_WEEKS);
  const audits = await prisma.auditLog.findMany({
    where: {
      entityType: 'WorkPackage',
      createdAt: { gte: windowStart },
    },
    select: {
      action: true,
      after: true,
      createdAt: true,
      entityId: true,
    },
  });

  // Nur die für Projekt-WPs relevant
  const projectWpIds = new Set(wps.map((w) => w.id));
  const velocity = buildVelocity(audits.filter((a) => projectWpIds.has(a.entityId)), now);

  // ── Konflikte ────────────────────────────────────────────────────────
  const deps = await prisma.dependency.findMany({
    where: { predecessor: { projectId: project.id } },
    select: { id: true, predecessorId: true, successorId: true, type: true, lagDays: true },
  });
  const conflictsRaw = findDependencyConflicts(
    wps.map((w) => ({
      id: w.id,
      start: w.startDate,
      end: w.endDate,
      text: w.titleCache,
      gitlabIssueIid: w.gitlabIssueIid,
      parentId: w.parentId,
    })),
    deps,
  );
  const conflicts: DashboardConflict[] = conflictsRaw.map((c) => {
    const succ = wps.find((w) => w.id === c.successorId);
    const pred = wps.find((w) => w.id === c.predecessorId);
    return {
      successorIid: succ?.gitlabIssueIid ?? 0,
      successorTitle: succ?.titleCache ?? 'Unbekannt',
      successorWpId: c.successorId,
      predecessorIid: pred?.gitlabIssueIid ?? null,
      predecessorTitle: pred?.titleCache ?? null,
      type: c.type,
      daysOverlap: c.daysOverlap,
    };
  });

  // ── Resource-Warnings: Personen mit >RESOURCE_OVERLOAD_THRESHOLD WPs in
  //    irgendeiner KW der nächsten 8 Wochen ─────────────────────────────
  const resourceWarnings = computeResourceWarnings(wps, now);

  // ── Top-N pro Kategorie nach lastSyncedAt desc ──────────────────────
  const sortBySyncDesc = (a: { lastSyncedAt: Date }, b: { lastSyncedAt: Date }) =>
    b.lastSyncedAt.getTime() - a.lastSyncedAt.getTime();
  const topN = 5;
  const topOpen: DashboardTopWp[] = [...wps]
    .filter((w) => w.stateCache !== 'closed' && w.endDate >= now)
    .sort(sortBySyncDesc)
    .slice(0, topN)
    .map(mapTopWp);
  const topDone: DashboardTopWp[] = [...wps]
    .filter((w) => w.stateCache === 'closed')
    .sort(sortBySyncDesc)
    .slice(0, topN)
    .map(mapTopWp);
  const topOverdue: DashboardTopWp[] = [...wps]
    .filter((w) => w.stateCache !== 'closed' && w.endDate < now)
    .sort(sortBySyncDesc)
    .slice(0, topN)
    .map((w) => ({ ...mapTopWp(w), daysOverdue: Math.ceil((now.getTime() - w.endDate.getTime()) / 86_400_000) }));

  const conflictsCount = conflicts.length;
  const health = computeHealth(overdueCount, totalWps, project.lastFullSyncAt, now, conflictsCount);

  return {
    id: project.id,
    name: project.nameCache,
    lastFullSyncAt: project.lastFullSyncAt,
    totalWps,
    openWps,
    doneWps,
    overdueWps: overdueCount,
    conflictsCount,
    donePercent,
    nextMilestone: upcomingMilestones[0]
      ? {
          id: upcomingMilestones[0].id,
          title: upcomingMilestones[0].title,
          date: upcomingMilestones[0].dueDate,
        }
      : null,
    overdueList,
    upcomingMilestones,
    donut: {
      overdueRatio: openWps > 0 ? overdueCount / openWps : 0,
    },
    velocity,
    ...buildBurndown(wps, now),
    conflicts,
    resourceWarnings,
    topOpen,
    topDone,
    topOverdue,
    health,
  };
}

function mapTopWp(w: {
  id: string;
  gitlabIssueIid: number;
  titleCache: string;
  stateCache: string;
  endDate: Date;
  progressPercent: number;
}): DashboardTopWp {
  return {
    id: w.id,
    iid: w.gitlabIssueIid,
    title: w.titleCache,
    endDate: w.endDate,
    state: w.stateCache,
    progressPercent: w.progressPercent,
  };
}

// ── Resource-Warnings ────────────────────────────────────────────────────
const RESOURCE_OVERLOAD_THRESHOLD = 5;
const RESOURCE_LOOKAHEAD_WEEKS = 8;

function computeResourceWarnings(
  wps: Array<{
    id: string;
    startDate: Date;
    endDate: Date;
    stateCache: string;
    assigneesCache: unknown;
  }>,
  now: Date,
): DashboardResourceWarning[] {
  // Wochen-Range bestimmen
  const firstWeekStart = isoWeekStart(now);
  const lastWeekStart = addDays(firstWeekStart, 7 * (RESOURCE_LOOKAHEAD_WEEKS - 1));
  const lastWeekEnd = addDays(lastWeekStart, 6);

  // Map<userId, Map<weekKey, { count, name, weekStart, isoWeek }>>
  type WeekBucket = { count: number; weekStart: Date; isoWeek: number };
  const userWeeks = new Map<number, { name: string; weeks: Map<string, WeekBucket> }>();

  for (const wp of wps) {
    if (wp.stateCache === 'closed') continue;
    if (wp.endDate < firstWeekStart || wp.startDate > lastWeekEnd) continue;
    if (!Array.isArray(wp.assigneesCache)) continue;

    for (const entry of wp.assigneesCache) {
      if (!entry || typeof entry !== 'object') continue;
      const obj = entry as { id?: unknown; name?: unknown; username?: unknown };
      if (typeof obj.id !== 'number') continue;
      const userId = obj.id;
      const name =
        typeof obj.name === 'string'
          ? obj.name
          : typeof obj.username === 'string'
            ? obj.username
            : `User #${userId}`;

      let userEntry = userWeeks.get(userId);
      if (!userEntry) {
        userEntry = { name, weeks: new Map() };
        userWeeks.set(userId, userEntry);
      }

      // Iteriere alle Wochen die der WP berührt
      let cursor = firstWeekStart;
      let weekIdx = 0;
      while (cursor.getTime() <= lastWeekStart.getTime()) {
        const weekEnd = addDays(cursor, 6);
        if (!(wp.endDate < cursor || wp.startDate > weekEnd)) {
          const key = cursor.toISOString().slice(0, 10);
          const bucket = userEntry.weeks.get(key) ?? {
            count: 0,
            weekStart: cursor,
            isoWeek: isoWeekNum(cursor),
          };
          bucket.count += 1;
          userEntry.weeks.set(key, bucket);
        }
        cursor = addDays(cursor, 7);
        weekIdx++;
        if (weekIdx > 100) break; // safety
      }
    }
  }

  // Warnings extrahieren: jeden user-week mit count > threshold
  const warnings: DashboardResourceWarning[] = [];
  for (const [userId, info] of userWeeks.entries()) {
    for (const bucket of info.weeks.values()) {
      if (bucket.count > RESOURCE_OVERLOAD_THRESHOLD) {
        warnings.push({
          gitlabUserId: userId,
          name: info.name,
          isoWeek: bucket.isoWeek,
          weekStart: bucket.weekStart,
          count: bucket.count,
        });
      }
    }
  }
  warnings.sort((a, b) => b.count - a.count);
  return warnings;
}

// ─── Helpers ───────────────────────────────────────────────────────────

function computeHealth(
  overdueCount: number,
  totalWps: number,
  lastSync: Date | null,
  now: Date,
  conflictsCount = 0,
): ProjectHealth {
  if (totalWps === 0) return 'good';
  const overdueRatio = overdueCount / totalWps;
  const staleHours = lastSync
    ? (now.getTime() - lastSync.getTime()) / 3_600_000
    : Infinity;

  if (overdueRatio >= 0.25 || overdueCount >= 5 || staleHours > 48 || conflictsCount >= 3)
    return 'bad';
  if (overdueRatio > 0 || staleHours > 24 || conflictsCount > 0) return 'warning';
  return 'good';
}

function extractInitials(cache: unknown): string[] {
  if (!Array.isArray(cache)) return [];
  const out: string[] = [];
  for (const entry of cache.slice(0, 3)) {
    if (!entry || typeof entry !== 'object') continue;
    const name = (entry as { name?: unknown }).name;
    const username = (entry as { username?: unknown }).username;
    const src = typeof name === 'string' ? name : typeof username === 'string' ? username : '';
    if (!src) continue;
    const initials = src
      .split(' ')
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase();
    if (initials) out.push(initials);
  }
  return out;
}

// ─── Burndown ────────────────────────────────────────────────────────────

// Obergrenze für Stützstellen. Darüber wird ausgedünnt: ein Jahresprojekt
// braucht keine 365 Punkte, um seine Form zu zeigen, und jeder Punkt landet
// als Koordinate im ausgelieferten HTML.
const BURNDOWN_MAX_POINTS = 180;

/**
 * Restbestand offener Arbeitspakete über die Zeit — dreimal, aus drei Quellen:
 *
 *   planBaseline  eingefrorene Baseline (baselineEndDate)
 *   planCurrent   aktuelle Fälligkeiten (endDate)
 *   actual        tatsächliche Abschlüsse (closedAt aus GitLab)
 *
 * Die beiden Plan-Linien laufen bis zum Ende des Zeitfensters, die Ist-Linie
 * endet heute — eine in die Zukunft gezeichnete Ist-Linie wäre eine Behauptung
 * über nicht Geschehenes.
 *
 * Pakete ohne Baseline fallen für planBaseline auf endDate zurück, sonst
 * startete die Baseline-Linie unter dem Gesamtbestand und der Vergleich wäre
 * gegen unterschiedliche Grundgesamtheiten geführt.
 */
function buildBurndown(
  wps: Array<{
    stateCache: string;
    startDate: Date;
    endDate: Date;
    baselineEndDate: Date | null;
    closedAt: Date | null;
    lastSyncedAt: Date;
  }>,
  now: Date,
): { burndown: BurndownPoint[]; burndownEstimated: number } {
  if (wps.length === 0) return { burndown: [], burndownEstimated: 0 };

  const today = startOfDay(now);

  // Geschlossen, aber ohne closed_at aus GitLab: kann bei Paketen auftreten,
  // die vor der Einführung des Feldes synchronisiert wurden. lastSyncedAt ist
  // die beste verfügbare Näherung — die Zahl wird ausgewiesen, damit ein
  // Ausreisser im Chart erklärbar bleibt.
  let estimated = 0;
  const closures = wps.map((w) => {
    if (w.stateCache !== 'closed') return null;
    if (w.closedAt) return startOfDay(w.closedAt);
    estimated += 1;
    return startOfDay(w.lastSyncedAt);
  });

  const planBaselineDates = wps.map((w) => startOfDay(w.baselineEndDate ?? w.endDate));
  const planCurrentDates = wps.map((w) => startOfDay(w.endDate));

  const times = [
    ...wps.map((w) => startOfDay(w.startDate).getTime()),
    ...planBaselineDates.map((d) => d.getTime()),
    ...planCurrentDates.map((d) => d.getTime()),
    ...closures.filter((d): d is Date => d !== null).map((d) => d.getTime()),
    today.getTime(),
  ];
  const first = new Date(Math.min(...times));
  const last = new Date(Math.max(...times));

  const totalDays = Math.round((last.getTime() - first.getTime()) / 86_400_000);
  const step = Math.max(1, Math.ceil((totalDays + 1) / BURNDOWN_MAX_POINTS));

  const burndown: BurndownPoint[] = [];
  for (let offset = 0; offset <= totalDays; offset += step) {
    const d = addDays(first, offset);
    const t = d.getTime();
    burndown.push({
      date: isoDate(d),
      planBaseline: planBaselineDates.filter((p) => p.getTime() > t).length,
      planCurrent: planCurrentDates.filter((p) => p.getTime() > t).length,
      actual:
        t <= today.getTime()
          ? closures.filter((c) => c === null || c.getTime() > t).length
          : null,
    });
  }
  // Der letzte Tag fällt bei einem Schritt > 1 sonst unter den Tisch, und
  // gerade er trägt die Aussage (Plan läuft auf 0, Ist auf den Restbestand).
  const lastSample = burndown[burndown.length - 1];
  if (lastSample && lastSample.date !== isoDate(last)) {
    const t = last.getTime();
    burndown.push({
      date: isoDate(last),
      planBaseline: planBaselineDates.filter((p) => p.getTime() > t).length,
      planCurrent: planCurrentDates.filter((p) => p.getTime() > t).length,
      actual:
        t <= today.getTime()
          ? closures.filter((c) => c === null || c.getTime() > t).length
          : null,
    });
  }

  return { burndown, burndownEstimated: estimated };
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Anzahl historischer Kalenderwochen im Velocity-Chart. Aktuelle KW ist
// immer ganz rechts; die N-1 davorliegenden Wochen füllen nach links auf.
export const VELOCITY_WEEKS = 16;

function buildVelocity(
  audits: Array<{ action: string; after: unknown; createdAt: Date }>,
  now: Date,
): VelocityPoint[] {
  const points: VelocityPoint[] = [];
  // VELOCITY_WEEKS Wochen, beginnend mit der ältesten
  for (let i = VELOCITY_WEEKS - 1; i >= 0; i--) {
    const weekStart = isoWeekStart(addDays(now, -i * 7));
    const weekEnd = addDays(weekStart, 6);
    weekEnd.setHours(23, 59, 59, 999);

    let closedCount = 0;
    let createdCount = 0;
    for (const a of audits) {
      if (a.createdAt < weekStart || a.createdAt > weekEnd) continue;
      if (a.action === 'work_package.create') createdCount++;
      if (a.action === 'work_package.update') {
        const after = a.after as { state?: unknown } | null;
        if (after?.state === 'closed') closedCount++;
      }
    }
    points.push({
      weekStart,
      isoWeek: isoWeekNum(weekStart),
      closedCount,
      createdCount,
    });
  }
  return points;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function isoWeekStart(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay() === 0 ? 7 : x.getDay();
  x.setDate(x.getDate() - (day - 1));
  return x;
}

function isoWeekNum(d: Date): number {
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() + 4 - (t.getDay() === 0 ? 7 : t.getDay()));
  const yearStart = new Date(t.getFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

// Berechnet den Gesamt-Fortschritt eines Projekts als gewichteten Durchschnitt
// pro WP: closed → 100%, offen → progressPercent aus gantt-meta (0..100).
function wpsWeightedDonePercent(
  wps: Array<{ stateCache: string; progressPercent: number }>,
): number {
  if (wps.length === 0) return 0;
  let sum = 0;
  for (const w of wps) {
    sum += w.stateCache === 'closed' ? 100 : Math.max(0, Math.min(100, w.progressPercent));
  }
  return Math.round(sum / wps.length);
}
