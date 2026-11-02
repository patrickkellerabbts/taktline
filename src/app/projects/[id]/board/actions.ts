'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getGitlabClientForUser } from '@/lib/gitlab/client';
import { parseGanttMeta, serializeGanttMeta, stripGanttMeta, type GanttMeta } from '@/lib/gitlab/meta';
import { markSelfPush } from '@/lib/gitlab/self-push';
import { GitlabTokenExpiredError } from '@/lib/auth/encrypted-adapter';
import { logger } from '@/lib/logger';
import {
  BOARD_COLUMNS,
  STORY_LABEL,
  columnForIssue,
  isBoardColumnId,
  isReservedLabel,
  isStory,
  labelNames,
  planColumnLabels,
  type BoardColumnId,
} from '@/lib/agile/board';
import { buildStoryDescription, mergeCriteria, parseStoryDescription } from '@/lib/agile/story';

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
  return { ok: false, error: err instanceof Error ? err.message : message };
}

function revalidateProject(projectId: string) {
  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}/gantt`);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fallbackEnd(start: Date): Date {
  const end = new Date(start);
  end.setDate(end.getDate() + 14);
  return end;
}

/** GitLab liefert Labels als Strings, Assignees in snake_case. */
function gitlabAssignees(input: unknown) {
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

// ─── Karte verschieben ───────────────────────────────────────────────────────

/**
 * Verschiebt eine Karte. `orderedIds` ist die neue Reihenfolge der Zielspalte
 * inklusive der Karte selbst. Die Reihenfolge bleibt in der App-DB; nach GitLab
 * geht nur ein Spaltenwechsel, sonst würde jedes Sortieren Issues anfassen.
 */
export async function moveBoardCardAction(
  projectId: string,
  workPackageId: string,
  target: BoardColumnId,
  orderedIds: string[],
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };
  if (!isBoardColumnId(target)) return { ok: false, error: 'Unbekannte Spalte' };

  const wp = await prisma.workPackage.findFirst({
    where: { id: workPackageId, projectId, deletedAt: null },
    select: {
      gitlabIssueIid: true,
      stateCache: true,
      labelsCache: true,
      isSummary: true,
      project: { select: { gitlabProjectId: true } },
    },
  });
  if (!wp) return { ok: false, error: 'Karte nicht gefunden' };
  if (wp.isSummary) return { ok: false, error: 'Summary-Tasks liegen nicht auf dem Board' };

  const names = labelNames(wp.labelsCache);
  const from = columnForIssue(wp.stateCache, names);
  const { add, remove } = planColumnLabels(names, target);
  const nextState = target === 'done' ? 'closed' : 'opened';
  const stateChanged = nextState !== wp.stateCache;

  try {
    let labelsCache: unknown = wp.labelsCache;
    let closedAt: Date | null | undefined;

    if (add.length > 0 || remove.length > 0 || stateChanged) {
      const client = await getGitlabClientForUser(session.user.id);
      const payload: Record<string, unknown> = {};
      // add/remove statt der ganzen Liste: so überschreibt das Board keine
      // Labels, die jemand gerade in GitLab gesetzt hat.
      if (add.length > 0) payload.addLabels = add.join(',');
      if (remove.length > 0) payload.removeLabels = remove.join(',');
      if (stateChanged) payload.stateEvent = nextState === 'closed' ? 'close' : 'reopen';

      markSelfPush(wp.gitlabIssueIid, projectId);
      const issue = (await client.Issues.edit(
        wp.project.gitlabProjectId,
        wp.gitlabIssueIid,
        payload,
      )) as unknown as { labels?: unknown; closed_at?: string | null };

      labelsCache = Array.isArray(issue.labels)
        ? labelNames(issue.labels).map((name) => ({ name }))
        : names
            .filter((n) => !remove.includes(n))
            .concat(add)
            .map((name) => ({ name }));
      if (stateChanged) {
        closedAt = nextState === 'closed' ? new Date(issue.closed_at ?? Date.now()) : null;
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.workPackage.update({
        where: { id: workPackageId },
        data: {
          labelsCache: labelsCache as object,
          stateCache: nextState,
          ...(closedAt !== undefined ? { closedAt } : {}),
        },
      });
      for (const [index, id] of orderedIds.entries()) {
        await tx.workPackage.updateMany({
          where: { id, projectId },
          data: { boardRank: index },
        });
      }
      if (from !== target) {
        await tx.auditLog.create({
          data: {
            userId: session.user.id,
            action: 'work_package.update',
            entityType: 'WorkPackage',
            entityId: workPackageId,
            // `state` nur bei echtem Wechsel: die Velocity in /reports zählt
            // jeden Eintrag mit after.state = "closed" als Schliessung.
            before: { column: from, ...(stateChanged ? { state: wp.stateCache } : {}) },
            after: { column: target, ...(stateChanged ? { state: nextState } : {}) },
          },
        });
      }
    });

    revalidateProject(projectId);
    return { ok: true };
  } catch (err) {
    return failure(err, { workPackageId, target }, 'Verschieben fehlgeschlagen');
  }
}

// ─── User Stories ────────────────────────────────────────────────────────────

const isoDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const StoryInputSchema = z
  .object({
    title: z.string().trim().min(1, 'Titel darf nicht leer sein'),
    role: z.string().trim(),
    goal: z.string().trim(),
    benefit: z.string().trim(),
    criteria: z.array(z.string()),
    notes: z.string(),
    storyPoints: z.number().int().min(0, 'Story Points dürfen nicht negativ sein').nullable(),
    assigneeIds: z.array(z.number().int().positive()),
    labels: z.array(z.string()),
    startDate: isoDateString.nullable(),
    endDate: isoDateString.nullable(),
  })
  .refine((s) => Boolean(s.role) === Boolean(s.goal), {
    message: '„Als …“ und „möchte ich …“ gehören zusammen',
  })
  .refine((s) => !s.benefit || Boolean(s.goal), {
    message: '„damit …“ braucht auch „Als …“ und „möchte ich …“',
  })
  .refine((s) => Boolean(s.startDate) === Boolean(s.endDate), {
    message: 'Start und Ende bitte zusammen setzen oder beide leer lassen',
  })
  .refine((s) => !s.startDate || !s.endDate || s.endDate >= s.startDate, {
    message: 'Ende darf nicht vor Start liegen',
  });

export type StoryInput = z.input<typeof StoryInputSchema>;

export async function createStoryAction(
  projectId: string,
  rawInput: StoryInput,
  column: BoardColumnId,
): Promise<ActionResult<{ workPackageId: string; gitlabIssueIid: number }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };

  const parsed = StoryInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const input = parsed.data;
  if (!isBoardColumnId(column) || column === 'done') {
    return { ok: false, error: 'Neue Stories können nicht direkt in „Done“ liegen' };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, gitlabProjectId: true },
  });
  if (!project) return { ok: false, error: 'Projekt nicht gefunden' };

  const meta: GanttMeta = {};
  if (input.startDate) meta.start_date = input.startDate;
  if (input.storyPoints !== null) meta.story_points = input.storyPoints;
  const description = serializeGanttMeta(
    buildStoryDescription({
      role: input.role,
      goal: input.goal,
      benefit: input.benefit,
      criteria: mergeCriteria(input.criteria, []),
      notes: input.notes,
    }),
    meta,
  );

  const columnLabel = BOARD_COLUMNS.find((c) => c.id === column)?.label;
  const labels = [
    STORY_LABEL,
    ...(columnLabel ? [columnLabel] : []),
    ...input.labels.filter((l) => !isReservedLabel(l)),
  ];

  try {
    const client = await getGitlabClientForUser(session.user.id);
    const issue = (await client.Issues.create(project.gitlabProjectId, input.title, {
      description,
      labels: labels.join(','),
      ...(input.assigneeIds.length > 0 ? { assigneeIds: input.assigneeIds } : {}),
      ...(input.endDate ? { dueDate: input.endDate } : {}),
    })) as unknown as { iid?: number; assignees?: unknown };
    if (typeof issue.iid !== 'number') {
      return { ok: false, error: 'GitLab lieferte keine Issue-IID zurück' };
    }
    const iid = issue.iid;
    markSelfPush(iid, project.id);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = input.startDate ? new Date(input.startDate) : today;

    const created = await prisma.$transaction(async (tx) => {
      const wp = await tx.workPackage.create({
        data: {
          projectId: project.id,
          gitlabIssueIid: iid,
          startDate,
          endDate: input.endDate ? new Date(input.endDate) : fallbackEnd(startDate),
          isUnscheduled: !input.startDate,
          storyPoints: input.storyPoints,
          titleCache: input.title,
          descriptionCache: description,
          stateCache: 'opened',
          labelsCache: labels.map((name) => ({ name })),
          assigneesCache: gitlabAssignees(issue.assignees),
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: 'work_package.create',
          entityType: 'WorkPackage',
          entityId: wp.id,
          after: { title: input.title, gitlabIssueIid: iid, story: true },
        },
      });
      return wp;
    });

    revalidateProject(project.id);
    return { ok: true, workPackageId: created.id, gitlabIssueIid: iid };
  } catch (err) {
    return failure(err, { projectId }, 'Story konnte nicht angelegt werden');
  }
}

export async function updateStoryAction(
  workPackageId: string,
  rawInput: StoryInput,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };

  const parsed = StoryInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const input = parsed.data;

  const wp = await prisma.workPackage.findFirst({
    where: { id: workPackageId, deletedAt: null },
    select: {
      gitlabIssueIid: true,
      titleCache: true,
      descriptionCache: true,
      labelsCache: true,
      startDate: true,
      endDate: true,
      isUnscheduled: true,
      storyPoints: true,
      project: { select: { id: true, gitlabProjectId: true } },
    },
  });
  if (!wp) return { ok: false, error: 'Story nicht gefunden' };

  const names = labelNames(wp.labelsCache);
  if (!isStory(names)) return { ok: false, error: 'Dieses Issue ist keine User Story' };

  // Text nur neu aufbauen, wenn er sich wirklich ändert — sonst bleibt die
  // Description in GitLab Zeichen für Zeichen, wie sie war (AGENTS.md Regel 6).
  const oldText = stripGanttMeta(wp.descriptionCache);
  const oldFields = parseStoryDescription(oldText);
  const newFields = {
    role: input.role,
    goal: input.goal,
    benefit: input.benefit,
    criteria: mergeCriteria(input.criteria, oldFields.criteria),
    notes: input.notes.trim(),
  };
  const textChanged =
    buildStoryDescription(newFields) !== buildStoryDescription(oldFields);
  const text = textChanged ? buildStoryDescription(newFields) : oldText;

  // Unbekannte Meta-Felder (Baseline, Dependencies, …) bleiben durch den Spread erhalten.
  const meta: GanttMeta = { ...(parseGanttMeta(wp.descriptionCache) ?? {}) };
  if (input.startDate) meta.start_date = input.startDate;
  else delete meta.start_date;
  if (input.storyPoints !== null) meta.story_points = input.storyPoints;
  else delete meta.story_points;
  const description = serializeGanttMeta(text, meta);

  const wanted = input.labels.filter((l) => !isReservedLabel(l));
  const current = names.filter((l) => !isReservedLabel(l));
  const addLabels = wanted.filter((l) => !current.includes(l));
  const removeLabels = current.filter((l) => !wanted.includes(l));

  const payload: Record<string, unknown> = { assigneeIds: input.assigneeIds };
  if (input.title !== wp.titleCache) payload.title = input.title;
  if (description !== (wp.descriptionCache ?? '')) payload.description = description;
  if (addLabels.length > 0) payload.addLabels = addLabels.join(',');
  if (removeLabels.length > 0) payload.removeLabels = removeLabels.join(',');
  // Ein leerer String löscht das Fälligkeitsdatum in GitLab.
  if (input.endDate) {
    if (wp.isUnscheduled || input.endDate !== isoDate(wp.endDate)) payload.dueDate = input.endDate;
  } else if (!wp.isUnscheduled) {
    payload.dueDate = '';
  }

  try {
    const client = await getGitlabClientForUser(session.user.id);
    markSelfPush(wp.gitlabIssueIid, wp.project.id);
    const issue = (await client.Issues.edit(
      wp.project.gitlabProjectId,
      wp.gitlabIssueIid,
      payload,
    )) as unknown as { labels?: unknown; assignees?: unknown };

    const startDate = input.startDate ? new Date(input.startDate) : wp.startDate;
    await prisma.$transaction(async (tx) => {
      await tx.workPackage.update({
        where: { id: workPackageId },
        data: {
          titleCache: input.title,
          descriptionCache: description,
          storyPoints: input.storyPoints,
          isUnscheduled: !input.startDate,
          startDate,
          endDate: input.endDate ? new Date(input.endDate) : fallbackEnd(startDate),
          labelsCache: (Array.isArray(issue.labels)
            ? labelNames(issue.labels)
            : names.filter((n) => !removeLabels.includes(n)).concat(addLabels)
          ).map((name) => ({ name })),
          assigneesCache: gitlabAssignees(issue.assignees),
          lastSyncedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: 'work_package.update',
          entityType: 'WorkPackage',
          entityId: workPackageId,
          before: { title: wp.titleCache, storyPoints: wp.storyPoints },
          after: { title: input.title, storyPoints: input.storyPoints },
        },
      });
    });

    revalidateProject(wp.project.id);
    return { ok: true };
  } catch (err) {
    return failure(err, { workPackageId }, 'Story konnte nicht gespeichert werden');
  }
}
