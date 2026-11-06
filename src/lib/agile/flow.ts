// Täglicher Board-Stand für das Cumulative Flow Diagram.
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { columnForIssue, labelNames } from './board';
import { emptyCounts, parseCounts, type FlowDay } from './flow-shared';

function today(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Zählt die Karten pro Spalte und hält den Stand für heute fest. Läuft nach
 * jeder Verschiebung und im Reconciliation-Job; der letzte Stand des Tages gilt.
 * Fehler werden nur geloggt: Eine Statistik darf keine Aktion scheitern lassen.
 */
export async function recordBoardSnapshot(projectId: string): Promise<void> {
  try {
    const wps = await prisma.workPackage.findMany({
      // Gleiche Auswahl wie das Board: keine Summary-Tasks, keine Tasks unter Stories.
      where: { projectId, deletedAt: null, isSummary: false, OR: [{ isTask: false }, { storyId: null }] },
      select: { stateCache: true, labelsCache: true },
    });
    const counts = emptyCounts();
    for (const wp of wps) counts[columnForIssue(wp.stateCache, labelNames(wp.labelsCache))] += 1;
    const date = today();
    await prisma.boardSnapshot.upsert({
      where: { projectId_date: { projectId, date } },
      create: { projectId, date, counts },
      update: { counts },
    });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), projectId }, 'Board-Stand nicht gespeichert');
  }
}

export async function loadFlow(projectId: string, days = 60): Promise<FlowDay[]> {
  const from = today();
  from.setUTCDate(from.getUTCDate() - days);
  const rows = await prisma.boardSnapshot.findMany({
    where: { projectId, date: { gte: from } },
    orderBy: { date: 'asc' },
    select: { date: true, counts: true },
  });
  return rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), counts: parseCounts(r.counts) }));
}
