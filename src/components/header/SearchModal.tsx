'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Folder, ListChecks, Diamond, X } from 'lucide-react';
import type {
  SearchResults,
  SearchProjectHit,
  SearchWorkPackageHit,
  SearchMilestoneHit,
} from '@/lib/search';

type AnyHit = SearchProjectHit | SearchWorkPackageHit | SearchMilestoneHit;

type Props = {
  open: boolean;
  onClose: () => void;
};

export function SearchModal({ open, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>({
    projects: [],
    workPackages: [],
    milestones: [],
  });
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Flat-Liste über alle Kategorien — für Keyboard-Navigation.
  const flat: AnyHit[] = useMemo(
    () => [...results.projects, ...results.workPackages, ...results.milestones],
    [results],
  );

  // Bei open: Input fokussieren, Query reset. setState-in-effect ist hier
  // beabsichtigt — wir resetten den Modal-State wenn er geöffnet wird.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults({ projects: [], workPackages: [], milestones: [] });
    setActiveIdx(0);
    // Nächster Tick damit der Input gemounted ist
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Suche mit 200ms Debounce. setState-in-effect ist hier beabsichtigt
  // (debounced Async-Fetch mit lokalem loading-Indikator).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    if (query.trim().length === 0) {
      setResults({ projects: [], workPackages: [], milestones: [] });
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = (await res.json()) as SearchResults;
        setResults(json);
        setActiveIdx(0);
      } catch {
        // Stille Failure — leere Liste
        setResults({ projects: [], workPackages: [], milestones: [] });
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query, open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const navigate = useCallback(
    (hit: AnyHit) => {
      router.push(hit.href);
      onClose();
    },
    [router, onClose],
  );

  // Keyboard-Navigation
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(flat.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const hit = flat[activeIdx];
        if (hit) navigate(hit);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, flat, activeIdx, navigate, onClose]);

  if (!open) return null;

  const total = flat.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Suchen"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.4)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 'min(15vh, 120px)',
      }}
    >
      <div
        style={{
          width: 'min(640px, 92vw)',
          background: 'var(--color-surface)',
          borderRadius: 'var(--r-3)',
          boxShadow: 'var(--shadow-2)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '70vh',
          overflow: 'hidden',
        }}
      >
        {/* Input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 14px',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <Search size={15} style={{ color: 'var(--color-ink-3)' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Suchen über Projekte, Aufgaben, Meilensteine …"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 14,
              color: 'var(--color-ink)',
              fontFamily: 'inherit',
            }}
          />
          <kbd
            className="kbd mono"
            style={{
              fontSize: 10,
              padding: '2px 5px',
              border: '1px solid var(--color-border)',
              borderRadius: 3,
              color: 'var(--color-ink-3)',
            }}
          >
            ESC
          </kbd>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            style={{
              border: 'none',
              background: 'transparent',
              padding: 4,
              cursor: 'pointer',
              color: 'var(--color-ink-3)',
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Results */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {query.trim().length === 0 && (
            <Empty>
              Tippe um zu suchen. <span className="mono">↑↓</span> zum Navigieren,{' '}
              <span className="mono">Enter</span> zum Öffnen.
            </Empty>
          )}
          {query.trim().length > 0 && !loading && total === 0 && (
            <Empty>Keine Treffer für &bdquo;{query}&ldquo;</Empty>
          )}
          {query.trim().length > 0 && loading && total === 0 && <Empty>Sucht …</Empty>}

          {results.projects.length > 0 && (
            <Category icon={<Folder size={11} />} title="Projekte">
              {results.projects.map((p) => {
                const idx = flat.indexOf(p);
                return (
                  <Row
                    key={p.id}
                    active={idx === activeIdx}
                    onClick={() => navigate(p)}
                    onMouseEnter={() => setActiveIdx(idx)}
                  >
                    <Folder size={13} style={{ color: 'var(--color-ink-3)' }} />
                    <span>{p.name}</span>
                  </Row>
                );
              })}
            </Category>
          )}

          {results.workPackages.length > 0 && (
            <Category icon={<ListChecks size={11} />} title="Aufgaben">
              {results.workPackages.map((w) => {
                const idx = flat.indexOf(w);
                return (
                  <Row
                    key={w.id}
                    active={idx === activeIdx}
                    onClick={() => navigate(w)}
                    onMouseEnter={() => setActiveIdx(idx)}
                  >
                    <span
                      className="dot"
                      style={{
                        background:
                          w.state === 'closed'
                            ? 'var(--color-status-done)'
                            : 'var(--color-status-open)',
                      }}
                    />
                    <span className="mono" style={{ color: 'var(--color-ink-3)', fontSize: 11 }}>
                      #{w.iid}
                    </span>
                    {w.task && <span className="chip">Task</span>}
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {w.title}
                      {w.task && w.storyTitle && (
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--color-ink-3)' }}>
                          in: {w.storyTitle}
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>
                      {w.projectName}
                    </span>
                  </Row>
                );
              })}
            </Category>
          )}

          {results.milestones.length > 0 && (
            <Category icon={<Diamond size={11} />} title="Meilensteine">
              {results.milestones.map((m) => {
                const idx = flat.indexOf(m);
                return (
                  <Row
                    key={m.id}
                    active={idx === activeIdx}
                    onClick={() => navigate(m)}
                    onMouseEnter={() => setActiveIdx(idx)}
                  >
                    <Diamond size={12} style={{ color: 'var(--color-status-milestone)' }} />
                    <span style={{ flex: 1 }}>{m.title}</span>
                    <span style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>
                      {m.projectName}
                    </span>
                  </Row>
                );
              })}
            </Category>
          )}
        </div>

        <div
          style={{
            padding: '6px 12px',
            borderTop: '1px solid var(--color-border)',
            background: 'var(--color-surface-2)',
            fontSize: 10,
            color: 'var(--color-ink-3)',
            display: 'flex',
            gap: 14,
            alignItems: 'center',
          }}
        >
          <span>
            <span className="mono">↑↓</span> navigieren
          </span>
          <span>
            <span className="mono">Enter</span> öffnen
          </span>
          <span>
            <span className="mono">ESC</span> schließen
          </span>
          {total > 0 && (
            <span style={{ marginLeft: 'auto' }} className="mono tabnum">
              {total} Treffer
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Category({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          padding: '8px 14px 4px',
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--color-ink-3)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Row({
  active,
  onClick,
  onMouseEnter,
  children,
}: {
  active: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '8px 14px',
        border: 'none',
        background: active ? 'var(--color-selected)' : 'transparent',
        color: 'var(--color-ink)',
        cursor: 'pointer',
        fontSize: 12,
        textAlign: 'left',
        fontFamily: 'inherit',
        transition: 'background .08s',
      }}
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 28,
        fontSize: 12,
        color: 'var(--color-ink-3)',
        textAlign: 'center',
      }}
    >
      {children}
    </div>
  );
}
