'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CalendarDays, Check, Plus, Square, X } from 'lucide-react';
import { moveBoardCardAction, updateWipLimitAction } from '@/app/projects/[id]/board/actions';
import { WIP_COLUMNS, type FlowDay, type WipLimits } from '@/lib/agile/flow-shared';
import { CumulativeFlow } from './CumulativeFlow';
import { AssigneeAvatars } from '@/components/gantt/AssigneeAvatars';
import { BOARD_COLUMNS, type BoardColumnId } from '@/lib/agile/board';
import type { StoryFields } from '@/lib/agile/story';
import type { SprintInfo } from '@/lib/agile/sprints';
import { StoryDialog } from './StoryDialog';
import { TaskBoard } from './TaskBoard';
import { formatHoursFromSeconds, taskProgress } from '@/lib/agile/tasks';

export type BoardPerson = { id: number; username: string; name: string; avatarUrl?: string };
export type BoardLabel = { name: string; color?: string };

export type BoardCard = {
  id: string;
  iid: number;
  title: string;
  column: BoardColumnId;
  sprintNumber: number | null;
  isStory: boolean;
  storyPoints: number | null;
  labels: BoardLabel[];
  assignees: BoardPerson[];
  startDate: string | null;
  endDate: string | null;
  story: StoryFields | null;
  /** Native GitLab-Tasks unter der Story, im Board als Unterpunkte. */
  tasks: BoardTask[];
  /** Zeitpunkt des Schliessens; für den Sprint-Burndown. */
  closedAt: string | null;
};

export type BoardTask = {
  id: string;
  iid: number;
  title: string;
  column: BoardColumnId;
  assignees: BoardPerson[];
  estimateSeconds: number | null;
  spentSeconds: number | null;
  closedAt: string | null;
};

type Props = {
  projectId: string;
  cards: BoardCard[];
  people: BoardPerson[];
  projectLabels: BoardLabel[];
  sprints: SprintInfo[];
  initialStoryId?: string;
  /** Lese-Link: nichts verschieben oder anlegen, Stories nur ansehen. */
  readOnly?: boolean;
  /** Wird abgefragt, wenn eine Story nach Done wandert. */
  definitionOfDone?: string[];
  /** Kanban: höchstens so viele Karten gleichzeitig pro Spalte. */
  wipLimits?: WipLimits;
  /** Tagesstände für das Cumulative Flow Diagram. */
  flow?: FlowDay[];
};

type DialogState = { mode: 'create'; column: BoardColumnId } | { mode: 'edit'; cardId: string } | null;

type SprintFilter = 'all' | 'none' | number;

const CARD_PREFIX = 'card:';
const COLUMN_PREFIX = 'column:';

// Eine Karte liegt immer auch in ihrer Spalte: die Karte unter dem Zeiger hat
// Vorrang (einfügen davor), sonst zählt die Spalte (ans Ende).
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const cardHits = hits.filter((h) => String(h.id).startsWith(CARD_PREFIX));
  return cardHits.length > 0 ? cardHits : hits;
};

