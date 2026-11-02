// Kanban-Board: Spalten und Story-Kennzeichnung leben als Labels in GitLab,
// "Done" ist der Issue-Status. Dadurch stimmen Gantt und Burndown automatisch
// und dieselben Spalten lassen sich auch als GitLab-Board anlegen.
//
// GitLab CE kennt keine exklusiven Scoped Labels: ein Issue kann dort mehrere
// board::-Labels tragen. columnForIssue() entscheidet das deterministisch, und
// jede Verschiebung auf dem Board räumt die überzähligen Labels wieder ab.

export const STORY_LABEL = 'type::story';
const BOARD_LABEL_PREFIX = 'board::';

export const BOARD_COLUMNS = [
  { id: 'backlog', title: 'Backlog', label: null },
  { id: 'todo', title: 'To Do', label: 'board::todo' },
  { id: 'doing', title: 'In Arbeit', label: 'board::doing' },
  { id: 'review', title: 'Review', label: 'board::review' },
  { id: 'done', title: 'Done', label: null },
] as const;

export type BoardColumnId = (typeof BOARD_COLUMNS)[number]['id'];

export function isBoardColumnId(value: unknown): value is BoardColumnId {
  return BOARD_COLUMNS.some((c) => c.id === value);
}

/** Namen aus labelsCache (historisch Strings oder Objekte mit `name`). */
export function labelNames(cache: unknown): string[] {
  if (!Array.isArray(cache)) return [];
  return cache.flatMap((entry): string[] => {
    if (typeof entry === 'string') return [entry];
    if (entry && typeof entry === 'object') {
      const { name, title } = entry as { name?: unknown; title?: unknown };
      if (typeof name === 'string') return [name];
      if (typeof title === 'string') return [title];
    }
    return [];
  });
}

export function isStory(names: readonly string[]): boolean {
  return names.includes(STORY_LABEL);
}

/** Labels, die das Board selbst verwaltet und die Nutzer nicht direkt wählen. */
export function isReservedLabel(name: string): boolean {
  return name === STORY_LABEL || name.startsWith(BOARD_LABEL_PREFIX);
}

export function columnForIssue(state: string, names: readonly string[]): BoardColumnId {
  if (state === 'closed') return 'done';
  // Bei mehreren Spalten-Labels gewinnt die am weitesten fortgeschrittene.
  for (const column of [...BOARD_COLUMNS].reverse()) {
    if (column.label && names.includes(column.label)) return column.id;
  }
  return 'backlog';
}

/** Label-Änderung für eine Verschiebung; andere Labels bleiben unberührt. */
export function planColumnLabels(
  names: readonly string[],
  target: BoardColumnId,
): { add: string[]; remove: string[] } {
  const targetLabel = BOARD_COLUMNS.find((c) => c.id === target)?.label ?? null;
  return {
    add: targetLabel && !names.includes(targetLabel) ? [targetLabel] : [],
    remove: names.filter((n) => n.startsWith(BOARD_LABEL_PREFIX) && n !== targetLabel),
  };
}

/**
 * Eine Story ohne eigenes Datum hat im Gantt nichts zu suchen: Start und Ende
 * wären nur der Sync-Fallback (Erstelldatum + 14 Tage). Normale Issues behalten
 * dieses Verhalten, nur Stories werden bis zur Terminierung ausgeblendet.
 */
export function isUnscheduledStory(input: {
  labels: readonly string[];
  metaStartDate?: string | null;
  dueDate?: string | null;
}): boolean {
  return isStory(input.labels) && !input.metaStartDate && !input.dueDate;
}

/**
 * Prisma-Filter für alles, was mit echten Terminen rechnet. Summary-Tasks
 * bleiben drin, weil ihre Kinder sonst im Gantt ohne Parent dastünden.
 */
export const SCHEDULED_WORK_PACKAGE = {
  OR: [{ isUnscheduled: false }, { isSummary: true }],
};
