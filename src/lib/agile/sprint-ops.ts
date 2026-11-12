// Sprint-Logik für Web-App und Agenten-API. Wer handelt, steckt im `Actor`:
// in der Web-App die angemeldete Person mit ihrem OAuth-Token, bei Agenten das
// Agent-Konto mit seinem eigenen GitLab-Token. Die Regeln sind für beide gleich.
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { GitlabClient } from '@/lib/gitlab/client';
import { markSelfPush } from '@/lib/gitlab/self-push';
import { GitlabTokenExpiredError } from '@/lib/auth/encrypted-adapter';
import { logger } from '@/lib/logger';
import { labelNames, planSprintLabels, sprintNumberOf } from './board';

export type Actor = {
  /** Taktline-User für das Audit-Log; null bei Agenten ohne Taktline-Konto. */
  userId: string | null;
  /** GitLab-Username eines Agenten, landet im Audit-Log. */
  agent?: string;
  gitlab: () => Promise<GitlabClient>;
};

export type OpResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string; sessionExpired?: boolean };

function failure(err: unknown, context: Record<string, unknown>, message: string): OpResult<never> {
  if (err instanceof GitlabTokenExpiredError) {
    return {
      ok: false,
      error: 'GitLab-Session abgelaufen. Bitte abmelden und neu anmelden.',
      sessionExpired: true,
    };
  }
  logger.error({ err: err instanceof Error ? err.message : String(err), ...context }, message);
  return { ok: false, error: message };
}

export function revalidateSprints(projectId: string) {
  revalidatePath(`/projects/${projectId}/sprints`);
  revalidatePath(`/projects/${projectId}/board`);
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function audit(actor: Actor, action: string, entityId: string, data: { before?: object; after?: object }) {
  return prisma.auditLog.create({
    data: {
      userId: actor.userId,
      action,
      entityType: 'Sprint',
      entityId,
      ...(data.before ? { before: data.before } : {}),
      ...(data.after || actor.agent ? { after: { ...data.after, ...(actor.agent ? { agent: actor.agent } : {}) } } : {}),
    },
  });
}

const isRealDate = (value: string) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const DateSchema = (message: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, message).refine(isRealDate, 'Bitte ein gültiges Datum angeben');

export const SprintInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Bitte einen Namen angeben').max(80, 'Der Name ist zu lang'),
    goal: z.string().trim().max(500, 'Das Sprint-Ziel ist zu lang'),
    startDate: DateSchema('Bitte ein Startdatum wählen'),
    endDate: DateSchema('Bitte ein Enddatum wählen'),
  })
  .refine((s) => s.endDate >= s.startDate, { message: 'Ende darf nicht vor Start liegen' });

export type SprintInput = z.input<typeof SprintInputSchema>;

export async function createSprint(actor: Actor, projectId: string, rawInput: SprintInput): Promise<OpResult<{ number: number }>> {
  const parsed = SprintInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const input = parsed.data;

  try {
    const number = await prisma.$transaction(async (tx) => {
      const last = await tx.sprint.findFirst({
        where: { projectId },
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      const sprint = await tx.sprint.create({
        data: {
          projectId,
          number: (last?.number ?? 0) + 1,
          name: input.name,
          goal: input.goal || null,
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
        },
        select: { id: true, number: true },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'sprint.create',
          entityType: 'Sprint',
          entityId: sprint.id,
          after: { projectId, number: sprint.number, name: input.name, ...(actor.agent ? { agent: actor.agent } : {}) },
        },
      });
      return sprint.number;
    });
    revalidateSprints(projectId);
    return { ok: true, number };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, error: 'Gleichzeitig wurde ein Sprint angelegt. Bitte nochmals versuchen.' };
    }
    return failure(err, { projectId }, 'Sprint konnte nicht angelegt werden');
  }
}

export async function updateSprint(actor: Actor, sprintId: string, rawInput: SprintInput): Promise<OpResult> {
  const parsed = SprintInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const input = parsed.data;

  const sprint = await prisma.sprint.findUnique({
    where: { id: sprintId },
    select: { projectId: true, state: true, name: true, goal: true, startDate: true, endDate: true },
  });
  if (!sprint) return { ok: false, error: 'Sprint nicht gefunden' };
  if (sprint.state === 'closed') {
    return { ok: false, error: 'Abgeschlossene Sprints lassen sich nicht mehr ändern' };
  }

  await prisma.$transaction([
    prisma.sprint.update({
      where: { id: sprintId },
      data: {
        name: input.name,
        goal: input.goal || null,
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
      },
    }),
    audit(actor, 'sprint.update', sprintId, {
      before: {
        name: sprint.name,
        goal: sprint.goal,
        startDate: sprint.startDate.toISOString().slice(0, 10),
        endDate: sprint.endDate.toISOString().slice(0, 10),
      },
      after: { name: input.name, goal: input.goal || null, startDate: input.startDate, endDate: input.endDate },
    }),
  ]);
  revalidateSprints(sprint.projectId);
  return { ok: true };
}

