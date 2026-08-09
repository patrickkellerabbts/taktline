// Universalsuche über aktivierte Projekte, Work Packages und Meilensteine.
// Backend für das Cmd+K Modal.

import { prisma } from './db';

export type SearchProjectHit = {
  kind: 'project';
  id: string;
  name: string;
  href: string;
};

export type SearchWorkPackageHit = {
  kind: 'workPackage';
  id: string;
  title: string;
  iid: number;
  state: string;
  projectName: string;
  href: string;
};

export type SearchMilestoneHit = {
  kind: 'milestone';
  id: string;
  title: string;
  projectName: string;
  href: string;
};

export type SearchResults = {
  projects: SearchProjectHit[];
  workPackages: SearchWorkPackageHit[];
  milestones: SearchMilestoneHit[];
};

const PER_CATEGORY_LIMIT = 10;

export async function searchEverything(q: string): Promise<SearchResults> {
  const query = q.trim();
  if (query.length === 0) {
    return { projects: [], workPackages: [], milestones: [] };
  }

  // Numerischer Eingabe → IID-Match priorisieren (z.B. "#45" oder "45")
  const iidMatch = query.match(/^#?(\d+)$/);
  const numericQuery = iidMatch ? Number(iidMatch[1]) : null;

  // Parallel-Query gegen alle drei Entitäten
  const [projects, workPackages, milestones] = await Promise.all([
    prisma.project.findMany({
      where: {
        nameCache: { contains: query, mode: 'insensitive' },
      },
      take: PER_CATEGORY_LIMIT,
      orderBy: { nameCache: 'asc' },
      select: { id: true, nameCache: true },
    }),
    prisma.workPackage.findMany({
      where: {
        deletedAt: null,
        OR: [
          { titleCache: { contains: query, mode: 'insensitive' } },
          ...(numericQuery !== null ? [{ gitlabIssueIid: numericQuery }] : []),
        ],
      },
      take: PER_CATEGORY_LIMIT,
      orderBy: [{ stateCache: 'asc' }, { titleCache: 'asc' }],
      select: {
        id: true,
        titleCache: true,
        gitlabIssueIid: true,
        stateCache: true,
        projectId: true,
        project: { select: { nameCache: true } },
      },
    }),
    prisma.milestone.findMany({
      where: {
        titleCache: { contains: query, mode: 'insensitive' },
      },
      take: PER_CATEGORY_LIMIT,
      orderBy: { titleCache: 'asc' },
      select: {
        id: true,
        titleCache: true,
        projectId: true,
        project: { select: { nameCache: true } },
      },
    }),
  ]);

  return {
    projects: projects.map((p) => ({
      kind: 'project' as const,
      id: p.id,
      name: p.nameCache,
      href: `/projects/${p.id}/gantt`,
    })),
    workPackages: workPackages.map((w) => ({
      kind: 'workPackage' as const,
      id: w.id,
      title: w.titleCache,
      iid: w.gitlabIssueIid,
      state: w.stateCache,
      projectName: w.project.nameCache,
      href: `/projects/${w.projectId}/gantt?wp=${w.id}`,
    })),
    milestones: milestones.map((m) => ({
      kind: 'milestone' as const,
      id: m.id,
      title: m.titleCache,
      projectName: m.project.nameCache,
      href: `/projects/${m.projectId}/gantt?ms=${m.id}`,
    })),
  };
}
