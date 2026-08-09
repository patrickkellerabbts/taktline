import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { parsePreferences } from '@/lib/preferences';
import { savePreferencesAction } from '@/lib/preferences-actions';
import { AppHeader, SubHeader } from '@/components/layout/AppHeader';
import { RiskMatrixView } from '@/components/risks/RiskMatrixView';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ risk?: string }>;
};

export default async function RisksPage({ params, searchParams }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const { id } = await params;
  const { risk: initialSelectedRiskId } = await searchParams;

  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      nameCache: true,
      risks: {
        orderBy: { createdAt: 'desc' },
        include: {
          owner: {
            select: { id: true, name: true, username: true, avatarUrl: true },
          },
          linkedWps: {
            include: {
              workPackage: {
                select: { id: true, gitlabIssueIid: true, titleCache: true },
              },
            },
          },
          linkedMs: {
            include: {
              milestone: {
                select: { id: true, gitlabMilestoneId: true, titleCache: true },
              },
            },
          },
        },
      },
      workPackages: {
        where: { deletedAt: null },
        orderBy: { gitlabIssueIid: 'asc' },
        select: { id: true, gitlabIssueIid: true, titleCache: true },
      },
      milestones: {
        orderBy: { dueDateCache: 'asc' },
        select: { id: true, gitlabMilestoneId: true, titleCache: true },
      },
    },
  });
  if (!project) notFound();

  // lastOpenedProjectId persistieren (analog Gantt-Page) damit der
  // Nav-Link "Risiken" direkt hierher zurückspringt.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { preferences: true },
  });
  const prefs = parsePreferences(user?.preferences);
  if (prefs.lastOpenedProjectId !== id) {
    void savePreferencesAction({ lastOpenedProjectId: id });
  }

  // Alle möglichen Owner = aktivierte User des Projekts (alle die je
  // angemeldet waren). Vereinfacht: alle Users mit GitLab-Anmeldung.
  const allOwners = await prisma.user.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, username: true, avatarUrl: true },
  });

  const risks = project.risks.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    status: r.status,
    probabilityPre: r.probabilityPre,
    impactPre: r.impactPre,
    probabilityPost: r.probabilityPost,
    impactPost: r.impactPost,
    mitigationPlan: r.mitigationPlan,
    contingencyPlan: r.contingencyPlan,
    owner: r.owner,
    identifiedAt: r.identifiedAt.toISOString(),
    nextReviewAt: r.nextReviewAt ? r.nextReviewAt.toISOString() : null,
    closedAt: r.closedAt ? r.closedAt.toISOString() : null,
    linkedWorkPackages: r.linkedWps.map((l) => ({
      id: l.workPackage.id,
      iid: l.workPackage.gitlabIssueIid,
      title: l.workPackage.titleCache,
    })),
    linkedMilestones: r.linkedMs.map((l) => ({
      id: l.milestone.id,
      gitlabId: l.milestone.gitlabMilestoneId,
      title: l.milestone.titleCache,
    })),
  }));

  return (
    <div className="app">
      <AppHeader username={session.user.username} active="risks" />
      <SubHeader
        crumbs={[
          { label: 'Projekte', href: '/projects' },
          project.nameCache,
          'Risiken',
        ]}
        right={
          <span style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>
            <span className="mono tabnum">{risks.length}</span> Risiken
          </span>
        }
      />
      <div style={{ flex: 1, padding: '14px 18px', minHeight: 0, display: 'flex' }}>
        <RiskMatrixView
          projectId={project.id}
          risks={risks}
          workPackages={project.workPackages.map((wp) => ({
            id: wp.id,
            iid: wp.gitlabIssueIid,
            title: wp.titleCache,
          }))}
          milestones={project.milestones.map((m) => ({
            id: m.id,
            gitlabId: m.gitlabMilestoneId,
            title: m.titleCache,
          }))}
          allOwners={allOwners}
          initialSelectedRiskId={initialSelectedRiskId}
        />
      </div>
    </div>
  );
}
