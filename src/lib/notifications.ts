// Notifications für den Bell-Dropdown im Header.
// Drei Sektionen:
//   - activity: globaler Aktivitäts-Feed der letzten 7 Tage (aus AuditLog)
//   - warnings: Projekte mit stale Sync (>24h ohne erfolgreichen Run)
//   - dueTasks: dem aktuellen User zugewiesene WPs die in 7 Tagen fällig sind

import { prisma } from './db';

export type ActivityItem = {
  id: string;
  message: string;
  createdAt: Date;
  href: string | null;
  actor: string | null;
};

export type WarningItem = {
  id: string;
  message: string;
  href: string;
  ageHours: number;
};

export type DueTaskItem = {
  id: string;
  title: string;
  iid: number;
  endDate: Date;
  daysLeft: number;
  href: string;
  // Wenn true, soll der Link in einem neuen Tab geöffnet werden (z.B. weil
  // er auf GitLab zeigt und nicht auf eine app-interne Route).
  external?: boolean;
};

export type NotificationBundle = {
  activity: ActivityItem[];
  warnings: WarningItem[];
  dueTasks: DueTaskItem[];
  totalCount: number;
};

const STALE_HOURS = 24;
const DUE_WINDOW_DAYS = 7;

export async function getNotifications(
  userId: string,
  gitlabUserId: number | null,
): Promise<NotificationBundle> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const dueDeadline = new Date(now.getTime() + DUE_WINDOW_DAYS * 86_400_000);
  const staleThreshold = new Date(now.getTime() - STALE_HOURS * 3_600_000);

  // User-Marker für die Activity-Filterung. Wenn nie geleert: alle 7 Tage zeigen.
  const userRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { notificationsLastSeenAt: true },
  });
  const activityFloor =
    userRow?.notificationsLastSeenAt && userRow.notificationsLastSeenAt > sevenDaysAgo
      ? userRow.notificationsLastSeenAt
      : sevenDaysAgo;

  // ── 1) Activity-Feed ───────────────────────────────────────────────────
  const auditRows = await prisma.auditLog.findMany({
    where: { createdAt: { gt: activityFloor } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      after: true,
      createdAt: true,
      user: { select: { username: true, name: true } },
    },
  });

  // Projekt + WP-Lookup damit wir Namen und Links bilden können
  const projectIds = new Set<string>();
  const wpIds = new Set<string>();
  for (const row of auditRows) {
    if (row.entityType === 'Project') projectIds.add(row.entityId);
    if (row.entityType === 'WorkPackage') wpIds.add(row.entityId);
  }
  const [projects, workPackages] = await Promise.all([
    projectIds.size > 0
      ? prisma.project.findMany({
          where: { id: { in: [...projectIds] } },
          select: { id: true, nameCache: true },
        })
      : [],
    wpIds.size > 0
      ? prisma.workPackage.findMany({
          where: { id: { in: [...wpIds] } },
          select: { id: true, projectId: true, titleCache: true, gitlabIssueIid: true },
        })
      : [],
  ]);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const wpById = new Map(workPackages.map((w) => [w.id, w]));

  const activity: ActivityItem[] = auditRows.map((row) => {
    const actor = row.user?.name ?? row.user?.username ?? 'System';
    let message = `${actor}: ${row.action}`;
    let href: string | null = null;

    if (row.entityType === 'Project') {
      const p = projectById.get(row.entityId);
      const projectName = p?.nameCache ?? 'Projekt';
      href = p ? `/projects/${p.id}/gantt` : null;
      if (row.action === 'project.activate') {
        message = `${actor} aktivierte Projekt ${projectName}`;
      } else if (row.action === 'project.resync') {
        const counts = extractCounts(row.after);
        message = `${actor} synchronisierte ${projectName}${counts ? ` (${counts})` : ''}`;
      } else if (row.action === 'project.reconcile') {
        const counts = extractCounts(row.after);
        message = `Auto-Sync für ${projectName}${counts ? ` (${counts})` : ''}`;
      }
    } else if (row.entityType === 'WorkPackage') {
      const w = wpById.get(row.entityId);
      const title = w?.titleCache ?? `WP #${row.entityId.slice(0, 6)}`;
      href = w ? `/projects/${w.projectId}/gantt?wp=${w.id}` : null;
      if (row.action === 'work_package.create') {
        message = `${actor} erstellte #${w?.gitlabIssueIid ?? '?'} ${title}`;
      } else if (row.action === 'work_package.update') {
        message = `${actor} bearbeitete #${w?.gitlabIssueIid ?? '?'} ${title}`;
      }
    }

    return {
      id: row.id,
      message,
      createdAt: row.createdAt,
      href,
      actor: row.user?.username ?? null,
    };
  });

  // ── 2) Warnings: Projekte ohne erfolgreichen Sync seit STALE_HOURS ──────
  const staleProjects = await prisma.project.findMany({
    where: {
      OR: [
        { lastFullSyncAt: null },
        { lastFullSyncAt: { lt: staleThreshold } },
      ],
    },
    select: { id: true, nameCache: true, lastFullSyncAt: true },
  });
  const warnings: WarningItem[] = staleProjects.map((p) => {
    const ageHours = p.lastFullSyncAt
      ? Math.round((now.getTime() - p.lastFullSyncAt.getTime()) / 3_600_000)
      : Infinity;
    const ageLabel =
      ageHours === Infinity
        ? 'nie synchronisiert'
        : ageHours < 48
          ? `vor ${ageHours}h`
          : `vor ${Math.round(ageHours / 24)} Tagen`;
    return {
      id: `stale:${p.id}`,
      message: `${p.nameCache} — letzte Sync ${ageLabel}`,
      href: `/projects/${p.id}/gantt`,
      ageHours: ageHours === Infinity ? 9999 : ageHours,
    };
  });

  // ── 3) Mir zugewiesene WPs, fällig in den nächsten 7 Tagen ──────────────
  const dueTasks: DueTaskItem[] = [];
  if (gitlabUserId !== null) {
    const candidates = await prisma.workPackage.findMany({
      where: {
        deletedAt: null,
        endDate: { gte: now, lte: dueDeadline },
        stateCache: 'opened',
      },
      orderBy: { endDate: 'asc' },
      take: 50,
      select: {
        id: true,
        projectId: true,
        gitlabIssueIid: true,
        titleCache: true,
        endDate: true,
        assigneesCache: true,
      },
    });
    for (const wp of candidates) {
      if (!isAssignedTo(wp.assigneesCache, gitlabUserId)) continue;
      const daysLeft = Math.ceil((wp.endDate.getTime() - now.getTime()) / 86_400_000);
      dueTasks.push({
        id: wp.id,
        title: wp.titleCache,
        iid: wp.gitlabIssueIid,
        endDate: wp.endDate,
        daysLeft,
        // Interne Gantt-Route mit ?wp=<id> — der GanttView selectiert dann den
        // WP und öffnet den Inspector direkt. Im Inspector ist der Link zum
        // GitLab-Issue eh nochmal eingebaut falls dort weiter editiert werden soll.
        href: `/projects/${wp.projectId}/gantt?wp=${wp.id}`,
      });
      if (dueTasks.length >= 20) break;
    }
  }

  const totalCount = warnings.length + dueTasks.length;
  return { activity, warnings, dueTasks, totalCount };
}

function isAssignedTo(cache: unknown, gitlabUserId: number): boolean {
  if (!Array.isArray(cache)) return false;
  for (const entry of cache) {
    if (!entry || typeof entry !== 'object') continue;
    const id = (entry as { id?: unknown }).id;
    if (typeof id === 'number' && id === gitlabUserId) return true;
  }
  return false;
}

function extractCounts(after: unknown): string | null {
  if (!after || typeof after !== 'object') return null;
  const counts = (after as { counts?: unknown }).counts;
  if (!counts || typeof counts !== 'object') return null;
  const c = counts as { workPackagesSynced?: unknown; milestonesSynced?: unknown };
  const wp = typeof c.workPackagesSynced === 'number' ? c.workPackagesSynced : null;
  const ms = typeof c.milestonesSynced === 'number' ? c.milestonesSynced : null;
  if (wp === null && ms === null) return null;
  return [wp !== null && `${wp} WPs`, ms !== null && `${ms} Meilensteine`]
    .filter(Boolean)
    .join(', ');
}
