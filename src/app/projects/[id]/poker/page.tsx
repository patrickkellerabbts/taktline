import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { parsePreferences } from '@/lib/preferences';
import { savePreferencesAction } from '@/lib/preferences-actions';
import { AppHeader, SubHeader } from '@/components/layout/AppHeader';
import { PokerView } from '@/components/poker/PokerView';
import { loadPokerState } from '@/lib/agile/poker-state';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ story?: string }>;
};

export default async function PokerPage({ params, searchParams }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const { id } = await params;
  const { story } = await searchParams;

  const project = await prisma.project.findUnique({ where: { id }, select: { id: true, nameCache: true } });
  if (!project) notFound();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { preferences: true },
  });
  if (parsePreferences(user?.preferences).lastOpenedProjectId !== id) {
    void savePreferencesAction({ lastOpenedProjectId: id });
  }

  const state = await loadPokerState(id, session.user.id, story ?? null);
  if (!state) notFound();

  return (
    <div className="app">
      <AppHeader username={session.user.username} active="poker" />
      <SubHeader
        crumbs={[{ label: 'Projekte', href: '/projects' }, project.nameCache, 'Planning Poker']}
        right={
          <span style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>
            Deck: 0 · ½ · 1 · 2 · 3 · 5 · 8 · 13 · 20 · 40 · 100 · ? · ☕
          </span>
        }
      />
      <div style={{ flex: 1, padding: '14px 18px', minHeight: 0, display: 'flex' }}>
        <PokerView projectId={project.id} initialState={state} initialStoryId={story ?? null} />
      </div>
    </div>
  );
}
