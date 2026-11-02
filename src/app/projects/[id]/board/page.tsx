import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { parsePreferences } from '@/lib/preferences';
import { savePreferencesAction } from '@/lib/preferences-actions';
import { AppHeader, SubHeader } from '@/components/layout/AppHeader';
import { BoardView, type BoardCard, type BoardPerson } from '@/components/board/BoardView';
import { columnForIssue, isReservedLabel, isStory, labelNames } from '@/lib/agile/board';
import { parseStoryDescription } from '@/lib/agile/story';
import { stripGanttMeta } from '@/lib/gitlab/meta';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ story?: string }>;
};

export default async function BoardPage({ params, searchParams }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const { id } = await params;
  const { story: initialStoryId } = await searchParams;

  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      nameCache: true,
      labels: { orderBy: { name: 'asc' }, select: { name: true, color: true } },
      workPackages: {
        // Summary-Tasks sind Container im Gantt, keine Arbeit auf dem Board.
        where: { deletedAt: null, isSummary: false },
        // Noch nie einsortierte Karten stehen am Ende, nach Issue-Nummer.
        orderBy: [{ boardRank: { sort: 'asc', nulls: 'last' } }, { gitlabIssueIid: 'asc' }],
        select: {
          id: true,
          gitlabIssueIid: true,
          titleCache: true,
          descriptionCache: true,
          stateCache: true,
          labelsCache: true,
          assigneesCache: true,
          startDate: true,
          endDate: true,
          isUnscheduled: true,
          storyPoints: true,
        },
      },
    },
  });
  if (!project) notFound();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { preferences: true },
  });
  if (parsePreferences(user?.preferences).lastOpenedProjectId !== id) {
    void savePreferencesAction({ lastOpenedProjectId: id });
  }

  const labelColors = new Map(project.labels.map((l) => [l.name, l.color ?? undefined]));

  const cards: BoardCard[] = project.workPackages.map((wp) => {
    const names = labelNames(wp.labelsCache);
    const story = isStory(names);
    const fields = parseStoryDescription(stripGanttMeta(wp.descriptionCache));
    return {
      id: wp.id,
      iid: wp.gitlabIssueIid,
      title: wp.titleCache,
      column: columnForIssue(wp.stateCache, names),
      isStory: story,
      storyPoints: wp.storyPoints,
      labels: names
        .filter((n) => !isReservedLabel(n))
        .map((name) => ({ name, color: labelColors.get(name) })),
      assignees: parsePeople(wp.assigneesCache),
      startDate: wp.isUnscheduled ? null : wp.startDate.toISOString().slice(0, 10),
      endDate: wp.isUnscheduled ? null : wp.endDate.toISOString().slice(0, 10),
      story: story ? fields : null,
    };
  });

  // GitLab-Mitglieder liegen nicht lokal; zur Auswahl stehen alle, die im
  // Projekt schon zugewiesen waren, plus alle in Taktline angemeldeten Nutzer.
  const users = await prisma.user.findMany({
    select: { gitlabUserId: true, username: true, name: true, avatarUrl: true },
  });
  const people = new Map<number, BoardPerson>();
  for (const card of cards) for (const a of card.assignees) people.set(a.id, a);
  for (const u of users) {
    if (people.has(u.gitlabUserId) || !u.username) continue;
    people.set(u.gitlabUserId, {
      id: u.gitlabUserId,
      username: u.username,
      name: u.name ?? u.username,
      avatarUrl: u.avatarUrl ?? undefined,
    });
  }

  return (
    <div className="app">
      <AppHeader username={session.user.username} active="board" />
      <SubHeader
        crumbs={[{ label: 'Projekte', href: '/projects' }, project.nameCache, 'Board']}
      />
      <div style={{ flex: 1, padding: '14px 18px', minHeight: 0, display: 'flex' }}>
        <BoardView
          projectId={project.id}
          cards={cards}
          people={[...people.values()].sort((a, b) => a.name.localeCompare(b.name))}
          projectLabels={project.labels
            .filter((l) => !isReservedLabel(l.name))
            .map((l) => ({ name: l.name, color: l.color ?? undefined }))}
          initialStoryId={initialStoryId}
        />
      </div>
    </div>
  );
}

function parsePeople(cache: unknown): BoardPerson[] {
  if (!Array.isArray(cache)) return [];
  return cache.flatMap((entry): BoardPerson[] => {
    const o = entry as { id?: unknown; username?: unknown; name?: unknown; avatarUrl?: unknown };
    if (typeof o?.id !== 'number' || typeof o.username !== 'string') return [];
    return [
      {
        id: o.id,
        username: o.username,
        name: typeof o.name === 'string' ? o.name : o.username,
        avatarUrl: typeof o.avatarUrl === 'string' ? o.avatarUrl : undefined,
      },
    ];
  });
}
