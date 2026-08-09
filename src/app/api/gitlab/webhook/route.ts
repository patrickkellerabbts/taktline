import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { verifyWebhookToken, type GitlabIssuePayload } from '@/lib/gitlab/webhook';
import { isSelfPush } from '@/lib/gitlab/self-push';
import {
  applyIssueUpdate,
  syncWorkPackageMergeRequests,
  type IssueAction,
} from '@/lib/gitlab/sync';
import { getGitlabClientForUser } from '@/lib/gitlab/client';
import { syncSummaryLabels } from '@/lib/gitlab/summary-label';
import { GitlabTokenExpiredError } from '@/lib/auth/encrypted-adapter';

export async function POST(request: Request) {
  const headerToken = request.headers.get('x-gitlab-token');
  const eventType = request.headers.get('x-gitlab-event');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const projectId = extractGitlabProjectId(body);
  if (!projectId) {
    logger.warn({ eventType }, 'webhook ohne project.id');
    return NextResponse.json({ error: 'missing_project' }, { status: 400 });
  }

  const project = await prisma.project.findUnique({
    where: { gitlabProjectId: projectId },
    select: {
      id: true,
      gitlabProjectId: true,
      webhookSecretEncrypted: true,
      activatedByUserId: true,
    },
  });
  if (!project) {
    logger.warn({ projectId, eventType }, 'webhook für unbekanntes Projekt');
    return NextResponse.json({ error: 'unknown_project' }, { status: 404 });
  }

  if (!verifyWebhookToken(headerToken, project.webhookSecretEncrypted)) {
    logger.warn({ projectId, eventType }, 'webhook Token-Verifikation fehlgeschlagen');
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
  }

  switch (eventType) {
    case 'Issue Hook':
    case 'Confidential Issue Hook':
      await handleIssueEvent(
        project.id,
        project.gitlabProjectId,
        project.activatedByUserId,
        body as GitlabIssuePayload,
      );
      break;
    default:
      logger.debug({ eventType, projectId }, 'webhook event ignored');
  }

  return NextResponse.json({ ok: true });
}

function extractGitlabProjectId(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const project = (body as { project?: { id?: unknown } }).project;
  if (!project || typeof project.id !== 'number') return null;
  return project.id;
}

async function handleIssueEvent(
  projectInternalId: string,
  gitlabProjectId: number,
  activatedByUserId: string,
  payload: GitlabIssuePayload,
): Promise<void> {
  const attrs = payload.object_attributes;
  const iid = attrs.iid;

  if (isSelfPush(iid, projectInternalId)) {
    logger.debug({ iid, projectInternalId }, 'self-push erkannt, webhook ignoriert');
    return;
  }

  let action: IssueAction;
  switch (attrs.action) {
    case 'open':
      action = 'create';
      break;
    case 'close':
    case 'reopen':
      action = 'state-only';
      break;
    case 'update':
    default:
      action = 'update';
  }

  try {
    let affectedParents: string[] = [];
    let updatedWpId: string | null = null;
    await prisma.$transaction(
      async (tx) => {
        const updateResult = await applyIssueUpdate(
          tx,
          projectInternalId,
          {
            iid,
            title: attrs.title,
            description: attrs.description,
            state: attrs.state,
            dueDate: attrs.due_date,
            createdAt: attrs.created_at ?? null,
            labels: payload.labels,
            assignees: payload.assignees,
            milestoneId: attrs.milestone_id ?? null,
          },
          action,
        );
        affectedParents = updateResult.affectedParents;
        updatedWpId = updateResult.workPackageId;
      },
      { timeout: 15_000 },
    );

    // MRs/Pipelines für DIESES Issue nachziehen — ausserhalb der TX weil
    // GitLab-Roundtrip. Soft-fail damit der Webhook-Handler nicht crasht.
    if (updatedWpId && action !== 'state-only') {
      try {
        const client = await getGitlabClientForUser(activatedByUserId);
        await syncWorkPackageMergeRequests(client, gitlabProjectId, updatedWpId, iid);
      } catch (err) {
        if (err instanceof GitlabTokenExpiredError) {
          logger.warn({ projectInternalId }, 'MR-Sync via Webhook: Owner-Token abgelaufen');
        } else {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), iid },
            'MR-Sync via Webhook fehlgeschlagen',
          );
        }
      }
    }

    // gantt::summary Labels nachziehen wenn sich die Eltern-isSummary geändert
    // haben könnten. Webhook hat keinen User-Kontext — wir nutzen den Owner
    // des Projekts (activatedByUserId). Fail-safe wenn Token tot ist.
    if (affectedParents.length > 0) {
      try {
        const client = await getGitlabClientForUser(activatedByUserId);
        await syncSummaryLabels(client, projectInternalId, gitlabProjectId, affectedParents);
      } catch (err) {
        if (err instanceof GitlabTokenExpiredError) {
          logger.warn({ projectInternalId }, 'gantt::summary Label-Sync: Owner-Token abgelaufen');
        } else {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'gantt::summary Label-Sync nach Webhook fehlgeschlagen',
          );
        }
      }
    }

    revalidatePath(`/projects/${projectInternalId}/gantt`);
    logger.info(
      { iid, action: attrs.action, state: attrs.state, projectInternalId },
      'issue webhook synced',
    );
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), iid, projectInternalId },
      'webhook sync fehlgeschlagen',
    );
  }
}
