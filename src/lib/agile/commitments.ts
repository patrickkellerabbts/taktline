// Scrum-Zusagen nach dem Scrum Guide 2020: Product Goal und Definition of Done
// pro Projekt, das Sprint-Ziel steht am Sprint. Dazu die Velocity aus den
// abgeschlossenen Sprints als Richtwert für die nächste Planung.
import { prisma } from '@/lib/db';

export { VELOCITY_WINDOW, computeVelocity, type Velocity } from './velocity';

export type { Commitments } from './velocity';
import type { Commitments } from './velocity';

export const DOD_MAX_ITEMS = 20;

export function parseDefinitionOfDone(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').slice(0, DOD_MAX_ITEMS);
}

export async function loadCommitments(projectId: string): Promise<Commitments | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { productGoal: true, definitionOfDone: true },
  });
  if (!project) return null;
  return {
    productGoal: project.productGoal,
    definitionOfDone: parseDefinitionOfDone(project.definitionOfDone),
  };
}
