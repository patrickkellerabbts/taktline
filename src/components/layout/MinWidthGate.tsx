import { Monitor } from 'lucide-react';

// Wird auf <900px sichtbar (via CSS @media). Hinweist den Benutzer dass das
// Display zu schmal ist. Das Rendering bleibt parallel zur App im DOM —
// keine Conditional-Rendering-Logik nötig.
export function MinWidthGate() {
  return (
    <div className="min-width-gate" role="alert">
      <div className="min-width-gate__icon">
        <Monitor size={48} strokeWidth={1.5} color="var(--color-ink-3)" />
      </div>
      <div className="min-width-gate__title">Display zu schmal</div>
      <div className="min-width-gate__msg">
        Taktline benötigt mindestens 900&nbsp;Pixel Breite.
        <br />
        Bitte drehe das Gerät ins Querformat oder verwende ein größeres Display.
      </div>
    </div>
  );
}
