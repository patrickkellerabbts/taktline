import type { Adapter, AdapterAccount } from '@auth/core/adapters';
import { PrismaAdapter } from '@auth/prisma-adapter';
import type { PrismaClient } from '@prisma/client';
import { encryptToken, decryptToken, looksEncrypted } from './crypto';
import { logger } from '@/lib/logger';

export class GitlabTokenExpiredError extends Error {
  constructor(message = 'GitLab-Session abgelaufen, bitte neu anmelden') {
    super(message);
    this.name = 'GitlabTokenExpiredError';
  }
}

type RefreshResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
};

async function refreshGitlabAccessToken(
  refreshToken: string,
): Promise<RefreshResponse | null> {
  const host = process.env.GITLAB_URL;
  const clientId = process.env.GITLAB_CLIENT_ID;
  const clientSecret = process.env.GITLAB_CLIENT_SECRET;
  if (!host || !clientId || !clientSecret) {
    logger.error('GitLab OAuth ENV nicht vollständig — Token-Refresh nicht möglich');
    return null;
  }

  const res = await fetch(`${host.replace(/\/$/, '')}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    logger.warn(
      { status: res.status, body: await res.text().catch(() => '') },
      'GitLab Token-Refresh fehlgeschlagen',
    );
    return null;
  }
  return (await res.json()) as RefreshResponse;
}

// Wrap PrismaAdapter so OAuth-Tokens werden vor dem Persistieren AES-GCM-verschlüsselt
// (REQUIREMENTS FR-A3). Decryption findet on-demand in getUserGitlabTokens() statt.
export function EncryptedPrismaAdapter(prisma: PrismaClient): Adapter {
  const base = PrismaAdapter(prisma);
  const linkAccount = (async (account: AdapterAccount) => {
    const encrypted: AdapterAccount = {
      ...account,
      access_token:
        account.access_token && !looksEncrypted(account.access_token)
          ? encryptToken(account.access_token)
          : account.access_token,
      refresh_token:
        account.refresh_token && !looksEncrypted(account.refresh_token)
          ? encryptToken(account.refresh_token)
          : account.refresh_token,
    };
    return base.linkAccount!(encrypted);
  }) as Adapter['linkAccount'];
  return { ...base, linkAccount };
}

export type GitlabTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
};

// Holt das gespeicherte GitLab-Account-Tupel für einen User und entschlüsselt die Tokens.
// Wird vom GitLab-Client genutzt, um API-Calls im Namen des Users auszuführen.
// Wenn der Access-Token abgelaufen ist (mit 60s Puffer), wird er via Refresh-Token
// automatisch erneuert. Bei Refresh-Fehler wird GitlabTokenExpiredError geworfen.
export async function getUserGitlabTokens(
  prisma: PrismaClient,
  userId: string,
): Promise<GitlabTokens | null> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: 'gitlab' },
    select: {
      id: true,
      access_token: true,
      refresh_token: true,
      expires_at: true,
    },
  });
  if (!account?.access_token) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const isExpired = account.expires_at !== null && account.expires_at < nowSec + 60;

  if (isExpired) {
    if (!account.refresh_token) {
      throw new GitlabTokenExpiredError();
    }
    const refreshToken = decryptToken(account.refresh_token);
    const refreshed = await refreshGitlabAccessToken(refreshToken);
    if (!refreshed) {
      throw new GitlabTokenExpiredError();
    }
    const newExpiresAt = nowSec + refreshed.expires_in;
    await prisma.account.update({
      where: { id: account.id },
      data: {
        access_token: encryptToken(refreshed.access_token),
        refresh_token: encryptToken(refreshed.refresh_token),
        expires_at: newExpiresAt,
      },
    });
    logger.debug({ userId, newExpiresAt }, 'GitLab-Token refreshed');
    return {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresAt: newExpiresAt,
    };
  }

  return {
    accessToken: decryptToken(account.access_token),
    refreshToken: account.refresh_token ? decryptToken(account.refresh_token) : null,
    expiresAt: account.expires_at ?? null,
  };
}

// Aktualisiert die Tokens (nach Refresh-Flow). Verschlüsselt vor dem Schreiben.
export async function updateUserGitlabTokens(
  prisma: PrismaClient,
  userId: string,
  tokens: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  },
): Promise<void> {
  await prisma.account.updateMany({
    where: { userId, provider: 'gitlab' },
    data: {
      access_token: encryptToken(tokens.accessToken),
      ...(tokens.refreshToken && {
        refresh_token: encryptToken(tokens.refreshToken),
      }),
      ...(tokens.expiresAt !== undefined && { expires_at: tokens.expiresAt }),
    },
  });
}
