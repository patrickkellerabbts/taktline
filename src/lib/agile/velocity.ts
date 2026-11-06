// Velocity aus abgeschlossenen Sprints. Ohne Server-Abhängigkeiten, damit
// auch Browser-Komponenten die Typen und Konstanten nutzen können.
import type { SprintInfo } from './sprints';

export type Commitments = {
  productGoal: string | null;
  definitionOfDone: string[];
};

/** Wie viele abgeschlossene Sprints in den Durchschnitt eingehen. */
export const VELOCITY_WINDOW = 3;

export type Velocity = {
  sprints: Array<{ number: number; name: string; points: number; count: number }>;
  /** Durchschnitt der letzten VELOCITY_WINDOW Sprints, null ohne Abschluss. */
  average: number | null;
};

export function computeVelocity(sprints: SprintInfo[]): Velocity {
  const closed = sprints
    .filter((s) => s.state === 'closed' && s.completedPoints !== null)
    .sort((a, b) => a.number - b.number)
    .map((s) => ({ number: s.number, name: s.name, points: s.completedPoints ?? 0, count: s.completedCount ?? 0 }));
  const recent = closed.slice(-VELOCITY_WINDOW);
  return {
    sprints: closed,
    average: recent.length ? recent.reduce((sum, s) => sum + s.points, 0) / recent.length : null,
  };
}
