// Resource-Matrix für die /resources Seite.
//
// Datenquelle:
//   1. Jeder Assignee eines WPs zählt per Default mit 100% Allokation.
//   2. Wenn für (WP, User) eine ResourceAllocation-Row existiert (aus dem
//      explizit gepflegten `allocations:`-Block im gantt-meta-YAML),
//      ÜBERSCHREIBT deren `allocationPercent` den Default.
// So bekommt man auch dann eine sinnvolle Sicht wenn niemand allocations:
// pflegt — Feinjustierung wird optional dazu gemacht.
//
// Aggregation pro ISO-Woche: für jede (WP, User, Percent)-Tripel wird der
// Prozentsatz auf jede Woche addiert die der WP-Zeitraum [startDate, endDate]
// berührt.

import { prisma } from './db';
import { SCHEDULED_WORK_PACKAGE } from '@/lib/agile/board';

export type WeekKey = string; // "YYYY-Www" (ISO-Wochenformat)

export type ResourceUser = {
  gitlabUserId: number;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  totalPercent: number; // Summe über alle Wochen (gewichtet)
  totalCount: number; // Gesamt-Anzahl Wp-Wochen — für Sortierung im count-Modus
};

export type Contribution = {
  workPackageId: string;
  projectId: string;
  projectName: string;
  title: string;
  gitlabIssueIid: number;
  startDate: Date;
  endDate: Date;
  percent: number; // im jeweiligen Wochen-Slot
};

export type CellLoad = {
  percent: number; // Summe aller Contributions für (User, Woche)
  contributions: Contribution[];
};

export type ResourceWeek = {
  key: WeekKey;
  isoYear: number;
  isoWeek: number;
  startDate: Date; // Montag der KW
};

export type ResourceMatrix = {
  weeks: ResourceWeek[];
  users: ResourceUser[];
  // Map<gitlabUserId, Map<weekKey, CellLoad>>
  cells: Map<number, Map<WeekKey, CellLoad>>;
};

const DEFAULT_WEEKS_AHEAD = 16;

