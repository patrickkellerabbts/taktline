'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getGitlabClientForUser, getGitlabGraphqlForUser } from '@/lib/gitlab/client';
import { gitlabDuration, setTaskParent } from '@/lib/gitlab/tasks';
import { markSelfPush } from '@/lib/gitlab/self-push';
import { GitlabTokenExpiredError } from '@/lib/auth/encrypted-adapter';
import { logger } from '@/lib/logger';
import { isStory, labelNames } from '@/lib/agile/board';

// Tasks sind native GitLab-Work-Items vom Typ „Task“ unter einer User Story.
// Anlegen braucht drei Schritte: REST legt den Task an, REST setzt die
// Schätzung, GraphQL hängt ihn unter die Story (lib/gitlab/tasks.ts).

type ActionResult = { ok: true } | { ok: false; error: string; sessionExpired?: boolean };

function failure(err: unknown, context: Record<string, unknown>, message: string): ActionResult {
  if (err instanceof GitlabTokenExpiredError) {
    return { ok: false, error: 'GitLab-Session abgelaufen. Bitte abmelden und neu anmelden.', sessionExpired: true };
  }
  logger.error({ err: err instanceof Error ? err.message : String(err), ...context }, message);
  return { ok: false, error: message };
}

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}/sprints`);
}

/** Stunden, auch mit Komma; leer = keine Schätzung. */
const HoursSchema = z
  .number()
  .min(0, 'Die Schätzung darf nicht negativ sein')
  .max(200, 'Mehr als 200 Stunden ist kein Task mehr, sondern eine Story')
  .nullable();

const TaskInputSchema = z.object({
  title: z.string().trim().min(1, 'Bitte einen Titel angeben').max(255, 'Der Titel ist zu lang'),
  estimateHours: HoursSchema,
  assigneeId: z.number().int().positive().nullable(),
});

export type TaskInput = z.input<typeof TaskInputSchema>;

function toSeconds(hours: number | null): number | null {
  return hours === null || hours === 0 ? null : Math.round(hours * 3600);
}

function assigneesFromIssue(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input.flatMap((a) => {
    const o = a as { id?: unknown; username?: unknown; name?: unknown; avatar_url?: unknown };
    if (typeof o?.id !== 'number' || typeof o.username !== 'string') return [];
    return [
      {
        id: o.id,
        username: o.username,
        name: typeof o.name === 'string' ? o.name : o.username,
        avatarUrl: typeof o.avatar_url === 'string' ? o.avatar_url : undefined,
      },
    ];
  });
}

export async function createTaskAction(storyId: string, raw: TaskInput): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };
  const parsed = TaskInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const input = parsed.data;

  const story = await prisma.workPackage.findFirst({
    where: { id: storyId, deletedAt: null },
    select: {
      id: true,
      gitlabIssueIid: true,
      labelsCache: true,
      startDate: true,
      endDate: true,
      project: { select: { id: true, gitlabProjectId: true } },
    },
  });
  if (!story || !isStory(labelNames(story.labelsCache))) return { ok: false, error: 'Story nicht gefunden' };
  const { project } = story;

  try {
    const client = await getGitlabClientForUser(session.user.id);
    const created = (await client.Issues.create(project.gitlabProjectId, input.title, {
      issueType: 'task',
      ...(input.assigneeId ? { assigneeIds: [input.assigneeId] } : {}),
    } as Record<string, unknown>)) as unknown as { iid: number; id: number; assignees?: unknown };
    markSelfPush(created.iid, project.id);

    const estimateSeconds = toSeconds(input.estimateHours);
    if (estimateSeconds) {
      await client.Issues.addTimeEstimate(project.gitlabProjectId, created.iid, gitlabDuration(estimateSeconds));
    }

    // Die Zuordnung zur Story gibt es nur über GraphQL. Klappt sie nicht,
    // bleibt der Task lokal trotzdem bei der Story, der nächste Sync korrigiert.
    const graphql = await getGitlabGraphqlForUser(session.user.id);
    if (graphql) {
      const storyIssue = (await client.Issues.show(story.gitlabIssueIid, { projectId: project.gitlabProjectId })) as unknown as {
        id: number;
      };
      await setTaskParent(graphql, created.id, storyIssue.id);
    }

    await prisma.workPackage.create({
      data: {
        projectId: project.id,
        gitlabIssueIid: created.iid,
        titleCache: input.title,
        stateCache: 'opened',
        // Tasks haben keinen Balken; die Daten sind nur der Pflicht-Fallback.
        startDate: story.startDate,
        endDate: story.endDate,
        isUnscheduled: true,
        isTask: true,
        storyId: story.id,
        estimateSeconds,
        assigneesCache: assigneesFromIssue(created.assignees),
        labelsCache: [],
      },
    });
  } catch (err) {
    return failure(err, { storyId }, 'Der Task konnte nicht angelegt werden');
  }

  revalidate(project.id);
  return { ok: true };
}

export async function updateTaskAction(taskId: string, raw: TaskInput): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };
  const parsed = TaskInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const input = parsed.data;

  const task = await prisma.workPackage.findFirst({
    where: { id: taskId, isTask: true, deletedAt: null },
    select: {
      id: true,
      gitlabIssueIid: true,
      titleCache: true,
      estimateSeconds: true,
      assigneesCache: true,
      project: { select: { id: true, gitlabProjectId: true } },
    },
  });
  if (!task) return { ok: false, error: 'Task nicht gefunden' };

  const currentAssignee = assigneesFromIssue(task.assigneesCache)[0]?.id ?? null;
  const estimateSeconds = toSeconds(input.estimateHours);
  const payload: Record<string, unknown> = {};
  if (input.title !== task.titleCache) payload.title = input.title;
  if (input.assigneeId !== currentAssignee) payload.assigneeIds = input.assigneeId ? [input.assigneeId] : [];

  try {
    const client = await getGitlabClientForUser(session.user.id);
    let assigneesCache: unknown = task.assigneesCache;
    if (Object.keys(payload).length > 0) {
      markSelfPush(task.gitlabIssueIid, task.project.id);
      const issue = (await client.Issues.edit(task.project.gitlabProjectId, task.gitlabIssueIid, payload)) as unknown as {
        assignees?: unknown;
      };
      if ('assigneeIds' in payload) assigneesCache = assigneesFromIssue(issue.assignees);
    }
    if (estimateSeconds !== task.estimateSeconds) {
      markSelfPush(task.gitlabIssueIid, task.project.id);
      if (estimateSeconds) {
        await client.Issues.addTimeEstimate(task.project.gitlabProjectId, task.gitlabIssueIid, gitlabDuration(estimateSeconds));
      } else {
        await client.Issues.resetTimeEstimate(task.project.gitlabProjectId, task.gitlabIssueIid);
      }
    }
    await prisma.workPackage.update({
      where: { id: task.id },
      data: {
        titleCache: input.title,
        estimateSeconds,
        assigneesCache: assigneesCache as object,
        lastSyncedAt: new Date(),
      },
    });
  } catch (err) {
    return failure(err, { taskId }, 'Der Task konnte nicht gespeichert werden');
  }

  revalidate(task.project.id);
  return { ok: true };
}
