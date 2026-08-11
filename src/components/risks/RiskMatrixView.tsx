'use client';

import { useId, useState, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragOverlay,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Plus, AlertTriangle, X } from 'lucide-react';
import {
  createRiskAction,
  moveRiskAction,
  type RiskStatus,
} from '@/app/projects/[id]/risks/actions';
import { RiskInspector } from './RiskInspector';
import { avatarColor, initials } from '@/components/gantt/AssigneeAvatars';

// ─── Types ───────────────────────────────────────────────────────────

export type RiskOwner = {
  id: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
};

export type RiskLinkedWp = { id: string; iid: number; title: string };
export type RiskLinkedMs = { id: string; gitlabId: number; title: string };

export type Risk = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  status: string;
  probabilityPre: number;
  impactPre: number;
  probabilityPost: number | null;
  impactPost: number | null;
  mitigationPlan: string | null;
  contingencyPlan: string | null;
  owner: RiskOwner | null;
  identifiedAt: string;
  nextReviewAt: string | null;
  closedAt: string | null;
  linkedWorkPackages: RiskLinkedWp[];
  linkedMilestones: RiskLinkedMs[];
};

type Props = {
  projectId: string;
  risks: Risk[];
  workPackages: RiskLinkedWp[];
  milestones: RiskLinkedMs[];
  allOwners: RiskOwner[];
  initialSelectedRiskId?: string;
};

// ─── Score-Helper ───────────────────────────────────────────────────

// 4-stufige Color-Scale für 5×5-Matrix.
// 1-4 = grün (niedrig), 5-9 = gelb (mittel), 10-14 = orange (hoch),
// 15-25 = rot (sehr hoch). Cutoffs sind typisch für 5×5-Standard-Matrizen.
export function scoreLevel(probability: number, impact: number): 'low' | 'medium' | 'high' | 'critical' {
  const score = probability * impact;
  if (score >= 15) return 'critical';
  if (score >= 10) return 'high';
  if (score >= 5) return 'medium';
  return 'low';
}

export function cellBackground(probability: number, impact: number): string {
  const level = scoreLevel(probability, impact);
  return {
    low: 'rgba(74, 222, 128, 0.18)', // grün
    medium: 'rgba(250, 204, 21, 0.22)', // gelb
    high: 'rgba(251, 146, 60, 0.28)', // orange
    critical: 'rgba(248, 113, 113, 0.32)', // rot
  }[level];
}

// ─── Hauptkomponente ────────────────────────────────────────────────

