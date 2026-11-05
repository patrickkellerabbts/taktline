/**
 * Kommandozeile für Agenten: bearbeitet Taktline-Daten direkt in GitLab.
 *
 * Nutzt dieselben Parser wie die App, damit der gantt-meta-Block und die Labels
 * nie von Hand gebaut werden müssen. Sprints anlegen und Risiken liegen in der
 * Taktline-DB und sind hier bewusst nicht erreichbar. Issues löschen gibt es
 * ebenfalls nicht.
 *
 * Global installiert wird die CLI mit `npm run skill:install`, danach:
 *   node ~/.claude/skills/taktline/taktline.mjs help
 *
 * GITLAB_URL und GITLAB_TOKEN kommen aus der Umgebung oder aus
 * ~/.config/taktline/agent.env. Das Zielprojekt hängt am jeweiligen Repo (siehe
 * resolveProject). Es gibt bewusst keinen globalen Standard: Ein Agent in einem
 * fremden Repo soll nie still in ein falsches Projekt schreiben.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { Gitlab } from '@gitbeaker/rest';
import {
  BOARD_COLUMNS,
  STORY_LABEL,
  columnForIssue,
  isBoardColumnId,
  isReservedLabel,
  isStory,
  planColumnLabels,
  planSprintLabels,
  sprintLabel,
  sprintNumberOf,
  type BoardColumnId,
} from '../src/lib/agile/board';
import { buildStoryDescription, mergeCriteria } from '../src/lib/agile/story';
import {
  DependencyTypeSchema,
  parseGanttMeta,
  serializeGanttMeta,
  stripGanttMeta,
  type GanttMeta,
} from '../src/lib/gitlab/meta';

// Steht auch in summary-label.ts, das aber die DB mitbrächte.
const SUMMARY_LABEL = 'gantt::summary';
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLEARABLE = ['start', 'due', 'progress', 'points', 'parent'] as const;
const CONFIG_FILE = join(homedir(), '.config', 'taktline', 'agent.env');
const PROJECT_FILE = '.taktline-project';

const HELP = `Taktline-CLI für Agenten. Ausgabe ist JSON, Fehler stehen auf stderr (Exit-Code 1).

Projekt:
  current                     zeigt das Zielprojekt und woher es stammt
  projects                    Projekte, in denen der Agent Mitglied ist
  link <gruppe/projekt|id>    ordnet das aktuelle Repo einem Projekt zu (${PROJECT_FILE})

Arbeitsjournal (nur lesen, braucht TAKTLINE_URL):
  journal [--person <username>] [--from <datum>] [--to <datum>]

Lesen:
  list [--state opened|closed|all] [--column ${BOARD_COLUMNS.map((c) => c.id).join('|')}] [--sprint <nr>] [--stories]
  show <iid>
  members

Schreiben (jeweils mit --dry-run, dann wird nichts geändert):
  create --title <text> [--story] [--role <text> --goal <text> [--benefit <text>]]
         [--criterion <text>]... [--description <text>] [--points <n>] [--progress <0-100>]
         [--start <datum> --due <datum>] [--parent <iid>] [--column <spalte>] [--sprint <nr>]
         [--label <name>]... [--assignee <user-id>]...
  update <iid> [--title <text>] [--description <text>] [--start <datum>] [--due <datum>]
         [--progress <0-100>] [--points <n>] [--parent <iid>]
         [--clear ${CLEARABLE.join(',')}]
  move <iid> <spalte>
  sprint <iid> <nr|none>
  dep-add <iid> --on <vorgänger-iid> [--type FS|SS|FF|SF] [--lag <tage>]
  dep-remove <iid> --on <vorgänger-iid>
  alloc-set <iid> --user <user-id> --percent <1-100>
  alloc-remove <iid> --user <user-id>

Datumsformat: JJJJ-MM-TT`;

class CliError extends Error {}

type Issue = {
  iid: number;
  title: string;
  description: string | null;
  state: string;
  due_date: string | null;
  labels: string[];
  assignees?: Array<{ id: number; username: string }>;
  web_url?: string;
};

function fail(message: string): never {
  throw new CliError(message);
}

function loadCredentials() {
  let file: Record<string, string | undefined> = {};
  if (existsSync(CONFIG_FILE)) file = parseEnv(readFileSync(CONFIG_FILE, 'utf8'));
  const taktlineUrl = process.env.TAKTLINE_URL ?? file.TAKTLINE_URL;
  const host = process.env.GITLAB_URL ?? file.GITLAB_URL;
  const token = process.env.GITLAB_TOKEN ?? file.GITLAB_TOKEN;
  if (!host || !token) {
    fail(`GITLAB_URL und GITLAB_TOKEN fehlen (Umgebung oder ${CONFIG_FILE})`);
  }
  return { host, token, taktlineUrl };
}

function git(...args: string[]): string | null {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** Liefert den Projektpfad, wenn die Remote-URL auf diese GitLab-Instanz zeigt. */
function projectFromRemote(remote: string, gitlabHost: string): string | null {
  const match =
    remote.match(/^[a-z+]+:\/\/(?:[^@/]+@)?([^:/]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i) ??
    remote.match(/^(?:[^@/]+@)?([^:/]+):(.+?)(?:\.git)?\/?$/);
  if (!match || match[1].toLowerCase() !== gitlabHost.toLowerCase()) return null;
  return match[2];
}

function findProjectFile(): string | null {
  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, PROJECT_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Zielprojekt in dieser Reihenfolge: GITLAB_PROJECT, dann die Datei
 * .taktline-project, dann ein Git-Remote auf dieser GitLab-Instanz. Ist nichts
 * davon eindeutig, bricht die CLI ab, statt zu raten.
 */
function resolveProject(host: string): { project: string | number; source: string } {
  const toProject = (value: string) => (/^\d+$/.test(value) ? Number(value) : value);
  if (process.env.GITLAB_PROJECT) {
    return { project: toProject(process.env.GITLAB_PROJECT), source: 'GITLAB_PROJECT' };
  }
  const file = findProjectFile();
  if (file) {
    const value = readFileSync(file, 'utf8').trim();
    if (!value) fail(`${file} ist leer`);
    return { project: toProject(value), source: file };
  }
  const gitlabHost = new URL(host).hostname;
  const remotes = (git('remote') ?? '').split('\n').filter(Boolean);
  const matches = new Set(
    remotes.flatMap((name) => {
      const url = git('remote', 'get-url', name);
      const project = url ? projectFromRemote(url, gitlabHost) : null;
      return project ? [project] : [];
    }),
  );
  if (matches.size === 1) return { project: [...matches][0], source: 'git remote' };
  if (matches.size > 1) {
    fail(`Mehrere Git-Remotes zeigen auf GitLab: ${[...matches].join(', ')}. Bitte mit "link" festlegen.`);
  }
  fail('Diesem Verzeichnis ist kein Projekt zugeordnet. Mögliche Projekte zeigt "projects", zuordnen geht mit "link <gruppe/projekt>".');
}

function intValue(name: string, raw: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const value = Number(raw);
  if (!/^-?\d+$/.test(raw) || value < min || value > max) {
    fail(`--${name} muss eine ganze Zahl von ${min} bis ${max === Number.MAX_SAFE_INTEGER ? '∞' : max} sein`);
  }
  return value;
}

function dateValue(name: string, raw: string): string {
  // Date rollt z. B. den 31.02. in den März, darum der Vergleich mit dem Original.
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (!ISO_DATE_RE.test(raw) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    fail(`--${name} muss ein gültiges Datum im Format JJJJ-MM-TT sein`);
  }
  return raw;
}

function columnValue(raw: string): BoardColumnId {
  if (!isBoardColumnId(raw)) fail(`Unbekannte Spalte "${raw}"`);
  return raw;
}

function iidArgument(raw: string | undefined): number {
  if (!raw) fail('Die Issue-IID fehlt');
  return intValue('iid', raw, 1);
}

/** Ein kaputter Block darf nicht überschrieben werden: die Werte wären verloren. */
function readMeta(issue: Issue): GanttMeta {
  const meta = parseGanttMeta(issue.description);
  if (meta) return meta;
  if (/<!--\s*gantt-meta:v\d+/.test(issue.description ?? '')) {
    fail(`Der gantt-meta-Block von #${issue.iid} ist ungültig. Bitte erst von Hand reparieren.`);
  }
  return {};
}

function summarize(issue: Issue) {
  return {
    iid: issue.iid,
    title: issue.title,
    state: issue.state,
    column: columnForIssue(issue.state, issue.labels),
    sprint: sprintNumberOf(issue.labels),
    story: isStory(issue.labels),
    summary: issue.labels.includes(SUMMARY_LABEL),
    due_date: issue.due_date,
    labels: issue.labels,
    assignees: (issue.assignees ?? []).map((a) => ({ id: a.id, username: a.username })),
    meta: parseGanttMeta(issue.description),
    url: issue.web_url,
  };
}

/** Prüft die Termine so, wie sie nach der Änderung aussehen würden. */
function checkDates(story: boolean, start: string | undefined, due: string | null | undefined) {
  if (story && Boolean(start) !== Boolean(due)) {
    fail('Bei Stories gehören Start und Ende zusammen: beide setzen oder beide leer lassen');
  }
  if (start && due && due < start) fail('Das Ende darf nicht vor dem Start liegen');
}

/** Würde `iid` über die Kette `next` wieder bei sich selbst ankommen? */
function reaches(from: number, target: number, next: (iid: number) => number[]): boolean {
  const seen = new Set<number>();
  const stack = [from];
  while (stack.length > 0) {
    const current = stack.pop() as number;
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...next(current));
  }
  return false;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean' },
      state: { type: 'string' },
      column: { type: 'string' },
      sprint: { type: 'string' },
      stories: { type: 'boolean' },
      title: { type: 'string' },
      story: { type: 'boolean' },
      role: { type: 'string' },
      goal: { type: 'string' },
      benefit: { type: 'string' },
      criterion: { type: 'string', multiple: true },
      description: { type: 'string' },
      points: { type: 'string' },
      progress: { type: 'string' },
      start: { type: 'string' },
      due: { type: 'string' },
      parent: { type: 'string' },
      label: { type: 'string', multiple: true },
      assignee: { type: 'string', multiple: true },
      clear: { type: 'string' },
      on: { type: 'string' },
      type: { type: 'string' },
      lag: { type: 'string' },
      user: { type: 'string' },
      percent: { type: 'string' },
      person: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
    },
  });
  const [command, ...args] = positionals;
  if (!command || command === 'help') {
    console.log(HELP);
    return;
  }

  const { host, token, taktlineUrl } = loadCredentials();
  const client = new Gitlab({ host, token, camelize: false });
  const dryRun = values['dry-run'] === true;
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

  if (command === 'projects') {
    const projects = (await client.Projects.all({
      membership: true,
      perPage: 100,
      pagination: 'offset',
    })) as unknown as Array<{ id: number; path_with_namespace: string; web_url: string }>;
    print(projects.map(({ id, path_with_namespace, web_url }) => ({ id, path: path_with_namespace, url: web_url })));
    return;
  }

  if (command === 'link') {
    if (!args[0]) fail('Das Projekt fehlt: link <gruppe/projekt|id>');
    const target = /^\d+$/.test(args[0]) ? Number(args[0]) : args[0];
    const found = (await client.Projects.show(target)) as unknown as { path_with_namespace: string };
    const file = join(git('rev-parse', '--show-toplevel') ?? process.cwd(), PROJECT_FILE);
    if (dryRun) {
      print({ dryRun: true, file, project: found.path_with_namespace });
      return;
    }
    writeFileSync(file, `${found.path_with_namespace}\n`);
    print({ changed: true, file, project: found.path_with_namespace });
    return;
  }

  const { project, source } = resolveProject(host);
  if (command === 'current') {
    const found = (await client.Projects.show(project)) as unknown as { path_with_namespace: string; web_url: string };
    print({ project: found.path_with_namespace, url: found.web_url, source });
    return;
  }

  const allIssues = async (state?: 'opened' | 'closed') =>
    (await client.Issues.all({
      projectId: project,
      perPage: 100,
      ...(state ? { state } : {}),
    })) as unknown as Issue[];
  const loadIssue = async (iid: number) =>
    (await client.Issues.show(iid, { projectId: project })) as unknown as Issue;

  /** Schreibt nur echte Änderungen, damit Wiederholungen nichts auslösen. */
  const applyEdit = async (issue: Issue, payload: Record<string, unknown>) => {
    if (Object.keys(payload).length === 0) {
      print({ project, changed: false, issue: summarize(issue) });
      return;
    }
    if (dryRun) {
      print({ project, dryRun: true, iid: issue.iid, payload });
      return;
    }
    const updated = (await client.Issues.edit(project, issue.iid, payload)) as unknown as Issue;
    print({ project, changed: true, issue: summarize(updated) });
  };
  const writeMeta = async (issue: Issue, meta: GanttMeta) => {
    const description = serializeGanttMeta(issue.description, meta);
    await applyEdit(issue, description === (issue.description ?? '') ? {} : { description });
  };

  switch (command) {
    case 'journal': {
      if (!taktlineUrl) fail(`TAKTLINE_URL fehlt (Umgebung oder ${CONFIG_FILE})`);
      const from = values.from === undefined ? undefined : dateValue('from', values.from);
      const to = values.to === undefined ? undefined : dateValue('to', values.to);
      const url = new URL('/api/agent/journal', taktlineUrl);
      url.searchParams.set('project', String(project));
      // Gleicher Token wie für GitLab: Taktline prüft damit die Projektmitgliedschaft.
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        project?: string;
        entries?: Array<{ date: string; hours: number; author: { username: string | null } }>;
      } | null;
      if (!response.ok || !body?.entries) {
        fail(`Taktline antwortet mit HTTP ${response.status}: ${body?.error ?? 'unbekannter Fehler'}`);
      }
      const entries = body.entries.filter(
        (e) =>
          (values.person === undefined || e.author.username === values.person) &&
          (from === undefined || e.date >= from) &&
          (to === undefined || e.date <= to),
      );
      print({
        project: body.project,
        totalHours: entries.reduce((sum, e) => sum + e.hours, 0),
        entries,
      });
      return;
    }

    case 'list': {
      const state = values.state ?? 'opened';
      if (state !== 'opened' && state !== 'closed' && state !== 'all') {
        fail('--state muss opened, closed oder all sein');
      }
      const column = values.column === undefined ? undefined : columnValue(values.column);
      const sprint = values.sprint === undefined ? undefined : intValue('sprint', values.sprint, 1);
      // Die Done-Spalte besteht aus geschlossenen Issues, sonst fände der Filter nichts.
      const issues = await allIssues(state === 'all' || column === 'done' ? undefined : state);
      print(
        issues
          .map(summarize)
          .filter(
            (i) =>
              (column === undefined || i.column === column) &&
              (sprint === undefined || i.sprint === sprint) &&
              (!values.stories || i.story),
          ),
      );
      return;
    }

    case 'show': {
      const issue = await loadIssue(iidArgument(args[0]));
      print({ ...summarize(issue), text: stripGanttMeta(issue.description) });
      return;
    }

    case 'members': {
      const members = (await client.ProjectMembers.all(project, {
        includeInherited: true,
      })) as unknown as Array<{ id: number; username: string; name: string; access_level: number }>;
      print(members.map(({ id, username, name, access_level }) => ({ id, username, name, access_level })));
      return;
    }

    case 'create': {
      if (!values.title?.trim()) fail('--title fehlt');
      const story = values.story === true;
      const criteria = values.criterion ?? [];
      if (!story && (values.role || values.goal || values.benefit || criteria.length > 0)) {
        fail('--role, --goal, --benefit und --criterion gibt es nur zusammen mit --story');
      }
      if (Boolean(values.role) !== Boolean(values.goal)) fail('--role und --goal gehören zusammen');
      if (values.benefit && !values.goal) fail('--benefit braucht auch --role und --goal');

      const column = columnValue(values.column ?? 'backlog');
      if (column === 'done') fail('Neue Issues können nicht direkt in "done" liegen');
      const reserved = (values.label ?? []).filter((l) => isReservedLabel(l) || l === SUMMARY_LABEL);
      if (reserved.length > 0) {
        fail(`Diese Labels verwaltet Taktline selbst: ${reserved.join(', ')}. Bitte --story, --column oder --sprint nutzen.`);
      }

      const start = values.start === undefined ? undefined : dateValue('start', values.start);
      const due = values.due === undefined ? undefined : dateValue('due', values.due);
      checkDates(story, start, due);

      const meta: GanttMeta = {};
      if (start) meta.start_date = start;
      if (values.points !== undefined) meta.story_points = intValue('points', values.points, 0);
      if (values.progress !== undefined) meta.progress = intValue('progress', values.progress, 0, 100);
      if (values.parent !== undefined) {
        meta.parent_iid = intValue('parent', values.parent, 1);
        await loadIssue(meta.parent_iid);
      }

      const text = story
        ? buildStoryDescription({
            role: values.role ?? '',
            goal: values.goal ?? '',
            benefit: values.benefit ?? '',
            criteria: mergeCriteria(criteria, []),
            notes: values.description ?? '',
          })
        : (values.description ?? '');
      const columnLabel = BOARD_COLUMNS.find((c) => c.id === column)?.label;
      const labels = [
        ...(story ? [STORY_LABEL] : []),
        ...(columnLabel ? [columnLabel] : []),
        ...(values.sprint !== undefined ? [sprintLabel(intValue('sprint', values.sprint, 1))] : []),
        ...(values.label ?? []),
      ];
      const assigneeIds = (values.assignee ?? []).map((a) => intValue('assignee', a, 1));
      const payload = {
        description: serializeGanttMeta(text, meta),
        ...(labels.length > 0 ? { labels: labels.join(',') } : {}),
        ...(assigneeIds.length > 0 ? { assigneeIds } : {}),
        ...(due ? { dueDate: due } : {}),
      };
      if (dryRun) {
        print({ project, dryRun: true, title: values.title, payload });
        return;
      }
      const issue = (await client.Issues.create(project, values.title, payload)) as unknown as Issue;
      print({ project, changed: true, issue: summarize(issue) });
      return;
    }

    case 'update': {
      const issue = await loadIssue(iidArgument(args[0]));
      const clear = (values.clear ?? '').split(',').filter(Boolean);
      const unknown = clear.filter((c) => !(CLEARABLE as readonly string[]).includes(c));
      if (unknown.length > 0) fail(`--clear kennt nur ${CLEARABLE.join(', ')}`);
      for (const field of clear) {
        if (values[field as (typeof CLEARABLE)[number]] !== undefined) {
          fail(`--${field} und --clear ${field} schliessen sich aus`);
        }
      }

      const meta = { ...readMeta(issue) };
      if (values.start !== undefined) meta.start_date = dateValue('start', values.start);
      if (values.progress !== undefined) meta.progress = intValue('progress', values.progress, 0, 100);
      if (values.points !== undefined) meta.story_points = intValue('points', values.points, 0);
      if (clear.includes('start')) delete meta.start_date;
      if (clear.includes('progress')) delete meta.progress;
      if (clear.includes('points')) delete meta.story_points;
      if (clear.includes('parent')) delete meta.parent_iid;
      if (values.parent !== undefined) {
        const parent = intValue('parent', values.parent, 1);
        if (parent === issue.iid) fail('Ein Issue kann nicht sein eigener Parent sein');
        const issues = await allIssues();
        const parents = new Map(issues.map((i) => [i.iid, parseGanttMeta(i.description)?.parent_iid]));
        if (!parents.has(parent)) fail(`Issue #${parent} gibt es nicht`);
        const up = (iid: number) => {
          const next = parents.get(iid);
          return next ? [next] : [];
        };
        if (reaches(parent, issue.iid, up)) fail('Dieser Parent würde einen Kreis erzeugen');
        meta.parent_iid = parent;
      }

      const due = clear.includes('due')
        ? null
        : values.due !== undefined
          ? dateValue('due', values.due)
          : issue.due_date;
      if (values.start !== undefined || values.due !== undefined || clear.includes('start') || clear.includes('due')) {
        checkDates(isStory(issue.labels), meta.start_date, due);
      }

      const text = values.description ?? issue.description;
      const description = serializeGanttMeta(text, meta);
      const payload: Record<string, unknown> = {};
      if (values.title !== undefined && values.title !== issue.title) {
        if (!values.title.trim()) fail('--title darf nicht leer sein');
        payload.title = values.title;
      }
      if (description !== (issue.description ?? '')) payload.description = description;
      // Ein leerer String löscht das Fälligkeitsdatum in GitLab.
      if ((due ?? null) !== (issue.due_date ?? null)) payload.dueDate = due ?? '';
      await applyEdit(issue, payload);
      return;
    }

    case 'move': {
      const issue = await loadIssue(iidArgument(args[0]));
      const target = columnValue(args[1] ?? '');
      if (issue.labels.includes(SUMMARY_LABEL)) fail('Summary-Tasks liegen nicht auf dem Board');
      const { add, remove } = planColumnLabels(issue.labels, target);
      const payload: Record<string, unknown> = {};
      if (add.length > 0) payload.addLabels = add.join(',');
      if (remove.length > 0) payload.removeLabels = remove.join(',');
      if (target === 'done' && issue.state !== 'closed') payload.stateEvent = 'close';
      if (target !== 'done' && issue.state === 'closed') payload.stateEvent = 'reopen';
      await applyEdit(issue, payload);
      return;
    }

    case 'sprint': {
      const issue = await loadIssue(iidArgument(args[0]));
      if (!args[1]) fail('Sprint-Nummer oder "none" fehlt');
      const target = args[1] === 'none' ? null : intValue('sprint', args[1], 1);
      const { add, remove } = planSprintLabels(issue.labels, target);
      const payload: Record<string, unknown> = {};
      if (add.length > 0) payload.addLabels = add.join(',');
      if (remove.length > 0) payload.removeLabels = remove.join(',');
      await applyEdit(issue, payload);
      return;
    }

    case 'dep-add': {
      const issue = await loadIssue(iidArgument(args[0]));
      if (values.on === undefined) fail('--on fehlt');
      const on = intValue('on', values.on, 1);
      if (on === issue.iid) fail('Ein Issue kann nicht von sich selbst abhängen');
      const type = DependencyTypeSchema.safeParse(values.type ?? 'FS');
      if (!type.success) fail('--type muss FS, SS, FF oder SF sein');
      const lag = values.lag === undefined ? 0 : intValue('lag', values.lag, Number.MIN_SAFE_INTEGER);

      const issues = await allIssues();
      const predecessors = new Map(
        issues.map((i) => [i.iid, (parseGanttMeta(i.description)?.dependencies ?? []).map((d) => d.iid)]),
      );
      if (!predecessors.has(on)) fail(`Issue #${on} gibt es nicht`);
      if (reaches(on, issue.iid, (iid) => predecessors.get(iid) ?? [])) {
        fail('Diese Abhängigkeit würde einen Kreis erzeugen');
      }

      const meta = readMeta(issue);
      const dependencies = (meta.dependencies ?? []).filter((d) => d.iid !== on);
      dependencies.push({ iid: on, type: type.data, lag_days: lag });
      await writeMeta(issue, { ...meta, dependencies });
      return;
    }

    case 'dep-remove': {
      const issue = await loadIssue(iidArgument(args[0]));
      if (values.on === undefined) fail('--on fehlt');
      const on = intValue('on', values.on, 1);
      const meta = readMeta(issue);
      await writeMeta(issue, {
        ...meta,
        dependencies: (meta.dependencies ?? []).filter((d) => d.iid !== on),
      });
      return;
    }

    case 'alloc-set': {
      const issue = await loadIssue(iidArgument(args[0]));
      if (values.user === undefined || values.percent === undefined) fail('--user und --percent fehlen');
      const user = intValue('user', values.user, 1);
      const percent = intValue('percent', values.percent, 1, 100);
      const meta = readMeta(issue);
      const allocations = (meta.allocations ?? []).filter((a) => a.gitlab_user_id !== user);
      allocations.push({ gitlab_user_id: user, percent });
      await writeMeta(issue, { ...meta, allocations });
      return;
    }

    case 'alloc-remove': {
      const issue = await loadIssue(iidArgument(args[0]));
      if (values.user === undefined) fail('--user fehlt');
      const user = intValue('user', values.user, 1);
      const meta = readMeta(issue);
      await writeMeta(issue, {
        ...meta,
        allocations: (meta.allocations ?? []).filter((a) => a.gitlab_user_id !== user),
      });
      return;
    }

    default:
      fail(`Unbekannter Befehl "${command}". Siehe: help`);
  }
}

main().catch((err: unknown) => {
  if (err instanceof CliError || (err as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
    console.error((err as Error).message);
  } else {
    // Nur Status und Text, damit der Token nie in Logs landet.
    const status = (err as { cause?: { response?: { status?: number } } }).cause?.response?.status;
    console.error(`GitLab-Anfrage fehlgeschlagen${status ? ` (HTTP ${status})` : ''}: ${(err as Error).message}`);
  }
  process.exit(1);
});
