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
import { dirname, join, resolve } from 'node:path';
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
import { buildPsp, pspOutline, type PspInput } from '../src/lib/psp';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PspDiagram, layoutPsp } from '../src/components/psp/PspDiagram';
import { GanttPrintView } from '../src/components/gantt/GanttPrintView';
import type { GanttBar, GanttDependency, GanttMilestone } from '../src/components/gantt/GanttView';
import { svgToPdf } from './svg-pdf';
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

Arbeitsjournal (braucht TAKTLINE_URL):
  journal [--person <username>] [--from <datum>] [--to <datum>]
  journal-suggest --person <username> --date <datum> --hours <h> --title <text>
         [--technical <text>] [--organizational <text>] [--next <text>] [--dry-run]
         legt einen AI-Vorschlag an, den die Person in der Web-App prüft und übernimmt.
         Ein bestehender Vorschlag für den Tag wird ersetzt, ein eigener Eintrag nie.

Sprints (liegen in Taktline, braucht TAKTLINE_URL; Schreiben mit --dry-run):
  sprints                     alle Sprints mit Stand, Ziel und Review
  sprint-create --name <text> --start <datum> --end <datum> [--goal <text>]
  sprint-update <nr> [--name <text>] [--goal <text>] [--start <datum>] [--end <datum>]
  sprint-start <nr>           höchstens ein Sprint läuft gleichzeitig
  sprint-close <nr> --carry-over <nr|backlog>
                              Unerledigtes wandert in Sprint <nr> oder ins Backlog
  sprint-delete <nr>          nur leere, geplante Sprints
  sprint-review <nr> [--outcome yes|partly|no|none] [--notes <text>]

Scrum-Rahmen (liegt in Taktline, braucht TAKTLINE_URL; Schreiben mit --dry-run):
  frame                       Product Goal, Definition of Done, WIP-Limits, Velocity, Meilensteine
  goal-set <text>             Product Goal setzen (leer = entfernen)
  dod-set --item <text>...    Definition of Done ersetzen (ganze Liste angeben)
  wip-set <todo|doing|review> <n|none>

Risiken (liegen in Taktline; anlegen und bewerten, nicht löschen):
  risks [--status <status>]   Register mit Bewertung vor/nach Massnahmen
  risk <id>                   ein Risiko mit Verlauf; id = die ersten Zeichen aus "risks"
  risk-create --title <text> --probability <1-5> --impact <1-5> [--category <text>]
         [--description <text>] [--mitigation <text>] [--contingency <text>]
         [--owner <username>] [--review <datum>] [--wp <iid>]... [--milestone <id>]...
  risk-update <id> [dieselben Felder] [--status identified|in_progress|mitigated|accepted|occurred|closed]
         [--probability-after <1-5> --impact-after <1-5>]
         [--clear after,owner,review,mitigation,contingency,category,description]
         --wp/--milestone ersetzen die ganze Verknüpfungsliste

Nur lesen (Team-Rituale und Auswertungen):
  retro <sprint-nr>           Review, Retro-Karten nach Punkten, Massnahmen und ihr Stand
  poker [<story-iid>]         Schätzrunden; Karten erst nach dem Aufdecken
  report                      Fortschritt, Überfälliges, Konflikte, Burndown, Baseline-Abweichung
  flow [--days <n>]           Karten pro Spalte und Tag (Cumulative Flow)
  audit [--limit <n>]         Änderungshistorie in Taktline

Tasks (native GitLab-Tasks unter einer Story, Schätzung in Stunden):
  tasks <story-iid>
  task-add <story-iid> --title <text> [--hours <h>] [--assignee <user-id>]

Projektstrukturplan (PSP = die Gantt-Hierarchie über parent_iid):
  psp [--text]                Baum mit PSP-Codes (1, 1.2, 1.2.3); --text als Gliederung
  psp --svg|--pdf [--out <datei>] [--page A3|A4]
                              Baumdiagramm als SVG oder PDF speichern (Standard: psp-<projekt>.svg/.pdf)

Gantt (Daten aus Taktline, braucht TAKTLINE_URL):
  gantt                       Balken mit Sammelbalken, Abhängigkeiten und Meilensteinen
  gantt --pdf|--svg [--out <datei>] [--page A3|A4]
                              Druckansicht der Web-App als PDF (Standard A3 quer) oder SVG
                              Umhängen mit update <iid> --parent <iid> bzw. --clear parent,
                              Unterpaket mit create --parent <iid> --start <datum> --due <datum>

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

