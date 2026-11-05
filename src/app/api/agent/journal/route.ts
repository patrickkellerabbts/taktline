import { Gitlab } from '@gitbeaker/rest';
import { prisma } from '@/lib/db';
import { isDemoMode } from '@/lib/demo/mode';
import { loadProjectJournal } from '@/lib/journal';
import { logger } from '@/lib/logger';

// Lesezugriff für Agenten. Es gibt bewusst keine eigenen Taktline-Tokens: Der
// GitLab-Token des Agenten wird nur für diese Prüfung benutzt und nicht
// gespeichert, die Rechte kommen damit direkt aus GitLab.
const REPORTER_ACCESS_LEVEL = 20;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function gitlabStatus(err: unknown): number | undefined {
  return (err as { cause?: { response?: { status?: number } } }).cause?.response?.status;
}

export async function GET(request: Request) {
  const host = process.env.GITLAB_URL;
  if (isDemoMode() || !host) return json({ error: 'Im Demo-Modus nicht verfügbar' }, 404);

  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return json({ error: 'Authorization-Header fehlt' }, 401);

  const rawProject = new URL(request.url).searchParams.get('project');
  if (!rawProject) return json({ error: 'Parameter project fehlt' }, 400);
  const projectRef = /^\d+$/.test(rawProject) ? Number(rawProject) : rawProject;

  // Ein Projekt sehen reicht nicht: öffentliche Projekte sieht jedes Konto.
  // Journale bekommt nur, wer dort mindestens Reporter ist. Keine Mitgliedschaft
  // und kein Projekt sehen nach aussen gleich aus.
  const denied = json({ error: 'Projekt nicht gefunden oder kein Zugriff' }, 404);
  let gitlabProjectId: number;
  let projectPath: string;
  try {
    const client = new Gitlab({ host, token, camelize: false });
    const user = (await client.Users.showCurrentUser()) as unknown as { id: number };
    const gitlabProject = (await client.Projects.show(projectRef)) as unknown as {
      id: number;
      path_with_namespace: string;
    };
    const member = (await client.ProjectMembers.show(gitlabProject.id, user.id, {
      includeInherited: true,
    })) as unknown as { access_level?: number };
    if ((member.access_level ?? 0) < REPORTER_ACCESS_LEVEL) return denied;
    gitlabProjectId = gitlabProject.id;
    projectPath = gitlabProject.path_with_namespace;
  } catch (err) {
    const status = gitlabStatus(err);
    if (status === 401) return json({ error: 'GitLab-Token ungültig' }, 401);
    if (status === 403 || status === 404) return denied;
    logger.warn({ status }, 'Journal-Abruf: GitLab-Prüfung fehlgeschlagen');
    return json({ error: 'GitLab konnte nicht geprüft werden' }, 502);
  }

  const project = await prisma.project.findUnique({
    where: { gitlabProjectId },
    select: { id: true },
  });
  if (!project) return json({ error: 'Projekt ist in Taktline nicht aktiviert' }, 404);

  const entries = await loadProjectJournal(project.id);
  return json({
    project: projectPath,
    entries: entries.map((e) => ({
      date: e.date,
      hours: e.hours,
      title: e.title,
      technical: e.technical,
      organizational: e.organizational,
      nextSteps: e.nextSteps,
      complete: e.complete,
      author: { name: e.author.name, username: e.author.username },
    })),
  });
}
