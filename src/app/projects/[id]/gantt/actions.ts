'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getGitlabClientForUser } from '@/lib/gitlab/client';
import { parseGanttMeta, serializeGanttMeta, metaEquals, type GanttMeta } from '@/lib/gitlab/meta';
import { markSelfPush } from '@/lib/gitlab/self-push';
import { logger } from '@/lib/logger';
import { GitlabTokenExpiredError } from '@/lib/auth/encrypted-adapter';
import { syncSummaryLabels } from '@/lib/gitlab/summary-label';

// Helper damit die "Session abgelaufen"-Meldung an einer Stelle definiert ist
// und Caller einheitlich darauf reagieren können.
function sessionExpiredResult() {
  return {
    ok: false as const,
    error: 'GitLab-Session abgelaufen. Bitte abmelden und neu anmelden.',
    sessionExpired: true as const,
  };
}

// Hilfsfunktionen um GitLab-Response-Felder zu parsen (analog zu sync.ts).
type AssigneeOut = { id: number; username: string; name: string; avatarUrl?: string };
type LabelOut = { name: string; color?: string };

function extractAssigneesRaw(input: unknown): AssigneeOut[] {
  if (!Array.isArray(input)) return [];
  const out: AssigneeOut[] = [];
  for (const a of input) {
    if (!a || typeof a !== 'object') continue;
    const o = a as { id?: unknown; username?: unknown; name?: unknown; avatar_url?: unknown };
    if (typeof o.id !== 'number' || typeof o.username !== 'string') continue;
    out.push({
      id: o.id,
      username: o.username,
      name: typeof o.name === 'string' ? o.name : o.username,
      avatarUrl: typeof o.avatar_url === 'string' ? o.avatar_url : undefined,
    });
  }
  return out;
}

function extractLabelsRaw(input: unknown): LabelOut[] {
  if (!Array.isArray(input)) return [];
  const out: LabelOut[] = [];
  for (const l of input) {
    if (typeof l === 'string') {
      out.push({ name: l });
      continue;
    }
    if (l && typeof l === 'object') {
      const o = l as { name?: string; title?: string; color?: string };
      const name = o.name ?? o.title;
      if (!name) continue;
      out.push({ name, color: typeof o.color === 'string' ? o.color : undefined });
    }
  }
  return out;
}

export type CreateWorkPackageInput = {
  title: string;
  description?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  parentIid?: number | null;
};

export type CreateResult =
  | { ok: true; workPackageId: string; gitlabIssueIid: number }
  | { ok: false; error: string; sessionExpired?: boolean };

