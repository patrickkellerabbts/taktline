import { notFound } from 'next/navigation';
import { BoardView } from '@/components/board/BoardView';
import { ShareFrame } from '@/components/share/ShareFrame';
import { loadProjectBoard } from '@/lib/agile/load-board';
import { requireShareLink } from '@/lib/share/links';

export const dynamic = 'force-dynamic';

export default async function ShareBoardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await requireShareLink(token);
  const board = await loadProjectBoard(link.projectId, 'guest');
  if (!board) notFound();

  return (
    <ShareFrame token={token} tab="board" projectName={link.projectName}>
      <div style={{ flex: 1, padding: '14px 18px', minHeight: 0, display: 'flex' }}>
        <BoardView
          readOnly
          projectId={board.id}
          cards={board.cards}
          sprints={board.sprints}
          people={[]}
          projectLabels={[]}
        />
      </div>
    </ShareFrame>
  );
}
