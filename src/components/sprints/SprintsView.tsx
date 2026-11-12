'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { ChevronRight, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import {
  assignToSprintAction,
  closeSprintAction,
  createSprintAction,
  deleteSprintAction,
  startSprintAction,
  updateSprintAction,
} from '@/app/projects/[id]/sprints/actions';
import { AssigneeAvatars } from '@/components/gantt/AssigneeAvatars';
import { SprintBurndown } from './SprintBurndown';
import { BOARD_COLUMNS } from '@/lib/agile/board';
import type { SprintInfo } from '@/lib/agile/sprints';
import type { BoardCard } from '@/components/board/BoardView';

type Props = {
  projectId: string;
  cards: BoardCard[];
  sprints: SprintInfo[];
  readOnly?: boolean;
  /** Durchschnittliche Velocity; markiert Sprints, die deutlich mehr planen. */
  velocityAverage?: number | null;
  /** Kopfbereich über den Sprints (Product Goal, DoD, Velocity). */
  header?: React.ReactNode;
};

const BACKLOG_DROP = 'backlog';
const SPRINT_LENGTH_DAYS = 14;

function dropIdFor(number: number): string {
  return `sprint:${number}`;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** " · 9/14 Tasks", leer ohne Tasks. Zeigt Fortschritt, bevor Stories fertig sind. */
function tasksLabel(cards: BoardCard[]): string {
  const tasks = cards.flatMap((c) => c.tasks);
  if (tasks.length === 0) return '';
  return ` · ${tasks.filter((t) => t.column === 'done').length}/${tasks.length} Tasks`;
}

function pointsOf(cards: BoardCard[]): number {
  return cards.reduce((sum, c) => sum + (c.storyPoints ?? 0), 0);
}

export function SprintsView({ projectId, cards: serverCards, sprints, readOnly = false, velocityAverage = null, header }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [cards, setCards] = useState(serverCards);
  const [syncedCards, setSyncedCards] = useState(serverCards);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SprintInfo | 'new' | null>(null);
  const [closing, setClosing] = useState<SprintInfo | null>(null);

  if (serverCards !== syncedCards) {
    setSyncedCards(serverCards);
    setCards(serverCards);
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const active = sprints.find((s) => s.state === 'active') ?? null;
  const planned = sprints.filter((s) => s.state === 'planned');
  const closed = sprints.filter((s) => s.state === 'closed').reverse();
  // Erledigtes ohne Sprint gehört nicht mehr zur Planung.
  const backlog = cards.filter((c) => c.sprintNumber === null && c.column !== 'done');
  const activeCard = cards.find((c) => c.id === activeId) ?? null;

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    if (!e.over) return;
    const cardId = String(e.active.id);
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    const overId = String(e.over.id);
    const target = overId === BACKLOG_DROP ? null : Number(overId.slice('sprint:'.length));
    if (target === card.sprintNumber) return;

    const previous = cards;
    setCards(cards.map((c) => (c.id === cardId ? { ...c, sprintNumber: target } : c)));
    setError(null);
    startTransition(async () => {
      const result = await assignToSprintAction(projectId, cardId, target);
      if (!result.ok) {
        setCards(previous);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const sprintBody = (sprint: SprintInfo) => {
    const sprintCards = cards.filter((c) => c.sprintNumber === sprint.number);
    return (
      <SprintSection
        key={sprint.id}
        sprint={sprint}
        cards={sprintCards}
        projectId={projectId}
        readOnly={readOnly}
        canStart={!active}
        velocityAverage={velocityAverage}
        onEdit={() => setEditing(sprint)}
        onStart={() => run(() => startSprintAction(sprint.id))}
        onClose={() => setClosing(sprint)}
        onDelete={() => {
          if (window.confirm(`„${sprint.name}“ löschen?`)) run(() => deleteSprintAction(sprint.id));
        }}
      />
    );
  };

  return (
    <div className="sprints">
      {header}
      <div className="board__toolbar">
        {!readOnly && (
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setEditing('new')}>
            <Plus size={12} />
            Neuer Sprint
          </button>
        )}
        {!readOnly && (
          <span className="share__hint">Aufgaben per Drag-and-drop einem Sprint zuordnen.</span>
        )}
        {error && (
          <span role="alert" className="board__error">
            {error}
          </span>
        )}
      </div>

      <DndContext
        id="sprints-dnd"
        sensors={sensors}
        onDragStart={(e) => setActiveId(String(e.active.id))}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={onDragEnd}
      >
        <div className="sprints__grid">
          <div className="sprints__col">
            {active && sprintBody(active)}
            {planned.map(sprintBody)}
            {!active && planned.length === 0 && (
              <p className="sprints__empty">
                {readOnly ? 'Noch keine Sprints geplant.' : 'Noch keine Sprints. Lege den ersten an, um Aufgaben einzuplanen.'}
              </p>
            )}
            {closed.length > 0 && (
              <details className="sprints__closed">
                <summary>
                  <ChevronRight size={12} />
                  Abgeschlossene Sprints ({closed.length})
                </summary>
                {closed.map(sprintBody)}
              </details>
            )}
          </div>

          <BacklogSection
            cards={backlog}
            projectId={projectId}
            readOnly={readOnly}
          />
        </div>
        <DragOverlay dropAnimation={null}>
          {activeCard && (
            <div className="sprint-row" data-overlay="">
              <SprintRowBody card={activeCard} projectId={projectId} readOnly />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {editing && (
        <SprintDialog
          projectId={projectId}
          sprint={editing === 'new' ? null : editing}
          suggestedNumber={(sprints.at(-1)?.number ?? 0) + 1}
          suggestedStart={sprints.at(-1) ? addDaysIso(sprints.at(-1)!.endDate, 1) : null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {closing && (
        <CloseSprintDialog
          sprint={closing}
          open={cards.filter((c) => c.sprintNumber === closing.number && c.column !== 'done')}
          done={cards.filter((c) => c.sprintNumber === closing.number && c.column === 'done')}
          planned={planned}
          onCancel={() => setClosing(null)}
          onClosed={() => {
            setClosing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function SprintSection({
  sprint,
  cards,
  projectId,
  readOnly,
  canStart,
  velocityAverage,
  onEdit,
  onStart,
  onClose,
  onDelete,
}: {
  sprint: SprintInfo;
  cards: BoardCard[];
  projectId: string;
  readOnly: boolean;
  canStart: boolean;
  velocityAverage: number | null;
  onEdit: () => void;
  onStart: () => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const isClosed = sprint.state === 'closed';
  const { isOver, setNodeRef } = useDroppable({
    id: dropIdFor(sprint.number),
    disabled: readOnly || isClosed,
  });
  const done = cards.filter((c) => c.column === 'done');
  return (
    <section
      ref={setNodeRef}
      className="sprint"
      data-over={isOver ? '' : undefined}
      data-state={sprint.state}
      aria-label={sprint.name}
    >
      <header className="sprint__hd">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="sprint__title">
            <span>{sprint.name}</span>
            {sprint.state === 'active' && <span className="chip chip--accent">Aktiv</span>}
            {isClosed && <span className="chip chip--done">Abgeschlossen</span>}
          </div>
          <div className="sprint__meta">
            <span className="mono">
              {formatDate(sprint.startDate)} – {formatDate(sprint.endDate)}
            </span>
            <span className="mono tabnum">
              {isClosed
                ? `${sprint.completedCount ?? 0} erledigt · ${sprint.completedPoints ?? 0} SP`
                : `${done.length}/${cards.length} erledigt${tasksLabel(cards)} · ${pointsOf(cards)} SP`}
            </span>
            {!isClosed && velocityAverage !== null && pointsOf(cards) > velocityAverage * 1.2 && (
              <span
                className="chip chip--warn"
                title="Mehr als 20 % über dem Durchschnitt der letzten Sprints. Das Team schafft vermutlich nicht alles."
              >
                über Velocity (Ø {Math.round(velocityAverage)} SP)
              </span>
            )}
          </div>
          {sprint.goal && <p className="sprint__goal">{sprint.goal}</p>}
        </div>
        {!readOnly && sprint.state !== 'planned' && (
          <Link className="btn btn--sm sprint__retro-link" href={`/projects/${projectId}/sprints/${sprint.number}`}>
            Review & Retro
          </Link>
        )}
        {!readOnly && !isClosed && (
          <div className="sprint__actions">
            <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={onEdit} title="Bearbeiten" aria-label={`${sprint.name} bearbeiten`}>
              <Pencil size={12} />
            </button>
            {sprint.state === 'planned' && (
              <>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon btn--sm"
                  onClick={onDelete}
                  disabled={cards.length > 0}
                  title={cards.length > 0 ? 'Nur leere Sprints lassen sich löschen' : 'Löschen'}
                  aria-label={`${sprint.name} löschen`}
                >
                  <Trash2 size={12} />
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={onStart}
                  disabled={!canStart}
                  title={canStart ? undefined : 'Es läuft bereits ein Sprint'}
                >
                  <Play size={12} />
                  Starten
                </button>
              </>
            )}
            {sprint.state === 'active' && (
              <button type="button" className="btn btn--sm" onClick={onClose}>
                Abschliessen
              </button>
            )}
          </div>
        )}
      </header>
      {sprint.state !== 'planned' && cards.length > 0 && <SprintBurndown sprint={sprint} cards={cards} />}
      <div className="sprint__rows">
        {cards.length === 0 && (
          <p className="sprints__empty">{readOnly || isClosed ? 'Keine Aufgaben.' : 'Aufgaben hierher ziehen.'}</p>
        )}
        {cards.map((card) => (
          <SprintRow key={card.id} card={card} projectId={projectId} readOnly={readOnly} locked={isClosed} />
        ))}
      </div>
    </section>
  );
}

function BacklogSection({
  cards,
  projectId,
  readOnly,
}: {
  cards: BoardCard[];
  projectId: string;
  readOnly: boolean;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: BACKLOG_DROP, disabled: readOnly });
  return (
    <section ref={setNodeRef} className="sprint sprints__backlog" data-over={isOver ? '' : undefined} aria-label="Backlog">
      <header className="sprint__hd">
        <div>
          <div className="sprint__title">Backlog</div>
          <div className="sprint__meta">
            <span className="mono tabnum">
              {cards.length} offen · {pointsOf(cards)} SP
            </span>
          </div>
        </div>
      </header>
      <div className="sprint__rows sprint__rows--scroll">
        {cards.length === 0 && <p className="sprints__empty">Alle offenen Aufgaben sind eingeplant.</p>}
        {cards.map((card) => (
          <SprintRow key={card.id} card={card} projectId={projectId} readOnly={readOnly} />
        ))}
      </div>
    </section>
  );
}

function SprintRow({
  card,
  projectId,
  readOnly,
  locked = false,
}: {
  card: BoardCard;
  projectId: string;
  readOnly: boolean;
  locked?: boolean;
}) {
  const fixed = readOnly || locked;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id, disabled: fixed });
  return (
    <div
      ref={setNodeRef}
      {...(fixed ? {} : { ...listeners, ...attributes })}
      data-draggable={fixed ? undefined : ''}
      className="sprint-row"
      style={{ opacity: isDragging ? 0.35 : 1 }}
    >
      <SprintRowBody card={card} projectId={projectId} readOnly={readOnly} />
    </div>
  );
}

function SprintRowBody({
  card,
  projectId,
  readOnly,
}: {
  card: BoardCard;
  projectId: string;
  readOnly: boolean;
}) {
  const column = BOARD_COLUMNS.find((c) => c.id === card.column)?.title;
  return (
    <>
      <span className="mono tabnum sprint-row__iid">#{card.iid}</span>
      {readOnly ? (
        <span className="sprint-row__title">{card.title}</span>
      ) : (
        <Link
          className="sprint-row__title"
          draggable={false}
          href={
            card.isStory
              ? `/projects/${projectId}/board?story=${card.id}`
              : `/projects/${projectId}/gantt?wp=${card.id}`
          }
        >
          {card.title}
        </Link>
      )}
      {card.isStory && <span className="chip chip--accent">Story</span>}
      <span className="sprint-row__column" data-done={card.column === 'done' ? '' : undefined}>
        {column}
      </span>
      {card.storyPoints !== null && (
        <span className="mono tabnum board__points" title="Story Points">
          {card.storyPoints} SP
        </span>
      )}
      {card.assignees.length > 0 && <AssigneeAvatars assignees={card.assignees} />}
    </>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

function SprintDialog({
  projectId,
  sprint,
  suggestedNumber,
  suggestedStart,
  onClose,
  onSaved,
}: {
  projectId: string;
  sprint: SprintInfo | null;
  suggestedNumber: number;
  suggestedStart: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  useEscape(onClose);
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const start = sprint?.startDate ?? suggestedStart ?? today;
  const [name, setName] = useState(sprint?.name ?? `Sprint ${suggestedNumber}`);
  const [goal, setGoal] = useState(sprint?.goal ?? '');
  const [startDate, setStartDate] = useState(start);
  const [endDate, setEndDate] = useState(sprint?.endDate ?? addDaysIso(start, SPRINT_LENGTH_DAYS - 1));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const input = { name, goal, startDate, endDate };
      const result = sprint
        ? await updateSprintAction(sprint.id, input)
        : await createSprintAction(projectId, input);
      if (!result.ok) setError(result.error);
      else onSaved();
    });
  }

  return (
    <div className="story-dialog__backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={sprint ? `${sprint.name} bearbeiten` : 'Neuer Sprint'}
        className="card story-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card__hd">
          <span style={{ fontWeight: 600, fontSize: 14 }}>
            {sprint ? `${sprint.name} bearbeiten` : 'Neuer Sprint'}
          </span>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={onClose} title="Schliessen" aria-label="Schliessen">
            <X size={12} />
          </button>
        </div>
        <div className="card__bd story-dialog__body">
          <div className="story-dialog__field">
            <label className="label" htmlFor="sprint-name">Name*</label>
            <input id="sprint-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} disabled={pending} autoFocus />
          </div>
          <div className="story-dialog__field">
            <label className="label" htmlFor="sprint-goal">Sprint-Ziel</label>
            <textarea id="sprint-goal" className="story-dialog__textarea" value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} maxLength={500} disabled={pending} />
          </div>
          <div className="story-dialog__row">
            <div className="story-dialog__field">
              <label className="label" htmlFor="sprint-start">Start*</label>
              <input id="sprint-start" type="date" className="input mono" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={pending} />
            </div>
            <div className="story-dialog__field">
              <label className="label" htmlFor="sprint-end">Ende*</label>
              <input id="sprint-end" type="date" className="input mono" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={pending} />
            </div>
          </div>
          {error && <div role="alert" className="story-dialog__error">{error}</div>}
        </div>
        <div className="card__ft" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn--sm" onClick={onClose} disabled={pending}>Abbrechen</button>
          <button type="button" className="btn btn--primary btn--sm" onClick={submit} disabled={!name.trim() || pending}>
            {pending ? 'Speichere…' : sprint ? 'Speichern' : 'Erstellen'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CloseSprintDialog({
  sprint,
  open,
  done,
  planned,
  onCancel,
  onClosed,
}: {
  sprint: SprintInfo;
  open: BoardCard[];
  done: BoardCard[];
  planned: SprintInfo[];
  onCancel: () => void;
  onClosed: () => void;
}) {
  useEscape(onCancel);
  const [target, setTarget] = useState(planned[0] ? String(planned[0].number) : '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await closeSprintAction(sprint.id, target ? Number(target) : null);
      if (!result.ok) setError(result.error);
      else onClosed();
    });
  }

  return (
    <div className="story-dialog__backdrop" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${sprint.name} abschliessen`}
        className="card story-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card__hd">
          <span style={{ fontWeight: 600, fontSize: 14 }}>{sprint.name} abschliessen</span>
        </div>
        <div className="card__bd story-dialog__body">
          <p className="story-details__sentence">
            {done.length} erledigt ({pointsOf(done)} SP), {open.length} noch offen ({pointsOf(open)} SP).
          </p>
          {open.length > 0 && (
            <div className="story-dialog__field">
              <label className="label" htmlFor="sprint-carry">Offene Aufgaben verschieben nach</label>
              <select id="sprint-carry" className="input" value={target} onChange={(e) => setTarget(e.target.value)} disabled={pending}>
                {planned.map((s) => (
                  <option key={s.id} value={s.number}>{s.name}</option>
                ))}
                <option value="">Backlog</option>
              </select>
            </div>
          )}
          {error && <div role="alert" className="story-dialog__error">{error}</div>}
        </div>
        <div className="card__ft" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn--sm" onClick={onCancel} disabled={pending}>Abbrechen</button>
          <button type="button" className="btn btn--primary btn--sm" onClick={submit} disabled={pending}>
            {pending ? 'Schliesse ab…' : 'Sprint abschliessen'}
          </button>
        </div>
      </div>
    </div>
  );
}
