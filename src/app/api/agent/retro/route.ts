import { REPORTER_ACCESS_LEVEL, checkAgentAccess, json } from '@/lib/agent/access';
import { loadRetro } from '@/lib/agile/retro';

// Sprint Review und Retrospektive eines Sprints, nur lesend: Retro-Karten und
// Punkte sind Sache des Teams, Agenten werten sie höchstens aus. Wer welche
// Punkte vergeben hat, bleibt wie in der Web-App verborgen.

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const access = await checkAgentAccess(request, params.get('project'), REPORTER_ACCESS_LEVEL);
  if (access instanceof Response) return access;
  const number = Number(params.get('sprint'));
  if (!Number.isInteger(number) || number < 1) return json({ error: 'Parameter sprint (Nummer) fehlt' }, 400);

  const retro = await loadRetro(access.projectId, number, '');
  if (!retro) return json({ error: `Sprint ${number} gibt es in diesem Projekt nicht` }, 404);

  const item = (i: (typeof retro.items)[number]) => ({
    text: i.text,
    author: i.author,
    votes: i.votes,
    ...(i.issueIid ? { issue: i.issueIid } : {}),
  });
  const byVotes = (kind: string) =>
    retro.items
      .filter((i) => i.kind === kind)
      .sort((a, b) => b.votes - a.votes)
      .map(item);

  return json({
    project: access.projectPath,
    sprint: { number: retro.sprint.number, name: retro.sprint.name, goal: retro.sprint.goal, state: retro.sprint.state },
    review: {
      goalOutcome: retro.goalOutcome,
      notes: retro.reviewNotes || null,
      done: retro.increment.done.map((i) => ({ iid: i.iid, title: i.title, points: i.storyPoints })),
      open: retro.increment.open.map((i) => ({ iid: i.iid, title: i.title, points: i.storyPoints })),
      donePoints: retro.increment.donePoints,
      plannedPoints: retro.increment.plannedPoints,
      velocityAverage: retro.increment.velocityAverage,
    },
    retro: {
      good: byVotes('good'),
      improve: byVotes('improve'),
      actions: byVotes('action'),
    },
    previousActions: retro.previousSprintName
      ? {
          sprint: retro.previousSprintName,
          items: retro.previousActions.map((a) => ({ text: a.text, issue: a.issueIid, issueState: a.issueState })),
        }
      : null,
  });
}
