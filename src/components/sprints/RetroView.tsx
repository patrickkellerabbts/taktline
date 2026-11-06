'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Check, CircleDot, Plus, Trash2 } from 'lucide-react';
import {
  actionToIssueAction,
  addRetroItemAction,
  deleteRetroItemAction,
  saveReviewAction,
  toggleRetroVoteAction,
} from '@/app/projects/[id]/sprints/retro-actions';
import { RETRO_COLUMNS, RETRO_VOTES_PER_PERSON, type GoalOutcome, type RetroData, type RetroKind } from '@/lib/agile/retro-shared';

// Sprint Review (Was ist entstanden, was sagen die Stakeholder?) und
// Retrospektive (Wie arbeiten wir besser?). Die Retro holt sich alle paar
// Sekunden den neuen Stand, damit das Team gleichzeitig Karten schreiben kann.

const REFRESH_MS = 5000;

const OUTCOMES: Array<{ value: GoalOutcome; label: string }> = [
  { value: 'yes', label: 'Erreicht' },
  { value: 'partly', label: 'Teilweise' },
  { value: 'no', label: 'Nicht erreicht' },
];

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function RetroView({ data }: { data: RetroData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [router]);

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error);
      else {
        onDone?.();
        router.refresh();
      }
    });
  }

  const { sprint, increment } = data;

  return (
    <div className="retro">
      <header className="retro__hd">
        <div>
          <h2 className="retro__title">{sprint.name}: Review und Retrospektive</h2>
          <div className="retro__meta mono">
            {formatDate(sprint.startDate)} – {formatDate(sprint.endDate)}
            {sprint.state === 'active' && <span className="chip chip--accent">läuft</span>}
            {sprint.state === 'closed' && <span className="chip chip--done">abgeschlossen</span>}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <Link className="btn btn--sm" href={`/projects/${data.projectId}/sprints`}>
          Zurück zu den Sprints
        </Link>
      </header>
      {error && (
        <div role="alert" className="board__error">
          {error}
        </div>
      )}

      <section className="card retro__review">
        <div className="retro__section-title">Sprint Review</div>
        <ReviewForm data={data} pending={pending} run={run} />
        <div className="retro__increment">
          <div className="retro__kpis">
            <Kpi value={`${increment.done.length}`} label={`von ${increment.done.length + increment.open.length} erledigt`} />
            <Kpi value={`${increment.donePoints} SP`} label={`von ${increment.plannedPoints} SP geplant`} />
            {increment.velocityAverage !== null && (
              <Kpi value={`Ø ${Math.round(increment.velocityAverage)} SP`} label="Velocity bisher" />
            )}
          </div>
          <div className="retro__lists">
            <IncrementList title="Erledigt (Inkrement)" items={increment.done} />
            <IncrementList
              title={sprint.state === 'closed' ? 'Nicht fertig, zurück ins Backlog' : 'Noch offen'}
              items={increment.open}
              muted
            />
          </div>
        </div>
      </section>

      {data.previousActions.length > 0 && (
        <section className="card retro__previous">
          <div className="retro__section-title">Massnahmen aus der Retro von {data.previousSprintName}</div>
          <ul>
            {data.previousActions.map((a) => (
              <li key={a.id} data-done={a.issueState === 'closed' ? '' : undefined}>
                {a.issueState === 'closed' ? <Check size={13} /> : <CircleDot size={13} />}
                <span>{a.text}</span>
                <span className="retro__issue-state">
                  {a.issueIid ? (a.issueState === 'closed' ? `#${a.issueIid} umgesetzt` : `#${a.issueIid} offen`) : 'kein Issue'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="retro__board-wrap">
        <div className="retro__board-hd">
          <span className="retro__section-title">Retrospektive</span>
          <span className="retro__votes" title="Punkte-Abstimmung: Klick auf den Punkt einer Karte">
            {Array.from({ length: RETRO_VOTES_PER_PERSON }, (_, i) => (
              <i key={i} data-used={i >= data.votesLeft ? '' : undefined} />
            ))}
            {data.votesLeft} {data.votesLeft === 1 ? 'Punkt' : 'Punkte'} übrig
          </span>
        </div>
        <div className="retro__board">
          {RETRO_COLUMNS.map((col) => (
            <RetroColumn
              key={col.kind}
              kind={col.kind}
              title={col.title}
              hint={col.hint}
              data={data}
              pending={pending}
              run={run}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

type Run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>, onDone?: () => void) => void;

function ReviewForm({ data, pending, run }: { data: RetroData; pending: boolean; run: Run }) {
  const [outcome, setOutcome] = useState<GoalOutcome | null>(data.goalOutcome);
  const [notes, setNotes] = useState(data.reviewNotes);
  const [saved, setSaved] = useState(true);
  const dirty = outcome !== data.goalOutcome || notes !== data.reviewNotes;
  return (
    <div className="retro__review-form">
      <div className="retro__goal">
        <span className="retro__goal-label">Sprint-Ziel</span>
        <span className="retro__goal-text">{data.sprint.goal ?? 'Kein Sprint-Ziel festgelegt'}</span>
        <div className="seg" role="group" aria-label="Sprint-Ziel erreicht?">
          {OUTCOMES.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={outcome === o.value}
              data-outcome={o.value}
              onClick={() => {
                setOutcome(outcome === o.value ? null : o.value);
                setSaved(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <textarea
        className="story-dialog__textarea"
        rows={3}
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
        placeholder="Was wurde gezeigt? Welches Feedback kam von Product Owner und Stakeholdern? Was ändert sich am Product Backlog?"
        disabled={pending}
      />
      <div className="retro__review-ft">
        {!dirty && saved && (data.goalOutcome || data.reviewNotes) && <span className="retro__saved">Gespeichert</span>}
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={!dirty || pending}
          onClick={() => run(() => saveReviewAction(data.sprint.id, { goalOutcome: outcome, reviewNotes: notes }), () => setSaved(true))}
        >
          Review speichern
        </button>
      </div>
    </div>
  );
}

function Kpi({ value, label }: { value: string; label: string }) {
  return (
    <div className="retro__kpi">
      <span className="mono tabnum">{value}</span>
      <span>{label}</span>
    </div>
  );
}

function IncrementList({ title, items, muted = false }: { title: string; items: RetroData['increment']['done']; muted?: boolean }) {
  return (
    <div className="retro__list" data-muted={muted ? '' : undefined}>
      <div className="retro__list-title">
        {title} <span className="mono">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="retro__list-empty">—</div>
      ) : (
        <ul>
          {items.map((i) => (
            <li key={i.id}>
              <span className="mono">#{i.iid}</span> {i.title}
              {i.storyPoints !== null && <span className="mono retro__sp">{i.storyPoints} SP</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RetroColumn({
  kind,
  title,
  hint,
  data,
  pending,
  run,
}: {
  kind: RetroKind;
  title: string;
  hint: string;
  data: RetroData;
  pending: boolean;
  run: Run;
}) {
  const [text, setText] = useState('');
  const items = data.items.filter((i) => i.kind === kind).sort((a, b) => b.votes - a.votes);
  function add() {
    if (!text.trim()) return;
    run(() => addRetroItemAction(data.sprint.id, { kind, text }), () => setText(''));
  }
  return (
    <div className="retro__col" data-kind={kind}>
      <div className="retro__col-hd">
        <span className="retro__col-title">{title}</span>
        <span className="mono">{items.length}</span>
      </div>
      <div className="retro__col-hint">{hint}</div>
      <div className="retro__add">
        <textarea
          rows={2}
          className="story-dialog__textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Karte schreiben, Enter speichert"
          aria-label={`Neue Karte: ${title}`}
          disabled={pending}
        />
        <button type="button" className="btn btn--sm" onClick={add} disabled={!text.trim() || pending} aria-label="Karte hinzufügen">
          <Plus size={12} />
        </button>
      </div>
      {items.map((item) => (
        <article key={item.id} className="retro__note">
          <p>{item.text}</p>
          <div className="retro__note-ft">
            <button
              type="button"
              className="retro__dot"
              data-voted={item.voted ? '' : undefined}
              onClick={() => run(() => toggleRetroVoteAction(item.id))}
              disabled={pending || (!item.voted && data.votesLeft === 0)}
              aria-pressed={item.voted}
              aria-label={item.voted ? 'Punkt zurücknehmen' : 'Punkt vergeben'}
              title={item.voted ? 'Punkt zurücknehmen' : 'Punkt vergeben'}
            >
              <i /> <span className="mono tabnum">{item.votes}</span>
            </button>
            {item.author && <span className="retro__author">{item.author}</span>}
            <div style={{ flex: 1 }} />
            {kind === 'action' &&
              (item.issueIid ? (
                <span className="chip chip--done">Issue #{item.issueIid}</span>
              ) : (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => run(() => actionToIssueAction(item.id))}
                  disabled={pending}
                  title={data.nextSprint ? `Als Issue in ${data.nextSprint.name} einplanen` : 'Als Issue ins Backlog legen'}
                >
                  <ArrowUpRight size={12} /> {data.nextSprint ? `In ${data.nextSprint.name}` : 'Als Issue'}
                </button>
              ))}
            {item.own && !item.issueIid && (
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--sm"
                onClick={() => run(() => deleteRetroItemAction(item.id))}
                disabled={pending}
                aria-label="Karte löschen"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
