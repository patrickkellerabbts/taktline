import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { parsePreferences } from '@/lib/preferences';
import { savePreferencesAction } from '@/lib/preferences-actions';
import { AppHeader, SubHeader } from '@/components/layout/AppHeader';
import { PspView } from '@/components/psp/PspView';
import type { PspInput } from '@/lib/psp';
import { STORY_LABEL } from '@/lib/agile/board';

type Props = {
  params: Promise<{ id: string }>;
};

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function PspPage({ params }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      nameCache: true,
      workPackages: {
        // Tasks gehören zur Story, nicht in den PSP.
        where: { deletedAt: null, isTask: false },
        select: {
          id: true,
          gitlabIssueIid: true,
          titleCache: true,
          stateCache: true,
          startDate: true,
          endDate: true,
          progressPercent: true,
          isUnscheduled: true,
          labelsCache: true,
          parentId: true,
          parent: { select: { gitlabIssueIid: true } },
        },
      },
    },
  });
  if (!project) notFound();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { preferences: true },
  });
  if (parsePreferences(user?.preferences).lastOpenedProjectId !== id) {
    void savePreferencesAction({ lastOpenedProjectId: id });
  }

  // Stories ohne Termin und ohne Parent leben nur auf dem Board. Hängt etwas
  // darunter, bleiben sie im PSP, sonst fiele der ganze Ast heraus.
  const parentIds = new Set(project.workPackages.map((w) => w.parentId).filter(Boolean));
  const items: PspInput[] = project.workPackages
    .filter((w) => !(w.isUnscheduled && w.parentId === null && !parentIds.has(w.id)))
    .map((w) => {
      const labels = Array.isArray(w.labelsCache) ? (w.labelsCache as Array<{ name?: string }>) : [];
      return {
        id: w.id,
        iid: w.gitlabIssueIid,
        parentIid: w.parent?.gitlabIssueIid ?? null,
        title: w.titleCache,
        start: w.isUnscheduled ? null : isoDay(w.startDate),
        end: w.isUnscheduled ? null : isoDay(w.endDate),
        state: w.stateCache === 'closed' ? 'closed' : 'opened',
        progress: w.progressPercent,
        story: labels.some((l) => l.name === STORY_LABEL),
      };
    });

  return (
    <div className="app">
      <AppHeader username={session.user.username} active="psp" />
      <SubHeader
        crumbs={[{ label: 'Projekte', href: '/projects' }, project.nameCache, 'Projektstrukturplan']}
        right={
          <span style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>
            <span className="mono tabnum">{items.length}</span> Arbeitspakete
          </span>
        }
      />
      <div style={{ flex: 1, padding: '14px 18px', minHeight: 0, display: 'flex' }}>
        <PspView projectId={project.id} projectName={project.nameCache} items={items} />
      </div>
    </div>
  );
}