export function BoardView({
  projectId,
  cards: serverCards,
  people,
  projectLabels,
  sprints,
  initialStoryId,
  readOnly = false,
  definitionOfDone = [],
  wipLimits = {},
  flow = [],
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [cards, setCards] = useState(serverCards);
  const [syncedCards, setSyncedCards] = useState(serverCards);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [onlyStories, setOnlyStories] = useState(false);
  const [view, setView] = useState<'cards' | 'tasks' | 'flow'>('cards');
  const activeSprint = sprints.find((s) => s.state === 'active') ?? null;
  // Läuft ein Sprint, ist er das Board. Der Rest bleibt über die Auswahl erreichbar.
  const [sprintFilter, setSprintFilter] = useState<SprintFilter>(() => {
    const opened = serverCards.find((c) => c.id === initialStoryId);
    if (opened) return 'all';
    return activeSprint?.number ?? 'all';
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Story auf dem Weg nach Done, bis die Definition of Done bestätigt ist.
  const [doneCheck, setDoneCheck] = useState<{ card: BoardCard; next: BoardCard[] } | null>(null);
  const [dialog, setDialog] = useState<DialogState>(() =>
    serverCards.some((c) => c.id === initialStoryId && c.isStory)
      ? { mode: 'edit', cardId: initialStoryId! }
      : null,
  );

  // Neuer Server-Stand (Refresh, Sync) ersetzt den optimistischen Stand.
  if (serverCards !== syncedCards) {
    setSyncedCards(serverCards);
    setCards(serverCards);
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const visible = useMemo(
    () =>
      cards.filter((c) => {
        if (onlyStories && !c.isStory) return false;
        if (sprintFilter === 'all') return true;
        if (sprintFilter === 'none') return c.sprintNumber === null;
        return c.sprintNumber === sprintFilter;
      }),
    [cards, onlyStories, sprintFilter],
  );
  const selectedSprint = typeof sprintFilter === 'number' ? sprints.find((s) => s.number === sprintFilter) : undefined;
  const activeCard = cards.find((c) => c.id === activeId) ?? null;
  const editedCard = dialog?.mode === 'edit' ? cards.find((c) => c.id === dialog.cardId) : undefined;

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id).slice(CARD_PREFIX.length));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    if (!e.over) return;
    const cardId = String(e.active.id).slice(CARD_PREFIX.length);
    const overId = String(e.over.id);
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;

    const overCard = overId.startsWith(CARD_PREFIX)
      ? cards.find((c) => c.id === overId.slice(CARD_PREFIX.length))
      : undefined;
    const target = overCard?.column ?? (overId.slice(COLUMN_PREFIX.length) as BoardColumnId);
    if (overCard?.id === card.id) return;

    const without = cards.filter((c) => c.id !== card.id);
    const moved = { ...card, column: target };
    const insertAt = overCard
      ? without.findIndex((c) => c.id === overCard.id)
      : without.length;
    const next = [...without.slice(0, insertAt), moved, ...without.slice(insertAt)];

    // Eine Story ist erst fertig, wenn sie die Definition of Done erfüllt.
    // Nachgefragt wird, gesperrt nicht: Das entscheidet das Team.
    const hasChecklist =
      definitionOfDone.length > 0 || (card.story?.criteria.length ?? 0) > 0 || card.tasks.length > 0;
    if (target === 'done' && card.column !== 'done' && card.isStory && hasChecklist) {
      setDoneCheck({ card, next });
      return;
    }
    commitMove(card, target, next);
    // WIP-Limit: warnen, nicht sperren. Das Team soll es sehen und entscheiden.
    const limit = wipLimits[target];
    const visibleIds = new Set(visible.map((v) => v.id).concat(card.id));
    const inColumn = next.filter((c) => c.column === target && visibleIds.has(c.id)).length;
    if (limit && card.column !== target && inColumn > limit) {
      const title = BOARD_COLUMNS.find((c) => c.id === target)?.title ?? target;
      setNotice(`WIP-Limit in „${title}“ überschritten (${inColumn}/${limit}). Erst etwas fertig machen, dann Neues anfangen.`);
    }
  }

  function commitMove(card: BoardCard, target: BoardColumnId, next: BoardCard[]) {
    const previous = cards;
    setCards(next);
    setError(null);
    startTransition(async () => {
      const orderedIds = next.filter((c) => c.column === target).map((c) => c.id);
      const result = await moveBoardCardAction(projectId, card.id, target, orderedIds);
      if (!result.ok) {
        setCards(previous);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="board">
      <div className="board__toolbar">
        {!readOnly && (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => setDialog({ mode: 'create', column: 'backlog' })}
          >
            <Plus size={12} />
            Neue User Story
          </button>
        )}
        <div className="seg" role="group" aria-label="Ansicht">
          <button type="button" aria-pressed={view === 'cards'} onClick={() => setView('cards')}>
            Karten
          </button>
          <button type="button" aria-pressed={view === 'tasks'} onClick={() => setView('tasks')}>
            Taskboard
          </button>
          <button type="button" aria-pressed={view === 'flow'} onClick={() => setView('flow')}>
            Fluss
          </button>
        </div>
        <label className="board__toggle" hidden={view !== 'cards'}>
          <input
            type="checkbox"
            checked={onlyStories}
            onChange={(e) => setOnlyStories(e.target.checked)}
          />
          Nur User Stories
        </label>
        {sprints.length > 0 && (
          <select
            className="input board__sprint-select"
            aria-label="Sprint"
            value={String(sprintFilter)}
            onChange={(e) => {
              const v = e.target.value;
              setSprintFilter(v === 'all' || v === 'none' ? v : Number(v));
            }}
          >
            <option value="all">Alle Aufgaben</option>
            <option value="none">Ohne Sprint</option>
            {[...sprints].reverse().map((s) => (
              <option key={s.id} value={s.number}>
                {s.name}
                {s.state === 'active' ? ' (aktiv)' : s.state === 'closed' ? ' (abgeschlossen)' : ' (geplant)'}
              </option>
            ))}
          </select>
        )}
        {selectedSprint && (
          <span className="board__sprint-info">
            <span className="mono">
              bis {selectedSprint.endDate.split('-').reverse().join('.')}
            </span>
            {selectedSprint.goal && <span className="board__sprint-goal">Ziel: {selectedSprint.goal}</span>}
          </span>
        )}
        {error && (
          <span role="alert" className="board__error">
            {error}
          </span>
        )}
        {notice && !error && (
          <span role="status" className="board__notice">
            {notice}
            <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => setNotice(null)} aria-label="Hinweis schliessen">
              <X size={11} />
            </button>
          </span>
        )}
      </div>

      {view === 'flow' && <CumulativeFlow days={flow} wipLimits={wipLimits} />}

      {view === 'tasks' && (
        <TaskBoard
          projectId={projectId}
          stories={visible.filter((c) => c.isStory)}
          readOnly={readOnly}
          onOpenStory={(id) => setDialog({ mode: 'edit', cardId: id })}
        />
      )}

      {view === 'cards' && (
        <DndContext
          id="board-dnd"
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={onDragStart}
          onDragCancel={() => setActiveId(null)}
          onDragEnd={onDragEnd}
        >
          <div className="board__columns">
            {BOARD_COLUMNS.map((column) => {
              const columnCards = visible.filter((c) => c.column === column.id);
              return (
                <BoardColumn
                  key={column.id}
                  id={column.id}
                  title={column.title}
                  cards={columnCards}
                  readOnly={readOnly}
                  limit={wipLimits[column.id]}
                  onSetLimit={
                    readOnly || !WIP_COLUMNS.includes(column.id)
                      ? undefined
                      : (limit) =>
                          startTransition(async () => {
                            const result = await updateWipLimitAction(projectId, column.id, limit);
                            if (!result.ok) setError(result.error);
                            else router.refresh();
                          })
                  }
                  onAdd={
                    readOnly || column.id === 'done'
                      ? undefined
                      : () => setDialog({ mode: 'create', column: column.id })
                  }
                  onOpen={(card) => {
                    if (card.isStory) setDialog({ mode: 'edit', cardId: card.id });
                    else if (!readOnly) router.push(`/projects/${projectId}/gantt?wp=${card.id}`);
                  }}
                />
              );
            })}
          </div>
          <DragOverlay dropAnimation={null}>
            {activeCard && <CardBody card={activeCard} dragging />}
          </DragOverlay>
        </DndContext>
      )}

      {readOnly && editedCard?.story && (
        <StoryDetails card={editedCard} story={editedCard.story} onClose={() => setDialog(null)} />
      )}

      {!readOnly && dialog && (dialog.mode === 'create' || editedCard) && (
        <StoryDialog
          key={dialog.mode === 'edit' ? dialog.cardId : `new-${dialog.column}`}
          projectId={projectId}
          card={editedCard}
          column={dialog.mode === 'create' ? dialog.column : undefined}
          people={people}
          projectLabels={projectLabels}
          sprints={sprints}
          defaultSprintNumber={
            selectedSprint && selectedSprint.state !== 'closed' ? selectedSprint.number : null
          }
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      )}

      {doneCheck && (
        <DoneCheckDialog
          card={doneCheck.card}
          definitionOfDone={definitionOfDone}
          onCancel={() => setDoneCheck(null)}
          onConfirm={() => {
            commitMove(doneCheck.card, 'done', doneCheck.next);
            setDoneCheck(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Fragt beim Verschieben nach Done die Definition of Done und die
 * Akzeptanzkriterien ab. Offene Punkte warnen, sperren aber nicht.
 */
function DoneCheckDialog({
  card,
  definitionOfDone,
  onCancel,
  onConfirm,
}: {
  card: BoardCard;
  definitionOfDone: string[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [checked, setChecked] = useState<boolean[]>(() => definitionOfDone.map(() => false));
  const criteria = card.story?.criteria ?? [];
  const openCriteria = criteria.filter((c) => !c.done).length;
  const openDod = checked.filter((c) => !c).length;
  const openTasks = card.tasks.filter((t) => t.column !== 'done');
  const allMet = openDod === 0 && openCriteria === 0 && openTasks.length === 0;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="story-dialog__backdrop" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Definition of Done prüfen"
        className="card story-dialog done-check"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card__hd">
          <span style={{ fontWeight: 600, fontSize: 14 }}>Ist #{card.iid} wirklich fertig?</span>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={onCancel} aria-label="Schliessen">
            <X size={12} />
          </button>
        </div>
        <div className="card__bd story-dialog__body">
          <div className="done-check__title">{card.title}</div>
          {definitionOfDone.length > 0 && (
            <fieldset className="done-check__group">
              <legend>Definition of Done</legend>
              {definitionOfDone.map((item, i) => (
                <label key={i} className="done-check__item">
                  <input
                    type="checkbox"
                    checked={checked[i]}
                    onChange={(e) => setChecked(checked.map((c, j) => (j === i ? e.target.checked : c)))}
                    autoFocus={i === 0}
                  />
                  {item}
                </label>
              ))}
            </fieldset>
          )}
          {criteria.length > 0 && (
            <div className="done-check__group">
              <div className="done-check__legend">
                Akzeptanzkriterien <span className="mono tabnum">{criteria.length - openCriteria}/{criteria.length}</span>
              </div>
              {criteria.map((c, i) => (
                <div key={i} className="done-check__item" data-open={c.done ? undefined : ''}>
                  {c.done ? <Check size={13} /> : <Square size={13} />}
                  {c.text}
                </div>
              ))}
              {openCriteria > 0 && (
                <div className="done-check__note">Offene Kriterien hakst du in der Story ab, sobald sie erfüllt sind.</div>
              )}
            </div>
          )}
          {card.tasks.length > 0 && (
            <div className="done-check__group">
              <div className="done-check__legend">
                Tasks <span className="mono tabnum">{card.tasks.length - openTasks.length}/{card.tasks.length}</span>
              </div>
              {openTasks.map((t) => (
                <div key={t.id} className="done-check__item" data-open="">
                  <Square size={13} />#{t.iid} {t.title}
                </div>
              ))}
              {openTasks.length === 0 && <div className="done-check__note">Alle Tasks erledigt.</div>}
            </div>
          )}
          {!allMet && (
            <div role="status" className="done-check__warn">
              {[
                openDod > 0 && `${openDod} ${openDod === 1 ? 'Punkt' : 'Punkte'} der DoD nicht bestätigt`,
                openCriteria > 0 && `${openCriteria} ${openCriteria === 1 ? 'Kriterium' : 'Kriterien'} offen`,
                openTasks.length > 0 && `${openTasks.length} ${openTasks.length === 1 ? 'Task' : 'Tasks'} offen`,
              ]
                .filter(Boolean)
                .join(' · ')}
              . Eine unfertige Story gehört eigentlich zurück ins Product Backlog.
            </div>
          )}
        </div>
        <div className="card__ft" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn--sm" onClick={onCancel}>
            Abbrechen
          </button>
          <button type="button" className={`btn btn--sm${allMet ? ' btn--primary' : ''}`} onClick={onConfirm}>
            <Check size={12} />
            {allMet ? 'Als erledigt markieren' : 'Trotzdem erledigt'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BoardColumn({
  id,
  title,
  cards,
  readOnly,
  onAdd,
  onOpen,
  limit,
  onSetLimit,
}: {
  id: BoardColumnId;
  title: string;
  cards: BoardCard[];
  readOnly: boolean;
  onAdd?: () => void;
  onOpen: (card: BoardCard) => void;
  limit?: number;
  onSetLimit?: (limit: number | null) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `${COLUMN_PREFIX}${id}` });
  const points = cards.reduce((sum, c) => sum + (c.storyPoints ?? 0), 0);
  const [editingLimit, setEditingLimit] = useState(false);
  const overLimit = limit !== undefined && cards.length > limit;
  return (
    <section
      ref={setNodeRef}
      className="board__column"
      data-over={isOver ? '' : undefined}
      data-wip-over={overLimit ? '' : undefined}
      aria-label={title}
    >
      <header className="board__column-hd">
        <span className="board__column-title">{title}</span>
        {editingLimit && onSetLimit ? (
          <input
            className="input mono board__wip-input"
            type="number"
            min={1}
            max={99}
            defaultValue={limit ?? ''}
            placeholder="–"
            aria-label={`WIP-Limit für ${title}, leer = kein Limit`}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditingLimit(false);
              if (e.key === 'Enter') {
                const raw = e.currentTarget.value.trim();
                onSetLimit(raw === '' ? null : Number(raw));
                setEditingLimit(false);
              }
            }}
            onBlur={() => setEditingLimit(false)}
          />
        ) : onSetLimit || limit !== undefined ? (
          <button
            type="button"
            className="mono tabnum board__count board__wip"
            data-over={overLimit ? '' : undefined}
            onClick={() => onSetLimit && setEditingLimit(true)}
            disabled={!onSetLimit}
            title={
              limit !== undefined
                ? `${cards.length} von höchstens ${limit} Karten (WIP-Limit)${onSetLimit ? '. Klicken zum Ändern' : ''}`
                : 'Kein WIP-Limit. Klicken, um eines zu setzen'
            }
          >
            {cards.length}
            {limit !== undefined ? `/${limit}` : ''}
          </button>
        ) : (
          <span className="mono tabnum board__count" title="Karten">
            {cards.length}
          </span>
        )}
        {points > 0 && (
          <span className="mono tabnum board__points" title="Story Points">
            {points} SP
          </span>
        )}
        <div style={{ flex: 1 }} />
        {onAdd && (
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            onClick={onAdd}
            title={`Neue User Story in „${title}“`}
            aria-label={`Neue User Story in ${title}`}
          >
            <Plus size={12} />
          </button>
        )}
      </header>
      <div className="board__cards">
        {cards.map((card) => (
          <DraggableCard key={card.id} card={card} readOnly={readOnly} onOpen={() => onOpen(card)} />
        ))}
      </div>
    </section>
  );
}

function DraggableCard({
  card,
  readOnly,
  onOpen,
}: {
  card: BoardCard;
  readOnly: boolean;
  onOpen: () => void;
}) {
  // Auf Lese-Links führt nur eine Story irgendwohin (Details ansehen).
  const clickable = !readOnly || card.isStory;
  const dndId = `${CARD_PREFIX}${card.id}`;
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: dndId,
    disabled: readOnly,
  });
  const { isOver, setNodeRef: setDropRef } = useDroppable({ id: dndId, disabled: readOnly });
  return (
    <div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      {...(readOnly ? {} : listeners)}
      {...(readOnly ? {} : attributes)}
      {...(readOnly && clickable ? { role: 'button', tabIndex: 0 } : {})}
      onClick={clickable ? onOpen : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
      className="board__card-slot"
      data-over={isOver && !isDragging ? '' : undefined}
      data-readonly={readOnly ? '' : undefined}
      data-clickable={readOnly && clickable ? '' : undefined}
      style={{ opacity: isDragging ? 0.35 : 1 }}
    >
      <CardBody card={card} />
    </div>
  );
}

function CardBody({ card, dragging = false }: { card: BoardCard; dragging?: boolean }) {
  const criteria = card.story?.criteria ?? [];
  const criteriaDone = criteria.filter((c) => c.done).length;
  const progress = taskProgress(card.tasks);
  return (
    <article className="board__card" data-dragging={dragging ? '' : undefined}>
      <div className="board__card-meta">
        <span className="mono tabnum">#{card.iid}</span>
        {card.isStory && <span className="chip chip--accent">Story</span>}
        <div style={{ flex: 1 }} />
        {card.storyPoints !== null && (
          <span className="mono tabnum board__points" title="Story Points">
            {card.storyPoints} SP
          </span>
        )}
      </div>
      <div className="board__card-title">{card.title}</div>
      {card.labels.length > 0 && (
        <div className="board__card-labels">
          {card.labels.map((label) => (
            <span key={label.name} className="board__label">
              <span className="board__label-dot" style={{ background: label.color ?? 'var(--color-ink-4)' }} />
              {label.name}
            </span>
          ))}
        </div>
      )}
      {progress.total > 0 && (
        <div
          className="board__tasks"
          title={`${progress.done} von ${progress.total} Tasks erledigt, ${formatHoursFromSeconds(progress.remainingSeconds)} geschätzt offen`}
        >
          <span className="board__tasks-bar">
            <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </span>
          <span className="mono tabnum">
            {progress.done}/{progress.total} Tasks
            {progress.estimateSeconds > 0 && ` · ${formatHoursFromSeconds(progress.remainingSeconds)} offen`}
          </span>
        </div>
      )}
      <div className="board__card-ft">
        {card.endDate && (
          <span className="mono board__card-date" title={`${card.startDate} bis ${card.endDate}`}>
            <CalendarDays size={11} />
            {card.endDate}
          </span>
        )}
        {criteria.length > 0 && (
          <span className="mono tabnum" title="Erfüllte Akzeptanzkriterien">
            {criteriaDone}/{criteria.length} ✓
          </span>
        )}
        <div style={{ flex: 1 }} />
        {card.assignees.length > 0 && <AssigneeAvatars assignees={card.assignees} />}
      </div>
    </article>
  );
}

function StoryDetails({
  card,
  story,
  onClose,
}: {
  card: BoardCard;
  story: StoryFields;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="story-dialog__backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Story #${card.iid}`}
        className="card story-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card__hd">
          <span style={{ fontWeight: 600, fontSize: 14 }}>
            #{card.iid} {card.title}
          </span>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            onClick={onClose}
            title="Schliessen"
            aria-label="Schliessen"
          >
            <X size={12} />
          </button>
        </div>
        <div className="card__bd story-dialog__body">
          {story.role && (
            <p className="story-details__sentence">
              <strong>Als</strong> {story.role} <strong>möchte ich</strong> {story.goal}
              {story.benefit && (
                <>
                  , <strong>damit</strong> {story.benefit}
                </>
              )}
              .
            </p>
          )}
          {story.criteria.length > 0 && (
            <div>
              <span className="label">Akzeptanzkriterien</span>
              <ul className="story-details__criteria">
                {story.criteria.map((c) => (
                  <li key={c.text} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                    {c.done ? <Check size={12} aria-label="erfüllt" /> : <Square size={12} aria-label="offen" />}
                    <span>{c.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {story.notes && (
            <div>
              <span className="label">Notizen</span>
              <p className="story-details__notes">{story.notes}</p>
            </div>
          )}
          {card.storyPoints !== null && (
            <div className="share__hint">{card.storyPoints} Story Points</div>
          )}
        </div>
      </div>
    </div>
  );
}
