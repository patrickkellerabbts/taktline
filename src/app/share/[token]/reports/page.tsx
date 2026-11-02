import { notFound } from 'next/navigation';
import { DashboardSection } from '@/components/reports/ReportSections';
import { ShareFrame } from '@/components/share/ShareFrame';
import { getProjectDashboard } from '@/lib/reports';
import { requireShareLink } from '@/lib/share/links';

export const dynamic = 'force-dynamic';

export default async function ShareReportsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await requireShareLink(token);
  const dashboard = await getProjectDashboard(link.projectId);
  if (!dashboard) notFound();

  return (
    <ShareFrame token={token} tab="reports" projectName={link.projectName}>
      <div
        style={{
          flex: 1,
          padding: '14px 18px',
          minHeight: 0,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <DashboardSection dashboard={dashboard} interactive={false} />
      </div>
    </ShareFrame>
  );
}
