'use server';

import { auth } from '@/auth';
import { setDefinitionOfDone, setProductGoal } from '@/lib/agile/frame-ops';
import { prisma } from '@/lib/db';
import { getGitlabClientForUser } from '@/lib/gitlab/client';
import { GitlabTokenExpiredError } from '@/lib/auth/encrypted-adapter';
import { logger } from '@/lib/logger';
import { labelNames, sprintNumberOf } from '@/lib/agile/board';
import {
  closeSprint,
  createSprint,
  deleteSprint,
  moveToSprint,
  revalidateSprints,
  startSprint,
  updateSprint,
  type Actor,
  type OpResult,
  type SprintInput,
} from '@/lib/agile/sprint-ops';

// Die Regeln stecken in lib/agile/sprint-ops.ts, damit die Agenten-API
// (api/agent/sprints) dieselben benutzt. Hier nur Anmeldung und Aufruf.

type ActionResult<T = object> = OpResult<T>;

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

async function sessionActor(): Promise<Actor | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  return { userId, gitlab: () => getGitlabClientForUser(userId) };
}

const NOT_SIGNED_IN = { ok: false as const, error: 'Nicht angemeldet' };

export async function createSprintAction(projectId: string, rawInput: SprintInput): Promise<ActionResult> {
  const actor = await sessionActor();
  if (!actor) return NOT_SIGNED_IN;
  return createSprint(actor, projectId, rawInput);
}

export async function updateSprintAction(sprintId: string, rawInput: SprintInput): Promise<ActionResult> {
  const actor = await sessionActor();
  if (!actor) return NOT_SIGNED_IN;
  return updateSprint(actor, sprintId, rawInput);
}

export async function deleteSprintAction(sprintId: string): Promise<ActionResult> {
  const actor = await sessionActor();
  if (!actor) return NOT_SIGNED_IN;
  return deleteSprint(actor, sprintId);
}

export async function startSprintAction(sprintId: string): Promise<ActionResult> {
  const actor = await sessionActor();
  if (!actor) return NOT_SIGNED_IN;
  return startSprint(actor, sprintId);
}

export async function closeSprintAction(
  sprintId: string,
  carryOverTo: number | null,
): Promise<ActionResult<{ moved: number }>> {
  const actor = await sessionActor();
  if (!actor) return NOT_SIGNED_IN;
  return closeSprint(actor, sprintId, carryOverTo);
}

// ─── Zuordnung ───────────────────────────────────────────────────────────────

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
    revalidateSprints(projectId);
    return { ok: true };
  } catch (err) {
    return failure(err, { workPackageId, sprintNumber }, 'Einplanen fehlgeschlagen');
  }
}

// ─── Product Goal und Definition of Done ─────────────────────────────────────
// Logik in lib/agile/frame-ops.ts, dieselbe nutzt die Agenten-API.

export async function updateProductGoalAction(projectId: string, raw: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };
  const result = await setProductGoal({ userId: session.user.id }, projectId, raw);
  return result.ok ? { ok: true } : result;
}

export async function updateDefinitionOfDoneAction(projectId: string, raw: string[]): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };
  const result = await setDefinitionOfDone({ userId: session.user.id }, projectId, raw);
  return result.ok ? { ok: true } : result;
}
