import type { Prisma, PrismaClient } from '@prisma/client';
import type { IssueSchema, MilestoneSchema } from '@gitbeaker/rest';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { GitlabClient } from './client';
import { isUnscheduledStory, labelNames } from '@/lib/agile/board';
import { parseGanttMeta, syncedStoryPoints } from './meta';

type Tx = Prisma.TransactionClient | PrismaClient;

export type SyncResult = {
  workPackagesSynced: number;
  milestonesSynced: number;
  parentLinksResolved: number;
  dependenciesResolved: number;
  // WP-IDs deren isSummary möglicherweise geändert wurde — der Caller kann
  // nach dem Tx-Commit syncSummaryLabels(...) damit aufrufen um das
  // gantt::summary Label in GitLab nachzuziehen.
  summaryCandidateIds: string[];
};

// Liest alle offenen Issues und Milestones aus GitLab und legt sie als
// WorkPackages / Milestones in unserer DB an. Idempotent: bestehende Records
// werden geupdated.
//
// Ablauf:
//   Pass 0: Milestones (independent)
//   Pass 1: Issues → WorkPackages (ohne parent/dependencies, weil die andere WPs referenzieren)
//   Pass 2: gantt-meta auswerten und parent_id + Dependencies setzen
export async function performInitialSync(
  tx: Tx,
  client: GitlabClient,
  projectInternalId: string,
  gitlabProjectId: number,
  options: {
    /** Task-IID → Story-IID aus GraphQL (lib/gitlab/tasks.ts). null = nicht
     *  lesbar, dann bleibt die bisherige Zuordnung stehen. */
    taskParents?: Map<number, number | null> | null;
  } = {},
): Promise<SyncResult> {
  const summaryCandidateIds = new Set<string>();
  const result: SyncResult = {
    summaryCandidateIds: [],
    workPackagesSynced: 0,
    milestonesSynced: 0,
    parentLinksResolved: 0,
    dependenciesResolved: 0,
  };

  // ─── Project-Labels ───────────────────────────────────────────────────────
  // Alle Project-Labels (auch ungenutzte) als Vorrats-Liste cachen. Damit
  // hat der Inspector beim Label-Picker die vollständige Palette, nicht nur
  // Labels die schon irgendwo am Issue hängen.
  try {
    const projectLabels = (await client.ProjectLabels.all(gitlabProjectId, {
      perPage: 100,
      includeAncestorGroups: true,
    })) as Array<Record<string, unknown>>;
    const fetchedNames = new Set<string>();
    for (const l of projectLabels) {
      const name = l.name as string;
      if (!name) continue;
      fetchedNames.add(name);
      await tx.projectLabel.upsert({
        where: { projectId_name: { projectId: projectInternalId, name } },
        create: {
          projectId: projectInternalId,
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
    // Labels die in GitLab nicht mehr existieren entfernen
    const existing = await tx.projectLabel.findMany({
      where: { projectId: projectInternalId },
      select: { id: true, name: true },
    });
    const orphans = existing.filter((l) => !fetchedNames.has(l.name));
    if (orphans.length > 0) {
      await tx.projectLabel.deleteMany({
        where: { id: { in: orphans.map((o) => o.id) } },
      });
    }
  } catch (err) {
    logger.warn(
      { err: String(err), projectInternalId },
      'project-label-sync fehlgeschlagen, überspringe',
    );
  }

  // ─── Milestones ───────────────────────────────────────────────────────────
  // includeParentMilestones=true → auch Group-Milestones werden geliefert,
  // damit Issues die einer Gruppen-Milestone zugeordnet sind nicht "verschwinden".
  const milestones = (await client.ProjectMilestones.all(gitlabProjectId, {
    perPage: 100,
    includeParentMilestones: true,
  })) as MilestoneSchema[];
  const fetchedMilestoneIds = new Set(milestones.map((m) => m.id));
  for (const m of milestones) {
    // Group-Milestones haben in der GitLab-API ein gesetztes group_id-Feld
    // statt project_id (project_id ist null/undefined). Wir merken das damit
    // die Edit-UI sie als read-only behandeln kann.
    const mAny = m as unknown as { project_id?: number | null; group_id?: number | null; description?: string | null };
    const isGroupMilestone =
      (mAny.project_id == null) || (mAny.project_id !== gitlabProjectId && mAny.group_id != null);
    const description = typeof mAny.description === 'string' ? mAny.description : null;

    await tx.milestone.upsert({
      where: {
        projectId_gitlabMilestoneId: {
          projectId: projectInternalId,
          gitlabMilestoneId: m.id,
        },
      },
      create: {
        projectId: projectInternalId,
        gitlabMilestoneId: m.id,
        titleCache: m.title,
        descriptionCache: description,
        dueDateCache: m.due_date ? new Date(m.due_date) : null,
        stateCache: m.state ?? 'active',
        isGroupMilestone,
      },
      update: {
        titleCache: m.title,
        descriptionCache: description,
        dueDateCache: m.due_date ? new Date(m.due_date) : null,
        stateCache: m.state ?? 'active',
        isGroupMilestone,
        lastSyncedAt: new Date(),
      },
    });
    result.milestonesSynced += 1;
  }

  // Milestones die in GitLab nicht mehr existieren → lokal entfernen.
  const existingMilestones = await tx.milestone.findMany({
    where: { projectId: projectInternalId },
    select: { id: true, gitlabMilestoneId: true },
  });
  const orphanMilestones = existingMilestones.filter(
    (em) => !fetchedMilestoneIds.has(em.gitlabMilestoneId),
  );
  if (orphanMilestones.length > 0) {
    await tx.milestone.deleteMany({
      where: { id: { in: orphanMilestones.map((m) => m.id) } },
    });
  }

  // ─── Issues ───────────────────────────────────────────────────────────────
  // with_labels_details=true → Labels kommen als {id, name, color, description, ...}
  // statt nur als Strings, sodass wir die Farben mitspeichern können.
  // state='all' damit geschlossene Issues korrekt mit state=closed im Gantt
  // bleiben (gemäß REQUIREMENTS FR-S1: closed → State updaten, NICHT löschen).
  const issues = (await client.Issues.all({
    projectId: gitlabProjectId,
    state: 'all',
    perPage: 100,
    withLabelsDetails: true,
  })) as IssueSchema[];
  const fetchedIssueIids = new Set(issues.map((i) => i.iid));

  // Lookup-Map: GitLab-Milestone-ID → unsere lokale Milestone.id
  // (für die issue.milestone-Resolution im Pass 1).
  const milestoneIdToLocalId = new Map(
    (
      await tx.milestone.findMany({
        where: { projectId: projectInternalId },
        select: { id: true, gitlabMilestoneId: true },
      })
    ).map((m) => [m.gitlabMilestoneId, m.id]),
  );

  // Vorherige States für Audit-Tracking (Velocity in /reports liest das)
  const existingStates = new Map(
    (
      await tx.workPackage.findMany({
        where: { projectId: projectInternalId, deletedAt: null },
        select: { gitlabIssueIid: true, id: true, stateCache: true },
      })
    ).map((w) => [w.gitlabIssueIid, { id: w.id, state: w.stateCache }]),
  );
  const stateTransitions: Array<{ wpId: string; before: string; after: string }> = [];

  // Pass 1: WorkPackages anlegen/updaten. parent_id bleibt null bis Pass 2.
  for (const issue of issues) {
    const meta = parseGanttMeta(issue.description as string | null);

    // Default-Strategie ohne explizite Daten:
    //   start_date = gantt-meta.start_date || issue.created_at (auf Tag genullt)
    //   end_date   = issue.due_date || start_date + 14 Tage
    // Damit verteilen sich Bars zeitlich entlang der Issue-Historie, statt
    // dass alle ohne Daten auf dem heutigen Tag stacken.
    const createdAt = issue.created_at
      ? new Date(issue.created_at as string)
      : new Date();
    createdAt.setHours(0, 0, 0, 0);

    const startDate = meta?.start_date ? new Date(meta.start_date) : createdAt;
    const fourteenDaysAfterStart = new Date(startDate);
    fourteenDaysAfterStart.setDate(fourteenDaysAfterStart.getDate() + 14);
    const endDate = issue.due_date
      ? new Date(issue.due_date)
      : fourteenDaysAfterStart;

    // Baseline nur übernehmen wenn beide Felder gesetzt sind — eine Hälfte
    // ohne die andere wäre für den Render nutzlos.
    const baselineStartDate =
      meta?.baseline_start && meta?.baseline_end
        ? new Date(meta.baseline_start)
        : null;
    const baselineEndDate =
      meta?.baseline_start && meta?.baseline_end
        ? new Date(meta.baseline_end)
        : null;

    // GitLab liefert closed_at nur bei geschlossenen Issues; beim Wiedereröffnen
    // räumt es das Feld selbst ab. Wir spiegeln das 1:1, damit ein reopen die
    // alte Schliessung nicht als Geist im Burndown zurücklässt.
    const closedAt = issue.closed_at ? new Date(issue.closed_at as string) : null;

    const labelsCache = extractLabels(issue.labels);
    const task = taskFields(issue);
    // Tasks sind Sprint-Arbeit unter einer Story, keine Vorgänge im Gantt.
    const isUnscheduled =
      task.isTask ||
      isUnscheduledStory({
        labels: labelNames(labelsCache),
        metaStartDate: meta?.start_date,
        dueDate: issue.due_date as string | null,
      });

    // Milestone-Referenz aus dem GitLab-Issue auflösen → lokale Milestone.id
    const issueMilestone = (issue as { milestone?: { id?: number } | null }).milestone;
    const milestoneLocalId =
      issueMilestone?.id != null ? milestoneIdToLocalId.get(issueMilestone.id) ?? null : null;

    const upserted = await tx.workPackage.upsert({
      where: {
        projectId_gitlabIssueIid: {
          projectId: projectInternalId,
          gitlabIssueIid: issue.iid,
        },
      },
      create: {
        projectId: projectInternalId,
        gitlabIssueIid: issue.iid,
        startDate,
        endDate,
        baselineStartDate,
        baselineEndDate,
        progressPercent: meta?.progress ?? 0,
        isUnscheduled,
        storyPoints: meta?.story_points ?? null,
        titleCache: issue.title,
        descriptionCache: (issue.description as string | null) ?? null,
        stateCache: issue.state,
        closedAt,
        labelsCache,
        assigneesCache: extractAssignees(issue.assignees),
        milestoneId: milestoneLocalId,
        ...task,
      },
      update: {
        startDate,
        endDate,
        baselineStartDate,
        baselineEndDate,
        progressPercent: meta?.progress ?? undefined,
        isUnscheduled,
        storyPoints: syncedStoryPoints(issue.description as string | null, meta),
        titleCache: issue.title,
        descriptionCache: (issue.description as string | null) ?? null,
        stateCache: issue.state,
        closedAt,
        labelsCache,
        assigneesCache: extractAssignees(issue.assignees),
        milestoneId: milestoneLocalId,
        ...task,
        lastSyncedAt: new Date(),
      },
      select: { id: true },
    });

    // State-Transition gegenüber dem vorherigen Stand (vor diesem Sync)?
    const prev = existingStates.get(issue.iid);
    if (prev && prev.state !== issue.state) {
      stateTransitions.push({ wpId: upserted.id, before: prev.state, after: issue.state });
    }

    result.workPackagesSynced += 1;
  }

  // AuditLog-Einträge für State-Transitions (gesammelt am Pass-1-Ende)
  if (stateTransitions.length > 0) {
    await tx.auditLog.createMany({
      data: stateTransitions.map((t) => ({
        userId: null,
        action: 'work_package.update',
        entityType: 'WorkPackage',
        entityId: t.wpId,
        before: { state: t.before },
        after: { state: t.after },
      })),
    });
  }

  // Pass 2: parent_id und Dependencies auflösen.
  // Lookup-Map: iid → WP.id (alle WPs in diesem Projekt)
  const allWps = await tx.workPackage.findMany({
    where: { projectId: projectInternalId, deletedAt: null },
    select: { id: true, gitlabIssueIid: true },
  });
  const iidToId = new Map(allWps.map((wp) => [wp.gitlabIssueIid, wp.id]));

  // Tasks ihrer Story zuordnen. Ohne GraphQL-Antwort bleibt alles, wie es war.
  if (options.taskParents) {
    for (const issue of issues) {
      if (!taskFields(issue).isTask) continue;
      const myId = iidToId.get(issue.iid);
      if (!myId) continue;
      const parentIid = options.taskParents.get(issue.iid) ?? null;
      const storyId = parentIid === null ? null : (iidToId.get(parentIid) ?? null);
      await tx.workPackage.update({ where: { id: myId }, data: { storyId } });
    }
  }

  for (const issue of issues) {
    const meta = parseGanttMeta(issue.description as string | null);
    const myId = iidToId.get(issue.iid);
    if (!myId) continue;

    // Parent vollständig aus meta synchronisieren (auch clearen wenn weg).
    // Vorher hatten wir nur `if meta.parent_iid → set` — eine in GitLab
    // entfernte parent_iid wurde lokal nicht widergespiegelt.
    let newParentId: string | null = null;
    if (meta?.parent_iid) {
      const lookupId = iidToId.get(meta.parent_iid);
      if (lookupId && lookupId !== myId) newParentId = lookupId;
    }
    await tx.workPackage.update({
      where: { id: myId },
      data: { parentId: newParentId },
    });
    if (newParentId) result.parentLinksResolved += 1;

    // Dependencies: delete-and-recreate damit in GitLab entfernte Dependencies
    // lokal verschwinden (alter upsert-only-Pfad hat sie behalten).
    await tx.dependency.deleteMany({ where: { successorId: myId } });
    if (meta?.dependencies?.length) {
      for (const dep of meta.dependencies) {
        const predId = iidToId.get(dep.iid);
        if (!predId || predId === myId) continue;
        try {
          await tx.dependency.create({
            data: {
              predecessorId: predId,
              successorId: myId,
              type: dep.type,
              lagDays: dep.lag_days ?? 0,
            },
          });
          result.dependenciesResolved += 1;
        } catch (err) {
          logger.warn(
            { err: String(err), iid: issue.iid, predIid: dep.iid },
            'dependency-create übersprungen',
          );
        }
      }
    }

    // Resource-Allocations: delete-and-recreate damit entfernte Allocations
    // auch lokal verschwinden.
    await tx.resourceAllocation.deleteMany({ where: { workPackageId: myId } });
    if (meta?.allocations?.length) {
      for (const a of meta.allocations) {
        await tx.resourceAllocation.create({
          data: {
            workPackageId: myId,
            gitlabUserId: a.gitlab_user_id,
            allocationPercent: a.percent,
          },
        });
      }
    }
  }

  // is_summary auf Parents setzen (alle WPs mit Kindern)
  const parents = await tx.workPackage.findMany({
    where: { projectId: projectInternalId, deletedAt: null, children: { some: {} } },
    select: { id: true },
  });
  if (parents.length > 0) {
    await tx.workPackage.updateMany({
      where: { id: { in: parents.map((p) => p.id) } },
      data: { isSummary: true },
    });
    for (const p of parents) summaryCandidateIds.add(p.id);
  }

  // ─── Cleanup: WPs deren Issue in GitLab nicht mehr existiert ───────────────
  // Soft-delete (gemäß REQUIREMENTS FR-S1 Issue deleted → WorkPackage soft-delete).
  const allWpsInDb = await tx.workPackage.findMany({
    where: { projectId: projectInternalId, deletedAt: null },
    select: { id: true, gitlabIssueIid: true },
  });
  const orphanIds = allWpsInDb
    .filter((wp) => !fetchedIssueIids.has(wp.gitlabIssueIid))
    .map((wp) => wp.id);
  if (orphanIds.length > 0) {
    await tx.workPackage.updateMany({
      where: { id: { in: orphanIds } },
      data: { deletedAt: new Date() },
    });
    // is_summary aufräumen: wenn ein gelöschtes WP der einzige Kind war,
    // muss der Parent nicht mehr Summary sein.
    const affectedParentRows = await tx.workPackage.findMany({
      where: {
        projectId: projectInternalId,
        deletedAt: null,
        isSummary: true,
      },
      select: { id: true, _count: { select: { children: { where: { deletedAt: null } } } } },
    });
    const parentsWithoutChildren = affectedParentRows
      .filter((p) => p._count.children === 0)
      .map((p) => p.id);
    if (parentsWithoutChildren.length > 0) {
      await tx.workPackage.updateMany({
        where: { id: { in: parentsWithoutChildren } },
        data: { isSummary: false },
      });
      for (const id of parentsWithoutChildren) summaryCandidateIds.add(id);
    }
  }

  result.summaryCandidateIds = [...summaryCandidateIds];

  logger.info(
    {
      projectInternalId,
      ...result,
      orphanedWorkPackages: orphanIds.length,
      orphanedMilestones: orphanMilestones.length,
    },
    'initial sync completed',
  );
  return result;
}

export type LabelCache = { name: string; color?: string };
export type AssigneeCache = {
  id: number;
  username: string;
  name: string;
  avatarUrl?: string;
};

function extractAssignees(input: unknown): AssigneeCache[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((a): AssigneeCache | null => {
      if (!a || typeof a !== 'object') return null;
      const obj = a as {
        id?: unknown;
        username?: unknown;
        name?: unknown;
        avatar_url?: unknown;
      };
      if (typeof obj.id !== 'number') return null;
      if (typeof obj.username !== 'string') return null;
      return {
        id: obj.id,
        username: obj.username,
        name: typeof obj.name === 'string' ? obj.name : obj.username,
        avatarUrl: typeof obj.avatar_url === 'string' ? obj.avatar_url : undefined,
      };
    })
    .filter((x): x is AssigneeCache => x !== null);
}

// ─── Live-Update für einen einzelnen Issue (vom Webhook genutzt) ───────────

export type IssueUpdate = {
  iid: number;
  title: string;
  description: string | null;
  state: 'opened' | 'closed';
  dueDate: string | null;
  createdAt: string | null;
  /** issue.closed_at aus GitLab. Fehlt es im Payload, springt der Zeitpunkt
   *  des Events ein — der Webhook trifft beim Schliessen ein. */
  closedAt: string | null;
  labels: unknown;
  assignees: unknown;
  // GitLab-Milestone-ID falls dem Issue ein Meilenstein zugeordnet ist
  milestoneId: number | null;
  /** Aus dem Webhook-Payload (type, time_estimate, total_time_spent). */
  task?: { isTask: boolean; estimateSeconds: number | null; spentSeconds: number | null };
  /** IID der Story bei Tasks; undefined = unbekannt, nichts ändern. */
  storyIid?: number | null;
};

export type IssueAction = 'create' | 'update' | 'state-only';

export async function applyIssueUpdate(
  tx: Tx,
  projectInternalId: string,
  issue: IssueUpdate,
  action: IssueAction = 'update',
): Promise<{ workPackageId: string; affectedParents: string[] }> {
  const meta = parseGanttMeta(issue.description);

  // Default-Strategie (analog zu performInitialSync)
  const created = issue.createdAt ? new Date(issue.createdAt) : new Date();
  created.setHours(0, 0, 0, 0);
  const startDate = meta?.start_date ? new Date(meta.start_date) : created;
  const fourteenLater = new Date(startDate);
  fourteenLater.setDate(fourteenLater.getDate() + 14);
  const endDate = issue.dueDate ? new Date(issue.dueDate) : fourteenLater;

  // Baseline: nur übernehmen wenn beide Felder gesetzt sind.
  const baselineStartDate =
    meta?.baseline_start && meta?.baseline_end ? new Date(meta.baseline_start) : null;
  const baselineEndDate =
    meta?.baseline_start && meta?.baseline_end ? new Date(meta.baseline_end) : null;

  const labelsCache = extractLabels(issue.labels);
  const assigneesCache = extractAssignees(issue.assignees);
  // Ohne Angabe (andere Aufrufer) bleiben die Task-Felder unangetastet.
  const task = issue.task ?? {};
  const isUnscheduled =
    issue.task?.isTask ||
    isUnscheduledStory({
      labels: labelNames(labelsCache),
      metaStartDate: meta?.start_date,
      dueDate: issue.dueDate,
    });

  let storyId: string | null | undefined;
  if (issue.storyIid !== undefined) {
    storyId =
      issue.storyIid === null
        ? null
        : ((
            await tx.workPackage.findUnique({
              where: { projectId_gitlabIssueIid: { projectId: projectInternalId, gitlabIssueIid: issue.storyIid } },
              select: { id: true },
            })
          )?.id ?? null);
  }

  // Siehe performInitialSync: offen ⇒ null, damit ein reopen die frühere
  // Schliessung nicht stehen lässt.
  const closedAt =
    issue.state === 'closed' ? new Date(issue.closedAt ?? Date.now()) : null;

  // Vorherigen State holen damit wir state-Transitions im AuditLog tracken
  // können (Velocity in /reports zählt darüber Closing-Events).
  const existing = await tx.workPackage.findUnique({
    where: {
      projectId_gitlabIssueIid: {
        projectId: projectInternalId,
        gitlabIssueIid: issue.iid,
      },
    },
    select: { id: true, stateCache: true },
  });

  // Milestone-Referenz auflösen (GitLab-ID → lokale Milestone.id)
  let milestoneLocalId: string | null = null;
  if (issue.milestoneId != null) {
    const localMs = await tx.milestone.findUnique({
      where: {
        projectId_gitlabMilestoneId: {
          projectId: projectInternalId,
          gitlabMilestoneId: issue.milestoneId,
        },
      },
      select: { id: true },
    });
    milestoneLocalId = localMs?.id ?? null;
  }

  const wp = await tx.workPackage.upsert({
    where: {
      projectId_gitlabIssueIid: {
        projectId: projectInternalId,
        gitlabIssueIid: issue.iid,
      },
    },
    create: {
      projectId: projectInternalId,
      gitlabIssueIid: issue.iid,
      startDate,
      endDate,
      baselineStartDate,
      baselineEndDate,
      progressPercent: meta?.progress ?? 0,
      isUnscheduled,
      storyPoints: meta?.story_points ?? null,
      titleCache: issue.title,
      descriptionCache: issue.description,
      stateCache: issue.state,
      closedAt,
      labelsCache,
      assigneesCache,
      milestoneId: milestoneLocalId,
      ...task,
      ...(storyId !== undefined ? { storyId } : {}),
    },
    update: {
      // Bei state-only Events (close/reopen) nicht alles überschreiben —
      // closedAt gehört aber dazu, das IST hier die Nachricht.
      ...(action === 'state-only'
        ? { stateCache: issue.state, closedAt, lastSyncedAt: new Date() }
        : {
            titleCache: issue.title,
            descriptionCache: issue.description,
            stateCache: issue.state,
            closedAt,
            endDate,
            startDate,
            baselineStartDate,
            baselineEndDate,
            progressPercent: meta?.progress ?? undefined,
            isUnscheduled,
            storyPoints: syncedStoryPoints(issue.description, meta),
            labelsCache,
            assigneesCache,
            milestoneId: milestoneLocalId,
            ...task,
            ...(storyId !== undefined ? { storyId } : {}),
            lastSyncedAt: new Date(),
          }),
    },
    select: { id: true },
  });

  // State-Transition? → AuditLog (Velocity-Tracking in /reports liest das)
  if (existing && existing.stateCache !== issue.state) {
    await tx.auditLog.create({
      data: {
        userId: null, // Webhook/Sync hat keinen User-Kontext
        action: 'work_package.update',
        entityType: 'WorkPackage',
        entityId: wp.id,
        before: { state: existing.stateCache },
        after: { state: issue.state },
      },
    });
  }

  const affectedParents: string[] = [];

  // Pass 2 für dieses einzelne Issue: parent_iid + dependencies auflösen
  if (action !== 'state-only') {
    // Parent
    let newParentId: string | null = null;
    if (meta?.parent_iid && meta.parent_iid !== issue.iid) {
      const parent = await tx.workPackage.findUnique({
        where: {
          projectId_gitlabIssueIid: {
            projectId: projectInternalId,
            gitlabIssueIid: meta.parent_iid,
          },
        },
        select: { id: true },
      });
      newParentId = parent?.id ?? null;
    }
    // alten Parent merken für is_summary-Update
    const previous = await tx.workPackage.findUnique({
      where: { id: wp.id },
      select: { parentId: true },
    });
    const oldParentId = previous?.parentId ?? null;
    if (oldParentId && oldParentId !== newParentId) affectedParents.push(oldParentId);
    if (newParentId && newParentId !== oldParentId) affectedParents.push(newParentId);

    await tx.workPackage.update({
      where: { id: wp.id },
      data: { parentId: newParentId },
    });

    // Dependencies neu setzen
    await tx.dependency.deleteMany({ where: { successorId: wp.id } });
    for (const dep of meta?.dependencies ?? []) {
      const pred = await tx.workPackage.findUnique({
        where: {
          projectId_gitlabIssueIid: {
            projectId: projectInternalId,
            gitlabIssueIid: dep.iid,
          },
        },
        select: { id: true },
      });
      if (!pred || pred.id === wp.id) continue;
      try {
        await tx.dependency.create({
          data: {
            predecessorId: pred.id,
            successorId: wp.id,
            type: dep.type,
            lagDays: dep.lag_days ?? 0,
          },
        });
      } catch {
        // ignore duplicates / race conditions
      }
    }

    // Resource-Allocations neu setzen
    if (meta?.allocations) {
      await tx.resourceAllocation.deleteMany({ where: { workPackageId: wp.id } });
      for (const a of meta.allocations) {
        await tx.resourceAllocation.create({
          data: {
            workPackageId: wp.id,
            gitlabUserId: a.gitlab_user_id,
            allocationPercent: a.percent,
          },
        });
      }
    }
  }

  // is_summary aktualisieren auf betroffenen Parents
  for (const parentId of affectedParents) {
    const childCount = await tx.workPackage.count({
      where: { parentId, deletedAt: null },
    });
    await tx.workPackage.update({
      where: { id: parentId },
      data: { isSummary: childCount > 0 },
    });
  }

  return { workPackageId: wp.id, affectedParents };
}

function extractLabels(labels: unknown): LabelCache[] {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((l): LabelCache | null => {
      if (typeof l === 'string') return { name: l };
      if (l && typeof l === 'object') {
        const obj = l as { name?: string; title?: string; color?: string };
        const name = obj.name ?? obj.title;
        if (!name) return null;
        return { name, color: typeof obj.color === 'string' ? obj.color : undefined };
      }
      return null;
    })
    .filter((x): x is LabelCache => x !== null);
}

// ── Pipeline-Auflösung für einen MR ────────────────────────────────────

type PipelineInfo = { id: number; status: string; webUrl: string | null };

/**
 * Pipeline zu einem Commit auf dem Zielbranch.
 *
 * Für gemergte MRs ist das die Antwort auf die Frage, die man beim Blick auf
 * die Zeile eigentlich stellt: ist der Stand, der auf dem Zielbranch gelandet
 * ist, grün? Die Pipelines des MR selbst laufen auf dem Source-Branch und
 * können rot sein, obwohl der Merge danach sauber durchlief — genau der Fall,
 * bei dem die Anzeige vorher „failed" neben einem gemergten MR zeigte.
 *
 * Null wenn es zu dem Commit keine Pipeline gibt (Repos ohne CI, oder der
 * Merge-Commit hat schlicht keine ausgelöst) — dann greift der Fallback auf
 * die MR-Pipeline.
 */
async function pipelineForCommit(
  client: GitlabClient,
  gitlabProjectId: number,
  sha: string,
): Promise<PipelineInfo | null> {
  try {
    const pipelines = (await client.Pipelines.all(gitlabProjectId, {
      sha,
      perPage: 1,
    })) as Array<Record<string, unknown>>;
    if (pipelines.length === 0) return null;
    return {
      id: pipelines[0].id as number,
      status: pipelines[0].status as string,
      webUrl: (pipelines[0].web_url as string) ?? null,
    };
  } catch (err) {
    logger.warn({ err: String(err), sha }, 'pipeline-fetch für Merge-Commit fehlgeschlagen');
    return null;
  }
}

/** Letzte Pipeline des MR selbst (Source-Branch). */
async function lastPipelineOfMr(
  client: GitlabClient,
  gitlabProjectId: number,
  mrIid: number,
): Promise<PipelineInfo | null> {
  try {
    const pipelines = (await client.MergeRequests.allPipelines(gitlabProjectId, mrIid, {
      perPage: 1,
    })) as Array<Record<string, unknown>>;
    if (pipelines.length === 0) return null;
    return {
      id: pipelines[0].id as number,
      status: pipelines[0].status as string,
      webUrl: (pipelines[0].web_url as string) ?? null,
    };
  } catch {
    // soft-fail — die MR-Zeile ist auch ohne Pipeline-Badge brauchbar
    return null;
  }
}

// ── MR/Pipeline-Sync für einen einzelnen WP ────────────────────────────
// Eigenständige Funktion OHNE TX-Param damit sie ausserhalb von langlaufenden
// Transactions verwendet werden kann (Initial-Sync, Webhook). Macht die
// GitLab-Roundtrips, schreibt dann in einem Schritt in die DB.
export async function syncWorkPackageMergeRequests(
  client: GitlabClient,
  gitlabProjectId: number,
  workPackageId: string,
  issueIid: number,
): Promise<void> {
  let mrsRaw: Array<Record<string, unknown>>;
  try {
    mrsRaw = (await client.Issues.allRelatedMergeRequests(
      gitlabProjectId,
      issueIid,
    )) as Array<Record<string, unknown>>;
  } catch (err) {
    logger.warn({ err: String(err), issueIid }, 'mr-fetch fehlgeschlagen, überspringe');
    return;
  }

  // Pipelines pro MR parallel — typische Issues haben 0-3 MRs.
  const records = await Promise.all(
    mrsRaw.map(async (mr) => {
      const mrIid = mr.iid as number;
      const state = (mr.state as string) ?? 'opened';
      // Bei Squash-Merges ist merge_commit_sha leer und der Stand landet unter
      // squash_commit_sha auf dem Zielbranch.
      const mergeCommitSha =
        state === 'merged'
          ? ((mr.merge_commit_sha as string | null) ??
            (mr.squash_commit_sha as string | null) ??
            null)
          : null;

      const pipeline =
        (mergeCommitSha ? await pipelineForCommit(client, gitlabProjectId, mergeCommitSha) : null) ??
        (await lastPipelineOfMr(client, gitlabProjectId, mrIid));

      const author = mr.author as Record<string, unknown> | null;
      return {
        workPackageId,
        mrIid,
        title: (mr.title as string) ?? '',
        state,
        sourceBranch: (mr.source_branch as string | null) ?? null,
        targetBranch: (mr.target_branch as string | null) ?? null,
        webUrl: (mr.web_url as string) ?? '',
        mergeCommitSha,
        pipelineId: pipeline?.id ?? null,
        pipelineStatus: pipeline?.status ?? null,
        pipelineWebUrl: pipeline?.webUrl ?? null,
        authorName: author ? ((author.name as string) ?? null) : null,
        authorAvatarUrl: author ? ((author.avatar_url as string | null) ?? null) : null,
      };
    }),
  );

  // Delete + recreate in einer kleinen TX (Anzahl klein, simpler als ID-Upsert).
  await prisma.$transaction(async (tx) => {
    await tx.workPackageMr.deleteMany({ where: { workPackageId } });
    if (records.length > 0) {
      await tx.workPackageMr.createMany({ data: records });
    }
  });
}

// Bulk-Variante für Initial-Sync. Sequenziell um GitLab-Rate-Limits zu
// schonen; pro WP eigene kleine TX.
export async function syncAllWorkPackageMergeRequests(
  client: GitlabClient,
  projectInternalId: string,
  gitlabProjectId: number,
): Promise<{ synced: number; failed: number }> {
  const wps = await prisma.workPackage.findMany({
    where: { projectId: projectInternalId, deletedAt: null },
    select: { id: true, gitlabIssueIid: true },
  });
  let synced = 0;
  let failed = 0;
  for (const wp of wps) {
    try {
      await syncWorkPackageMergeRequests(client, gitlabProjectId, wp.id, wp.gitlabIssueIid);
      synced += 1;
    } catch (err) {
      logger.warn({ err: String(err), wpId: wp.id }, 'mr-bulk-sync für WP fehlgeschlagen');
      failed += 1;
    }
  }
  logger.info({ projectInternalId, synced, failed }, 'mr-bulk-sync abgeschlossen');
  return { synced, failed };
}

/** Task-Merkmale aus einem REST-Issue oder Webhook-Payload. */
export function taskFields(issue: unknown): { isTask: boolean; estimateSeconds: number | null; spentSeconds: number | null } {
  const o = issue as {
    issue_type?: unknown;
    type?: unknown;
    time_stats?: { time_estimate?: unknown; total_time_spent?: unknown };
    time_estimate?: unknown;
    total_time_spent?: unknown;
  };
  const type = typeof o.issue_type === 'string' ? o.issue_type : typeof o.type === 'string' ? o.type : '';
  const estimate = o.time_stats?.time_estimate ?? o.time_estimate;
  const spent = o.time_stats?.total_time_spent ?? o.total_time_spent;
  return {
    isTask: type.toLowerCase() === 'task',
    estimateSeconds: typeof estimate === 'number' && estimate > 0 ? estimate : null,
    spentSeconds: typeof spent === 'number' && spent > 0 ? spent : null,
  };
}
