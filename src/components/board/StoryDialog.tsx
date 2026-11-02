'use client';

import { useEffect, useState, useTransition } from 'react';
import { X } from 'lucide-react';
import {
  createStoryAction,
  updateStoryAction,
  type StoryInput,
} from '@/app/projects/[id]/board/actions';
import { BOARD_COLUMNS, type BoardColumnId } from '@/lib/agile/board';
import type { SprintInfo } from '@/lib/agile/sprints';
import type { BoardCard, BoardLabel, BoardPerson } from './BoardView';

type Props = {
  projectId: string;
  /** Gesetzt = bearbeiten, sonst neue Story in `column`. */
  card?: BoardCard;
  column?: BoardColumnId;
  people: BoardPerson[];
  projectLabels: BoardLabel[];
  sprints: SprintInfo[];
  /** Vorauswahl für neue Stories: der Sprint, den das Board gerade zeigt. */
  defaultSprintNumber: number | null;
  onClose: () => void;
  onSaved: () => void;
};

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function StoryDialog({
  projectId,
  card,
  column,
  people,
  projectLabels,
  sprints,
  defaultSprintNumber,
  onClose,
  onSaved,
}: Props) {
  const story = card?.story;
  const [title, setTitle] = useState(card?.title ?? '');
  const [role, setRole] = useState(story?.role ?? '');
  const [goal, setGoal] = useState(story?.goal ?? '');
  const [benefit, setBenefit] = useState(story?.benefit ?? '');
  const [criteria, setCriteria] = useState((story?.criteria ?? []).map((c) => c.text).join('\n'));
  const [notes, setNotes] = useState(story?.notes ?? '');
  const [points, setPoints] = useState(card?.storyPoints?.toString() ?? '');
  const [assigneeIds, setAssigneeIds] = useState((card?.assignees ?? []).map((a) => a.id));
  const [labels, setLabels] = useState((card?.labels ?? []).map((l) => l.name));
  const [sprintNumber, setSprintNumber] = useState<number | null>(
    card ? card.sprintNumber : defaultSprintNumber,
  );
  const currentSprint = sprints.find((s) => s.number === card?.sprintNumber);
  const sprintLocked = currentSprint?.state === 'closed';
  const sprintOptions = sprints.filter((s) => s.state !== 'closed' || s.number === card?.sprintNumber);
  const [targetColumn, setTargetColumn] = useState<BoardColumnId>(column ?? 'backlog');
  const [startDate, setStartDate] = useState(card?.startDate ?? '');
  const [endDate, setEndDate] = useState(card?.endDate ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Labels, die am Issue hängen, aber (noch) nicht im Projekt-Cache stehen,
  // müssen wählbar bleiben — sonst liesse sich ihre Entfernung nicht rückgängig machen.
  const labelOptions = [
    ...projectLabels,
    ...(card?.labels ?? []).filter((l) => !projectLabels.some((p) => p.name === l.name)),
  ];

  function submit() {
    if (!title.trim() || pending) return;
    const parsedPoints = points.trim() === '' ? null : Number(points);
    if (parsedPoints !== null && !Number.isInteger(parsedPoints)) {
      setError('Story Points müssen eine ganze Zahl sein');
      return;
    }
    const input: StoryInput = {
      title,
      role,
      goal,
      benefit,
      criteria: criteria.split('\n'),
      notes,
      storyPoints: parsedPoints,
      sprintNumber,
      assigneeIds,
      labels,
      startDate: startDate || null,
      endDate: endDate || null,
    };
    setError(null);
    startTransition(async () => {
      const result = card
        ? await updateStoryAction(card.id, input)
        : await createStoryAction(projectId, input, targetColumn);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved();
    });
  }

  return (
    <div className="story-dialog__backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={card ? `Story #${card.iid} bearbeiten` : 'Neue User Story'}
        className="card story-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card__hd">
          <span style={{ fontWeight: 600, fontSize: 14 }}>
            {card ? `Story #${card.iid} bearbeiten` : 'Neue User Story'}
          </span>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            onClick={onClose}
            disabled={pending}
            title="Schliessen"
            aria-label="Schliessen"
          >
            <X size={12} />
          </button>
        </div>

        <div className="card__bd story-dialog__body">
          <Field label="Titel*" htmlFor="story-title">
            <input
              id="story-title"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="z.B. Beiträge vorausplanen"
              autoFocus
              disabled={pending}
            />
          </Field>

          <Field label="Als …" htmlFor="story-role">
            <input
              id="story-role"
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Redakteurin"
              disabled={pending}
            />
          </Field>
          <Field label="möchte ich …" htmlFor="story-goal">
            <input
              id="story-goal"
              className="input"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Beiträge im Voraus terminieren"
              disabled={pending}
            />
          </Field>
          <Field label="damit …" htmlFor="story-benefit">
            <input
              id="story-benefit"
              className="input"
              value={benefit}
              onChange={(e) => setBenefit(e.target.value)}
              placeholder="sie auch im Urlaub pünktlich erscheinen"
              disabled={pending}
            />
          </Field>

          <Field label="Akzeptanzkriterien (eines pro Zeile)" htmlFor="story-criteria">
            <textarea
              id="story-criteria"
              className="story-dialog__textarea"
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
              rows={4}
              disabled={pending}
            />
          </Field>

          <Field label="Notizen" htmlFor="story-notes">
            <textarea
              id="story-notes"
              className="story-dialog__textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              disabled={pending}
            />
          </Field>

          <div className="story-dialog__row">
            <Field label="Story Points" htmlFor="story-points">
              <input
                id="story-points"
                type="number"
                min={0}
                step={1}
                className="input mono"
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                disabled={pending}
              />
            </Field>
            {sprints.length > 0 && (
              <Field label="Sprint" htmlFor="story-sprint">
                <select
                  id="story-sprint"
                  className="input"
                  value={sprintNumber ?? ''}
                  onChange={(e) => setSprintNumber(e.target.value ? Number(e.target.value) : null)}
                  disabled={pending || sprintLocked}
                >
                  <option value="">Kein Sprint</option>
                  {sprintOptions.map((s) => (
                    <option key={s.id} value={s.number}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {!card && (
              <Field label="Spalte" htmlFor="story-column">
                <select
                  id="story-column"
                  className="input"
                  value={targetColumn}
                  onChange={(e) => setTargetColumn(e.target.value as BoardColumnId)}
                  disabled={pending}
                >
                  {BOARD_COLUMNS.filter((c) => c.id !== 'done').map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>

          <div className="story-dialog__row">
            <Field label="Start (optional)" htmlFor="story-start">
              <input
                id="story-start"
                type="date"
                className="input mono"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={pending}
              />
            </Field>
            <Field label="Ende (optional)" htmlFor="story-end">
              <input
                id="story-end"
                type="date"
                className="input mono"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={pending}
              />
            </Field>
          </div>
          <p className="story-dialog__hint">
            Ohne Datum erscheint die Story nur auf dem Board, mit Datum auch im Gantt.
          </p>

          {people.length > 0 && (
            <div>
              <span className="label">Zuweisung</span>
              <div className="story-dialog__chips">
                {people.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="story-dialog__chip"
                    aria-pressed={assigneeIds.includes(p.id)}
                    onClick={() => setAssigneeIds((list) => toggle(list, p.id))}
                    disabled={pending}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {labelOptions.length > 0 && (
            <div>
              <span className="label">Labels</span>
              <div className="story-dialog__chips">
                {labelOptions.map((l) => (
                  <button
                    key={l.name}
                    type="button"
                    className="story-dialog__chip"
                    aria-pressed={labels.includes(l.name)}
                    onClick={() => setLabels((list) => toggle(list, l.name))}
                    disabled={pending}
                  >
                    <span
                      className="board__label-dot"
                      style={{ background: l.color ?? 'var(--color-ink-4)' }}
                    />
                    {l.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div role="alert" className="story-dialog__error">
              {error}
            </div>
          )}
        </div>

        <div className="card__ft" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn--sm" onClick={onClose} disabled={pending}>
            Abbrechen
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={submit}
            disabled={!title.trim() || pending}
          >
            {pending ? 'Speichere…' : card ? 'Speichern' : 'Erstellen'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="story-dialog__field">
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}
