import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { parsePreferences } from '@/lib/preferences';
import { savePreferencesAction } from '@/lib/preferences-actions';
import { AppHeader, SubHeader } from '@/components/layout/AppHeader';
import { NewTaskButton } from './NewTaskButton';
import { NewMilestoneButton } from './NewMilestoneButton';
import { ExportButton } from './ExportButton';
import { BaselineMenu } from './BaselineMenu';
import {
  GanttView,
  type GanttAssignee,
  type GanttBar,
  type GanttLabel,
  type GanttMilestone,
} from '@/components/gantt/GanttView';
import { computeSummaries } from '@/lib/gantt/summary';
import { ResyncButton } from '../ResyncButton';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    wp?: string;
    ms?: string;
    deps?: string;
    crit?: string;
    weekends?: string;
    density?: string;
  }>;
};

export default async function GanttPage({ params, searchParams }: Props) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const { id } = await params;
  const {
    wp: initialSelectedId,
    ms: initialSelectedMilestoneId,
    deps: depsParam,
    crit: critParam,
    weekends: weekendsParam,
    density: densityParam,
  } = await searchParams;
  // User-Präferenzen aus der DB als Defaults laden
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { preferences: true },
  });
  const prefs = parsePreferences(user?.preferences);

  // "Zuletzt geöffnetes Projekt" persistieren, damit der Gantt-Nav-Link
  // direkt hierher zurückspringt. Fire-and-forget — wenn das DB-Update kurz
  // hängt, soll der Render nicht warten.
  if (prefs.lastOpenedProjectId !== id) {
    void savePreferencesAction({ lastOpenedProjectId: id });
  }

  // Display-Settings: URL-Param > User-Pref > Hardcoded-Default.
  // depsParam === undefined heißt "kein URL-Param" → falls in Prefs gesetzt
  // nutze das, sonst Default true.
  const initialDisplay = {
    showDeps:
      depsParam === undefined
        ? prefs.showDeps
        : depsParam !== '0',
    showCrit:
      critParam === undefined
        ? prefs.showCrit
        : critParam === '1',
    showWeekends:
      weekendsParam === undefined
        ? prefs.showWeekends
        : weekendsParam !== '0',
    showBaseline: prefs.showBaseline,
    density:
      densityParam === 'compact'
        ? ('compact' as const)
        : densityParam === 'comfort'
          ? ('comfort' as const)
          : prefs.density,
    zoom: prefs.zoom,
    filter: prefs.filter,
    leftColWidth: prefs.leftColWidth,
    inspectorWidth: prefs.inspectorWidth,
    leftListCollapsed: prefs.leftListCollapsed,
    closeInspectorOnEmptyClick: prefs.closeInspectorOnEmptyClick,
    pinchSensitivity: prefs.pinchSensitivity,
    pinchSmoothing: prefs.pinchSmoothing,
    pinchLockMs: prefs.pinchLockMs,
  };
  const project = await prisma.project.findUnique({
    where: { id },
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
  if (!project) notFound();

  const dependencies = await prisma.dependency.findMany({
    where: { predecessor: { projectId: id } },
    select: {
      id: true,
      predecessorId: true,
      successorId: true,
      type: true,
      lagDays: true,
    },
  });

  const rawBars: GanttBar[] = project.workPackages.map((wp) => ({
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
    assignees: parseAssigneesCache(wp.assigneesCache),
    baselineStart: wp.baselineStartDate,
    baselineEnd: wp.baselineEndDate,
    mergeRequests: wp.mergeRequests.map((m) => ({
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

  return (
    <div className="app">
      <AppHeader username={session.user.username} active="gantt" />
      <SubHeader
        crumbs={[{ label: 'Projekte', href: '/projects' }, project.nameCache, 'Gantt']}
        right={
          <>
            <span
              className="subbar__sync-info"
              style={{ fontSize: 11, color: 'var(--color-ink-3)' }}
            >
              {project.lastFullSyncAt ? (
                <>
                  Letzte Sync <span className="mono">{formatRelative(project.lastFullSyncAt)}</span>
                </>
              ) : (
                'Noch nicht synchronisiert'
              )}
            </span>
            <ResyncButton projectId={project.id} />
            <BaselineMenu projectId={project.id} />
            <ExportButton projectId={project.id} />
            <NewMilestoneButton projectId={project.id} />
            <NewTaskButton
              projectId={project.id}
              availableParents={project.workPackages.map((wp) => ({
                iid: wp.gitlabIssueIid,
                text: wp.titleCache,
              }))}
            />
          </>
        }
      />

      <div style={{ flex: 1, padding: '14px 18px', minHeight: 0, display: 'flex' }}>
        <GanttView
          bars={bars}
          milestones={milestones}
          dependencies={dependencies}
          projectLabels={project.labels.map((l) => ({
            name: l.name,
            color: l.color ?? undefined,
          }))}
          gitlabBaseUrl={process.env.GITLAB_URL}
          gitlabProjectPath={project.nameCache}
          projectInternalId={project.id}
          initialSelectedId={initialSelectedId}
          initialSelectedMilestoneId={initialSelectedMilestoneId}
          initialDisplay={initialDisplay}
        />
      </div>
    </div>
  );
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

function formatRelative(d: Date): string {
  const diff = Math.round((Date.now() - d.getTime()) / 60_000);
  if (diff < 1) return 'gerade eben';
  if (diff < 60) return `vor ${diff} Min.`;
  const h = Math.round(diff / 60);
  if (h < 24) return `vor ${h} Std.`;
  const days = Math.round(h / 24);
  return `vor ${days} Tag${days === 1 ? '' : 'en'}`;
}