export async function createWorkPackageAction(
  projectInternalId: string,
  input: CreateWorkPackageInput,
): Promise<CreateResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };

  if (!input.title.trim()) return { ok: false, error: 'Titel darf nicht leer sein' };
  if (new Date(input.endDate) < new Date(input.startDate)) {
    return { ok: false, error: 'Ende darf nicht vor Start liegen' };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectInternalId },
    select: { id: true, gitlabProjectId: true },
  });
  if (!project) return { ok: false, error: 'Projekt nicht gefunden' };

  // gantt-meta Block bauen (start_date + optional parent_iid)
  const meta: GanttMeta = { start_date: input.startDate };
  if (input.parentIid) meta.parent_iid = input.parentIid;
  const baseDescription = input.description ?? '';
  const fullDescription = serializeGanttMeta(baseDescription, meta);

  try {
    // getGitlabClientForUser kann GitlabTokenExpiredError werfen — muss
    // INNERHALB des try-Blocks stehen damit die Server-Action nicht crashed.
    const client = await getGitlabClientForUser(session.user.id);

    // GitLab Issue erstellen
    const issue = await client.Issues.create(project.gitlabProjectId, input.title, {
      description: fullDescription,
      dueDate: input.endDate,
    });
    const newIid = (issue as { iid?: number }).iid;
    if (typeof newIid !== 'number') {
      return { ok: false, error: 'GitLab lieferte keine Issue-IID zurück' };
    }

    // Self-Push markieren damit Webhook nicht versucht zu syncen
    markSelfPush(newIid, project.id);

    // Lokales WorkPackage anlegen
    let parentDbId: string | null = null;
    if (input.parentIid) {
      const parent = await prisma.workPackage.findUnique({
        where: {
          projectId_gitlabIssueIid: {
            projectId: project.id,
            gitlabIssueIid: input.parentIid,
          },
        },
        select: { id: true },
      });
      parentDbId = parent?.id ?? null;
    }

    const wp = await prisma.$transaction(async (tx) => {
      const created = await tx.workPackage.create({
        data: {
          projectId: project.id,
          gitlabIssueIid: newIid,
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
          progressPercent: 0,
          titleCache: input.title,
          descriptionCache: fullDescription,
          stateCache: 'opened',
          labelsCache: [],
          assigneesCache: [],
          parentId: parentDbId,
          isSummary: false,
        },
        select: { id: true },
      });
      // is_summary auf neuem Parent updaten
      if (parentDbId) {
        await tx.workPackage.update({
          where: { id: parentDbId },
          data: { isSummary: true },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: 'work_package.create',
          entityType: 'WorkPackage',
          entityId: created.id,
          after: { title: input.title, gitlabIssueIid: newIid, parentIid: input.parentIid ?? null },
        },
      });
      return created;
    });

    // Wenn das neue WP einen Parent bekommen hat, ist dieser Parent jetzt ein
    // Summary-Task → gantt::summary Label in GitLab setzen.
    if (parentDbId) {
      await syncSummaryLabels(client, project.id, project.gitlabProjectId, [parentDbId]);
    }

    revalidatePath(`/projects/${project.id}/gantt`);
    return { ok: true, workPackageId: wp.id, gitlabIssueIid: newIid };
  } catch (err) {
    if (err instanceof GitlabTokenExpiredError) return sessionExpiredResult();
    logger.error(
      { err: err instanceof Error ? err.message : String(err), projectInternalId },
      'WorkPackage-Erstellung fehlgeschlagen',
    );
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Erstellung fehlgeschlagen',
    };
  }
}

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';
export type DependencySpec = {
  predecessorIid: number;
  type: DependencyType;
  lagDays?: number;
};

export type WorkPackagePatch = {
  title?: string;
  startDate?: string; // ISO YYYY-MM-DD
  endDate?: string;
  progressPercent?: number;
  /** Baseline-Start (YYYY-MM-DD) oder null zum Entfernen. undefined = unverändert. */
  baselineStart?: string | null;
  /** Baseline-Ende (YYYY-MM-DD) oder null zum Entfernen. undefined = unverändert. */
  baselineEnd?: string | null;
  /** null = entferne Parent. number = setze parent auf dieses Issue (iid im selben Projekt). */
  parentIid?: number | null;
  /** Vollständige Liste der Vorgänger (replace, nicht patch). */
  dependencies?: DependencySpec[];
  /** 'opened' = wiedereröffnen, 'closed' = schließen */
  state?: 'opened' | 'closed';
  /** Vollständige Liste der GitLab-User-IDs (replace). Leeres Array entfernt alle. */
  assigneeIds?: number[];
  /** Vollständige Liste der Label-Namen (replace). */
  labels?: string[];
};

export type UpdateResult =
  | { ok: true }
  | { ok: false; error: string; sessionExpired?: boolean };

