// Planning Poker: Deck und Auswertung. Ohne Server-Abhängigkeiten, damit
// Browser und Server dieselben Regeln benutzen.

export type PokerCardValue =
  | '0'
  | '0.5'
  | '1'
  | '2'
  | '3'
  | '5'
  | '8'
  | '13'
  | '20'
  | '40'
  | '100'
  | '?'
  | 'coffee';

export type PokerCardDef = {
  value: PokerCardValue;
  /** Was auf der Karte steht. */
  face: string;
  /** Kleiner Untertitel, damit die Karte etwas erzählt. */
  caption: string;
  /** Zahlenwert für die Auswertung; null bei "?" und Kaffee. */
  points: number | null;
};

// Modifiziertes Fibonacci, wie es im Agile-Unterricht üblich ist.
export const POKER_DECK: readonly PokerCardDef[] = [
  { value: '0', face: '0', caption: 'schon erledigt', points: 0 },
  { value: '0.5', face: '½', caption: 'ein Klacks', points: 0.5 },
  { value: '1', face: '1', caption: 'winzig', points: 1 },
  { value: '2', face: '2', caption: 'klein', points: 2 },
  { value: '3', face: '3', caption: 'machbar', points: 3 },
  { value: '5', face: '5', caption: 'mittel', points: 5 },
  { value: '8', face: '8', caption: 'gross', points: 8 },
  { value: '13', face: '13', caption: 'sehr gross', points: 13 },
  { value: '20', face: '20', caption: 'aufteilen?', points: 20 },
  { value: '40', face: '40', caption: 'eher ein Epic', points: 40 },
  { value: '100', face: '100', caption: 'Mond\u00adlandung', points: 100 },
  { value: '?', face: '?', caption: 'keine Ahnung', points: null },
  { value: 'coffee', face: '☕', caption: 'Pause, bitte', points: null },
];

const BY_VALUE = new Map(POKER_DECK.map((c) => [c.value, c]));

export function isPokerCardValue(value: string): value is PokerCardValue {
  return BY_VALUE.has(value as PokerCardValue);
}

export function pokerCard(value: PokerCardValue): PokerCardDef {
  return BY_VALUE.get(value) as PokerCardDef;
}

/**
 * Story Points sind im gantt-meta-Block ganze Zahlen (AGENTS.md). Diese Karten
 * lassen sich deshalb direkt übernehmen; ½ wird beim Übernehmen zu 1.
 */
export const ADOPTABLE_POINTS = [0, 1, 2, 3, 5, 8, 13, 20, 40, 100] as const;

export type PokerStats = {
  /** Abgegebene Karten mit Zahlenwert. */
  numeric: number;
  min: number | null;
  max: number | null;
  average: number | null;
  median: number | null;
  /** Alle Zahlenkarten gleich und mindestens zwei davon. */
  consensus: boolean;
  /** Vorschlag zum Übernehmen: der Median, auf die nächste Deck-Zahl gerundet. */
  suggestion: number | null;
  questionMarks: number;
  coffee: number;
};

export function nearestAdoptable(points: number): number {
  let best: number = ADOPTABLE_POINTS[0];
  for (const candidate of ADOPTABLE_POINTS) {
    // Bei Gleichstand gewinnt die grössere Zahl: lieber vorsichtig schätzen.
    if (Math.abs(candidate - points) <= Math.abs(best - points)) best = candidate;
  }
  return best;
}

export function pokerStats(values: PokerCardValue[]): PokerStats {
  const numbers = values
    .map((v) => pokerCard(v).points)
    .filter((p): p is number => p !== null)
    .sort((a, b) => a - b);
  const count = numbers.length;
  const middle = Math.floor(count / 2);
  const median = count === 0 ? null : count % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
  return {
    numeric: count,
    min: count ? numbers[0] : null,
    max: count ? numbers[count - 1] : null,
    average: count ? numbers.reduce((a, b) => a + b, 0) / count : null,
    median,
    consensus: count >= 2 && numbers[0] === numbers[count - 1],
    suggestion: median === null ? null : nearestAdoptable(median),
    questionMarks: values.filter((v) => v === '?').length,
    coffee: values.filter((v) => v === 'coffee').length,
  };
}

// ─── Zustand, wie ihn der Browser per Polling bekommt ───────────────────────

export type PokerPlayer = {
  userId: string;
  name: string;
  avatarUrl: string | null;
};

export type PokerSeat = PokerPlayer & {
  /** Nur gesetzt, wenn aufgedeckt ist oder es die eigene Karte ist. */
  value: PokerCardValue | null;
  voted: boolean;
  /** Gerade auf der Seite (Polling der letzten Sekunden). */
  present: boolean;
};

export type PokerStorySummary = {
  id: string;
  iid: number;
  title: string;
  storyPoints: number | null;
  sprintNumber: number | null;
  column: string;
  /** Aktuelle Runde: wie viele Karten liegen, ob aufgedeckt. */
  round: { number: number; votes: number; revealed: boolean; adopted: boolean; myVote: boolean } | null;
};

export type PokerRoundView = {
  id: string;
  number: number;
  revealed: boolean;
  result: number | null;
  seats: PokerSeat[];
  myVote: PokerCardValue | null;
  stats: PokerStats | null;
};

export type PokerStoryDetail = {
  id: string;
  iid: number;
  title: string;
  storyPoints: number | null;
  role: string;
  goal: string;
  benefit: string;
  criteria: Array<{ text: string; done: boolean }>;
  notes: string;
  round: PokerRoundView | null;
  /** Ergebnisse früherer Runden, neueste zuerst. */
  history: Array<{ number: number; values: PokerCardValue[]; result: number | null }>;
};

export type PokerState = {
  stories: PokerStorySummary[];
  selected: PokerStoryDetail | null;
  /** Wer gerade am Tisch sitzt, unabhängig von der Story. */
  present: PokerPlayer[];
};
