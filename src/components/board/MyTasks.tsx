'use client';

import { useState } from 'react';
import { CheckCircle2, Eye, Play, RotateCcw } from 'lucide-react';
import type { BoardColumnId } from '@/lib/agile/board';
import { formatHoursFromSeconds } from '@/lib/agile/tasks';
import type { BoardCard, BoardTask } from './BoardView';

// Meine Tasks: was mir im gewählten Sprint zugewiesen ist, nach Story. Gedacht
// fürs Daily Scrum: Was mache ich heute, was ist im Review, was ist fertig?

type Props = {
  stories: BoardCard[];
  gitlabUserId: number | null;
  readOnly: boolean;
  onMove: (storyId: string, task: BoardTask, target: BoardColumnId) => void;
  onOpenStory: (storyId: string) => void;
};

const STATE_LABEL: Record<BoardColumnId, string> = {
  backlog: 'To Do',
  todo: 'To Do',
  doing: 'In Arbeit',
  review: 'Review',
  done: 'Erledigt',
};

export function MyTasks({ stories, gitlabUserId, readOnly, onMove, onOpenStory }: Props) {
  const [showDone, setShowDone] = useState(false);
  const mine = (t: BoardTask) => gitlabUserId !== null && t.assignees.some((a) => a.id === gitlabUserId);
  const groups = stories
    .map((story) => ({ story, tasks: story.tasks.filter(mine) }))
    .filter((g) => g.tasks.length > 0);
  const open = groups.flatMap((g) => g.tasks.filter((t) => t.column !== 'done'));
  const done = groups.flatMap((g) => g.tasks.filter((t) => t.column === 'done'));
  const remaining = open.reduce((sum, t) => sum + (t.estimateSeconds ?? 0), 0);

  if (gitlabUserId === null) {
    return <p className="my-tasks__empty">„Meine Tasks“ gibt es nur für angemeldete Personen.</p>;
  }
  if (groups.length === 0) {
    return (
      <div className="my-tasks__empty">
        <b>Dir sind in dieser Auswahl keine Tasks zugewiesen.</b>
        <p>
          Zuweisen geht im Story-Dialog bei jedem Task oder im Taskboard beim Anlegen. Oben lässt sich der Sprint wechseln
          oder „Alle Aufgaben“ wählen.
        </p>
      </div>
    );
  }

  return (
    <div className="my-tasks">
      <div className="my-tasks__sum">
        <span className="mono tabnum">{open.length}</span> offen
        {remaining > 0 && (
          <>
            {' · '}
            <span className="mono tabnum">{formatHoursFromSeconds(remaining)}</span> geschätzt
          </>
        )}
        {' · '}
        <span className="mono tabnum">{done.length}</span> erledigt
        {done.length > 0 && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowDone((v) => !v)}>
            {showDone ? 'Erledigte ausblenden' : 'Erledigte zeigen'}
          </button>
        )}
      </div>
      {groups.map(({ story, tasks }) => {
        const shown = tasks.filter((t) => showDone || t.column !== 'done');
        if (shown.length === 0) return null;
        return (
          <section key={story.id} className="card my-tasks__group">
            <button type="button" className="my-tasks__story" onClick={() => onOpenStory(story.id)}>
              <span className="mono">#{story.iid}</span> {story.title}
              {story.storyPoints !== null && <span className="mono my-tasks__sp">{story.storyPoints} SP</span>}
            </button>
            <ul>
              {shown.map((t) => (
                <li key={t.id} data-state={t.column}>
                  <span className="my-tasks__state">{STATE_LABEL[t.column]}</span>
                  <span className="my-tasks__title">
                    <span className="mono">#{t.iid}</span> {t.title}
                  </span>
                  {t.estimateSeconds !== null && (
                    <span className="mono tabnum my-tasks__h">{formatHoursFromSeconds(t.estimateSeconds)}</span>
                  )}
                  {!readOnly && (
                    <span className="my-tasks__actions">
                      {(t.column === 'backlog' || t.column === 'todo') && (
                        <button type="button" className="btn btn--sm" onClick={() => onMove(story.id, t, 'doing')}>
                          <Play size={12} /> Starten
                        </button>
                      )}
                      {t.column === 'doing' && (
                        <button type="button" className="btn btn--sm" onClick={() => onMove(story.id, t, 'review')}>
                          <Eye size={12} /> Review
                        </button>
                      )}
                      {t.column !== 'done' ? (
                        <button type="button" className="btn btn--primary btn--sm" onClick={() => onMove(story.id, t, 'done')}>
                          <CheckCircle2 size={12} /> Erledigt
                        </button>
                      ) : (
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => onMove(story.id, t, 'todo')}>
                          <RotateCcw size={12} /> Wieder öffnen
                        </button>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
