'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Pencil, Target, X } from 'lucide-react';
import {
  updateDefinitionOfDoneAction,
  updateProductGoalAction,
} from '@/app/projects/[id]/sprints/actions';
import { VELOCITY_WINDOW, type Commitments, type Velocity } from '@/lib/agile/velocity';

// Kopf der Sprints-Seite: die drei Dinge, an denen sich Sprint-Planung
// ausrichtet. Product Goal und Definition of Done sind Zusagen aus dem Scrum
// Guide, die Velocity ist der Richtwert für „wie viel passt in einen Sprint“.

type Props = {
  projectId: string;
  commitments: Commitments;
  velocity: Velocity;
  readOnly?: boolean;
};

export function ScrumFrame({ projectId, commitments, velocity, readOnly = false }: Props) {
  return (
    <div className="scrum-frame">
      <ProductGoalCard projectId={projectId} goal={commitments.productGoal} readOnly={readOnly} />
      <DodCard projectId={projectId} items={commitments.definitionOfDone} readOnly={readOnly} />
      <VelocityCard velocity={velocity} />
    </div>
  );
}

function useSave() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function save(action: () => Promise<{ ok: true } | { ok: false; error: string }>, onDone: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error);
      else {
        onDone();
        router.refresh();
      }
    });
  }
  return { pending, error, save };
}

function CardHead({
  title,
  hint,
  editing,
  readOnly,
  onEdit,
}: {
  title: string;
  hint: string;
  editing: boolean;
  readOnly: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="scrum-frame__hd">
      <span className="scrum-frame__title" title={hint}>
        {title}
      </span>
      <div style={{ flex: 1 }} />
      {!readOnly && !editing && (
        <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={onEdit} aria-label={`${title} bearbeiten`} title="Bearbeiten">
          <Pencil size={12} />
        </button>
      )}
    </div>
  );
}

function EditButtons({ pending, onCancel, onSave }: { pending: boolean; onCancel: () => void; onSave: () => void }) {
  return (
    <div className="scrum-frame__edit-ft">
      <button type="button" className="btn btn--sm" onClick={onCancel} disabled={pending}>
        <X size={12} /> Abbrechen
      </button>
      <button type="button" className="btn btn--primary btn--sm" onClick={onSave} disabled={pending}>
        <Check size={12} /> {pending ? 'Speichere…' : 'Speichern'}
      </button>
    </div>
  );
}

