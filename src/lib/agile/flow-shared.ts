// Kanban-Fluss: WIP-Limits und Cumulative Flow. Ohne Server-Abhängigkeiten.
import { BOARD_COLUMNS, type BoardColumnId } from './board';

export type WipLimits = Partial<Record<BoardColumnId, number>>;
export type ColumnCounts = Record<BoardColumnId, number>;

/** Spalten, für die ein Limit Sinn ergibt: Backlog und Done wachsen beliebig. */
export const WIP_COLUMNS: BoardColumnId[] = ['todo', 'doing', 'review'];

export function parseWipLimits(value: unknown): WipLimits {
  if (!value || typeof value !== 'object') return {};
  const out: WipLimits = {};
  for (const id of WIP_COLUMNS) {
    const n = (value as Record<string, unknown>)[id];
    if (typeof n === 'number' && Number.isInteger(n) && n > 0) out[id] = n;
  }
  return out;
}

export function emptyCounts(): ColumnCounts {
  return Object.fromEntries(BOARD_COLUMNS.map((c) => [c.id, 0])) as ColumnCounts;
}

export function parseCounts(value: unknown): ColumnCounts {
  const out = emptyCounts();
  if (value && typeof value === 'object') {
    for (const c of BOARD_COLUMNS) {
      const n = (value as Record<string, unknown>)[c.id];
      if (typeof n === 'number' && n >= 0) out[c.id] = n;
    }
  }
  return out;
}

export type FlowDay = { date: string; counts: ColumnCounts };
