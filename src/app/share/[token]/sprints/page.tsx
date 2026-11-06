import { notFound } from 'next/navigation';
import { ShareFrame } from '@/components/share/ShareFrame';
import { SprintsView } from '@/components/sprints/SprintsView';
import { loadProjectBoard } from '@/lib/agile/load-board';
import { computeVelocity, loadCommitments } from '@/lib/agile/commitments';
import { ScrumFrame } from '@/components/sprints/ScrumFrame';
import { requireShareLink } from '@/lib/share/links';

export const dynamic = 'force-dynamic';

export default async function ShareSprintsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await requireShareLink(token);
  const board = await loadProjectBoard(link.projectId, 'guest');
  if (!board) notFound();
  const commitments = await loadCommitments(board.id);
  if (!commitments) notFound();
  const velocity = computeVelocity(board.sprints);

  return (
    <ShareFrame token={token} tab="sprints" projectName={link.projectName}>
      <div style={{ flex: 1, padding: '14px 18px', minHeight: 0, display: 'flex' }}>
        <SprintsView
          readOnly
          projectId={board.id}
          cards={board.cards}
          sprints={board.sprints}
          velocityAverage={velocity.average}
          header={<ScrumFrame projectId={board.id} commitments={commitments} velocity={velocity} readOnly />}
        />
      </div>
    </ShareFrame>
  );
}
