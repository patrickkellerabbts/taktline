import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { parsePreferences } from '@/lib/preferences';
import { savePreferencesAction } from '@/lib/preferences-actions';
import { AppHeader, SubHeader } from '@/components/layout/AppHeader';
import { BoardView } from '@/components/board/BoardView';
import { ShareButton } from '@/components/share/ShareButton';
import { isReservedLabel } from '@/lib/agile/board';
import { loadBoardPeople, loadProjectBoard } from '@/lib/agile/load-board';
import { loadCommitments } from '@/lib/agile/commitments';
import { loadFlow, recordBoardSnapshot } from '@/lib/agile/flow';
import { parseWipLimits } from '@/lib/agile/flow-shared';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ story?: string; task?: string; view?: string }>;
};

export default async function BoardPage({ params, searchParams }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const { id } = await params;
  const { story: initialStoryId, task: initialTaskId, view } = await searchParams;

  const project = await loadProjectBoard(id);
  if (!project) notFound();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { preferences: true, gitlabUserId: true },
  });
  if (parsePreferences(user?.preferences).lastOpenedProjectId !== id) {
    void savePreferencesAction({ lastOpenedProjectId: id });
  }

  const people = await loadBoardPeople(project.cards);
  const commitments = await loadCommitments(project.id);
  // Den heutigen Stand festhalten, bevor das Diagramm ihn liest.
  await recordBoardSnapshot(project.id);
  const [flow, wipRow] = await Promise.all([
    loadFlow(project.id),
    prisma.project.findUnique({ where: { id: project.id }, select: { wipLimits: true } }),
  ]);

  return (
    <div className="app">
      <AppHeader username={session.user.username} active="board" />
      <SubHeader
        crumbs={[{ label: 'Projekte', href: '/projects' }, project.name, 'Board']}
        right={<ShareButton projectId={project.id} />}
      />
      <div style={{ flex: 1, padding: '14px 18px', minHeight: 0, display: 'flex' }}>
        <BoardView
          // Neuer Sprung aus der Suche: frischer Zustand (aufgeklappt, Filter, Hervorhebung).
          key={initialTaskId ?? 'board'}
          projectId={project.id}
          cards={project.cards}
          sprints={project.sprints}
          people={people}
          projectLabels={project.labels
            .filter((l) => !isReservedLabel(l.name))
            .map((l) => ({ name: l.name, color: l.color ?? undefined }))}
          initialStoryId={initialStoryId}
          initialTaskId={initialTaskId}
          initialView={view === 'mine' || view === 'tasks' || view === 'flow' ? view : 'cards'}
          currentGitlabUserId={user?.gitlabUserId ?? null}
          definitionOfDone={commitments?.definitionOfDone ?? []}
          wipLimits={parseWipLimits(wipRow?.wipLimits)}
          flow={flow}
        />
      </div>
    </div>
  );
}
