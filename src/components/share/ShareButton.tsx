'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { Check, Copy, Share2, X } from 'lucide-react';
import {
  createShareLinkAction,
  listShareLinksAction,
  revokeShareLinkAction,
  type ShareLinkRow,
} from '@/app/projects/[id]/share-actions';

const DEFAULT_LIFETIME_DAYS = 90;

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('de-CH', { timeZone: 'UTC' });
}

function statusOf(link: ShareLinkRow): { text: string; active: boolean } {
  if (link.revokedAt) return { text: 'Widerrufen', active: false };
  if (new Date(link.expiresAt).getTime() <= Date.now()) return { text: 'Abgelaufen', active: false };
  return { text: `Gültig bis ${formatDay(link.expiresAt)}`, active: true };
}

export function ShareButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn--sm"
        onClick={() => setOpen(true)}
        title="Lese-Link für Personen ohne GitLab-Konto"
      >
        <Share2 size={12} />
        <span className="btn-narrow-label">Teilen</span>
      </button>
      {open && <ShareDialog projectId={projectId} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [links, setLinks] = useState<ShareLinkRow[] | null>(null);
  const [label, setLabel] = useState('');
  const [expiresOn, setExpiresOn] = useState(() => isoDay(DEFAULT_LIFETIME_DAYS));
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reload = useCallback(
    () =>
      listShareLinksAction(projectId).then((result) => {
        if (result.ok) setLinks(result.links);
        else setError(result.error);
      }),
    [projectId],
  );

  useEffect(() => {
    let active = true;
    void listShareLinksAction(projectId).then((result) => {
      if (!active) return;
      if (result.ok) setLinks(result.links);
      else setError(result.error);
    });
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function create() {
    if (!label.trim() || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await createShareLinkAction(projectId, { label, expiresOn });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCreatedUrl(`${result.baseUrl ?? window.location.origin}${result.path}`);
      setCopied(false);
      setLabel('');
      await reload();
    });
  }

  function revoke(link: ShareLinkRow) {
    if (!window.confirm(`Link „${link.label}“ widerrufen? Er funktioniert danach sofort nicht mehr.`)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await revokeShareLinkAction(projectId, link.id);
      if (!result.ok) setError(result.error);
      await reload();
    });
  }

  async function copy() {
    if (!createdUrl) return;
    try {
      await navigator.clipboard.writeText(createdUrl);
      setCopied(true);
    } catch {
      // Ohne HTTPS gibt es keine Clipboard-API; das Feld bleibt zum Markieren.
      setError('Kopieren nicht möglich. Bitte den Link im Feld markieren und kopieren.');
    }
  }

  return (
    <div className="story-dialog__backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Lese-Links verwalten"
        className="card story-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card__hd">
          <span style={{ fontWeight: 600, fontSize: 14 }}>Lese-Links</span>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            onClick={onClose}
            title="Schliessen"
            aria-label="Schliessen"
          >
            <X size={12} />
          </button>
        </div>

        <div className="card__bd story-dialog__body">
          <p className="share__hint">
            Wer den Link hat, sieht ohne Anmeldung Gantt, Board, Berichte und Ressourcen dieses
            Projekts, inklusive der Namen zugewiesener Personen. Risiken bleiben verborgen und ändern
            lässt sich nichts.
          </p>

          <div className="story-dialog__row">
            <div className="story-dialog__field">
              <label className="label" htmlFor="share-label">
                Für wen?
              </label>
              <input
                id="share-label"
                className="input"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="z.B. Dozent Projektmanagement"
                maxLength={100}
                disabled={pending}
                autoFocus
              />
            </div>
            <div className="story-dialog__field" style={{ flex: '0 0 170px' }}>
              <label className="label" htmlFor="share-expires">
                Gültig bis
              </label>
              <input
                id="share-expires"
                type="date"
                className="input mono"
                value={expiresOn}
                min={isoDay(1)}
                max={isoDay(365)}
                onChange={(e) => setExpiresOn(e.target.value)}
                disabled={pending}
              />
            </div>
          </div>
          <div>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={create}
              disabled={!label.trim() || !expiresOn || pending}
            >
              {pending ? 'Bitte warten…' : 'Link erstellen'}
            </button>
          </div>

          {createdUrl && (
            <div className="share__created">
              <label className="label" htmlFor="share-url">
                Neuer Link: Er wird nur jetzt angezeigt
              </label>
              <div className="share__url-row">
                <input
                  id="share-url"
                  className="input mono"
                  readOnly
                  value={createdUrl}
                  onFocus={(e) => e.target.select()}
                />
                <button type="button" className="btn btn--sm" onClick={copy}>
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'Kopiert' : 'Kopieren'}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div role="alert" className="story-dialog__error">
              {error}
            </div>
          )}

          <div>
            <span className="label">Bestehende Links</span>
            {links === null && !error && <p className="share__hint">Lade…</p>}
            {links?.length === 0 && <p className="share__hint">Noch keine Links erstellt.</p>}
            {links && links.length > 0 && (
              <ul className="share__list">
                {links.map((link) => {
                  const status = statusOf(link);
                  return (
                    <li key={link.id} className="share__row" data-active={status.active ? '' : undefined}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="share__row-title">{link.label}</div>
                        <div className="share__row-meta">
                          {status.text}
                          {' · '}
                          {link.lastUsedAt
                            ? `zuletzt geöffnet ${formatDay(link.lastUsedAt)}`
                            : 'noch nie geöffnet'}
                          {link.createdBy ? ` · von ${link.createdBy}` : ''}
                        </div>
                      </div>
                      {status.active && (
                        <button
                          type="button"
                          className="btn btn--sm"
                          onClick={() => revoke(link)}
                          disabled={pending}
                        >
                          Widerrufen
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
