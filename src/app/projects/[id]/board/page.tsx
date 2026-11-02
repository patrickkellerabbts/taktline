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

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ story?: string }>;
};

export default async function BoardPage({ params, searchParams }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const { id } = await params;
  const { story: initialStoryId } = await searchParams;

  const project = await loadProjectBoard(id);
  if (!project) notFound();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { preferences: true },
  });
  if (parsePreferences(user?.preferences).lastOpenedProjectId !== id) {
    void savePreferencesAction({ lastOpenedProjectId: id });
  }

  const people = await loadBoardPeople(project.cards);

  return (
    <div className="app">
      <AppHeader username={session.user.username} active="board" />
      <SubHeader
        crumbs={[{ label: 'Projekte', href: '/projects' }, project.name, 'Board']}
        right={<ShareButton projectId={project.id} />}
      />
      <div style={{ flex: 1, padding: '14px 18px', minHeight: 0, display: 'flex' }}>
        <BoardView
          projectId={project.id}
          cards={project.cards}
          people={people}
          projectLabels={project.labels
            .filter((l) => !isReservedLabel(l.name))
            .map((l) => ({ name: l.name, color: l.color ?? undefined }))}
          initialStoryId={initialStoryId}
        />
      </div>
    </div>
  );
}
