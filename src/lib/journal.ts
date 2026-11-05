// Arbeitsjournal: Was an einem Arbeitstag technisch entstanden ist und was
// organisatorisch entschieden, abgesprochen oder blockiert war. Fehlt einer der
// beiden Teile, bleibt der Eintrag speicherbar, gilt aber als unvollständig.
import { prisma } from '@/lib/db';

export type JournalEntryView = {
  id: string;
  date: string;
  hours: number;
  title: string;
  technical: string | null;
  organizational: string | null;
  nextSteps: string | null;
  complete: boolean;
  author: { id: string; name: string | null; username: string | null };
};

export async function loadProjectJournal(projectId: string): Promise<JournalEntryView[]> {
  const entries = await prisma.journalEntry.findMany({
    where: { projectId },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    include: { user: { select: { id: true, name: true, username: true } } },
  });
  return entries.map((e) => ({
    id: e.id,
    date: e.date.toISOString().slice(0, 10),
    hours: e.hours,
    title: e.title,
    technical: e.technical,
    organizational: e.organizational,
    nextSteps: e.nextSteps,
    complete: Boolean(e.technical && e.organizational),
    author: e.user,
  }));
}
