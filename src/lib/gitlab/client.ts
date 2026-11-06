import { Gitlab } from '@gitbeaker/rest';
import { prisma } from '@/lib/db';
import { getUserGitlabTokens } from '@/lib/auth/encrypted-adapter';
import { isDemoMode } from '@/lib/demo/mode';

export type GitlabClient = InstanceType<typeof Gitlab>;

// Erstellt einen GitLab-API-Client, der API-Calls im Namen des angegebenen
// Users ausführt — Berechtigungen werden dadurch automatisch von GitLab erzwungen.
export async function getGitlabClientForUser(userId: string): Promise<GitlabClient> {
  // Demo-Modus: es gibt keine GitLab-Instanz und keine OAuth-Tokens. Der Stub
  // beantwortet dieselben Aufrufe aus der lokalen DB, sodass sämtliche
  // Schreibpfade der App unverändert funktionieren.
  if (isDemoMode()) {
    // Dynamischer Import: im Normalbetrieb soll der Demo-Code gar nicht erst
    // im Bundle landen.
    const { createDemoGitlabClient } = await import('./demo-client');
    return createDemoGitlabClient();
  }

  const tokens = await getUserGitlabTokens(prisma, userId);
  if (!tokens) {
    throw new Error(`Kein GitLab-Token für User ${userId} gefunden`);
  }

  const host = process.env.GITLAB_URL;
  if (!host) {
    throw new Error('GITLAB_URL ist nicht gesetzt');
  }

  return new Gitlab({
    host,
    oauthToken: tokens.accessToken,
    camelize: false,
  });
}

export type GitlabGraphql = <T = unknown>(query: string, variables?: Record<string, unknown>) => Promise<T>;

/**
 * GraphQL im Namen eines Users. Gitbeaker kennt nur REST; die Hierarchie von
 * Work Items (Task unter Story) gibt es aber nur über GraphQL. Im Demo-Modus
 * gibt es keine Instanz, dann null: Der Aufrufer behält den lokalen Stand.
 */
export async function getGitlabGraphqlForUser(userId: string): Promise<GitlabGraphql | null> {
  if (isDemoMode()) return null;
  const tokens = await getUserGitlabTokens(prisma, userId);
  if (!tokens) throw new Error(`Kein GitLab-Token für User ${userId} gefunden`);
  const host = process.env.GITLAB_URL;
  if (!host) throw new Error('GITLAB_URL ist nicht gesetzt');
  const url = new URL('/api/graphql', host);
  return async <T,>(query: string, variables?: Record<string, unknown>) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`GitLab GraphQL antwortet mit HTTP ${res.status}`);
    const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (body.errors?.length) throw new Error(`GitLab GraphQL: ${body.errors.map((e) => e.message).join('; ')}`);
    return body.data as T;
  };
}
