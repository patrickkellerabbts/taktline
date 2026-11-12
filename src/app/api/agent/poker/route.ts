import { prisma } from '@/lib/db';
import { REPORTER_ACCESS_LEVEL, checkAgentAccess, json } from '@/lib/agent/access';
import { isPokerCardValue, pokerStats, type PokerCardValue } from '@/lib/agile/poker';

// Planning-Poker-Runden für Agenten, nur lesend. Wie in der Web-App gilt:
// Solange eine Runde verdeckt ist, sieht man nur, wer schon gelegt hat, nicht
// welche Karte. Schätzen ist Sache des Teams.

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const access = await checkAgentAccess(request, params.get('project'), REPORTER_ACCESS_LEVEL);
  if (access instanceof Response) return access;
  const storyIid = params.get('story') ? Number(params.get('story')) : null;
  if (storyIid !== null && (!Number.isInteger(storyIid) || storyIid < 1)) return json({ error: 'story muss eine Issue-Nummer sein' }, 400);

  const rounds = await prisma.estimationRound.findMany({
    where: {
      projectId: access.projectId,
      workPackage: { deletedAt: null, ...(storyIid ? { gitlabIssueIid: storyIid } : {}) },
    },
    orderBy: [{ workPackage: { gitlabIssueIid: 'asc' } }, { number: 'asc' }],
    select: {
      number: true,
      createdAt: true,
      revealedAt: true,
      result: true,
      adoptedAt: true,
      workPackage: { select: { gitlabIssueIid: true, titleCache: true, storyPoints: true } },
      votes: { select: { value: true, user: { select: { username: true } } } },
    },
  });

  return json({
    project: access.projectPath,
    rounds: rounds.map((r) => {
      const revealed = r.revealedAt !== null;
      const values = r.votes.map((v) => v.value).filter(isPokerCardValue) as PokerCardValue[];
      return {
        story: { iid: r.workPackage.gitlabIssueIid, title: r.workPackage.titleCache, points: r.workPackage.storyPoints },
        round: r.number,
        started: r.createdAt.toISOString(),
        state: r.adoptedAt ? 'adopted' : revealed ? 'revealed' : 'open',
        result: r.result,
        players: r.votes.map((v) => v.user.username),
        ...(revealed
          ? {
              votes: r.votes.map((v) => ({ username: v.user.username, value: v.value })),
              stats: pokerStats(values),
            }
          : {}),
      };
    }),
  });
}
