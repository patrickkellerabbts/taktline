// Stapelt 1–N Avatare horizontal (überlappend), zeigt "+N" Overflow-Badge.
// Initialen + deterministische Farbe; vermeidet externe Bild-Loads.

export type Assignee = {
  id: number;
  username: string;
  name: string;
  avatarUrl?: string;
};

type Props = {
  assignees: Assignee[];
  size?: 'sm' | 'md';
  max?: number;
};

export function AssigneeAvatars({ assignees, size = 'sm', max = 3 }: Props) {
  if (assignees.length === 0) {
    return <span style={{ fontSize: 11, color: 'var(--color-ink-4)' }}>—</span>;
  }
  const visible = assignees.slice(0, max);
  const overflow = assignees.length - max;
  const offset = size === 'sm' ? -6 : -8;
  return (
    <div
      style={{ display: 'inline-flex', alignItems: 'center' }}
      title={assignees.map((a) => `${a.name} (@${a.username})`).join(', ')}
    >
      {visible.map((a, i) => (
        <div
          key={a.id}
          className={`avatar avatar--${size} ${avatarColor(a.username)}`}
          style={{
            marginLeft: i === 0 ? 0 : offset,
            border: '1.5px solid var(--color-surface)',
            zIndex: visible.length - i,
            position: 'relative',
          }}
        >
          {initials(a.name)}
        </div>
      ))}
      {overflow > 0 && (
        <span
          style={{
            marginLeft: 4,
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--color-ink-3)',
          }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

export function avatarColor(username: string): string {
  const hash = [...username].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return `avatar--c${(hash % 6) + 1}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
