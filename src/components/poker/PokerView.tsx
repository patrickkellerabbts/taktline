'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Eye, RotateCcw, Sparkles, Users } from 'lucide-react';
import {
  ADOPTABLE_POINTS,
  POKER_DECK,
  pokerCard,
  type PokerCardValue,
  type PokerRoundView,
  type PokerState,
  type PokerStorySummary,
} from '@/lib/agile/poker';
import {
  adoptEstimateAction,
  castVoteAction,
  newRoundAction,
  revealAction,
  withdrawVoteAction,
} from '@/app/projects/[id]/poker/actions';
import { PokerCard } from './PokerCard';

const POLL_MS = 2000;

type Props = {
  projectId: string;
  initialState: PokerState;
  initialStoryId: string | null;
};

function formatPoints(n: number | null): string {
  if (n === null) return '–';
  if (n === 0.5) return '½';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function PokerView({ projectId, initialState, initialStoryId }: Props) {
  const [state, setState] = useState(initialState);
  const [storyId, setStoryId] = useState<string | null>(
    initialStoryId ?? initialState.selected?.id ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Optimistisch: Die eigene Karte springt sofort auf den Tisch, nicht erst
  // beim nächsten Abruf.
  const [optimisticVote, setOptimisticVote] = useState<PokerCardValue | null | undefined>(undefined);
  // Für den Abruf im Intervall; wird beim Wechseln der Story im Handler gesetzt.
  const storyRef = useRef(storyId);

  const refresh = useCallback(async () => {
    const id = storyRef.current;
    const url = `/api/projects/${projectId}/poker${id ? `?story=${encodeURIComponent(id)}` : ''}`;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const next = (await res.json()) as PokerState;
      // Eine Antwort für eine inzwischen abgewählte Story verwerfen.
      if (storyRef.current !== id) return;
      setState(next);
      setOptimisticVote(undefined);
    } catch {
      // Netzwerk kurz weg: Der nächste Abruf holt es nach.
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh, storyId]);

  function selectStory(id: string) {
    storyRef.current = id;
    setStoryId(id);
    setOptimisticVote(undefined);
    setError(null);
    const url = new URL(window.location.href);
    url.searchParams.set('story', id);
    window.history.replaceState(null, '', url);
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? 'Das hat nicht geklappt');
        setOptimisticVote(undefined);
      }
      await refresh();
    });
  }

  const selected = state.selected && state.selected.id === storyId ? state.selected : null;
  const round = selected?.round ?? null;
  const revealed = round?.revealed ?? false;
  const myVote = optimisticVote !== undefined ? optimisticVote : (round?.myVote ?? null);

  function play(value: PokerCardValue) {
    if (!selected || revealed) return;
    if (myVote === value) {
      setOptimisticVote(null);
      run(() => withdrawVoteAction(projectId, selected.id));
    } else {
      setOptimisticVote(value);
      run(() => castVoteAction(projectId, selected.id, value));
    }
  }

  const toEstimate = state.stories.filter((s) => s.storyPoints === null);
  const estimated = state.stories.filter((s) => s.storyPoints !== null);
  const nextStory = toEstimate.find((s) => s.id !== storyId) ?? null;

  return (
    <div className="poker">
      <aside className="poker__list" aria-label="User Stories">
        <StoryGroup title="Zu schätzen" stories={toEstimate} selectedId={storyId} onSelect={selectStory} />
        <StoryGroup title="Schon geschätzt" stories={estimated} selectedId={storyId} onSelect={selectStory} />
        {state.stories.length === 0 && (
          <p className="poker__muted">
            Keine offenen User Stories. Lege auf dem <Link href={`/projects/${projectId}/board`}>Board</Link> welche an.
          </p>
        )}
      </aside>

      <section className="poker__main">
        {!selected ? (
          <div className="poker__intro">
            <div className="poker__intro-fan" aria-hidden="true">
              {(['3', '8', 'coffee', '13', '5'] as PokerCardValue[]).map((v) => (
                <PokerCard key={v} value={v} size="table" />
              ))}
            </div>
            <h2>Planning Poker</h2>
            <p>
              Wähle links eine User Story. Jede Person legt verdeckt eine Karte, auch zu verschiedenen Zeiten. Wenn
              genug Karten liegen, deckt jemand auf. Die höchste und die niedrigste Karte erklären kurz, dann wird
              übernommen oder neu geschätzt.
            </p>
          </div>
        ) : (
          <>
            <header className="poker__story">
              <div className="poker__story-hd">
                <span className="mono poker__muted">#{selected.iid}</span>
                <h2 className="poker__story-title">{selected.title}</h2>
                {selected.storyPoints !== null && (
                  <span className="chip chip--accent">{selected.storyPoints} SP</span>
                )}
                <div style={{ flex: 1 }} />
                <Link className="btn btn--ghost btn--sm" href={`/projects/${projectId}/board?story=${selected.id}`}>
                  Im Board öffnen
                </Link>
              </div>
              {selected.role && selected.goal && (
                <p className="poker__story-text">
                  <b>Als</b> {selected.role} <b>möchte ich</b> {selected.goal}
                  {selected.benefit && (
                    <>
                      , <b>damit</b> {selected.benefit}
                    </>
                  )}
                  .
                </p>
              )}
              {selected.criteria.length > 0 && (
                <ul className="poker__criteria">
                  {selected.criteria.map((c, i) => (
                    <li key={i} data-done={c.done ? '' : undefined}>
                      {c.text}
                    </li>
                  ))}
                </ul>
              )}
              {!selected.role && !selected.criteria.length && selected.notes && (
                <p className="poker__story-text">{selected.notes}</p>
              )}
            </header>

            <div className="poker__table" data-revealed={revealed ? '' : undefined}>
              <div className="poker__round-label">
                {round ? `Runde ${round.number}` : 'Noch keine Karte gelegt'}
                {selected.history.length > 0 && (
                  <span className="poker__history">
                    {selected.history.map((h) => (
                      <span key={h.number} title={`Runde ${h.number}`}>
                        R{h.number}: {h.values.map((v) => pokerCard(v).face).join(' · ') || '–'}
                      </span>
                    ))}
                  </span>
                )}
              </div>

              <Seats round={round} revealed={revealed} />

              <TableCenter
                round={round}
                revealed={revealed}
                pending={pending}
                storyPoints={selected.storyPoints}
                onReveal={() => run(() => revealAction(projectId, selected.id))}
                onNewRound={() => {
                  setOptimisticVote(undefined);
                  run(() => newRoundAction(projectId, selected.id));
                }}
                onAdopt={(points) => run(() => adoptEstimateAction(projectId, selected.id, points))}
                nextStory={nextStory}
                onNext={() => nextStory && selectStory(nextStory.id)}
              />
              {error && (
                <div role="alert" className="poker__error">
                  {error}
                </div>
              )}
            </div>

            <Hand myVote={myVote} disabled={revealed || pending} onPlay={play} revealed={revealed} />
          </>
        )}
      </section>
    </div>
  );
}

