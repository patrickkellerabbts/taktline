'use client';

import { useState, useTransition, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  X,
  ExternalLink,
  CircleCheck,
  AlertTriangle,
  Link as LinkIcon,
  MousePointerClick,
  RotateCcw,
  Lock,
  Plus,
  GitCompareArrows,
  GitMerge,
  GitPullRequestClosed,
  CheckCircle2,
  XCircle,
  PlayCircle,
  CircleDashed,
  MessageSquare,
  Send,
} from 'lucide-react';
import {
  updateWorkPackageAction,
  type WorkPackagePatch,
  type DependencySpec,
  type DependencyType,
} from '@/app/projects/[id]/gantt/actions';
import type { GanttBar, GanttDependency, GanttLabel, GanttMergeRequest } from './GanttView';
import {
  refreshWorkPackageMrsAction,
  refreshProjectLabelsAction,
  getIssueNotesAction,
  addIssueNoteAction,
  type IssueNote,
} from '@/app/projects/[id]/gantt/inspector-actions';
import { avatarColor, initials } from './AssigneeAvatars';

// Sub-Set des DependencyConflict-Types aus dependency-validation.ts.
// Inline definiert damit der Inspector nicht den ganzen Lib-Type importieren muss.
export type InspectorConflict = {
  dependencyId: string;
  predecessorId: string;
  type: 'FS' | 'SS' | 'FF' | 'SF';
  lagDays: number;
  successorField: 'start' | 'end';
  expectedDate: Date;
  actualDate: Date;
  daysOverlap: number;
};

type Props = {
  task: GanttBar | null;
  allBars: GanttBar[];
  dependencies?: GanttDependency[];
  // Dependency-Konflikte die den aktuell ausgewählten Task betreffen
  // (vorgefiltert vom Parent).
  conflicts?: InspectorConflict[];
  knownAssignees?: { id: number; username: string; name: string }[];
  knownLabels?: { name: string; color?: string }[];
  pickerActive?: boolean;
  onStartPickParent?: (sourceId: string) => void;
  onStartPickDependency?: (sourceId: string, depType: DependencyType) => void;
  width?: number;
  onClose: () => void;
  gitlabBaseUrl?: string;
  gitlabProjectPath?: string;
  // Wenn true, ignoriert das aside seine width-Prop und füllt den Parent
  // (Drawer-Container) komplett aus. Wird im Narrow-Mode (<1200px) genutzt.
  fullWidth?: boolean;
};

