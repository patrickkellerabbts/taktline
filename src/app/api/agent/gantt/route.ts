import { REPORTER_ACCESS_LEVEL, checkAgentAccess, json } from '@/lib/agent/access';
import { prisma } from '@/lib/db';
import { loadProjectGantt } from '@/lib/gantt/load';

// Gantt-Daten für Agenten, genau wie die Web-App sie zeichnet: mit
// Sammelbalken aus den Kindern, Baseline, Abhängigkeiten und Meilensteinen.
// Die Taktline-CLI rendert daraus die Druckansicht als SVG oder PDF.
// Dazu pro Balken Soll- und Ist-Stunden aus der GitLab-Zeiterfassung und die
// verknüpften Merge Requests mit Pipeline (Agenten sind Projektmitglieder).

function hours(seconds: number | null | undefined): number | null {
  return seconds ? Math.round((seconds / 3600) * 100) / 100 : null;
}

function isoDay(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export async function GET(request: Request) {
  const access = await checkAgentAccess(request, new URL(request.url).searchParams.get('project'), REPORTER_ACCESS_LEVEL);
  if (access instanceof Response) return access;
  const gantt = await loadProjectGantt(access.projectId, 'member');
  if (!gantt) return json({ error: 'Projekt nicht gefunden' }, 404);
  const time = new Map(
    (
      await prisma.workPackage.findMany({
        where: { projectId: access.projectId, deletedAt: null },
        select: { id: true, estimateSeconds: true, spentSeconds: true },
      })
    ).map((w) => [w.id, w]),
  );

  return json({
    project: access.projectPath,
    name: gantt.name,
    bars: gantt.bars.map((b) => ({
      id: b.id,
      iid: b.gitlabIssueIid,
      title: b.text,
      start: isoDay(b.start),
      end: isoDay(b.end),
      progress: Math.round(b.progress * 100),
      state: b.state,
      summary: b.isSummary,
      parentId: b.parentId,
      baselineStart: isoDay(b.baselineStart),
      baselineEnd: isoDay(b.baselineEnd),
      assignees: (b.assignees ?? []).map((a) => a.username),
      estimateHours: hours(time.get(b.id)?.estimateSeconds),
      spentHours: hours(time.get(b.id)?.spentSeconds),
      mergeRequests: (b.mergeRequests ?? []).map((m) => ({
        iid: m.iid,
        title: m.title,
        state: m.state,
        pipelineStatus: m.pipeline?.status || null,
        webUrl: m.webUrl,
      })),
    })),
    milestones: gantt.milestones.map((m) => ({
      id: m.id,
      gitlabId: m.gitlabMilestoneId,
      title: m.text,
      due: isoDay(m.date),
      state: m.state ?? null,
    })),
    dependencies: gantt.dependencies.map((d) => ({
      id: d.id,
      predecessorId: d.predecessorId,
      successorId: d.successorId,
      type: d.type,
      lagDays: d.lagDays,
    })),
  });
}
