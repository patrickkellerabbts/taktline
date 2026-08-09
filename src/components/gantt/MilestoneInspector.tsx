'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { X, Diamond, Lock, RotateCcw, Trash2, ExternalLink, AlertTriangle, ListChecks } from 'lucide-react';
import {
  createMilestoneAction,
  deleteMilestoneAction,
  updateMilestoneAction,
} from '@/app/projects/[id]/gantt/milestone-actions';
import type { GanttBar } from './GanttView';

export type MilestoneForInspector = {
  id: string;
  gitlabMilestoneId: number;
  title: string;
  description: string | null;
  dueDate: Date | null;
  state: string;
  isGroupMilestone: boolean;
};

type Mode =
  | { kind: 'edit'; milestone: MilestoneForInspector }
  | { kind: 'create'; projectId: string };

type Props = {
  mode: Mode;
  projectInternalId: string;
  gitlabBaseUrl?: string;
  gitlabProjectPath?: string;
  // Alle Bars im Projekt — wird benutzt um Issues anzuzeigen die diesem
  // Meilenstein zugeordnet sind (Filter: milestoneId === ms.id).
  allBars?: GanttBar[];
  // Click-Handler aus dem Parent (GanttView), springt zum WP.
  onJumpToBar?: (id: string) => void;
  onClose: () => void;
  fullWidth?: boolean;
  width?: number;
};

