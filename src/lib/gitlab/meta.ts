import YAML from 'yaml';
import { z } from 'zod';

// REQUIREMENTS 7.5: Custom-Metadaten als HTML-Comment in der Issue Description.
// Format:
//   <!-- gantt-meta:v1
//   start_date: 2026-06-01
//   parent_iid: 42
//   ...
//   -->

const META_VERSION = 'v1';
const META_RE = /<!--\s*gantt-meta:v\d+\s*([\s\S]*?)\s*-->/g;

export const DependencyTypeSchema = z.enum(['FS', 'SS', 'FF', 'SF']);

export const GanttMetaSchema = z.object({
  start_date: z.string().optional(), // ISO date string YYYY-MM-DD
  // Baseline = eingefrorener Plan-Stand (Plan-vs-Ist-Vergleich).
  // Beide Werte sind ISO-Date-Strings YYYY-MM-DD. Wenn nur eines gesetzt
  // ist, wird das andere ignoriert (Render zeichnet nur Bars mit beiden).
  baseline_start: z.string().optional(),
  baseline_end: z.string().optional(),
  parent_iid: z.number().int().positive().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  dependencies: z
    .array(
      z.object({
        iid: z.number().int().positive(),
        type: DependencyTypeSchema.default('FS'),
        lag_days: z.number().int().default(0),
      }),
    )
    .optional(),
  allocations: z
    .array(
      z.object({
        gitlab_user_id: z.number().int().positive(),
        percent: z.number().int().min(1).max(100),
      }),
    )
    .optional(),
});

export type GanttMeta = z.infer<typeof GanttMetaSchema>;

export function parseGanttMeta(description: string | null | undefined): GanttMeta | null {
  if (!description) return null;
  // Findet alle Treffer, nutzt den letzten (siehe REQUIREMENTS 7.5 Lese-Regeln).
  const matches = [...description.matchAll(META_RE)];
  if (matches.length === 0) return null;
  const lastBody = matches[matches.length - 1][1];
  let parsed: unknown;
  try {
    parsed = YAML.parse(lastBody);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const result = GanttMetaSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

// Entfernt jeglichen gantt-meta-Block aus der Description (idempotent).
export function stripGanttMeta(description: string | null | undefined): string {
  if (!description) return '';
  return description.replace(META_RE, '').replace(/\n{3,}/g, '\n\n').trimEnd();
}

// Hängt einen frischen gantt-meta-Block an die Description an.
// Leere/undefined Felder werden weggelassen (siehe REQUIREMENTS 7.5).
export function serializeGanttMeta(
  description: string | null | undefined,
  meta: GanttMeta,
): string {
  const stripped = stripGanttMeta(description);
  const clean = pruneEmpty(meta);
  if (Object.keys(clean).length === 0) {
    return stripped;
  }
  const yamlBody = YAML.stringify(clean).trimEnd();
  const block = `<!-- gantt-meta:${META_VERSION}\n${yamlBody}\n-->`;
  return stripped ? `${stripped}\n\n${block}` : block;
}

// Vergleicht zwei Meta-Objekte normalisiert — verhindert unnötige Writes nach GitLab
// (siehe REQUIREMENTS 7.5 Atomarität: Schreib-Echo-Vermeidung).
export function metaEquals(a: GanttMeta | null, b: GanttMeta | null): boolean {
  return JSON.stringify(pruneEmpty(a ?? {})) === JSON.stringify(pruneEmpty(b ?? {}));
}

function pruneEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    result[k] = v;
  }
  return result as Partial<T>;
}