export function RiskMatrixView({
  projectId,
  risks,
  workPackages,
  milestones,
  allOwners,
  initialSelectedRiskId,
}: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<'pre' | 'post'>('pre');
  const [showNewModal, setShowNewModal] = useState(false);
  const [selectedRiskId, setSelectedRiskId] = useState<string | null>(
    initialSelectedRiskId ?? null,
  );
  const [activeDragRiskId, setActiveDragRiskId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Optimistic-Layer: nach einem Drop wird die neue Position SOFORT lokal
  // dargestellt, bevor die Server-Action fertig ist. Beim revalidate kommen
  // die Props mit den neuen Werten und der Draft ist überflüssig.
  const [draftMoves, setDraftMoves] = useState<
    Map<string, { mode: 'pre' | 'post'; probability: number; impact: number }>
  >(new Map());

  // Drafts die der Server-State eingeholt hat (oder deren Risk verschwunden
  // ist) sind obsolet. Statt sie in einem Effect wegzuräumen — was einen
  // zusätzlichen Render-Durchlauf kostet — filtern wir sie hier beim Ableiten
  // raus. Der State selbst wird beim nächsten Drop kompaktiert (onDragEnd).
  const pendingMoves = useMemo(() => {
    if (draftMoves.size === 0) return draftMoves;
    const next = new Map(draftMoves);
    for (const [id, m] of draftMoves) {
      const serverRisk = risks.find((r) => r.id === id);
      if (!serverRisk) {
        next.delete(id);
        continue;
      }
      const serverProb =
        m.mode === 'pre' ? serverRisk.probabilityPre : serverRisk.probabilityPost ?? serverRisk.probabilityPre;
      const serverImpact =
        m.mode === 'pre' ? serverRisk.impactPre : serverRisk.impactPost ?? serverRisk.impactPre;
      if (serverProb === m.probability && serverImpact === m.impact) {
        next.delete(id);
      }
    }
    return next;
  }, [draftMoves, risks]);

  // Effektive Risk-Liste = Server-State mit lokalen Optimistic-Patches überlagert.
  const effectiveRisks = useMemo(() => {
    if (pendingMoves.size === 0) return risks;
    return risks.map((r) => {
      const m = pendingMoves.get(r.id);
      if (!m) return r;
      return m.mode === 'pre'
        ? { ...r, probabilityPre: m.probability, impactPre: m.impact }
        : { ...r, probabilityPost: m.probability, impactPost: m.impact };
    });
  }, [risks, pendingMoves]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  // Gruppiere Risiken nach Zelle. Im Pre-Modus immer probabilityPre/impactPre,
  // im Post-Modus die Post-Werte (Fallback auf Pre wenn Post null = noch keine
  // Mitigation erfolgt). Ohne Linked-Cell (ungeordnete Risiken) gibt's nicht —
  // jedes Risk hat per Definition Pre-Werte.
  const riskCells = useMemo(() => {
    const map = new Map<string, Risk[]>(); // key = `${p}-${i}`
    for (const r of effectiveRisks) {
      const prob =
        mode === 'pre' ? r.probabilityPre : r.probabilityPost ?? r.probabilityPre;
      const imp = mode === 'pre' ? r.impactPre : r.impactPost ?? r.impactPre;
      const key = `${prob}-${imp}`;
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return map;
  }, [effectiveRisks, mode]);

  // Bereits im Projekt vergebene Kategorien — Vorschlagsliste für die beiden
  // Eingabefelder. Ohne sie entstehen "Technik" und "Technisch" nebeneinander,
  // ohne dass es jemand merkt. Bewusst kein fester Katalog: neue Kategorien
  // sollen weiterhin einfach eingetippt werden können.
  const knownCategories = useMemo(() => {
    const seen = new Map<string, string>(); // kleingeschrieben → Originalschreibweise
    for (const r of risks) {
      const c = r.category?.trim();
      if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'de'));
  }, [risks]);

  const selectedRisk = selectedRiskId
    ? effectiveRisks.find((r) => r.id === selectedRiskId) ?? null
    : null;
  const activeRisk = activeDragRiskId
    ? effectiveRisks.find((r) => r.id === activeDragRiskId) ?? null
    : null;

  function onDragEnd(e: DragEndEvent) {
    setActiveDragRiskId(null);
    const riskId = e.active.id as string;
    const target = e.over?.id as string | undefined;
    if (!target) return;
    const m = target.match(/^cell-(\d+)-(\d+)$/);
    if (!m) return;
    const newP = Number(m[1]);
    const newI = Number(m[2]);
    // Optimistic-Update: Karte sofort lokal in die neue Zelle verschieben,
    // damit es kein "Zurückspringen + dann wieder vorwärts"-Flicker gibt.
    // Von pendingMoves ausgehen statt vom rohen State: so fallen bereits
    // eingeholte Drafts bei jedem Drop mit raus und die Map bleibt klein.
    setDraftMoves(() => {
      const next = new Map(pendingMoves);
      next.set(riskId, { mode, probability: newP, impact: newI });
      return next;
    });
    startTransition(async () => {
      await moveRiskAction(riskId, mode, newP, newI);
      router.refresh();
    });
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setActiveDragRiskId(e.active.id as string)}
      onDragCancel={() => setActiveDragRiskId(null)}
      onDragEnd={onDragEnd}
    >
      <div style={{ flex: 1, display: 'flex', gap: 16, minHeight: 0, minWidth: 0 }}>
        {/* Linke Seite: Matrix */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {/* Toolbar: Pre/Post-Toggle + Add */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div className="seg" style={{ height: 28 }}>
              <button
                type="button"
                aria-pressed={mode === 'pre'}
                onClick={() => setMode('pre')}
              >
                Pre-Mitigation
              </button>
              <button
                type="button"
                aria-pressed={mode === 'post'}
                onClick={() => setMode('post')}
              >
                Post-Mitigation
              </button>
            </div>
            <span style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>
              {mode === 'pre'
                ? 'Risiken vor Mitigation (Initial-Bewertung)'
                : 'Risiken nach Mitigation (Fallback auf Pre-Werte)'}
            </span>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => setShowNewModal(true)}
            >
              <Plus size={12} />
              <span>Neues Risiko</span>
            </button>
          </div>

          {/* Matrix */}
          <Matrix
            riskCells={riskCells}
            onRiskClick={(id) => setSelectedRiskId(id)}
            selectedRiskId={selectedRiskId}
          />

          {/* Legende */}
          <Legend />
        </div>

        {/* Rechte Seite: Risk-Inspector (Slide-Out) */}
        {selectedRisk && (
          <RiskInspector
            risk={selectedRisk}
            projectId={projectId}
            workPackages={workPackages}
            milestones={milestones}
            allOwners={allOwners}
            knownCategories={knownCategories}
            onClose={() => setSelectedRiskId(null)}
          />
        )}
      </div>

      {/* New-Risk-Modal */}
      {showNewModal && (
        <NewRiskModal
          projectId={projectId}
          knownCategories={knownCategories}
          onClose={() => setShowNewModal(false)}
          onCreated={(id) => {
            setShowNewModal(false);
            setSelectedRiskId(id);
            router.refresh();
          }}
        />
      )}

      {/* Drag-Overlay damit die Karte während Drag sichtbar mitfliegt.
          dropAnimation={null} verhindert das "fly back to source"-Verhalten
          beim Drop — die Karte verschwindet sofort und das optimistische
          Update zeigt sie an der neuen Position. */}
      <DragOverlay dropAnimation={null}>
        {activeRisk && (
          <div style={{ opacity: 0.85 }}>
            <RiskCard risk={activeRisk} dragging />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ─── Matrix-Grid ────────────────────────────────────────────────────

function Matrix({
  riskCells,
  onRiskClick,
  selectedRiskId,
}: {
  riskCells: Map<string, Risk[]>;
  onRiskClick: (id: string) => void;
  selectedRiskId: string | null;
}) {
  // Achsen: Y = Wahrscheinlichkeit (5 oben, 1 unten), X = Impact (1 links, 5 rechts)
  const probs = [5, 4, 3, 2, 1];
  const impacts = [1, 2, 3, 4, 5];
  const probLabels: Record<number, string> = {
    1: 'Sehr niedrig',
    2: 'Niedrig',
    3: 'Mittel',
    4: 'Hoch',
    5: 'Sehr hoch',
  };
  const impactLabels: Record<number, string> = {
    1: 'Sehr niedrig',
    2: 'Niedrig',
    3: 'Mittel',
    4: 'Hoch',
    5: 'Sehr hoch',
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'grid',
        // minmax(0, 1fr) statt 1fr: das implizite Minimum von 1fr ist
        // min-content, und ein langer Risikotitel (nowrap) macht daraus eine
        // Spalte, die breiter ist als das Fenster. Zusammen mit dem
        // overflow: hidden weiter unten wurde der Text dann abgeschnitten,
        // statt in der Karte zu kürzen.
        // Erste Spalte 150px: "Wahrscheinlichkeit" ist bei 10px in Versalien
        // rund 120px breit und wurde in einer 120px-Spalte vorne abgeschnitten.
        gridTemplateColumns: '150px repeat(5, minmax(0, 1fr))',
        gridTemplateRows: 'auto repeat(5, minmax(0, 1fr))',
        gap: 2,
        background: 'var(--color-border)',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      {/* Top-left Ecke (leer) */}
      <div
        style={{
          background: 'var(--color-surface-2)',
          padding: '8px 10px',
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          // Weniger Sperrung als die übrigen Überschriften (0.05em): damit
          // passt "↓ Wahrscheinlichkeit" in eine Zeile statt umzubrechen.
          letterSpacing: '0.02em',
          color: 'var(--color-ink-3)',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'flex-end',
          textAlign: 'right',
          lineHeight: 1.35,
          whiteSpace: 'nowrap',
        }}
      >
        ↓ Wahrscheinlichkeit
        <br />
        Impact →
      </div>

      {/* X-Achse: Impact-Labels oben */}
      {impacts.map((i) => (
        <div
          key={`x-${i}`}
          style={{
            background: 'var(--color-surface-2)',
            padding: '8px 4px',
            fontSize: 11,
            fontWeight: 600,
            textAlign: 'center',
            color: 'var(--color-ink-2)',
          }}
        >
          {impactLabels[i]}
          <div className="mono" style={{ fontSize: 9, color: 'var(--color-ink-3)', marginTop: 2 }}>
            {i}
          </div>
        </div>
      ))}

      {/* Rows: Y-Label + 5 Cells */}
      {probs.map((p) => (
        <RowFragment
          key={`row-${p}`}
          probability={p}
          probLabel={probLabels[p]}
          impacts={impacts}
          riskCells={riskCells}
          onRiskClick={onRiskClick}
          selectedRiskId={selectedRiskId}
        />
      ))}
    </div>
  );
}

function RowFragment({
  probability,
  probLabel,
  impacts,
  riskCells,
  onRiskClick,
  selectedRiskId,
}: {
  probability: number;
  probLabel: string;
  impacts: number[];
  riskCells: Map<string, Risk[]>;
  onRiskClick: (id: string) => void;
  selectedRiskId: string | null;
}) {
  return (
    <>
      <div
        style={{
          background: 'var(--color-surface-2)',
          padding: '8px 10px',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--color-ink-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          textAlign: 'right',
        }}
      >
        <div>
          {probLabel}
          <div className="mono" style={{ fontSize: 9, color: 'var(--color-ink-3)' }}>
            {probability}
          </div>
        </div>
      </div>
      {impacts.map((i) => {
        const cellRisks = riskCells.get(`${probability}-${i}`) ?? [];
        return (
          <MatrixCell
            key={`${probability}-${i}`}
            probability={probability}
            impact={i}
            risks={cellRisks}
            onRiskClick={onRiskClick}
            selectedRiskId={selectedRiskId}
          />
        );
      })}
    </>
  );
}

// ─── Matrix-Zelle (Droppable) ────────────────────────────────────────

function MatrixCell({
  probability,
  impact,
  risks,
  onRiskClick,
  selectedRiskId,
}: {
  probability: number;
  impact: number;
  risks: Risk[];
  onRiskClick: (id: string) => void;
  selectedRiskId: string | null;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `cell-${probability}-${impact}` });
  const bg = cellBackground(probability, impact);
  return (
    <div
      ref={setNodeRef}
      style={{
        background: isOver
          ? 'rgba(217, 119, 6, 0.18)'
          : bg,
        padding: 6,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minHeight: 80,
        // minWidth: 0 lässt die Zelle unter die Breite ihres Inhalts schrumpfen —
        // erst dadurch greift das Ellipsis in der Karte.
        minWidth: 0,
        overflow: 'auto',
        transition: 'background .15s',
      }}
    >
      {risks.map((r) => (
        <DraggableRiskCard
          key={r.id}
          risk={r}
          onClick={() => onRiskClick(r.id)}
          selected={r.id === selectedRiskId}
        />
      ))}
    </div>
  );
}

// ─── Risk-Karte (Draggable) ──────────────────────────────────────────

function DraggableRiskCard({
  risk,
  onClick,
  selected,
}: {
  risk: Risk;
  onClick: () => void;
  selected: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: risk.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClick}
      style={{
        opacity: isDragging ? 0.4 : 1,
        cursor: 'grab',
      }}
    >
      <RiskCard risk={risk} selected={selected} />
    </div>
  );
}

function RiskCard({
  risk,
  selected,
  dragging,
}: {
  risk: Risk;
  selected?: boolean;
  dragging?: boolean;
}) {
  const statusInfo = STATUS_LABELS[risk.status as RiskStatus] ?? {
    label: risk.status,
    color: 'var(--color-ink-3)',
  };
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: selected
          ? '1.5px solid var(--color-accent)'
          : '1px solid var(--color-border)',
        borderRadius: 4,
        padding: '6px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minWidth: 0,
        boxShadow: dragging ? 'var(--shadow-2)' : undefined,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--color-ink)',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={risk.title}
      >
        {risk.title}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 9,
        }}
      >
        <span
          style={{
            color: statusInfo.color,
            background: 'var(--color-surface-2)',
            padding: '1px 4px',
            borderRadius: 2,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          {statusInfo.label}
        </span>
        {risk.linkedWorkPackages.length > 0 && (
          <span style={{ color: 'var(--color-ink-3)' }}>
            🔗 {risk.linkedWorkPackages.length}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {risk.owner && (
          <OwnerAvatar owner={risk.owner} />
        )}
      </div>
    </div>
  );
}

function OwnerAvatar({ owner }: { owner: RiskOwner }) {
  if (owner.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- GitLab-Avatar
      <img
        src={owner.avatarUrl}
        alt=""
        width={14}
        height={14}
        style={{ borderRadius: '50%' }}
        title={owner.name ?? owner.username ?? ''}
      />
    );
  }
  return (
    <div
      className={`avatar ${avatarColor(owner.username ?? owner.id)}`}
      style={{ width: 14, height: 14, fontSize: 7 }}
      title={owner.name ?? owner.username ?? ''}
    >
      {initials(owner.name ?? owner.username ?? '?')}
    </div>
  );
}

const STATUS_LABELS: Record<RiskStatus, { label: string; color: string }> = {
  identified: { label: 'identifiziert', color: 'var(--color-ink-3)' },
  in_progress: { label: 'in arbeit', color: 'var(--color-accent)' },
  mitigated: { label: 'gemindert', color: 'var(--color-status-done, #16a34a)' },
  accepted: { label: 'akzeptiert', color: 'var(--color-status-open, #2563eb)' },
  occurred: { label: 'eingetreten', color: 'var(--color-status-blocked)' },
  closed: { label: 'geschlossen', color: 'var(--color-ink-4)' },
};

// ─── Legende ────────────────────────────────────────────────────────

function Legend() {
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        fontSize: 10,
        color: 'var(--color-ink-3)',
        alignItems: 'center',
      }}
    >
      <span>Risiko-Level:</span>
      <LegendBox color={cellBackground(1, 1)} label="Niedrig (1-4)" />
      <LegendBox color={cellBackground(3, 2)} label="Mittel (5-9)" />
      <LegendBox color={cellBackground(3, 4)} label="Hoch (10-14)" />
      <LegendBox color={cellBackground(5, 5)} label="Kritisch (15-25)" />
    </div>
  );
}

