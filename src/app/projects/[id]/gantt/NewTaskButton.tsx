'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import { createWorkPackageAction } from './actions';

type Props = {
  projectId: string;
  availableParents: Array<{ iid: number; text: string }>;
};

function toInputDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function NewTaskButton({ projectId, availableParents }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn--primary btn--sm"
        onClick={() => setOpen(true)}
        title="Neue Aufgabe"
      >
        <Plus size={12} />
        <span className="btn-narrow-label">Neue Aufgabe</span>
      </button>
      {open && (
        <NewTaskDialog
          projectId={projectId}
          availableParents={availableParents}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function NewTaskDialog({
  projectId,
  availableParents,
  onClose,
}: {
  projectId: string;
  availableParents: Array<{ iid: number; text: string }>;
  onClose: () => void;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sevenDays = new Date(today);
  sevenDays.setDate(sevenDays.getDate() + 7);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState(toInputDate(today));
  const [endDate, setEndDate] = useState(toInputDate(sevenDays));
  const [parentIid, setParentIid] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // ESC schließt Dialog
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function submit() {
    if (!title.trim() || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await createWorkPackageAction(projectId, {
        title: title.trim(),
        description: description.trim() || undefined,
        startDate,
        endDate,
        parentIid: parentIid ? Number(parentIid) : null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(28, 27, 24, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{
          width: 480,
          maxWidth: '90vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-2)',
        }}
      >
        <div className="card__hd">
          <span style={{ fontWeight: 600, fontSize: 14 }}>Neue Aufgabe anlegen</span>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            onClick={onClose}
            disabled={pending}
            title="Schließen"
          >
            <X size={12} />
          </button>
        </div>

        <div
          className="card__bd"
          style={{ display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto' }}
        >
          <div>
            <label className="label">Titel*</label>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="z.B. Login-Flow überarbeiten"
              autoFocus
              disabled={pending}
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label className="label">Beschreibung</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={pending}
              placeholder="Optional — wird unverändert nach GitLab geschrieben."
              rows={3}
              style={{
                width: '100%',
                padding: '6px 8px',
                border: '1px solid var(--color-border-2)',
                borderRadius: 'var(--r-2)',
                background: 'var(--color-surface)',
                fontFamily: 'var(--font-sans)',
                fontSize: 12,
                resize: 'vertical',
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="label">Start</label>
              <input
                type="date"
                className="input mono"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={pending}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label className="label">Ende</label>
              <input
                type="date"
                className="input mono"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={pending}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          <div>
            <label className="label">Übergeordnet (optional)</label>
            <select
              className="input"
              value={parentIid}
              onChange={(e) => setParentIid(e.target.value)}
              disabled={pending}
              style={{ width: '100%' }}
            >
              <option value="">— Kein Parent —</option>
              {availableParents.map((p) => (
                <option key={p.iid} value={p.iid}>
                  #{p.iid} {p.text}
                </option>
              ))}
            </select>
          </div>

          <div
            style={{
              fontSize: 11,
              color: 'var(--color-ink-3)',
              padding: 10,
              background: 'var(--color-surface-3)',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              lineHeight: 1.5,
            }}
          >
            Erstellt ein <strong>GitLab Issue</strong> in diesem Projekt mit dem Titel und der
            Beschreibung. Start-Datum und Parent-Bezug werden als
            <code style={{ fontSize: 10, marginLeft: 3 }}>gantt-meta</code>-Block in die Description
            geschrieben.
          </div>

          {error && (
            <div
              style={{
                padding: 10,
                background: '#fbe9e7',
                border: '1px solid #f4c7c0',
                borderRadius: 4,
                color: '#b42318',
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          className="card__ft"
          style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}
        >
          <button type="button" className="btn btn--sm" onClick={onClose} disabled={pending}>
            Abbrechen
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={submit}
            disabled={!title.trim() || pending}
          >
            {pending ? 'Erstelle…' : 'Erstellen'}
          </button>
        </div>
      </div>
    </div>
  );
}