function toInputDate(d: Date | null): string {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function MilestoneInspector({
  mode,
  projectInternalId,
  gitlabBaseUrl,
  gitlabProjectPath,
  allBars = [],
  onJumpToBar,
  onClose,
  fullWidth = false,
  width = 340,
}: Props) {
  const isEdit = mode.kind === 'edit';
  const ms = isEdit ? mode.milestone : null;
  const readonly = ms?.isGroupMilestone ?? false;

  // Issues die diesem Meilenstein zugeordnet sind: nur offen, nur mit
  // Assignee. Sortiert nach Fälligkeit aufsteigend.
  const linkedOpenWps = ms
    ? allBars
        .filter(
          (b) =>
            b.milestoneId === ms.id &&
            b.state !== 'closed' &&
            !b.isSummary &&
            (b.assignees?.length ?? 0) > 0,
        )
        .sort((a, b) => a.end.getTime() - b.end.getTime())
    : [];

  const [title, setTitle] = useState(ms?.title ?? '');
  const [description, setDescription] = useState(ms?.description ?? '');
  const [dueDate, setDueDate] = useState(toInputDate(ms?.dueDate ?? null));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const router = useRouter();

  // Reset wenn ein anderer Meilenstein selektiert wird. setState-in-effect
  // ist hier beabsichtigt (Sync mit externer prop-Identität).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!ms) return;
    setTitle(ms.title);
    setDescription(ms.description ?? '');
    setDueDate(toInputDate(ms.dueDate));
    setError(null);
    setConfirmingDelete(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur bei Identitätswechsel resetten
  }, [ms?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function save() {
    setError(null);
    startTransition(async () => {
      if (mode.kind === 'create') {
        const result = await createMilestoneAction(projectInternalId, {
          title: title.trim(),
          description: description.trim() || undefined,
          dueDate: dueDate || null,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onClose();
        router.refresh();
      } else {
        const result = await updateMilestoneAction(mode.milestone.id, {
          title: title.trim(),
          description: description.trim(),
          dueDate: dueDate || null,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
      }
    });
  }

  function toggleState() {
    if (!isEdit || readonly) return;
    const newState = ms!.state === 'closed' ? 'active' : 'closed';
    startTransition(async () => {
      const result = await updateMilestoneAction(ms!.id, { state: newState, title: ms!.title });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function doDelete() {
    if (!isEdit || readonly) return;
    startTransition(async () => {
      const result = await deleteMilestoneAction(ms!.id);
      if (!result.ok) {
        setError(result.error);
        setConfirmingDelete(false);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  const gitlabLink =
    isEdit && gitlabBaseUrl && gitlabProjectPath
      ? `${gitlabBaseUrl.replace(/\/$/, '')}/${gitlabProjectPath}/-/milestones/${ms!.gitlabMilestoneId}`
      : null;

  return (
    <aside
      style={{
        width: fullWidth ? '100%' : width,
        height: fullWidth ? '100%' : undefined,
        flexShrink: 0,
        background: 'var(--color-surface)',
        borderLeft: fullWidth ? 'none' : '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface-2)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Diamond size={13} style={{ color: 'var(--color-status-milestone)' }} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--color-ink-2)',
          }}
        >
          {isEdit ? 'Meilenstein' : 'Neuer Meilenstein'}
        </span>
        {ms?.state === 'closed' && (
          <span className="chip" style={{ background: 'var(--color-surface-3)', fontSize: 10 }}>
            geschlossen
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Schließen"
          style={{
            border: 'none',
            background: 'transparent',
            padding: 4,
            cursor: 'pointer',
            color: 'var(--color-ink-3)',
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {readonly && (
          <div
            style={{
              padding: 10,
              background: 'var(--color-accent-soft)',
              border: '1px solid #f5cba0',
              borderRadius: 'var(--r-3)',
              fontSize: 11,
              color: 'var(--color-accent-h)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Group-Meilenstein — bearbeite ihn direkt in GitLab im Gruppen-Scope.
            </span>
          </div>
        )}

        <Field label="Titel">
          <input
            type="text"
            className="input"
            value={title}
            disabled={readonly || pending}
            onChange={(e) => setTitle(e.target.value)}
            style={{ width: '100%', fontSize: 14, fontWeight: 600 }}
          />
        </Field>

        <Field label="Beschreibung">
          <textarea
            className="input"
            value={description}
            disabled={readonly || pending}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            style={{ width: '100%', fontSize: 12, fontFamily: 'inherit', resize: 'vertical' }}
          />
        </Field>

        <Field label="Fälligkeit">
          <input
            type="date"
            className="input"
            value={dueDate}
            disabled={readonly || pending}
            onChange={(e) => setDueDate(e.target.value)}
            style={{ width: '100%', fontSize: 12 }}
          />
        </Field>

        {isEdit && !readonly && (
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button
              type="button"
              className="btn btn--sm"
              disabled={pending}
              onClick={toggleState}
              title={ms!.state === 'closed' ? 'Wieder öffnen' : 'Schließen'}
            >
              {ms!.state === 'closed' ? (
                <>
                  <RotateCcw size={12} />
                  Wieder öffnen
                </>
              ) : (
                <>
                  <Lock size={12} />
                  Schließen
                </>
              )}
            </button>
          </div>
        )}

        {/* Verlinkte offene Issues (state=opened + min. 1 Assignee).
            Zeigt was aktuell an diesem Meilenstein in Bearbeitung ist. */}
        {isEdit && (
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--color-ink-3)',
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              <ListChecks size={11} />
              Offene Aufgaben
              <span className="mono tabnum" style={{ color: 'var(--color-ink-2)' }}>
                {linkedOpenWps.length}
              </span>
            </div>
            {linkedOpenWps.length === 0 ? (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--color-ink-3)',
                  fontStyle: 'italic',
                  padding: '6px 0',
                }}
              >
                Keine offenen Issues mit Assignee zugeordnet
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  maxHeight: 200,
                  overflowY: 'auto',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--r-2)',
                }}
              >
                {linkedOpenWps.map((wp) => (
                  <button
                    key={wp.id}
                    type="button"
                    onClick={() => onJumpToBar?.(wp.id)}
                    className="bell-row"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 8px',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'inherit',
                      fontSize: 11,
                      color: 'var(--color-ink)',
                      width: '100%',
                    }}
                  >
                    <span
                      className="dot dot--open"
                      style={{ flexShrink: 0 }}
                    />
                    <span
                      className="mono"
                      style={{ color: 'var(--color-ink-3)', fontSize: 10, flexShrink: 0 }}
                    >
                      #{wp.gitlabIssueIid}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {wp.text}
                    </span>
                    {wp.assignees && wp.assignees.length > 0 && (
                      <span
                        className="mono"
                        style={{
                          color: 'var(--color-ink-3)',
                          fontSize: 10,
                          flexShrink: 0,
                        }}
                      >
                        {wp.assignees
                          .map((a) =>
                            a.name
                              .split(' ')
                              .map((p) => p[0])
                              .slice(0, 2)
                              .join('')
                              .toUpperCase(),
                          )
                          .join('·')}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {gitlabLink && (
          <a
            href={gitlabLink}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              color: 'var(--color-ink-3)',
              textDecoration: 'none',
              marginTop: 4,
            }}
          >
            In GitLab öffnen <ExternalLink size={11} />
          </a>
        )}

        {error && (
          <div
            role="alert"
            style={{
              padding: 10,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 'var(--r-3)',
              fontSize: 12,
              color: 'var(--color-status-blocked)',
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Footer-Actions */}
      <div
        style={{
          padding: 12,
          borderTop: '1px solid var(--color-border)',
          display: 'flex',
          gap: 6,
          background: 'var(--color-surface-2)',
        }}
      >
        {isEdit && !readonly && !confirmingDelete && (
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setConfirmingDelete(true)}
            disabled={pending}
            style={{ color: 'var(--color-status-blocked)' }}
            title="Meilenstein löschen"
          >
            <Trash2 size={12} />
            Löschen
          </button>
        )}
        {isEdit && !readonly && confirmingDelete && (
          <>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setConfirmingDelete(false)}
              disabled={pending}
            >
              Abbrechen
            </button>
            <button
              type="button"
              className="btn btn--sm"
              onClick={doDelete}
              disabled={pending}
              style={{
                background: 'var(--color-status-blocked)',
                color: 'white',
                borderColor: 'var(--color-status-blocked)',
              }}
            >
              Wirklich löschen
            </button>
          </>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn--sm" onClick={onClose} disabled={pending}>
          {isEdit ? 'Schließen' : 'Abbrechen'}
        </button>
        {!readonly && (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={save}
            disabled={pending || !title.trim()}
          >
            {pending ? '…' : isEdit ? 'Speichern' : 'Anlegen'}
          </button>
        )}
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--color-ink-3)',
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
