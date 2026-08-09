'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, FileText, Printer } from 'lucide-react';

type Props = {
  projectId: string;
};

// Trigger für den Druck-Export. Das eigentliche Rendering läuft in
// `GanttView` (eigenständige GanttPrintView-Komponente, die @media print
// sichtbar wird). Wir dispatchen nur ein CustomEvent — GanttView lauscht.
function requestGanttPrint() {
  window.dispatchEvent(new CustomEvent('taktline:gantt-print'));
}

export function ExportButton({ projectId }: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function onPrint() {
    setOpen(false);
    // setTimeout damit das Dropdown unmounten kann bevor der Browser-Dialog
    // erscheint — sonst sind Geschwister-Elemente noch im print-Snapshot.
    setTimeout(requestGanttPrint, 50);
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }} className="print-hide">
      <button
        type="button"
        className="btn btn--sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Export"
      >
        <Download size={12} />
        <span className="btn-narrow-label">Export</span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            minWidth: 220,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--r-3)',
            boxShadow: 'var(--shadow-2)',
            padding: 4,
            zIndex: 30,
          }}
        >
          <a
            href={`/api/projects/${projectId}/export.csv`}
            onClick={() => setOpen(false)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 'var(--r-2)',
              textDecoration: 'none',
              color: 'var(--color-ink)',
              fontSize: 12,
              cursor: 'pointer',
              transition: 'background .12s',
            }}
            className="export-item"
          >
            <FileText size={13} style={{ color: 'var(--color-ink-3)' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>Als CSV herunterladen</div>
              <div style={{ fontSize: 10, color: 'var(--color-ink-3)' }}>
                Daten-Export für Excel, Reports
              </div>
            </div>
          </a>
          <button
            type="button"
            onClick={onPrint}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 'var(--r-2)',
              border: 'none',
              color: 'var(--color-ink)',
              fontSize: 12,
              cursor: 'pointer',
              width: '100%',
              textAlign: 'left',
              transition: 'background .12s',
            }}
            className="export-item"
          >
            <Printer size={13} style={{ color: 'var(--color-ink-3)' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>Drucken / Als PDF</div>
              <div style={{ fontSize: 10, color: 'var(--color-ink-3)' }}>
                Im Dialog A3 + Querformat auswählen
              </div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
