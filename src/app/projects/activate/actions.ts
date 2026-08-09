'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getGitlabClientForUser } from '@/lib/gitlab/client';
import { GitlabTokenExpiredError } from '@/lib/auth/encrypted-adapter';
import { syncSummaryLabels } from '@/lib/gitlab/summary-label';
import { getProject } from '@/lib/gitlab/projects';
import { performInitialSync } from '@/lib/gitlab/sync';
import {
  getWebhookCallbackUrl,
  registerProjectWebhook,
} from '@/lib/gitlab/webhooks';
import { logger } from '@/lib/logger';

export type ActivateResult =
  | { ok: true; projectId: string; reachable: boolean; counts: ActivationCounts }
  | { ok: false; error: string; sessionExpired?: boolean };

export type ActivationCounts = {
  workPackages: number;
  milestones: number;
  parentLinks: number;
  dependencies: number;
};

export async function activateProjectAction(
  gitlabProjectId: number,
): Promise<ActivateResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: 'Nicht angemeldet' };
  }
  const userId = session.user.id;

  // Bereits aktiviert?
  const existing = await prisma.project.findUnique({
    where: { gitlabProjectId },
    select: { id: true },
  });
  if (existing) {
    redirect(`/projects/${existing.id}/gantt`);
  }

  // Project + Sync in einer Transaktion. Wenn Sync scheitert, kein verwaister
  // Project-Record. Token-Resolution & GitLab-Setup auch im try damit
  // GitlabTokenExpiredError sauber gefangen wird.
  let result: {
    projectId: string;
    counts: ActivationCounts;
    summaryCandidateIds: string[];
    gitlabProjectId: number;
  };
  let webhookReachable = false;
  try {
    const client = await getGitlabClientForUser(userId);
    const gitlabProject = await getProject(client, gitlabProjectId);
    const callbackUrl = getWebhookCallbackUrl();
    const webhook = await registerProjectWebhook(
      client,
      gitlabProjectId,
      callbackUrl,
    );
    webhookReachable = webhook.reachable;
    result = await prisma.$transaction(
      async (tx) => {
        const project = await tx.project.create({
          data: {
            gitlabProjectId,
            nameCache: gitlabProject.pathWithNamespace,
            webhookId: webhook.webhookId,
            webhookSecretEncrypted: webhook.webhookSecretEncrypted,
            activatedByUserId: userId,
          },
          select: { id: true },
        });

        const sync = await performInitialSync(
          tx,
          client,
          project.id,
          gitlabProjectId,
        );

        await tx.auditLog.create({
          data: {
            userId,
            action: 'project.activate',
            entityType: 'Project',
            entityId: project.id,
            after: {
              gitlabProjectId,
              webhookReachable: webhook.reachable,
              counts: {
                workPackages: sync.workPackagesSynced,
                milestones: sync.milestonesSynced,
                parentLinks: sync.parentLinksResolved,
                dependencies: sync.dependenciesResolved,
              },
            },
          },
        });

        return {
          projectId: project.id,
          counts: {
            workPackages: sync.workPackagesSynced,
            milestones: sync.milestonesSynced,
            parentLinks: sync.parentLinksResolved,
            dependencies: sync.dependenciesResolved,
          },
          summaryCandidateIds: sync.summaryCandidateIds,
          gitlabProjectId,
        };
      },
      { timeout: 30_000 },
    );

    // gantt::summary Labels in GitLab nachziehen (nach Tx-Commit)
    if (result.summaryCandidateIds.length > 0) {
      await syncSummaryLabels(
        client,
        result.projectId,
        result.gitlabProjectId,
        result.summaryCandidateIds,
      );
    }
  } catch (err) {
    if (err instanceof GitlabTokenExpiredError) {
      return {
        ok: false,
        error: 'GitLab-Session abgelaufen. Bitte abmelden und neu anmelden.',
        sessionExpired: true,
      };
    }
    logger.error(
      { err: err instanceof Error ? err.message : String(err), gitlabProjectId },
      'Projekt-Aktivierung fehlgeschlagen',
    );
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Aktivierung fehlgeschlagen',
    };
  }

  revalidatePath('/projects');
  return {
    ok: true,
    projectId: result.projectId,
    reachable: webhookReachable,
    counts: result.counts,
  };
}
