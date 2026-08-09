'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GitCompareArrows, Snowflake, Trash2 } from 'lucide-react';
import {
  listBaselineTargetsAction,
  updateWorkPackageAction,
} from './actions';

type Props = {
  projectId: string;
};

type Progress =
  | { phase: 'idle' }
  | { phase: 'preparing'; mode: 'freeze' | 'clear' }
  | { phase: 'running'; mode: 'freeze' | 'clear'; done: number; total: number }
  | { phase: 'done'; mode: 'freeze' | 'clear'; done: number; total: number };

// Pro-WP-Iteration im Client damit der User Live-Progress sieht. Pro WP wird
// updateWorkPackageAction aufgerufen — das macht den GitLab-Roundtrip + DB-
// Update. Sequenziell um Rate-Limits zu schonen und Progress-Steps sichtbar
// zu halten (Parallelisierung würde nur die "Total"-Zeit verkürzen aber den
// Progress-Indikator nutzlos machen).
export function BaselineMenu({ projectId }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>({ phase: 'idle' });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const isWorking = progress.phase === 'preparing' || progress.phase === 'running';

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      // Während eines Runs nicht schliessen — sonst kann der User den Status
      // nicht mehr verfolgen.
      if (progress.phase === 'preparing' || progress.phase === 'running') return;
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setConfirmClear(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (progress.phase === 'preparing' || progress.phase === 'running') return;
      if (e.key === 'Escape') {
        setOpen(false);
        setConfirmClear(false);
      }
    }
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, progress.phase]);

  async function run(mode: 'freeze' | 'clear') {
    setError(null);
    setProgress({ phase: 'preparing', mode });
    const list = await listBaselineTargetsAction(projectId, mode);
    if (!list.ok) {
      setError(list.error);
      setProgress({ phase: 'idle' });
      return;
    }
    if (list.targets.length === 0) {
      setProgress({ phase: 'done', mode, done: 0, total: 0 });
      // Auto-close nach kurzer Bestätigung
      setTimeout(() => {
        setOpen(false);
        setConfirmClear(false);
        setProgress({ phase: 'idle' });
      }, 1200);
      return;
    }
    const total = list.targets.length;
    setProgress({ phase: 'running', mode, done: 0, total });
    let firstError: string | null = null;
    for (let i = 0; i < list.targets.length; i++) {
      const t = list.targets[i];
      const res = await updateWorkPackageAction(t.wpId, {
        baselineStart: mode === 'freeze' ? t.startDate : null,
        baselineEnd: mode === 'freeze' ? t.endDate : null,
      });
      if (!res.ok) {
        if (res.sessionExpired) {
          window.location.href = '/api/auth/signout?callbackUrl=/login%3Fexpired%3D1';
          return;
        }
        firstError ??= res.error;
      }
      setProgress({ phase: 'running', mode, done: i + 1, total });
    }
    if (firstError) {
      setError(firstError);
    }
    setProgress({ phase: 'done', mode, done: total, total });
    router.refresh();
    setTimeout(() => {
      setOpen(false);
      setConfirmClear(false);
      setProgress({ phase: 'idle' });
    }, 1500);
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }} className="print-hide">
      <button
        type="button"
        className="btn btn--sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Baseline (Plan-vs-Ist)"
        disabled={isWorking}
      >
        <GitCompareArrows size={12} />
        <span className="btn-narrow-label">Baseline</span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            minWidth: 280,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--r-3)',
            boxShadow: 'var(--shadow-2)',
            padding: 4,
            zIndex: 30,
          }}
        >
          {progress.phase === 'idle' && (
            <>
              <button
                type="button"
                onClick={() => run('freeze')}
                className="export-item"
                style={menuItemStyle()}
              >
                <Snowflake size={13} style={{ color: 'var(--color-ink-3)' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>Baseline einfrieren</div>
                  <div style={{ fontSize: 10, color: 'var(--color-ink-3)' }}>
                    Aktuelle Start-/End-Daten aller Aufgaben als Plan speichern
                  </div>
                </div>
              </button>
              {!confirmClear ? (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="export-item"
                  style={menuItemStyle('var(--color-status-blocked)')}
                >
                  <Trash2 size={13} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>Baseline entfernen</div>
                    <div style={{ fontSize: 10, color: 'var(--color-ink-3)' }}>
                      Plan-Bars von allen Aufgaben löschen
                    </div>
                  </div>
                </button>
              ) : (
                <div
                  style={{
                    padding: '8px 10px',
                    background: 'var(--color-surface-2)',
                    borderRadius: 'var(--r-2)',
                    fontSize: 11,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ color: 'var(--color-ink-2)' }}>
                    Baseline von allen Aufgaben entfernen?
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => setConfirmClear(false)}
                    >
                      Abbrechen
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => run('clear')}
                      style={{ color: 'var(--color-status-blocked)' }}
                    >
                      Entfernen
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {(progress.phase === 'preparing' ||
            progress.phase === 'running' ||
            progress.phase === 'done') && (
            <ProgressView progress={progress} />
          )}

          {error && (
            <div
              style={{
                padding: '6px 10px',
                fontSize: 10,
                color: 'var(--color-status-blocked)',
              }}
            >
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProgressView({ progress }: { progress: Progress }) {
  if (progress.phase === 'idle') return null;
  const label =
    progress.phase === 'preparing'
      ? progress.mode === 'freeze'
        ? 'Suche Aufgaben zum Einfrieren…'
        : 'Suche Aufgaben mit Baseline…'
      : progress.phase === 'done'
        ? progress.total === 0
          ? progress.mode === 'freeze'
            ? 'Alle Baselines bereits aktuell.'
            : 'Keine Baseline-Daten zu entfernen.'
          : progress.mode === 'freeze'
            ? `Eingefroren: ${progress.done}/${progress.total}`
            : `Entfernt: ${progress.done}/${progress.total}`
        : progress.mode === 'freeze'
          ? `Friere ein… ${progress.done}/${progress.total}`
          : `Entferne… ${progress.done}/${progress.total}`;
  const pct =
    progress.phase === 'running' || progress.phase === 'done'
      ? progress.total > 0
        ? (progress.done / progress.total) * 100
        : 100
      : null;
  return (
    <div
      style={{
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: 'var(--color-ink)',
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      {pct !== null && (
        <div
          style={{
            position: 'relative',
            height: 4,
            background: 'var(--color-surface-3)',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              right: `${100 - pct}%`,
              background:
                progress.phase === 'done'
                  ? 'var(--color-status-done)'
                  : 'var(--color-accent)',
              transition: 'right .15s',
            }}
          />
        </div>
      )}
      {pct === null && (
        // Indeterminate-Bar für preparing-Phase
        <div
          style={{
            height: 4,
            background: 'var(--color-surface-3)',
            borderRadius: 2,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div className="baseline-indeterminate" />
        </div>
      )}
    </div>
  );
}

function menuItemStyle(color?: string): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 10px',
    borderRadius: 'var(--r-2)',
    border: 'none',
    color: color ?? 'var(--color-ink)',
    fontSize: 12,
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left',
  };
}
