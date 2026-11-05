// Arbeitsjournal: Was an einem Arbeitstag technisch entstanden ist und was
// organisatorisch entschieden, abgesprochen oder blockiert war. Fehlt einer der
// beiden Teile, bleibt der Eintrag speicherbar, gilt aber als unvollständig.
import { z } from 'zod';
import { prisma } from '@/lib/db';

const isRealDate = (value: string) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/** Gilt für die Web-App und für Vorschläge von Agenten gleichermassen. */
export const JournalInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Bitte ein Datum wählen').refine(isRealDate, 'Bitte ein gültiges Datum wählen'),
  hours: z
    .number({ message: 'Bitte die Dauer in Stunden angeben' })
    .gt(0, 'Die Dauer muss grösser als 0 sein')
    .max(24, 'Ein Tag hat höchstens 24 Stunden'),
  title: z.string().trim().min(1, 'Bitte einen Kurztitel angeben').max(120, 'Der Kurztitel ist zu lang'),
  technical: z.string().trim().max(10_000, 'Der technische Teil ist zu lang'),
  organizational: z.string().trim().max(10_000, 'Der organisatorische Teil ist zu lang'),
  nextSteps: z.string().trim().max(10_000, 'Die nächsten Schritte sind zu lang'),
});

export type JournalInput = z.input<typeof JournalInputSchema>;

export function journalData(input: z.output<typeof JournalInputSchema>) {
  return {
    date: new Date(input.date),
    hours: input.hours,
    title: input.title,
    technical: input.technical || null,
    organizational: input.organizational || null,
    nextSteps: input.nextSteps || null,
  };
}

export type JournalEntryView = {
  id: string;
  date: string;
  hours: number;
  title: string;
  technical: string | null;
  organizational: string | null;
  nextSteps: string | null;
  complete: boolean;
  /** Agent-Konto, wenn der Eintrag noch ein unbestätigter AI-Vorschlag ist. */
  suggestedBy: string | null;
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
    suggestedBy: e.suggestedBy,
    author: e.user,
  }));
}
