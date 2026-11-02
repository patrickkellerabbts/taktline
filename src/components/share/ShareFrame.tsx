import Link from 'next/link';
import { Eye } from 'lucide-react';
import { TaktMark } from '@/components/brand/TaktMark';

const TABS = [
  { id: 'gantt', label: 'Gantt' },
  { id: 'board', label: 'Board' },
  { id: 'reports', label: 'Berichte' },
  { id: 'resources', label: 'Ressourcen' },
] as const;

export type ShareTab = (typeof TABS)[number]['id'];

// Eigener Rahmen statt AppHeader: Suche, Glocke, Benutzermenü und die globale
// Navigation führen alle in Bereiche, die mehr zeigen als dieses eine Projekt.
export function ShareFrame({
  token,
  tab,
  projectName,
  children,
}: {
  token: string;
  tab: ShareTab;
  projectName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="app">
      <header className="topbar">
        <span className="topbar__brand">
          <TaktMark size={22} />
          <span
            className="topbar__brand-text"
            style={{ letterSpacing: '0.04em', fontWeight: 700, fontSize: 13 }}
          >
            TAKTLINE
          </span>
        </span>
        <div className="hr-v" style={{ height: 22, alignSelf: 'center' }} />
        <nav className="topbar__nav" aria-label="Ansichten">
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={`/share/${token}/${t.id}`}
              aria-current={t.id === tab ? 'page' : undefined}
              draggable={false}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="topbar__spacer" />
        <span className="share__project">{projectName}</span>
        <span className="chip share__chip">
          <Eye size={11} />
          Nur lesen
        </span>
      </header>
      {children}
    </div>
  );
}
