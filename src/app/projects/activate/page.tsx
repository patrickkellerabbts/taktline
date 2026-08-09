import { redirect } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { AppHeader, SubHeader } from '@/components/layout/AppHeader';
import { getGitlabClientForUser } from '@/lib/gitlab/client';
import { GitlabTokenExpiredError } from '@/lib/auth/encrypted-adapter';
import { listAccessibleProjects } from '@/lib/gitlab/projects';
import { ActivateView, type ProjectRow } from './ActivateView';

export default async function ActivatePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  let client;
  try {
    client = await getGitlabClientForUser(session.user.id);
  } catch (err) {
    if (err instanceof GitlabTokenExpiredError) {
      // Session abgelaufen → ausloggen + zurück auf Login. signOut macht der
      // Browser via callback nach dem Redirect (POST von /api/auth/signout).
      redirect('/api/auth/signout?callbackUrl=/login%3Fexpired%3D1');
    }
    throw err;
  }
  const [available, activated] = await Promise.all([
    listAccessibleProjects(client),
    prisma.project.findMany({ select: { gitlabProjectId: true, id: true } }),
  ]);
  const activatedMap = new Map(activated.map((p) => [p.gitlabProjectId, p.id]));

  const projects: ProjectRow[] = available.map((p) => ({
    gitlabProjectId: p.id,
    name: p.name,
    pathWithNamespace: p.pathWithNamespace,
    description: p.description,
    activatedId: activatedMap.get(p.id) ?? null,
  }));

  return (
    <div className="app">
      <AppHeader username={session.user.username} active="projects" />
      <SubHeader
        crumbs={[{ label: 'Projekte', href: '/projects' }, 'Projekt aktivieren']}
        right={
          <button type="button" className="btn">
            <RefreshCw size={13} />
            <span>GitLab-Liste neu laden</span>
          </button>
        }
      />
      <ActivateView projects={projects} />
    </div>
  );
}
