'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getGitlabClientForUser } from '@/lib/gitlab/client';
import { parseGanttMeta, serializeGanttMeta, type GanttMeta } from '@/lib/gitlab/meta';
import { markSelfPush } from '@/lib/gitlab/self-push';
import { GitlabTokenExpiredError } from '@/lib/auth/encrypted-adapter';
import { logger } from '@/lib/logger';
import { isStory, labelNames } from '@/lib/agile/board';
import { ADOPTABLE_POINTS, isPokerCardValue } from '@/lib/agile/poker';

type ActionResult = { ok: true } | { ok: false; error: string };

/** Prüft Anmeldung und dass die Story offen ist und zum Projekt gehört. */
async function storyContext(projectId: string, workPackageId: string) {
  const session = await auth();
  if (!session?.user?.id) return { error: 'Nicht angemeldet' } as const;
  const wp = await prisma.workPackage.findFirst({
    where: { id: workPackageId, projectId, deletedAt: null },
    select: {
      id: true,
      gitlabIssueIid: true,
      descriptionCache: true,
      labelsCache: true,
      stateCache: true,
      storyPoints: true,
      project: { select: { id: true, gitlabProjectId: true } },
    },
  });
  if (!wp || !isStory(labelNames(wp.labelsCache))) return { error: 'Story nicht gefunden' } as const;
  if (wp.stateCache === 'closed') return { error: 'Die Story ist schon erledigt' } as const;
  const current = await prisma.estimationRound.findFirst({
    where: { workPackageId },
    orderBy: { number: 'desc' },
    select: { id: true, number: true, revealedAt: true, result: true, _count: { select: { votes: true } } },
  });
  return { userId: session.user.id, wp, current } as const;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}/poker`);
}

export async function castVoteAction(projectId: string, workPackageId: string, value: string): Promise<ActionResult> {
  if (!isPokerCardValue(value)) return { ok: false, error: 'Unbekannte Karte' };
  const ctx = await storyContext(projectId, workPackageId);
  if ('error' in ctx) return { ok: false, error: ctx.error as string };
  if (ctx.current?.revealedAt) {
    return { ok: false, error: 'Diese Runde ist schon aufgedeckt. Starte eine neue Runde.' };
  }

  let roundId = ctx.current?.id;
  if (!roundId) {
    try {
      roundId = (
        await prisma.estimationRound.create({
          data: { projectId, workPackageId, number: 1, createdByUserId: ctx.userId },
          select: { id: true },
        })
      ).id;
    } catch (err) {
      // Jemand anderes hat die Runde im selben Moment eröffnet.
      if (!isUniqueViolation(err)) throw err;
      const existing = await prisma.estimationRound.findFirst({
        where: { workPackageId, number: 1 },
        select: { id: true },
      });
      if (!existing) return { ok: false, error: 'Die Runde konnte nicht eröffnet werden' };
      roundId = existing.id;
    }
  }

  // Bedingtes Update statt Lesen und Schreiben: Wird gerade aufgedeckt, darf
  // keine Karte mehr dazukommen oder sich ändern.
  const open = await prisma.estimationRound.count({ where: { id: roundId, revealedAt: null } });
  if (!open) return { ok: false, error: 'Diese Runde wurde gerade aufgedeckt' };
  await prisma.estimationVote.upsert({
    where: { roundId_userId: { roundId, userId: ctx.userId } },
    create: { roundId, userId: ctx.userId, value },
    update: { value },
  });
  revalidate(projectId);
  return { ok: true };
}

export async function withdrawVoteAction(projectId: string, workPackageId: string): Promise<ActionResult> {
  const ctx = await storyContext(projectId, workPackageId);
  if ('error' in ctx) return { ok: false, error: ctx.error as string };
  if (!ctx.current || ctx.current.revealedAt) return { ok: false, error: 'Keine offene Runde' };
  await prisma.estimationVote.deleteMany({ where: { roundId: ctx.current.id, userId: ctx.userId } });
  revalidate(projectId);
  return { ok: true };
}

export async function revealAction(projectId: string, workPackageId: string): Promise<ActionResult> {
  const ctx = await storyContext(projectId, workPackageId);
  if ('error' in ctx) return { ok: false, error: ctx.error as string };
  if (!ctx.current || ctx.current._count.votes === 0) return { ok: false, error: 'Es liegt noch keine Karte' };
  // Nur die erste Person deckt auf; ein zweiter Klick ändert nichts.
  await prisma.estimationRound.updateMany({
    where: { id: ctx.current.id, revealedAt: null },
    data: { revealedAt: new Date() },
  });
  revalidate(projectId);
  return { ok: true };
}

export async function newRoundAction(projectId: string, workPackageId: string): Promise<ActionResult> {
  const ctx = await storyContext(projectId, workPackageId);
  if ('error' in ctx) return { ok: false, error: ctx.error as string };
  if (ctx.current && !ctx.current.revealedAt) return { ok: false, error: 'Die aktuelle Runde ist noch offen' };
  try {
    await prisma.estimationRound.create({
      data: {
        projectId,
        workPackageId,
        number: (ctx.current?.number ?? 0) + 1,
        createdByUserId: ctx.userId,
      },
    });
  } catch (err) {
    // Gleichzeitig hat jemand dieselbe neue Runde gestartet: Ergebnis ist dasselbe.
    if (!isUniqueViolation(err)) throw err;
  }
  revalidate(projectId);
  return { ok: true };
}

/** Übernimmt das Ergebnis als Story Points in GitLab (gantt-meta) und in die DB. */
export async function adoptEstimateAction(
  projectId: string,
  workPackageId: string,
  points: number,
): Promise<ActionResult> {
  if (!(ADOPTABLE_POINTS as readonly number[]).includes(points)) {
    return { ok: false, error: 'Story Points müssen ein Wert aus dem Deck sein' };
  }
  const ctx = await storyContext(projectId, workPackageId);
  if ('error' in ctx) return { ok: false, error: ctx.error as string };
  if (!ctx.current?.revealedAt) return { ok: false, error: 'Erst aufdecken, dann übernehmen' };

  const { wp } = ctx;
  const meta: GanttMeta = { ...(parseGanttMeta(wp.descriptionCache) ?? {}), story_points: points };
  const description = serializeGanttMeta(wp.descriptionCache, meta);

  try {
    if (description !== (wp.descriptionCache ?? '')) {
      const client = await getGitlabClientForUser(ctx.userId);
      markSelfPush(wp.gitlabIssueIid, wp.project.id);
      await client.Issues.edit(wp.project.gitlabProjectId, wp.gitlabIssueIid, { description });
    }
    await prisma.$transaction([
      prisma.workPackage.update({
        where: { id: wp.id },
        data: { descriptionCache: description, storyPoints: points, lastSyncedAt: new Date() },
      }),
      prisma.estimationRound.update({
        where: { id: ctx.current.id },
        data: { result: points, adoptedAt: new Date() },
      }),
      prisma.auditLog.create({
        data: {
          userId: ctx.userId,
          action: 'work_package.estimate',
          entityType: 'WorkPackage',
          entityId: wp.id,
          before: { storyPoints: wp.storyPoints },
          after: { storyPoints: points, round: ctx.current.number },
        },
      }),
    ]);
  } catch (err) {
    if (err instanceof GitlabTokenExpiredError) {
      return { ok: false, error: 'GitLab-Session abgelaufen. Bitte abmelden und neu anmelden.' };
    }
    logger.error({ err: err instanceof Error ? err.message : String(err), workPackageId }, 'Schätzung konnte nicht übernommen werden');
    return { ok: false, error: 'Die Story Points konnten nicht gespeichert werden' };
  }

  revalidate(projectId);
  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}/sprints`);
  return { ok: true };
}
