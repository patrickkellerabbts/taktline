import { ResourceHeatmap } from '@/components/resources/ResourceHeatmap';
import { ShareFrame } from '@/components/share/ShareFrame';
import { getResourceMatrix, serializeResourceMatrix } from '@/lib/resources';
import { requireShareLink } from '@/lib/share/links';

export const dynamic = 'force-dynamic';

export default async function ShareResourcesPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await requireShareLink(token);
  const matrix = await getResourceMatrix({ weeksAhead: 16, projectId: link.projectId });
  const data = serializeResourceMatrix(matrix);

  return (
    <ShareFrame token={token} tab="resources" projectName={link.projectName}>
      <div style={{ flex: 1, padding: '14px 18px', minHeight: 0, display: 'flex' }}>
        <div
          className="card"
          style={{ flex: 1, padding: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}
        >
          <ResourceHeatmap
            data={{ ...data, users: data.users.map((u) => ({ ...u, avatarUrl: null })) }}
            linkTasks={false}
          />
        </div>
      </div>
    </ShareFrame>
  );
}
