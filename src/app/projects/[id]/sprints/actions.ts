'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getGitlabClientForUser, type GitlabClient } from '@/lib/gitlab/client';
import { markSelfPush } from '@/lib/gitlab/self-push';
import { GitlabTokenExpiredError } from '@/lib/auth/encrypted-adapter';
import { logger } from '@/lib/logger';
import { labelNames, planSprintLabels, sprintNumberOf } from '@/lib/agile/board';

type ActionResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string; sessionExpired?: boolean };

function failure(err: unknown, context: Record<string, unknown>, message: string): ActionResult<never> {
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

function revalidateProject(projectId: string) {
  revalidatePath(`/projects/${projectId}/sprints`);
  revalidatePath(`/projects/${projectId}/board`);
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

const SprintInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Bitte einen Namen angeben').max(80, 'Der Name ist zu lang'),
    goal: z.string().trim().max(500, 'Das Sprint-Ziel ist zu lang'),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Bitte ein Startdatum wählen'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Bitte ein Enddatum wählen'),
  })
  .refine((s) => s.endDate >= s.startDate, { message: 'Ende darf nicht vor Start liegen' });

export type SprintInput = z.input<typeof SprintInputSchema>;

export async function createSprintAction(
  projectId: string,
  rawInput: SprintInput,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };
  const parsed = SprintInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const input = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
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
          userId: session.user.id,
          action: 'sprint.create',
          entityType: 'Sprint',
          entityId: sprint.id,
          after: { projectId, number: sprint.number, name: input.name },
        },
      });
    });
    revalidateProject(projectId);
    return { ok: true };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, error: 'Gleichzeitig wurde ein Sprint angelegt. Bitte nochmals versuchen.' };
    }
    return failure(err, { projectId }, 'Sprint konnte nicht angelegt werden');
  }
}

export async function updateSprintAction(sprintId: string, rawInput: SprintInput): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };
  const parsed = SprintInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const input = parsed.data;

  const sprint = await prisma.sprint.findUnique({
    where: { id: sprintId },
    select: { projectId: true, state: true },
  });
  if (!sprint) return { ok: false, error: 'Sprint nicht gefunden' };
  if (sprint.state === 'closed') {
    return { ok: false, error: 'Abgeschlossene Sprints lassen sich nicht mehr ändern' };
  }

  await prisma.sprint.update({
    where: { id: sprintId },
    data: {
      name: input.name,
      goal: input.goal || null,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
    },
  });
  revalidateProject(sprint.projectId);
  return { ok: true };
}

/** Nur leere, noch nicht gestartete Sprints: sonst hingen Labels ohne Sprint in GitLab. */
export async function deleteSprintAction(sprintId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };

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
    prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: 'sprint.delete',
        entityType: 'Sprint',
        entityId: sprintId,
        before: { projectId: sprint.projectId, number: sprint.number, name: sprint.name },
      },
    }),
  ]);
  revalidateProject(sprint.projectId);
  return { ok: true };
}

export async function startSprintAction(sprintId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };

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
      prisma.auditLog.create({
        data: {
          userId: session.user.id,
          action: 'sprint.start',
          entityType: 'Sprint',
          entityId: sprintId,
          after: { projectId: sprint.projectId, number: sprint.number },
        },
      }),
    ]);
  } catch (err) {
    if (isUniqueViolation(err)) return alreadyActive;
    return failure(err, { sprintId }, 'Sprint konnte nicht gestartet werden');
  }
  revalidateProject(sprint.projectId);
  return { ok: true };
}

// ─── Zuordnung ───────────────────────────────────────────────────────────────

