// Dependency-Validierung — prüft ob die Datumsbeziehungen zwischen
// Predecessor und Successor mit dem Dependency-Typ + lag_days konsistent sind.
//
// Typen (aus prisma/schema.prisma):
//   FS  Finish-to-Start    predecessor.end + lag <= successor.start
//   SS  Start-to-Start     predecessor.start + lag <= successor.start
//   FF  Finish-to-Finish   predecessor.end + lag <= successor.end
//   SF  Start-to-Finish    predecessor.start + lag <= successor.end
//
// Verletzung = das aktuelle Datum-Setup des Successors widerspricht dem
// Constraint. Wir geben pro Verletzung Predecessor/Successor-IDs + erwartetes
// Datum + tatsächliches Datum zurück.

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

type BarLike = {
  id: string;
  start: Date;
  end: Date;
  text?: string;
  gitlabIssueIid?: number;
  parentId?: string | null;
};

type DependencyLike = {
  id: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagDays: number;
};

export type DependencyConflict = {
  dependencyId: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagDays: number;
  // Welche Datum-Seite des Successors verletzt das Constraint
  successorField: 'start' | 'end';
  // Berechneter frühester Termin laut Constraint
  expectedDate: Date;
  // Tatsächliches Datum im Successor (das gegen expectedDate verstößt)
  actualDate: Date;
  // Verzug in vollen Tagen (positiv = wieviel zu früh / Constraint-Verletzung)
  daysOverlap: number;
};

const MS_PER_DAY = 86_400_000;

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function findDependencyConflicts(
  bars: BarLike[],
  dependencies: DependencyLike[],
): DependencyConflict[] {
  const byId = new Map(bars.map((b) => [b.id, b]));
  const conflicts: DependencyConflict[] = [];

  // Walks parent-chain. Limit auf 100 als Sicherheitsnetz gegen Zirkel
  // (sollte durch unsere Schreib-Validation eh nie vorkommen, aber besser
  // defensiv).
  function isAncestorOf(maybeAncestorId: string, descendantId: string): boolean {
    let cursor: string | null = descendantId;
    for (let i = 0; cursor && i < 100; i++) {
      const node = byId.get(cursor);
      if (!node) return false;
      if (node.parentId === maybeAncestorId) return true;
      cursor = node.parentId ?? null;
    }
    return false;
  }

  for (const dep of dependencies) {
    const pred = byId.get(dep.predecessorId);
    const succ = byId.get(dep.successorId);
    if (!pred || !succ) continue;

    // Dependencies zwischen Parent und Child (in beide Richtungen) ignorieren —
    // das Parent-Datum ist ein Aggregat aus den Kindern, ein Constraint dagegen
    // ist mathematisch unauflösbar und nur Lärm im Konflikt-Report.
    if (
      isAncestorOf(pred.id, succ.id) ||
      isAncestorOf(succ.id, pred.id)
    ) {
      continue;
    }

    const predStart = startOfDay(pred.start);
    const predEnd = startOfDay(pred.end);
    const succStart = startOfDay(succ.start);
    const succEnd = startOfDay(succ.end);
    const lag = dep.lagDays ?? 0;

    let baseDate: Date;
    let successorField: 'start' | 'end';
    let actual: Date;

    switch (dep.type) {
      case 'FS':
        // Successor.start muss >= predecessor.end + 1 + lag sein
        // (+1 weil end-Datum inklusiv, "danach starten" = nächster Tag)
        baseDate = addDays(predEnd, 1 + lag);
        successorField = 'start';
        actual = succStart;
        break;
      case 'SS':
        // Successor.start muss >= predecessor.start + lag
        baseDate = addDays(predStart, lag);
        successorField = 'start';
        actual = succStart;
        break;
      case 'FF':
        // Successor.end muss >= predecessor.end + lag
        baseDate = addDays(predEnd, lag);
        successorField = 'end';
        actual = succEnd;
        break;
      case 'SF':
        // Successor.end muss >= predecessor.start + lag
        baseDate = addDays(predStart, lag);
        successorField = 'end';
        actual = succEnd;
        break;
    }

    if (actual.getTime() < baseDate.getTime()) {
      const daysOverlap = Math.round((baseDate.getTime() - actual.getTime()) / MS_PER_DAY);
      conflicts.push({
        dependencyId: dep.id,
        predecessorId: dep.predecessorId,
        successorId: dep.successorId,
        type: dep.type,
        lagDays: lag,
        successorField,
        expectedDate: baseDate,
        actualDate: actual,
        daysOverlap,
      });
    }
  }

  return conflicts;
}
