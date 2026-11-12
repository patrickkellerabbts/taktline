'use server';

import { auth } from '@/auth';
import {
  createRisk,
  deleteRisk,
  setRiskLinkedMilestones,
  setRiskLinkedWorkPackages,
  updateRisk,
  type CreateRiskInput,
  type UpdateRiskInput,
} from '@/lib/risks/ops';

// Dünne Hüllen um lib/risks/ops.ts; dieselbe Logik nutzt die Agenten-API.

type Result = { ok: true } | { ok: false; error: string };

async function actor() {
  const session = await auth();
  return session?.user?.id ? { userId: session.user.id } : null;
}

export async function createRiskAction(
  input: CreateRiskInput,
): Promise<{ ok: true; riskId: string } | { ok: false; error: string }> {
  const a = await actor();
  if (!a) return { ok: false, error: 'Nicht angemeldet' };
  return createRisk(a, input);
}

export async function updateRiskAction(riskId: string, patch: UpdateRiskInput): Promise<Result> {
  const a = await actor();
  if (!a) return { ok: false, error: 'Nicht angemeldet' };
  return updateRisk(a, riskId, patch);
}

export async function deleteRiskAction(riskId: string): Promise<Result> {
  const a = await actor();
  if (!a) return { ok: false, error: 'Nicht angemeldet' };
  return deleteRisk(a, riskId);
}

// Spezial-Action für Drag-and-Drop in der Matrix: setzt nur die
// Pre- oder Post-Mitigation-Position.
export async function moveRiskAction(
  riskId: string,
  mode: 'pre' | 'post',
  probability: number,
  impact: number,
): Promise<Result> {
  const patch: UpdateRiskInput =
    mode === 'pre'
      ? { probabilityPre: probability, impactPre: impact }
      : { probabilityPost: probability, impactPost: impact };
  return updateRiskAction(riskId, patch);
}

export async function setRiskLinkedWorkPackagesAction(riskId: string, workPackageIds: string[]): Promise<Result> {
  const a = await actor();
  if (!a) return { ok: false, error: 'Nicht angemeldet' };
  return setRiskLinkedWorkPackages(a, riskId, workPackageIds);
}

export async function setRiskLinkedMilestonesAction(riskId: string, milestoneIds: string[]): Promise<Result> {
  const a = await actor();
  if (!a) return { ok: false, error: 'Nicht angemeldet' };
  return setRiskLinkedMilestones(a, riskId, milestoneIds);
}
