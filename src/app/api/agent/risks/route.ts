import { z } from 'zod';
import { prisma } from '@/lib/db';
import { DEVELOPER_ACCESS_LEVEL, REPORTER_ACCESS_LEVEL, checkAgentAccess, json } from '@/lib/agent/access';
import {
  VALID_STATUSES,
  createRisk,
  setRiskLinkedMilestones,
  setRiskLinkedWorkPackages,
  updateRisk,
  type RiskActor,
  type UpdateRiskInput,
} from '@/lib/risks/ops';

// Risikoregister für Agenten. Risiken liegen nur in der Taktline-DB. Agenten
// dürfen anlegen und bewerten (Developer-Rolle), aber nicht löschen; erledigte
// Risiken bekommen den Status closed. Jede Änderung steht im Risiko-Verlauf.

const SHORT_ID = 8;

function isoDay(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Volle ID oder eindeutiger Anfang (mind. 6 Zeichen), nur im eigenen Projekt. */
async function resolveRisk(projectId: string, ref: string): Promise<{ id: string } | Response> {
  if (!/^[0-9a-f-]{6,36}$/i.test(ref)) return json({ error: 'Risiko-ID: mindestens die ersten 6 Zeichen angeben' }, 400);
  const matches = await prisma.risk.findMany({
    where: { projectId, id: { startsWith: ref.toLowerCase() } },
    select: { id: true },
    take: 2,
  });
  if (matches.length === 0) return json({ error: `Kein Risiko ${ref} in diesem Projekt` }, 404);
  if (matches.length > 1) return json({ error: `${ref} ist nicht eindeutig, bitte mehr Zeichen angeben` }, 409);
  return matches[0];
}

async function historyNames(projectId: string) {
  const [users, wps, milestones] = await Promise.all([
    prisma.user.findMany({ select: { id: true, username: true } }),
    prisma.workPackage.findMany({ where: { projectId }, select: { id: true, gitlabIssueIid: true } }),
    prisma.milestone.findMany({ where: { projectId }, select: { id: true, gitlabMilestoneId: true } }),
  ]);
  return {
    users: new Map(users.map((u) => [u.id, u.username ?? u.id])),
    wps: new Map(wps.map((w) => [w.id, `#${w.gitlabIssueIid}`])),
    milestones: new Map(milestones.map((m) => [m.id, `Meilenstein ${m.gitlabMilestoneId}`])),
  };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const access = await checkAgentAccess(request, params.get('project'), REPORTER_ACCESS_LEVEL);
  if (access instanceof Response) return access;

  const ref = params.get('id');
  let only: string | null = null;
  if (ref) {
    const risk = await resolveRisk(access.projectId, ref);
    if (risk instanceof Response) return risk;
    only = risk.id;
  }

  const risks = await prisma.risk.findMany({
    where: { projectId: access.projectId, ...(only ? { id: only } : {}) },
    orderBy: { createdAt: 'asc' },
    include: {
      owner: { select: { username: true, name: true } },
      linkedWps: { select: { workPackage: { select: { gitlabIssueIid: true, titleCache: true } } } },
      linkedMs: { select: { milestone: { select: { gitlabMilestoneId: true, titleCache: true } } } },
    },
  });
  // Den Verlauf gibt es nur für ein einzelnes Risiko, sonst wird die Liste zu lang.
  const history = only
    ? await prisma.riskHistory.findMany({
        where: { riskId: only },
        orderBy: { createdAt: 'asc' },
        include: { user: { select: { username: true } } },
      })
    : null;
  // Im Verlauf stehen interne IDs; für Agenten in Usernamen, #IIDs und
  // Meilenstein-IDs übersetzen.
  const readable = history ? await historyNames(access.projectId) : null;
  const translate = (field: string, value: string | null): unknown => {
    if (value === null || !readable) return value;
    if (field === 'ownerUserId') return readable.users.get(value) ?? value;
    if (field === 'linkedWorkPackages' || field === 'linkedMilestones') {
      try {
        const ids = JSON.parse(value) as string[];
        const map = field === 'linkedWorkPackages' ? readable.wps : readable.milestones;
        return ids.map((id) => map.get(id) ?? id);
      } catch {
        return value;
      }
    }
    return value;
  };

  // Offene Risiken zuerst, darin die höchsten aktuellen Scores.
  const current = (r: (typeof risks)[number]) =>
    r.probabilityPost !== null && r.impactPost !== null ? r.probabilityPost * r.impactPost : r.probabilityPre * r.impactPre;
  risks.sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || current(b) - current(a));

  return json({
    project: access.projectPath,
    risks: risks.map((r) => ({
      id: r.id.slice(0, SHORT_ID),
      title: r.title,
      status: r.status,
      category: r.category,
      description: r.description,
      // Bewertung 1–5; Score = Wahrscheinlichkeit × Auswirkung (max. 25).
      before: { probability: r.probabilityPre, impact: r.impactPre, score: r.probabilityPre * r.impactPre },
      after:
        r.probabilityPost !== null && r.impactPost !== null
          ? { probability: r.probabilityPost, impact: r.impactPost, score: r.probabilityPost * r.impactPost }
          : null,
      mitigation: r.mitigationPlan,
      contingency: r.contingencyPlan,
      owner: r.owner ? { username: r.owner.username, name: r.owner.name } : null,
      identified: isoDay(r.identifiedAt),
      nextReview: isoDay(r.nextReviewAt),
      closed: isoDay(r.closedAt),
      workPackages: r.linkedWps.map((l) => ({ iid: l.workPackage.gitlabIssueIid, title: l.workPackage.titleCache })),
      milestones: r.linkedMs.map((l) => ({ id: l.milestone.gitlabMilestoneId, title: l.milestone.titleCache })),
      ...(history
        ? {
            history: history.map((h) => ({
              at: h.createdAt.toISOString(),
              by: h.agent ? `${h.agent} (Agent)` : (h.user?.username ?? null),
              field: h.field,
              from: translate(h.field, h.oldValue),
              to: translate(h.field, h.newValue),
            })),
          }
        : {}),
    })),
  });
}

