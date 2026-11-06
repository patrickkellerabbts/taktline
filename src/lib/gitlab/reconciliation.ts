// Reconciliation-Job: holt periodisch alle Projekte aus GitLab neu rein.
// Sicherheitsnetz für verlorene Webhooks (Network-Ausfall, Container-Restart,
// Maintenance-Fenster). Standard-Interval: 15 Minuten (FR-S4).
//
// Token-Strategie: jedes Projekt nutzt den Token des Users, der das Projekt
// aktiviert hat (Project.activatedByUserId). Wenn dessen Token nicht mehr
// erneuerbar ist, wird das Projekt übersprungen und geloggt — andere Projekte
// laufen unverändert weiter.
//
// Locking: per-Projekt In-Memory-Set, damit sich ein langer Run nicht mit dem
// nächsten Tick überschneidet. Kein Multi-Instance-Lock — wir laufen
// single-Container.

import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getGitlabClientForUser } from './client';
import { performInitialSync } from './sync';
import { loadTaskParentsForUser } from './tasks';
import { recordBoardSnapshot } from '@/lib/agile/flow';
import { syncSummaryLabels } from './summary-label';
import { GitlabTokenExpiredError } from '@/lib/auth/encrypted-adapter';

const inProgress = new Set<string>();

export type ReconciliationResult = {
  projectId: string;
  ok: boolean;
  durationMs: number;
  workPackagesSynced?: number;
  milestonesSynced?: number;
  error?: string;
};

export async function reconcileProject(projectId: string): Promise<ReconciliationResult> {
  const startedAt = Date.now();

  if (inProgress.has(projectId)) {
    return {
      projectId,
      ok: false,
      durationMs: 0,
      error: 'Already in progress',
    };
  }
  inProgress.add(projectId);

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, gitlabProjectId: true, activatedByUserId: true, nameCache: true },
    });
    if (!project) {
      return { projectId, ok: false, durationMs: 0, error: 'Project not found' };
    }

    const client = await getGitlabClientForUser(project.activatedByUserId);
    const taskParents = await loadTaskParentsForUser(project.activatedByUserId, project.nameCache);

    const result = await prisma.$transaction(
      async (tx) => {
        const sync = await performInitialSync(
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
            userId: project.activatedByUserId,
            action: 'project.reconcile',
            entityType: 'Project',
            entityId: project.id,
            after: { counts: sync },
          },
        });
        return sync;
      },
      { timeout: 60_000 },
    );

    // gantt::summary Labels nachziehen (best-effort, nach Tx-Commit)
    if (result.summaryCandidateIds.length > 0) {
      await syncSummaryLabels(
        client,
        project.id,
        project.gitlabProjectId,
        result.summaryCandidateIds,
      );
    }

    // Cumulative Flow: auch an Tagen ohne Klick im Board einen Stand festhalten.
    await recordBoardSnapshot(project.id);

    const durationMs = Date.now() - startedAt;
    logger.info(
      {
        projectId,
        projectName: project.nameCache,
        durationMs,
        workPackages: result.workPackagesSynced,
        milestones: result.milestonesSynced,
      },
      'Reconciliation: Projekt synchronisiert',
    );

    return {
      projectId,
      ok: true,
      durationMs,
      workPackagesSynced: result.workPackagesSynced,
      milestonesSynced: result.milestonesSynced,
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);

    if (err instanceof GitlabTokenExpiredError) {
      logger.warn(
        { projectId, durationMs },
        'Reconciliation: Token expired/refresh failed — Projekt übersprungen',
      );
    } else {
      logger.error({ projectId, durationMs, err: message }, 'Reconciliation: Fehler');
    }

    return { projectId, ok: false, durationMs, error: message };
  } finally {
    inProgress.delete(projectId);
  }
}

export async function reconcileAllProjects(): Promise<{
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  results: ReconciliationResult[];
}> {
  const startedAt = new Date();
  logger.info('Reconciliation: Run gestartet');

  const projects = await prisma.project.findMany({
    select: { id: true },
  });

  const results: ReconciliationResult[] = [];
  // Sequentiell statt parallel: GitLab-API-Rate-Limits respektieren und
  // PostgreSQL-Transaction-Pool nicht überlasten. Bei N=10 Projekten und
  // typisch 3-5s pro Sync ist die Gesamtdauer komfortabel unter 1 Min.
  for (const p of projects) {
    const r = await reconcileProject(p.id);
    results.push(r);
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;

  logger.info(
    {
      durationMs,
      total: results.length,
      ok: okCount,
      failed: failCount,
    },
    'Reconciliation: Run beendet',
  );

  return { startedAt, finishedAt, durationMs, results };
}
