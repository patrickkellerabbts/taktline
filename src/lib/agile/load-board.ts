import { prisma } from '@/lib/db';
import type { BoardCard, BoardPerson } from '@/components/board/BoardView';
import { stripGanttMeta } from '@/lib/gitlab/meta';
import { columnForIssue, isReservedLabel, isStory, labelNames } from './board';
import { parseStoryDescription } from './story';

// `guest` = Lese-Link: Avatare enthalten URLs der GitLab-Instanz.
export async function loadProjectBoard(projectId: string, audience: 'member' | 'guest' = 'member') {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      nameCache: true,
      labels: { orderBy: { name: 'asc' }, select: { name: true, color: true } },
      workPackages: {
        // Summary-Tasks sind Container im Gantt, keine Arbeit auf dem Board.
        where: { deletedAt: null, isSummary: false },
        // Noch nie einsortierte Karten stehen am Ende, nach Issue-Nummer.
        orderBy: [{ boardRank: { sort: 'asc', nulls: 'last' } }, { gitlabIssueIid: 'asc' }],
        select: {
          id: true,
          gitlabIssueIid: true,
          titleCache: true,
          descriptionCache: true,
          stateCache: true,
          labelsCache: true,
          assigneesCache: true,
          startDate: true,
          endDate: true,
          isUnscheduled: true,
          storyPoints: true,
        },
      },
    },
  });
  if (!project) return null;

  const labelColors = new Map(project.labels.map((l) => [l.name, l.color ?? undefined]));

  const cards: BoardCard[] = project.workPackages.map((wp) => {
    const names = labelNames(wp.labelsCache);
    const story = isStory(names);
    const fields = parseStoryDescription(stripGanttMeta(wp.descriptionCache));
    return {
      id: wp.id,
      iid: wp.gitlabIssueIid,
      title: wp.titleCache,
      column: columnForIssue(wp.stateCache, names),
      isStory: story,
      storyPoints: wp.storyPoints,
      labels: names
        .filter((n) => !isReservedLabel(n))
        .map((name) => ({ name, color: labelColors.get(name) })),
      assignees: parsePeople(wp.assigneesCache).map((a) =>
        audience === 'guest' ? { ...a, avatarUrl: undefined } : a,
      ),
      startDate: wp.isUnscheduled ? null : wp.startDate.toISOString().slice(0, 10),
      endDate: wp.isUnscheduled ? null : wp.endDate.toISOString().slice(0, 10),
      story: story ? fields : null,
    };
  });

  return {
    id: project.id,
    name: project.nameCache,
    labels: project.labels,
    cards,
  };
}

/** Auswahl für die Zuweisung im Story-Dialog; nur für angemeldete Nutzer. */
export async function loadBoardPeople(cards: BoardCard[]): Promise<BoardPerson[]> {
  // GitLab-Mitglieder liegen nicht lokal; zur Auswahl stehen alle, die im
  // Projekt schon zugewiesen waren, plus alle in Taktline angemeldeten Nutzer.
  const users = await prisma.user.findMany({
    select: { gitlabUserId: true, username: true, name: true, avatarUrl: true },
  });
  const people = new Map<number, BoardPerson>();
  for (const card of cards) for (const a of card.assignees) people.set(a.id, a);
  for (const u of users) {
    if (people.has(u.gitlabUserId) || !u.username) continue;
    people.set(u.gitlabUserId, {
      id: u.gitlabUserId,
      username: u.username,
      name: u.name ?? u.username,
      avatarUrl: u.avatarUrl ?? undefined,
    });
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function parsePeople(cache: unknown): BoardPerson[] {
  if (!Array.isArray(cache)) return [];
  return cache.flatMap((entry): BoardPerson[] => {
    const o = entry as { id?: unknown; username?: unknown; name?: unknown; avatarUrl?: unknown };
    if (typeof o?.id !== 'number' || typeof o.username !== 'string') return [];
    return [
      {
        id: o.id,
        username: o.username,
        name: typeof o.name === 'string' ? o.name : o.username,
        avatarUrl: typeof o.avatarUrl === 'string' ? o.avatarUrl : undefined,
      },
    ];
  });
}