export async function updateWorkPackageAction(
  workPackageId: string,
  patch: WorkPackagePatch,
): Promise<UpdateResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };

  const wp = await prisma.workPackage.findUnique({
    where: { id: workPackageId },
    select: {
      id: true,
      gitlabIssueIid: true,
      titleCache: true,
      descriptionCache: true,
      stateCache: true,
      startDate: true,
      endDate: true,
      progressPercent: true,
      parentId: true,
      project: {
        select: { id: true, gitlabProjectId: true },
      },
    },
  });
  if (!wp) return { ok: false, error: 'Work Package nicht gefunden' };

  // Bei Parent-Änderung: prüfe Zirkularität und löse parent_iid → parent_id auf.
  let newParentDbId: string | null | undefined = undefined; // undefined = unchanged
  if (patch.parentIid !== undefined) {
    if (patch.parentIid === null) {
      newParentDbId = null;
    } else if (patch.parentIid === wp.gitlabIssueIid) {
      return { ok: false, error: 'Work Package kann nicht eigener Parent sein' };
    } else {
      const candidate = await prisma.workPackage.findUnique({
        where: {
          projectId_gitlabIssueIid: {
            projectId: wp.project.id,
            gitlabIssueIid: patch.parentIid,
          },
        },
        select: { id: true },
      });
      if (!candidate) {
        return { ok: false, error: `Parent #${patch.parentIid} nicht gefunden im Projekt` };
      }
      // Zirkularitätscheck: candidate darf nicht selbst (transitiv) Nachfolger von wp sein
      const isCircular = await isDescendant(wp.project.id, candidate.id, wp.id);
      if (isCircular) {
        return { ok: false, error: 'Parent würde Zirkularität erzeugen' };
      }
      newParentDbId = candidate.id;
    }
  }

  // ── Felder, die direkt nach GitLab gehen (title, due_date, state, assignees, labels)
  const gitlabUpdate: Record<string, unknown> = {};
  if (patch.title !== undefined && patch.title !== wp.titleCache) {
    gitlabUpdate.title = patch.title;
  }
  if (patch.endDate !== undefined) {
    const newEnd = new Date(patch.endDate);
    if (newEnd.getTime() !== wp.endDate.getTime()) {
      gitlabUpdate.dueDate = patch.endDate; // GitLab erwartet YYYY-MM-DD
    }
  }
  if (patch.state !== undefined && patch.state !== wp.stateCache) {
    gitlabUpdate.stateEvent = patch.state === 'closed' ? 'close' : 'reopen';
  }
  if (patch.assigneeIds !== undefined) {
    gitlabUpdate.assigneeIds = patch.assigneeIds;
  }
  if (patch.labels !== undefined) {
    gitlabUpdate.labels = patch.labels.join(',');
  }

  // ── Felder in gantt-meta (start_date, progress_percent) ──────────────────
  const oldMeta = parseGanttMeta(wp.descriptionCache);
  const newMeta: GanttMeta = { ...(oldMeta ?? {}) };
  let descriptionChanged = false;

  if (patch.startDate !== undefined) {
    newMeta.start_date = patch.startDate;
    if (oldMeta?.start_date !== patch.startDate) descriptionChanged = true;
  }
  if (patch.progressPercent !== undefined) {
    const p = Math.max(0, Math.min(100, Math.round(patch.progressPercent)));
    newMeta.progress = p;
    if (oldMeta?.progress !== p) descriptionChanged = true;
  }
  if (patch.baselineStart !== undefined) {
    const next = patch.baselineStart ?? undefined;
    if (oldMeta?.baseline_start !== next) {
      if (next === undefined) delete newMeta.baseline_start;
      else newMeta.baseline_start = next;
      descriptionChanged = true;
    }
  }
  if (patch.baselineEnd !== undefined) {
    const next = patch.baselineEnd ?? undefined;
    if (oldMeta?.baseline_end !== next) {
      if (next === undefined) delete newMeta.baseline_end;
      else newMeta.baseline_end = next;
      descriptionChanged = true;
    }
  }
  if (patch.parentIid !== undefined) {
    if (patch.parentIid === null) {
      if (newMeta.parent_iid !== undefined) {
        delete newMeta.parent_iid;
        descriptionChanged = true;
      }
    } else {
      if (oldMeta?.parent_iid !== patch.parentIid) {
        newMeta.parent_iid = patch.parentIid;
        descriptionChanged = true;
      }
    }
  }
  if (patch.dependencies !== undefined) {
    const newDeps = patch.dependencies.map((d) => ({
      iid: d.predecessorIid,
      type: d.type,
      lag_days: d.lagDays ?? 0,
    }));
    const oldDeps = oldMeta?.dependencies ?? [];
    if (JSON.stringify(newDeps) !== JSON.stringify(oldDeps)) {
      if (newDeps.length > 0) {
        newMeta.dependencies = newDeps;
      } else {
        delete newMeta.dependencies;
      }
      descriptionChanged = true;
    }
  }

  if (descriptionChanged && !metaEquals(oldMeta, newMeta)) {
    const newDescription = serializeGanttMeta(wp.descriptionCache, newMeta);
    gitlabUpdate.description = newDescription;
  }

  // ── Push nach GitLab (falls etwas zu pushen ist) ──────────────────────────
  let updatedFromGitlab: { assignees?: unknown; labels?: unknown } | null = null;
  try {
    // getGitlabClientForUser INSIDE try damit Token-Expired-Error sauber
    // gefangen wird statt die Action zu crashen.
    const client = await getGitlabClientForUser(session.user.id);

    if (Object.keys(gitlabUpdate).length > 0) {
      markSelfPush(wp.gitlabIssueIid, wp.project.id);
      const result = await client.Issues.edit(
        wp.project.gitlabProjectId,
        wp.gitlabIssueIid,
        gitlabUpdate,
      );
      updatedFromGitlab = result as unknown as typeof updatedFromGitlab;
    }

    // Sammelt WP-IDs deren isSummary-Status recomputed wurde — wird nach der
    // Transaction zum Synchronisieren des gantt::summary-Labels in GitLab genutzt.
    const summaryRecheckIds = new Set<string>();

    // ── Lokale DB-Update ──────────────────────────────────────────────────
    await prisma.$transaction(async (tx) => {
      const dbPatch: Record<string, unknown> = {};
      if (patch.title !== undefined) dbPatch.titleCache = patch.title;
      if (patch.startDate !== undefined) dbPatch.startDate = new Date(patch.startDate);
      if (patch.endDate !== undefined) dbPatch.endDate = new Date(patch.endDate);
      if (patch.progressPercent !== undefined) {
        dbPatch.progressPercent = Math.max(0, Math.min(100, Math.round(patch.progressPercent)));
      }
      if (patch.baselineStart !== undefined) {
        dbPatch.baselineStartDate = patch.baselineStart ? new Date(patch.baselineStart) : null;
      }
      if (patch.baselineEnd !== undefined) {
        dbPatch.baselineEndDate = patch.baselineEnd ? new Date(patch.baselineEnd) : null;
      }
      if (gitlabUpdate.description !== undefined) {
        dbPatch.descriptionCache = gitlabUpdate.description as string;
      }
      if (patch.state !== undefined) {
        dbPatch.stateCache = patch.state;
      }
      if (updatedFromGitlab?.assignees && Array.isArray(updatedFromGitlab.assignees)) {
        dbPatch.assigneesCache = extractAssigneesRaw(updatedFromGitlab.assignees);
      }
      if (updatedFromGitlab?.labels && Array.isArray(updatedFromGitlab.labels)) {
        dbPatch.labelsCache = extractLabelsRaw(updatedFromGitlab.labels);
      }
      if (newParentDbId !== undefined) {
        dbPatch.parentId = newParentDbId;
      }
      if (Object.keys(dbPatch).length > 0) {
        dbPatch.lastSyncedAt = new Date();
        await tx.workPackage.update({
          where: { id: workPackageId },
          data: dbPatch,
        });
      }
      // Dependency-Tabelle synchronisieren wenn deps geändert wurden
      if (patch.dependencies !== undefined) {
        await tx.dependency.deleteMany({ where: { successorId: workPackageId } });
        for (const dep of patch.dependencies) {
          const pred = await tx.workPackage.findUnique({
            where: {
              projectId_gitlabIssueIid: {
                projectId: wp.project.id,
                gitlabIssueIid: dep.predecessorIid,
              },
            },
            select: { id: true },
          });
          if (!pred) continue;
          try {
            await tx.dependency.create({
              data: {
                predecessorId: pred.id,
                successorId: workPackageId,
                type: dep.type,
                lagDays: dep.lagDays ?? 0,
                createdByUserId: session.user.id,
              },
            });
          } catch (err) {
            logger.warn(
              { err: String(err), workPackageId, predIid: dep.predecessorIid },
              'dependency-create übersprungen',
            );
          }
        }
      }

      // is_summary auf altem + neuem Parent neu berechnen
      const idsToRecheck = new Set<string>();
      if (newParentDbId !== undefined) {
        if (wp.parentId) idsToRecheck.add(wp.parentId);
        if (newParentDbId) idsToRecheck.add(newParentDbId);
      }
      for (const id of idsToRecheck) {
        const childCount = await tx.workPackage.count({
          where: { parentId: id, deletedAt: null },
        });
        await tx.workPackage.update({
          where: { id },
          data: { isSummary: childCount > 0 },
        });
        summaryRecheckIds.add(id);
      }

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: 'work_package.update',
          entityType: 'WorkPackage',
          entityId: workPackageId,
          before: {
            title: wp.titleCache,
            startDate: wp.startDate.toISOString().slice(0, 10),
            endDate: wp.endDate.toISOString().slice(0, 10),
            progressPercent: wp.progressPercent,
          },
          after: { ...patch },
        },
      });
    });

    // gantt::summary Label in GitLab synchronisieren falls sich isSummary-Status
    // eines Parents geändert hat. Best-effort, blockiert die Antwort nicht.
    if (summaryRecheckIds.size > 0) {
      await syncSummaryLabels(
        client,
        wp.project.id,
        wp.project.gitlabProjectId,
        summaryRecheckIds,
      );
    }

    revalidatePath(`/projects/${wp.project.id}/gantt`);
    return { ok: true };
  } catch (err) {
    if (err instanceof GitlabTokenExpiredError) return sessionExpiredResult();
    logger.error(
      { err: err instanceof Error ? err.message : String(err), workPackageId },
      'WorkPackage-Update fehlgeschlagen',
    );
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Update fehlgeschlagen',
    };
  }
}

