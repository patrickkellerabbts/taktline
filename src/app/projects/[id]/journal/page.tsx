import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { parsePreferences } from '@/lib/preferences';
import { savePreferencesAction } from '@/lib/preferences-actions';
import { AppHeader, SubHeader } from '@/components/layout/AppHeader';
import { JournalView } from '@/components/journal/JournalView';
import { loadProjectJournal } from '@/lib/journal';

type Props = { params: Promise<{ id: string }> };

export default async function JournalPage({ params }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, nameCache: true },
  });
  if (!project) notFound();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { preferences: true },
  });
  if (parsePreferences(user?.preferences).lastOpenedProjectId !== id) {
    void savePreferencesAction({ lastOpenedProjectId: id });
  }

  // AI-Vorschläge sieht nur die Person, für die sie gedacht sind, bis sie sie
  // übernimmt.
  const entries = (await loadProjectJournal(id)).filter(
    (e) => !e.suggestedBy || e.author.id === session.user.id,
  );

  return (
    <div className="app">
      <AppHeader username={session.user.username} active="journal" />
      <SubHeader crumbs={[{ label: 'Projekte', href: '/projects' }, project.nameCache, 'Journal']} />
      <div style={{ flex: 1, padding: '14px 18px', minHeight: 0, display: 'flex' }}>
        <JournalView projectId={project.id} entries={entries} currentUserId={session.user.id} />
      </div>
    </div>
  );
}
