'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getGitlabClientForUser } from '@/lib/gitlab/client';
import { GitlabTokenExpiredError } from '@/lib/auth/encrypted-adapter';
import { logger } from '@/lib/logger';

type MilestoneState = 'active' | 'closed';

export type MilestoneInput = {
  title: string;
  description?: string;
  dueDate?: string | null; // YYYY-MM-DD oder null
};

export type MilestonePatch = MilestoneInput & {
  state?: MilestoneState;
};

type ErrorResult = { ok: false; error: string; sessionExpired?: boolean; readonly?: boolean };

export type CreateMilestoneResult =
  | { ok: true; milestoneId: string; gitlabMilestoneId: number }
  | ErrorResult;

export type UpdateMilestoneResult = { ok: true } | ErrorResult;
export type DeleteMilestoneResult = { ok: true } | ErrorResult;

function sessionExpired(): ErrorResult {
  return {
    ok: false,
    error: 'GitLab-Session abgelaufen. Bitte abmelden und neu anmelden.',
    sessionExpired: true,
  };
}

// ─── Create ──────────────────────────────────────────────────────────────
export async function createMilestoneAction(
  projectInternalId: string,
  input: MilestoneInput,
): Promise<CreateMilestoneResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };

  if (!input.title.trim()) return { ok: false, error: 'Titel darf nicht leer sein' };

  const project = await prisma.project.findUnique({
    where: { id: projectInternalId },
    select: { id: true, gitlabProjectId: true },
  });
  if (!project) return { ok: false, error: 'Projekt nicht gefunden' };

  try {
    const client = await getGitlabClientForUser(session.user.id);

    // GitLab: POST /projects/:id/milestones
    const created = await client.ProjectMilestones.create(project.gitlabProjectId, input.title, {
      description: input.description ?? '',
      dueDate: input.dueDate ?? undefined,
    });
    const m = created as unknown as {
      id?: number;
      title?: string;
      description?: string | null;
      due_date?: string | null;
      state?: string;
    };
    if (typeof m.id !== 'number') {
      return { ok: false, error: 'GitLab lieferte keine Milestone-ID zurück' };
    }

    const dbMilestone = await prisma.$transaction(async (tx) => {
      const dbm = await tx.milestone.create({
        data: {
          projectId: project.id,
          gitlabMilestoneId: m.id!,
          titleCache: m.title ?? input.title,
          descriptionCache: m.description ?? input.description ?? null,
          dueDateCache: m.due_date ? new Date(m.due_date) : null,
          stateCache: m.state ?? 'active',
          isGroupMilestone: false,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: 'milestone.create',
          entityType: 'Milestone',
          entityId: dbm.id,
          after: { title: m.title ?? input.title, gitlabMilestoneId: m.id },
        },
      });
      return dbm;
    });

    revalidatePath(`/projects/${project.id}/gantt`);
    return { ok: true, milestoneId: dbMilestone.id, gitlabMilestoneId: m.id };
  } catch (err) {
    if (err instanceof GitlabTokenExpiredError) return sessionExpired();
    logger.error(
      { err: err instanceof Error ? err.message : String(err), projectInternalId },
      'Milestone-Erstellung fehlgeschlagen',
    );
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Erstellung fehlgeschlagen',
    };
  }
}

