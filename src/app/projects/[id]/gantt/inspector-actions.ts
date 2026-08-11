'use server';

// Server-Actions die der Inspector lazy lädt — verlinkte Merge Requests
// + Pipeline-Status, sowie Issue-Comments (Notes). Werden NICHT beim
// regulären Sync mitgezogen weil sie pro Issue separat geladen werden
// müssten (N+1-Roundtrip). Stattdessen on-demand wenn der User den
// Inspector öffnet.

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getGitlabClientForUser } from '@/lib/gitlab/client';
import { syncWorkPackageMergeRequests } from '@/lib/gitlab/sync';
import { GitlabTokenExpiredError } from '@/lib/auth/encrypted-adapter';
import { logger } from '@/lib/logger';

function sessionExpiredResult() {
  return {
    ok: false as const,
    error: 'GitLab-Session abgelaufen. Bitte abmelden und neu anmelden.',
    sessionExpired: true as const,
  };
}

// ─── Merge Requests / Pipeline-Refresh ──────────────────────────────
// MRs werden beim regulären Sync mitgezogen und via Webhook live gehalten;
// diese Action ist nur der Refresh-Button im Inspector für expliziten
// Re-Sync eines einzelnen WPs (Fallback wenn Webhooks aussetzen).

// Forciert ein Re-Sync der MRs+Pipelines für einen einzelnen WP. Im
// Normalfall hält der Webhook das frisch — der Refresh-Button im Inspector
// ist für den Fall dass der Webhook ausgefallen oder noch nicht eingerichtet
// ist.
export async function refreshWorkPackageMrsAction(
  workPackageId: string,
): Promise<{ ok: true } | { ok: false; error: string; sessionExpired?: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };

  const wp = await prisma.workPackage.findUnique({
    where: { id: workPackageId },
    select: {
      gitlabIssueIid: true,
      project: { select: { id: true, gitlabProjectId: true } },
    },
  });
  if (!wp) return { ok: false, error: 'Work Package nicht gefunden' };

  try {
    const client = await getGitlabClientForUser(session.user.id);
    await syncWorkPackageMergeRequests(
      client,
      wp.project.gitlabProjectId,
      workPackageId,
      wp.gitlabIssueIid,
    );
    revalidatePath(`/projects/${wp.project.id}/gantt`);
    return { ok: true };
  } catch (err) {
    if (err instanceof GitlabTokenExpiredError) return sessionExpiredResult();
    logger.warn({ err: String(err) }, 'refreshWorkPackageMrsAction fehlgeschlagen');
    // Bewusst ohne Ursachenbehauptung: hier landet auch, was gar nicht von
    // GitLab kommt (DB, Serialisierung). Ein "GitLab-API-Fehler" schickt die
    // Fehlersuche dann in die falsche Richtung — Details stehen im Log.
    return { ok: false, error: 'Aktualisieren fehlgeschlagen' };
  }
}

// ─── Project-Labels Refresh ──────────────────────────────────────────
// Forciert ein Refresh der ProjectLabels für ein Projekt. Wird vom Inspector
// beim Öffnen des Label-Pickers getriggert damit zwischen-Sync in GitLab
// neu erstellte Labels sofort verfügbar sind.
export async function refreshProjectLabelsAction(
  workPackageId: string,
): Promise<
  | { ok: true; labels: Array<{ name: string; color?: string }> }
  | { ok: false; error: string; sessionExpired?: boolean }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };

  const wp = await prisma.workPackage.findUnique({
    where: { id: workPackageId },
    select: {
      project: { select: { id: true, gitlabProjectId: true } },
    },
  });
  if (!wp) return { ok: false, error: 'Work Package nicht gefunden' };

  try {
    const client = await getGitlabClientForUser(session.user.id);
    const raw = (await client.ProjectLabels.all(wp.project.gitlabProjectId, {
      perPage: 100,
      includeAncestorGroups: true,
    })) as Array<Record<string, unknown>>;

    const fetchedNames = new Set<string>();
    for (const l of raw) {
      const name = l.name as string;
      if (!name) continue;
      fetchedNames.add(name);
      await prisma.projectLabel.upsert({
        where: {
          projectId_name: { projectId: wp.project.id, name },
        },
        create: {
          projectId: wp.project.id,
          name,
          color: (l.color as string | null) ?? null,
          textColor: (l.text_color as string | null) ?? null,
          description: (l.description as string | null) ?? null,
        },
        update: {
          color: (l.color as string | null) ?? null,
          textColor: (l.text_color as string | null) ?? null,
          description: (l.description as string | null) ?? null,
          lastSyncedAt: new Date(),
        },
      });
    }
    // Verwaiste Cache-Einträge entfernen
    const existing = await prisma.projectLabel.findMany({
      where: { projectId: wp.project.id },
      select: { id: true, name: true },
    });
    const orphans = existing.filter((l) => !fetchedNames.has(l.name));
    if (orphans.length > 0) {
      await prisma.projectLabel.deleteMany({
        where: { id: { in: orphans.map((o) => o.id) } },
      });
    }

    const labels = raw
      .map((l) => ({
        name: l.name as string,
        color: (l.color as string | undefined) ?? undefined,
      }))
      .filter((l) => !!l.name)
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));

    revalidatePath(`/projects/${wp.project.id}/gantt`);
    return { ok: true, labels };
  } catch (err) {
    if (err instanceof GitlabTokenExpiredError) return sessionExpiredResult();
    logger.warn({ err: String(err) }, 'refreshProjectLabelsAction fehlgeschlagen');
    return { ok: false, error: 'GitLab-API-Fehler beim Laden der Labels' };
  }
}

