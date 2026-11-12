'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Download, FileText, Image as ImageIcon, Plus, Printer, X } from 'lucide-react';
import { buildPsp, descendantIids, pspOutline, rolledProgress, type PspInput, type PspNode } from '@/lib/psp';
import { createWorkPackageAction, updateWorkPackageAction } from '@/app/projects/[id]/gantt/actions';
import { PspDiagram } from './PspDiagram';

// Projektstrukturplan: dieselbe Hierarchie wie im Gantt (parent_iid), hier als
// Baum. Jede Änderung geht wie im Gantt nach GitLab; die Codes rechnet
// lib/psp.ts aus der Reihenfolge.

type Props = {
  projectId: string;
  projectName: string;
  items: PspInput[];
};

type View = 'diagram' | 'outline';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fileName(projectName: string, ext: string): string {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `psp-${slug || 'projekt'}.${ext}`;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PspView({ projectId, projectName, items }: Props) {
  const router = useRouter();
  const [view, setView] = useState<View>('diagram');
  const [selectedIid, setSelectedIid] = useState<number | null>(null);
  const [adding, setAdding] = useState<number | 'root' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const svgRef = useRef<SVGSVGElement>(null);

  const { roots, flat } = useMemo(() => buildPsp(items), [items]);
  const byIid = useMemo(() => new Map(flat.map((n) => [n.iid, n])), [flat]);
  const selected = selectedIid === null ? null : (byIid.get(selectedIid) ?? null);

  function run(task: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      after?.();
      router.refresh();
    });
  }

  function reparent(node: PspNode, parentIid: number | null) {
    if (!node.id) return;
    const id = node.id;
    run(() => updateWorkPackageAction(id, { parentIid }));
  }

  /** Einrücken: wird Kind des vorherigen Geschwisters. */
  function indent(node: PspNode) {
    const siblings = node.parentIid === null ? roots : (byIid.get(node.parentIid)?.children ?? roots);
    const index = siblings.findIndex((s) => s.iid === node.iid);
    if (index > 0) reparent(node, siblings[index - 1].iid);
  }

  /** Ausrücken: wird Geschwister des bisherigen Parents. */
  function outdent(node: PspNode) {
    const parent = node.parentIid === null ? null : byIid.get(node.parentIid);
    if (parent) reparent(node, parent.parentIid);
  }

  function siblingIndex(node: PspNode): number {
    const siblings = node.parentIid === null ? roots : (byIid.get(node.parentIid)?.children ?? roots);
    return siblings.findIndex((s) => s.iid === node.iid);
  }

  async function svgText(): Promise<{ text: string; width: number; height: number } | null> {
    const svg = svgRef.current;
    if (!svg) return null;
    return {
      text: new XMLSerializer().serializeToString(svg),
      width: Number(svg.getAttribute('width')),
      height: Number(svg.getAttribute('height')),
    };
  }

  async function exportSvg() {
    const s = await svgText();
    if (s) download(new Blob([s.text], { type: 'image/svg+xml' }), fileName(projectName, 'svg'));
  }

  async function exportPng() {
    const s = await svgText();
    if (!s) return;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([s.text], { type: 'image/svg+xml' }));
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = s.width * scale;
      canvas.height = s.height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => blob && download(blob, fileName(projectName, 'png')), 'image/png');
    };
    img.src = url;
  }

  async function printPdf() {
    const s = await svgText();
    if (!s) return;
    const w = window.open('', '_blank');
    if (!w) {
      setError('Das Druckfenster wurde blockiert. Bitte Pop-ups für Taktline erlauben.');
      return;
    }
    const landscape = s.width > s.height;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Projektstrukturplan ${projectName.replace(/</g, '&lt;')}</title>
<style>@page{size:A4 ${landscape ? 'landscape' : 'portrait'};margin:12mm}body{margin:0}svg{width:100%;height:auto;max-height:100vh}</style></head>
<body>${s.text}<script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
  }

  function exportText() {
    download(new Blob([pspOutline(roots, projectName) + '\n'], { type: 'text/plain;charset=utf-8' }), fileName(projectName, 'txt'));
  }

  return (
    <div className="psp">
      <div className="psp__toolbar">
        <button type="button" className="btn btn--primary btn--sm" onClick={() => setAdding('root')} disabled={pending}>
          <Plus size={12} /> Paket auf oberster Ebene
        </button>
        <div className="seg" role="group" aria-label="Ansicht">
          <button type="button" aria-pressed={view === 'diagram'} onClick={() => setView('diagram')}>
            Baumdiagramm
          </button>
          <button type="button" aria-pressed={view === 'outline'} onClick={() => setView('outline')}>
            Gliederung
          </button>
        </div>
        <div style={{ flex: 1 }} />
        <span className="psp__hint">Codes ergeben sich aus der Reihenfolge nach Start, wie im Gantt.</span>
        <div className="psp__export" role="group" aria-label="Exportieren">
          <button type="button" className="btn btn--sm" onClick={exportPng} disabled={roots.length === 0}>
            <ImageIcon size={12} /> PNG
          </button>
          <button type="button" className="btn btn--sm" onClick={exportSvg} disabled={roots.length === 0}>
            <Download size={12} /> SVG
          </button>
          <button type="button" className="btn btn--sm" onClick={printPdf} disabled={roots.length === 0}>
            <Printer size={12} /> PDF
          </button>
          <button type="button" className="btn btn--sm" onClick={exportText} disabled={roots.length === 0}>
            <FileText size={12} /> Text
          </button>
        </div>
      </div>

      {error && (
        <div className="psp__error" role="alert">
          {error}
          <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => setError(null)} aria-label="Meldung schliessen">
            <X size={12} />
          </button>
        </div>
      )}

      {adding !== null && (
        <AddForm
          key={String(adding)}
          parent={adding === 'root' ? null : (byIid.get(adding) ?? null)}
          siblings={adding === 'root' ? roots : (byIid.get(adding)?.children ?? [])}
          pending={pending}
          onCancel={() => setAdding(null)}
          onSubmit={(input) =>
            run(
              () =>
                createWorkPackageAction(projectId, {
                  title: input.title,
                  startDate: input.start,
                  endDate: input.end,
                  parentIid: adding === 'root' ? null : adding,
                }),
              () => setAdding(null),
            )
          }
        />
      )}

      <div className="psp__body">
        <div className="psp__main card">
          {roots.length === 0 ? (
            <div className="psp__empty">
              <b>Noch keine Arbeitspakete.</b>
              <p>Lege oben ein Paket auf oberster Ebene an, z.B. eine Projektphase, und darunter die Arbeitspakete.</p>
            </div>
          ) : view === 'diagram' ? (
            <div className="psp__canvas">
              <PspDiagram
                roots={roots}
                projectName={projectName}
                selectedIid={selectedIid}
                onSelect={(iid) => setSelectedIid((cur) => (cur === iid ? null : iid))}
              />
            </div>
          ) : (
            <>
              <ol className="psp__outline" aria-label="Gliederung">
                {flat.map((n) => (
                  <li
                    key={n.iid}
                    data-selected={selectedIid === n.iid ? '' : undefined}
                    data-done={n.state === 'closed' ? '' : undefined}
                    style={{ paddingLeft: 10 + n.depth * 22 }}
                  >
                    <button type="button" className="psp__row" onClick={() => setSelectedIid(n.iid)}>
                      <span className="mono tabnum psp__code">{n.code}</span>
                      <span className={n.children.length > 0 ? 'psp__title psp__title--sum' : 'psp__title'}>{n.title}</span>
                      <span className="mono psp__iid">#{n.iid}</span>
                      {n.state === 'closed' && (
                        <span className="psp__done" aria-label="erledigt" title="erledigt">
                          ✓
                        </span>
                      )}
                      {n.story && <span className="chip chip--accent">Story</span>}
                      <span className="mono tabnum psp__dates">{n.start ? `${n.start} – ${n.end}` : 'ohne Termin'}</span>
                      <span className="psp__bar" title={`${rolledProgress(n)} %`}>
                        <span style={{ width: `${rolledProgress(n)}%` }} />
                      </span>
                    </button>
                    <span className="psp__row-actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--icon btn--sm"
                        title="Ausrücken: eine Ebene höher"
                        aria-label={`${n.code} ausrücken`}
                        disabled={pending || n.parentIid === null}
                        onClick={() => outdent(n)}
                      >
                        <ArrowLeft size={12} />
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--icon btn--sm"
                        title="Einrücken: unter das Paket darüber"
                        aria-label={`${n.code} einrücken`}
                        disabled={pending || siblingIndex(n) <= 0}
                        onClick={() => indent(n)}
                      >
                        <ArrowRight size={12} />
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--icon btn--sm"
                        title="Unterpaket anlegen"
                        aria-label={`Unterpaket unter ${n.code} anlegen`}
                        disabled={pending}
                        onClick={() => setAdding(n.iid)}
                      >
                        <Plus size={12} />
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
          {/* Exportvorlage: dasselbe Diagramm ohne Auswahlrahmen, in beiden Ansichten. */}
          {roots.length > 0 && (
            <div className="psp__offscreen" aria-hidden="true">
              <PspDiagram ref={svgRef} roots={roots} projectName={projectName} selectedIid={null} />
            </div>
          )}
        </div>

        {selected && (
          <EditPanel
            key={selected.iid}
            node={selected}
            flat={flat}
            projectId={projectId}
            pending={pending}
            onClose={() => setSelectedIid(null)}
            onAddChild={() => setAdding(selected.iid)}
            onSave={(patch) => {
              if (!selected.id) return;
              const id = selected.id;
              run(() => updateWorkPackageAction(id, patch));
            }}
          />
        )}
      </div>
    </div>
  );
}

function AddForm({
  parent,
  siblings,
  pending,
  onCancel,
  onSubmit,
}: {
  parent: PspNode | null;
  siblings: PspNode[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (input: { title: string; start: string; end: string }) => void;
}) {
  // Start wie das späteste Geschwister: Das neue Paket bekommt so den letzten
  // Code der Ebene statt sich irgendwo dazwischen einzureihen.
  const latest = siblings.map((s) => s.start).filter((d): d is string => d !== null).sort().at(-1);
  const start0 = latest ?? parent?.start ?? today();
  const end0 = parent?.end && parent.end >= start0 ? parent.end : addDays(start0, 14);
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(start0);
  const [end, setEnd] = useState(end0);
  return (
    <form
      className="card psp__add"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) onSubmit({ title: title.trim(), start, end });
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <span className="psp__add-label">
        {parent ? (
          <>
            Unterpaket von <b className="mono">{parent.code}</b> {parent.title}
          </>
        ) : (
          'Neues Paket auf oberster Ebene'
        )}
      </span>
      <input
        className="input"
        autoFocus
        placeholder="Titel des Arbeitspakets"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Titel"
      />
      <label className="psp__date">
        Start
        <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
      </label>
      <label className="psp__date">
        Ende
        <input className="input" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required />
      </label>
      <button type="submit" className="btn btn--primary btn--sm" disabled={pending || !title.trim()}>
        Anlegen
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
        Abbrechen
      </button>
    </form>
  );
}

function EditPanel({
  node,
  flat,
  projectId,
  pending,
  onClose,
  onAddChild,
  onSave,
}: {
  node: PspNode;
  flat: PspNode[];
  projectId: string;
  pending: boolean;
  onClose: () => void;
  onAddChild: () => void;
  onSave: (patch: { title?: string; parentIid?: number | null }) => void;
}) {
  const [title, setTitle] = useState(node.title);
  const [parent, setParent] = useState<string>(node.parentIid === null ? '' : String(node.parentIid));
  // Nicht unter sich selbst oder unter die eigenen Nachkommen hängen.
  const blocked = descendantIids(node);
  const options = flat.filter((n) => n.iid !== node.iid && !blocked.has(n.iid));
  const parentIid = parent === '' ? null : Number(parent);
  const changed = title.trim() !== node.title || parentIid !== node.parentIid;

  return (
    <aside className="card psp__panel" aria-label={`Paket ${node.code}`}>
      <div className="card__hd">
        <span className="mono tabnum">{node.code}</span>
        <span className="mono" style={{ color: 'var(--color-ink-3)' }}>
          #{node.iid}
        </span>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={onClose} aria-label="Schliessen" title="Schliessen">
          <X size={12} />
        </button>
      </div>
      <form
        className="card__bd psp__panel-body"
        onSubmit={(e) => {
          e.preventDefault();
          const patch: { title?: string; parentIid?: number | null } = {};
          if (title.trim() && title.trim() !== node.title) patch.title = title.trim();
          if (parentIid !== node.parentIid) patch.parentIid = parentIid;
          if (Object.keys(patch).length > 0) onSave(patch);
        }}
      >
        <label className="label" htmlFor="psp-title">
          Titel
        </label>
        <input id="psp-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="label" htmlFor="psp-parent">
          Übergeordnet
        </label>
        <select id="psp-parent" className="input" value={parent} onChange={(e) => setParent(e.target.value)}>
          <option value="">— oberste Ebene —</option>
          {options.map((o) => (
            <option key={o.iid} value={o.iid}>
              {'  '.repeat(o.depth)}
              {o.code} {o.title}
            </option>
          ))}
        </select>
        <dl className="psp__facts">
          <dt>Termin</dt>
          <dd className="mono tabnum">{node.start ? `${node.start} – ${node.end}` : 'ohne Termin'}</dd>
          <dt>Fortschritt</dt>
          <dd className="mono tabnum">
            {rolledProgress(node)} %{node.children.length > 0 ? ' (aus Unterpaketen)' : ''}
          </dd>
          <dt>Unterpakete</dt>
          <dd className="mono tabnum">{node.children.length}</dd>
        </dl>
        <div className="psp__panel-actions">
          <button type="submit" className="btn btn--primary btn--sm" disabled={pending || !changed || !title.trim()}>
            Speichern
          </button>
          <button type="button" className="btn btn--sm" onClick={onAddChild} disabled={pending}>
            <Plus size={12} /> Unterpaket
          </button>
          {node.id && (
            <Link className="btn btn--ghost btn--sm" href={`/projects/${projectId}/gantt?wp=${node.id}`}>
              Im Gantt öffnen
            </Link>
          )}
        </div>
        <p className="psp__panel-note">
          Termine, Abhängigkeiten und Ressourcen bearbeitest du im Gantt. Der Parent landet als <code>parent_iid</code> im
          GitLab-Issue.
        </p>
      </form>
    </aside>
  );
}
