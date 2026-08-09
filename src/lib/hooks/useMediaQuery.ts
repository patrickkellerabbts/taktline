'use client';

import { useEffect, useState } from 'react';

// SSR-safe matchMedia-Hook. Beim ersten Render (Server + initiales Client-Render)
// wird `defaultValue` zurückgegeben — danach übernimmt das echte matchMedia.
// `defaultValue` für mobile-first-Defaults sinnvoll setzen (z.B. true für
// "narrow" bei der typischen iPad-Annahme).
export function useMediaQuery(query: string, defaultValue = false): boolean {
  const [matches, setMatches] = useState<boolean>(defaultValue);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);

  return matches;
}

// Projekt-Breakpoints (siehe globals.css `--bp-*`). Praktische Helfer damit
// Strings konsistent bleiben.
export const BP = {
  // Unter 900px: zu schmal — Hinweis-Screen wird gezeigt
  TOO_NARROW: '(max-width: 899px)',
  // 900-1199px: iPad-Landscape und kleine Laptops — Tab-Switch + Ribbon-Collapse
  NARROW: '(max-width: 1199px)',
} as const;