function toInputDate(d: Date): string {
  // YYYY-MM-DD für <input type="date">
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function diffDays(a: Date, b: Date): number {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

export function Inspector({
  task,
  allBars,
  dependencies = [],
  conflicts = [],
  knownAssignees = [],
  knownLabels = [],
  pickerActive = false,
  onStartPickParent,
  onStartPickDependency,
  width = 340,
  onClose,
  gitlabBaseUrl,
  gitlabProjectPath,
  fullWidth = false,
}: Props) {
  // Lokaler Form-State, neu initialisiert wenn ein anderer Task gewählt wird.
  const [title, setTitle] = useState(task?.text ?? '');
  const [start, setStart] = useState(task ? toInputDate(task.start) : '');
  const [end, setEnd] = useState(task ? toInputDate(task.end) : '');
  const [progress, setProgress] = useState(task ? Math.round(task.progress * 100) : 0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!task) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTitle(task.text);
    setStart(toInputDate(task.start));
    setEnd(toInputDate(task.end));
    setProgress(Math.round(task.progress * 100));
    setError(null);
  }, [task]);

  if (!task) {
    return (
      <aside
        style={{
          width: fullWidth ? '100%' : width,
          height: fullWidth ? '100%' : undefined,
          flexShrink: 0,
          background: 'var(--color-surface)',
          borderLeft: fullWidth ? 'none' : '1px solid var(--color-border)',
          padding: 24,
          fontSize: 12,
          color: 'var(--color-ink-3)',
        }}
      >
        Keine Aufgabe ausgewählt. Klick auf einen Bar im Gantt.
      </aside>
    );
  }

  const dur = diffDays(new Date(start), new Date(end));
  const isDirty =
    title !== task.text ||
    start !== toInputDate(task.start) ||
    end !== toInputDate(task.end) ||
    progress !== Math.round(task.progress * 100);

  function onSave() {
    if (!task || pending) return;
    setError(null);
    const patch: WorkPackagePatch = {};
    if (title !== task.text) patch.title = title;
    if (start !== toInputDate(task.start)) patch.startDate = start;
    if (end !== toInputDate(task.end)) patch.endDate = end;
    if (progress !== Math.round(task.progress * 100)) patch.progressPercent = progress;
    if (Object.keys(patch).length === 0) return;
    startTransition(async () => {
      const result = await updateWorkPackageAction(task.id, patch);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function onReset() {
    if (!task) return;
    setTitle(task.text);
    setStart(toInputDate(task.start));
    setEnd(toInputDate(task.end));
    setProgress(Math.round(task.progress * 100));
    setError(null);
  }

  const statusChip =
    task.state === 'closed' ? (
      <span className="chip chip--done">
        <CircleCheck size={9} />
        geschlossen
      </span>
    ) : task.isSummary ? (
      <span className="chip chip--summary">summary</span>
    ) : (
      <span className="chip chip--open">offen</span>
    );

  function toggleState() {
    if (!task || task.isSummary) return;
    const newState = task.state === 'closed' ? 'opened' : 'closed';
    startTransition(async () => {
      const res = await updateWorkPackageAction(task.id, { state: newState });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  const gitlabUrl =
    gitlabBaseUrl && gitlabProjectPath
      ? `${gitlabBaseUrl}/${gitlabProjectPath}/-/issues/${task.gitlabIssueIid}`
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
          padding: '12px 14px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface-2)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {statusChip}
        <span className="mono" style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>
          #{task.gitlabIssueIid}
        </span>
        <div style={{ flex: 1 }} />
        {!task.isSummary && (
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            onClick={toggleState}
            disabled={pending}
            title={task.state === 'closed' ? 'Wiedereröffnen' : 'Schließen'}
          >
            {task.state === 'closed' ? <RotateCcw size={12} /> : <Lock size={12} />}
          </button>
        )}
        {gitlabUrl && (
          <a
            href={gitlabUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn--ghost btn--icon btn--sm"
            title="In GitLab öffnen"
          >
            <ExternalLink size={12} />
          </a>
        )}
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          onClick={onClose}
          title="Panel schließen"
        >
          <X size={12} />
        </button>
      </div>

      {/* Body */}
      <div
        className="scroll-host"
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {conflicts.length > 0 && (
          <ConflictBanner conflicts={conflicts} allBars={allBars} />
        )}

        {/* Titel */}
        <div>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ width: '100%', height: 32, fontSize: 14, fontWeight: 600 }}
            disabled={task.isSummary}
          />
        </div>

        {/* Parent / Hierarchie */}
        {!task.isSummary && (
          <ParentSection
            task={task}
            allBars={allBars}
            onStartPick={onStartPickParent}
            pickerActive={pickerActive}
            onChanged={() => router.refresh()}
          />
        )}

        {/* Dependencies — auch auf Summaries (Parents) erlaubt, damit man
            versehentlich gesetzte oder veraltete Deps wieder entfernen kann. */}
        <DependenciesEditor
          task={task}
          allBars={allBars}
          dependencies={dependencies}
          onStartPick={onStartPickDependency}
          pickerActive={pickerActive}
          onChanged={() => router.refresh()}
        />

        {/* Termine */}
        <div>
          <div className="label">Termine</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: '6px 12px',
              fontSize: 12,
              alignItems: 'center',
            }}
          >
            <span style={{ color: 'var(--color-ink-3)' }}>Start</span>
            <input
              type="date"
              className="input mono"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              disabled={task.isSummary}
              style={{ fontSize: 11 }}
            />
            <span style={{ color: 'var(--color-ink-3)' }}>Ende</span>
            <input
              type="date"
              className="input mono"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              disabled={task.isSummary}
              style={{ fontSize: 11 }}
            />
            <span style={{ color: 'var(--color-ink-3)' }}>Dauer</span>
            <span className="mono" style={{ fontSize: 12 }}>
              {dur} Tag{dur === 1 ? '' : 'e'}
            </span>
          </div>
          {new Date(end) < new Date(start) && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--color-status-blocked)',
                marginTop: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <AlertTriangle size={11} />
              Ende liegt vor dem Start.
            </div>
          )}
        </div>

        {/* Fortschritt */}
        {!task.isSummary && (
          <div>
            <div className="label">Fortschritt</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="range"
                min={0}
                max={100}
                value={progress}
                onChange={(e) => setProgress(Number(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--color-accent)' }}
              />
              <span
                className="mono tabnum"
                style={{ fontSize: 12, width: 40, textAlign: 'right' }}
              >
                {progress} %
              </span>
            </div>
          </div>
        )}

        {/* Zuständige */}
        {!task.isSummary && (
          <AssigneesEditor
            task={task}
            knownAssignees={knownAssignees}
            gitlabBaseUrl={gitlabBaseUrl}
            onChanged={() => router.refresh()}
          />
        )}

        {/* Labels */}
        {!task.isSummary && (
          <LabelsEditor
            task={task}
            knownLabels={knownLabels}
            onChanged={() => router.refresh()}
          />
        )}

        {/* Baseline */}
        {!task.isSummary && (
          <BaselineEditor task={task} onChanged={() => router.refresh()} />
        )}

        {/* Merge Requests (aus DB-Cache, Refresh-Button für expliziten Re-Sync) */}
        {!task.isSummary && (
          <MergeRequestsSection
            workPackageId={task.id}
            mrs={task.mergeRequests ?? []}
            onChanged={() => router.refresh()}
          />
        )}

        {/* Kommentare (lazy-loaded aus GitLab) */}
        {!task.isSummary && (
          <CommentsSection
            workPackageId={task.id}
            gitlabBaseUrl={gitlabBaseUrl}
            gitlabProjectPath={gitlabProjectPath}
          />
        )}

        {/* Hinweis-Block */}
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-ink-3)',
            padding: 10,
            background: 'var(--color-surface-3)',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            lineHeight: 1.5,
          }}
        >
          Änderungen werden gespeichert:
          <br />
          • <strong>Titel</strong> + <strong>Ende</strong> direkt in GitLab
          <br />
          • <strong>Start</strong> + <strong>Fortschritt</strong> als
          <code style={{ fontSize: 10, marginLeft: 3 }}>gantt-meta</code>-Block in der
          Description.
        </div>

        {error && (
          <div
            style={{
              padding: 10,
              background: '#fbe9e7',
              border: '1px solid #f4c7c0',
              borderRadius: 4,
              color: '#b42318',
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '10px 14px',
          borderTop: '1px solid var(--color-border)',
          background: 'var(--color-surface-2)',
          display: 'flex',
          gap: 6,
          justifyContent: 'flex-end',
        }}
      >
        <button
          type="button"
          className="btn btn--sm"
          onClick={onReset}
          disabled={!isDirty || pending}
        >
          Zurücksetzen
        </button>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={onSave}
          disabled={!isDirty || pending}
        >
          {pending ? 'Speichere…' : 'Speichern'}
        </button>
      </div>
    </aside>
  );
}

function AssigneesEditor({
  task,
  knownAssignees,
  gitlabBaseUrl,
  onChanged,
}: {
  task: GanttBar;
  knownAssignees: { id: number; username: string; name: string }[];
  gitlabBaseUrl?: string;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [selectId, setSelectId] = useState<string>('');

  const current = task.assignees ?? [];
  const currentIds = new Set(current.map((a) => a.id));
  const candidates = knownAssignees
    .filter((a) => !currentIds.has(a.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

  function commit(ids: number[]) {
    startTransition(async () => {
      const res = await updateWorkPackageAction(task.id, { assigneeIds: ids });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setShowAdd(false);
      setSelectId('');
      onChanged();
    });
  }

  function onRemove(id: number) {
    commit(current.filter((a) => a.id !== id).map((a) => a.id));
  }

  function onAdd() {
    if (!selectId) return;
    const newId = Number(selectId);
    commit([...current.map((a) => a.id), newId]);
  }

  return (
    <div>
      <div className="label">Zuständig</div>
      {current.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
          {current.map((a) => {
            const profileUrl = gitlabBaseUrl
              ? `${gitlabBaseUrl.replace(/\/$/, '')}/${a.username}`
              : null;
            return (
              <div
                key={a.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 6px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 4,
                }}
                className="assignee-link"
              >
                <div className={`avatar avatar--sm ${avatarColor(a.username)}`}>
                  {initials(a.name)}
                </div>
                <div style={{ fontSize: 12, minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {a.name}
                  </div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--color-ink-3)' }}>
                    @{a.username}
                  </div>
                </div>
                {profileUrl && (
                  <a
                    href={profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="In GitLab öffnen"
                    style={{ color: 'var(--color-ink-4)', display: 'flex' }}
                  >
                    <ExternalLink size={11} />
                  </a>
                )}
                <button
                  type="button"
                  className="btn btn--ghost btn--icon btn--sm"
                  onClick={() => onRemove(a.id)}
                  disabled={pending}
                  title="Person entfernen"
                >
                  <X size={10} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 6 }}>
          Niemand zugewiesen.
        </div>
      )}
      {showAdd ? (
        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            padding: 8,
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
          }}
        >
          <select
            className="input"
            value={selectId}
            onChange={(e) => setSelectId(e.target.value)}
            disabled={pending}
            style={{ flex: 1 }}
          >
            <option value="">— Person wählen —</option>
            {candidates.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} (@{a.username})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              setShowAdd(false);
              setSelectId('');
            }}
            disabled={pending}
          >
            ×
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={onAdd}
            disabled={!selectId || pending}
          >
            Hinzufügen
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setShowAdd(true)}
          style={{ width: '100%', justifyContent: 'center' }}
          disabled={candidates.length === 0 || pending}
        >
          <Plus size={11} />
          Person zuweisen
        </button>
      )}
      {error && (
        <div style={{ fontSize: 10, color: 'var(--color-status-blocked)', marginTop: 4 }}>{error}</div>
      )}
    </div>
  );
}

function LabelsEditor({
  task,
  knownLabels,
  onChanged,
}: {
  task: GanttBar;
  knownLabels: { name: string; color?: string }[];
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [selectLabel, setSelectLabel] = useState<string>('');

  const current = task.labels ?? [];
  const currentNames = new Set(current.map((l) => l.name));
  const candidates = knownLabels
    .filter((l) => !currentNames.has(l.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

  function commit(names: string[]) {
    startTransition(async () => {
      const res = await updateWorkPackageAction(task.id, { labels: names });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setShowAdd(false);
      setSelectLabel('');
      onChanged();
    });
  }

  function onRemove(name: string) {
    commit(current.filter((l) => l.name !== name).map((l) => l.name));
  }

  function onAdd() {
    const name = selectLabel.trim();
    if (!name) return;
    // Falls das Label bereits am WP hängt: nichts tun, UI schliessen.
    if (currentNames.has(name)) {
      setShowAdd(false);
      setSelectLabel('');
      return;
    }
    // Existiert das Label in GitLab schon? Sonst wird's beim PUT automatisch
    // angelegt (GitLab erstellt fehlende Labels mit zufälliger Farbe).
    commit([...current.map((l) => l.name), name]);
  }

  return (
    <div>
      <div className="label">Labels</div>
      {current.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          {current.map((l) => (
            <LabelChipRemovable
              key={l.name}
              label={l}
              onRemove={() => onRemove(l.name)}
              disabled={pending}
            />
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 6 }}>
          Keine Labels.
        </div>
      )}
      {showAdd ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: 8,
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
          }}
        >
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              className="input"
              type="text"
              value={selectLabel}
              onChange={(e) => setSelectLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onAdd();
                } else if (e.key === 'Escape') {
                  setShowAdd(false);
                  setSelectLabel('');
                }
              }}
              placeholder="Label-Name (neu oder vorhanden)"
              list={`labels-list-${task.id}`}
              autoFocus
              disabled={pending}
              style={{ flex: 1 }}
            />
            <datalist id={`labels-list-${task.id}`}>
              {candidates.map((l) => (
                <option key={l.name} value={l.name} />
              ))}
            </datalist>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => {
                setShowAdd(false);
                setSelectLabel('');
              }}
              disabled={pending}
            >
              ×
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={onAdd}
              disabled={!selectLabel.trim() || pending}
            >
              Hinzufügen
            </button>
          </div>
          {selectLabel.trim() &&
            !candidates.some((c) => c.name === selectLabel.trim()) &&
            !currentNames.has(selectLabel.trim()) && (
              <div style={{ fontSize: 10, color: 'var(--color-ink-3)' }}>
                Neues Label „<strong>{selectLabel.trim()}</strong>&ldquo; — wird in GitLab
                automatisch angelegt.
              </div>
            )}
        </div>
      ) : (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => {
            setShowAdd(true);
            // Lazy-Refresh der Project-Labels — falls in GitLab seit dem
            // letzten Sync neue Labels erstellt wurden. Fire-and-forget;
            // revalidatePath() in der Action zieht den frischen Stand nach.
            void refreshProjectLabelsAction(task.id);
          }}
          style={{ width: '100%', justifyContent: 'center' }}
          disabled={pending}
        >
          <Plus size={11} />
          Label hinzufügen
        </button>
      )}
      {error && (
        <div style={{ fontSize: 10, color: 'var(--color-status-blocked)', marginTop: 4 }}>{error}</div>
      )}
    </div>
  );
}

