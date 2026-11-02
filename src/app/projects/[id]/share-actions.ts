'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getGitlabClientForUser } from '@/lib/gitlab/client';
import { GitlabTokenExpiredError } from '@/lib/auth/encrypted-adapter';
import { generateShareToken, hashShareToken } from '@/lib/share/links';
import { logger } from '@/lib/logger';

const MAINTAINER_ACCESS_LEVEL = 40;
const MAX_LIFETIME_DAYS = 366;

type Failure = { ok: false; error: string; sessionExpired?: boolean };

export type ShareLinkRow = {
  id: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdBy: string | null;
};

/**
 * Links darf nur anlegen, wer das Projekt auch in GitLab verwaltet. Scheitert
 * die Prüfung (GitLab down, Fehler), gibt es keinen Zugriff.
 */
async function authorizeMaintainer(
  projectId: string,
): Promise<{ ok: true; userId: string } | Failure> {
  const session = await auth();
  const userId = session?.user?.id;
  const gitlabUserId = session?.user?.gitlabUserId;
  if (!userId || !gitlabUserId) return { ok: false, error: 'Nicht angemeldet' };

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { gitlabProjectId: true },
  });
  if (!project) return { ok: false, error: 'Projekt nicht gefunden' };

  const denied: Failure = {
    ok: false,
    error: 'Lese-Links können nur Maintainer des GitLab-Projekts verwalten.',
  };
  try {
    const client = await getGitlabClientForUser(userId);
    const member = (await client.ProjectMembers.show(project.gitlabProjectId, gitlabUserId, {
      includeInherited: true,
    })) as unknown as { access_level?: number };
    if ((member.access_level ?? 0) < MAINTAINER_ACCESS_LEVEL) return denied;
    return { ok: true, userId };
  } catch (err) {
    if (err instanceof GitlabTokenExpiredError) {
      return {
        ok: false,
        error: 'GitLab-Session abgelaufen. Bitte abmelden und neu anmelden.',
        sessionExpired: true,
      };
    }
    const status = (err as { cause?: { response?: { status?: number } } }).cause?.response?.status;
    if (status === 404) return denied; // kein Mitglied des Projekts
    logger.warn({ err: String(err), projectId }, 'Maintainer-Prüfung fehlgeschlagen');
    return { ok: false, error: 'Die Rolle konnte in GitLab nicht geprüft werden.' };
  }
}

export async function listShareLinksAction(
  projectId: string,
): Promise<{ ok: true; links: ShareLinkRow[] } | Failure> {
  const authz = await authorizeMaintainer(projectId);
  if (!authz.ok) return authz;

  const links = await prisma.shareLink.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      label: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
      createdBy: { select: { name: true, username: true } },
    },
  });
  return {
    ok: true,
    links: links.map((l) => ({
      id: l.id,
      label: l.label,
      createdAt: l.createdAt.toISOString(),
      expiresAt: l.expiresAt.toISOString(),
      revokedAt: l.revokedAt?.toISOString() ?? null,
      lastUsedAt: l.lastUsedAt?.toISOString() ?? null,
      createdBy: l.createdBy?.name ?? l.createdBy?.username ?? null,
    })),
  };
}

const CreateSchema = z.object({
  label: z.string().trim().min(1, 'Bitte einen Namen angeben').max(100, 'Der Name ist zu lang'),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Bitte ein Ablaufdatum wählen'),
});

/** Das Token gibt es nur in dieser Antwort; gespeichert wird nur sein Hash. */
export async function createShareLinkAction(
  projectId: string,
  input: { label: string; expiresOn: string },
): Promise<{ ok: true; path: string; baseUrl: string | null } | Failure> {
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  // Der Link gilt bis zum Ende des gewählten Tages (UTC).
  const expiresAt = new Date(`${parsed.data.expiresOn}T23:59:59.999Z`);
  const now = Date.now();
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now) {
    return { ok: false, error: 'Das Ablaufdatum muss in der Zukunft liegen' };
  }
  if (expiresAt.getTime() > now + MAX_LIFETIME_DAYS * 86_400_000) {
    return { ok: false, error: 'Ein Link kann höchstens ein Jahr gültig sein' };
  }

  const authz = await authorizeMaintainer(projectId);
  if (!authz.ok) return authz;

  const token = generateShareToken();
  await prisma.$transaction(async (tx) => {
    const link = await tx.shareLink.create({
      data: {
        projectId,
        label: parsed.data.label,
        tokenHash: hashShareToken(token),
        createdByUserId: authz.userId,
        expiresAt,
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        userId: authz.userId,
        action: 'share_link.create',
        entityType: 'ShareLink',
        entityId: link.id,
        after: { projectId, label: parsed.data.label, expiresAt: expiresAt.toISOString() },
      },
    });
  });

  revalidatePath(`/projects/${projectId}/gantt`);
  return { ok: true, path: `/share/${token}`, baseUrl: process.env.AUTH_URL ?? null };
}

export async function revokeShareLinkAction(
  projectId: string,
  linkId: string,
): Promise<{ ok: true } | Failure> {
  const authz = await authorizeMaintainer(projectId);
  if (!authz.ok) return authz;

  await prisma.$transaction(async (tx) => {
    // projectId im Filter: die Rolle wurde nur für dieses Projekt geprüft.
    const { count } = await tx.shareLink.updateMany({
      where: { id: linkId, projectId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count > 0) {
      await tx.auditLog.create({
        data: {
          userId: authz.userId,
          action: 'share_link.revoke',
          entityType: 'ShareLink',
          entityId: linkId,
          after: { projectId },
        },
      });
    }
  });
  return { ok: true };
}
