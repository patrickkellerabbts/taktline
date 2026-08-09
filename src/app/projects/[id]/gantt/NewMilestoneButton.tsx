'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Diamond, X } from 'lucide-react';
import { createMilestoneAction } from './milestone-actions';

type Props = {
  projectId: string;
};

export function NewMilestoneButton({ projectId }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn--sm"
        onClick={() => setOpen(true)}
        title="Neuer Meilenstein"
      >
        <Diamond size={12} />
        <span className="btn-narrow-label">Meilenstein</span>
      </button>
      {open && <NewMilestoneDialog projectId={projectId} onClose={() => setOpen(false)} />}
    </>
  );
}

function NewMilestoneDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError('Titel darf nicht leer sein');
      return;
    }
    startTransition(async () => {
      const result = await createMilestoneAction(projectId, {
        title: title.trim(),
        description: description.trim() || undefined,
        dueDate: dueDate || null,
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
      role="dialog"
      aria-modal="true"
      aria-label="Neuer Meilenstein"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.4)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: 'min(480px, 92vw)',
          background: 'var(--color-surface)',
          borderRadius: 'var(--r-3)',
          boxShadow: 'var(--shadow-2)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '10px 14px',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-surface-2)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Diamond size={13} style={{ color: 'var(--color-status-milestone)' }} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>Neuer Meilenstein</span>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--color-ink-3)',
              padding: 4,
            }}
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Titel">
            <input
              ref={inputRef}
              type="text"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={pending}
              style={{ width: '100%', fontSize: 14, fontWeight: 600 }}
            />
          </Field>
          <Field label="Beschreibung">
            <textarea
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={pending}
              rows={4}
              style={{ width: '100%', fontSize: 12, fontFamily: 'inherit', resize: 'vertical' }}
            />
          </Field>
          <Field label="Fälligkeit">
            <input
              type="date"
              className="input"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={pending}
              style={{ width: '100%', fontSize: 12 }}
            />
          </Field>
          {error && (
            <div
              role="alert"
              style={{
                padding: 10,
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 'var(--r-3)',
                fontSize: 12,
                color: 'var(--color-status-blocked)',
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          style={{
            padding: 12,
            borderTop: '1px solid var(--color-border)',
            background: 'var(--color-surface-2)',
            display: 'flex',
            gap: 6,
            justifyContent: 'flex-end',
          }}
        >
          <button type="button" className="btn btn--sm" onClick={onClose} disabled={pending}>
            Abbrechen
          </button>
          <button
            type="submit"
            className="btn btn--primary btn--sm"
            disabled={pending || !title.trim()}
          >
            {pending ? '…' : 'Anlegen'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--color-ink-3)',
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
