'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, LogOut, ExternalLink, Info, Settings } from 'lucide-react';

type Props = {
  username: string | null;
  gitlabBaseUrl?: string;
  // Action zum Ausloggen (vom Parent als Server-Action übergeben, damit wir
  // 'use server' nicht in einem Client-Component aufrufen müssen).
  signOutAction: () => void | Promise<void>;
};

export function UserMenu({ username, gitlabBaseUrl, signOutAction }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const initials = (username ?? 'U?').slice(0, 2).toUpperCase();
  const profileUrl =
    gitlabBaseUrl && username
      ? `${gitlabBaseUrl.replace(/\/$/, '')}/${username}`
      : null;

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

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn btn--ghost"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Benutzer-Menü"
      >
        <div className="topbar__user" style={{ gap: 8 }}>
          <div className="avatar avatar--c1">{initials}</div>
          <span className="mono topbar__user-label" style={{ fontSize: 12 }}>
            @{username ?? 'user'}
          </span>
          <ChevronDown
            size={12}
            style={{
              color: 'var(--color-ink-3)',
              transform: open ? 'rotate(180deg)' : undefined,
              transition: 'transform .12s',
            }}
          />
        </div>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 220,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--r-3)',
            boxShadow: 'var(--shadow-2)',
            padding: 4,
            zIndex: 60,
          }}
        >
          <div
            style={{
              padding: '8px 10px 6px',
              fontSize: 11,
              color: 'var(--color-ink-3)',
              borderBottom: '1px solid var(--color-border)',
              marginBottom: 4,
            }}
          >
            Angemeldet als
            <div
              className="mono"
              style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink)', marginTop: 2 }}
            >
              @{username ?? 'user'}
            </div>
          </div>

          {profileUrl && (
            <a
              href={profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              role="menuitem"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                borderRadius: 'var(--r-2)',
                textDecoration: 'none',
                color: 'var(--color-ink)',
                fontSize: 12,
                transition: 'background .12s',
              }}
              className="user-menu-item"
            >
              <ExternalLink size={13} style={{ color: 'var(--color-ink-3)' }} />
              <span style={{ flex: 1 }}>GitLab-Profil öffnen</span>
            </a>
          )}

          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            role="menuitem"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 'var(--r-2)',
              textDecoration: 'none',
              color: 'var(--color-ink)',
              fontSize: 12,
              transition: 'background .12s',
            }}
            className="user-menu-item"
          >
            <Settings size={13} style={{ color: 'var(--color-ink-3)' }} />
            <span style={{ flex: 1 }}>Einstellungen</span>
          </Link>

          <Link
            href="/about"
            onClick={() => setOpen(false)}
            role="menuitem"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 'var(--r-2)',
              textDecoration: 'none',
              color: 'var(--color-ink)',
              fontSize: 12,
              transition: 'background .12s',
            }}
            className="user-menu-item"
          >
            <Info size={13} style={{ color: 'var(--color-ink-3)' }} />
            <span style={{ flex: 1 }}>Über Taktline</span>
          </Link>

          <div
            style={{
              height: 1,
              background: 'var(--color-border)',
              margin: '4px 0',
            }}
          />

          {/* Kein setOpen(false) im onClick — das würde die Form unmounten
              bevor der Submit propagiert ("Form submission canceled because
              the form is not connected"). Redirect zu /login schließt den
              Menü-State sowieso indirekt durch Navigation. */}
          <form action={signOutAction}>
            <button
              type="submit"
              role="menuitem"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                border: 'none',
                background: 'transparent',
                color: 'var(--color-status-blocked)',
                fontSize: 12,
                cursor: 'pointer',
                width: '100%',
                textAlign: 'left',
                fontFamily: 'inherit',
                borderRadius: 'var(--r-2)',
                transition: 'background .12s',
              }}
              className="user-menu-item"
            >
              <LogOut size={13} />
              <span style={{ flex: 1 }}>Abmelden</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
