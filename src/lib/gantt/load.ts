import { prisma } from '@/lib/db';
import { SCHEDULED_WORK_PACKAGE } from '@/lib/agile/board';
import type {
  GanttAssignee,
  GanttBar,
  GanttLabel,
  GanttMilestone,
} from '@/components/gantt/GanttView';
import { computeSummaries } from './summary';

// `guest` = Lese-Link: Merge Requests und Avatare enthalten URLs der
// GitLab-Instanz und bleiben deshalb draussen.
export type GanttAudience = 'member' | 'guest';

export async function loadProjectGantt(projectId: string, audience: GanttAudience = 'member') {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      nameCache: true,
      lastFullSyncAt: true,
      workPackages: {
        where: { deletedAt: null },
        orderBy: [{ startDate: 'asc' }, { gitlabIssueIid: 'asc' }],
        select: {
          id: true,
          gitlabIssueIid: true,
          titleCache: true,
          stateCache: true,
          startDate: true,
          endDate: true,
          progressPercent: true,
          isSummary: true,
          isUnscheduled: true,
          parentId: true,
          labelsCache: true,
          assigneesCache: true,
          milestoneId: true,
          baselineStartDate: true,
          baselineEndDate: true,
          mergeRequests: {
            orderBy: { mrIid: 'desc' },
            select: {
              mrIid: true,
              title: true,
              state: true,
              sourceBranch: true,
              targetBranch: true,
              webUrl: true,
              pipelineId: true,
              pipelineStatus: true,
              pipelineWebUrl: true,
              authorName: true,
              authorAvatarUrl: true,
              lastSyncedAt: true,
            },
          },
        },
      },
      milestones: {
        orderBy: { dueDateCache: 'asc' },
        select: {
          id: true,
          gitlabMilestoneId: true,
          titleCache: true,
          descriptionCache: true,
          dueDateCache: true,
          stateCache: true,
          isGroupMilestone: true,
        },
      },
      labels: {
        orderBy: { name: 'asc' },
        select: { name: true, color: true },
      },
    },
  });
  if (!project) return null;

  // Stories ohne Datum gibt es im Gantt nicht als Balken.
  const isHidden = (wp: { isUnscheduled: boolean; isSummary: boolean }) =>
    wp.isUnscheduled && !wp.isSummary;
  const plannedWorkPackages = project.workPackages.filter((wp) => !isHidden(wp));

  const dependencies = await prisma.dependency.findMany({
    where: {
      predecessor: { projectId, ...SCHEDULED_WORK_PACKAGE },
      successor: SCHEDULED_WORK_PACKAGE,
    },
    select: {
      id: true,
      predecessorId: true,
      successorId: true,
      type: true,
      lagDays: true,
    },
  });

  const rawBars: GanttBar[] = plannedWorkPackages.map((wp) => ({
    id: wp.id,
    text: wp.titleCache,
    gitlabIssueIid: wp.gitlabIssueIid,
    start: wp.startDate,
    end: wp.endDate,
    progress: wp.progressPercent / 100,
    state: wp.stateCache,
    isSummary: wp.isSummary,
    parentId: wp.parentId,
    milestoneId: wp.milestoneId,
    labels: parseLabelsCache(wp.labelsCache),
    assignees: parseAssigneesCache(wp.assigneesCache).map((a) =>
      audience === 'guest' ? { ...a, avatarUrl: undefined } : a,
    ),
    baselineStart: wp.baselineStartDate,
    baselineEnd: wp.baselineEndDate,
    mergeRequests: audience === 'guest' ? [] : wp.mergeRequests.map((m) => ({
      iid: m.mrIid,
      title: m.title,
      state: m.state,
      sourceBranch: m.sourceBranch,
      targetBranch: m.targetBranch,
      webUrl: m.webUrl,
      authorName: m.authorName,
      authorAvatarUrl: m.authorAvatarUrl,
      pipeline:
        m.pipelineId != null
          ? {
              id: m.pipelineId,
              status: m.pipelineStatus ?? '',
              webUrl: m.pipelineWebUrl ?? '',
            }
          : null,
      lastSyncedAt: m.lastSyncedAt,
    })),
  }));

  // Summary-Bars aus Kindern aggregieren (Start = min, End = max, Progress = gewichteter ⌀)
  const summaries = computeSummaries(rawBars);
  const bars: GanttBar[] = rawBars.map((b) => {
    const s = summaries.get(b.id);
    if (!s || !s.hasChildren) return b;
    return { ...b, start: s.start, end: s.end, progress: s.progress, isSummary: true };
  });

  const milestones: GanttMilestone[] = project.milestones.map((m) => ({
    id: m.id,
    text: m.titleCache,
    gitlabMilestoneId: m.gitlabMilestoneId,
    date: m.dueDateCache,
    description: m.descriptionCache,
    state: m.stateCache,
    isGroupMilestone: m.isGroupMilestone,
  }));

  return {
    id: project.id,
    name: project.nameCache,
    lastFullSyncAt: project.lastFullSyncAt,
    labels: project.labels,
    workPackages: project.workPackages.map((wp) => ({
      id: wp.id,
      iid: wp.gitlabIssueIid,
      title: wp.titleCache,
      hidden: isHidden(wp),
    })),
    bars,
    milestones,
    dependencies,
  };
}

function parseAssigneesCache(cache: unknown): GanttAssignee[] {
  if (!Array.isArray(cache)) return [];
  return cache
    .map((entry): GanttAssignee | null => {
      if (!entry || typeof entry !== 'object') return null;
      const obj = entry as {
        id?: unknown;
        username?: unknown;
        name?: unknown;
        avatarUrl?: unknown;
      };
      if (typeof obj.id !== 'number') return null;
      if (typeof obj.username !== 'string') return null;
      return {
        id: obj.id,
        username: obj.username,
        name: typeof obj.name === 'string' ? obj.name : obj.username,
        avatarUrl: typeof obj.avatarUrl === 'string' ? obj.avatarUrl : undefined,
      };
    })
    .filter((x): x is GanttAssignee => x !== null);
}

function parseLabelsCache(cache: unknown): GanttLabel[] {
  if (!Array.isArray(cache)) return [];
  return cache
    .map((entry): GanttLabel | null => {
      if (typeof entry === 'string') return { name: entry };
      if (entry && typeof entry === 'object' && 'name' in entry) {
        const name = (entry as { name: unknown }).name;
        const color = (entry as { color?: unknown }).color;
        if (typeof name !== 'string') return null;
        return { name, color: typeof color === 'string' ? color : undefined };
      }
      return null;
    })
    .filter((x): x is GanttLabel => x !== null);
}