/** Nur leere, noch nicht gestartete Sprints: sonst hingen Labels ohne Sprint in GitLab. */
export async function deleteSprint(actor: Actor, sprintId: string): Promise<OpResult> {
  const sprint = await prisma.sprint.findUnique({
    where: { id: sprintId },
    select: { projectId: true, state: true, number: true, name: true },
  });
  if (!sprint) return { ok: false, error: 'Sprint nicht gefunden' };
  if (sprint.state !== 'planned') {
    return { ok: false, error: 'Nur geplante Sprints lassen sich löschen' };
  }
  const items = await sprintWorkPackages(sprint.projectId, sprint.number);
  if (items.length > 0) {
    return { ok: false, error: 'Bitte zuerst alle Aufgaben aus dem Sprint nehmen' };
  }

  await prisma.$transaction([
    prisma.sprint.delete({ where: { id: sprintId } }),
    audit(actor, 'sprint.delete', sprintId, {
      before: { projectId: sprint.projectId, number: sprint.number, name: sprint.name },
    }),
  ]);
  revalidateSprints(sprint.projectId);
  return { ok: true };
}

export async function startSprint(actor: Actor, sprintId: string): Promise<OpResult> {
  const sprint = await prisma.sprint.findUnique({
    where: { id: sprintId },
    select: { projectId: true, state: true, number: true },
  });
  if (!sprint) return { ok: false, error: 'Sprint nicht gefunden' };
  if (sprint.state !== 'planned') return { ok: false, error: 'Nur geplante Sprints lassen sich starten' };

  const alreadyActive = { ok: false as const, error: 'Es läuft bereits ein Sprint. Bitte zuerst abschliessen.' };
  try {
    await prisma.$transaction([
      prisma.sprint.update({
        where: { id: sprintId },
        data: { state: 'active', startedAt: new Date() },
      }),
      audit(actor, 'sprint.start', sprintId, { after: { projectId: sprint.projectId, number: sprint.number } }),
    ]);
  } catch (err) {
    if (isUniqueViolation(err)) return alreadyActive;
    return failure(err, { sprintId }, 'Sprint konnte nicht gestartet werden');
  }
  revalidateSprints(sprint.projectId);
  return { ok: true };
}

// ─── Zuordnung ───────────────────────────────────────────────────────────────

export async function sprintWorkPackages(projectId: string, number: number) {
  const wps = await prisma.workPackage.findMany({
    where: { projectId, deletedAt: null, isSummary: false },
    select: {
      id: true,
      gitlabIssueIid: true,
      stateCache: true,
      storyPoints: true,
      labelsCache: true,
    },
  });
  return wps.filter((wp) => sprintNumberOf(labelNames(wp.labelsCache)) === number);
}

/** add/remove statt der ganzen Liste: parallele Änderungen in GitLab bleiben erhalten. */
export async function moveToSprint(
  client: GitlabClient,
  project: { id: string; gitlabProjectId: number },
  wp: { id: string; gitlabIssueIid: number; labelsCache: unknown },
  target: number | null,
): Promise<void> {
  const names = labelNames(wp.labelsCache);
  const { add, remove } = planSprintLabels(names, target);
  if (add.length === 0 && remove.length === 0) return;

  const payload: Record<string, unknown> = {};
  if (add.length > 0) payload.addLabels = add.join(',');
  if (remove.length > 0) payload.removeLabels = remove.join(',');

  markSelfPush(wp.gitlabIssueIid, project.id);
  const issue = (await client.Issues.edit(
    project.gitlabProjectId,
    wp.gitlabIssueIid,
    payload,
  )) as unknown as { labels?: unknown };

  const next = Array.isArray(issue.labels)
    ? labelNames(issue.labels)
    : names.filter((n) => !remove.includes(n)).concat(add);
  await prisma.workPackage.update({
    where: { id: wp.id },
    data: { labelsCache: next.map((name) => ({ name })) },
  });
}

