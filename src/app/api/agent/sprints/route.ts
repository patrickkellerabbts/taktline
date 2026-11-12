import { z } from 'zod';
import { prisma } from '@/lib/db';
import {
  DEVELOPER_ACCESS_LEVEL,
  REPORTER_ACCESS_LEVEL,
  checkAgentAccess,
  json,
  type AgentAccess,
} from '@/lib/agent/access';
import { loadProjectBoard } from '@/lib/agile/load-board';
import {
  closeSprint,
  createSprint,
  deleteSprint,
  saveReview,
  startSprint,
  updateSprint,
  type Actor,
  type OpResult,
} from '@/lib/agile/sprint-ops';

// Sprints für Agenten (Taktline-CLI). Sprints liegen in der Taktline-DB, nicht
// in GitLab; nur die Zuordnung steht als Label `sprint::<nr>` am Issue. Die
// Regeln sind dieselben wie in der Web-App (lib/agile/sprint-ops.ts).

function actorFor(access: AgentAccess): Actor {
  return { userId: null, agent: access.agentUsername, gitlab: async () => access.client };
}

export async function GET(request: Request) {
  const access = await checkAgentAccess(request, new URL(request.url).searchParams.get('project'), REPORTER_ACCESS_LEVEL);
  if (access instanceof Response) return access;

  const board = await loadProjectBoard(access.projectId, 'guest');
  if (!board) return json({ error: 'Projekt nicht gefunden' }, 404);
  const reviews = new Map(
    (
      await prisma.sprint.findMany({
        where: { projectId: access.projectId },
        select: { number: true, goalOutcome: true, reviewNotes: true },
      })
    ).map((s) => [s.number, s]),
  );

  return json({
    project: access.projectPath,
    sprints: board.sprints.map((s) => {
      const cards = board.cards.filter((c) => c.sprintNumber === s.number);
      const done = cards.filter((c) => c.column === 'done');
      const points = (list: typeof cards) => list.reduce((sum, c) => sum + (c.storyPoints ?? 0), 0);
      const review = reviews.get(s.number);
      return {
        number: s.number,
        name: s.name,
        goal: s.goal,
        start: s.startDate,
        end: s.endDate,
        state: s.state,
        items: cards.length,
        points: points(cards),
        done: s.state === 'closed' ? s.completedCount : done.length,
        donePoints: s.state === 'closed' ? s.completedPoints : points(done),
        goalOutcome: review?.goalOutcome ?? null,
        reviewNotes: review?.reviewNotes ?? null,
      };
    }),
  });
}

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT');

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    project: z.string().min(1),
    name: z.string(),
    goal: z.string().optional(),
    start: DateString,
    end: DateString,
  }),
  z.object({
    action: z.literal('update'),
    project: z.string().min(1),
    number: z.number().int().positive(),
    name: z.string().optional(),
    goal: z.string().nullable().optional(),
    start: DateString.optional(),
    end: DateString.optional(),
  }),
  z.object({ action: z.literal('start'), project: z.string().min(1), number: z.number().int().positive() }),
  z.object({ action: z.literal('delete'), project: z.string().min(1), number: z.number().int().positive() }),
  z.object({
    action: z.literal('close'),
    project: z.string().min(1),
    number: z.number().int().positive(),
    // Bewusst ohne Standard: Wohin Unerledigtes wandert, entscheidet der Aufrufer.
    carryOverTo: z.union([z.number().int().positive(), z.literal('backlog')]),
  }),
  z.object({
    action: z.literal('review'),
    project: z.string().min(1),
    number: z.number().int().positive(),
    goalOutcome: z.enum(['yes', 'partly', 'no']).nullable().optional(),
    reviewNotes: z.string().optional(),
  }),
]);

function respond(result: OpResult<object>, extra: object = {}) {
  if (!result.ok) return json({ error: result.error }, 409);
  return json({ ...result, ok: undefined, changed: true, ...extra });
}

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return json({ error: `${issue.path.join('.') || 'body'}: ${issue.message}` }, 400);
  }
  const body = parsed.data;

  const access = await checkAgentAccess(request, body.project, DEVELOPER_ACCESS_LEVEL);
  if (access instanceof Response) return access;
  const actor = actorFor(access);
  const project = access.projectPath;

  if (body.action === 'create') {
    const result = await createSprint(actor, access.projectId, {
      name: body.name,
      goal: body.goal ?? '',
      startDate: body.start,
      endDate: body.end,
    });
    return respond(result, { project });
  }

  const sprint = await prisma.sprint.findUnique({
    where: { projectId_number: { projectId: access.projectId, number: body.number } },
    select: { id: true, name: true, goal: true, startDate: true, endDate: true, goalOutcome: true, reviewNotes: true },
  });
  if (!sprint) return json({ error: `Sprint ${body.number} gibt es in diesem Projekt nicht` }, 404);

  switch (body.action) {
    case 'update':
      // Nur die genannten Felder ändern, der Rest bleibt.
      return respond(
        await updateSprint(actor, sprint.id, {
          name: body.name ?? sprint.name,
          goal: body.goal === undefined ? (sprint.goal ?? '') : (body.goal ?? ''),
          startDate: body.start ?? sprint.startDate.toISOString().slice(0, 10),
          endDate: body.end ?? sprint.endDate.toISOString().slice(0, 10),
        }),
        { project, number: body.number },
      );
    case 'start':
      return respond(await startSprint(actor, sprint.id), { project, number: body.number });
    case 'delete':
      return respond(await deleteSprint(actor, sprint.id), { project, number: body.number });
    case 'close':
      return respond(await closeSprint(actor, sprint.id, body.carryOverTo === 'backlog' ? null : body.carryOverTo), {
        project,
        number: body.number,
        carryOverTo: body.carryOverTo,
      });
    case 'review': {
      const outcome = body.goalOutcome === undefined ? sprint.goalOutcome : body.goalOutcome;
      return respond(
        await saveReview(actor, sprint.id, {
          goalOutcome: outcome === 'yes' || outcome === 'partly' || outcome === 'no' ? outcome : null,
          reviewNotes: body.reviewNotes ?? sprint.reviewNotes ?? '',
        }),
        { project, number: body.number },
      );
    }
  }
}
