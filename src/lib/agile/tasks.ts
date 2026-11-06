// Fortschritt einer Story aus ihren Tasks. Ohne Server-Abhängigkeiten.
import type { BoardTask } from '@/components/board/BoardView';

export type TaskProgress = {
  total: number;
  done: number;
  /** Summe aller Schätzungen in Sekunden. */
  estimateSeconds: number;
  /** Schätzungen der offenen Tasks: das, was im Burndown noch übrig ist. */
  remainingSeconds: number;
  /** Tasks ohne Schätzung; die zählen im Stunden-Burndown nicht mit. */
  unestimated: number;
};

export function taskProgress(tasks: BoardTask[]): TaskProgress {
  let done = 0;
  let estimate = 0;
  let remaining = 0;
  let unestimated = 0;
  for (const t of tasks) {
    const isDone = t.column === 'done';
    if (isDone) done += 1;
    if (t.estimateSeconds === null) unestimated += 1;
    estimate += t.estimateSeconds ?? 0;
    if (!isDone) remaining += t.estimateSeconds ?? 0;
  }
  return { total: tasks.length, done, estimateSeconds: estimate, remainingSeconds: remaining, unestimated };
}

/** 5400 → "1.5 h", 0 → "0 h". */
export function formatHoursFromSeconds(seconds: number): string {
  const hours = seconds / 3600;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}

/** Richtwert aus dem Scrum Guide: Arbeit für höchstens einen Tag. */
export const TASK_MAX_HOURS = 8;
