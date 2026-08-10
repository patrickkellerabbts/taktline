import { redirect } from 'next/navigation';
import { Lock, AlertTriangle, PlayCircle } from 'lucide-react';
import { auth, signIn } from '@/auth';
import { TaktMark } from '@/components/brand/TaktMark';
import { GitlabMark } from '@/components/brand/GitlabMark';
import { isDemoMode } from '@/lib/demo/mode';
import { DEMO_USER_NAME } from '@/lib/demo/seed';

type Props = {
  searchParams: Promise<{ expired?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const session = await auth();
  if (session?.user) {
    redirect('/projects');
  }
  const { expired } = await searchParams;
  const showExpired = expired === '1';
  const demo = isDemoMode();
  // GitLab-Host für den Footer aus GITLAB_URL extrahieren. Fallback "GitLab"
  // falls die URL nicht parsebar ist oder gar nicht gesetzt.
  const gitlabHost = (() => {
    try {
      return new URL(process.env.GITLAB_URL ?? '').host;
    } catch {
      return 'GitLab';
    }
  })();

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        background: 'var(--color-bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Gantt-Raster im Hintergrund */}
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5 }}
        aria-hidden="true"
      >
        <defs>
          <pattern id="login-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="var(--color-border)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#login-grid)" />
      </svg>

      {/* Login-Karte */}
      <div
        className="card"
        style={{
          position: 'relative',
          width: 380,
          padding: 0,
          boxShadow: 'var(--shadow-2)',
        }}
      >
        <div
          style={{
            padding: '32px 32px 8px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <TaktMark size={44} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--color-ink)' }}>
              Anmelden bei Taktline
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-ink-3)', marginTop: 4 }}>
              Projektplanung mit GitLab-Anschluss
            </div>
          </div>
        </div>

        <div style={{ padding: '24px 32px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {showExpired && (
            <div
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '10px 12px',
                background: 'var(--color-accent-soft)',
                border: '1px solid #f5cba0',
                borderRadius: 'var(--r-3)',
                fontSize: 12,
                color: 'var(--color-accent-h)',
              }}
            >
              <AlertTriangle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
              <span>
                Die GitLab-Sitzung ist abgelaufen. Bitte erneut anmelden.
              </span>
            </div>
          )}
          {demo ? (
            <>
              <div
                style={{
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: 'var(--color-ink-3)',
                  textAlign: 'center',
                  marginBottom: 2,
                }}
              >
                Öffentliche Demo mit erfundenen Beispieldaten. Kein GitLab
                angebunden — Änderungen bleiben lokal und werden regelmässig
                zurückgesetzt.
              </div>
              <form action="/api/demo/login" method="post">
                <button
                  type="submit"
                  className="btn btn--primary btn--lg"
                  style={{ justifyContent: 'center', width: '100%' }}
                >
                  <PlayCircle size={16} />
                  <span style={{ marginLeft: 4 }}>Demo starten</span>
                </button>
              </form>
            </>
          ) : (
            <form
              action={async () => {
                'use server';
                await signIn('gitlab', { redirectTo: '/projects' });
              }}
            >
              <button
                type="submit"
                className="btn btn--primary btn--lg"
                style={{ justifyContent: 'center', width: '100%' }}
              >
                <GitlabMark size={16} />
                <span style={{ marginLeft: 4 }}>Mit GitLab anmelden</span>
              </button>
            </form>
          )}
        </div>

        <div
          style={{
            padding: '16px 32px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            fontSize: 11,
            color: 'var(--color-ink-3)',
            borderTop: '1px solid var(--color-border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Lock size={11} />
            <span>{demo ? `Angemeldet als ${DEMO_USER_NAME}` : 'SSO-Sitzung 7 Tage gültig'}</span>
          </div>
          <span style={{ color: 'var(--color-accent-h)', fontWeight: 500 }}>
            {demo ? 'Demo' : gitlabHost}
          </span>
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 11,
          color: 'var(--color-ink-4)',
        }}
        className="mono"
      >
        taktline · v0.4.2 · dev
      </div>
    </div>
  );
}
