'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, AlertTriangle, Activity, Clock, ExternalLink, CheckCheck } from 'lucide-react';
import type { NotificationBundle } from '@/lib/notifications';

const PANEL_WIDTH = 380;

export function BellMenu() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as NotificationBundle;
      // Date-Strings re-hydraten
      json.activity = json.activity.map((a) => ({ ...a, createdAt: new Date(a.createdAt) }));
      json.dueTasks = json.dueTasks.map((d) => ({ ...d, endDate: new Date(d.endDate) }));
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, []);

  async function clearActivity() {
    // Optimistisch: Activity sofort leeren, dann Server-Call
    setData((cur) => (cur ? { ...cur, activity: [] } : cur));
    try {
      const res = await fetch('/api/notifications', { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      // Bei Fehler: neu laden um konsistenten State zu bekommen
      void load();
    }
  }

  // Initial fetch beim ersten Mount damit der Badge schon Counts hat
  // bevor der User klickt. Re-Fetch wenn der User das Panel öffnet.
  // setState-in-effect ist hier beabsichtigt (fetch-on-mount + loading-state).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Außerhalb klicken oder ESC → schließen
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const badge = data?.totalCount ?? 0;

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn btn--ghost btn--icon"
        title="Benachrichtigungen"
        aria-label="Benachrichtigungen"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ position: 'relative' }}
      >
        <Bell size={15} />
        {badge > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 2,
              right: 2,
              minWidth: 14,
              height: 14,
              padding: '0 4px',
              borderRadius: 7,
              background: 'var(--color-accent)',
              color: 'white',
              fontSize: 9,
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
            }}
          >
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Benachrichtigungen"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            width: PANEL_WIDTH,
            maxHeight: '70vh',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--r-3)',
            boxShadow: 'var(--shadow-2)',
            zIndex: 60,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '10px 12px',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              fontWeight: 600,
              background: 'var(--color-surface-2)',
            }}
          >
            <span>Benachrichtigungen</span>
            <div style={{ flex: 1 }} />
            {loading && (
              <span style={{ fontSize: 10, color: 'var(--color-ink-3)' }}>lädt …</span>
            )}
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {error && (
              <div style={{ padding: 14, fontSize: 12, color: 'var(--color-status-blocked)' }}>
                {error}
              </div>
            )}

            {/* Warnings */}
            <Section
              icon={<AlertTriangle size={12} />}
              title="Warnungen"
              count={data?.warnings.length ?? 0}
              tone="warn"
            >
              {data?.warnings.length === 0 && <Empty>Keine Warnungen</Empty>}
              {data?.warnings.map((w) => (
                <Row key={w.id} href={w.href} onClick={() => setOpen(false)}>
                  <AlertTriangle
                    size={12}
                    style={{ color: 'var(--color-accent-h)', flexShrink: 0, marginTop: 2 }}
                  />
                  <span>{w.message}</span>
                </Row>
              ))}
            </Section>

            {/* Due Tasks */}
            <Section
              icon={<Clock size={12} />}
              title="Bald fällig"
              count={data?.dueTasks.length ?? 0}
              tone="info"
            >
              {data?.dueTasks.length === 0 && <Empty>Keine fälligen Aufgaben</Empty>}
              {data?.dueTasks.map((t) => (
                <Row
                  key={t.id}
                  href={t.href}
                  external={t.external}
                  onClick={() => setOpen(false)}
                >
                  <span
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: t.daysLeft <= 2 ? 'var(--color-status-blocked)' : 'var(--color-ink-3)',
                      flexShrink: 0,
                      marginTop: 1,
                      fontWeight: 600,
                    }}
                  >
                    {t.daysLeft <= 0 ? 'heute' : `${t.daysLeft}d`}
                  </span>
                  <span>
                    <span className="mono" style={{ color: 'var(--color-ink-3)' }}>
                      #{t.iid}
                    </span>{' '}
                    {t.title}
                  </span>
                </Row>
              ))}
            </Section>

            {/* Activity */}
            <Section
              icon={<Activity size={12} />}
              title="Aktivität (7 Tage)"
              count={data?.activity.length ?? 0}
              tone="muted"
              action={
                (data?.activity.length ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={clearActivity}
                    title="Aktivität als gelesen markieren"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '2px 6px',
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--color-ink-3)',
                      fontSize: 10,
                      cursor: 'pointer',
                      borderRadius: 'var(--r-1)',
                      fontFamily: 'inherit',
                      textTransform: 'none',
                      letterSpacing: 0,
                      fontWeight: 500,
                    }}
                    className="bell-clear-btn"
                  >
                    <CheckCheck size={11} />
                    <span>Leeren</span>
                  </button>
                )
              }
            >
              {data?.activity.length === 0 && <Empty>Keine neue Aktivität</Empty>}
              {data?.activity.map((a) => (
                <Row key={a.id} href={a.href} onClick={() => setOpen(false)}>
                  <span style={{ flex: 1 }}>{a.message}</span>
                  <span
                    className="mono"
                    style={{ fontSize: 10, color: 'var(--color-ink-3)', flexShrink: 0 }}
                  >
                    {formatRelative(a.createdAt)}
                  </span>
                </Row>
              ))}
            </Section>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  count,
  tone,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  tone: 'warn' | 'info' | 'muted';
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const toneColor =
    tone === 'warn'
      ? 'var(--color-accent-h)'
      : tone === 'info'
        ? 'var(--color-status-open)'
        : 'var(--color-ink-3)';
  return (
    <div>
      <div
        style={{
          padding: '8px 12px',
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: toneColor,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'var(--color-surface-2)',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        {icon}
        <span>{title}</span>
        {count > 0 && (
          <span
            className="mono"
            style={{ color: 'var(--color-ink-3)', fontWeight: 500, fontSize: 10 }}
          >
            {count}
          </span>
        )}
        {action && <div style={{ marginLeft: 'auto' }}>{action}</div>}
      </div>
      {children}
    </div>
  );
}

function Row({
  href,
  external,
  onClick,
  children,
}: {
  href: string | null;
  external?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const content = (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '8px 12px',
        fontSize: 12,
        color: 'var(--color-ink)',
        borderTop: '1px solid var(--color-border)',
        cursor: href ? 'pointer' : 'default',
        transition: 'background .12s',
      }}
      className="bell-row"
    >
      {children}
      {href && (
        <ExternalLink
          size={10}
          style={{ color: 'var(--color-ink-4)', flexShrink: 0, marginTop: 3 }}
        />
      )}
    </div>
  );
  if (!href) return content;
  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        style={{ textDecoration: 'none', color: 'inherit' }}
      >
        {content}
      </a>
    );
  }
  return (
    <Link href={href} onClick={onClick} style={{ textDecoration: 'none' }}>
      {content}
    </Link>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '14px 12px',
        fontSize: 11,
        color: 'var(--color-ink-3)',
        borderTop: '1px solid var(--color-border)',
        fontStyle: 'italic',
      }}
    >
      {children}
    </div>
  );
}

function formatRelative(d: Date): string {
  const diff = Math.round((Date.now() - d.getTime()) / 60_000);
  if (diff < 1) return 'jetzt';
  if (diff < 60) return `${diff}m`;
  const h = Math.round(diff / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
