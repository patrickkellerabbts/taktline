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
import { GanttView } from '@/components/gantt/GanttView';
import { loadProjectGantt } from '@/lib/gantt/load';
import { ShareButton } from '@/components/share/ShareButton';
import { ResyncButton } from '../ResyncButton';
import { isDemoMode } from '@/lib/demo/mode';

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
  const project = await loadProjectGantt(id);
  if (!project) notFound();

  // Stories ohne Datum haben keinen Balken. Links darauf (Suche,
  // Benachrichtigungen) führen deshalb zur Story auf dem Board.
  const selected = project.workPackages.find((wp) => wp.id === initialSelectedId);
  if (selected?.hidden) {
    redirect(`/projects/${id}/board?story=${selected.id}`);
  }

  return (
    <div className="app">
      <AppHeader username={session.user.username} active="gantt" />
      <SubHeader
        crumbs={[{ label: 'Projekte', href: '/projects' }, project.name, 'Gantt']}
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
            <ResyncButton projectId={project.id} demo={isDemoMode()} />
            <BaselineMenu projectId={project.id} />
            <ExportButton projectId={project.id} />
            <ShareButton projectId={project.id} />
            <NewMilestoneButton projectId={project.id} />
            <NewTaskButton
              projectId={project.id}
              availableParents={project.workPackages.map((wp) => ({
                iid: wp.iid,
                text: wp.title,
              }))}
            />
          </>
        }
      />

      <div style={{ flex: 1, padding: '14px 18px', minHeight: 0, display: 'flex' }}>
        <GanttView
          bars={project.bars}
          milestones={project.milestones}
          dependencies={project.dependencies}
          projectLabels={project.labels.map((l) => ({
            name: l.name,
            color: l.color ?? undefined,
          }))}
          gitlabBaseUrl={process.env.GITLAB_URL}
          gitlabProjectPath={project.name}
          projectInternalId={project.id}
          initialSelectedId={initialSelectedId}
          initialSelectedMilestoneId={initialSelectedMilestoneId}
          initialDisplay={initialDisplay}
        />
      </div>
    </div>
  );
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
