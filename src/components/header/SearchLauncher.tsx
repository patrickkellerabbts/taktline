'use client';

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { SearchModal } from './SearchModal';

// Ersetzt das passive Suchfeld + Icon im Header. Click oder Cmd+K öffnet
// das zentrierte Search-Modal. Beide Trigger-Varianten (wide input-style
// und narrow icon-only) sind enthalten — CSS schaltet via Responsive-Klassen.
export function SearchLauncher() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      {/* Wide-Modus: sieht aus wie das frühere Input, ist aber ein Button.
          `display` kommt aus globals.css — nicht inline setzen damit die
          @media-Regeln (narrow-mode hide) nicht durch Inline-Specificity
          überschrieben werden. */}
      <button
        type="button"
        className="topbar__search-wide"
        onClick={() => setOpen(true)}
        title="Suchen (⌘K)"
        style={{
          position: 'relative',
          alignItems: 'center',
          gap: 8,
          width: 240,
          height: 28,
          padding: '0 10px 0 28px',
          border: '1px solid var(--color-border-2)',
          background: 'var(--color-surface)',
          borderRadius: 'var(--r-2)',
          color: 'var(--color-ink-3)',
          fontSize: 12,
          fontFamily: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
          transition: 'border-color .12s, background .12s',
        }}
      >
        <Search
          size={13}
          style={{
            position: 'absolute',
            left: 8,
            top: '50%',
            transform: 'translateY(-50%)',
          }}
        />
        <span style={{ flex: 1 }}>Suchen …</span>
        <kbd
          className="mono"
          style={{
            fontSize: 9,
            padding: '1px 4px',
            border: '1px solid var(--color-border)',
            borderRadius: 3,
            color: 'var(--color-ink-3)',
            background: 'var(--color-surface-2)',
          }}
        >
          ⌘K
        </kbd>
      </button>

      {/* Narrow-Modus: nur Icon */}
      <button
        type="button"
        className="btn btn--ghost btn--icon topbar__search-icon"
        title="Suchen (⌘K)"
        aria-label="Suchen"
        onClick={() => setOpen(true)}
      >
        <Search size={15} />
      </button>

      <SearchModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
