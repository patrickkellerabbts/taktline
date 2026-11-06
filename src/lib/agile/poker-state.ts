// Serverseite von Planning Poker: Zustand laden und Anwesenheit merken.
import { prisma } from '@/lib/db';
import { loadProjectBoard } from './load-board';
import {
  isPokerCardValue,
  pokerStats,
  type PokerCardValue,
  type PokerPlayer,
  type PokerRoundView,
  type PokerState,
  type PokerStoryDetail,
} from './poker';

// ─── Anwesenheit ────────────────────────────────────────────────────────────
// Bewusst nur im Speicher: Sie zeigt, wer gerade mitschaut, und darf bei einem
// Neustart verloren gehen. Taktline läuft als eine Instanz.

const PRESENCE_TTL_MS = 10_000;
type Presence = PokerPlayer & { seenAt: number; storyId: string | null };
const presence = new Map<string, Map<string, Presence>>();

export function touchPresence(projectId: string, player: PokerPlayer, storyId: string | null) {
  let room = presence.get(projectId);
  if (!room) {
    room = new Map();
    presence.set(projectId, room);
  }
  room.set(player.userId, { ...player, seenAt: Date.now(), storyId });
}

function presentPlayers(projectId: string): Presence[] {
  const room = presence.get(projectId);
  if (!room) return [];
  const now = Date.now();
  const players: Presence[] = [];
  for (const [userId, p] of room) {
    if (now - p.seenAt > PRESENCE_TTL_MS) room.delete(userId);
    else players.push(p);
  }
  return players.sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Zustand ────────────────────────────────────────────────────────────────

function asValue(value: string): PokerCardValue | null {
  return isPokerCardValue(value) ? value : null;
}

/**
 * Liefert alles, was die Poker-Seite braucht. Fremde Karten verlassen den
 * Server erst nach dem Aufdecken, sonst könnte man im Netzwerk-Tab spicken.
 */
export async function loadPokerState(
  projectId: string,
  viewerId: string,
  selectedId: string | null,
): Promise<PokerState | null> {
  const board = await loadProjectBoard(projectId);
  if (!board) return null;

  // Erledigte Stories schätzt niemand mehr.
  const storyCards = board.cards.filter((c) => c.isStory && c.column !== 'done');
  const ids = storyCards.map((c) => c.id);

  // Pro Story nur die neueste Runde.
  const rounds = await prisma.estimationRound.findMany({
    where: { workPackageId: { in: ids } },
    orderBy: { number: 'desc' },
    distinct: ['workPackageId'],
    select: {
      id: true,
      workPackageId: true,
      number: true,
      revealedAt: true,
      result: true,
      votes: { select: { userId: true } },
    },
  });
  const roundByStory = new Map(rounds.map((r) => [r.workPackageId, r]));

  const stories = storyCards.map((c) => {
    const r = roundByStory.get(c.id);
    return {
      id: c.id,
      iid: c.iid,
      title: c.title,
      storyPoints: c.storyPoints,
      sprintNumber: c.sprintNumber,
      column: c.column,
      round: r
        ? {
            number: r.number,
            votes: r.votes.length,
            revealed: r.revealedAt !== null,
            adopted: r.result !== null,
            myVote: r.votes.some((v) => v.userId === viewerId),
          }
        : null,
    };
  });

  const present = presentPlayers(projectId);
  const card = selectedId ? storyCards.find((c) => c.id === selectedId) : undefined;
  let selected: PokerStoryDetail | null = null;

  if (card) {
    const all = await prisma.estimationRound.findMany({
      where: { workPackageId: card.id },
      orderBy: { number: 'desc' },
      include: {
        votes: {
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { id: true, name: true, username: true, avatarUrl: true } } },
        },
      },
    });
    const [current, ...older] = all;

    let round: PokerRoundView | null = null;
    if (current) {
      const revealed = current.revealedAt !== null;
      const seats = current.votes.map((v) => ({
        userId: v.user.id,
        name: v.user.name ?? v.user.username ?? 'Unbekannt',
        avatarUrl: v.user.avatarUrl,
        voted: true,
        value: revealed || v.userId === viewerId ? asValue(v.value) : null,
        present: present.some((p) => p.userId === v.userId),
      }));
      // Wer zuschaut, aber noch nicht gelegt hat, sitzt mit leerem Platz am Tisch.
      for (const p of present) {
        if (p.storyId !== card.id || seats.some((s) => s.userId === p.userId)) continue;
        seats.push({ userId: p.userId, name: p.name, avatarUrl: p.avatarUrl, voted: false, value: null, present: true });
      }
      const values = current.votes.map((v) => asValue(v.value)).filter((v): v is PokerCardValue => v !== null);
      round = {
        id: current.id,
        number: current.number,
        revealed,
        result: current.result,
        seats,
        myVote: asValue(current.votes.find((v) => v.userId === viewerId)?.value ?? ''),
        stats: revealed ? pokerStats(values) : null,
      };
    }

    const story = card.story ?? { role: '', goal: '', benefit: '', criteria: [], notes: '' };
    selected = {
      id: card.id,
      iid: card.iid,
      title: card.title,
      storyPoints: card.storyPoints,
      role: story.role,
      goal: story.goal,
      benefit: story.benefit,
      criteria: story.criteria,
      notes: story.notes,
      round,
      history: older
        .filter((r) => r.revealedAt !== null)
        .map((r) => ({
          number: r.number,
          values: r.votes.map((v) => asValue(v.value)).filter((v): v is PokerCardValue => v !== null),
          result: r.result,
        })),
    };
  }

  return {
    stories,
    selected,
    present: present.map((p) => ({ userId: p.userId, name: p.name, avatarUrl: p.avatarUrl })),
  };
}