const Score = z.number().int().min(1).max(5);
const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT');
const Fields = {
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  mitigation: z.string().nullable().optional(),
  contingency: z.string().nullable().optional(),
  /** Taktline-Username (wie in GitLab), null entfernt den Owner. */
  owner: z.string().nullable().optional(),
  nextReview: DateString.nullable().optional(),
  workPackages: z.array(z.number().int().positive()).optional(),
  milestones: z.array(z.number().int().positive()).optional(),
};

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), project: z.string().min(1), probability: Score, impact: Score, ...Fields, title: z.string().trim().min(1).max(300) }),
  z.object({
    action: z.literal('update'),
    project: z.string().min(1),
    id: z.string().min(6),
    status: z.enum(VALID_STATUSES as [string, ...string[]]).optional(),
    probability: Score.optional(),
    impact: Score.optional(),
    probabilityAfter: Score.nullable().optional(),
    impactAfter: Score.nullable().optional(),
    ...Fields,
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
  const actor: RiskActor = { userId: null, agent: access.agentUsername };

  // Owner, Pakete und Meilensteine vor dem Schreiben auflösen: Ein Tippfehler
  // soll nichts halb ändern.
  let ownerUserId: string | null | undefined;
  if (body.owner !== undefined) {
    if (body.owner === null) ownerUserId = null;
    else {
      const user = await prisma.user.findFirst({ where: { username: body.owner }, select: { id: true } });
      if (!user) return json({ error: `${body.owner} hat sich noch nie bei Taktline angemeldet und kann kein Owner sein` }, 409);
      ownerUserId = user.id;
    }
  }
  let wpIds: string[] | undefined;
  if (body.workPackages) {
    const wps = await prisma.workPackage.findMany({
      where: { projectId: access.projectId, gitlabIssueIid: { in: body.workPackages }, deletedAt: null },
      select: { id: true, gitlabIssueIid: true },
    });
    const missing = body.workPackages.filter((iid) => !wps.some((w) => w.gitlabIssueIid === iid));
    if (missing.length) return json({ error: `Unbekannte Issues: ${missing.map((i) => `#${i}`).join(', ')}` }, 409);
    wpIds = wps.map((w) => w.id);
  }
  let msIds: string[] | undefined;
  if (body.milestones) {
    const ms = await prisma.milestone.findMany({
      where: { projectId: access.projectId, gitlabMilestoneId: { in: body.milestones } },
      select: { id: true, gitlabMilestoneId: true },
    });
    const missing = body.milestones.filter((id) => !ms.some((m) => m.gitlabMilestoneId === id));
    if (missing.length) return json({ error: `Unbekannte Meilensteine: ${missing.join(', ')}` }, 409);
    msIds = ms.map((m) => m.id);
  }

  let riskId: string;
  const patch: UpdateRiskInput = {
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.category !== undefined ? { category: body.category } : {}),
    ...(body.mitigation !== undefined ? { mitigationPlan: body.mitigation } : {}),
    ...(body.contingency !== undefined ? { contingencyPlan: body.contingency } : {}),
    ...(ownerUserId !== undefined ? { ownerUserId } : {}),
    ...(body.nextReview !== undefined ? { nextReviewAt: body.nextReview } : {}),
  };

  if (body.action === 'create') {
    const created = await createRisk(actor, {
      projectId: access.projectId,
      title: body.title,
      description: body.description ?? undefined,
      category: body.category ?? undefined,
      probabilityPre: body.probability,
      impactPre: body.impact,
    });
    if (!created.ok) return json({ error: created.error }, 409);
    riskId = created.riskId;
    delete patch.description;
    delete patch.category;
  } else {
    const risk = await prisma.risk.findMany({
      where: { projectId: access.projectId, id: { startsWith: body.id.toLowerCase() } },
      select: { id: true },
      take: 2,
    });
    if (risk.length !== 1) {
      return json({ error: risk.length ? `${body.id} ist nicht eindeutig` : `Kein Risiko ${body.id} in diesem Projekt` }, risk.length ? 409 : 404);
    }
    riskId = risk[0].id;
    if (body.title !== undefined) patch.title = body.title;
    if (body.status !== undefined) patch.status = body.status as UpdateRiskInput['status'];
    if (body.probability !== undefined) patch.probabilityPre = body.probability;
    if (body.impact !== undefined) patch.impactPre = body.impact;
    if (body.probabilityAfter !== undefined) patch.probabilityPost = body.probabilityAfter;
    if (body.impactAfter !== undefined) patch.impactPost = body.impactAfter;
  }

  if (Object.keys(patch).length) {
    const updated = await updateRisk(actor, riskId, patch);
    if (!updated.ok) return json({ error: updated.error }, 409);
  }
  if (wpIds) await setRiskLinkedWorkPackages(actor, riskId, wpIds);
  if (msIds) await setRiskLinkedMilestones(actor, riskId, msIds);

  return json({ project: access.projectPath, action: body.action, id: riskId.slice(0, SHORT_ID), changed: true });
}
