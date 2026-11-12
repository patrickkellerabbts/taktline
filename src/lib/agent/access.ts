// Zugang für Agenten (CLI/Skill). Es gibt bewusst keine eigenen Taktline-Tokens:
// Der GitLab-Token des Agenten kommt als Bearer-Token, wird nur für die Prüfung
// und die GitLab-Aufrufe dieser Anfrage benutzt und nicht gespeichert. Die
// Rechte kommen damit direkt aus GitLab.
import { Gitlab } from '@gitbeaker/rest';
import { prisma } from '@/lib/db';
import { isDemoMode } from '@/lib/demo/mode';
import { logger } from '@/lib/logger';
export const REPORTER_ACCESS_LEVEL = 20;
export const DEVELOPER_ACCESS_LEVEL = 30;

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export function gitlabStatus(err: unknown): number | undefined {
  return (err as { cause?: { response?: { status?: number } } }).cause?.response?.status;
}

export type AgentAccess = {
  client: InstanceType<typeof Gitlab>;
  agentUsername: string;
  gitlabProjectId: number;
  projectPath: string;
  projectId: string;
};

/**
 * Prüft Token, Mitgliedschaft und ob das Projekt in Taktline aktiviert ist.
 * Ein Projekt sehen reicht nicht: Öffentliche Projekte sieht jedes Konto.
 * Keine Mitgliedschaft und kein Projekt sehen nach aussen gleich aus.
 */
export async function checkAgentAccess(
  request: Request,
  rawProject: string | null | undefined,
  minLevel: number,
): Promise<AgentAccess | Response> {
  const host = process.env.GITLAB_URL;
  if (isDemoMode() || !host) return json({ error: 'Im Demo-Modus nicht verfügbar' }, 404);

  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return json({ error: 'Authorization-Header fehlt' }, 401);
  if (!rawProject) return json({ error: 'Parameter project fehlt' }, 400);
  const projectRef = /^\d+$/.test(rawProject) ? Number(rawProject) : rawProject;

  const denied = json({ error: 'Projekt nicht gefunden oder kein Zugriff' }, 404);
  const client = new Gitlab({ host, token, camelize: false });
  let agentUsername: string;
  let gitlabProjectId: number;
  let projectPath: string;
  let level: number;
  try {
    const user = (await client.Users.showCurrentUser()) as unknown as { id: number; username: string };
    const gitlabProject = (await client.Projects.show(projectRef)) as unknown as {
      id: number;
      path_with_namespace: string;
    };
    const member = (await client.ProjectMembers.show(gitlabProject.id, user.id, {
      includeInherited: true,
    })) as unknown as { access_level?: number };
    level = member.access_level ?? 0;
    agentUsername = user.username;
    gitlabProjectId = gitlabProject.id;
    projectPath = gitlabProject.path_with_namespace;
  } catch (err) {
    const status = gitlabStatus(err);
    if (status === 401) return json({ error: 'GitLab-Token ungültig' }, 401);
    if (status === 403 || status === 404) return denied;
    logger.warn({ status }, 'Agent-Zugriff: GitLab-Prüfung fehlgeschlagen');
    return json({ error: 'GitLab konnte nicht geprüft werden' }, 502);
  }
  if (level < REPORTER_ACCESS_LEVEL) return denied;
  if (level < minLevel) return json({ error: 'Zum Schreiben braucht das Agent-Konto mindestens die Developer-Rolle' }, 403);

  const project = await prisma.project.findUnique({
    where: { gitlabProjectId },
    select: { id: true },
  });
  if (!project) return json({ error: 'Projekt ist in Taktline nicht aktiviert' }, 404);
  return { client, agentUsername, gitlabProjectId, projectPath, projectId: project.id };
}

