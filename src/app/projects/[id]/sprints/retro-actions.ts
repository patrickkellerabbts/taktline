'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getGitlabClientForUser } from '@/lib/gitlab/client';
import { markSelfPush } from '@/lib/gitlab/self-push';
import { GitlabTokenExpiredError } from '@/lib/auth/encrypted-adapter';
import { logger } from '@/lib/logger';
import { sprintLabel } from '@/lib/agile/board';
import { RETRO_VOTES_PER_PERSON } from '@/lib/agile/retro-shared';
import { saveReview } from '@/lib/agile/sprint-ops';

type ActionResult = { ok: true } | { ok: false; error: string };

/** Label an Issues, die aus einer Retro-Massnahme entstanden sind. */
const RETRO_LABEL = 'retro';

async function sprintFor(sprintId: string) {
  return prisma.sprint.findUnique({
    where: { id: sprintId },
    select: { id: true, number: true, projectId: true },
  });
}

function revalidate(projectId: string, number: number) {
  revalidatePath(`/projects/${projectId}/sprints/${number}`);
  revalidatePath(`/projects/${projectId}/sprints`);
}

export async function saveReviewAction(
  sprintId: string,
  raw: { goalOutcome: 'yes' | 'partly' | 'no' | null; reviewNotes: string },
): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'Nicht angemeldet' };
  return saveReview({ userId, gitlab: () => getGitlabClientForUser(userId) }, sprintId, raw);
}

const ItemSchema = z.object({
  kind: z.enum(['good', 'improve', 'action']),
  text: z.string().trim().min(1, 'Bitte etwas eintragen').max(1000, 'Die Karte ist zu lang'),
});

export async function addRetroItemAction(sprintId: string, raw: z.input<typeof ItemSchema>): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };
  const parsed = ItemSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const sprint = await sprintFor(sprintId);
  if (!sprint) return { ok: false, error: 'Sprint nicht gefunden' };
  await prisma.sprintRetroItem.create({
    data: { sprintId: sprint.id, kind: parsed.data.kind, text: parsed.data.text, authorId: session.user.id },
  });
  revalidate(sprint.projectId, sprint.number);
  return { ok: true };
}

export async function deleteRetroItemAction(itemId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };
  const item = await prisma.sprintRetroItem.findFirst({
    where: { id: itemId, authorId: session.user.id },
    select: { id: true, sprint: { select: { projectId: true, number: true } } },
  });
  if (!item) return { ok: false, error: 'Nur eigene Karten lassen sich löschen' };
  await prisma.sprintRetroItem.delete({ where: { id: item.id } });
  revalidate(item.sprint.projectId, item.sprint.number);
  return { ok: true };
}

export async function toggleRetroVoteAction(itemId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };
  const userId = session.user.id;
  const item = await prisma.sprintRetroItem.findUnique({
    where: { id: itemId },
    select: { id: true, sprintId: true, sprint: { select: { projectId: true, number: true } } },
  });
  if (!item) return { ok: false, error: 'Karte nicht gefunden' };

  const existing = await prisma.sprintRetroVote.findUnique({ where: { itemId_userId: { itemId, userId } } });
  if (existing) {
    await prisma.sprintRetroVote.delete({ where: { itemId_userId: { itemId, userId } } });
  } else {
    const used = await prisma.sprintRetroVote.count({ where: { userId, item: { sprintId: item.sprintId } } });
    if (used >= RETRO_VOTES_PER_PERSON) {
      return { ok: false, error: `Du hast deine ${RETRO_VOTES_PER_PERSON} Punkte schon verteilt. Nimm einen zurück, um neu zu setzen.` };
    }
    await prisma.sprintRetroVote.create({ data: { itemId, userId } });
  }
  revalidate(item.sprint.projectId, item.sprint.number);
  return { ok: true };
}

/**
 * Macht aus einer Massnahme ein GitLab-Issue, eingeplant im nächsten offenen
 * Sprint. So landet sie im Backlog statt in Vergessenheit.
 */
export async function actionToIssueAction(itemId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };
  const item = await prisma.sprintRetroItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      kind: true,
      text: true,
      issueIid: true,
      sprint: { select: { number: true, name: true, projectId: true, project: { select: { gitlabProjectId: true } } } },
    },
  });
  if (!item || item.kind !== 'action') return { ok: false, error: 'Nur Massnahmen werden zu Issues' };
  if (item.issueIid) return { ok: false, error: `Ist schon Issue #${item.issueIid}` };
  const { sprint } = item;

  const next = await prisma.sprint.findFirst({
    where: { projectId: sprint.projectId, number: { gt: sprint.number }, state: { not: 'closed' } },
    orderBy: { number: 'asc' },
    select: { number: true },
  });
  const labels = [RETRO_LABEL, ...(next ? [sprintLabel(next.number)] : [])];
  const title = item.text.split('\n')[0].slice(0, 200);
  const description = `Massnahme aus der Retrospektive von ${sprint.name}.\n\n${item.text}`;

  try {
    const client = await getGitlabClientForUser(session.user.id);
    const issue = (await client.Issues.create(sprint.project.gitlabProjectId, title, {
      description,
      labels: labels.join(','),
    })) as unknown as { iid: number };
    markSelfPush(issue.iid, sprint.projectId);
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 14);
    await prisma.$transaction([
      prisma.workPackage.create({
        data: {
          projectId: sprint.projectId,
          gitlabIssueIid: issue.iid,
          titleCache: title,
          descriptionCache: description,
          stateCache: 'opened',
          startDate: start,
          endDate: end,
          labelsCache: labels.map((name) => ({ name })),
          assigneesCache: [],
        },
      }),
      prisma.sprintRetroItem.update({ where: { id: item.id }, data: { issueIid: issue.iid } }),
    ]);
  } catch (err) {
    if (err instanceof GitlabTokenExpiredError) {
      return { ok: false, error: 'GitLab-Session abgelaufen. Bitte abmelden und neu anmelden.' };
    }
    logger.error({ err: err instanceof Error ? err.message : String(err), itemId }, 'Retro-Massnahme konnte kein Issue werden');
    return { ok: false, error: 'Das Issue konnte nicht angelegt werden' };
  }

  revalidate(sprint.projectId, sprint.number);
  revalidatePath(`/projects/${sprint.projectId}/board`);
  return { ok: true };
}
