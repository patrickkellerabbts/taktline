// Risiko-Logik für Web-App und Agenten-API. Wer ändert, steckt im Actor: die
// angemeldete Person oder ein Agent (GitLab-Username, ohne Taktline-Konto).
// Jede Feldänderung landet in RiskHistory.
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';

export type RiskActor = { userId: string | null; agent?: string };

function who(actor: RiskActor) {
  return { userId: actor.userId, agent: actor.agent ?? null };
}

// ─── Validierungs-Helper ─────────────────────────────────────────────

function clampScore(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 1;
  return Math.max(1, Math.min(5, Math.round(x)));
}

function trimOrNull(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

// ─── Types ──────────────────────────────────────────────────────────

export type RiskStatus =
  | 'identified'
  | 'in_progress'
  | 'mitigated'
  | 'accepted'
  | 'occurred'
  | 'closed';

export const VALID_STATUSES: RiskStatus[] = [
  'identified',
  'in_progress',
  'mitigated',
  'accepted',
  'occurred',
  'closed',
];

export type CreateRiskInput = {
  projectId: string;
  title: string;
  description?: string;
  category?: string;
  probabilityPre: number;
  impactPre: number;
};

export type UpdateRiskInput = {
  title?: string;
  description?: string | null;
  category?: string | null;
  status?: RiskStatus;
  probabilityPre?: number;
  impactPre?: number;
  probabilityPost?: number | null;
  impactPost?: number | null;
  mitigationPlan?: string | null;
  contingencyPlan?: string | null;
  ownerUserId?: string | null;
  nextReviewAt?: string | null; // ISO date
};

// ─── Operationen ────────────────────────────────────────────────────


export async function createRisk(
  actor: RiskActor,
  input: CreateRiskInput,
): Promise<{ ok: true; riskId: string } | { ok: false; error: string }> {
  const title = trimOrNull(input.title);
  if (!title) return { ok: false, error: 'Titel ist Pflicht' };

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true },
  });
  if (!project) return { ok: false, error: 'Projekt nicht gefunden' };

  const risk = await prisma.risk.create({
    data: {
      projectId: input.projectId,
      title,
      description: trimOrNull(input.description),
      category: trimOrNull(input.category),
      probabilityPre: clampScore(input.probabilityPre),
      impactPre: clampScore(input.impactPre),
    },
  });

  await prisma.riskHistory.create({
    data: {
      riskId: risk.id,
      ...who(actor),
      field: 'created',
      newValue: JSON.stringify({
        title,
        probabilityPre: risk.probabilityPre,
        impactPre: risk.impactPre,
      }),
    },
  });

  revalidatePath(`/projects/${input.projectId}/risks`);
  return { ok: true, riskId: risk.id };
}

