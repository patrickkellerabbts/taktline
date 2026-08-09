'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { resyncProjectAction } from './actions';

type Props = {
  projectId: string;
};

export function ResyncButton({ projectId }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function onClick() {
    setError(null);
    startTransition(async () => {
      const result = await resyncProjectAction(projectId);
      if (!result.ok) {
        if (result.sessionExpired) {
          // Session ist tot — direkt auf Signout-Route schicken, callback führt
          // zurück auf /login?expired=1
          window.location.href = '/api/auth/signout?callbackUrl=/login%3Fexpired%3D1';
          return;
        }
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="btn btn--sm"
        title="Aktuelle Issues und Meilensteine aus GitLab neu laden"
      >
        <RefreshCw size={12} className={pending ? 'animate-spin' : undefined} />
        <span className="btn-narrow-label">
          {pending ? 'Synchronisiere…' : 'Synchronisieren'}
        </span>
      </button>
      {error && (
        <span style={{ fontSize: 10, color: 'var(--color-status-blocked)' }}>{error}</span>
      )}
    </>
  );
}
