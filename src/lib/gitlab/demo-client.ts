/**
 * GitLab-Ersatz für den Demo-Modus.
 *
 * Bildet die Teilmenge der Gitbeaker-API nach, die die App tatsächlich
 * benutzt, und beantwortet sie aus der lokalen Datenbank. Damit funktionieren
 * Drag-and-Drop, Inspector-Edits, neue Aufgaben, Meilensteine und Kommentare
 * ganz normal — nur eben ohne Gegenstelle.
 *
 * Entwurfsregel: **der Stub schreibt nichts in die DB.** Jede Server Action
 * spiegelt ihre Änderung nach dem GitLab-Aufruf ohnehin selbst — würde der
 * Stub zusätzlich schreiben, gäbe es doppelte Datensätze. Er liefert nur die
 * Antworten, die die Aufrufer aus der echten API erwarten:
 *
 *  - `Issues.create` → eine frische IID (die Action legt das WP selbst an)
 *  - `Issues.edit`   → der Issue-Stand nach dem Patch, weil die Action daraus
 *                      `assigneesCache` und `labelsCache` übernimmt
 *  - Meilenstein-Calls → analog, Rückgabe mit neuer numerischer ID
 *
 * Einzige Ausnahme sind Kommentare: die hat unser Datenmodell nicht gespiegelt
 * (sie werden im Normalbetrieb live aus GitLab geholt). Die liegen deshalb in
 * einem prozesslokalen Store und sind nach einem Neustart wieder auf dem
 * Ausgangsstand.
 */
import { prisma } from '@/lib/db';
import type { GitlabClient } from './client';
import { logger } from '@/lib/logger';

// ─── Kommentare (prozesslokal) ───────────────────────────────────────

type DemoNote = {
  id: number;
  body: string;
  created_at: string;
  updated_at: string;
  system: boolean;
  author: { id: number; name: string; username: string };
};

// An globalThis gehängt, nicht als Modul-Variable: der Startup-Hook
// (instrumentation.ts) und die Server Actions laufen in getrennten
// Modul-Graphen, eine lokale Map wäre in beiden eine andere. Gleiches Muster
// wie beim Prisma-Singleton in src/lib/db/client.ts.
const store = globalThis as unknown as {
  __taktline_demo_notes?: Map<string, DemoNote[]>;
  __taktline_demo_next_note_id?: number;
};
store.__taktline_demo_notes ??= new Map<string, DemoNote[]>();
store.__taktline_demo_next_note_id ??= 1000;

const notesByIssue = store.__taktline_demo_notes;

function noteKey(projectId: number, iid: number): string {
  return `${projectId}:${iid}`;
}

/**
 * Beispiel-Kommentare, damit das Kommentar-Panel im Inspector nicht leer
 * wirkt. Schlüssel ist die Issue-IID aus dem Demo-Seed.
 */
const SEEDED_NOTES: Record<number, { body: string; author: string; username: string; daysAgo: number }[]> = {
  13: [
    { body: 'Farbkontraste sind jetzt alle über 4.5:1 — Prüfbericht hängt im Wiki.', author: 'Lena Wagner', username: 'l.wagner', daysAgo: 9 },
    { body: 'Danke! Dann können wir die Komponenten so einfrieren.', author: 'Tom Fischer', username: 't.fischer', daysAgo: 8 },
  ],
  22: [
    { body: 'Content-Modell steht, fehlen noch die Übersetzungsfelder.', author: 'Tom Fischer', username: 't.fischer', daysAgo: 5 },
  ],
  23: [
    { body: 'Hero-Bereich ist fertig, Teaser-Grid fehlt noch.', author: 'Sarah Kern', username: 's.kern', daysAgo: 3 },
    { body: 'Können wir das Teaser-Grid nicht aus dem Design-System nehmen?', author: 'Anna Berger', username: 'a.berger', daysAgo: 2 },
    { body: 'Doch, geht — spart uns zwei Tage.', author: 'Sarah Kern', username: 's.kern', daysAgo: 1 },
  ],
  33: [
    { body: 'Redaktion braucht die Freigabe bis Ende KW 43, sonst wird es eng.', author: 'Anna Berger', username: 'a.berger', daysAgo: 4 },
  ],
};

