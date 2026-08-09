'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { X, Trash2, ExternalLink } from 'lucide-react';
import {
  updateRiskAction,
  deleteRiskAction,
  setRiskLinkedWorkPackagesAction,
  setRiskLinkedMilestonesAction,
  type RiskStatus,
} from '@/app/projects/[id]/risks/actions';
import type { Risk, RiskLinkedWp, RiskLinkedMs, RiskOwner } from './RiskMatrixView';

type Props = {
  risk: Risk;
  projectId: string;
  workPackages: RiskLinkedWp[];
  milestones: RiskLinkedMs[];
  allOwners: RiskOwner[];
  onClose: () => void;
};

const STATUS_OPTIONS: Array<{ value: RiskStatus; label: string }> = [
  { value: 'identified', label: 'Identifiziert' },
  { value: 'in_progress', label: 'In Arbeit' },
  { value: 'mitigated', label: 'Gemindert' },
  { value: 'accepted', label: 'Akzeptiert' },
  { value: 'occurred', label: 'Eingetreten' },
  { value: 'closed', label: 'Geschlossen' },
];

export function RiskInspector({
  risk,
  projectId,
  workPackages,
  milestones,
  allOwners,
  onClose,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  function patch(p: Parameters<typeof updateRiskAction>[1]) {
    startTransition(async () => {
      await updateRiskAction(risk.id, p);
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      await deleteRiskAction(risk.id);
      onClose();
      router.refresh();
    });
  }

  function toggleWp(wpId: string) {
    const linked = new Set(risk.linkedWorkPackages.map((w) => w.id));
    if (linked.has(wpId)) linked.delete(wpId);
    else linked.add(wpId);
    startTransition(async () => {
      await setRiskLinkedWorkPackagesAction(risk.id, [...linked]);
      router.refresh();
    });
  }

  function toggleMs(msId: string) {
    const linked = new Set(risk.linkedMilestones.map((m) => m.id));
    if (linked.has(msId)) linked.delete(msId);
    else linked.add(msId);
    startTransition(async () => {
      await setRiskLinkedMilestonesAction(risk.id, [...linked]);
      router.refresh();
    });
  }

  const scorePre = risk.probabilityPre * risk.impactPre;
  const scorePost =
    risk.probabilityPost != null && risk.impactPost != null
      ? risk.probabilityPost * risk.impactPost
      : null;

  return (
    <aside
      style={{
        width: 380,
        flexShrink: 0,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--color-ink-3)',
          }}
        >
          Risiko-Details
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Schliessen"
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--color-ink-3)',
            cursor: 'pointer',
            padding: 2,
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {/* Titel */}
        <div>
          <div className="label">Titel</div>
          <input
            className="input"
            type="text"
            defaultValue={risk.title}
            onBlur={(e) => {
              if (e.target.value.trim() !== risk.title)
                patch({ title: e.target.value });
            }}
            style={{ width: '100%', fontSize: 14, fontWeight: 600 }}
          />
        </div>

        {/* Status */}
        <div>
          <div className="label">Status</div>
          <select
            className="input"
            value={risk.status}
            onChange={(e) => patch({ status: e.target.value as RiskStatus })}
            style={{ width: '100%', fontSize: 12 }}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Beschreibung */}
        <div>
          <div className="label">Beschreibung</div>
          <textarea
            className="input"
            defaultValue={risk.description ?? ''}
            onBlur={(e) => {
              if ((e.target.value || null) !== (risk.description ?? null))
                patch({ description: e.target.value || null });
            }}
            rows={3}
            style={{ width: '100%', fontSize: 12, fontFamily: 'inherit', resize: 'vertical' }}
          />
        </div>

        {/* Kategorie */}
        <div>
          <div className="label">Kategorie</div>
          <input
            className="input"
            type="text"
            defaultValue={risk.category ?? ''}
            onBlur={(e) => {
              if ((e.target.value || null) !== (risk.category ?? null))
                patch({ category: e.target.value || null });
            }}
            style={{ width: '100%', fontSize: 12 }}
          />
        </div>

        {/* Pre/Post-Scores */}
        <div>
          <div className="label">Pre-Mitigation</div>
          <ScoreSliders
            probability={risk.probabilityPre}
            impact={risk.impactPre}
            onChange={(p, i) => patch({ probabilityPre: p, impactPre: i })}
            score={scorePre}
          />
        </div>

        <div>
          <div className="label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>Post-Mitigation</span>
            {scorePost !== null && (
              <button
                type="button"
                onClick={() => patch({ probabilityPost: null, impactPost: null })}
                style={{
                  fontSize: 9,
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--color-ink-3)',
                  cursor: 'pointer',
                  textTransform: 'lowercase',
                }}
              >
                löschen
              </button>
            )}
          </div>
          {scorePost === null ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() =>
                patch({
                  probabilityPost: risk.probabilityPre,
                  impactPost: risk.impactPre,
                })
              }
              style={{ width: '100%', justifyContent: 'center' }}
            >
              Post-Mitigation hinzufügen
            </button>
          ) : (
            <ScoreSliders
              probability={risk.probabilityPost!}
              impact={risk.impactPost!}
              onChange={(p, i) => patch({ probabilityPost: p, impactPost: i })}
              score={scorePost}
            />
          )}
        </div>

        {/* Mitigation-Plan */}
        <div>
          <div className="label">Mitigation-Plan</div>
          <textarea
            className="input"
            defaultValue={risk.mitigationPlan ?? ''}
            onBlur={(e) => {
              if ((e.target.value || null) !== (risk.mitigationPlan ?? null))
                patch({ mitigationPlan: e.target.value || null });
            }}
            rows={3}
            placeholder="Was wird unternommen um das Risiko zu reduzieren?"
            style={{ width: '100%', fontSize: 12, fontFamily: 'inherit', resize: 'vertical' }}
          />
        </div>

        {/* Kontingenz-Plan */}
        <div>
          <div className="label">Kontingenz-Plan</div>
          <textarea
            className="input"
            defaultValue={risk.contingencyPlan ?? ''}
            onBlur={(e) => {
              if ((e.target.value || null) !== (risk.contingencyPlan ?? null))
                patch({ contingencyPlan: e.target.value || null });
            }}
            rows={2}
            placeholder="Was wenn das Risiko trotzdem eintritt?"
            style={{ width: '100%', fontSize: 12, fontFamily: 'inherit', resize: 'vertical' }}
          />
        </div>

        {/* Owner */}
        <div>
          <div className="label">Owner</div>
          <select
            className="input"
            value={risk.owner?.id ?? ''}
            onChange={(e) => patch({ ownerUserId: e.target.value || null })}
            style={{ width: '100%', fontSize: 12 }}
          >
            <option value="">— kein Owner —</option>
            {allOwners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name ?? o.username ?? '?'}
                {o.username ? ` (@${o.username})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Linked WorkPackages */}
        <div>
          <div className="label">Verlinkte Aufgaben</div>
          {risk.linkedWorkPackages.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
              {risk.linkedWorkPackages.map((wp) => (
                <Link
                  key={wp.id}
                  href={`/projects/${projectId}/gantt?wp=${wp.id}`}
                  style={{
                    fontSize: 11,
                    color: 'var(--color-accent-h)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 6px',
                    border: '1px solid var(--color-border)',
                    borderRadius: 3,
                    textDecoration: 'none',
                    background: 'var(--color-surface-2)',
                  }}
                >
                  <span className="mono" style={{ color: 'var(--color-ink-3)' }}>
                    #{wp.iid}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: 'var(--color-ink)',
                    }}
                  >
                    {wp.title}
                  </span>
                  <ExternalLink size={10} />
                </Link>
              ))}
            </div>
          )}
          <details>
            <summary style={{ fontSize: 11, color: 'var(--color-ink-3)', cursor: 'pointer' }}>
              Zuordnung bearbeiten
            </summary>
            <div
              style={{
                marginTop: 4,
                maxHeight: 180,
                overflow: 'auto',
                border: '1px solid var(--color-border)',
                borderRadius: 4,
                padding: 4,
              }}
            >
              {workPackages.map((wp) => {
                const checked = risk.linkedWorkPackages.some((w) => w.id === wp.id);
                return (
                  <label
                    key={wp.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '3px 4px',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleWp(wp.id)}
                    />
                    <span className="mono" style={{ color: 'var(--color-ink-3)' }}>
                      #{wp.iid}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {wp.title}
                    </span>
                  </label>
                );
              })}
            </div>
          </details>
        </div>

        {/* Linked Milestones */}
        <div>
          <div className="label">Verlinkte Meilensteine</div>
          {risk.linkedMilestones.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
              {risk.linkedMilestones.map((ms) => (
                <Link
                  key={ms.id}
                  href={`/projects/${projectId}/gantt?ms=${ms.id}`}
                  style={{
                    fontSize: 11,
                    color: 'var(--color-accent-h)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 6px',
                    border: '1px solid var(--color-border)',
                    borderRadius: 3,
                    textDecoration: 'none',
                    background: 'var(--color-surface-2)',
                  }}
                >
                  <span className="mono" style={{ color: 'var(--color-ink-3)' }}>
                    %{ms.gitlabId}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: 'var(--color-ink)',
                    }}
                  >
                    {ms.title}
                  </span>
                  <ExternalLink size={10} />
                </Link>
              ))}
            </div>
          )}
          <details>
            <summary style={{ fontSize: 11, color: 'var(--color-ink-3)', cursor: 'pointer' }}>
              Zuordnung bearbeiten
            </summary>
            <div
              style={{
                marginTop: 4,
                maxHeight: 180,
                overflow: 'auto',
                border: '1px solid var(--color-border)',
                borderRadius: 4,
                padding: 4,
              }}
            >
              {milestones.map((ms) => {
                const checked = risk.linkedMilestones.some((m) => m.id === ms.id);
                return (
                  <label
                    key={ms.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '3px 4px',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleMs(ms.id)}
                    />
                    <span className="mono" style={{ color: 'var(--color-ink-3)' }}>
                      %{ms.gitlabId}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {ms.title}
                    </span>
                  </label>
                );
              })}
            </div>
          </details>
        </div>

        {/* Identifiziert */}
        <div style={{ fontSize: 10, color: 'var(--color-ink-3)' }}>
          Identifiziert: {new Date(risk.identifiedAt).toLocaleDateString('de-DE')}
          {risk.closedAt && (
            <> · Geschlossen: {new Date(risk.closedAt).toLocaleDateString('de-DE')}</>
          )}
        </div>

        {/* Delete */}
        {!confirmDelete ? (
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setConfirmDelete(true)}
            style={{ color: 'var(--color-status-blocked)', marginTop: 8 }}
          >
            <Trash2 size={11} />
            Risiko löschen
          </button>
        ) : (
          <div
            style={{
              padding: 8,
              background: 'var(--color-surface-2)',
              borderRadius: 4,
              fontSize: 11,
            }}
          >
            <div style={{ marginBottom: 6 }}>Wirklich löschen?</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setConfirmDelete(false)}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={remove}
                style={{ color: 'var(--color-status-blocked)' }}
              >
                Löschen
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function ScoreSliders({
  probability,
  impact,
  onChange,
  score,
}: {
  probability: number;
  impact: number;
  onChange: (p: number, i: number) => void;
  score: number;
}) {
  return (
    <div
      style={{
        padding: 8,
        background: 'var(--color-surface-2)',
        borderRadius: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div>
        <div style={{ fontSize: 10, color: 'var(--color-ink-3)' }}>
          Wahrscheinlichkeit: <span className="mono">{probability}</span>
        </div>
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={probability}
          onChange={(e) => onChange(Number(e.target.value), impact)}
          style={{ width: '100%' }}
        />
      </div>
      <div>
        <div style={{ fontSize: 10, color: 'var(--color-ink-3)' }}>
          Schadensausmaß: <span className="mono">{impact}</span>
        </div>
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={impact}
          onChange={(e) => onChange(probability, Number(e.target.value))}
        />
      </div>
      <div
        style={{
          fontSize: 10,
          color: 'var(--color-ink-3)',
          textAlign: 'right',
          marginTop: 2,
        }}
      >
        Score: <strong style={{ color: 'var(--color-ink)' }}>{score}</strong>
      </div>
    </div>
  );
}
