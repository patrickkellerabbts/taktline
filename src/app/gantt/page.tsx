import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { parsePreferences } from '@/lib/preferences';

// /gantt = Convenience-Route: springt zum zuletzt geöffneten Projekt-Gantt.
// Falls noch keines geöffnet wurde oder das letzte gelöscht/deaktiviert ist
// → Fallback auf die Projekt-Übersicht.
export default async function GanttIndexPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { preferences: true },
  });
  const prefs = parsePreferences(user?.preferences);

  if (prefs.lastOpenedProjectId) {
    // Existiert das Projekt noch?
    const project = await prisma.project.findUnique({
      where: { id: prefs.lastOpenedProjectId },
      select: { id: true },
    });
    if (project) redirect(`/projects/${project.id}/gantt`);
  }

  redirect('/projects');
}