function LabelChipRemovable({
  label,
  onRemove,
  disabled,
}: {
  label: GanttLabel;
  onRemove: () => void;
  disabled: boolean;
}) {
  const bg = label.color ?? '#ebeae5';
  const lum = luminance(bg);
  const fg = lum > 0.6 ? '#1f1f23' : '#ffffff';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 4px 2px 7px',
        borderRadius: 9,
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'lowercase',
        background: bg,
        color: fg,
      }}
    >
      {label.name}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        style={{
          width: 12,
          height: 12,
          border: 'none',
          background: 'rgba(0,0,0,0.15)',
          color: fg,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
        }}
        title="Label entfernen"
      >
        <X size={8} />
      </button>
    </span>
  );
}

function ParentSection({
  task,
  allBars,
  pickerActive,
  onStartPick,
  onChanged,
}: {
  task: GanttBar;
  allBars: GanttBar[];
  pickerActive: boolean;
  onStartPick?: (sourceId: string) => void;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const currentParent = task.parentId
    ? allBars.find((b) => b.id === task.parentId)
    : null;

  function clearParent() {
    setError(null);
    startTransition(async () => {
      const result = await updateWorkPackageAction(task.id, { parentIid: null });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onChanged();
    });
  }

  return (
    <div>
      <div className="label">Übergeordnetes Work Package</div>
      {currentParent ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 6px',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            fontSize: 12,
            marginBottom: 6,
          }}
        >
          <span className="mono" style={{ fontSize: 10, color: 'var(--color-ink-3)' }}>
            #{currentParent.gitlabIssueIid}
          </span>
          <span
            style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {currentParent.text}
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            onClick={clearParent}
            disabled={pending || pickerActive}
            title="Parent entfernen"
          >
            <X size={10} />
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 6 }}>
          Kein Parent gesetzt.
        </div>
      )}
      <button
        type="button"
        className="btn btn--sm"
        onClick={() => onStartPick?.(task.id)}
        disabled={pending || pickerActive}
        style={{ width: '100%', justifyContent: 'center' }}
      >
        <MousePointerClick size={11} />
        {currentParent ? 'Parent neu wählen' : 'Parent setzen'}
      </button>
      {error && (
        <div style={{ fontSize: 10, color: 'var(--color-status-blocked)', marginTop: 4 }}>{error}</div>
      )}
    </div>
  );
}

