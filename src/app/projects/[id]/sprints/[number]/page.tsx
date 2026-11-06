import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { AppHeader, SubHeader } from '@/components/layout/AppHeader';
import { RetroView } from '@/components/sprints/RetroView';
import { loadRetro } from '@/lib/agile/retro';

type Props = { params: Promise<{ id: string; number: string }> };

export default async function SprintRetroPage({ params }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const { id, number } = await params;
  if (!/^\d+$/.test(number)) notFound();

  const project = await prisma.project.findUnique({ where: { id }, select: { nameCache: true } });
  if (!project) notFound();
  const data = await loadRetro(id, Number(number), session.user.id);
  if (!data) notFound();

  return (
    <div className="app">
      <AppHeader username={session.user.username} active="sprints" />
      <SubHeader
        crumbs={[
          { label: 'Projekte', href: '/projects' },
          project.nameCache,
          { label: 'Sprints', href: `/projects/${id}/sprints` },
          `${data.sprint.name}: Review & Retro`,
        ]}
      />
      <div style={{ flex: 1, padding: '14px 18px', minHeight: 0, overflowY: 'auto' }}>
        <RetroView data={data} />
      </div>
    </div>
  );
}