export async function updateRisk(
  actor: RiskActor,
  riskId: string,
  patch: UpdateRiskInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await prisma.risk.findUnique({
    where: { id: riskId },
    select: {
      id: true,
      projectId: true,
      title: true,
      description: true,
      category: true,
      status: true,
      probabilityPre: true,
      impactPre: true,
      probabilityPost: true,
      impactPost: true,
      mitigationPlan: true,
      contingencyPlan: true,
      ownerUserId: true,
      nextReviewAt: true,
      closedAt: true,
    },
  });
  if (!existing) return { ok: false, error: 'Risiko nicht gefunden' };

  // History-Einträge sammeln pro geändertem Feld.
  const historyEntries: Array<{
    field: string;
    oldValue: string | null;
    newValue: string | null;
  }> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {};

  if (patch.title !== undefined) {
    const next = trimOrNull(patch.title);
    if (!next) return { ok: false, error: 'Titel ist Pflicht' };
    if (next !== existing.title) {
      data.title = next;
      historyEntries.push({ field: 'title', oldValue: existing.title, newValue: next });
    }
  }
  if (patch.description !== undefined) {
    const next = trimOrNull(patch.description);
    if (next !== existing.description) {
      data.description = next;
      historyEntries.push({
        field: 'description',
        oldValue: existing.description,
        newValue: next,
      });
    }
  }
  if (patch.category !== undefined) {
    const next = trimOrNull(patch.category);
    if (next !== existing.category) {
      data.category = next;
      historyEntries.push({ field: 'category', oldValue: existing.category, newValue: next });
    }
  }
  if (patch.status !== undefined && VALID_STATUSES.includes(patch.status)) {
    if (patch.status !== existing.status) {
      data.status = patch.status;
      // closedAt automatisch setzen/clearen
      if (patch.status === 'closed' && !existing.closedAt) {
        data.closedAt = new Date();
      } else if (patch.status !== 'closed' && existing.closedAt) {
        data.closedAt = null;
      }
      historyEntries.push({ field: 'status', oldValue: existing.status, newValue: patch.status });
    }
  }
  if (patch.probabilityPre !== undefined) {
    const next = clampScore(patch.probabilityPre);
    if (next !== existing.probabilityPre) {
      data.probabilityPre = next;
      historyEntries.push({
        field: 'probabilityPre',
        oldValue: String(existing.probabilityPre),
        newValue: String(next),
      });
    }
  }
  if (patch.impactPre !== undefined) {
    const next = clampScore(patch.impactPre);
    if (next !== existing.impactPre) {
      data.impactPre = next;
      historyEntries.push({
        field: 'impactPre',
        oldValue: String(existing.impactPre),
        newValue: String(next),
      });
    }
  }
  if (patch.probabilityPost !== undefined) {
    const next = patch.probabilityPost === null ? null : clampScore(patch.probabilityPost);
    if (next !== existing.probabilityPost) {
      data.probabilityPost = next;
      historyEntries.push({
        field: 'probabilityPost',
        oldValue: existing.probabilityPost == null ? null : String(existing.probabilityPost),
        newValue: next == null ? null : String(next),
      });
    }
  }
  if (patch.impactPost !== undefined) {
    const next = patch.impactPost === null ? null : clampScore(patch.impactPost);
    if (next !== existing.impactPost) {
      data.impactPost = next;
      historyEntries.push({
        field: 'impactPost',
        oldValue: existing.impactPost == null ? null : String(existing.impactPost),
        newValue: next == null ? null : String(next),
      });
    }
  }
  if (patch.mitigationPlan !== undefined) {
    const next = trimOrNull(patch.mitigationPlan);
    if (next !== existing.mitigationPlan) {
      data.mitigationPlan = next;
      historyEntries.push({
        field: 'mitigationPlan',
        oldValue: existing.mitigationPlan,
        newValue: next,
      });
    }
  }
  if (patch.contingencyPlan !== undefined) {
    const next = trimOrNull(patch.contingencyPlan);
    if (next !== existing.contingencyPlan) {
      data.contingencyPlan = next;
      historyEntries.push({
        field: 'contingencyPlan',
        oldValue: existing.contingencyPlan,
        newValue: next,
      });
    }
  }
  if (patch.ownerUserId !== undefined) {
    const next = patch.ownerUserId;
    if (next !== existing.ownerUserId) {
      data.ownerUserId = next;
      historyEntries.push({
        field: 'ownerUserId',
        oldValue: existing.ownerUserId,
        newValue: next,
      });
    }
  }
  if (patch.nextReviewAt !== undefined) {
    const next = patch.nextReviewAt ? new Date(patch.nextReviewAt) : null;
    const same =
      (next === null && existing.nextReviewAt === null) ||
      (next instanceof Date &&
        existing.nextReviewAt instanceof Date &&
        next.getTime() === existing.nextReviewAt.getTime());
    if (!same) {
      data.nextReviewAt = next;
      historyEntries.push({
        field: 'nextReviewAt',
        oldValue: existing.nextReviewAt ? existing.nextReviewAt.toISOString() : null,
        newValue: next ? next.toISOString() : null,
      });
    }
  }

  if (Object.keys(data).length === 0) {
    return { ok: true };
  }

  await prisma.$transaction(async (tx) => {
    await tx.risk.update({ where: { id: riskId }, data });
    if (historyEntries.length > 0) {
      await tx.riskHistory.createMany({
        data: historyEntries.map((h) => ({
          riskId,
          ...who(actor),
          field: h.field,
          oldValue: h.oldValue,
          newValue: h.newValue,
        })),
      });
    }
  });

  revalidatePath(`/projects/${existing.projectId}/risks`);
  return { ok: true };
}

