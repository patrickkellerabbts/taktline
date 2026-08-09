// Aggregiert Summary-Bars aus ihren Kindern:
//   - Start = frühester Start aller Nachfolger
//   - Ende = spätestes Ende aller Nachfolger
//   - Progress = durationsgewichteter Durchschnitt der Nachfolger
// Verarbeitet rekursiv → auch geschachtelte Hierarchien werden korrekt aufgelöst.

export type SummaryInput = {
  id: string;
  parentId: string | null;
  start: Date;
  end: Date;
  progress: number;
};

export type SummaryComputed = {
  start: Date;
  end: Date;
  progress: number;
  hasChildren: boolean;
};

export function computeSummaries<T extends SummaryInput>(
  items: T[],
): Map<string, SummaryComputed> {
  const childrenByParent = new Map<string, T[]>();
  for (const item of items) {
    if (item.parentId) {
      const arr = childrenByParent.get(item.parentId) ?? [];
      arr.push(item);
      childrenByParent.set(item.parentId, arr);
    }
  }

  const computed = new Map<string, SummaryComputed>();
  const visiting = new Set<string>();

  function compute(item: T): SummaryComputed {
    const cached = computed.get(item.id);
    if (cached) return cached;
    // Schutz vor Zyklen (sollte nicht passieren dank Action-Check)
    if (visiting.has(item.id)) {
      return {
        start: item.start,
        end: item.end,
        progress: item.progress,
        hasChildren: false,
      };
    }
    visiting.add(item.id);

    const children = childrenByParent.get(item.id);
    if (!children || children.length === 0) {
      const result: SummaryComputed = {
        start: item.start,
        end: item.end,
        progress: item.progress,
        hasChildren: false,
      };
      computed.set(item.id, result);
      visiting.delete(item.id);
      return result;
    }

    let minStart = Infinity;
    let maxEnd = -Infinity;
    let totalDur = 0;
    let progressDur = 0;
    for (const child of children) {
      const r = compute(child);
      minStart = Math.min(minStart, r.start.getTime());
      maxEnd = Math.max(maxEnd, r.end.getTime());
      const dur = Math.max(1, r.end.getTime() - r.start.getTime());
      totalDur += dur;
      progressDur += dur * r.progress;
    }
    const result: SummaryComputed = {
      start: new Date(minStart),
      end: new Date(maxEnd),
      progress: totalDur > 0 ? progressDur / totalDur : 0,
      hasChildren: true,
    };
    computed.set(item.id, result);
    visiting.delete(item.id);
    return result;
  }

  for (const item of items) {
    if (childrenByParent.has(item.id)) {
      compute(item);
    }
  }
  return computed;
}
