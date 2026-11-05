'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import type { JournalEntryView } from '@/lib/journal';
import {
  createJournalEntryAction,
  deleteJournalEntryAction,
  updateJournalEntryAction,
} from '@/app/projects/[id]/journal/actions';

type Props = {
  projectId: string;
  entries: JournalEntryView[];
  currentUserId: string;
};

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

function formatHours(hours: number): string {
  return `${Number.isInteger(hours * 10) ? hours.toFixed(1) : hours.toFixed(2)} h`;
}

function authorName(author: JournalEntryView['author']): string {
  return author.name ?? author.username ?? 'Unbekannt';
}

function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function JournalView({ projectId, entries, currentUserId }: Props) {
  const router = useRouter();
  const [person, setPerson] = useState<string | null>(null);
  const [editing, setEditing] = useState<JournalEntryView | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const people = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; hours: number; open: number }>();
    for (const entry of entries) {
      const row = byId.get(entry.author.id) ?? {
        id: entry.author.id,
        name: authorName(entry.author),
        hours: 0,
        open: 0,
      };
      row.hours += entry.hours;
      if (!entry.complete) row.open += 1;
      byId.set(entry.author.id, row);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [entries]);

  const visible = person ? entries.filter((e) => e.author.id === person) : entries;

  function remove(entry: JournalEntryView) {
    if (!window.confirm(`Eintrag vom ${formatDate(entry.date)} löschen? Das lässt sich nicht rückgängig machen.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteJournalEntryAction(entry.id);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="journal">
      <div className="board__toolbar">
        <button type="button" className="btn btn--primary btn--sm" onClick={() => setEditing('new')}>
          <Plus size={12} />
          Neuer Eintrag
        </button>
        {error && (
          <span role="alert" className="board__error">
            {error}
          </span>
        )}
      </div>

      {people.length > 0 && (
        <div className="journal__people" role="group" aria-label="Nach Person filtern">
          <button
            type="button"
            className={`btn btn--sm${person === null ? ' btn--primary' : ''}`}
            aria-pressed={person === null}
            onClick={() => setPerson(null)}
          >
            Alle
          </button>
          {people.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`btn btn--sm journal__person${person === p.id ? ' btn--primary' : ''}`}
              aria-pressed={person === p.id}
              onClick={() => setPerson(p.id)}
            >
              {p.name}
              <span className="mono tabnum">{formatHours(p.hours)}</span>
              {p.open > 0 && <span>· {p.open} unvollständig</span>}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="journal__empty">
          Noch keine Einträge. Halte fest, was heute technisch entstanden ist und was organisatorisch
          entschieden, abgesprochen oder blockiert war.
        </div>
      ) : (
        <div className="journal__list">
          {visible.map((entry) => (
            <JournalCard
              key={entry.id}
              entry={entry}
              own={entry.author.id === currentUserId}
              onEdit={() => setEditing(entry)}
              onDelete={() => remove(entry)}
            />
          ))}
        </div>
      )}

      {editing && (
        <JournalDialog
          projectId={projectId}
          entry={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function JournalCard({
  entry,
  own,
  onEdit,
  onDelete,
}: {
  entry: JournalEntryView;
  own: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="card">
      <div className="card__bd">
        <div className="journal__entry-hd">
          <span className="mono tabnum" style={{ fontWeight: 600, fontSize: 12 }}>{formatDate(entry.date)}</span>
          <span className="journal__meta">{authorName(entry.author)}</span>
          <span className="journal__meta mono tabnum">{formatHours(entry.hours)}</span>
          {!entry.complete && <span className="chip">unvollständig</span>}
          <div style={{ flex: 1 }} />
          {own && (
            <>
              <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={onEdit} title="Bearbeiten" aria-label="Eintrag bearbeiten">
                <Pencil size={12} />
              </button>
              <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={onDelete} title="Löschen" aria-label="Eintrag löschen">
                <Trash2 size={12} />
              </button>
            </>
          )}
        </div>
        <div className="journal__entry-title">{entry.title}</div>
        <Section label="Technisch" text={entry.technical} />
        <Section label="Organisatorisch" text={entry.organizational} />
        {entry.nextSteps && <Section label="Nächste Schritte" text={entry.nextSteps} />}
      </div>
    </article>
  );
}

function Section({ label, text }: { label: string; text: string | null }) {
  return (
    <div className="journal__section">
      <span className="journal__section-label">{label}</span>
      {text ? (
        <span className="journal__section-text">{text}</span>
      ) : (
        <span className="journal__meta">Noch nicht erfasst</span>
      )}
    </div>
  );
}

function JournalDialog({
  projectId,
  entry,
  onClose,
  onSaved,
}: {
  projectId: string;
  entry: JournalEntryView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(() => entry?.date ?? localToday());
  const [hours, setHours] = useState(entry ? String(entry.hours) : '');
  const [title, setTitle] = useState(entry?.title ?? '');
  const [technical, setTechnical] = useState(entry?.technical ?? '');
  const [organizational, setOrganizational] = useState(entry?.organizational ?? '');
  const [nextSteps, setNextSteps] = useState(entry?.nextSteps ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty =
    date !== (entry?.date ?? date) ||
    hours !== (entry ? String(entry.hours) : '') ||
    title !== (entry?.title ?? '') ||
    technical !== (entry?.technical ?? '') ||
    organizational !== (entry?.organizational ?? '') ||
    nextSteps !== (entry?.nextSteps ?? '');

  // Backdrop und Esc schliessen nicht still, wenn sonst Text verloren ginge.
  function requestClose() {
    if (pending) return;
    if (dirty && !window.confirm('Änderungen verwerfen?')) return;
    onClose();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') requestClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function submit() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const input = {
        date,
        // Komma erlauben, weil die deutsche Tastatur es nahelegt.
        hours: Number(hours.replace(',', '.')),
        title,
        technical,
        organizational,
        nextSteps,
      };
      const result = entry
        ? await updateJournalEntryAction(entry.id, input)
        : await createJournalEntryAction(projectId, input);
      if (!result.ok) setError(result.error);
      else onSaved();
    });
  }

  const heading = entry ? 'Eintrag bearbeiten' : 'Neuer Eintrag';

  return (
    <div className="story-dialog__backdrop" onClick={requestClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        className="card story-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card__hd">
          <span style={{ fontWeight: 600, fontSize: 14 }}>{heading}</span>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={requestClose} title="Schliessen" aria-label="Schliessen">
            <X size={12} />
          </button>
        </div>
        <div className="card__bd story-dialog__body">
          <div className="story-dialog__row">
            <div className="story-dialog__field">
              <label className="label" htmlFor="journal-date">Datum*</label>
              <input id="journal-date" type="date" className="input mono" value={date} onChange={(e) => setDate(e.target.value)} disabled={pending} />
            </div>
            <div className="story-dialog__field">
              <label className="label" htmlFor="journal-hours">Dauer in Stunden*</label>
              <input id="journal-hours" className="input mono" inputMode="decimal" placeholder="2.5" value={hours} onChange={(e) => setHours(e.target.value)} disabled={pending} />
            </div>
          </div>
          <div className="story-dialog__field">
            <label className="label" htmlFor="journal-title">Kurztitel*</label>
            <input id="journal-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} disabled={pending} autoFocus={!entry} />
          </div>
          <div className="story-dialog__field">
            <label className="label" htmlFor="journal-technical">Technisch</label>
            <textarea id="journal-technical" className="story-dialog__textarea" value={technical} onChange={(e) => setTechnical(e.target.value)} rows={4} maxLength={10000} disabled={pending} placeholder="Was ist entstanden, was hat funktioniert, was nicht?" />
          </div>
          <div className="story-dialog__field">
            <label className="label" htmlFor="journal-organizational">Organisatorisch</label>
            <textarea id="journal-organizational" className="story-dialog__textarea" value={organizational} onChange={(e) => setOrganizational(e.target.value)} rows={3} maxLength={10000} disabled={pending} placeholder="Absprachen, Entscheide, Blockaden, Übergaben" />
          </div>
          <div className="story-dialog__field">
            <label className="label" htmlFor="journal-next">Nächste Schritte</label>
            <textarea id="journal-next" className="story-dialog__textarea" value={nextSteps} onChange={(e) => setNextSteps(e.target.value)} rows={2} maxLength={10000} disabled={pending} />
          </div>
          {error && <div role="alert" className="story-dialog__error">{error}</div>}
        </div>
        <div className="card__ft" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn--sm" onClick={requestClose} disabled={pending}>Abbrechen</button>
          <button type="button" className="btn btn--primary btn--sm" onClick={submit} disabled={!title.trim() || !hours.trim() || pending}>
            {pending ? 'Speichere…' : entry ? 'Speichern' : 'Erstellen'}
          </button>
        </div>
      </div>
    </div>
  );
}
