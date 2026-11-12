import { z } from 'zod';
import { prisma } from '@/lib/db';
import { DEVELOPER_ACCESS_LEVEL, REPORTER_ACCESS_LEVEL, checkAgentAccess, json } from '@/lib/agent/access';
import { loadCommitments } from '@/lib/agile/commitments';
import { computeVelocity } from '@/lib/agile/velocity';
import { loadProjectSprints } from '@/lib/agile/sprints';
import { parseWipLimits } from '@/lib/agile/flow-shared';
import { setDefinitionOfDone, setProductGoal, setWipLimit } from '@/lib/agile/frame-ops';

// Scrum-Rahmen eines Projekts für Agenten: Product Goal, Definition of Done,
// WIP-Limits, Velocity und Meilensteine. Liegt (bis auf die Meilensteine) nur
// in der Taktline-DB. Schreiben braucht die Developer-Rolle.

function isoDay(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export async function GET(request: Request) {
  const access = await checkAgentAccess(request, new URL(request.url).searchParams.get('project'), REPORTER_ACCESS_LEVEL);
  if (access instanceof Response) return access;

  const [commitments, sprints, project, milestones] = await Promise.all([
    loadCommitments(access.projectId),
    loadProjectSprints(access.projectId),
    prisma.project.findUnique({ where: { id: access.projectId }, select: { nameCache: true, wipLimits: true } }),
    prisma.milestone.findMany({
      where: { projectId: access.projectId },
      orderBy: { dueDateCache: 'asc' },
      select: { gitlabMilestoneId: true, titleCache: true, dueDateCache: true, stateCache: true, _count: { select: { workPackages: true } } },
    }),
  ]);
  if (!commitments || !project) return json({ error: 'Projekt nicht gefunden' }, 404);
  const velocity = computeVelocity(sprints);

  return json({
    project: access.projectPath,
    name: project.nameCache,
    productGoal: commitments.productGoal,
    definitionOfDone: commitments.definitionOfDone,
    wipLimits: parseWipLimits(project.wipLimits),
    velocity: {
      average: velocity.average === null ? null : Math.round(velocity.average * 10) / 10,
      sprints: velocity.sprints,
    },
    milestones: milestones.map((m) => ({
      id: m.gitlabMilestoneId,
      title: m.titleCache,
      due: isoDay(m.dueDateCache),
      state: m.stateCache,
      workPackages: m._count.workPackages,
    })),
  });
}

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('goal'), project: z.string().min(1), goal: z.string() }),
  z.object({ action: z.literal('dod'), project: z.string().min(1), items: z.array(z.string()) }),
  z.object({
    action: z.literal('wip'),
    project: z.string().min(1),
    column: z.enum(['todo', 'doing', 'review']),
    limit: z.number().int().nullable(),
  }),
]);

export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return json({ error: `${issue.path.join('.') || 'body'}: ${issue.message}` }, 400);
  }
  const body = parsed.data;
  const access = await checkAgentAccess(request, body.project, DEVELOPER_ACCESS_LEVEL);
  if (access instanceof Response) return access;
  const actor = { userId: null, agent: access.agentUsername };

  const result =
    body.action === 'goal'
      ? await setProductGoal(actor, access.projectId, body.goal)
      : body.action === 'dod'
        ? await setDefinitionOfDone(actor, access.projectId, body.items)
        : await setWipLimit(actor, access.projectId, body.column, body.limit);
  if (!result.ok) return json({ error: result.error }, 409);
  return json({ project: access.projectPath, action: body.action, changed: result.changed });
}
