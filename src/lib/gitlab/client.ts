import { Gitlab } from '@gitbeaker/rest';
import { prisma } from '@/lib/db';
import { getUserGitlabTokens } from '@/lib/auth/encrypted-adapter';

export type GitlabClient = InstanceType<typeof Gitlab>;

// Erstellt einen GitLab-API-Client, der API-Calls im Namen des angegebenen
// Users ausführt — Berechtigungen werden dadurch automatisch von GitLab erzwungen.
export async function getGitlabClientForUser(userId: string): Promise<GitlabClient> {
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