export async function deleteRisk(
  actor: RiskActor,
  riskId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await prisma.risk.findUnique({
    where: { id: riskId },
    select: { projectId: true },
  });
  if (!existing) return { ok: false, error: 'Risiko nicht gefunden' };

  await prisma.risk.delete({ where: { id: riskId } });
  logger.info({ riskId, ...who(actor) }, 'risk deleted');
  revalidatePath(`/projects/${existing.projectId}/risks`);
  return { ok: true };
}


// ─── Verlinkungen WPs/Milestones ────────────────────────────────────

export async function setRiskLinkedWorkPackages(
  actor: RiskActor,
  riskId: string,
  workPackageIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await prisma.risk.findUnique({
    where: { id: riskId },
    select: { projectId: true, linkedWps: { select: { workPackageId: true } } },
  });
  if (!existing) return { ok: false, error: 'Risiko nicht gefunden' };

  const next = new Set(workPackageIds);
  const old = new Set(existing.linkedWps.map((l) => l.workPackageId));
  const toAdd = [...next].filter((id) => !old.has(id));
  const toRemove = [...old].filter((id) => !next.has(id));

  await prisma.$transaction(async (tx) => {
    if (toRemove.length > 0) {
      await tx.riskWorkPackage.deleteMany({
        where: { riskId, workPackageId: { in: toRemove } },
      });
    }
    if (toAdd.length > 0) {
      await tx.riskWorkPackage.createMany({
        data: toAdd.map((wpId) => ({ riskId, workPackageId: wpId })),
        skipDuplicates: true,
      });
    }
    if (toAdd.length > 0 || toRemove.length > 0) {
      await tx.riskHistory.create({
        data: {
          riskId,
          ...who(actor),
          field: 'linkedWorkPackages',
          oldValue: JSON.stringify([...old]),
          newValue: JSON.stringify([...next]),
        },
      });
    }
  });

  revalidatePath(`/projects/${existing.projectId}/risks`);
  return { ok: true };
}

export async function setRiskLinkedMilestones(
  actor: RiskActor,
  riskId: string,
  milestoneIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await prisma.risk.findUnique({
    where: { id: riskId },
    select: { projectId: true, linkedMs: { select: { milestoneId: true } } },
  });
  if (!existing) return { ok: false, error: 'Risiko nicht gefunden' };

  const next = new Set(milestoneIds);
  const old = new Set(existing.linkedMs.map((l) => l.milestoneId));
  const toAdd = [...next].filter((id) => !old.has(id));
  const toRemove = [...old].filter((id) => !next.has(id));

  await prisma.$transaction(async (tx) => {
    if (toRemove.length > 0) {
      await tx.riskMilestone.deleteMany({
        where: { riskId, milestoneId: { in: toRemove } },
      });
    }
    if (toAdd.length > 0) {
      await tx.riskMilestone.createMany({
        data: toAdd.map((msId) => ({ riskId, milestoneId: msId })),
        skipDuplicates: true,
      });
    }
    if (toAdd.length > 0 || toRemove.length > 0) {
      await tx.riskHistory.create({
        data: {
          riskId,
          ...who(actor),
          field: 'linkedMilestones',
          oldValue: JSON.stringify([...old]),
          newValue: JSON.stringify([...next]),
        },
      });
    }
  });

  revalidatePath(`/projects/${existing.projectId}/risks`);
  return { ok: true };
}
