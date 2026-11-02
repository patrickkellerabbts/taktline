import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AppHeader, SubHeader } from '@/components/layout/AppHeader';
import { getProjectDashboard, getProjectsOverview } from '@/lib/reports';
import { DashboardSection, OverviewSection } from '@/components/reports/ReportSections';

type Props = {
  searchParams: Promise<{ project?: string }>;
};

export default async function ReportsPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const { project: projectId } = await searchParams;

  const [overview, dashboard] = await Promise.all([
    getProjectsOverview(),
    projectId ? getProjectDashboard(projectId) : Promise.resolve(null),
  ]);

  return (
    <div className="app">
      <AppHeader username={session.user.username} active="reports" />
      <SubHeader
        crumbs={
          dashboard
            ? [{ label: 'Berichte', href: '/reports' }, dashboard.name]
            : ['Berichte']
        }
        right={
          <span style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>
            <span className="mono tabnum">{overview.length}</span> Projekte
          </span>
        }
      />
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
        <OverviewSection rows={overview} selectedId={projectId ?? null} />
        {dashboard && <DashboardSection dashboard={dashboard} />}
      </div>
    </div>
  );
}