/** Setzt die Kommentare auf den Ausgangsstand. Wird vom Demo-Reset gerufen. */
export function resetDemoNotes(gitlabProjectId: number): void {
  notesByIssue.clear();
  let nextId = 1000;
  const now = Date.now();
  for (const [iid, notes] of Object.entries(SEEDED_NOTES)) {
    const key = noteKey(gitlabProjectId, Number(iid));
    notesByIssue.set(
      key,
      notes.map((n, i) => {
        const ts = new Date(now - n.daysAgo * 86_400_000).toISOString();
        return {
          id: nextId + i,
          body: n.body,
          created_at: ts,
          updated_at: ts,
          system: false,
          author: { id: 100 + i, name: n.author, username: n.username },
        };
      }),
    );
    nextId += notes.length;
  }
  store.__taktline_demo_next_note_id = nextId;
}

// ─── Hilfen ──────────────────────────────────────────────────────────

async function projectByGitlabId(gitlabProjectId: number) {
  return prisma.project.findUnique({
    where: { gitlabProjectId },
    select: { id: true, nameCache: true, gitlabProjectId: true },
  });
}

/** Löst GitLab-User-IDs gegen die lokale User-Tabelle auf. */
async function resolveAssignees(ids: number[]) {
  if (ids.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { gitlabUserId: { in: ids } },
    select: { gitlabUserId: true, name: true, username: true },
  });
  // Reihenfolge der Eingabe beibehalten
  return ids
    .map((id) => users.find((u) => u.gitlabUserId === id))
    .filter((u): u is NonNullable<typeof u> => !!u)
    .map((u) => ({
      id: u.gitlabUserId,
      username: u.username ?? `user${u.gitlabUserId}`,
      name: u.name ?? u.username ?? `User ${u.gitlabUserId}`,
    }));
}

/** Ergänzt Label-Namen um die Farbe aus dem Projekt-Label-Cache. */
async function resolveLabels(projectInternalId: string, names: string[]) {
  if (names.length === 0) return [];
  const known = await prisma.projectLabel.findMany({
    where: { projectId: projectInternalId, name: { in: names } },
    select: { name: true, color: true },
  });
  return names.map((name) => {
    const hit = known.find((k) => k.name === name);
    return { name, color: hit?.color ?? undefined };
  });
}

