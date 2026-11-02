import { notFound } from 'next/navigation';
import { ShareFrame } from '@/components/share/ShareFrame';
import { SprintsView } from '@/components/sprints/SprintsView';
import { loadProjectBoard } from '@/lib/agile/load-board';
import { requireShareLink } from '@/lib/share/links';

export const dynamic = 'force-dynamic';

export default async function ShareSprintsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await requireShareLink(token);
  const board = await loadProjectBoard(link.projectId, 'guest');
  if (!board) notFound();

  return (
    <ShareFrame token={token} tab="sprints" projectName={link.projectName}>
      <div style={{ flex: 1, padding: '14px 18px', minHeight: 0, display: 'flex' }}>
        <SprintsView readOnly projectId={board.id} cards={board.cards} sprints={board.sprints} />
      </div>
    </ShareFrame>
  );
}
