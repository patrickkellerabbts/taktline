import { AccessLevel, type ProjectSchema } from '@gitbeaker/rest';
import type { GitlabClient } from './client';

export type AccessibleProject = {
  id: number;
  name: string;
  pathWithNamespace: string;
  description: string | null;
  webUrl: string;
  defaultBranch: string | null;
};

// Listet alle Projekte, in denen der User mindestens Maintainer-Rechte hat,
// damit er sie überhaupt aktivieren darf (Webhook + Schreibzugriff).
// Keyset-Pagination over all pages.
export async function listAccessibleProjects(
  client: GitlabClient,
): Promise<AccessibleProject[]> {
  // Cast: Client ist mit camelize=false initialisiert, daher kommen snake_case
  // ProjectSchema-Objekte zurück — Gitbeaker-Types geben aber generisch eine
  // Union mit Camelize<…> zurück, die TS hier ohne Hilfe nicht eingrenzt.
  const projects = (await client.Projects.all({
    membership: true,
    minAccessLevel: AccessLevel.MAINTAINER,
    perPage: 100,
    pagination: 'offset',
  })) as ProjectSchema[];
  return projects.map(toAccessibleProject);
}

export async function getProject(
  client: GitlabClient,
  gitlabProjectId: number,
): Promise<AccessibleProject> {
  const project = (await client.Projects.show(gitlabProjectId)) as ProjectSchema;
  return toAccessibleProject(project);
}

function toAccessibleProject(p: ProjectSchema): AccessibleProject {
  return {
    id: p.id,
    name: p.name,
    pathWithNamespace: p.path_with_namespace,
    description: p.description ?? null,
    webUrl: p.web_url,
    defaultBranch: p.default_branch ?? null,
  };
}
