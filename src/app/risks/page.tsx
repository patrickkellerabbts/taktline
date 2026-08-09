import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { parsePreferences } from '@/lib/preferences';

// /risks = Convenience-Route: springt zur Risiko-Übersicht des zuletzt
// geöffneten Projekts. Fallback auf /projects wenn nichts gespeichert oder
// das Projekt nicht mehr existiert.
export default async function RisksIndexPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { preferences: true },
  });
  const prefs = parsePreferences(user?.preferences);

  if (prefs.lastOpenedProjectId) {
    const project = await prisma.project.findUnique({
      where: { id: prefs.lastOpenedProjectId },
      select: { id: true },
    });
    if (project) redirect(`/projects/${project.id}/risks`);
  }

  redirect('/projects');
}
