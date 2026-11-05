'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';

type ActionResult = { ok: true } | { ok: false; error: string };

const isRealDate = (value: string) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const JournalInputSchema = z.object({
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

function toData(input: z.output<typeof JournalInputSchema>) {
  return {
    date: new Date(input.date),
    hours: input.hours,
    title: input.title,
    technical: input.technical || null,
    organizational: input.organizational || null,
    nextSteps: input.nextSteps || null,
  };
}

const DUPLICATE_DAY = 'Für diesen Tag hast du schon einen Eintrag. Bitte den bestehenden ergänzen.';

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export async function createJournalEntryAction(projectId: string, rawInput: JournalInput): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };
  const parsed = JournalInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) return { ok: false, error: 'Projekt nicht gefunden' };

  try {
    await prisma.journalEntry.create({
      data: { projectId, userId: session.user.id, ...toData(parsed.data) },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: DUPLICATE_DAY };
    logger.error({ err: String(err), projectId }, 'Journal-Eintrag konnte nicht angelegt werden');
    return { ok: false, error: 'Der Eintrag konnte nicht gespeichert werden' };
  }
  revalidatePath(`/projects/${projectId}/journal`);
  return { ok: true };
}

/** Sucht nur unter den eigenen Einträgen: fremde verhalten sich wie nicht vorhanden. */
async function ownEntry(entryId: string, userId: string) {
  return prisma.journalEntry.findFirst({
    where: { id: entryId, userId },
    select: { id: true, projectId: true },
  });
}

export async function updateJournalEntryAction(entryId: string, rawInput: JournalInput): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };
  const parsed = JournalInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const entry = await ownEntry(entryId, session.user.id);
  if (!entry) return { ok: false, error: 'Du kannst nur deine eigenen Einträge bearbeiten' };

  try {
    await prisma.journalEntry.update({ where: { id: entry.id }, data: toData(parsed.data) });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: DUPLICATE_DAY };
    logger.error({ err: String(err), entryId }, 'Journal-Eintrag konnte nicht gespeichert werden');
    return { ok: false, error: 'Der Eintrag konnte nicht gespeichert werden' };
  }
  revalidatePath(`/projects/${entry.projectId}/journal`);
  return { ok: true };
}

export async function deleteJournalEntryAction(entryId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };

  const entry = await ownEntry(entryId, session.user.id);
  if (!entry) return { ok: false, error: 'Du kannst nur deine eigenen Einträge löschen' };

  await prisma.journalEntry.delete({ where: { id: entry.id } });
  revalidatePath(`/projects/${entry.projectId}/journal`);
  return { ok: true };
}
