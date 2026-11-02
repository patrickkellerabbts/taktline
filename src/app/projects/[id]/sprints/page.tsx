import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { parsePreferences } from '@/lib/preferences';
import { savePreferencesAction } from '@/lib/preferences-actions';
import { AppHeader, SubHeader } from '@/components/layout/AppHeader';
import { SprintsView } from '@/components/sprints/SprintsView';
import { loadProjectBoard } from '@/lib/agile/load-board';

type Props = { params: Promise<{ id: string }> };

export default async function SprintsPage({ params }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const { id } = await params;
  const board = await loadProjectBoard(id);
  if (!board) notFound();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { preferences: true },
  });
  if (parsePreferences(user?.preferences).lastOpenedProjectId !== id) {
    void savePreferencesAction({ lastOpenedProjectId: id });
  }

  return (
    <div className="app">
      <AppHeader username={session.user.username} active="sprints" />
      <SubHeader crumbs={[{ label: 'Projekte', href: '/projects' }, board.name, 'Sprints']} />
      <div style={{ flex: 1, padding: '14px 18px', minHeight: 0, display: 'flex' }}>
        <SprintsView projectId={board.id} cards={board.cards} sprints={board.sprints} />
      </div>
    </div>
  );
}
