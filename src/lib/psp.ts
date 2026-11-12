// Projektstrukturplan (PSP). Ohne Server-Abhängigkeiten, damit Web-App und
// Taktline-CLI dieselben Codes rechnen.
//
// Der PSP ist keine eigene Struktur, sondern die Gantt-Hierarchie
// (`parent_iid` im gantt-meta-Block). Die Codes (1, 1.2, 1.2.3) werden nicht
// gespeichert, sondern aus der Reihenfolge der Geschwister abgeleitet: nach
// Start, dann nach Issue-Nummer, wie im Gantt. Wer ein Paket verschiebt oder
// umhängt, ändert damit auch die Codes.

export type PspInput = {
  iid: number;
  parentIid: number | null;
  title: string;
  /** YYYY-MM-DD; null bei Stories ohne Termin (die stehen hinten). */
  start: string | null;
  end: string | null;
  state: 'opened' | 'closed';
  progress: number;
  story: boolean;
  /** Taktline-ID, nur in der Web-App gesetzt. */
  id?: string;
};

export type PspNode = PspInput & {
  code: string;
  depth: number;
  children: PspNode[];
};

function compare(a: PspInput, b: PspInput): number {
  if (a.start !== b.start) {
    if (a.start === null) return 1;
    if (b.start === null) return -1;
    return a.start < b.start ? -1 : 1;
  }
  return a.iid - b.iid;
}

/**
 * Baut den Baum. Ein Parent, der nicht in `items` vorkommt, macht das Paket
 * zur Wurzel; ein Kreis (in GitLab per Hand möglich) wird an der Stelle
 * abgeschnitten, an der er sich schliessen würde.
 */
export function buildPsp(items: PspInput[]): { roots: PspNode[]; flat: PspNode[] } {
  const byIid = new Map(items.map((i) => [i.iid, i]));
  const childrenOf = new Map<number | null, PspInput[]>();
  for (const item of items) {
    const parent = item.parentIid !== null && byIid.has(item.parentIid) && item.parentIid !== item.iid ? item.parentIid : null;
    const list = childrenOf.get(parent) ?? [];
    list.push(item);
    childrenOf.set(parent, list);
  }

  const flat: PspNode[] = [];
  const placed = new Set<number>();
  function grow(parent: number | null, prefix: string, depth: number): PspNode[] {
    const kids = (childrenOf.get(parent) ?? []).filter((k) => !placed.has(k.iid)).sort(compare);
    return kids.map((kid, index) => {
      placed.add(kid.iid);
      const code = prefix ? `${prefix}.${index + 1}` : String(index + 1);
      const node: PspNode = { ...kid, code, depth, children: [] };
      flat.push(node);
      node.children = grow(kid.iid, code, depth + 1);
      return node;
    });
  }
  const roots = grow(null, '', 0);

  // Pakete in einem reinen Kreis hängen an keiner Wurzel; sie kommen ans Ende.
  const orphans = items.filter((i) => !placed.has(i.iid)).sort(compare);
  for (const orphan of orphans) {
    if (placed.has(orphan.iid)) continue;
    placed.add(orphan.iid);
    const code = String(roots.length + 1);
    const node: PspNode = { ...orphan, code, depth: 0, children: [] };
    flat.push(node);
    node.children = grow(orphan.iid, code, 1);
    roots.push(node);
  }
  return { roots, flat };
}

/** Alle Nachkommen eines Pakets (für „nicht unter sich selbst hängen“). */
export function descendantIids(node: PspNode): Set<number> {
  const out = new Set<number>();
  const stack = [...node.children];
  while (stack.length) {
    const n = stack.pop()!;
    out.add(n.iid);
    stack.push(...n.children);
  }
  return out;
}

/** Fortschritt eines Knotens: Blätter direkt, Sammelpakete als Mittel der Kinder. */
export function rolledProgress(node: PspNode): number {
  if (node.state === 'closed') return 100;
  if (node.children.length === 0) return node.progress;
  const sum = node.children.reduce((s, c) => s + rolledProgress(c), 0);
  return Math.round(sum / node.children.length);
}

/** Text-Gliederung, z.B. für die CLI oder einen Bericht. */
export function pspOutline(roots: PspNode[], projectName?: string): string {
  const lines: string[] = [];
  if (projectName) lines.push(projectName);
  const walk = (nodes: PspNode[]) => {
    for (const n of nodes) {
      lines.push(`${'  '.repeat(n.depth + (projectName ? 1 : 0))}${n.code}  ${n.title}  (#${n.iid}${n.state === 'closed' ? ', erledigt' : ''})`);
      walk(n.children);
    }
  };
  walk(roots);
  return lines.join('\n');
}
