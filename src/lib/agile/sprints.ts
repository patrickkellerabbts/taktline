// Sprints: Die Zuordnung steht als Label `sprint::<nummer>` am GitLab-Issue und
// ist dort filterbar. Name, Ziel und Daten kennt nur die App-DB. Die Nummer ist
// fest, damit Umbenennen keine Issues anfasst.
import { prisma } from '@/lib/db';

export type SprintInfo = {
  id: string;
  number: number;
  name: string;
  goal: string | null;
  startDate: string;
  endDate: string;
  state: 'planned' | 'active' | 'closed';
  completedPoints: number | null;
  completedCount: number | null;
};

export async function loadProjectSprints(projectId: string): Promise<SprintInfo[]> {
  const sprints = await prisma.sprint.findMany({
    where: { projectId },
    orderBy: { number: 'asc' },
  });
  return sprints.map((s) => ({
    id: s.id,
    number: s.number,
    name: s.name,
    goal: s.goal,
    startDate: s.startDate.toISOString().slice(0, 10),
    endDate: s.endDate.toISOString().slice(0, 10),
    state: s.state,
    completedPoints: s.completedPoints,
    completedCount: s.completedCount,
  }));
}
