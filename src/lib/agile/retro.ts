// Sprint Review und Retrospektive eines Sprints laden.
import { prisma } from '@/lib/db';
import { loadProjectBoard } from './load-board';
import { computeVelocity } from './velocity';
import { RETRO_VOTES_PER_PERSON, type RetroData, type RetroKind } from './retro-shared';

function isKind(value: string): value is RetroKind {
  return value === 'good' || value === 'improve' || value === 'action';
}

export async function loadRetro(projectId: string, sprintNumber: number, viewerId: string): Promise<RetroData | null> {
  const board = await loadProjectBoard(projectId);
  if (!board) return null;
  const sprint = board.sprints.find((s) => s.number === sprintNumber);
  if (!sprint) return null;
  const row = await prisma.sprint.findUnique({
    where: { id: sprint.id },
    select: {
      goalOutcome: true,
      reviewNotes: true,
      retroItems: {
        orderBy: { createdAt: 'asc' },
        include: {
          author: { select: { name: true, username: true } },
          votes: { select: { userId: true } },
        },
      },
    },
  });
  if (!row) return null;

  const cards = board.cards.filter((c) => c.sprintNumber === sprint.number);
  const done = cards.filter((c) => c.column === 'done');
  const pointsOf = (list: typeof cards) => list.reduce((sum, c) => sum + (c.storyPoints ?? 0), 0);

  // Massnahmen der letzten Retro: Wurden sie umgesetzt?
  const previous = board.sprints.filter((s) => s.number < sprint.number).at(-1);
  const previousActions = previous
    ? await prisma.sprintRetroItem.findMany({
        where: { sprintId: previous.id, kind: 'action' },
        orderBy: { createdAt: 'asc' },
        select: { id: true, text: true, issueIid: true },
      })
    : [];
  const issueStates = new Map(
    (
      await prisma.workPackage.findMany({
        where: { projectId, gitlabIssueIid: { in: previousActions.flatMap((a) => (a.issueIid ? [a.issueIid] : [])) } },
        select: { gitlabIssueIid: true, stateCache: true },
      })
    ).map((w) => [w.gitlabIssueIid, w.stateCache]),
  );

  const myVotes = row.retroItems.reduce((n, item) => n + (item.votes.some((v) => v.userId === viewerId) ? 1 : 0), 0);

  return {
    projectId,
    sprint,
    goalOutcome: row.goalOutcome === 'yes' || row.goalOutcome === 'partly' || row.goalOutcome === 'no' ? row.goalOutcome : null,
    reviewNotes: row.reviewNotes ?? '',
    increment: {
      done: done.map((c) => ({ id: c.id, iid: c.iid, title: c.title, storyPoints: c.storyPoints, isStory: c.isStory })),
      open: cards.filter((c) => c.column !== 'done').map((c) => ({ id: c.id, iid: c.iid, title: c.title, storyPoints: c.storyPoints, isStory: c.isStory })),
      donePoints: sprint.state === 'closed' ? (sprint.completedPoints ?? pointsOf(done)) : pointsOf(done),
      plannedPoints: pointsOf(cards),
      velocityAverage: computeVelocity(board.sprints.filter((s) => s.number < sprint.number)).average,
    },
    previousSprintName: previous?.name ?? null,
    previousActions: previousActions.map((a) => ({
      id: a.id,
      text: a.text,
      issueIid: a.issueIid,
      issueState: a.issueIid ? (issueStates.get(a.issueIid) ?? null) : null,
    })),
    items: row.retroItems
      .filter((i) => isKind(i.kind))
      .map((i) => ({
        id: i.id,
        kind: i.kind as RetroKind,
        text: i.text,
        author: i.author?.name ?? i.author?.username ?? null,
        own: i.authorId === viewerId,
        votes: i.votes.length,
        voted: i.votes.some((v) => v.userId === viewerId),
        issueIid: i.issueIid,
      })),
    votesLeft: Math.max(0, RETRO_VOTES_PER_PERSON - myVotes),
    nextSprint: board.sprints.find((s) => s.number > sprint.number && s.state !== 'closed') ?? null,
  };
}
