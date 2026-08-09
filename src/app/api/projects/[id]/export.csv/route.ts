import { auth } from '@/auth';
import { prisma } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      nameCache: true,
      workPackages: {
        where: { deletedAt: null },
        orderBy: [{ startDate: 'asc' }, { gitlabIssueIid: 'asc' }],
        select: {
          gitlabIssueIid: true,
          titleCache: true,
          stateCache: true,
          startDate: true,
          endDate: true,
          progressPercent: true,
          isSummary: true,
          parentId: true,
          assigneesCache: true,
          labelsCache: true,
          predecessors: {
            select: {
              predecessor: { select: { gitlabIssueIid: true } },
              type: true,
              lagDays: true,
            },
          },
        },
      },
      milestones: {
        orderBy: { dueDateCache: 'asc' },
        select: {
          gitlabMilestoneId: true,
          titleCache: true,
          dueDateCache: true,
          stateCache: true,
        },
      },
    },
  });
  if (!project) return new Response('Not Found', { status: 404 });

  // parentId in workPackages ist eine UUID-Referenz; wir wollen aber im CSV
  // den parent_iid (Issue-Nummer in GitLab). Lookup-Map via Extra-Query.
  const idToIid = new Map<string, number>();
  const allWps = await prisma.workPackage.findMany({
    where: { project: { id }, deletedAt: null },
    select: { id: true, gitlabIssueIid: true },
  });
  for (const w of allWps) idToIid.set(w.id, w.gitlabIssueIid);

  const headers = [
    '#',
    'IID',
    'Titel',
    'Typ',
    'Status',
    'Start',
    'Ende',
    'Dauer (Tage)',
    'Progress %',
    'Assignees',
    'Labels',
    'Parent IID',
    'Vorgänger',
  ];

  const wpRows = project.workPackages.map((wp, idx) => {
    const assignees = parseAssignees(wp.assigneesCache);
    const labels = parseLabels(wp.labelsCache);
    const duration = Math.max(
      1,
      Math.round((wp.endDate.getTime() - wp.startDate.getTime()) / 86_400_000),
    );
    const parentIid = wp.parentId ? idToIid.get(wp.parentId) ?? '' : '';
    const predecessors = wp.predecessors
      .map((p) => `#${p.predecessor.gitlabIssueIid}:${p.type}${p.lagDays ? `+${p.lagDays}d` : ''}`)
      .join('; ');
    return [
      String(idx + 1),
      String(wp.gitlabIssueIid),
      wp.titleCache,
      wp.isSummary ? 'Summary' : 'Task',
      wp.stateCache,
      fmt(wp.startDate),
      fmt(wp.endDate),
      String(duration),
      String(wp.progressPercent),
      assignees.map((a) => `${a.name} (@${a.username})`).join('; '),
      labels.map((l) => l.name).join('; '),
      parentIid ? String(parentIid) : '',
      predecessors,
    ];
  });

  const msRows = project.milestones.map((m) => [
    '',
    String(m.gitlabMilestoneId),
    m.titleCache,
    'Meilenstein',
    m.stateCache,
    m.dueDateCache ? fmt(m.dueDateCache) : '',
    m.dueDateCache ? fmt(m.dueDateCache) : '',
    '0',
    '',
    '',
    '',
    '',
    '',
  ]);

  const allRows = [headers, ...wpRows, ...msRows];
  // UTF-8 BOM hilft Excel beim Erkennen der Codierung; Semikolon-Separator
  // ist für deutschsprachiges Excel intuitiver als Komma.
  const csv =
    '﻿' +
    allRows.map((row) => row.map(escapeCsv).join(';')).join('\r\n');

  const safeName = project.nameCache.replace(/[^\w.-]+/g, '_');
  const datestamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="taktline-${safeName}-${datestamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function escapeCsv(value: string): string {
  if (value === '') return '';
  // RFC 4180-style: wenn der Wert Semikolon, Anführungszeichen oder Newlines
  // enthält → in doppelte Anführungszeichen einschließen und interne " verdoppeln.
  if (/[";\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function parseAssignees(cache: unknown): Array<{ name: string; username: string }> {
  if (!Array.isArray(cache)) return [];
  const out: Array<{ name: string; username: string }> = [];
  for (const a of cache) {
    if (!a || typeof a !== 'object') continue;
    const obj = a as { name?: unknown; username?: unknown };
    if (typeof obj.username !== 'string') continue;
    out.push({
      name: typeof obj.name === 'string' ? obj.name : obj.username,
      username: obj.username,
    });
  }
  return out;
}

function parseLabels(cache: unknown): Array<{ name: string }> {
  if (!Array.isArray(cache)) return [];
  const out: Array<{ name: string }> = [];
  for (const l of cache) {
    if (typeof l === 'string') {
      out.push({ name: l });
      continue;
    }
    if (l && typeof l === 'object' && typeof (l as { name?: unknown }).name === 'string') {
      out.push({ name: (l as { name: string }).name });
    }
  }
  return out;
}
