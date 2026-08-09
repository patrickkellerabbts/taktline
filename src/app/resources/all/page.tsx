import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Folder } from 'lucide-react';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { parsePreferences } from '@/lib/preferences';
import { AppHeader, SubHeader } from '@/components/layout/AppHeader';
import { getResourceMatrix } from '@/lib/resources';
import {
  ResourceHeatmap,
  type SerializedMatrix,
} from '@/components/resources/ResourceHeatmap';

// Globale Ressourcen-Übersicht: alle Projekte zusammen. Sekundär zur
// projektspezifischen View — primär arbeitet man pro Projekt.
export default async function ResourcesAllPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const matrix = await getResourceMatrix({ weeksAhead: 16 });

  // Map → Object für die Serialisierung zum Client
  const cellsObj: SerializedMatrix['cells'] = {};
  for (const [uid, weekMap] of matrix.cells.entries()) {
    const inner: SerializedMatrix['cells'][string] = {};
    for (const [wk, cell] of weekMap.entries()) {
      inner[wk] = {
        percent: cell.percent,
        contributions: cell.contributions.map((c) => ({
          ...c,
          startDate: c.startDate.toISOString(),
          endDate: c.endDate.toISOString(),
        })),
      };
    }
    cellsObj[String(uid)] = inner;
  }

  const data: SerializedMatrix = {
    weeks: matrix.weeks.map((w) => ({
      key: w.key,
      isoYear: w.isoYear,
      isoWeek: w.isoWeek,
      startDate: w.startDate.toISOString(),
    })),
    users: matrix.users,
    cells: cellsObj,
  };

  let maxCount = 0;
  for (const m of matrix.cells.values()) {
    for (const c of m.values()) {
      if (c.contributions.length > maxCount) maxCount = c.contributions.length;
    }
  }

  // Link zurück zur projektspezifischen View — nutzt das letzte geöffnete
  // Projekt aus den Prefs. Wenn keines existiert, kein Link.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { preferences: true },
  });
  const prefs = parsePreferences(user?.preferences);
  let lastProjectLink: { id: string; name: string } | null = null;
  if (prefs.lastOpenedProjectId) {
    const last = await prisma.project.findUnique({
      where: { id: prefs.lastOpenedProjectId },
      select: { id: true, nameCache: true },
    });
    if (last) lastProjectLink = { id: last.id, name: last.nameCache };
  }

  return (
    <div className="app">
      <AppHeader username={session.user.username} active="resources" />
      <SubHeader
        crumbs={['Ressourcen', 'Alle Projekte']}
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>
              {matrix.users.length > 0 ? (
                <>
                  <span className="mono tabnum">{matrix.users.length}</span> Personen ·{' '}
                  <span className="mono tabnum">{matrix.weeks.length}</span> KW · max{' '}
                  <span className="mono tabnum">{maxCount}</span> Aufgaben/KW
                </>
              ) : (
                'Keine Daten'
              )}
            </span>
            {lastProjectLink && (
              <Link
                href={`/projects/${lastProjectLink.id}/resources`}
                className="btn btn--sm btn--ghost"
                title={`Zurück zu ${lastProjectLink.name}`}
              >
                <Folder size={12} />
                <span>Pro Projekt</span>
              </Link>
            )}
          </div>
        }
      />
      <div style={{ flex: 1, padding: '14px 18px', minHeight: 0, display: 'flex' }}>
        <div
          className="card"
          style={{ flex: 1, padding: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}
        >
          <ResourceHeatmap data={data} />
        </div>
      </div>
    </div>
  );
}
