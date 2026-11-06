import { timingSafeEqual } from 'node:crypto';
import { decryptToken } from '@/lib/auth/crypto';

// GitLab sendet das Webhook-Secret im Klartext im X-Gitlab-Token-Header.
// Wir vergleichen constant-time gegen das (entschlüsselte) DB-Secret.
export function verifyWebhookToken(
  headerToken: string | null,
  encryptedSecret: string | null,
): boolean {
  if (!headerToken || !encryptedSecret) return false;
  let expected: string;
  try {
    expected = decryptToken(encryptedSecret);
  } catch {
    return false;
  }
  const a = Buffer.from(headerToken, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// GitLab Event-Typen, die wir verarbeiten (Subset von 15.11 CE).
export type GitlabWebhookEvent =
  | 'Issue Hook'
  | 'Confidential Issue Hook'
  | 'Note Hook'
  | 'Merge Request Hook';

export type GitlabIssuePayload = {
  object_kind: 'issue';
  event_type?: string;
  user: { id: number; username: string };
  project: { id: number; path_with_namespace?: string };
  object_attributes: {
    id: number;
    iid: number;
    title: string;
    description: string | null;
    state: 'opened' | 'closed';
    action: 'open' | 'close' | 'reopen' | 'update';
    due_date: string | null;
    created_at?: string;
    updated_at: string;
    closed_at?: string | null;
    milestone_id?: number | null;
    /** Work-Item-Typ: "Issue", "Task", "Incident". */
    type?: string;
    time_estimate?: number;
    total_time_spent?: number;
  };
  /** Top-level Labels mit Farben (besser als object_attributes.labels) */
  labels?: Array<{
    id: number;
    title: string;
    color: string;
    description?: string;
  }>;
  /** Top-level Assignees mit Profil-Infos */
  assignees?: Array<{
    id: number;
    username: string;
    name: string;
    avatar_url?: string;
  }>;
};