type TaskNode = {
  iid: string;
  title: string;
  state: string;
  workItemType: { name: string };
  widgets: Array<{ type: string; timeEstimate?: number; assignees?: { nodes: Array<{ id: string; username: string }> } }>;
};

type Issue = {
  iid: number;
  title: string;
  description: string | null;
  state: string;
  due_date: string | null;
  created_at?: string;
  labels: string[];
  assignees?: Array<{ id: number; username: string }>;
  web_url?: string;
  issue_type?: string;
  id?: number;
  time_stats?: { time_estimate?: number; total_time_spent?: number };
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
    task: issue.issue_type === 'task',
    ...(issue.time_stats?.time_estimate ? { estimate_hours: issue.time_stats.time_estimate / 3600 } : {}),
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
      date: { type: 'string' },
      hours: { type: 'string' },
      technical: { type: 'string' },
      organizational: { type: 'string' },
      next: { type: 'string' },
      name: { type: 'string' },
      end: { type: 'string' },
      notes: { type: 'string' },
      outcome: { type: 'string' },
      'carry-over': { type: 'string' },
      text: { type: 'boolean' },
      svg: { type: 'boolean' },
      pdf: { type: 'boolean' },
      page: { type: 'string' },
      out: { type: 'string' },
      item: { type: 'string', multiple: true },
      probability: { type: 'string' },
      impact: { type: 'string' },
      'probability-after': { type: 'string' },
      'impact-after': { type: 'string' },
      category: { type: 'string' },
      mitigation: { type: 'string' },
      contingency: { type: 'string' },
      owner: { type: 'string' },
      review: { type: 'string' },
      wp: { type: 'string', multiple: true },
      milestone: { type: 'string', multiple: true },
      status: { type: 'string' },
      days: { type: 'string' },
      limit: { type: 'string' },
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
  /** Schreibt ein gerendertes SVG als .svg oder .pdf (Option --svg/--pdf, --out, --page). */
  const writeGraphic = async (kind: 'psp' | 'gantt', name: string, svg: string, size: { width: number; height: number }) => {
    const format = values.pdf ? 'pdf' : 'svg';
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'projekt';
    const file = resolve(values.out ?? `${kind}-${slug}.${format}`);
    if (!file.toLowerCase().endsWith(`.${format}`)) fail(`--out muss auf .${format} enden`);
    const page = values.page ?? 'A3';
    if (page !== 'A3' && page !== 'A4') fail('--page muss A3 oder A4 sein');
    if (dryRun) return print({ project, dryRun: true, file, format, ...(format === 'pdf' ? { page } : {}) });
    if (format === 'svg') {
      writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>\n${svg}\n`);
    } else {
      const title = `${kind === 'psp' ? 'Projektstrukturplan' : 'Gantt'} ${name}`;
      writeFileSync(file, await svgToPdf(svg, { ...size, page, title }));
    }
    print({ project, file, format, ...(format === 'pdf' ? { page } : {}) });
  };
  // Die Hierarchie von Work Items (Task unter Story) gibt es nur über GraphQL.
  const graphql = async <T,>(query: string, variables: Record<string, unknown>): Promise<T> => {
    const res = await fetch(new URL('/api/graphql', host), {
      method: 'POST',
      headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await res.json().catch(() => null)) as { data?: T; errors?: Array<{ message: string }> } | null;
    if (!res.ok || !body?.data || body.errors?.length) {
      fail(`GitLab GraphQL: ${body?.errors?.map((e) => e.message).join('; ') ?? `HTTP ${res.status}`}`);
    }
    return body.data;
  };
  // Alles, was nur in der Taktline-DB liegt (Sprints, Journal), geht über deren
  // Agenten-API. Derselbe GitLab-Token weist den Agenten dort aus.
  const taktline = async <T,>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T> => {
    if (!taktlineUrl) fail(`TAKTLINE_URL fehlt (Umgebung oder ${CONFIG_FILE})`);
    const url = new URL(path, taktlineUrl);
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok || !data) fail(`Taktline antwortet mit HTTP ${res.status}: ${data?.error ?? 'unbekannter Fehler'}`);
    return data;
  };

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
  const projectPath = async (): Promise<string> =>
    typeof project === 'string' && project.includes('/')
      ? project
      : ((await client.Projects.show(project)) as unknown as { path_with_namespace: string }).path_with_namespace;
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
        entries?: Array<{ date: string; hours: number; suggestion?: boolean; author: { username: string | null } }>;
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
        // Vorschläge sind unbestätigt und zählen nicht mit.
        totalHours: entries.reduce((sum, e) => sum + (e.suggestion ? 0 : e.hours), 0),
        suggestions: entries.filter((e) => e.suggestion).length,
        entries,
      });
      return;
    }

    case 'journal-suggest': {
      if (!taktlineUrl) fail(`TAKTLINE_URL fehlt (Umgebung oder ${CONFIG_FILE})`);
      if (!values.person) fail('--person fehlt: Für wen ist der Vorschlag?');
      if (values.date === undefined) fail('--date fehlt');
      if (values.hours === undefined) fail('--hours fehlt');
      if (!values.title?.trim()) fail('--title fehlt');
      const hours = Number(values.hours.replace(',', '.'));
      if (!Number.isFinite(hours) || hours <= 0 || hours > 24) fail('--hours muss zwischen 0 und 24 liegen');
      const payload = {
        project: String(project),
        person: values.person,
        date: dateValue('date', values.date),
        hours,
        title: values.title,
        technical: values.technical ?? '',
        organizational: values.organizational ?? '',
        nextSteps: values.next ?? '',
      };
      if (dryRun) {
        print({ project, dryRun: true, suggestion: payload });
        return;
      }
      const response = await fetch(new URL('/api/agent/journal', taktlineUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        fail(`Taktline antwortet mit HTTP ${response.status}: ${body?.error ?? 'unbekannter Fehler'}`);
      }
      print(body);
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

    case 'tasks': {
      const story = await loadIssue(iidArgument(args[0]));
      if (!isStory(story.labels)) fail(`#${story.iid} ist keine User Story`);
      const path = await projectPath();
      const data = await graphql<{
        project: { workItems: { nodes: Array<{ widgets: Array<{ type: string; children?: { nodes: TaskNode[] } }> }> } };
      }>(
        `query($path: ID!, $iid: String!) { project(fullPath: $path) { workItems(iids: [$iid]) { nodes { widgets { type
          ... on WorkItemWidgetHierarchy { children(first: 100) { nodes { iid title state workItemType { name }
            widgets { type ... on WorkItemWidgetTimeTracking { timeEstimate }
              ... on WorkItemWidgetAssignees { assignees { nodes { id username } } } } } } } } } } } }`,
        { path, iid: String(story.iid) },
      );
      const children = data.project.workItems.nodes[0]?.widgets.find((w) => w.type === 'HIERARCHY')?.children?.nodes ?? [];
      const tasks = children
        .filter((c) => c.workItemType.name === 'Task')
        .map((c) => {
          const estimate = c.widgets.find((w) => w.type === 'TIME_TRACKING')?.timeEstimate ?? 0;
          return {
            iid: Number(c.iid),
            title: c.title,
            state: c.state === 'CLOSED' ? 'closed' : 'opened',
            estimate_hours: estimate ? estimate / 3600 : null,
            assignees: (c.widgets.find((w) => w.type === 'ASSIGNEES')?.assignees?.nodes ?? []).map((a) => a.username),
          };
        });
      const open = tasks.filter((t) => t.state === 'opened');
      print({
        project,
        story: story.iid,
        tasks,
        done: tasks.length - open.length,
        remaining_hours: open.reduce((sum, t) => sum + (t.estimate_hours ?? 0), 0),
      });
      return;
    }

    case 'task-add': {
      const story = await loadIssue(iidArgument(args[0]));
      if (!isStory(story.labels)) fail(`#${story.iid} ist keine User Story`);
      if (story.state === 'closed') fail(`#${story.iid} ist schon geschlossen`);
      if (!values.title?.trim()) fail('--title fehlt');
      let seconds: number | null = null;
      if (values.hours !== undefined) {
        const hours = Number(values.hours.replace(',', '.'));
        if (!Number.isFinite(hours) || hours <= 0 || hours > 200) fail('--hours muss zwischen 0 und 200 liegen');
        seconds = Math.round(hours * 3600);
      }
      const assignee = values.assignee?.[0] === undefined ? undefined : intValue('assignee', values.assignee[0], 1);
      const payload = { title: values.title.trim(), story: story.iid, estimate_hours: seconds ? seconds / 3600 : null, assignee: assignee ?? null };
      if (dryRun) {
        print({ project, dryRun: true, task: payload, ...(seconds && seconds > 8 * 3600 ? { hint: 'Mehr als 8 Stunden: lieber aufteilen' } : {}) });
        return;
      }
      const created = (await client.Issues.create(project, payload.title, {
        issueType: 'task',
        ...(assignee ? { assigneeIds: [assignee] } : {}),
      } as Record<string, unknown>)) as unknown as Issue;
      if (seconds) await client.Issues.addTimeEstimate(project, created.iid, `${Math.round(seconds / 60)}m`);
      await graphql<{ workItemUpdate: { errors: string[] } }>(
        `mutation($id: WorkItemID!, $parent: WorkItemID!) { workItemUpdate(input: { id: $id, hierarchyWidget: { parentId: $parent } }) { errors } }`,
        { id: `gid://gitlab/WorkItem/${created.id}`, parent: `gid://gitlab/WorkItem/${story.id}` },
      ).then((r) => {
        if (r.workItemUpdate.errors.length) fail(`Task #${created.iid} angelegt, aber nicht unter die Story gehängt: ${r.workItemUpdate.errors.join('; ')}`);
      });
      print({ project, changed: true, task: { iid: created.iid, ...payload, url: created.web_url } });
      return;
    }

    case 'show': {
      const issue = await loadIssue(iidArgument(args[0]));
      print({ ...summarize(issue), text: stripGanttMeta(issue.description) });
      return;
    }

    case 'gantt': {
      type Raw = {
        name: string;
        bars: Array<{ id: string; iid: number; title: string; start: string; end: string; progress: number; state: string; summary: boolean; parentId: string | null; baselineStart: string | null; baselineEnd: string | null; assignees: string[] }>;
        milestones: Array<{ id: string; gitlabId: number; title: string; due: string | null; state: string | null }>;
        dependencies: GanttDependency[];
      };
      const data = await taktline<Raw>('GET', `/api/agent/gantt?project=${encodeURIComponent(String(project))}`);
      if (!values.svg && !values.pdf) {
        // Ohne Exportwunsch: die Daten, wie Taktline sie zeichnet (inkl. Sammelbalken).
        const byId = new Map(data.bars.map((b) => [b.id, b.iid]));
        print({
          project,
          bars: data.bars.map((b) => ({
            iid: b.iid,
            title: b.title,
            start: b.start,
            end: b.end,
            progress: b.progress,
            state: b.state,
            summary: b.summary,
            parent: b.parentId ? (byId.get(b.parentId) ?? null) : null,
            baselineStart: b.baselineStart,
            baselineEnd: b.baselineEnd,
            assignees: b.assignees,
          })),
          milestones: data.milestones.map((m) => ({ id: m.gitlabId, title: m.title, due: m.due, state: m.state })),
          dependencies: data.dependencies.map((d) => ({
            from: byId.get(d.predecessorId),
            to: byId.get(d.successorId),
            type: d.type,
            lagDays: d.lagDays,
          })),
        });
        return;
      }
      if (data.bars.length === 0 && data.milestones.length === 0) fail('Das Gantt ist leer, es gibt nichts zu zeichnen');
      const day = (s: string) => new Date(`${s}T00:00:00`);
      const bars: GanttBar[] = data.bars.map((b) => ({
        id: b.id,
        text: b.title,
        gitlabIssueIid: b.iid,
        start: day(b.start),
        end: day(b.end),
        progress: b.progress / 100,
        state: b.state,
        isSummary: b.summary,
        parentId: b.parentId,
        baselineStart: b.baselineStart ? day(b.baselineStart) : null,
        baselineEnd: b.baselineEnd ? day(b.baselineEnd) : null,
      }));
      const milestones: GanttMilestone[] = data.milestones.map((m) => ({
        id: m.id,
        text: m.title,
        gitlabMilestoneId: m.gitlabId,
        date: m.due ? day(m.due) : null,
        state: m.state ?? undefined,
      }));
      const name = String(project);
      const svg = renderToStaticMarkup(
        createElement(GanttPrintView, { bars, milestones, dependencies: data.dependencies, projectName: name }),
      );
      const size = svg.match(/^<svg[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"/);
      if (!size) fail('Das Gantt liess sich nicht zeichnen');
      await writeGraphic('gantt', name, svg, { width: Number(size[1]), height: Number(size[2]) });
      return;
    }

    case 'psp': {
      // Gleiche Regeln wie die PSP-Seite der Web-App: Tasks gehören zur Story,
      // Stories ohne Termin und ohne Parent leben nur auf dem Board. Start ohne
      // start_date ist wie beim Sync das Erstelldatum.
      const issues = (await allIssues()).filter((i) => i.issue_type !== 'task');
      const metas = new Map(issues.map((i) => [i.iid, parseGanttMeta(i.description)]));
      const parents = new Set([...metas.values()].map((m) => m?.parent_iid).filter((p): p is number => p !== undefined));
      const items: PspInput[] = [];
      for (const issue of issues) {
        const meta = metas.get(issue.iid);
        const story = isStory(issue.labels);
        const unscheduled = story && !meta?.start_date && !issue.due_date;
        if (unscheduled && meta?.parent_iid === undefined && !parents.has(issue.iid)) continue;
        items.push({
          iid: issue.iid,
          parentIid: meta?.parent_iid ?? null,
          title: issue.title,
          start: unscheduled ? null : (meta?.start_date ?? issue.created_at?.slice(0, 10) ?? null),
          end: unscheduled ? null : issue.due_date,
          state: issue.state === 'closed' ? 'closed' : 'opened',
          progress: meta?.progress ?? 0,
          story,
        });
      }
      const { roots, flat } = buildPsp(items);
      if (values.svg || values.pdf) {
        // Dasselbe Diagramm wie in der Web-App (Export dort), hier ohne Browser gerendert.
        if (roots.length === 0) fail('Der PSP ist leer, es gibt nichts zu zeichnen');
        const name = String(project);
        const svg = renderToStaticMarkup(createElement(PspDiagram, { roots, projectName: name, selectedIid: null }));
        const { width, height } = layoutPsp(roots);
        await writeGraphic('psp', name, svg, { width, height });
        return;
      }
      if (values.text) {
        console.log(pspOutline(roots, String(project)));
        return;
      }
      print({
        project,
        items: flat.map((n) => ({
          code: n.code,
          iid: n.iid,
          title: n.title,
          parent: n.parentIid,
          depth: n.depth,
          state: n.state,
          start: n.start,
          due: n.end,
          progress: n.progress,
          children: n.children.length,
          ...(n.story ? { story: true } : {}),
        })),
      });
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

    case 'frame': {
      print(await taktline('GET', `/api/agent/project?project=${encodeURIComponent(String(project))}`));
      return;
    }

    case 'goal-set': {
      const goal = args.join(' ').trim();
      const payload = { action: 'goal', project: String(project), goal };
      if (dryRun) return print({ project, dryRun: true, request: payload });
      print(await taktline('POST', '/api/agent/project', payload));
      return;
    }

    case 'dod-set': {
      const items = (values.item ?? []).map((i) => i.trim()).filter(Boolean);
      if (items.length === 0) fail('Mindestens ein --item angeben; die Liste ersetzt die ganze Definition of Done');
      const payload = { action: 'dod', project: String(project), items };
      if (dryRun) return print({ project, dryRun: true, request: payload });
      print(await taktline('POST', '/api/agent/project', payload));
      return;
    }

    case 'wip-set': {
      const column = args[0];
      if (column !== 'todo' && column !== 'doing' && column !== 'review') fail('Spalte muss todo, doing oder review sein');
      if (!args[1]) fail('Limit fehlt: Zahl oder none');
      const limit = args[1] === 'none' ? null : intValue('limit', args[1], 1);
      const payload = { action: 'wip', project: String(project), column, limit };
      if (dryRun) return print({ project, dryRun: true, request: payload });
      print(await taktline('POST', '/api/agent/project', payload));
      return;
    }

    case 'risks': {
      const data = await taktline<{ project: string; risks: Array<{ status: string }> }>(
        'GET',
        `/api/agent/risks?project=${encodeURIComponent(String(project))}`,
      );
      const status = values.status;
      print(status ? { ...data, risks: data.risks.filter((r) => r.status === status) } : data);
      return;
    }

    case 'risk': {
      if (!args[0]) fail('Die Risiko-ID fehlt (aus "risks")');
      print(
        await taktline(
          'GET',
          `/api/agent/risks?project=${encodeURIComponent(String(project))}&id=${encodeURIComponent(args[0])}`,
        ),
      );
      return;
    }

    case 'risk-create':
    case 'risk-update': {
      const create = command === 'risk-create';
      const payload: Record<string, unknown> = { action: create ? 'create' : 'update', project: String(project) };
      if (!create) {
        if (!args[0]) fail('Die Risiko-ID fehlt (aus "risks")');
        payload.id = args[0];
      }
      const score = (name: string, raw: string | undefined) => {
        if (raw === undefined) return undefined;
        const n = intValue(name, raw, 1);
        if (n > 5) fail(`--${name} muss zwischen 1 und 5 liegen`);
        return n;
      };
      if (values.title !== undefined) payload.title = values.title;
      const probability = score('probability', values.probability);
      const impact = score('impact', values.impact);
      if (probability !== undefined) payload.probability = probability;
      if (impact !== undefined) payload.impact = impact;
      if (create && (!values.title?.trim() || probability === undefined || impact === undefined)) {
        fail('risk-create braucht --title, --probability <1-5> und --impact <1-5>');
      }
      for (const [flag, key] of [
        ['description', 'description'],
        ['category', 'category'],
        ['mitigation', 'mitigation'],
        ['contingency', 'contingency'],
        ['owner', 'owner'],
      ] as const) {
        if (values[flag] !== undefined) payload[key] = values[flag];
      }
      if (values.review !== undefined) payload.nextReview = dateValue('review', values.review);
      if (values.wp) payload.workPackages = values.wp.map((v) => intValue('wp', v, 1));
      if (values.milestone) payload.milestones = values.milestone.map((v) => intValue('milestone', v, 1));
      if (!create) {
        if (values.status !== undefined) {
          const allowed = ['identified', 'in_progress', 'mitigated', 'accepted', 'occurred', 'closed'];
          if (!allowed.includes(values.status)) fail(`--status muss ${allowed.join(', ')} sein`);
          payload.status = values.status;
        }
        const pa = score('probability-after', values['probability-after']);
        const ia = score('impact-after', values['impact-after']);
        if (pa !== undefined) payload.probabilityAfter = pa;
        if (ia !== undefined) payload.impactAfter = ia;
        const clearable: Record<string, string[]> = {
          after: ['probabilityAfter', 'impactAfter'],
          owner: ['owner'],
          review: ['nextReview'],
          mitigation: ['mitigation'],
          contingency: ['contingency'],
          category: ['category'],
          description: ['description'],
        };
        for (const field of (values.clear ?? '').split(',').map((f) => f.trim()).filter(Boolean)) {
          if (!clearable[field]) fail(`--clear kennt ${Object.keys(clearable).join(', ')}`);
          for (const key of clearable[field]) payload[key] = null;
        }
        if (Object.keys(payload).length === 3) fail('Nichts zu ändern');
      }
      if (dryRun) return print({ project, dryRun: true, request: payload });
      print(await taktline('POST', '/api/agent/risks', payload));
      return;
    }

    case 'retro': {
      if (!args[0]) fail('Die Sprint-Nummer fehlt');
      const number = intValue('sprint', args[0], 1);
      print(await taktline('GET', `/api/agent/retro?project=${encodeURIComponent(String(project))}&sprint=${number}`));
      return;
    }

    case 'poker': {
      const story = args[0] ? `&story=${intValue('story', args[0], 1)}` : '';
      print(await taktline('GET', `/api/agent/poker?project=${encodeURIComponent(String(project))}${story}`));
      return;
    }

    case 'report':
    case 'flow':
    case 'audit': {
      const extra =
        command === 'flow' && values.days
          ? `&days=${intValue('days', values.days, 1)}`
          : command === 'audit' && values.limit
            ? `&limit=${intValue('limit', values.limit, 1)}`
            : '';
      print(
        await taktline('GET', `/api/agent/reports?project=${encodeURIComponent(String(project))}&view=${command}${extra}`),
      );
      return;
    }

    case 'sprints': {
      print(await taktline('GET', `/api/agent/sprints?project=${encodeURIComponent(String(project))}`));
      return;
    }

    case 'sprint-create': {
      if (!values.name?.trim()) fail('--name fehlt');
      if (!values.start || !values.end) fail('--start und --end fehlen');
      const payload = {
        action: 'create',
        project: String(project),
        name: values.name,
        goal: values.goal ?? '',
        start: dateValue('start', values.start),
        end: dateValue('end', values.end),
      };
      if (payload.end < payload.start) fail('--end darf nicht vor --start liegen');
      if (dryRun) return print({ project, dryRun: true, request: payload });
      print(await taktline('POST', '/api/agent/sprints', payload));
      return;
    }

    case 'sprint-update':
    case 'sprint-start':
    case 'sprint-close':
    case 'sprint-delete':
    case 'sprint-review': {
      if (!args[0]) fail('Die Sprint-Nummer fehlt');
      const number = intValue('sprint', args[0], 1);
      const action = command.slice('sprint-'.length);
      const payload: Record<string, unknown> = { action, project: String(project), number };
      if (action === 'update') {
        if (values.name !== undefined) payload.name = values.name;
        if (values.goal !== undefined) payload.goal = values.goal;
        if (values.start !== undefined) payload.start = dateValue('start', values.start);
        if (values.end !== undefined) payload.end = dateValue('end', values.end);
        if (Object.keys(payload).length === 3) fail('Nichts zu ändern: --name, --goal, --start oder --end angeben');
      }
      if (action === 'close') {
        const carry = values['carry-over'];
        if (!carry) fail('--carry-over fehlt: Nummer eines geplanten Sprints oder "backlog"');
        payload.carryOverTo = carry === 'backlog' ? 'backlog' : intValue('carry-over', carry, 1);
      }
      if (action === 'review') {
        if (values.outcome !== undefined) {
          if (!['yes', 'partly', 'no', 'none'].includes(values.outcome)) fail('--outcome muss yes, partly, no oder none sein');
          payload.goalOutcome = values.outcome === 'none' ? null : values.outcome;
        }
        if (values.notes !== undefined) payload.reviewNotes = values.notes;
        if (Object.keys(payload).length === 3) fail('Nichts zu ändern: --outcome oder --notes angeben');
      }
      if (dryRun) {
        const { sprints } = await taktline<{ sprints: Array<{ number: number }> }>(
          'GET',
          `/api/agent/sprints?project=${encodeURIComponent(String(project))}`,
        );
        const current = sprints.find((s) => s.number === number);
        if (!current) fail(`Sprint ${number} gibt es in diesem Projekt nicht`);
        return print({ project, dryRun: true, sprint: current, request: payload });
      }
      print(await taktline('POST', '/api/agent/sprints', payload));
      return;
    }

    case 'sprint': {
      const issue = await loadIssue(iidArgument(args[0]));
      if (!args[1]) fail('Sprint-Nummer oder "none" fehlt');
      const target = args[1] === 'none' ? null : intValue('sprint', args[1], 1);
      // Mit TAKTLINE_URL prüfen, ob es den Sprint gibt und er noch offen ist.
      // Ein Label ohne passenden Sprint würde Taktline sonst still ignorieren.
      if (taktlineUrl) {
        const { sprints } = await taktline<{ sprints: Array<{ number: number; state: string }> }>(
          'GET',
          `/api/agent/sprints?project=${encodeURIComponent(String(project))}`,
        );
        const current = sprintNumberOf(issue.labels);
        if (current !== null && sprints.find((s) => s.number === current)?.state === 'closed') {
          fail(`#${issue.iid} gehört zum abgeschlossenen Sprint ${current} und bleibt dort`);
        }
        if (target !== null) {
          const found = sprints.find((s) => s.number === target);
          if (!found) fail(`Sprint ${target} gibt es nicht. Anlegen mit sprint-create`);
          if (found.state === 'closed') fail(`Sprint ${target} ist abgeschlossen`);
        }
      }
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
