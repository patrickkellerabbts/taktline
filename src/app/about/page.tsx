import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ExternalLink, Link2, Heart, Server, Scale } from 'lucide-react';
import { auth } from '@/auth';
import { AppHeader, SubHeader } from '@/components/layout/AppHeader';
import { TaktMark } from '@/components/brand/TaktMark';
import packageJson from '../../../package.json';

export default async function AboutPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const version = packageJson.version;
  const buildSha = process.env.NEXT_PUBLIC_BUILD_SHA ?? 'unknown';
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME ?? null;
  const buildTimeFormatted = buildTime
    ? new Date(buildTime).toLocaleString('de-DE', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—';

  // Repo-URL für Commit-Links + Source-Reference. Out-of-the-box wird die
  // public GitHub-URL genutzt; in der Self-Hosted-Variante kann sie via
  // PUBLIC_REPO_URL überschrieben werden (z.B. auf interne GitLab-Instanz).
  const gitlabUrl = process.env.GITLAB_URL ?? null;
  const repoUrl =
    process.env.PUBLIC_REPO_URL ?? 'https://github.com/patrickkellerabbts/taktline';
  // GitHub und GitLab haben unterschiedliche Commit-URL-Konventionen.
  const isGitlabRepo = /\/gitlab\./.test(repoUrl);
  const commitUrl =
    buildSha !== 'unknown'
      ? isGitlabRepo
        ? `${repoUrl}/-/commit/${buildSha}`
        : `${repoUrl}/commit/${buildSha}`
      : null;

  const techStack: Array<{ name: string; version: string }> = [
    { name: 'Next.js', version: packageJson.dependencies.next },
    { name: 'React', version: packageJson.dependencies.react },
    { name: 'Prisma', version: packageJson.dependencies['@prisma/client'] },
    { name: 'Auth.js', version: packageJson.dependencies['next-auth'] },
    { name: 'TailwindCSS', version: packageJson.devDependencies.tailwindcss },
    { name: 'TypeScript', version: packageJson.devDependencies.typescript },
  ];

  return (
    <div className="app">
      <AppHeader username={session.user.username} />
      <SubHeader crumbs={['Über Taktline']} />
      <div
        style={{
          flex: 1,
          padding: '24px 16px 40px',
          overflow: 'auto',
          display: 'flex',
          justifyContent: 'center',
          // flex-start damit der innere Wrapper seine natürliche Höhe behält
          // (sonst stretch-default → Wrapper bekommt Container-Höhe → Cards
          // shrinken statt zu scrollen).
          alignItems: 'flex-start',
          minWidth: 0,
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 720,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {/* Hero */}
          <div
            className="card"
            style={{
              padding: 28,
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              flexWrap: 'wrap',
            }}
          >
            <TaktMark size={64} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>
                Taktline
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-ink-3)', marginTop: 4 }}>
                Projektplanung mit GitLab-Anschluss
              </div>
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  color: 'var(--color-ink-4)',
                  marginTop: 8,
                  display: 'flex',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <span>v{version}</span>
                <span>·</span>
                {commitUrl ? (
                  <a
                    href={commitUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: 'var(--color-accent-h)',
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 3,
                    }}
                  >
                    {buildSha}
                    <ExternalLink size={9} />
                  </a>
                ) : (
                  <span>{buildSha}</span>
                )}
                <span>·</span>
                <span>built {buildTimeFormatted}</span>
              </div>
            </div>
          </div>

          {/* Tech-Stack */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <SectionHeading icon={<Server size={11} />} title="Tech-Stack" />
            <div className="tech-grid">
              {techStack.map((t) => (
                <div
                  key={t.name}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                    minWidth: 0,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{t.name}</div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: 'var(--color-ink-3)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t.version}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Lizenz */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <SectionHeading icon={<Scale size={11} />} title="Lizenz" />
            <div style={{ padding: '14px 16px', fontSize: 12, lineHeight: 1.6, color: 'var(--color-ink-2)' }}>
              <p style={{ margin: 0 }}>
                Taktline ist <strong>MIT-lizenziert</strong>.<br />
                <span style={{ color: 'var(--color-ink-3)' }}>
                  Copyright (c) 2026 Patrick Keller
                </span>
              </p>
              <div style={{ marginTop: 10, display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11 }}>
                {repoUrl && (
                  <a
                    href={`${repoUrl}/${isGitlabRepo ? '-/' : ''}blob/main/LICENSE`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: 'var(--color-accent-h)',
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    LICENSE-Datei <ExternalLink size={10} />
                  </a>
                )}
                {repoUrl && (
                  <a
                    href={`${repoUrl}/${isGitlabRepo ? '-/' : ''}blob/main/THIRD-PARTY-NOTICES.md`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: 'var(--color-accent-h)',
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    Third-Party-Notices <ExternalLink size={10} />
                  </a>
                )}
              </div>
              <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--color-ink-3)' }}>
                Alle Dependencies stehen unter permissiven Lizenzen (MIT, Apache-2.0,
                ISC, BSD-2, OFL-1.1) — keine Copyleft-Pflichten.
              </p>
            </div>
          </div>

          {/* Links */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <SectionHeading icon={<Link2 size={11} />} title="Links" />
            <LinkRow href={repoUrl ?? undefined} label="Source-Repository" sub={repoUrl ?? 'kein GITLAB_URL konfiguriert'} />
            {gitlabUrl && (
              <LinkRow
                href={gitlabUrl}
                label="GitLab-Instanz"
                sub={gitlabUrl}
                borderTop
              />
            )}
            <LinkRow
              href="/api/admin/reconcile"
              label="API: /api/admin/reconcile"
              sub="Manueller Reconciliation-Trigger (Bearer-Token nötig)"
              internal
              borderTop
            />
          </div>

          {/* Footer */}
          <div
            style={{
              padding: '14px 4px',
              fontSize: 11,
              color: 'var(--color-ink-4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
            }}
          >
            <Heart size={10} style={{ color: 'var(--color-status-blocked)' }} />
            <span>Gebaut für internes Projektmanagement</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeading({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div
      style={{
        padding: '10px 14px',
        background: 'var(--color-surface-2)',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--color-ink-2)',
      }}
    >
      <span style={{ color: 'var(--color-ink-3)' }}>{icon}</span>
      <span>{title}</span>
    </div>
  );
}

function LinkRow({
  href,
  label,
  sub,
  internal,
  borderTop,
}: {
  href?: string;
  label: string;
  sub: string;
  internal?: boolean;
  borderTop?: boolean;
}) {
  const baseStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 16px',
    fontSize: 12,
    color: 'var(--color-ink)',
    textDecoration: 'none',
    borderTop: borderTop ? '1px solid var(--color-border)' : undefined,
  };
  const content = (
    <>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500 }}>{label}</div>
        <div
          className="mono"
          style={{
            fontSize: 10,
            color: 'var(--color-ink-3)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {sub}
        </div>
      </div>
      {href && <ExternalLink size={11} style={{ color: 'var(--color-ink-4)' }} />}
    </>
  );
  if (!href) {
    return <div style={{ ...baseStyle, color: 'var(--color-ink-4)' }}>{content}</div>;
  }
  if (internal) {
    return (
      <Link href={href} style={baseStyle}>
        {content}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={baseStyle}>
      {content}
    </a>
  );
}
