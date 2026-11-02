import { notFound } from 'next/navigation';
import { GanttView } from '@/components/gantt/GanttView';
import { ShareFrame } from '@/components/share/ShareFrame';
import { loadProjectGantt } from '@/lib/gantt/load';
import { requireShareLink } from '@/lib/share/links';

export const dynamic = 'force-dynamic';

export default async function ShareGanttPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await requireShareLink(token);
  const gantt = await loadProjectGantt(link.projectId, 'guest');
  if (!gantt) notFound();

  return (
    <ShareFrame token={token} tab="gantt" projectName={link.projectName}>
      <div style={{ flex: 1, padding: '14px 18px', minHeight: 0, display: 'flex' }}>
        <GanttView
          readOnly
          bars={gantt.bars}
          milestones={gantt.milestones}
          dependencies={gantt.dependencies}
          projectInternalId={gantt.id}
        />
      </div>
    </ShareFrame>
  );
}