// Liste der WPs für die Baseline-Bulk-Operationen. Wird vom BaselineMenu
// genutzt damit es pro WP iterieren und Progress anzeigen kann.
// mode='freeze' → WPs die noch keine oder eine veraltete Baseline haben
// mode='clear'  → WPs die aktuell eine Baseline gesetzt haben
export async function listBaselineTargetsAction(
  projectId: string,
  mode: 'freeze' | 'clear',
): Promise<
  | { ok: true; targets: Array<{ wpId: string; startDate: string; endDate: string }> }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };

  const wps = await prisma.workPackage.findMany({
    where: {
      projectId,
      deletedAt: null,
      ...(mode === 'clear'
        ? {
            OR: [
              { baselineStartDate: { not: null } },
              { baselineEndDate: { not: null } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      baselineStartDate: true,
      baselineEndDate: true,
    },
  });

  const targets = wps
    .filter((wp) => {
      if (mode === 'clear') return true;
      // freeze: nur WPs die nicht schon mit aktuellem Stand übereinstimmen
      if (!wp.baselineStartDate || !wp.baselineEndDate) return true;
      return (
        wp.baselineStartDate.getTime() !== wp.startDate.getTime() ||
        wp.baselineEndDate.getTime() !== wp.endDate.getTime()
      );
    })
    .map((wp) => ({
      wpId: wp.id,
      startDate: toIsoDate(wp.startDate),
      endDate: toIsoDate(wp.endDate),
    }));

  return { ok: true, targets };
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Setzt für ALLE WPs des Projekts die Baseline auf die aktuellen Start-/End-
// Daten. Schreibt sowohl ins gantt-meta (GitLab) als auch in den DB-Cache.
// Bei vielen WPs sequenziell um GitLab-Rate-Limits zu schonen.
export async function freezeBaselineProjectAction(
  projectId: string,
  options?: { onlyMissing?: boolean },
): Promise<{ ok: true; updated: number; skipped: number } | { ok: false; error: string; sessionExpired?: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, gitlabProjectId: true },
  });
  if (!project) return { ok: false, error: 'Projekt nicht gefunden' };

  const wps = await prisma.workPackage.findMany({
    where: { projectId, deletedAt: null },
    select: {
      id: true,
      gitlabIssueIid: true,
      startDate: true,
      endDate: true,
      baselineStartDate: true,
      baselineEndDate: true,
      descriptionCache: true,
    },
  });

  let client;
  try {
    client = await getGitlabClientForUser(session.user.id);
  } catch (err) {
    if (err instanceof GitlabTokenExpiredError) return sessionExpiredResult();
    throw err;
  }

  let updated = 0;
  let skipped = 0;

  for (const wp of wps) {
    if (options?.onlyMissing && wp.baselineStartDate && wp.baselineEndDate) {
      skipped += 1;
      continue;
    }
    const newStart = toIsoDate(wp.startDate);
    const newEnd = toIsoDate(wp.endDate);

    const oldMeta = parseGanttMeta(wp.descriptionCache);
    if (oldMeta?.baseline_start === newStart && oldMeta?.baseline_end === newEnd) {
      // Schon identisch — kein GitLab-Roundtrip nötig.
      if (!wp.baselineStartDate || !wp.baselineEndDate) {
        // DB-Cache nachziehen (war eventuell out of sync).
        await prisma.workPackage.update({
          where: { id: wp.id },
          data: {
            baselineStartDate: wp.startDate,
            baselineEndDate: wp.endDate,
          },
        });
      }
      skipped += 1;
      continue;
    }
    const newMeta: GanttMeta = {
      ...(oldMeta ?? {}),
      baseline_start: newStart,
      baseline_end: newEnd,
    };
    const newDescription = serializeGanttMeta(wp.descriptionCache, newMeta);

    try {
      markSelfPush(wp.gitlabIssueIid, project.id);
      await client.Issues.edit(project.gitlabProjectId, wp.gitlabIssueIid, {
        description: newDescription,
      });
      await prisma.workPackage.update({
        where: { id: wp.id },
        data: {
          descriptionCache: newDescription,
          baselineStartDate: wp.startDate,
          baselineEndDate: wp.endDate,
          lastSyncedAt: new Date(),
        },
      });
      updated += 1;
    } catch (err) {
      if (err instanceof GitlabTokenExpiredError) return sessionExpiredResult();
      logger.warn(
        { err: String(err), iid: wp.gitlabIssueIid },
        'baseline-freeze einzelner WP fehlgeschlagen — überspringe',
      );
      skipped += 1;
    }
  }

  revalidatePath(`/projects/${projectId}/gantt`);
  return { ok: true, updated, skipped };
}

// Entfernt die Baseline von ALLEN WPs des Projekts. Spiegelt freeze auf null.
export async function clearBaselineProjectAction(
  projectId: string,
): Promise<{ ok: true; updated: number } | { ok: false; error: string; sessionExpired?: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, gitlabProjectId: true },
  });
  if (!project) return { ok: false, error: 'Projekt nicht gefunden' };

  const wps = await prisma.workPackage.findMany({
    where: {
      projectId,
      deletedAt: null,
      OR: [
        { baselineStartDate: { not: null } },
        { baselineEndDate: { not: null } },
      ],
    },
    select: { id: true, gitlabIssueIid: true, descriptionCache: true },
  });

  let client;
  try {
    client = await getGitlabClientForUser(session.user.id);
  } catch (err) {
    if (err instanceof GitlabTokenExpiredError) return sessionExpiredResult();
    throw err;
  }

  let updated = 0;
  for (const wp of wps) {
    const oldMeta = parseGanttMeta(wp.descriptionCache);
    const newMeta: GanttMeta = { ...(oldMeta ?? {}) };
    delete newMeta.baseline_start;
    delete newMeta.baseline_end;
    const newDescription = serializeGanttMeta(wp.descriptionCache, newMeta);

    try {
      markSelfPush(wp.gitlabIssueIid, project.id);
      await client.Issues.edit(project.gitlabProjectId, wp.gitlabIssueIid, {
        description: newDescription,
      });
      await prisma.workPackage.update({
        where: { id: wp.id },
        data: {
          descriptionCache: newDescription,
          baselineStartDate: null,
          baselineEndDate: null,
          lastSyncedAt: new Date(),
        },
      });
      updated += 1;
    } catch (err) {
      if (err instanceof GitlabTokenExpiredError) return sessionExpiredResult();
      logger.warn(
        { err: String(err), iid: wp.gitlabIssueIid },
        'baseline-clear einzelner WP fehlgeschlagen',
      );
    }
  }

  revalidatePath(`/projects/${projectId}/gantt`);
  return { ok: true, updated };
}

// Prüft ob `descendantId` ein (transitiver) Nachfolger von `ancestorId` im selben
// Projekt ist. Verhindert Zirkel beim Parent-Setzen.
async function isDescendant(
  projectId: string,
  ancestorId: string,
  descendantId: string,
): Promise<boolean> {
  if (ancestorId === descendantId) return true;
  // Stack-basierter DFS, max 100 Iterationen als Sicherheitsnetz
  const stack: string[] = [ancestorId];
  const seen = new Set<string>();
  for (let i = 0; i < 100 && stack.length > 0; i++) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    if (cur === descendantId) return true;
    const children = await prisma.workPackage.findMany({
      where: { projectId, parentId: cur, deletedAt: null },
      select: { id: true },
    });
    for (const c of children) stack.push(c.id);
  }
  return false;
}
