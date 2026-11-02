import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Layers } from 'lucide-react';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { parsePreferences } from '@/lib/preferences';
import { savePreferencesAction } from '@/lib/preferences-actions';
import { AppHeader, SubHeader } from '@/components/layout/AppHeader';
import { getResourceMatrix, serializeResourceMatrix } from '@/lib/resources';
import { ResourceHeatmap } from '@/components/resources/ResourceHeatmap';

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ProjectResourcesPage({ params }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, nameCache: true },
  });
  if (!project) notFound();

  // Last-opened für Convenience-Redirects (Nav-Klick "Ressourcen"/"Gantt"
  // springt direkt zurück zu diesem Projekt). Fire-and-forget.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { preferences: true },
  });
  const prefs = parsePreferences(user?.preferences);
  if (prefs.lastOpenedProjectId !== id) {
    void savePreferencesAction({ lastOpenedProjectId: id });
  }

  const matrix = await getResourceMatrix({ weeksAhead: 16, projectId: id });

  const data = serializeResourceMatrix(matrix);

  let maxCount = 0;
  for (const m of matrix.cells.values()) {
    for (const c of m.values()) {
      if (c.contributions.length > maxCount) maxCount = c.contributions.length;
    }
  }

  return (
    <div className="app">
      <AppHeader username={session.user.username} active="resources" />
      <SubHeader
        crumbs={[
          { label: 'Projekte', href: '/projects' },
          project.nameCache,
          'Ressourcen',
        ]}
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>
              {matrix.users.length > 0 ? (
                <>
                  <span className="mono tabnum">{matrix.users.length}</span> Personen ·{' '}
                  <span className="mono tabnum">{matrix.weeks.length}</span> KW · max{' '}
                  <span className="mono tabnum">{maxCount}</span> Aufgaben/KW
                </>
              ) : (
                'Keine Daten'
              )}
            </span>
            <Link
              href="/resources/all"
              className="btn btn--sm btn--ghost"
              title="Ressourcen über alle Projekte"
            >
              <Layers size={12} />
              <span>Alle Projekte</span>
            </Link>
          </div>
        }
      />
      <div style={{ flex: 1, padding: '14px 18px', minHeight: 0, display: 'flex' }}>
        <div
          className="card"
          style={{ flex: 1, padding: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}
        >
          <ResourceHeatmap data={data} />
        </div>
      </div>
    </div>
  );
}