/**
 * Schliesst den aktiven Sprint. Unerledigtes wandert zuerst, dann erst wird der
 * Sprint geschlossen: bricht GitLab mittendrin ab, bleibt er aktiv, und ein
 * zweiter Versuch macht mit den übrigen Aufgaben weiter.
 */
export async function closeSprint(
  actor: Actor,
  sprintId: string,
  carryOverTo: number | null,
): Promise<OpResult<{ moved: number; completed: number; completedPoints: number }>> {
  const sprint = await prisma.sprint.findUnique({
    where: { id: sprintId },
    select: {
      id: true,
      projectId: true,
      number: true,
      state: true,
      project: { select: { id: true, gitlabProjectId: true } },
    },
  });
  if (!sprint) return { ok: false, error: 'Sprint nicht gefunden' };
  if (sprint.state !== 'active') return { ok: false, error: 'Nur der aktive Sprint lässt sich abschliessen' };

  if (carryOverTo !== null) {
    const target = await prisma.sprint.findUnique({
      where: { projectId_number: { projectId: sprint.projectId, number: carryOverTo } },
      select: { state: true },
    });
    if (target?.state !== 'planned') {
      return { ok: false, error: 'Unerledigtes kann nur in einen geplanten Sprint wandern' };
    }
  }

  const items = await sprintWorkPackages(sprint.projectId, sprint.number);
  const open = items.filter((wp) => wp.stateCache !== 'closed');
  const done = items.filter((wp) => wp.stateCache === 'closed');
  const completedPoints = done.reduce((sum, wp) => sum + (wp.storyPoints ?? 0), 0);

  let moved = 0;
  try {
    if (open.length > 0) {
      const client = await actor.gitlab();
      for (const wp of open) {
        await moveToSprint(client, sprint.project, wp, carryOverTo);
        moved++;
      }
    }
    await prisma.$transaction([
      prisma.sprint.update({
        where: { id: sprintId },
        data: {
          state: 'closed',
          closedAt: new Date(),
          // Eingefroren: spätere Änderungen an Issues schreiben die Bilanz nicht um.
          completedCount: done.length,
          completedPoints,
        },
      }),
      audit(actor, 'sprint.close', sprintId, {
        after: {
          projectId: sprint.projectId,
          number: sprint.number,
          completed: done.length,
          carriedOver: moved,
          carryOverTo,
        },
      }),
    ]);
    revalidateSprints(sprint.projectId);
    return { ok: true, moved, completed: done.length, completedPoints };
  } catch (err) {
    revalidateSprints(sprint.projectId);
    const result = failure(err, { sprintId, moved, total: open.length }, 'Sprint konnte nicht abgeschlossen werden');
    if (!result.ok && !result.sessionExpired) {
      return {
        ok: false,
        error: `Abschluss abgebrochen, ${moved} von ${open.length} Aufgaben wurden verschoben. Der Sprint bleibt aktiv, bitte nochmals versuchen.`,
      };
    }
    return result;
  }
}

// ─── Sprint Review ───────────────────────────────────────────────────────────

export const ReviewSchema = z.object({
  goalOutcome: z.enum(['yes', 'partly', 'no']).nullable(),
  reviewNotes: z.string().trim().max(20_000, 'Die Notizen sind zu lang'),
});

export async function saveReview(
  actor: Actor,
  sprintId: string,
  raw: z.input<typeof ReviewSchema>,
): Promise<OpResult> {
  const parsed = ReviewSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const sprint = await prisma.sprint.findUnique({
    where: { id: sprintId },
    select: { id: true, number: true, projectId: true, state: true },
  });
  if (!sprint) return { ok: false, error: 'Sprint nicht gefunden' };
  if (sprint.state === 'planned') return { ok: false, error: 'Ein Review gibt es erst für laufende oder abgeschlossene Sprints' };
  await prisma.$transaction([
    prisma.sprint.update({
      where: { id: sprint.id },
      data: { goalOutcome: parsed.data.goalOutcome, reviewNotes: parsed.data.reviewNotes || null },
    }),
    audit(actor, 'sprint.review', sprint.id, { after: { goalOutcome: parsed.data.goalOutcome } }),
  ]);
  revalidatePath(`/projects/${sprint.projectId}/sprints/${sprint.number}`);
  revalidateSprints(sprint.projectId);
  return { ok: true };
}