function parseLabelsPayload(value: unknown): string[] | undefined {
  if (typeof value === 'string') {
    return value.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (Array.isArray(value)) return value.map(String);
  return undefined;
}

type LabelCacheEntry = { name: string; color?: string };

function labelsFromCache(cache: unknown): LabelCacheEntry[] {
  if (!Array.isArray(cache)) return [];
  return cache.flatMap((l): LabelCacheEntry[] => {
    if (typeof l === 'string') return [{ name: l }];
    if (l && typeof l === 'object' && 'name' in l) {
      const o = l as { name: unknown; color?: unknown };
      if (typeof o.name !== 'string') return [];
      return [{ name: o.name, color: typeof o.color === 'string' ? o.color : undefined }];
    }
    return [];
  });
}

// ─── Der Stub ────────────────────────────────────────────────────────

function buildDemoClient() {
  return {
    Issues: {
      async create(
        gitlabProjectId: number,
        title: string,
        options?: {
          description?: string;
          dueDate?: string;
          labels?: string;
          assigneeIds?: number[];
        },
      ) {
        const project = await projectByGitlabId(gitlabProjectId);
        if (!project) throw new Error(`Demo: Projekt ${gitlabProjectId} nicht gefunden`);
        // Nächste freie IID. Der echte GitLab vergibt sie projektweit
        // fortlaufend; hier reicht "höchste vergebene + 1".
        const highest = await prisma.workPackage.findFirst({
          where: { projectId: project.id },
          orderBy: { gitlabIssueIid: 'desc' },
          select: { gitlabIssueIid: true },
        });
        const iid = (highest?.gitlabIssueIid ?? 0) + 1;
        return {
          iid,
          id: 900_000 + iid,
          title,
          description: options?.description ?? '',
          due_date: options?.dueDate ?? null,
          state: 'opened',
          assignees: await resolveAssignees(options?.assigneeIds ?? []),
          labels: await resolveLabels(project.id, parseLabelsPayload(options?.labels) ?? []),
        };
      },

      async edit(
        gitlabProjectId: number,
        iid: number,
        payload: Record<string, unknown>,
      ) {
        const project = await projectByGitlabId(gitlabProjectId);
        if (!project) throw new Error(`Demo: Projekt ${gitlabProjectId} nicht gefunden`);
        const wp = await prisma.workPackage.findUnique({
          where: { projectId_gitlabIssueIid: { projectId: project.id, gitlabIssueIid: iid } },
          select: {
            titleCache: true,
            stateCache: true,
            assigneesCache: true,
            labelsCache: true,
          },
        });

        // Der echte Endpoint antwortet mit dem vollständigen Issue. Felder,
        // die der Patch nicht anfasst, kommen deshalb aus dem Cache — sonst
        // würde die aufrufende Action Assignees oder Labels leerräumen.
        const assigneeIds = Array.isArray(payload.assigneeIds)
          ? (payload.assigneeIds as unknown[]).map(Number).filter(Number.isFinite)
          : undefined;
        const labelNames = parseLabelsPayload(payload.labels);

        const assignees =
          assigneeIds !== undefined
            ? await resolveAssignees(assigneeIds)
            : Array.isArray(wp?.assigneesCache)
              ? (wp.assigneesCache as unknown[])
              : [];
        // add_labels/remove_labels wie beim echten Endpoint: ändern nur die
        // genannten Labels und lassen den Rest stehen.
        const addLabels = parseLabelsPayload(payload.addLabels) ?? [];
        const removeLabels = parseLabelsPayload(payload.removeLabels) ?? [];
        const labels =
          labelNames !== undefined || addLabels.length > 0 || removeLabels.length > 0
            ? await resolveLabels(
                project.id,
                [
                  ...new Set([
                    ...(labelNames ?? labelsFromCache(wp?.labelsCache).map((l) => l.name)),
                    ...addLabels,
                  ]),
                ].filter((name) => !removeLabels.includes(name)),
              )
            : labelsFromCache(wp?.labelsCache);

        const stateEvent = payload.stateEvent;
        const state =
          stateEvent === 'close' ? 'closed' : stateEvent === 'reopen' ? 'opened' : wp?.stateCache ?? 'opened';

        return {
          iid,
          id: 900_000 + iid,
          title: (payload.title as string) ?? wp?.titleCache ?? '',
          description: (payload.description as string) ?? undefined,
          due_date: (payload.dueDate as string) ?? null,
          state,
          assignees,
          labels,
        };
      },

      // Sync-Pfade. Im Demo-Modus läuft kein Sync — leere Antworten halten
      // einen versehentlichen Aufruf harmlos.
      async all() {
        return [];
      },
      async allRelatedMergeRequests() {
        return [];
      },

      // Tasks: Die globale ID folgt demselben Schema wie bei create.
      async show(iid: number) {
        return { iid, id: 900_000 + iid };
      },
      async addTimeEstimate(_gitlabProjectId: number, _iid: number, duration: string) {
        const minutes = Number(duration.replace(/m$/, ''));
        return { time_estimate: Number.isFinite(minutes) ? minutes * 60 : 0, total_time_spent: 0 };
      },
      async resetTimeEstimate() {
        return { time_estimate: 0, total_time_spent: 0 };
      },
    },

    ProjectMembers: {
      // Wie im Demo-Projekt angelegt: wer es aktiviert hat, ist Maintainer,
      // alle anderen sind Developer.
      async show(gitlabProjectId: number, gitlabUserId: number) {
        const project = await prisma.project.findUnique({
          where: { gitlabProjectId },
          select: { activatedBy: { select: { gitlabUserId: true } } },
        });
        return {
          id: gitlabUserId,
          access_level: project?.activatedBy.gitlabUserId === gitlabUserId ? 50 : 30,
        };
      },
    },

    IssueNotes: {
      async all(gitlabProjectId: number, iid: number) {
        // Selbstheilend: normalerweise füllt der Startup-Hook den Store, aber
        // nach einem HMR-Reload oder in einem frisch gestarteten Worker kann
        // er leer sein. Dann hier nachziehen statt leere Listen zu liefern.
        if (notesByIssue.size === 0) resetDemoNotes(gitlabProjectId);
        return notesByIssue.get(noteKey(gitlabProjectId, iid)) ?? [];
      },
      async create(gitlabProjectId: number, iid: number, body: string) {
        const key = noteKey(gitlabProjectId, iid);
        const ts = new Date().toISOString();
        const note: DemoNote = {
          id: store.__taktline_demo_next_note_id!++,
          body,
          created_at: ts,
          updated_at: ts,
          system: false,
          // Im Demo-Modus ist immer dieselbe Person angemeldet.
          author: { id: 101, name: 'Anna Berger', username: 'a.berger' },
        };
        const list = notesByIssue.get(key) ?? [];
        list.push(note);
        notesByIssue.set(key, list);
        return note;
      },
    },

    ProjectLabels: {
      async all(gitlabProjectId: number) {
        const project = await projectByGitlabId(gitlabProjectId);
        if (!project) return [];
        const labels = await prisma.projectLabel.findMany({
          where: { projectId: project.id },
          orderBy: { name: 'asc' },
          select: { name: true, color: true, textColor: true, description: true },
        });
        return labels.map((l) => ({
          name: l.name,
          color: l.color,
          text_color: l.textColor,
          description: l.description,
        }));
      },
    },

    ProjectMilestones: {
      async create(
        gitlabProjectId: number,
        title: string,
        options?: { description?: string; dueDate?: string },
      ) {
        const project = await projectByGitlabId(gitlabProjectId);
        if (!project) throw new Error(`Demo: Projekt ${gitlabProjectId} nicht gefunden`);
        const highest = await prisma.milestone.findFirst({
          where: { projectId: project.id },
          orderBy: { gitlabMilestoneId: 'desc' },
          select: { gitlabMilestoneId: true },
        });
        return {
          id: (highest?.gitlabMilestoneId ?? 0) + 1,
          title,
          description: options?.description ?? '',
          due_date: options?.dueDate ?? null,
          state: 'active',
        };
      },

      async edit(gitlabProjectId: number, id: number, payload: Record<string, unknown>) {
        const state =
          payload.stateEvent === 'close'
            ? 'closed'
            : payload.stateEvent === 'activate'
              ? 'active'
              : undefined;
        return {
          id,
          title: payload.title as string | undefined,
          description: payload.description as string | undefined,
          due_date: (payload.dueDate as string) ?? null,
          state,
        };
      },

      async remove() {
        // Die Action löscht den lokalen Datensatz selbst.
      },

      async all(gitlabProjectId: number) {
        const project = await projectByGitlabId(gitlabProjectId);
        if (!project) return [];
        const ms = await prisma.milestone.findMany({
          where: { projectId: project.id },
          select: {
            gitlabMilestoneId: true,
            titleCache: true,
            descriptionCache: true,
            dueDateCache: true,
            stateCache: true,
          },
        });
        return ms.map((m) => ({
          id: m.gitlabMilestoneId,
          title: m.titleCache,
          description: m.descriptionCache,
          due_date: m.dueDateCache ? m.dueDateCache.toISOString().slice(0, 10) : null,
          state: m.stateCache,
        }));
      },
    },

    Projects: {
      async show(gitlabProjectId: number) {
        const project = await projectByGitlabId(gitlabProjectId);
        if (!project) throw new Error(`Demo: Projekt ${gitlabProjectId} nicht gefunden`);
        return {
          id: project.gitlabProjectId,
          path_with_namespace: project.nameCache,
          name: project.nameCache.split('/').pop() ?? project.nameCache,
        };
      },
      async all() {
        // Projekt-Aktivierung ist im Demo-Modus nicht vorgesehen — es gibt
        // genau das eine geseedete Projekt.
        return [];
      },
    },

    ProjectHooks: {
      async add() {
        logger.debug('Demo-Modus: Webhook-Anlage übersprungen');
        return { id: 1, url: '' };
      },
    },
  };
}

/**
 * Der Stub deckt bewusst nur die genutzten Endpunkte ab, erfüllt also nicht
 * das vollständige Gitbeaker-Interface. Der Cast ist die Stelle, an der wir
 * das zugeben — Aufrufer sehen weiterhin den normalen Client-Typ.
 */
export function createDemoGitlabClient(): GitlabClient {
  return buildDemoClient() as unknown as GitlabClient;
}