// ─── Update ──────────────────────────────────────────────────────────────
export async function updateMilestoneAction(
  milestoneId: string,
  patch: MilestonePatch,
): Promise<UpdateMilestoneResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };

  const m = await prisma.milestone.findUnique({
    where: { id: milestoneId },
    select: {
      id: true,
      gitlabMilestoneId: true,
      titleCache: true,
      descriptionCache: true,
      dueDateCache: true,
      stateCache: true,
      isGroupMilestone: true,
      project: { select: { id: true, gitlabProjectId: true } },
    },
  });
  if (!m) return { ok: false, error: 'Meilenstein nicht gefunden' };

  if (m.isGroupMilestone) {
    return {
      ok: false,
      readonly: true,
      error: 'Group-Meilenstein — Bearbeitung nur in GitLab im Gruppen-Kontext möglich.',
    };
  }

  try {
    const client = await getGitlabClientForUser(session.user.id);

    // Felder die an GitLab gehen
    const gitlabUpdate: Record<string, unknown> = {};
    if (patch.title !== undefined && patch.title !== m.titleCache) {
      gitlabUpdate.title = patch.title;
    }
    if (patch.description !== undefined && patch.description !== (m.descriptionCache ?? '')) {
      gitlabUpdate.description = patch.description;
    }
    if (patch.dueDate !== undefined) {
      const newIso = patch.dueDate;
      const oldIso = m.dueDateCache ? m.dueDateCache.toISOString().slice(0, 10) : null;
      if (newIso !== oldIso) gitlabUpdate.dueDate = newIso ?? '';
    }
    if (patch.state !== undefined && patch.state !== m.stateCache) {
      // GitLab erwartet stateEvent: 'close' | 'activate'
      gitlabUpdate.stateEvent = patch.state === 'closed' ? 'close' : 'activate';
    }

    if (Object.keys(gitlabUpdate).length > 0) {
      await client.ProjectMilestones.edit(
        m.project.gitlabProjectId,
        m.gitlabMilestoneId,
        gitlabUpdate,
      );
    }

    // DB-Spiegelung
    await prisma.$transaction(async (tx) => {
      const dbPatch: Record<string, unknown> = { lastSyncedAt: new Date() };
      if (patch.title !== undefined) dbPatch.titleCache = patch.title;
      if (patch.description !== undefined) dbPatch.descriptionCache = patch.description;
      if (patch.dueDate !== undefined) {
        dbPatch.dueDateCache = patch.dueDate ? new Date(patch.dueDate) : null;
      }
      if (patch.state !== undefined) dbPatch.stateCache = patch.state;
      await tx.milestone.update({
        where: { id: milestoneId },
        data: dbPatch,
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: 'milestone.update',
          entityType: 'Milestone',
          entityId: milestoneId,
          before: {
            title: m.titleCache,
            dueDate: m.dueDateCache?.toISOString().slice(0, 10) ?? null,
            state: m.stateCache,
          },
          after: patch,
        },
      });
    });

    revalidatePath(`/projects/${m.project.id}/gantt`);
    return { ok: true };
  } catch (err) {
    if (err instanceof GitlabTokenExpiredError) return sessionExpired();
    logger.error(
      { err: err instanceof Error ? err.message : String(err), milestoneId },
      'Milestone-Update fehlgeschlagen',
    );
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Update fehlgeschlagen',
    };
  }
}

// ─── Delete ──────────────────────────────────────────────────────────────
export async function deleteMilestoneAction(milestoneId: string): Promise<DeleteMilestoneResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };

  const m = await prisma.milestone.findUnique({
    where: { id: milestoneId },
    select: {
      id: true,
      titleCache: true,
      gitlabMilestoneId: true,
      isGroupMilestone: true,
      project: { select: { id: true, gitlabProjectId: true } },
    },
  });
  if (!m) return { ok: false, error: 'Meilenstein nicht gefunden' };

  if (m.isGroupMilestone) {
    return {
      ok: false,
      readonly: true,
      error: 'Group-Meilenstein kann nur in GitLab im Gruppen-Kontext gelöscht werden.',
    };
  }

  try {
    const client = await getGitlabClientForUser(session.user.id);

    await client.ProjectMilestones.remove(m.project.gitlabProjectId, m.gitlabMilestoneId);

    await prisma.$transaction(async (tx) => {
      await tx.milestone.delete({ where: { id: milestoneId } });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: 'milestone.delete',
          entityType: 'Milestone',
          entityId: milestoneId,
          before: { title: m.titleCache, gitlabMilestoneId: m.gitlabMilestoneId },
        },
      });
    });

    revalidatePath(`/projects/${m.project.id}/gantt`);
    return { ok: true };
  } catch (err) {
    if (err instanceof GitlabTokenExpiredError) return sessionExpired();
    logger.error(
      { err: err instanceof Error ? err.message : String(err), milestoneId },
      'Milestone-Löschung fehlgeschlagen',
    );
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Löschen fehlgeschlagen',
    };
  }
}
