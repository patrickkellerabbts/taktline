'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Pencil, Plus, X } from 'lucide-react';
import { moveBoardCardAction } from '@/app/projects/[id]/board/actions';
import { createTaskAction, updateTaskAction } from '@/app/projects/[id]/board/task-actions';
import { formatHoursFromSeconds, taskProgress, TASK_MAX_HOURS } from '@/lib/agile/tasks';
import type { BoardCard, BoardPerson, BoardTask } from './BoardView';

// Sprint Planning, Teil 2: Wie setzen wir die Story um? Das Team zerlegt sie in
// Tasks von höchstens einem Tag (Scrum Guide) und schätzt sie in Stunden.

type Props = {
  projectId: string;
  card: BoardCard;
  people: BoardPerson[];
};

function parseHours(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim().replace(',', '.');
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : 'invalid';
}

export function StoryTasks({ projectId, card, people }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const progress = taskProgress(card.tasks);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? 'Das hat nicht geklappt');
      else {
        onDone?.();
        router.refresh();
      }
    });
  }

  function toggleDone(task: BoardTask) {
    const target = task.column === 'done' ? 'todo' : 'done';
    run(() => moveBoardCardAction(projectId, task.id, target, [task.id]));
  }

  return (
    <section className="story-tasks" aria-label="Tasks">
      <div className="story-tasks__hd">
        <span className="label" style={{ margin: 0 }}>
          Tasks
        </span>
        {progress.total > 0 && (
          <span className="story-tasks__sum mono tabnum">
            {progress.done}/{progress.total} erledigt
            {progress.estimateSeconds > 0 &&
              ` · ${formatHoursFromSeconds(progress.remainingSeconds)} von ${formatHoursFromSeconds(progress.estimateSeconds)} offen`}
          </span>
        )}
      </div>

      {card.tasks.length === 0 && (
        <p className="story-tasks__empty">
          Noch keine Tasks. Zerlegt die Story im Sprint Planning in Schritte von höchstens einem Tag.
        </p>
      )}

      <ul className="story-tasks__list">
        {card.tasks.map((task) =>
          editing === task.id ? (
            <li key={task.id}>
              <TaskForm
                people={people}
                initial={task}
                pending={pending}
                submitLabel="Speichern"
                onCancel={() => setEditing(null)}
                onSubmit={(input) => run(() => updateTaskAction(task.id, input), () => setEditing(null))}
              />
            </li>
          ) : (
            <li key={task.id} className="story-tasks__row" data-done={task.column === 'done' ? '' : undefined}>
              <input
                type="checkbox"
                checked={task.column === 'done'}
                onChange={() => toggleDone(task)}
                disabled={pending}
                aria-label={`#${task.iid} ${task.column === 'done' ? 'wieder öffnen' : 'erledigt'}`}
              />
              <span className="mono story-tasks__iid">#{task.iid}</span>
              <span className="story-tasks__title">{task.title}</span>
              {task.column !== 'done' && task.column !== 'backlog' && task.column !== 'todo' && (
                <span className="chip">{task.column === 'doing' ? 'In Arbeit' : 'Review'}</span>
              )}
              <span className="mono tabnum story-tasks__hours">
                {task.estimateSeconds ? formatHoursFromSeconds(task.estimateSeconds) : '– h'}
              </span>
              <span className="story-tasks__who" title={task.assignees.map((a) => a.name).join(', ') || 'Niemand zugewiesen'}>
                {task.assignees[0]?.name ?? '—'}
              </span>
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--sm"
                onClick={() => setEditing(task.id)}
                aria-label={`#${task.iid} bearbeiten`}
                disabled={pending}
              >
                <Pencil size={12} />
              </button>
            </li>
          ),
        )}
      </ul>

      {editing === 'new' ? (
        <TaskForm
          people={people}
          pending={pending}
          submitLabel="Task anlegen"
          onCancel={() => setEditing(null)}
          onSubmit={(input) => run(() => createTaskAction(card.id, input), () => setEditing(null))}
        />
      ) : (
        <button type="button" className="btn btn--sm story-tasks__add" onClick={() => setEditing('new')} disabled={pending}>
          <Plus size={12} /> Task hinzufügen
        </button>
      )}
      {error && (
        <div role="alert" className="story-dialog__error">
          {error}
        </div>
      )}
    </section>
  );
}

export function TaskForm({
  people,
  initial,
  pending,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  people: BoardPerson[];
  initial?: BoardTask;
  pending: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (input: { title: string; estimateHours: number | null; assigneeId: number | null }) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [hours, setHours] = useState(initial?.estimateSeconds ? String(initial.estimateSeconds / 3600) : '');
  const [assignee, setAssignee] = useState<number | null>(initial?.assignees[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseHours(hours);
  const tooBig = typeof parsed === 'number' && parsed > TASK_MAX_HOURS;

  function submit() {
    if (!title.trim() || pending) return;
    if (parsed === 'invalid') {
      setError('Die Schätzung muss eine Zahl in Stunden sein');
      return;
    }
    setError(null);
    onSubmit({ title, estimateHours: parsed, assigneeId: assignee });
  }

  return (
    <div className="story-tasks__form">
      <input
        className="input"
        placeholder="Was ist zu tun?"
        value={title}
        maxLength={255}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
          // Esc schliesst nur das Formular, nicht den ganzen Dialog.
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
          }
        }}
        autoFocus
        disabled={pending}
        aria-label="Titel des Tasks"
      />
      <input
        className="input mono story-tasks__hours-input"
        placeholder="Std."
        inputMode="decimal"
        value={hours}
        onChange={(e) => setHours(e.target.value)}
        disabled={pending}
        aria-label="Schätzung in Stunden"
      />
      <select
        className="input story-tasks__assignee"
        value={assignee ?? ''}
        onChange={(e) => setAssignee(e.target.value ? Number(e.target.value) : null)}
        disabled={pending}
        aria-label="Zuständig"
      >
        <option value="">Niemand</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button type="button" className="btn btn--primary btn--sm" onClick={submit} disabled={!title.trim() || pending}>
        <Check size={12} /> {submitLabel}
      </button>
      <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={onCancel} aria-label="Abbrechen" disabled={pending}>
        <X size={12} />
      </button>
      {tooBig && (
        <div className="story-tasks__warn">
          Mehr als {TASK_MAX_HOURS} Stunden: Ein Task sollte höchstens einen Tag dauern. Lässt er sich aufteilen?
        </div>
      )}
      {error && <div className="story-tasks__warn">{error}</div>}
    </div>
  );
}
