import { prisma } from '@/lib/db';
import { REPORTER_ACCESS_LEVEL, checkAgentAccess, json } from '@/lib/agent/access';
import { getProjectDashboard } from '@/lib/reports';
import { loadFlow } from '@/lib/agile/flow';

// Auswertungen für Agenten, nur lesend:
//   view=report (Standard)  Zahlen der Berichte-Seite plus Baseline-Abweichung
//   view=flow               Karten pro Board-Spalte und Tag (Cumulative Flow)
//   view=audit              Änderungshistorie aus Taktline (ohne Lese-Links)

const DAY = 86_400_000;

function isoDay(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

async function report(projectId: string) {
  const dashboard = await getProjectDashboard(projectId);
  if (!dashboard) return null;
  const baselined = await prisma.workPackage.findMany({
    where: { projectId, deletedAt: null, baselineEndDate: { not: null }, baselineStartDate: { not: null } },
    select: { gitlabIssueIid: true, titleCache: true, startDate: true, endDate: true, baselineStartDate: true, baselineEndDate: true, stateCache: true },
    orderBy: { gitlabIssueIid: 'asc' },
  });
  const deviations = baselined
    .map((w) => ({
      iid: w.gitlabIssueIid,
      title: w.titleCache,
      state: w.stateCache,
      planned: { start: isoDay(w.baselineStartDate), end: isoDay(w.baselineEndDate) },
      current: { start: isoDay(w.startDate), end: isoDay(w.endDate) },
      // Positiv = später als geplant.
      endDeltaDays: Math.round((w.endDate.getTime() - w.baselineEndDate!.getTime()) / DAY),
    }))
    .filter((d) => d.endDeltaDays !== 0 || d.planned.start !== d.current.start);
  return {
    ...dashboard,
    baseline: {
      workPackages: baselined.length,
      late: deviations.filter((d) => d.endDeltaDays > 0).length,
      early: deviations.filter((d) => d.endDeltaDays < 0).length,
      deviations,
    },
  };
}

async function audit(projectId: string, limit: number) {
  const [wps, sprints, milestones] = await Promise.all([
    prisma.workPackage.findMany({ where: { projectId }, select: { id: true, gitlabIssueIid: true } }),
    prisma.sprint.findMany({ where: { projectId }, select: { id: true, number: true } }),
    prisma.milestone.findMany({ where: { projectId }, select: { id: true, gitlabMilestoneId: true } }),
  ]);
  const label = new Map<string, string>([
    [projectId, 'Projekt'],
    ...wps.map((w) => [w.id, `#${w.gitlabIssueIid}`] as [string, string]),
    ...sprints.map((s) => [s.id, `Sprint ${s.number}`] as [string, string]),
    ...milestones.map((m) => [m.id, `Meilenstein ${m.gitlabMilestoneId}`] as [string, string]),
  ]);
  const rows = await prisma.auditLog.findMany({
    where: { entityId: { in: [...label.keys()] }, entityType: { in: ['Project', 'WorkPackage', 'Sprint', 'Milestone'] } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { user: { select: { username: true } } },
  });
  return rows.map((r) => {
    const after = (r.after ?? null) as Record<string, unknown> | null;
    const agent = after && typeof after.agent === 'string' ? after.agent : null;
    return {
      at: r.createdAt.toISOString(),
      by: agent ? `${agent} (Agent)` : (r.user?.username ?? null),
      action: r.action,
      target: label.get(r.entityId) ?? r.entityType,
      before: r.before,
      after: r.after,
    };
  });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const access = await checkAgentAccess(request, params.get('project'), REPORTER_ACCESS_LEVEL);
  if (access instanceof Response) return access;
  const view = params.get('view') ?? 'report';

  if (view === 'flow') {
    const days = Math.min(365, Math.max(1, Number(params.get('days')) || 30));
    const flow = await loadFlow(access.projectId, days);
    return json({ project: access.projectPath, days, flow });
  }
  if (view === 'audit') {
    const limit = Math.min(500, Math.max(1, Number(params.get('limit')) || 50));
    return json({ project: access.projectPath, entries: await audit(access.projectId, limit) });
  }
  if (view !== 'report') return json({ error: 'view muss report, flow oder audit sein' }, 400);
  const data = await report(access.projectId);
  if (!data) return json({ error: 'Projekt nicht gefunden' }, 404);
  return json({ project: access.projectPath, ...data });
}