function ProductGoalCard({ projectId, goal, readOnly }: { projectId: string; goal: string | null; readOnly: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(goal ?? '');
  const { pending, error, save } = useSave();
  return (
    <section className="card scrum-frame__card">
      <CardHead
        title="Product Goal"
        hint="Langfristiges Ziel des Produkts. Jeder Sprint soll das Team diesem Ziel näher bringen."
        editing={editing}
        readOnly={readOnly}
        onEdit={() => {
          setDraft(goal ?? '');
          setEditing(true);
        }}
      />
      {editing ? (
        <>
          <textarea
            className="story-dialog__textarea"
            rows={3}
            maxLength={2000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Wohin soll das Produkt? Ein Satz, den das ganze Team unterschreibt."
            autoFocus
            disabled={pending}
          />
          {error && <div role="alert" className="story-dialog__error">{error}</div>}
          <EditButtons
            pending={pending}
            onCancel={() => setEditing(false)}
            onSave={() => save(() => updateProductGoalAction(projectId, draft), () => setEditing(false))}
          />
        </>
      ) : goal ? (
        <p className="scrum-frame__goal">
          <Target size={14} className="scrum-frame__goal-icon" />
          {goal}
        </p>
      ) : (
        <p className="scrum-frame__empty">
          Noch kein Product Goal. {readOnly ? '' : 'Es gibt den Sprints eine gemeinsame Richtung.'}
        </p>
      )}
    </section>
  );
}

function DodCard({ projectId, items, readOnly }: { projectId: string; items: string[]; readOnly: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const { pending, error, save } = useSave();
  return (
    <section className="card scrum-frame__card">
      <CardHead
        title="Definition of Done"
        hint="Qualitätsstandard für jedes Inkrement. Taktline fragt beim Verschieben einer Story nach Done danach."
        editing={editing}
        readOnly={readOnly}
        onEdit={() => {
          setDraft(items.join('\n'));
          setEditing(true);
        }}
      />
      {editing ? (
        <>
          <textarea
            className="story-dialog__textarea"
            rows={5}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={'Ein Punkt pro Zeile, zum Beispiel:\nCode reviewt\nTests grün\nIn der Doku nachgeführt'}
            autoFocus
            disabled={pending}
          />
          {error && <div role="alert" className="story-dialog__error">{error}</div>}
          <EditButtons
            pending={pending}
            onCancel={() => setEditing(false)}
            onSave={() =>
              save(
                () => updateDefinitionOfDoneAction(projectId, draft.split('\n').map((l) => l.trim())),
                () => setEditing(false),
              )
            }
          />
        </>
      ) : items.length > 0 ? (
        <ul className="scrum-frame__dod">
          {items.map((item, i) => (
            <li key={i}>
              <Check size={12} />
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="scrum-frame__empty">
          Noch keine Definition of Done. {readOnly ? '' : 'Lege fest, wann eine Story wirklich fertig ist.'}
        </p>
      )}
    </section>
  );
}

const CHART_H = 80;

function VelocityCard({ velocity }: { velocity: Velocity }) {
  const [hover, setHover] = useState<number | null>(null);
  const bars = velocity.sprints.slice(-8);
  // Luft nach oben, damit die Beschriftung der Ø-Linie nie an den Kopf stösst.
  const max = Math.max(1, ...bars.map((b) => b.points), velocity.average ?? 0) * 1.25;
  const avgY = velocity.average === null ? null : CHART_H - (velocity.average / max) * CHART_H;
  const shown = hover === null ? null : bars.find((b) => b.number === hover);
  return (
    <section className="card scrum-frame__card">
      <div className="scrum-frame__hd">
        <span
          className="scrum-frame__title"
          title={`Erledigte Story Points pro abgeschlossenem Sprint. Der Durchschnitt der letzten ${VELOCITY_WINDOW} ist der Richtwert für die nächste Planung.`}
        >
          Velocity
        </span>
        <div style={{ flex: 1 }} />
        {velocity.average !== null && (
          <span className="scrum-frame__kpi">
            <span className="mono tabnum">Ø {formatAvg(velocity.average)}</span> SP / Sprint
          </span>
        )}
      </div>
      {bars.length === 0 ? (
        <p className="scrum-frame__empty">Erscheint, sobald der erste Sprint abgeschlossen ist.</p>
      ) : (
        <>
          <div className="velocity" onMouseLeave={() => setHover(null)}>
            <div className="velocity__plot" style={{ height: CHART_H }} aria-hidden="true">
              {avgY !== null && (
                <div className="velocity__avg" style={{ top: avgY }}>
                  <span>Ø {formatAvg(velocity.average as number)}</span>
                </div>
              )}
              {bars.map((b) => (
                <div
                  key={b.number}
                  className="velocity__col"
                  onMouseEnter={() => setHover(b.number)}
                  data-active={hover === b.number ? '' : undefined}
                >
                  <div className="velocity__bar" style={{ height: Math.max(2, (b.points / max) * CHART_H) }} />
                </div>
              ))}
            </div>
            <div className="velocity__axis" aria-hidden="true">
              {bars.map((b) => (
                <span key={b.number} className="mono">
                  S{b.number}
                </span>
              ))}
            </div>
            <div className="velocity__tip" aria-hidden="true">
              {shown ? (
                <>
                  <b>{shown.name}</b>: {shown.points} SP aus {shown.count} {shown.count === 1 ? 'Aufgabe' : 'Aufgaben'}
                </>
              ) : (
                'Balken zeigen für Details'
              )}
            </div>
          </div>
          <table className="sr-only">
            <caption>Velocity pro Sprint</caption>
            <thead>
              <tr>
                <th>Sprint</th>
                <th>Story Points</th>
              </tr>
            </thead>
            <tbody>
              {bars.map((b) => (
                <tr key={b.number}>
                  <td>{b.name}</td>
                  <td>{b.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function formatAvg(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
