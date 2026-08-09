// Synct das `gantt::summary` Label in GitLab basierend auf dem isSummary-State
// in unserer DB.
//
// Hintergrund: Taktline kennt Summary-Tasks (Parent eines Hierarchie-Asts) —
// GitLab nicht. Wer ein Issue direkt in GitLab anschaut sieht keinen Hinweis
// dass dort eine Phase/ein Container liegt. Das Label macht das sichtbar und
// in GitLab filterbar.
//
// Wird best-effort gepusht: bei API-Fehler wird geloggt, die DB-Wahrheit
// bleibt intakt. Nächste Reconciliation/Sync kann den Drift heilen.

import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { markSelfPush } from './self-push';
import type { GitlabClient } from './client';

export const SUMMARY_LABEL = 'gantt::summary';

// Synct Labels für die angegebenen WP-IDs. Wenn isSummary=true muss das Label
// dran sein, sonst weg. Liest labelsCache + gitlabIssueIid aus der DB,
// vergleicht, und pusht nur was sich ändert.
export async function syncSummaryLabels(
  client: GitlabClient,
  projectInternalId: string,
  gitlabProjectId: number,
  workPackageIds: Iterable<string>,
): Promise<void> {
  const ids = [...workPackageIds];
  if (ids.length === 0) return;

  const wps = await prisma.workPackage.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: {
      id: true,
      gitlabIssueIid: true,
      isSummary: true,
      labelsCache: true,
      titleCache: true,
    },
  });

  for (const wp of wps) {
    const currentLabels = extractLabelNames(wp.labelsCache);
    const hasLabel = currentLabels.includes(SUMMARY_LABEL);

    if (hasLabel === wp.isSummary) continue; // schon korrekt — nichts zu tun

    const newLabels = wp.isSummary
      ? [...currentLabels, SUMMARY_LABEL]
      : currentLabels.filter((l) => l !== SUMMARY_LABEL);

    try {
      markSelfPush(wp.gitlabIssueIid, projectInternalId);
      await client.Issues.edit(gitlabProjectId, wp.gitlabIssueIid, {
        labels: newLabels.join(','),
      });
      // Lokal cachen damit nicht beim nächsten Aufruf erneut versucht wird
      await prisma.workPackage.update({
        where: { id: wp.id },
        data: { labelsCache: newLabels.map((name) => ({ name })) },
      });
      logger.debug(
        { iid: wp.gitlabIssueIid, isSummary: wp.isSummary, title: wp.titleCache },
        `gantt::summary Label ${wp.isSummary ? 'gesetzt' : 'entfernt'}`,
      );
    } catch (err) {
      logger.warn(
        {
          iid: wp.gitlabIssueIid,
          err: err instanceof Error ? err.message : String(err),
        },
        'gantt::summary Label-Sync nach GitLab fehlgeschlagen',
      );
    }
  }
}

function extractLabelNames(cache: unknown): string[] {
  if (!Array.isArray(cache)) return [];
  const out: string[] = [];
  for (const entry of cache) {
    if (typeof entry === 'string') {
      out.push(entry);
    } else if (entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string') {
      out.push((entry as { name: string }).name);
    }
  }
  return out;
}