function StoryGroup({
  title,
  stories,
  selectedId,
  onSelect,
}: {
  title: string;
  stories: PokerStorySummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (stories.length === 0) return null;
  return (
    <div className="poker__group">
      <div className="poker__group-title">
        {title} <span className="mono tabnum">{stories.length}</span>
      </div>
      {stories.map((s) => (
        <button
          key={s.id}
          type="button"
          className="poker__item"
          aria-current={s.id === selectedId ? 'true' : undefined}
          onClick={() => onSelect(s.id)}
        >
          <span className="poker__item-title">
            <span className="mono poker__muted">#{s.iid}</span> {s.title}
          </span>
          <span className="poker__item-meta">
            {s.sprintNumber !== null && <span className="chip">Sprint {s.sprintNumber}</span>}
            {s.round && !s.round.revealed && s.round.votes > 0 && (
              <span className="chip" title={s.round.myVote ? 'Du hast schon gelegt' : 'Du hast noch nicht gelegt'}>
                {s.round.votes} {s.round.votes === 1 ? 'Karte' : 'Karten'}
                {s.round.myVote ? ' ✓' : ''}
              </span>
            )}
            {s.round?.revealed && !s.round.adopted && <span className="chip chip--accent">aufgedeckt</span>}
            {s.storyPoints !== null && <span className="poker__points mono">{s.storyPoints}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

function Seats({
  round,
  revealed,
}: {
  round: PokerRoundView | null;
  revealed: boolean;
}) {
  const seats = round?.seats ?? [];
  const stats = round?.stats ?? null;
  const spread = stats && stats.min !== null && stats.max !== null && stats.min !== stats.max;
  if (seats.length === 0) {
    return (
      <div className="poker__seats">
        <div className="poker__empty-seat">Lege unten die erste Karte.</div>
      </div>
    );
  }
  let flipIndex = 0;
  return (
    <div className="poker__seats">
      {seats.map((seat) => {
        const points = seat.value ? pokerCard(seat.value).points : null;
        const highlight =
          revealed && spread && points !== null
            ? points === stats.min
              ? 'min'
              : points === stats.max
                ? 'max'
                : null
            : null;
        return (
          <div key={seat.userId} className="poker__seat" data-absent={seat.present ? undefined : ''}>
            {seat.voted ? (
              <PokerCard
                value={seat.value}
                faceDown={!revealed}
                highlight={highlight}
                flipDelayMs={revealed ? flipIndex++ * 110 : 0}
              />
            ) : (
              <div className="poker__slot" aria-label="Noch keine Karte">
                <span>denkt…</span>
              </div>
            )}
            <div className="poker__seat-name">
              <span className="poker__avatar" aria-hidden="true">
                {initials(seat.name)}
              </span>
              <span>{seat.name}</span>
              {seat.present && <span className="poker__online" title="Gerade dabei" />}
            </div>
            {highlight && (
              <div className="poker__seat-note">{highlight === 'min' ? 'niedrigste – erklär kurz' : 'höchste – erklär kurz'}</div>
            )}
            {!revealed && seat.value && <div className="poker__seat-note">deine Karte</div>}
          </div>
        );
      })}
    </div>
  );
}

function TableCenter({
  round,
  revealed,
  pending,
  storyPoints,
  onReveal,
  onNewRound,
  onAdopt,
  nextStory,
  onNext,
}: {
  round: PokerRoundView | null;
  revealed: boolean;
  pending: boolean;
  storyPoints: number | null;
  onReveal: () => void;
  onNewRound: () => void;
  onAdopt: (points: number) => void;
  nextStory: PokerStorySummary | null;
  onNext: () => void;
}) {
  const [custom, setCustom] = useState(false);
  const voted = round?.seats.filter((s) => s.voted).length ?? 0;
  const waiting = round?.seats.filter((s) => !s.voted).length ?? 0;

  if (!revealed) {
    return (
      <div className="poker__center">
        <div className="poker__count">
          <Users size={14} />
          {voted === 0 ? 'Noch keine Karte' : `${voted} ${voted === 1 ? 'Karte liegt' : 'Karten liegen'}`}
          {waiting > 0 && <span className="poker__muted-dark"> · {waiting} am Überlegen</span>}
        </div>
        <button type="button" className="btn btn--primary poker__reveal" onClick={onReveal} disabled={voted === 0 || pending}>
          <Eye size={14} />
          Aufdecken
        </button>
        <div className="poker__hint">Aufdecken darf jede Person, sobald genug Karten liegen.</div>
      </div>
    );
  }

  const stats = round?.stats;
  const adopted = round?.result ?? null;
  return (
    <div className="poker__center">
      {stats && stats.consensus && (
        <div className="poker__consensus" role="status">
          <Sparkles size={16} /> Einigkeit! Alle sagen {formatPoints(stats.min)}.
        </div>
      )}
      {stats && (
        <div className="poker__stats">
          <Stat label="Tiefste" value={formatPoints(stats.min)} />
          <Stat label="Median" value={formatPoints(stats.median)} />
          <Stat label="Schnitt" value={stats.average === null ? '–' : stats.average.toFixed(1).replace(/\.0$/, '')} />
          <Stat label="Höchste" value={formatPoints(stats.max)} />
          {(stats.questionMarks > 0 || stats.coffee > 0) && (
            <Stat label="? / ☕" value={`${stats.questionMarks} / ${stats.coffee}`} />
          )}
        </div>
      )}

      {adopted !== null ? (
        <div className="poker__adopted">
          <Check size={16} /> {adopted} Story Points übernommen
          {nextStory && (
            <button type="button" className="btn btn--primary btn--sm" onClick={onNext}>
              Nächste Story <ArrowRight size={12} />
            </button>
          )}
        </div>
      ) : (
        <div className="poker__actions">
          {stats?.suggestion !== null && stats?.suggestion !== undefined && (
            <button type="button" className="btn btn--primary" onClick={() => onAdopt(stats.suggestion as number)} disabled={pending}>
              <Check size={14} />
              {stats.suggestion} SP übernehmen
            </button>
          )}
          <button type="button" className="btn" onClick={() => setCustom((c) => !c)} disabled={pending}>
            Anderer Wert
          </button>
          <button type="button" className="btn" onClick={onNewRound} disabled={pending}>
            <RotateCcw size={14} />
            Neu schätzen
          </button>
        </div>
      )}
      {custom && adopted === null && (
        <div className="poker__custom" role="group" aria-label="Story Points wählen">
          {ADOPTABLE_POINTS.map((p) => (
            <button key={p} type="button" className="btn btn--sm mono" onClick={() => onAdopt(p)} disabled={pending}>
              {p}
            </button>
          ))}
        </div>
      )}
      {adopted !== null && (
        <button type="button" className="btn btn--ghost btn--sm poker__again" onClick={onNewRound} disabled={pending}>
          <RotateCcw size={12} /> Nochmals schätzen
        </button>
      )}
      {adopted === null && storyPoints !== null && (
        <div className="poker__hint">Bisher {storyPoints} SP. Übernehmen überschreibt den Wert.</div>
      )}
      {stats && stats.suggestion !== null && stats.median !== null && stats.median !== stats.suggestion && (
        <div className="poker__hint">
          Vorschlag ist der Median ({formatPoints(stats.median)}), gerundet auf den nächsten Kartenwert.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="poker__stat">
      <span className="poker__stat-value mono">{value}</span>
      <span className="poker__stat-label">{label}</span>
    </div>
  );
}

function Hand({
  myVote,
  disabled,
  revealed,
  onPlay,
}: {
  myVote: PokerCardValue | null;
  disabled: boolean;
  revealed: boolean;
  onPlay: (value: PokerCardValue) => void;
}) {
  const mid = (POKER_DECK.length - 1) / 2;
  const hint = useMemo(() => {
    if (revealed) return 'Aufgedeckt. Für eine neue Schätzung „Neu schätzen“ wählen.';
    if (myVote) return 'Karte liegt verdeckt. Andere Karte wählen zum Ändern, dieselbe nochmals zum Zurückziehen.';
    return 'Wähle deine Karte. Niemand sieht sie, bis aufgedeckt wird.';
  }, [revealed, myVote]);
  return (
    <div className="poker__hand-wrap">
      <div className="poker__hand-hint">{hint}</div>
      <div className="poker__hand" role="group" aria-label="Deine Karten">
        {POKER_DECK.map((card, i) => {
          const offset = i - mid;
          return (
            <button
              key={card.value}
              type="button"
              className="poker__hand-card"
              style={{ '--fan-rot': `${offset * 3.2}deg`, '--fan-y': `${Math.abs(offset) ** 1.6 * 1.6}px` } as React.CSSProperties}
              aria-pressed={myVote === card.value}
              aria-label={`${card.face} – ${card.caption}`}
              disabled={disabled}
              onClick={() => onPlay(card.value)}
            >
              <PokerCard value={card.value} size="hand" selected={myVote === card.value} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
