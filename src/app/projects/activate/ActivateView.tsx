'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Folder, Plus, ArrowRight, RefreshCw, Info } from 'lucide-react';
import { activateProjectAction } from './actions';

export type ProjectRow = {
  gitlabProjectId: number;
  name: string;
  pathWithNamespace: string;
  description: string | null;
  activatedId: string | null;
};

type FilterMode = 'all' | 'inactive' | 'active';

type Props = {
  projects: ProjectRow[];
};

export function ActivateView({ projects }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');

  const counts = useMemo(
    () => ({
      all: projects.length,
      inactive: projects.filter((p) => !p.activatedId).length,
      active: projects.filter((p) => !!p.activatedId).length,
    }),
    [projects],
  );

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (filter === 'inactive' && p.activatedId) return false;
      if (filter === 'active' && !p.activatedId) return false;
      if (query) {
        const q = query.toLowerCase();
        if (!(p.name + ' ' + p.pathWithNamespace).toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [projects, query, filter]);

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px' }} className="scroll-host">
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>
            Projekt aktivieren
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--color-ink-3)', maxWidth: 580 }}>
            Aktivierung importiert Issues &amp; Meilensteine und legt einen Planungs-Kontext an.
            Nur Projekte, in denen du Maintainer-Rechte hast.
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            padding: 10,
            marginBottom: 12,
          }}
        >
          <div style={{ position: 'relative', flex: 1 }}>
            <Search
              size={13}
              style={{
                position: 'absolute',
                left: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--color-ink-3)',
              }}
            />
            <input
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nach Namespace oder Projektname suchen …"
              style={{ width: '100%', paddingLeft: 28 }}
            />
          </div>
          <div className="seg">
            <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              Alle ({counts.all})
            </button>
            <button type="button" aria-pressed={filter === 'inactive'} onClick={() => setFilter('inactive')}>
              Verfügbar ({counts.inactive})
            </button>
            <button type="button" aria-pressed={filter === 'active'} onClick={() => setFilter('active')}>
              Aktiviert ({counts.active})
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="tbl-head" style={{ height: 36 }}>
            <div className="tbl-head__cell" style={{ width: 60, justifyContent: 'center' }}>
              ID
            </div>
            <div className="tbl-head__cell" style={{ flex: 1, minWidth: 280 }}>
              Projekt
            </div>
            <div className="tbl-head__cell" style={{ width: 220 }}>
              Pfad
            </div>
            <div className="tbl-head__cell" style={{ width: 90, justifyContent: 'center' }}>
              Rolle
            </div>
            <div className="tbl-head__cell" style={{ width: 160, justifyContent: 'flex-end' }} />
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-ink-3)', fontSize: 13 }}>
              Keine Treffer.
            </div>
          ) : (
            filtered.map((p, idx) => (
              <ProjectRowItem
                key={p.gitlabProjectId}
                project={p}
                isLast={idx === filtered.length - 1}
              />
            ))
          )}
        </div>

        <p
          style={{
            fontSize: 11,
            color: 'var(--color-ink-3)',
            marginTop: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Info size={12} />
          Sichtbarkeit basiert auf deinen GitLab-Berechtigungen.
        </p>
      </div>
    </div>
  );
}

function ProjectRowItem({ project, isLast }: { project: ProjectRow; isLast: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function onActivate() {
    setError(null);
    startTransition(async () => {
      const result = await activateProjectAction(project.gitlabProjectId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/projects/${result.projectId}/gantt`);
    });
  }

  return (
    <div
      className="tbl-row"
      style={{
        height: 56,
        borderBottom: isLast ? 'none' : '1px solid var(--color-grid-line)',
      }}
    >
      <div
        className="tbl-row__cell mono"
        style={{
          width: 60,
          justifyContent: 'center',
          color: 'var(--color-ink-3)',
          fontSize: 11,
        }}
      >
        #{project.gitlabProjectId}
      </div>
      <div
        className="tbl-row__cell"
        style={{
          flex: 1,
          minWidth: 280,
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 2,
          padding: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
          <Folder size={13} style={{ color: 'var(--color-ink-3)' }} />
          {project.name}
          {project.activatedId && (
            <span className="chip chip--accent" style={{ marginLeft: 4 }}>
              aktiviert
            </span>
          )}
        </div>
        {project.description && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-ink-3)',
              maxWidth: 540,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {project.description}
          </div>
        )}
      </div>
      <div
        className="tbl-row__cell mono"
        style={{ width: 220, color: 'var(--color-ink-2)', fontSize: 11 }}
      >
        {project.pathWithNamespace}
      </div>
      <div className="tbl-row__cell" style={{ width: 90, justifyContent: 'center' }}>
        <span className="chip">Maintainer</span>
      </div>
      <div
        className="tbl-row__cell"
        style={{ width: 160, justifyContent: 'flex-end', padding: '0 12px', gap: 6 }}
      >
        {project.activatedId ? (
          <Link
            href={`/projects/${project.activatedId}/gantt`}
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
        ) : (
          <>
            <button
              type="button"
              onClick={onActivate}
              disabled={pending}
              className="btn btn--primary btn--sm"
            >
              {pending ? (
                <>
                  <RefreshCw size={12} className="animate-spin" />
                  Aktiviere…
                </>
              ) : (
                <>
                  <Plus size={12} />
                  Aktivieren
                </>
              )}
            </button>
            {error && (
              <span style={{ fontSize: 10, color: 'var(--color-status-blocked)' }}>{error}</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
