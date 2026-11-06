'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getGitlabClientForUser } from '@/lib/gitlab/client';
import { performInitialSync, syncAllWorkPackageMergeRequests } from '@/lib/gitlab/sync';
import { loadTaskParentsForUser } from '@/lib/gitlab/tasks';
import { logger } from '@/lib/logger';
import { GitlabTokenExpiredError } from '@/lib/auth/encrypted-adapter';
import { syncSummaryLabels } from '@/lib/gitlab/summary-label';
import { isDemoMode } from '@/lib/demo/mode';

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
    select: { id: true, gitlabProjectId: true, nameCache: true },
  });
  if (!project) return { ok: false, error: 'Projekt nicht gefunden' };

  // Im Demo-Modus gibt es keine Gegenstelle, aus der sich etwas nachladen
  // liesse — ein echter Sync würde die Daten leerräumen. Stattdessen setzt
  // der Knopf auf den Beispieldatensatz zurück, was in einer Demo ohnehin
  // das ist, was man von "neu laden" erwartet.
  if (isDemoMode()) return resyncDemoProject(project.gitlabProjectId);

  try {
    // getGitlabClientForUser kann GitlabTokenExpiredError werfen wenn der
    // Refresh-Token auch tot ist. Muss INNERHALB des try-Blocks stehen,
    // sonst crashed die Server-Action und der User sieht ein Error-Overlay
    // statt einer freundlichen Meldung.
    const client = await getGitlabClientForUser(session.user.id);
    const taskParents = await loadTaskParentsForUser(session.user.id, project.nameCache);

    const sync = await prisma.$transaction(
      async (tx) => {
        const result = await performInitialSync(
          tx,
          client,
          project.id,
          project.gitlabProjectId,
          { taskParents },
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

/**
 * Demo-Variante des Re-Syncs: schreibt den Beispieldatensatz neu.
 *
 * Dieselbe Operation, die auch der Auto-Reset im Startup-Hook fährt
 * (src/instrumentation.ts) — nur eben auf Knopfdruck. Die Projekt-ID ist im
 * Seed fest vergeben, die aktuelle URL bleibt also gültig; die Demo-Session
 * wird mit demselben Token neu angelegt, der Tab bleibt eingeloggt.
 *
 * Kein AuditLog-Eintrag: der Seed leert die Tabelle ohnehin gleich wieder,
 * und die alte userId existiert nach dem Reset nicht mehr.
 */
async function resyncDemoProject(gitlabProjectId: number): Promise<ResyncResult> {
  // Dynamisch, damit der Seed-Datensatz nicht in jedem Server-Bundle landet.
  const { seedDemoData } = await import('@/lib/demo/seed');
  const { resetDemoNotes } = await import('@/lib/gitlab/demo-client');

  try {
    const result = await seedDemoData(prisma);
    // Kommentare liegen prozesslokal, nicht in der DB — separat zurücksetzen.
    resetDemoNotes(gitlabProjectId);
    logger.info({ reason: 'resync-button', ...result }, 'Demo: Daten zurückgesetzt');

    // Der Reset betrifft jede Ansicht, nicht nur das Gantt — deshalb der
    // Layout-weite Revalidate statt einzelner Pfade.
    revalidatePath('/', 'layout');

    return {
      ok: true,
      counts: {
        workPackages: result.workPackages,
        milestones: result.milestones,
        parentLinks: 0,
        dependencies: result.dependencies,
      },
    };
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'Demo: Reset über Sync-Knopf fehlgeschlagen',
    );
    return { ok: false, error: 'Demo-Daten konnten nicht zurückgesetzt werden' };
  }
}
