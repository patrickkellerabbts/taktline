'use client';

import { useMemo, useState, useTransition } from 'react';
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
import { CalendarDays, Plus } from 'lucide-react';
import { moveBoardCardAction } from '@/app/projects/[id]/board/actions';
import { AssigneeAvatars } from '@/components/gantt/AssigneeAvatars';
import { BOARD_COLUMNS, type BoardColumnId } from '@/lib/agile/board';
import type { StoryFields } from '@/lib/agile/story';
import { StoryDialog } from './StoryDialog';

export type BoardPerson = { id: number; username: string; name: string; avatarUrl?: string };
export type BoardLabel = { name: string; color?: string };

export type BoardCard = {
  id: string;
  iid: number;
  title: string;
  column: BoardColumnId;
  isStory: boolean;
  storyPoints: number | null;
  labels: BoardLabel[];
  assignees: BoardPerson[];
  startDate: string | null;
  endDate: string | null;
  story: StoryFields | null;
};

type Props = {
  projectId: string;
  cards: BoardCard[];
  people: BoardPerson[];
  projectLabels: BoardLabel[];
  initialStoryId?: string;
};

type DialogState = { mode: 'create'; column: BoardColumnId } | { mode: 'edit'; cardId: string } | null;

const CARD_PREFIX = 'card:';
const COLUMN_PREFIX = 'column:';

// Eine Karte liegt immer auch in ihrer Spalte: die Karte unter dem Zeiger hat
// Vorrang (einfügen davor), sonst zählt die Spalte (ans Ende).
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const cardHits = hits.filter((h) => String(h.id).startsWith(CARD_PREFIX));
  return cardHits.length > 0 ? cardHits : hits;
};

export function BoardView({ projectId, cards: serverCards, people, projectLabels, initialStoryId }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [cards, setCards] = useState(serverCards);
  const [syncedCards, setSyncedCards] = useState(serverCards);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [onlyStories, setOnlyStories] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    () => (onlyStories ? cards.filter((c) => c.isStory) : cards),
    [cards, onlyStories],
  );
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
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => setDialog({ mode: 'create', column: 'backlog' })}
        >
          <Plus size={12} />
          Neue User Story
        </button>
        <label className="board__toggle">
          <input
            type="checkbox"
            checked={onlyStories}
            onChange={(e) => setOnlyStories(e.target.checked)}
          />
          Nur User Stories
        </label>
        {error && (
          <span role="alert" className="board__error">
            {error}
          </span>
        )}
      </div>

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
                onAdd={
                  column.id === 'done'
                    ? undefined
                    : () => setDialog({ mode: 'create', column: column.id })
                }
                onOpen={(card) => {
                  if (card.isStory) setDialog({ mode: 'edit', cardId: card.id });
                  else router.push(`/projects/${projectId}/gantt?wp=${card.id}`);
                }}
              />
            );
          })}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeCard && <CardBody card={activeCard} dragging />}
        </DragOverlay>
      </DndContext>

      {dialog && (dialog.mode === 'create' || editedCard) && (
        <StoryDialog
          key={dialog.mode === 'edit' ? dialog.cardId : `new-${dialog.column}`}
          projectId={projectId}
          card={editedCard}
          column={dialog.mode === 'create' ? dialog.column : undefined}
          people={people}
          projectLabels={projectLabels}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function BoardColumn({
  id,
  title,
  cards,
  onAdd,
  onOpen,
}: {
  id: BoardColumnId;
  title: string;
  cards: BoardCard[];
  onAdd?: () => void;
  onOpen: (card: BoardCard) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `${COLUMN_PREFIX}${id}` });
  const points = cards.reduce((sum, c) => sum + (c.storyPoints ?? 0), 0);
  return (
    <section
      ref={setNodeRef}
      className="board__column"
      data-over={isOver ? '' : undefined}
      aria-label={title}
    >
      <header className="board__column-hd">
        <span className="board__column-title">{title}</span>
        <span className="mono tabnum board__count" title="Karten">
          {cards.length}
        </span>
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
          <DraggableCard key={card.id} card={card} onOpen={() => onOpen(card)} />
        ))}
      </div>
    </section>
  );
}

function DraggableCard({ card, onOpen }: { card: BoardCard; onOpen: () => void }) {
  const dndId = `${CARD_PREFIX}${card.id}`;
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: dndId });
  const { isOver, setNodeRef: setDropRef } = useDroppable({ id: dndId });
  return (
    <div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      {...listeners}
      {...attributes}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="board__card-slot"
      data-over={isOver && !isDragging ? '' : undefined}
      style={{ opacity: isDragging ? 0.35 : 1 }}
    >
      <CardBody card={card} />
    </div>
  );
}

function CardBody({ card, dragging = false }: { card: BoardCard; dragging?: boolean }) {
  const criteria = card.story?.criteria ?? [];
  const criteriaDone = criteria.filter((c) => c.done).length;
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
