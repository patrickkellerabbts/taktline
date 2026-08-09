import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, ArrowRight, Folder } from 'lucide-react';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { AppHeader, SubHeader } from '@/components/layout/AppHeader';

export default async function ProjectsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const projects = await prisma.project.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      nameCache: true,
      gitlabProjectId: true,
      createdAt: true,
      lastFullSyncAt: true,
      _count: {
        select: {
          workPackages: { where: { deletedAt: null } },
          milestones: true,
        },
      },
    },
  });

  return (
    <div className="app">
      <AppHeader username={session.user.username} active="projects" />
      <SubHeader
        crumbs={['Projekte']}
        right={
          <Link href="/projects/activate" className="btn btn--primary btn--sm">
            <Plus size={12} />
            Projekt aktivieren
          </Link>
        }
      />

      <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px' }} className="scroll-host">
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ marginBottom: 20 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>
              Aktivierte Projekte
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--color-ink-3)' }}>
              {projects.length === 0
                ? 'Du hast noch keine Projekte aktiviert.'
                : `${projects.length} ${projects.length === 1 ? 'Projekt' : 'Projekte'} synchronisiert mit GitLab.`}
            </p>
          </div>

          {projects.length === 0 ? (
            <div
              className="card"
              style={{
                padding: 48,
                textAlign: 'center',
                borderStyle: 'dashed',
                color: 'var(--color-ink-3)',
              }}
            >
              <Folder size={32} style={{ margin: '0 auto 12px', color: 'var(--color-ink-4)' }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-ink-2)', marginBottom: 6 }}>
                Noch keine Projekte
              </div>
              <div style={{ fontSize: 12, marginBottom: 16 }}>
                Aktiviere ein GitLab-Projekt, um Issues und Meilensteine als Gantt zu visualisieren.
              </div>
              <Link href="/projects/activate" className="btn btn--primary">
                <Plus size={13} />
                Erstes Projekt aktivieren
              </Link>
            </div>
          ) : (
            <ul
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: 12,
                margin: 0,
                padding: 0,
                listStyle: 'none',
              }}
            >
              {projects.map((p) => (
                <li key={p.id} className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <Folder size={14} style={{ color: 'var(--color-ink-3)', marginTop: 2 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.nameCache}
                      </div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--color-ink-4)' }}>
                        GitLab #{p.gitlabProjectId}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--color-ink-3)' }}>
                    <span>
                      <span className="mono tabnum" style={{ color: 'var(--color-ink-2)', fontWeight: 600 }}>
                        {p._count.workPackages}
                      </span>{' '}
                      Work Packages
                    </span>
                    <span>
                      <span className="mono tabnum" style={{ color: 'var(--color-ink-2)', fontWeight: 600 }}>
                        {p._count.milestones}
                      </span>{' '}
                      Meilensteine
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--color-ink-4)' }}>
                      {p.lastFullSyncAt
                        ? `Sync ${formatRelative(p.lastFullSyncAt)}`
                        : 'noch nicht synchronisiert'}
                    </span>
                    <Link
                      href={`/projects/${p.id}/gantt`}
                      style={{
                        color: 'var(--color-accent-h)',
                        textDecoration: 'none',
                        fontWeight: 500,
                        fontSize: 12,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      Gantt öffnen <ArrowRight size={12} />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function formatRelative(d: Date): string {
  const diffMin = Math.round((Date.now() - d.getTime()) / 60_000);
  if (diffMin < 1) return 'gerade eben';
  if (diffMin < 60) return `vor ${diffMin} Min.`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} Std.`;
  const diffD = Math.round(diffH / 24);
  return `vor ${diffD} Tag${diffD === 1 ? '' : 'en'}`;
}