function LegendBox({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span
        style={{
          width: 14,
          height: 10,
          background: color,
          border: '1px solid var(--color-border)',
          borderRadius: 2,
        }}
      />
      {label}
    </span>
  );
}

// ─── Kategorie-Eingabe ──────────────────────────────────────────────

/**
 * Freitextfeld mit Vorschlägen aus den bereits vergebenen Kategorien.
 *
 * Bewusst ein `<datalist>` und kein `<select>`: die Kategorien sind kein
 * gepflegter Katalog, eine neue soll man weiterhin einfach tippen können. Die
 * Liste ist eine Gedächtnisstütze gegen Dubletten, keine Einschränkung.
 */
export function CategoryInput({
  value,
  onChange,
  onCommit,
  suggestions,
  disabled,
}: {
  value?: string;
  onChange?: (next: string) => void;
  /** Für unkontrollierte Nutzung (Inspector): Wert bei Blur übernehmen. */
  onCommit?: (next: string) => void;
  suggestions: string[];
  disabled?: boolean;
}) {
  // Eine ID pro Instanz — zwei datalists mit gleichem id-Attribut würden sich
  // im DOM gegenseitig verdecken.
  const listId = useId();
  return (
    <>
      <input
        className="input"
        type="text"
        list={listId}
        defaultValue={onChange ? undefined : value}
        value={onChange ? value ?? '' : undefined}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        onBlur={onCommit ? (e) => onCommit(e.target.value) : undefined}
        disabled={disabled}
        placeholder={
          suggestions.length > 0
            ? `z.B. ${suggestions.slice(0, 2).join(', ')} …`
            : 'z.B. Technisch, Finanziell, Personal …'
        }
        style={{ width: '100%', fontSize: 12 }}
      />
      <datalist id={listId}>
        {suggestions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </>
  );
}

// ─── New-Risk-Modal ─────────────────────────────────────────────────

function NewRiskModal({
  projectId,
  onClose,
  onCreated,
  knownCategories,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (riskId: string) => void;
  knownCategories: string[];
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [probability, setProbability] = useState(3);
  const [impact, setImpact] = useState(3);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    if (!title.trim()) {
      setError('Titel ist Pflicht');
      return;
    }
    startTransition(async () => {
      const res = await createRiskAction({
        projectId,
        title: title.trim(),
        description: description.trim() || undefined,
        category: category.trim() || undefined,
        probabilityPre: probability,
        impactPre: impact,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onCreated(res.riskId);
    });
  }

  return (
    <div
      onClick={onClose}
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Neues Risiko"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          padding: 20,
          width: 480,
          maxWidth: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={16} style={{ color: 'var(--color-status-blocked)' }} />
          <span style={{ fontSize: 15, fontWeight: 600 }}>Neues Risiko</span>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--color-ink-3)',
              cursor: 'pointer',
              padding: 2,
            }}
          >
            <X size={16} />
          </button>
        </div>
        <div>
          <div className="label">Titel *</div>
          <input
            className="input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            disabled={pending}
            placeholder="z.B. Lieferengpass bei Switch-Hardware"
            style={{ width: '100%', fontSize: 13 }}
          />
        </div>
        <div>
          <div className="label">Beschreibung</div>
          <textarea
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            disabled={pending}
            placeholder="Was kann passieren? Auswirkung?"
            style={{
              width: '100%',
              fontSize: 12,
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
        </div>
        <div>
          <div className="label">Kategorie</div>
          <CategoryInput
            value={category}
            onChange={setCategory}
            disabled={pending}
            suggestions={knownCategories}
          />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div className="label">Wahrscheinlichkeit (1-5)</div>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={probability}
              onChange={(e) => setProbability(Number(e.target.value))}
              style={{ width: '100%' }}
              disabled={pending}
            />
            <div
              className="mono tabnum"
              style={{ fontSize: 11, textAlign: 'center', color: 'var(--color-ink-3)' }}
            >
              {probability}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="label">Schadensausmaß (1-5)</div>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={impact}
              onChange={(e) => setImpact(Number(e.target.value))}
              style={{ width: '100%' }}
              disabled={pending}
            />
            <div
              className="mono tabnum"
              style={{ fontSize: 11, textAlign: 'center', color: 'var(--color-ink-3)' }}
            >
              {impact}
            </div>
          </div>
        </div>
        <div
          style={{
            padding: '8px 10px',
            background: cellBackground(probability, impact),
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            fontSize: 11,
            textAlign: 'center',
            fontWeight: 600,
          }}
        >
          Score: {probability * impact} · Level:{' '}
          {{ low: 'Niedrig', medium: 'Mittel', high: 'Hoch', critical: 'Kritisch' }[
            scoreLevel(probability, impact)
          ]}
        </div>
        {error && (
          <div style={{ fontSize: 11, color: 'var(--color-status-blocked)' }}>{error}</div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn--sm" onClick={onClose} disabled={pending}>
            Abbrechen
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={submit}
            disabled={pending || !title.trim()}
          >
            {pending ? 'Erstelle…' : 'Erstellen'}
          </button>
        </div>
      </div>
    </div>
  );
}
