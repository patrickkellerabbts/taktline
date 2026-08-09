import { randomBytes } from 'node:crypto';
import { encryptToken } from '@/lib/auth/crypto';
import { logger } from '@/lib/logger';
import type { GitlabClient } from './client';

export type WebhookRegistration = {
  webhookId: number | null;
  webhookSecretEncrypted: string;
  reachable: boolean;
};

// Erzeugt ein 32-Byte-Random-Secret, verschlüsselt es für die DB und
// registriert in GitLab einen Webhook für issues_events + confidential_issues_events.
// Falls die URL für GitLab nicht erreichbar ist (z.B. localhost im Dev) wird das
// Secret trotzdem gespeichert — der Webhook kann später manuell oder per Re-Sync
// nachgereicht werden (FR-S4 Reconciliation-Poll deckt das ab).
export async function registerProjectWebhook(
  client: GitlabClient,
  gitlabProjectId: number,
  callbackUrl: string,
): Promise<WebhookRegistration> {
  const secret = randomBytes(32).toString('base64url');
  const webhookSecretEncrypted = encryptToken(secret);

  try {
    const hook = await client.ProjectHooks.add(gitlabProjectId, callbackUrl, {
      issuesEvents: true,
      confidentialIssuesEvents: true,
      enableSslVerification: !callbackUrl.startsWith('http://'),
      token: secret,
    });
    return {
      webhookId: hook.id,
      webhookSecretEncrypted,
      reachable: true,
    };
  } catch (err) {
    // GitLab lehnt localhost-/Private-Network-URLs per Default ab. In Dev ist das
    // erwartet — wir loggen, aktivieren das Projekt trotzdem, und nutzen Polling.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), callbackUrl, gitlabProjectId },
      'Webhook-Registrierung in GitLab fehlgeschlagen — Projekt wird ohne Live-Updates aktiviert',
    );
    return {
      webhookId: null,
      webhookSecretEncrypted,
      reachable: false,
    };
  }
}

// Liefert die öffentliche Callback-URL aus den Umgebungsvariablen.
// WEBHOOK_PUBLIC_URL überschreibt AUTH_URL für Setups mit ngrok / Reverse Proxy.
export function getWebhookCallbackUrl(): string {
  const base = process.env.WEBHOOK_PUBLIC_URL ?? process.env.AUTH_URL;
  if (!base) {
    throw new Error('Weder WEBHOOK_PUBLIC_URL noch AUTH_URL ist gesetzt');
  }
  return `${base.replace(/\/$/, '')}/api/gitlab/webhook`;
}
