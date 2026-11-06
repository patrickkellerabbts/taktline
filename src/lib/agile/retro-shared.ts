// Typen und Konstanten für Review und Retro, ohne Server-Abhängigkeiten.
import type { SprintInfo } from './sprints';

export type RetroKind = 'good' | 'improve' | 'action';

export const RETRO_COLUMNS: Array<{ kind: RetroKind; title: string; hint: string }> = [
  { kind: 'good', title: 'Gut gelaufen', hint: 'Was wollen wir beibehalten?' },
  { kind: 'improve', title: 'Verbessern', hint: 'Was hat gebremst oder gestört?' },
  { kind: 'action', title: 'Massnahmen', hint: 'Was probieren wir im nächsten Sprint konkret anders?' },
];

/** Punkte pro Person und Retro (Dot Voting). */
export const RETRO_VOTES_PER_PERSON = 3;

export type GoalOutcome = 'yes' | 'partly' | 'no';

type IncrementItem = { id: string; iid: number; title: string; storyPoints: number | null; isStory: boolean };

export type RetroData = {
  projectId: string;
  sprint: SprintInfo;
  goalOutcome: GoalOutcome | null;
  reviewNotes: string;
  increment: {
    done: IncrementItem[];
    open: IncrementItem[];
    donePoints: number;
    plannedPoints: number;
    velocityAverage: number | null;
  };
  previousSprintName: string | null;
  previousActions: Array<{ id: string; text: string; issueIid: number | null; issueState: string | null }>;
  items: Array<{
    id: string;
    kind: RetroKind;
    text: string;
    author: string | null;
    own: boolean;
    votes: number;
    voted: boolean;
    issueIid: number | null;
  }>;
  votesLeft: number;
  nextSprint: SprintInfo | null;
};
