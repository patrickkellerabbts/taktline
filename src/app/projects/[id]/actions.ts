'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getGitlabClientForUser } from '@/lib/gitlab/client';
import { performInitialSync, syncAllWorkPackageMergeRequests } from '@/lib/gitlab/sync';
import { logger } from '@/lib/logger';
import { GitlabTokenExpiredError } from '@/lib/auth/encrypted-adapter';
import { syncSummaryLabels } from '@/lib/gitlab/summary-label';

export type ResyncResult =
  | {
      ok: true;
      counts: {
        workPackages: number;
        milestones: number;
        parentLinks: number;
        dependencies: number;
      };
    }
  | { ok: false; error: string; sessionExpired?: boolean };

// Idempotenter Re-Sync gegen das bestehende Projekt — ruft performInitialSync,
// das via upsert sauber Updates macht und keine Daten verwaisen lässt.
export async function resyncProjectAction(projectId: string): Promise<ResyncResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, gitlabProjectId: true },
  });
  if (!project) return { ok: false, error: 'Projekt nicht gefunden' };

  try {
    // getGitlabClientForUser kann GitlabTokenExpiredError werfen wenn der
    // Refresh-Token auch tot ist. Muss INNERHALB des try-Blocks stehen,
    // sonst crashed die Server-Action und der User sieht ein Error-Overlay
    // statt einer freundlichen Meldung.
    const client = await getGitlabClientForUser(session.user.id);

    const sync = await prisma.$transaction(
      async (tx) => {
        const result = await performInitialSync(
          tx,
          client,
          project.id,
          project.gitlabProjectId,
        );
        await tx.project.update({
          where: { id: project.id },
          data: { lastFullSyncAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            userId: session.user.id,
            action: 'project.resync',
            entityType: 'Project',
            entityId: project.id,
            after: { counts: result },
          },
        });
        return result;
      },
      { timeout: 30_000 },
    );

    // gantt::summary Labels in GitLab nachziehen (best-effort, nach Tx-Commit
    // damit die isSummary-Werte committed sind und syncSummaryLabels sie sieht)
    if (sync.summaryCandidateIds.length > 0) {
      await syncSummaryLabels(
        client,
        project.id,
        project.gitlabProjectId,
        sync.summaryCandidateIds,
      );
    }

    // MRs + Pipelines pro WP — ausserhalb der DB-Tx weil pro WP ein
    // GitLab-Roundtrip nötig ist. Sequenziell um Rate-Limits zu schonen;
    // soft-fail pro WP (Logger-Warning, kein Abbruch).
    try {
      await syncAllWorkPackageMergeRequests(
        client,
        project.id,
        project.gitlabProjectId,
      );
    } catch (err) {
      logger.warn({ err: String(err) }, 'MR-Bulk-Sync nach Resync fehlgeschlagen');
    }

    revalidatePath(`/projects/${projectId}/gantt`);
    revalidatePath('/projects');

    return {
      ok: true,
      counts: {
        workPackages: sync.workPackagesSynced,
        milestones: sync.milestonesSynced,
        parentLinks: sync.parentLinksResolved,
        dependencies: sync.dependenciesResolved,
      },
    };
  } catch (err) {
    if (err instanceof GitlabTokenExpiredError) {
      logger.warn({ projectId, userId: session.user.id }, 'Re-Sync: Token abgelaufen');
      return {
        ok: false,
        error: 'GitLab-Session abgelaufen. Bitte abmelden und neu anmelden.',
        sessionExpired: true,
      };
    }
    logger.error(
      { err: err instanceof Error ? err.message : String(err), projectId },
      'Re-Sync fehlgeschlagen',
    );
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Re-Sync fehlgeschlagen',
    };
  }
}