export async function getResourceMatrix(options?: {
  weeksAhead?: number;
  weeksBack?: number;
  // Optional auf ein Projekt einschränken. Ohne Filter werden alle Projekte
  // berücksichtigt (Global-View).
  projectId?: string;
}): Promise<ResourceMatrix> {
  const weeksAhead = options?.weeksAhead ?? DEFAULT_WEEKS_AHEAD;
  const weeksBack = options?.weeksBack ?? 0;
  const projectId = options?.projectId;

  // ── Wochen-Range bilden ───────────────────────────────────────────────
  const today = new Date();
  const firstWeekStart = isoWeekStart(addDays(today, -7 * weeksBack));
  const lastWeekStart = isoWeekStart(addDays(today, 7 * weeksAhead));
  const lastWeekEnd = addDays(lastWeekStart, 6); // Sonntag

  const weeks: ResourceWeek[] = [];
  let cursor = firstWeekStart;
  while (cursor.getTime() <= lastWeekStart.getTime()) {
    const { isoYear, isoWeek } = isoWeekParts(cursor);
    weeks.push({
      key: weekKey(isoYear, isoWeek),
      isoYear,
      isoWeek,
      startDate: new Date(cursor),
    });
    cursor = addDays(cursor, 7);
  }

  // ── Alle WPs laden deren Zeitraum unsere Range schneidet, inkl.
  //    expliziter Allokationen falls vorhanden ───────────────────────────
  const workPackages = await prisma.workPackage.findMany({
    where: {
      deletedAt: null,
      ...SCHEDULED_WORK_PACKAGE,
      startDate: { lte: lastWeekEnd },
      endDate: { gte: firstWeekStart },
      ...(projectId ? { projectId } : {}),
    },
    select: {
      id: true,
      gitlabIssueIid: true,
      titleCache: true,
      startDate: true,
      endDate: true,
      assigneesCache: true,
      projectId: true,
      project: { select: { nameCache: true } },
      resourceAllocations: {
        select: { gitlabUserId: true, allocationPercent: true },
      },
    },
  });

  // ── User-Info Map aus assigneesCache aggregieren ──────────────────────
  // ResourceAllocation hat nur gitlabUserId — Name + Avatar holen wir aus
  // den assigneesCache-Arrays der WPs.
  const userInfo = new Map<
    number,
    { name: string; username: string | null; avatarUrl: string | null }
  >();
  for (const wp of workPackages) {
    const cache = wp.assigneesCache;
    if (!Array.isArray(cache)) continue;
    for (const entry of cache) {
      if (!entry || typeof entry !== 'object') continue;
      const obj = entry as {
        id?: unknown;
        username?: unknown;
        name?: unknown;
        avatarUrl?: unknown;
      };
      if (typeof obj.id !== 'number') continue;
      if (userInfo.has(obj.id)) continue;
      userInfo.set(obj.id, {
        name: typeof obj.name === 'string' ? obj.name : String(obj.username ?? `User #${obj.id}`),
        username: typeof obj.username === 'string' ? obj.username : null,
        avatarUrl: typeof obj.avatarUrl === 'string' ? obj.avatarUrl : null,
      });
    }
  }

  // ── Pro WP: für jeden Assignee einen Percent-Wert ableiten.
  //    Explizite ResourceAllocation überschreibt den 100%-Default. ─────────
  const cells = new Map<number, Map<WeekKey, CellLoad>>();
  const userTotals = new Map<number, number>();

  for (const wp of workPackages) {
    const wpStart = startOfDay(wp.startDate);
    const wpEnd = startOfDay(wp.endDate);

    // Map aus expliziten Allokationen
    const explicit = new Map<number, number>();
    for (const a of wp.resourceAllocations) {
      explicit.set(a.gitlabUserId, a.allocationPercent);
    }

    // Assignees ableiten
    const assigneeIds = new Set<number>();
    if (Array.isArray(wp.assigneesCache)) {
      for (const entry of wp.assigneesCache) {
        if (!entry || typeof entry !== 'object') continue;
        const id = (entry as { id?: unknown }).id;
        if (typeof id === 'number') assigneeIds.add(id);
      }
    }
    // Union aus Assignees + explicit (jemand kann via allocations: gelistet
    // sein ohne offiziell Assignee zu sein)
    const allUserIds = new Set<number>([...assigneeIds, ...explicit.keys()]);

    for (const uid of allUserIds) {
      const percent = explicit.get(uid) ?? 100;
      if (percent <= 0) continue;

      for (const week of weeks) {
        const weekEnd = addDays(week.startDate, 6);
        if (wpEnd < week.startDate || wpStart > weekEnd) continue;

        const cellMap = cells.get(uid) ?? new Map<WeekKey, CellLoad>();
        const cur = cellMap.get(week.key) ?? { percent: 0, contributions: [] };
        cur.percent += percent;
        cur.contributions.push({
          workPackageId: wp.id,
          projectId: wp.projectId,
          projectName: wp.project.nameCache,
          title: wp.titleCache,
          gitlabIssueIid: wp.gitlabIssueIid,
          startDate: wp.startDate,
          endDate: wp.endDate,
          percent,
        });
        cellMap.set(week.key, cur);
        cells.set(uid, cellMap);
        userTotals.set(uid, (userTotals.get(uid) ?? 0) + percent);
      }
    }
  }

  // ── User-Liste bauen, sortiert nach Anzahl Aufgaben-Wochen (count) ────
  const users: ResourceUser[] = [...userTotals.entries()]
    .map(([gitlabUserId, totalPercent]) => {
      const info = userInfo.get(gitlabUserId);
      const userCells = cells.get(gitlabUserId);
      let totalCount = 0;
      if (userCells) {
        for (const c of userCells.values()) totalCount += c.contributions.length;
      }
      return {
        gitlabUserId,
        name: info?.name ?? `User #${gitlabUserId}`,
        username: info?.username ?? null,
        avatarUrl: info?.avatarUrl ?? null,
        totalPercent,
        totalCount,
      };
    })
    .sort((a, b) => b.totalCount - a.totalCount);

  return { weeks, users, cells };
}

// ─── ISO-Wochen-Helpers ─────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// Montag der KW die das Datum enthält (ISO-8601: Woche beginnt Montag).
function isoWeekStart(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay() === 0 ? 7 : x.getDay(); // Sonntag = 7
  x.setDate(x.getDate() - (day - 1));
  return x;
}

function isoWeekParts(d: Date): { isoYear: number; isoWeek: number } {
  // ISO-8601: Donnerstag-Trick.
  const t = startOfDay(d);
  t.setDate(t.getDate() + 4 - (t.getDay() === 0 ? 7 : t.getDay()));
  const isoYear = t.getFullYear();
  const yearStart = new Date(isoYear, 0, 1);
  const isoWeek = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { isoYear, isoWeek };
}

function weekKey(year: number, week: number): string {
  return `${year}-W${String(week).padStart(2, '0')}`;
}
