import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { signOutAction } from '@/lib/auth/actions';
import { TaktMark } from '@/components/brand/TaktMark';
import { SearchLauncher } from '@/components/header/SearchLauncher';
import { BellMenu } from '@/components/header/BellMenu';
import { UserMenu } from '@/components/header/UserMenu';
import { isDemoMode } from '@/lib/demo/mode';

type Props = {
  username?: string | null;
  active?: 'projects' | 'gantt' | 'board' | 'resources' | 'reports' | 'risks';
};

export function AppHeader({ username, active = 'projects' }: Props) {
  return (
    <header className="topbar">
      <Link href="/projects" className="topbar__brand" draggable={false}>
        <TaktMark size={22} />
        <span
          className="topbar__brand-text"
          style={{ letterSpacing: '0.04em', fontWeight: 700, fontSize: 13 }}
        >
          TAKTLINE
        </span>
      </Link>

      {isDemoMode() && (
        <span
          data-demo-chip=""
          title="Öffentliche Demo mit Beispieldaten. Kein GitLab angebunden — Änderungen werden regelmässig zurückgesetzt."
          style={{
            alignSelf: 'center',
            padding: '2px 7px',
            borderRadius: 'var(--r-2)',
            border: '1px solid var(--color-accent)',
            color: 'var(--color-accent-h)',
            background: 'var(--color-accent-soft)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.06em',
            cursor: 'default',
          }}
        >
          DEMO
        </span>
      )}

      <div className="hr-v" style={{ height: 22, alignSelf: 'center' }} />

      <nav className="topbar__nav">
        <Link
          href="/projects"
          aria-current={active === 'projects' ? 'page' : undefined}
          draggable={false}
        >
          Projekte
        </Link>
        <Link
          href="/gantt"
          aria-current={active === 'gantt' ? 'page' : undefined}
          draggable={false}
        >
          Gantt
        </Link>
        <Link
          href="/board"
          aria-current={active === 'board' ? 'page' : undefined}
          draggable={false}
        >
          Board
        </Link>
        <Link
          href="/resources"
          aria-current={active === 'resources' ? 'page' : undefined}
          draggable={false}
        >
          Ressourcen
        </Link>
        <Link
          href="/risks"
          aria-current={active === 'risks' ? 'page' : undefined}
          draggable={false}
        >
          Risiken
        </Link>
        <Link
          href="/reports"
          aria-current={active === 'reports' ? 'page' : undefined}
          draggable={false}
        >
          Berichte
        </Link>
      </nav>

      <div className="topbar__spacer" />

      {/* Suche (wide + narrow Trigger + Cmd+K Modal in einem Komponent) */}
      <SearchLauncher />

      {/* Bell-Dropdown mit Warnings/Due-Tasks/Activity */}
      <BellMenu />

      <UserMenu
        username={username ?? null}
        gitlabBaseUrl={process.env.GITLAB_URL}
        signOutAction={signOutAction}
      />
    </header>
  );
}

// Ein Breadcrumb-Eintrag ist entweder ein einfacher Text-Label oder ein
// Tupel aus Label + Href (dann als Link gerendert). Der letzte Eintrag
// wird immer als nicht-klickbare aktuelle Position gerendert.
export type Crumb = string | { label: string; href: string };

type SubHeaderProps = {
  crumbs?: Crumb[];
  title?: string;
  badge?: string;
  right?: React.ReactNode;
};

function crumbLabel(c: Crumb): string {
  return typeof c === 'string' ? c : c.label;
}
function crumbHref(c: Crumb): string | null {
  return typeof c === 'string' ? null : c.href;
}

export function SubHeader({ crumbs = [], title, badge, right }: SubHeaderProps) {
  return (
    <div className="subbar">
      {crumbs.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-ink-3)', fontSize: 12 }}>
          {crumbs.map((c, i) => {
            const label = crumbLabel(c);
            const href = crumbHref(c);
            const isLast = i === crumbs.length - 1;
            const labelStyle: React.CSSProperties = {
              color: isLast ? 'var(--color-ink)' : 'var(--color-ink-3)',
              fontWeight: isLast ? 600 : 500,
              textDecoration: 'none',
            };
            return (
              <span key={`${label}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {i > 0 && <ChevronRight size={11} />}
                {href && !isLast ? (
                  <Link href={href} className="subbar__crumb-link" style={labelStyle} draggable={false}>
                    {label}
                  </Link>
                ) : (
                  <span style={labelStyle}>{label}</span>
                )}
              </span>
            );
          })}
        </div>
      )}
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
          {badge && <span className="chip chip--accent">{badge}</span>}
        </div>
      )}
      <div style={{ flex: 1 }} />
      {right}
    </div>
  );
}
