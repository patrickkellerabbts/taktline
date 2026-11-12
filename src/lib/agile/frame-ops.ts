// Scrum-Rahmen eines Projekts (Product Goal, Definition of Done, WIP-Limits)
// für Web-App und Agenten-API. Liegt nur in der Taktline-DB; jede Änderung
// kommt ins Audit-Log, bei Agenten mit ihrem GitLab-Username.
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import type { BoardColumnId } from './board';
import { WIP_COLUMNS, parseWipLimits } from './flow-shared';
import { DOD_MAX_ITEMS, parseDefinitionOfDone } from './commitments';

export type FrameActor = { userId: string | null; agent?: string };
type Result = { ok: true; changed: boolean } | { ok: false; error: string };

export const ProductGoalSchema = z.string().trim().max(2000, 'Das Product Goal ist zu lang');
export const DodSchema = z
  .array(z.string().trim().min(1).max(200, 'Ein Punkt der Definition of Done ist zu lang'))
  .max(DOD_MAX_ITEMS, `Höchstens ${DOD_MAX_ITEMS} Punkte`);

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}/sprints`);
  revalidatePath(`/projects/${projectId}/board`);
}

function audit(actor: FrameActor, action: string, projectId: string, before: unknown, after: unknown) {
  return prisma.auditLog.create({
    data: {
      userId: actor.userId,
      action,
      entityType: 'Project',
      entityId: projectId,
      before: { value: before as never },
      after: { value: after as never, ...(actor.agent ? { agent: actor.agent } : {}) },
    },
  });
}

export async function setProductGoal(actor: FrameActor, projectId: string, raw: string): Promise<Result> {
  const parsed = ProductGoalSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { productGoal: true } });
  if (!project) return { ok: false, error: 'Projekt nicht gefunden' };
  const next = parsed.data || null;
  if (next === project.productGoal) return { ok: true, changed: false };
  await prisma.project.update({ where: { id: projectId }, data: { productGoal: next } });
  await audit(actor, 'project.productGoal', projectId, project.productGoal, next);
  revalidate(projectId);
  return { ok: true, changed: true };
}

export async function setDefinitionOfDone(actor: FrameActor, projectId: string, raw: string[]): Promise<Result> {
  const parsed = DodSchema.safeParse(raw.filter((item) => item.trim() !== ''));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { definitionOfDone: true } });
  if (!project) return { ok: false, error: 'Projekt nicht gefunden' };
  const before = parseDefinitionOfDone(project.definitionOfDone);
  if (JSON.stringify(before) === JSON.stringify(parsed.data)) return { ok: true, changed: false };
  await prisma.project.update({ where: { id: projectId }, data: { definitionOfDone: parsed.data } });
  await audit(actor, 'project.definitionOfDone', projectId, before, parsed.data);
  revalidate(projectId);
  return { ok: true, changed: true };
}

export async function setWipLimit(
  actor: FrameActor,
  projectId: string,
  column: BoardColumnId,
  limit: number | null,
): Promise<Result> {
  if (!WIP_COLUMNS.includes(column)) return { ok: false, error: `WIP-Limits gibt es nur für ${WIP_COLUMNS.join(', ')}` };
  if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 99)) {
    return { ok: false, error: 'Das Limit muss eine ganze Zahl zwischen 1 und 99 sein' };
  }
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { wipLimits: true } });
  if (!project) return { ok: false, error: 'Projekt nicht gefunden' };
  const before = parseWipLimits(project.wipLimits);
  const limits = { ...before };
  if (limit === null) delete limits[column];
  else limits[column] = limit;
  if ((before[column] ?? null) === limit) return { ok: true, changed: false };
  await prisma.project.update({ where: { id: projectId }, data: { wipLimits: limits } });
  await audit(actor, 'project.wipLimit', projectId, before, limits);
  revalidate(projectId);
  revalidatePath(`/projects/${projectId}/gantt`);
  return { ok: true, changed: true };
}
