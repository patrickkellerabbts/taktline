// Native GitLab-Tasks (Work Item Type „Task“) unter User Stories. REST kennt
// Tasks als Issues mit issue_type=task, die Zuordnung zur Story (Hierarchie)
// gibt es nur über GraphQL. Geprüft gegen GitLab CE 19.5.
import { logger } from '@/lib/logger';
import { getGitlabGraphqlForUser, type GitlabGraphql } from './client';

type HierarchyNode = {
  iid: string;
  widgets: Array<{ type: string; parent?: { iid: string } | null }>;
};

const TASK_PARENTS = `
  query($path: ID!, $after: String) {
    project(fullPath: $path) {
      workItems(types: [TASK], first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { iid widgets { type ... on WorkItemWidgetHierarchy { parent { iid } } } }
      }
    }
  }`;

function parentOf(node: HierarchyNode): number | null {
  const parent = node.widgets.find((w) => w.type === 'HIERARCHY')?.parent;
  return parent ? Number(parent.iid) : null;
}

/** Task-IID → IID der übergeordneten Story (null = keine). */
export async function fetchTaskParents(graphql: GitlabGraphql, projectPath: string): Promise<Map<number, number | null>> {
  const result = new Map<number, number | null>();
  let after: string | null = null;
  // Obergrenze gegen Endlosschleifen bei einer fehlerhaften Antwort.
  for (let page = 0; page < 50; page++) {
    const data: {
      project: { workItems: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: HierarchyNode[] } } | null;
    } = await graphql(TASK_PARENTS, { path: projectPath, after });
    const items = data.project?.workItems;
    if (!items) break;
    for (const node of items.nodes) result.set(Number(node.iid), parentOf(node));
    if (!items.pageInfo.hasNextPage) break;
    after = items.pageInfo.endCursor;
  }
  return result;
}

/** Für den Sync: liefert null, wenn GitLab nicht antwortet, statt abzubrechen. */
export async function loadTaskParentsForUser(userId: string, projectPath: string): Promise<Map<number, number | null> | null> {
  try {
    const graphql = await getGitlabGraphqlForUser(userId);
    if (!graphql) return null;
    return await fetchTaskParents(graphql, projectPath);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), projectPath }, 'Task-Hierarchie nicht lesbar');
    return null;
  }
}

/** Einzelner Task, etwa nach einem Webhook. undefined = unbekannt (nichts ändern). */
export async function fetchTaskParent(
  graphql: GitlabGraphql,
  projectPath: string,
  iid: number,
): Promise<number | null | undefined> {
  const data = await graphql<{ project: { workItems: { nodes: HierarchyNode[] } } | null }>(
    `query($path: ID!, $iid: String!) {
      project(fullPath: $path) {
        workItems(iids: [$iid]) { nodes { iid widgets { type ... on WorkItemWidgetHierarchy { parent { iid } } } } }
      }
    }`,
    { path: projectPath, iid: String(iid) },
  );
  const node = data.project?.workItems.nodes[0];
  return node ? parentOf(node) : undefined;
}

/** Hängt einen Task unter eine Story. Beide als globale Issue-IDs aus REST. */
export async function setTaskParent(graphql: GitlabGraphql, taskGlobalId: number, storyGlobalId: number): Promise<void> {
  const data = await graphql<{ workItemUpdate: { errors: string[] } }>(
    `mutation($id: WorkItemID!, $parent: WorkItemID!) {
      workItemUpdate(input: { id: $id, hierarchyWidget: { parentId: $parent } }) { errors }
    }`,
    { id: `gid://gitlab/WorkItem/${taskGlobalId}`, parent: `gid://gitlab/WorkItem/${storyGlobalId}` },
  );
  if (data.workItemUpdate.errors.length) throw new Error(data.workItemUpdate.errors.join('; '));
}

/** GitLab-Dauer für die Zeiterfassung, z.B. 5400 → "90m". */
export function gitlabDuration(seconds: number): string {
  return `${Math.round(seconds / 60)}m`;
}