function DependenciesEditor({
  task,
  allBars,
  dependencies,
  pickerActive,
  onStartPick,
  onChanged,
}: {
  task: GanttBar;
  allBars: GanttBar[];
  dependencies: GanttDependency[];
  pickerActive: boolean;
  onStartPick?: (sourceId: string, depType: DependencyType) => void;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newType, setNewType] = useState<DependencyType>('FS');

  // Vorgänger: deps where successorId == task.id
  const predecessorDeps = useMemo(
    () => dependencies.filter((d) => d.successorId === task.id),
    [dependencies, task.id],
  );
  // Nachfolger: deps where predecessorId == task.id
  const successorDeps = useMemo(
    () => dependencies.filter((d) => d.predecessorId === task.id),
    [dependencies, task.id],
  );

  function buildNextSpec(extra?: DependencySpec): DependencySpec[] {
    const current: DependencySpec[] = [];
    for (const d of predecessorDeps) {
      const pred = allBars.find((b) => b.id === d.predecessorId);
      if (!pred) continue;
      current.push({
        predecessorIid: pred.gitlabIssueIid,
        type: d.type,
        lagDays: d.lagDays,
      });
    }
    if (extra) current.push(extra);
    return current;
  }

  function commit(specs: DependencySpec[]) {
    startTransition(async () => {
      const res = await updateWorkPackageAction(task.id, { dependencies: specs });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      onChanged();
    });
  }

  function onRemove(predecessorBarId: string) {
    const specs = buildNextSpec().filter((s) => {
      const pred = allBars.find((b) => b.id === predecessorBarId);
      return pred ? s.predecessorIid !== pred.gitlabIssueIid : true;
    });
    commit(specs);
  }

  return (
    <div>
      <div className="label">Vorgänger</div>
      {predecessorDeps.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 6 }}>
          Keine Vorgänger.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
          {predecessorDeps.map((d) => {
            const pred = allBars.find((b) => b.id === d.predecessorId);
            return (
              <div
                key={d.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 6px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 4,
                  fontSize: 12,
                }}
              >
                <LinkIcon size={10} style={{ color: 'var(--color-ink-3)' }} />
                <span className="mono" style={{ fontSize: 10, color: 'var(--color-ink-3)' }}>
                  #{pred?.gitlabIssueIid ?? '?'}
                </span>
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {pred?.text ?? '(unbekannt)'}
                </span>
                <span className="chip" style={{ fontSize: 9 }}>
                  {d.type}
                </span>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon btn--sm"
                  onClick={() => pred && onRemove(pred.id)}
                  disabled={pending}
                  title="Vorgänger entfernen"
                >
                  <X size={10} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          padding: 8,
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-border)',
          borderRadius: 4,
        }}
      >
        <select
          className="input"
          value={newType}
          onChange={(e) => setNewType(e.target.value as DependencyType)}
          disabled={pending || pickerActive}
          style={{ flex: 1, height: 24, fontSize: 11 }}
          title="Dependency-Typ"
        >
          <option value="FS">FS — Finish to Start</option>
          <option value="SS">SS — Start to Start</option>
          <option value="FF">FF — Finish to Finish</option>
          <option value="SF">SF — Start to Finish</option>
        </select>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => onStartPick?.(task.id, newType)}
          disabled={pending || pickerActive}
        >
          <MousePointerClick size={11} />
          Vorgänger picken
        </button>
      </div>

      {successorDeps.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="label">Nachfolger ({successorDeps.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {successorDeps.map((d) => {
              const succ = allBars.find((b) => b.id === d.successorId);
              return (
                <div
                  key={d.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 6px',
                    border: '1px solid var(--color-border)',
                    borderRadius: 4,
                    fontSize: 12,
                    background: 'var(--color-surface-2)',
                  }}
                >
                  <LinkIcon size={10} style={{ color: 'var(--color-ink-3)' }} />
                  <span className="mono" style={{ fontSize: 10, color: 'var(--color-ink-3)' }}>
                    #{succ?.gitlabIssueIid ?? '?'}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {succ?.text ?? '(unbekannt)'}
                  </span>
                  <span className="chip" style={{ fontSize: 9 }}>
                    {d.type}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-ink-4)', marginTop: 4 }}>
            Nachfolger werden im jeweiligen Issue verwaltet.
          </div>
        </div>
      )}

      {error && (
        <div style={{ fontSize: 10, color: 'var(--color-status-blocked)', marginTop: 4 }}>{error}</div>
      )}
    </div>
  );
}

function luminance(hex: string): number {
  const m = hex.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return 0;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function fmtConflictDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(2)}`;
}

function ConflictBanner({
  conflicts,
  allBars,
}: {
  conflicts: InspectorConflict[];
  allBars: GanttBar[];
}) {
  return (
    <div
      role="alert"
      style={{
        padding: 10,
        background: '#fef2f2',
        border: '1px solid #fecaca',
        borderRadius: 'var(--r-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        fontSize: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--color-status-blocked)',
          fontWeight: 600,
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        <AlertTriangle size={12} />
        Dependency-Konflikt{conflicts.length === 1 ? '' : 'e'} ({conflicts.length})
      </div>
      {conflicts.map((c) => {
        const pred = allBars.find((b) => b.id === c.predecessorId);
        const predLabel = pred ? `#${pred.gitlabIssueIid} ${pred.text}` : 'Vorgänger';
        return (
          <div
            key={c.dependencyId}
            style={{ fontSize: 11, color: 'var(--color-ink-2)', lineHeight: 1.5 }}
          >
            <span className="mono" style={{ fontWeight: 600, marginRight: 6 }}>
              {c.type}
            </span>
            {c.lagDays !== 0 && (
              <span className="mono" style={{ color: 'var(--color-ink-3)', marginRight: 6 }}>
                +{c.lagDays}d
              </span>
            )}
            <span style={{ color: 'var(--color-ink-3)' }}>{predLabel}</span>
            <div style={{ marginTop: 2, color: 'var(--color-status-blocked)' }}>
              {c.successorField === 'start' ? 'Start' : 'Ende'} muss ≥{' '}
              <span className="mono" style={{ fontWeight: 600 }}>
                {fmtConflictDate(c.expectedDate)}
              </span>{' '}
              sein (aktuell{' '}
              <span className="mono">{fmtConflictDate(c.actualDate)}</span>, {c.daysOverlap}d zu
              früh)
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BaselineEditor({
  task,
  onChanged,
}: {
  task: GanttBar;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const hasBaseline = !!(task.baselineStart && task.baselineEnd);
  const currentMatchesBaseline =
    hasBaseline &&
    task.baselineStart!.getTime() === task.start.getTime() &&
    task.baselineEnd!.getTime() === task.end.getTime();

  function freeze() {
    startTransition(async () => {
      const res = await updateWorkPackageAction(task.id, {
        baselineStart: toIsoDate(task.start),
        baselineEnd: toIsoDate(task.end),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      onChanged();
    });
  }

  function clear() {
    startTransition(async () => {
      const res = await updateWorkPackageAction(task.id, {
        baselineStart: null,
        baselineEnd: null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      onChanged();
    });
  }

  return (
    <div>
      <div className="label">Baseline (Plan)</div>
      {hasBaseline ? (
        <div
          style={{
            padding: 10,
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            fontSize: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <GitCompareArrows size={12} style={{ color: 'var(--color-ink-3)' }} />
            <span className="mono" style={{ color: 'var(--color-ink-2)' }}>
              {fmtBaselineDate(task.baselineStart!)} – {fmtBaselineDate(task.baselineEnd!)}
            </span>
          </div>
          {!currentMatchesBaseline && (
            <div style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>
              Aktuell: {fmtBaselineDate(task.start)} – {fmtBaselineDate(task.end)}
              {(() => {
                const slip = Math.round(
                  (task.end.getTime() - task.baselineEnd!.getTime()) / 86_400_000,
                );
                if (slip === 0) return null;
                return (
                  <span
                    style={{
                      marginLeft: 6,
                      color: slip > 0 ? 'var(--color-status-blocked)' : 'var(--color-status-done)',
                      fontWeight: 500,
                    }}
                  >
                    ({slip > 0 ? '+' : ''}
                    {slip}d Ende)
                  </span>
                );
              })()}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="btn btn--sm"
              onClick={freeze}
              disabled={pending || currentMatchesBaseline}
              title={
                currentMatchesBaseline
                  ? 'Baseline ist bereits identisch mit aktuellem Stand'
                  : 'Baseline auf aktuelle Start-/End-Daten setzen'
              }
            >
              Aktualisieren
            </button>
            <button
              type="button"
              className="btn btn--sm"
              onClick={clear}
              disabled={pending}
            >
              Entfernen
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={freeze}
          disabled={pending}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          <GitCompareArrows size={11} />
          Baseline auf aktuelle Daten setzen
        </button>
      )}
      {error && (
        <div style={{ fontSize: 10, color: 'var(--color-status-blocked)', marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtBaselineDate(d: Date): string {
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// ─── Merge-Requests-Section ──────────────────────────────────────────

function MergeRequestsSection({
  workPackageId,
  mrs,
  onChanged,
}: {
  workPackageId: string;
  mrs: GanttMergeRequest[];
  onChanged: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    setRefreshing(true);
    setError(null);
    void (async () => {
      const res = await refreshWorkPackageMrsAction(workPackageId);
      setRefreshing(false);
      if (!res.ok) {
        if (res.sessionExpired) {
          window.location.href = '/api/auth/signout?callbackUrl=/login%3Fexpired%3D1';
          return;
        }
        setError(res.error);
        return;
      }
      onChanged();
    })();
  }

  return (
    <div>
      <div
        className="label"
        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <GitMerge size={11} />
        <span>Merge Requests</span>
        <span style={{ color: 'var(--color-ink-3)', fontWeight: 400 }}>
          · {mrs.length}
        </span>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          title="Aus GitLab neu laden"
          style={{
            marginLeft: 'auto',
            border: 'none',
            background: 'transparent',
            color: 'var(--color-ink-3)',
            cursor: refreshing ? 'wait' : 'pointer',
            padding: 2,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <RotateCcw size={11} className={refreshing ? 'animate-spin' : undefined} />
        </button>
      </div>
      {mrs.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--color-ink-4)' }}>
          Keine verlinkten Merge Requests.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {mrs.map((mr) => (
            <MergeRequestRow key={mr.iid} mr={mr} />
          ))}
        </div>
      )}
      {error && (
        <div style={{ fontSize: 11, color: 'var(--color-status-blocked)', marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}

function MergeRequestRow({ mr }: { mr: GanttMergeRequest }) {
  const stateColor =
    mr.state === 'merged'
      ? 'var(--color-status-merged, #7c3aed)'
      : mr.state === 'closed'
        ? 'var(--color-status-blocked)'
        : 'var(--color-status-open)';
  const StateIcon =
    mr.state === 'merged' ? GitMerge : mr.state === 'closed' ? GitPullRequestClosed : GitMerge;
  return (
    <a
      href={mr.webUrl}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        border: '1px solid var(--color-border)',
        borderRadius: 4,
        background: 'var(--color-surface-2)',
        textDecoration: 'none',
        color: 'var(--color-ink)',
      }}
    >
      <StateIcon size={13} style={{ color: stateColor, flexShrink: 0 }} />
      <span
        className="mono"
        style={{ fontSize: 11, color: 'var(--color-ink-3)', flexShrink: 0 }}
      >
        !{mr.iid}
      </span>
      <span
        style={{
          fontSize: 12,
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={mr.title}
      >
        {mr.title}
      </span>
      {/* Zustand ausgeschrieben: das kleine Icon links allein geht neben einem
          roten Pipeline-Badge unter, und „merged" ist die wichtigere Aussage. */}
      <span style={{ fontSize: 10, color: stateColor, flexShrink: 0 }}>{mr.state}</span>
      {mr.pipeline && <PipelineBadge pipeline={mr.pipeline} />}
      <ExternalLink size={10} style={{ color: 'var(--color-ink-4)', flexShrink: 0 }} />
    </a>
  );
}

function PipelineBadge({ pipeline }: { pipeline: NonNullable<GanttMergeRequest['pipeline']> }) {
  const map: Record<string, { icon: React.ElementType; color: string; label: string }> = {
    success: { icon: CheckCircle2, color: 'var(--color-status-done)', label: 'success' },
    failed: { icon: XCircle, color: 'var(--color-status-blocked)', label: 'failed' },
    running: { icon: PlayCircle, color: 'var(--color-accent)', label: 'running' },
    canceled: { icon: CircleDashed, color: 'var(--color-ink-3)', label: 'canceled' },
    skipped: { icon: CircleDashed, color: 'var(--color-ink-3)', label: 'skipped' },
    manual: { icon: CircleDashed, color: 'var(--color-ink-3)', label: 'manual' },
    created: { icon: CircleDashed, color: 'var(--color-ink-3)', label: 'created' },
  };
  const info = map[pipeline.status] ?? {
    icon: CircleDashed,
    color: 'var(--color-ink-3)',
    label: pipeline.status,
  };
  const Icon = info.icon;
  return (
    <span
      onClick={(e) => {
        if (pipeline.webUrl) {
          e.preventDefault();
          e.stopPropagation();
          window.open(pipeline.webUrl, '_blank', 'noopener,noreferrer');
        }
      }}
      title={`Pipeline #${pipeline.id}: ${info.label}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 10,
        color: info.color,
        flexShrink: 0,
      }}
    >
      <Icon size={11} />
      <span>{info.label}</span>
    </span>
  );
}

// ─── Comments-Section ────────────────────────────────────────────────

function CommentsSection({
  workPackageId,
  gitlabBaseUrl,
  gitlabProjectPath,
}: {
  workPackageId: string;
  gitlabBaseUrl?: string;
  gitlabProjectPath?: string;
}) {
  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'loaded'; notes: IssueNote[] }
    | { phase: 'error'; error: string }
  >({ phase: 'loading' });
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Auto-load bei WP-Wechsel — Comments werden NICHT mit dem regulären
  // Sync gezogen (zu viele Round-Trips). Stattdessen lazy aber automatisch
  // sobald ein WP im Inspector geöffnet wird.
  /* eslint-disable react-hooks/set-state-in-effect -- reset+autoload bei prop-Wechsel */
  useEffect(() => {
    setDraft('');
    setSendError(null);
    setState({ phase: 'loading' });
    let cancelled = false;
    void (async () => {
      const res = await getIssueNotesAction(workPackageId);
      if (cancelled) return; // WP gewechselt während fetch lief → Ergebnis verwerfen
      if (!res.ok) {
        if (res.sessionExpired) {
          window.location.href = '/api/auth/signout?callbackUrl=/login%3Fexpired%3D1';
          return;
        }
        setState({ phase: 'error', error: res.error });
        return;
      }
      setState({ phase: 'loaded', notes: res.notes });
    })();
    return () => {
      cancelled = true;
    };
  }, [workPackageId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function refresh() {
    setState({ phase: 'loading' });
    void (async () => {
      const res = await getIssueNotesAction(workPackageId);
      if (!res.ok) {
        if (res.sessionExpired) {
          window.location.href = '/api/auth/signout?callbackUrl=/login%3Fexpired%3D1';
          return;
        }
        setState({ phase: 'error', error: res.error });
        return;
      }
      setState({ phase: 'loaded', notes: res.notes });
    })();
  }

  function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    void (async () => {
      const res = await addIssueNoteAction(workPackageId, body);
      setSending(false);
      if (!res.ok) {
        if (res.sessionExpired) {
          window.location.href = '/api/auth/signout?callbackUrl=/login%3Fexpired%3D1';
          return;
        }
        setSendError(res.error);
        return;
      }
      setDraft('');
      setState((prev) =>
        prev.phase === 'loaded'
          ? { phase: 'loaded', notes: [...prev.notes, res.note] }
          : { phase: 'loaded', notes: [res.note] },
      );
    })();
  }

  return (
    <div>
      <div
        className="label"
        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <MessageSquare size={11} />
        <span>Kommentare</span>
        {state.phase === 'loaded' && (
          <span style={{ color: 'var(--color-ink-3)', fontWeight: 400 }}>
            · {state.notes.length}
          </span>
        )}
        <button
          type="button"
          onClick={refresh}
          disabled={state.phase === 'loading'}
          title="Aus GitLab neu laden"
          style={{
            marginLeft: 'auto',
            border: 'none',
            background: 'transparent',
            color: 'var(--color-ink-3)',
            cursor: state.phase === 'loading' ? 'wait' : 'pointer',
            padding: 2,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <RotateCcw
            size={11}
            className={state.phase === 'loading' ? 'animate-spin' : undefined}
          />
        </button>
      </div>
      {state.phase === 'loading' && (
        <div style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>Lade…</div>
      )}
      {state.phase === 'error' && (
        <div style={{ fontSize: 11, color: 'var(--color-status-blocked)' }}>
          {state.error}
        </div>
      )}
      {state.phase === 'loaded' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {state.notes.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--color-ink-4)' }}>
              Noch keine Kommentare.
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: 320,
                overflow: 'auto',
                padding: 2,
              }}
            >
              {state.notes.map((n) => (
                <CommentRow
                  key={n.id}
                  note={n}
                  gitlabBaseUrl={gitlabBaseUrl}
                  gitlabProjectPath={gitlabProjectPath}
                />
              ))}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <textarea
              className="input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Neuer Kommentar (Markdown unterstützt)…"
              rows={3}
              disabled={sending}
              onKeyDown={(e) => {
                // ⌘+Enter / Ctrl+Enter = submit
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  send();
                }
              }}
              style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 12 }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: 'var(--color-ink-4)', flex: 1 }}>
                ⌘+Enter zum Senden
              </span>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={send}
                disabled={!draft.trim() || sending}
              >
                <Send size={11} />
                <span>{sending ? 'Sende…' : 'Senden'}</span>
              </button>
            </div>
            {sendError && (
              <div style={{ fontSize: 10, color: 'var(--color-status-blocked)' }}>
                {sendError}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CommentRow({
  note,
  gitlabBaseUrl,
  gitlabProjectPath,
}: {
  note: IssueNote;
  gitlabBaseUrl?: string;
  gitlabProjectPath?: string;
}) {
  const fmt = (iso: string) =>
    iso
      ? new Date(iso).toLocaleString('de-DE', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';
  return (
    <div
      style={{
        padding: '6px 8px',
        border: '1px solid var(--color-border)',
        borderRadius: 4,
        background: 'var(--color-surface-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          color: 'var(--color-ink-3)',
        }}
      >
        {note.authorAvatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- externe GitLab-Avatar-URLs, Image-Loader-Config wäre overkill
          <img
            src={note.authorAvatarUrl}
            alt=""
            width={16}
            height={16}
            style={{ borderRadius: '50%', flexShrink: 0 }}
          />
        ) : (
          <div
            className={`avatar ${avatarColor(note.authorUsername)}`}
            style={{ width: 16, height: 16, fontSize: 8 }}
          >
            {initials(note.authorName || note.authorUsername)}
          </div>
        )}
        <span style={{ fontWeight: 500, color: 'var(--color-ink-2)' }}>
          {note.authorName || note.authorUsername}
        </span>
        <span style={{ marginLeft: 'auto' }}>{fmt(note.createdAt)}</span>
      </div>
      <div
        className="comment-body"
        style={{
          fontSize: 12,
          color: 'var(--color-ink)',
          wordBreak: 'break-word',
        }}
      >
        <CommentMarkdown
          body={note.body}
          gitlabBaseUrl={gitlabBaseUrl}
          gitlabProjectPath={gitlabProjectPath}
        />
      </div>
    </div>
  );
}

// GitLab-Comments sind Markdown. Wir nutzen react-markdown + remark-gfm
// (Tabellen, Strikethrough, Autolinks). Relative GitLab-Pfade (z.B.
// `/uploads/...` für Datei-Anhänge oder `#42` für Issue-Refs) werden gegen
// die Project-Web-URL aufgelöst damit der Klick im neuen Tab funktioniert.
function CommentMarkdown({
  body,
  gitlabBaseUrl,
  gitlabProjectPath,
}: {
  body: string;
  gitlabBaseUrl?: string;
  gitlabProjectPath?: string;
}) {
  const projectWebUrl =
    gitlabBaseUrl && gitlabProjectPath
      ? `${gitlabBaseUrl.replace(/\/$/, '')}/${gitlabProjectPath}`
      : null;

  function resolveUrl(href: string | undefined): string {
    if (!href) return '#';
    if (/^[a-z]+:\/\//i.test(href) || href.startsWith('mailto:')) return href;
    if (href.startsWith('#')) return href; // Anchor links
    if (!projectWebUrl) return href;
    if (href.startsWith('/')) {
      // Absolute GitLab-Pfade (z.B. /uploads/...) → an Project-Web-URL hängen.
      // GitLab speichert Upload-Pfade relativ zum Projekt.
      return `${projectWebUrl}${href}`;
    }
    // Relative Pfade — eher selten in Comments, vorsichtig hinten anhängen.
    return `${projectWebUrl}/${href}`;
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children, ...props }) => (
          <a
            {...props}
            href={resolveUrl(href)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--color-accent-h)' }}
          >
            {children}
          </a>
        ),
        // Bilder: Source ebenfalls auflösen
        img: ({ src, alt, ...props }) => (
          // eslint-disable-next-line @next/next/no-img-element -- GitLab-Uploads, kein Image-Loader nötig
          <img
            {...props}
            src={typeof src === 'string' ? resolveUrl(src) : undefined}
            alt={alt ?? ''}
            style={{ maxWidth: '100%', height: 'auto', borderRadius: 4 }}
          />
        ),
        // Codeblock-Styling minimal
        code: ({ children, ...props }) => (
          <code
            {...props}
            style={{
              background: 'var(--color-surface-3)',
              padding: '0 4px',
              borderRadius: 3,
              fontSize: 11,
            }}
          >
            {children}
          </code>
        ),
      }}
    >
      {body}
    </ReactMarkdown>
  );
}
