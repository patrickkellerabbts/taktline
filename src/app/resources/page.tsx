import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { parsePreferences } from '@/lib/preferences';

// /resources = Convenience-Route: springt zu den Ressourcen des zuletzt
// geöffneten Projekts. Globale Übersicht über alle Projekte gibt's
// sekundär unter /resources/all. Fallback wenn nichts gespeichert oder
// das Projekt nicht mehr existiert → globale View.
export default async function ResourcesIndexPage() {
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
    if (project) redirect(`/projects/${project.id}/resources`);
  }

  redirect('/resources/all');
}
