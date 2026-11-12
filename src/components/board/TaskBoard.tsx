'use client';

import { useState, useTransition } from 'react';
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
  type DragEndEvent,
} from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import { moveBoardCardAction } from '@/app/projects/[id]/board/actions';
import { createTaskAction } from '@/app/projects/[id]/board/task-actions';
import { TaskForm } from './StoryTasks';
import { AssigneeAvatars } from '@/components/gantt/AssigneeAvatars';
import { formatHoursFromSeconds, storyCloseHint, taskProgress } from '@/lib/agile/tasks';
import type { BoardColumnId } from '@/lib/agile/board';
import type { BoardCard, BoardPerson, BoardTask } from './BoardView';

// Klassisches Scrum-Taskboard: eine Zeile pro Story (Swimlane), Spalten für
// den Stand der Tasks. „Offen“ und „To Do“ fallen hier zusammen, weil ein Task
// im Sprint schon eingeplant ist.

const COLUMNS: Array<{ id: Exclude<BoardColumnId, 'backlog'>; title: string }> = [
  { id: 'todo', title: 'To Do' },
  { id: 'doing', title: 'In Arbeit' },
  { id: 'review', title: 'Review' },
  { id: 'done', title: 'Done' },
];

function laneColumn(task: BoardTask): Exclude<BoardColumnId, 'backlog'> {
  return task.column === 'backlog' ? 'todo' : task.column;
}

type Props = {
  projectId: string;
  people: BoardPerson[];
  stories: BoardCard[];
  readOnly: boolean;
  onOpenStory: (id: string) => void;
};

export function TaskBoard({ projectId, people, stories: serverStories, readOnly, onOpenStory }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [stories, setStories] = useState(serverStories);
  const [synced, setSynced] = useState(serverStories);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Story, in deren Zeile gerade ein neuer Task eingetippt wird.
  const [adding, setAdding] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  if (serverStories !== synced) {
    setSynced(serverStories);
    setStories(serverStories);
  }
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const activeTask = stories.flatMap((s) => s.tasks).find((t) => t.id === activeId) ?? null;

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    if (!e.over) return;
    const [, storyId, column] = String(e.over.id).split(':') as [string, string, BoardColumnId];
    const story = stories.find((s) => s.id === storyId);
    const task = story?.tasks.find((t) => t.id === String(e.active.id));
    // Tasks bleiben in ihrer Zeile: die Story wechselt man nicht per Drag.
    if (!story || !task || laneColumn(task) === column) return;

    const previous = stories;
    const moved = story.tasks.map((t) => (t.id === task.id ? { ...t, column } : t));
    setStories(stories.map((s) => (s.id === story.id ? { ...s, tasks: moved } : s)));
    setError(null);
    startTransition(async () => {
      const ordered = moved.filter((t) => laneColumn(t) === column).map((t) => t.id);
      const result = await moveBoardCardAction(projectId, task.id, column, ordered);
      if (!result.ok) {
        setStories(previous);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (stories.length === 0) {
    return <p className="taskboard__empty">Keine User Stories in dieser Auswahl.</p>;
  }

  return (
    <div className="taskboard">
      {error && (
        <div role="alert" className="board__error">
          {error}
        </div>
      )}
      <DndContext
        id="taskboard-dnd"
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={(e) => setActiveId(String(e.active.id))}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={onDragEnd}
      >
        <div className="taskboard__grid" role="table" aria-label="Taskboard">
          <div className="taskboard__head" role="row">
            <span role="columnheader">Story</span>
            {COLUMNS.map((c) => (
              <span key={c.id} role="columnheader">
                {c.title}
              </span>
            ))}
          </div>
          {stories.map((story) => {
            const progress = taskProgress(story.tasks);
            const closeHint = storyCloseHint(story.column, progress);
            return (
              <div key={story.id} className="taskboard__lane" role="row">
                <button type="button" className="taskboard__story" onClick={() => onOpenStory(story.id)} role="cell">
                  <span className="taskboard__story-meta mono">
                    #{story.iid}
                    {story.storyPoints !== null && <b>{story.storyPoints} SP</b>}
                  </span>
                  <span className="taskboard__story-title">{story.title}</span>
                  <span className="taskboard__story-sum mono tabnum">
                    {progress.total === 0
                      ? 'Noch keine Tasks'
                      : `${progress.done}/${progress.total} · ${formatHoursFromSeconds(progress.remainingSeconds)} offen`}
                  </span>
                  {closeHint && (
                    <span className="board__close-hint" title={closeHint.title}>
                      {closeHint.label}
                    </span>
                  )}
                </button>
                {COLUMNS.map((c) => (
                  <Cell key={c.id} storyId={story.id} column={c.id} readOnly={readOnly}>
                    {story.tasks
                      .filter((t) => laneColumn(t) === c.id)
                      .map((t) => (
                        <TaskCard key={t.id} task={t} readOnly={readOnly} />
                      ))}
                    {c.id === 'todo' && !readOnly && story.column !== 'done' &&
                      (adding === story.id ? (
                        <div className="taskboard__add-form">
                          <TaskForm
                            people={people}
                            pending={saving}
                            submitLabel="Anlegen"
                            onCancel={() => setAdding(null)}
                            onSubmit={(input) =>
                              startSaving(async () => {
                                setError(null);
                                const result = await createTaskAction(story.id, input);
                                if (!result.ok) {
                                  setError(result.error);
                                  return;
                                }
                                setAdding(null);
                                router.refresh();
                              })
                            }
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="taskboard__add"
                          onClick={() => setAdding(story.id)}
                          aria-label={`Task zu #${story.iid} hinzufügen`}
                        >
                          <Plus size={12} /> Task
                        </button>
                      ))}
                  </Cell>
                ))}
              </div>
            );
          })}
        </div>
        <DragOverlay dropAnimation={null}>{activeTask && <TaskBody task={activeTask} dragging />}</DragOverlay>
      </DndContext>
    </div>
  );
}

function Cell({
  storyId,
  column,
  readOnly,
  children,
}: {
  storyId: string;
  column: string;
  readOnly: boolean;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `lane:${storyId}:${column}`, disabled: readOnly });
  return (
    <div ref={setNodeRef} className="taskboard__cell" data-over={isOver ? '' : undefined} data-column={column} role="cell">
      {children}
    </div>
  );
}

function TaskCard({ task, readOnly }: { task: BoardTask; readOnly: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: readOnly });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} style={{ opacity: isDragging ? 0.35 : 1 }}>
      <TaskBody task={task} />
    </div>
  );
}

function TaskBody({ task, dragging = false }: { task: BoardTask; dragging?: boolean }) {
  return (
    <article className="taskboard__task" data-dragging={dragging ? '' : undefined} data-done={task.column === 'done' ? '' : undefined}>
      <div className="taskboard__task-title">{task.title}</div>
      <div className="taskboard__task-ft">
        <span className="mono">#{task.iid}</span>
        {task.estimateSeconds !== null && <span className="mono tabnum">{formatHoursFromSeconds(task.estimateSeconds)}</span>}
        <div style={{ flex: 1 }} />
        {task.assignees.length > 0 && <AssigneeAvatars assignees={task.assignees} />}
      </div>
    </article>
  );
}