// ─── Issue-Notes (Comments) ───────────────────────────────────────────

export type IssueNote = {
  id: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  authorName: string;
  authorUsername: string;
  authorAvatarUrl: string | null;
  authorWebUrl: string | null;
};

export async function getIssueNotesAction(
  workPackageId: string,
): Promise<
  | { ok: true; notes: IssueNote[] }
  | { ok: false; error: string; sessionExpired?: boolean }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };

  const wp = await prisma.workPackage.findUnique({
    where: { id: workPackageId },
    select: {
      gitlabIssueIid: true,
      project: { select: { gitlabProjectId: true } },
    },
  });
  if (!wp) return { ok: false, error: 'Work Package nicht gefunden' };

  try {
    const client = await getGitlabClientForUser(session.user.id);
    const raw = await client.IssueNotes.all(
      wp.project.gitlabProjectId,
      wp.gitlabIssueIid,
      { sort: 'asc', orderBy: 'created_at', perPage: 100 },
    );
    // System-Notes (z.B. "changed status from Open to Closed") rausfiltern —
    // echte User-Comments haben system: false.
    const notes: IssueNote[] = (raw as Array<Record<string, unknown>>)
      .filter((n) => n.system !== true)
      .map((n) => {
        const author = n.author as Record<string, unknown>;
        return {
          id: n.id as number,
          body: (n.body as string) ?? '',
          createdAt: (n.created_at as string) ?? '',
          updatedAt: (n.updated_at as string) ?? '',
          authorName: (author?.name as string) ?? '',
          authorUsername: (author?.username as string) ?? '',
          authorAvatarUrl: (author?.avatar_url as string | null) ?? null,
          authorWebUrl: (author?.web_url as string | null) ?? null,
        };
      });
    return { ok: true, notes };
  } catch (err) {
    if (err instanceof GitlabTokenExpiredError) return sessionExpiredResult();
    logger.warn({ err: String(err) }, 'getIssueNotesAction fehlgeschlagen');
    return { ok: false, error: 'GitLab-API-Fehler beim Laden der Kommentare' };
  }
}

export async function addIssueNoteAction(
  workPackageId: string,
  body: string,
): Promise<
  | { ok: true; note: IssueNote }
  | { ok: false; error: string; sessionExpired?: boolean }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: 'Kommentar darf nicht leer sein' };

  const wp = await prisma.workPackage.findUnique({
    where: { id: workPackageId },
    select: {
      gitlabIssueIid: true,
      project: { select: { gitlabProjectId: true } },
    },
  });
  if (!wp) return { ok: false, error: 'Work Package nicht gefunden' };

  try {
    const client = await getGitlabClientForUser(session.user.id);
    const raw = (await client.IssueNotes.create(
      wp.project.gitlabProjectId,
      wp.gitlabIssueIid,
      trimmed,
    )) as Record<string, unknown>;
    const author = raw.author as Record<string, unknown>;
    const note: IssueNote = {
      id: raw.id as number,
      body: (raw.body as string) ?? '',
      createdAt: (raw.created_at as string) ?? '',
      updatedAt: (raw.updated_at as string) ?? '',
      authorName: (author?.name as string) ?? '',
      authorUsername: (author?.username as string) ?? '',
      authorAvatarUrl: (author?.avatar_url as string | null) ?? null,
      authorWebUrl: (author?.web_url as string | null) ?? null,
    };
    return { ok: true, note };
  } catch (err) {
    if (err instanceof GitlabTokenExpiredError) return sessionExpiredResult();
    logger.warn({ err: String(err) }, 'addIssueNoteAction fehlgeschlagen');
    return { ok: false, error: 'GitLab-API-Fehler beim Speichern des Kommentars' };
  }
}
