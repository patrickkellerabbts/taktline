// Webhook-Echo-Schutz: nach jedem App→GitLab-Push merken wir uns kurz,
// dass eine Änderung von uns selbst kam. Der eintreffende Webhook prüft
// und ignoriert, sonst hätten wir endlose Sync-Schleifen.
// In-Memory ist OK für Single-Instance Dev; bei Mehrfach-Instances → Redis.

const recentSelfPushes = new Map<string, number>();
const SELF_PUSH_TTL_MS = 10_000;

export function isSelfPush(issueIid: number, projectId: string): boolean {
  const key = `${projectId}:${issueIid}`;
  const t = recentSelfPushes.get(key);
  if (!t) return false;
  if (Date.now() - t > SELF_PUSH_TTL_MS) {
    recentSelfPushes.delete(key);
    return false;
  }
  return true;
}

export function markSelfPush(issueIid: number, projectId: string): void {
  recentSelfPushes.set(`${projectId}:${issueIid}`, Date.now());
}
