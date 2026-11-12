import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { JournalInputSchema, journalData, loadProjectJournal } from '@/lib/journal';
import { logger } from '@/lib/logger';
import {
  DEVELOPER_ACCESS_LEVEL,
  REPORTER_ACCESS_LEVEL,
  checkAgentAccess,
  gitlabStatus,
  json,
} from '@/lib/agent/access';

export async function GET(request: Request) {
  const access = await checkAgentAccess(
    request,
    new URL(request.url).searchParams.get('project'),
    REPORTER_ACCESS_LEVEL,
  );
  if (access instanceof Response) return access;

  const entries = await loadProjectJournal(access.projectId);
  return json({
    project: access.projectPath,
    entries: entries.map((e) => ({
      date: e.date,
      hours: e.hours,
      title: e.title,
      technical: e.technical,
      organizational: e.organizational,
      nextSteps: e.nextSteps,
      complete: e.complete,
      suggestion: e.suggestedBy !== null,
      author: { name: e.author.name, username: e.author.username },
    })),
  });
}

const SuggestionSchema = JournalInputSchema.extend({
  project: z.string().min(1),
  person: z.string().trim().min(1, 'person fehlt'),
  technical: JournalInputSchema.shape.technical.default(''),
  organizational: JournalInputSchema.shape.organizational.default(''),
  nextSteps: JournalInputSchema.shape.nextSteps.default(''),
});

/**
 * Legt einen AI-Vorschlag für eine Person an oder ersetzt ihren bestehenden
 * Vorschlag für diesen Tag. Ein bestätigter Eintrag wird nie überschrieben: Den
 * pflegt nur die Person selbst in der Web-App.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = SuggestionSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return json({ error: `${issue.path.join('.') || 'body'}: ${issue.message}` }, 400);
  }
  const input = parsed.data;

  const access = await checkAgentAccess(request, input.project, DEVELOPER_ACCESS_LEVEL);
  if (access instanceof Response) return access;

  const person = await prisma.user.findFirst({
    where: { username: input.person },
    select: { id: true, gitlabUserId: true, username: true },
  });
  const unknownPerson = json(
    { error: `${input.person} ist kein Projektmitglied oder hat sich noch nie bei Taktline angemeldet` },
    404,
  );
  if (!person) return unknownPerson;
  try {
    const member = (await access.client.ProjectMembers.show(access.gitlabProjectId, person.gitlabUserId, {
      includeInherited: true,
    })) as unknown as { access_level?: number };
    if ((member.access_level ?? 0) < REPORTER_ACCESS_LEVEL) return unknownPerson;
  } catch (err) {
    const status = gitlabStatus(err);
    if (status === 404) return unknownPerson;
    logger.warn({ status }, 'Journal-Vorschlag: Mitgliedschaft nicht prüfbar');
    return json({ error: 'GitLab konnte nicht geprüft werden' }, 502);
  }

  const data = { ...journalData(input), suggestedBy: access.agentUsername };
  const key = { projectId: access.projectId, userId: person.id, date: data.date };
  const existing = await prisma.journalEntry.findUnique({
    where: { projectId_userId_date: key },
    select: { id: true, suggestedBy: true },
  });
  if (existing && existing.suggestedBy === null) {
    return json(
      { error: `${person.username} hat für ${input.date} schon einen eigenen Eintrag. Den ändert nur die Person selbst.` },
      409,
    );
  }

  try {
    if (existing) {
      await prisma.journalEntry.update({ where: { id: existing.id }, data });
    } else {
      await prisma.journalEntry.create({ data: { ...key, ...data } });
    }
  } catch (err) {
    // Die Person hat im selben Moment selbst einen Eintrag angelegt.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return json({ error: `Für ${input.date} gibt es inzwischen einen Eintrag` }, 409);
    }
    logger.error({ err: String(err) }, 'Journal-Vorschlag konnte nicht gespeichert werden');
    return json({ error: 'Der Vorschlag konnte nicht gespeichert werden' }, 500);
  }

  logger.info(
    { projectId: access.projectId, person: person.username, date: input.date, agent: access.agentUsername },
    'Journal-Vorschlag gespeichert',
  );
  return json(
    {
      project: access.projectPath,
      replaced: Boolean(existing),
      suggestion: {
        person: person.username,
        date: input.date,
        hours: data.hours,
        title: data.title,
        technical: data.technical,
        organizational: data.organizational,
        nextSteps: data.nextSteps,
      },
    },
    existing ? 200 : 201,
  );
}