async function sprintWorkPackages(projectId: string, number: number) {
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
async function moveToSprint(
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

/** `sprintNumber: null` legt die Aufgabe zurück in den Backlog. */
export async function assignToSprintAction(
  projectId: string,
  workPackageId: string,
  sprintNumber: number | null,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };

  const wp = await prisma.workPackage.findFirst({
    where: { id: workPackageId, projectId, deletedAt: null },
    select: {
      id: true,
      gitlabIssueIid: true,
      labelsCache: true,
      isSummary: true,
      project: { select: { id: true, gitlabProjectId: true } },
    },
  });
  if (!wp) return { ok: false, error: 'Aufgabe nicht gefunden' };
  if (wp.isSummary) return { ok: false, error: 'Summary-Tasks lassen sich nicht einplanen' };

  const sprints = await prisma.sprint.findMany({
    where: { projectId },
    select: { number: true, state: true },
  });
  const current = sprintNumberOf(labelNames(wp.labelsCache));
  if (sprints.find((s) => s.number === current)?.state === 'closed') {
    return { ok: false, error: 'Aufgaben abgeschlossener Sprints bleiben dort' };
  }
  if (sprintNumber !== null) {
    const target = sprints.find((s) => s.number === sprintNumber);
    if (!target) return { ok: false, error: 'Sprint nicht gefunden' };
    if (target.state === 'closed') return { ok: false, error: 'Dieser Sprint ist abgeschlossen' };
  }

  try {
    const client = await getGitlabClientForUser(session.user.id);
    await moveToSprint(client, wp.project, wp, sprintNumber);
    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: 'work_package.update',
        entityType: 'WorkPackage',
        entityId: wp.id,
        before: { sprint: current },
        after: { sprint: sprintNumber },
      },
    });
    revalidateProject(projectId);
    return { ok: true };
  } catch (err) {
    return failure(err, { workPackageId, sprintNumber }, 'Einplanen fehlgeschlagen');
  }
}

/**
 * Schliesst den aktiven Sprint. Unerledigtes wandert zuerst, dann erst wird der
 * Sprint geschlossen: bricht GitLab mittendrin ab, bleibt er aktiv, und ein
 * zweiter Versuch macht mit den übrigen Aufgaben weiter.
 */
export async function closeSprintAction(
  sprintId: string,
  carryOverTo: number | null,
): Promise<ActionResult<{ moved: number }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };

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

  let moved = 0;
  try {
    if (open.length > 0) {
      const client = await getGitlabClientForUser(session.user.id);
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
          completedPoints: done.reduce((sum, wp) => sum + (wp.storyPoints ?? 0), 0),
        },
      }),
      prisma.auditLog.create({
        data: {
          userId: session.user.id,
          action: 'sprint.close',
          entityType: 'Sprint',
          entityId: sprintId,
          after: {
            projectId: sprint.projectId,
            number: sprint.number,
            completed: done.length,
            carriedOver: moved,
            carryOverTo,
          },
        },
      }),
    ]);
    revalidateProject(sprint.projectId);
    return { ok: true, moved };
  } catch (err) {
    revalidateProject(sprint.projectId);
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

// ─── Product Goal und Definition of Done ─────────────────────────────────────

const ProductGoalSchema = z.string().trim().max(2000, 'Das Product Goal ist zu lang');
const DodSchema = z
  .array(z.string().trim().min(1).max(200, 'Ein Punkt der Definition of Done ist zu lang'))
  .max(20, 'Höchstens 20 Punkte');

export async function updateProductGoalAction(projectId: string, raw: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };
  const parsed = ProductGoalSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const updated = await prisma.project.updateMany({
    where: { id: projectId },
    data: { productGoal: parsed.data || null },
  });
  if (updated.count === 0) return { ok: false, error: 'Projekt nicht gefunden' };
  revalidateProject(projectId);
  return { ok: true };
}

export async function updateDefinitionOfDoneAction(projectId: string, raw: string[]): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };
  const parsed = DodSchema.safeParse(raw.filter((item) => item.trim() !== ''));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const updated = await prisma.project.updateMany({
    where: { id: projectId },
    data: { definitionOfDone: parsed.data },
  });
  if (updated.count === 0) return { ok: false, error: 'Projekt nicht gefunden' };
  revalidateProject(projectId);
  return { ok: true };
}
