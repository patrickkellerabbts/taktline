'use client';

import { useState, useTransition } from 'react';
import { MousePointerClick, Check, ChevronRight, Wrench, RotateCcw } from 'lucide-react';
import type { UserPreferences } from '@/lib/preferences';
import {
  PINCH_SENSITIVITY_DEFAULT,
  PINCH_SMOOTHING_DEFAULT,
  PINCH_LOCK_MS_DEFAULT,
} from '@/lib/preferences';
import { savePreferencesAction } from '@/lib/preferences-actions';

export function SettingsForm({ initialPrefs }: { initialPrefs: UserPreferences }) {
  // Optimistic local state: jeder Toggle wirkt sofort, Server-Save läuft im
  // Hintergrund. Bei Fehler bleibt der lokale Wert trotzdem stehen — beim
  // nächsten Page-Load wird er aus der DB überschrieben.
  const [prefs, setPrefs] = useState<UserPreferences>(initialPrefs);
  const [saved, setSaved] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [, startTransition] = useTransition();

  function update(patch: UserPreferences) {
    setPrefs((p) => ({ ...p, ...patch }));
    startTransition(async () => {
      await savePreferencesAction(patch);
      setSaved(true);
      // Kurz "Gespeichert" zeigen, dann wieder ausblenden.
      setTimeout(() => setSaved(false), 1500);
    });
  }

  return (
    <>
      {/* Hero */}
      <div
        className="card"
        style={{
          padding: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em' }}>
            Einstellungen
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-ink-3)', marginTop: 4 }}>
            Werden automatisch gespeichert
          </div>
        </div>
        <div
          aria-live="polite"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: 'var(--color-status-done)',
            opacity: saved ? 1 : 0,
            transition: 'opacity .2s',
          }}
        >
          <Check size={14} />
          <span>Gespeichert</span>
        </div>
      </div>

      {/* Gantt-Verhalten */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <SectionHeading icon={<MousePointerClick size={11} />} title="Gantt-Verhalten" />
        <ToggleRow
          label="Klick in leeren Bereich schliesst Inspector"
          description="Wenn aktiv, wird das Inspector-Panel geschlossen sobald du irgendwo im Gantt-Chart auf eine leere Stelle klickst. Deaktiviere dies, falls du den Inspector lieber manuell zu macht."
          checked={prefs.closeInspectorOnEmptyClick !== false}
          onChange={(v) => update({ closeInspectorOnEmptyClick: v })}
        />
      </div>

      {/* Erweitert — collapsed by default */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          style={{
            width: '100%',
            padding: '10px 14px',
            background: 'var(--color-surface-2)',
            borderBottom: advancedOpen ? '1px solid var(--color-border)' : 'none',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--color-ink-2)',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <Wrench size={11} style={{ color: 'var(--color-ink-3)' }} />
          <span style={{ flex: 1 }}>Erweitert</span>
          <ChevronRight
            size={12}
            style={{
              color: 'var(--color-ink-3)',
              transform: advancedOpen ? 'rotate(90deg)' : undefined,
              transition: 'transform .12s',
            }}
          />
        </button>
        {advancedOpen && (
          <div>
            <div
              style={{
                padding: '10px 16px',
                fontSize: 11,
                color: 'var(--color-ink-3)',
                background: 'var(--color-surface)',
                borderBottom: '1px solid var(--color-border)',
                lineHeight: 1.5,
              }}
            >
              Feintuning für Pinch-Zoom (macOS-Trackpad). Bei den Defaults
              belassen, falls die Zoom-Geste sich gut anfühlt.
            </div>
            <SliderRow
              label="Zoom-Empfindlichkeit"
              description="Wie schnell der Zoom auf die Pinch-Geste reagiert."
              value={prefs.pinchSensitivity ?? PINCH_SENSITIVITY_DEFAULT}
              min={0.01}
              max={0.1}
              step={0.005}
              defaultValue={PINCH_SENSITIVITY_DEFAULT}
              format={(v) => v.toFixed(3)}
              onChange={(v) => update({ pinchSensitivity: v })}
              onReset={() => update({ pinchSensitivity: PINCH_SENSITIVITY_DEFAULT })}
              borderTop
            />
            <SliderRow
              label="Smoothing (Inertia)"
              description="Niedriger = weicheres Ausklingen der Zoom-Bewegung, höher = sofortiger Stopp."
              value={prefs.pinchSmoothing ?? PINCH_SMOOTHING_DEFAULT}
              min={0.1}
              max={1.0}
              step={0.05}
              defaultValue={PINCH_SMOOTHING_DEFAULT}
              format={(v) => v.toFixed(2)}
              onChange={(v) => update({ pinchSmoothing: v })}
              onReset={() => update({ pinchSmoothing: PINCH_SMOOTHING_DEFAULT })}
              borderTop
            />
            <SliderRow
              label="Pinch-Lock (ms)"
              description="Wie lange nach dem Pinch normale Scroll-Events noch blockiert werden, um Drift zu vermeiden."
              value={prefs.pinchLockMs ?? PINCH_LOCK_MS_DEFAULT}
              min={0}
              max={500}
              step={10}
              defaultValue={PINCH_LOCK_MS_DEFAULT}
              format={(v) => `${Math.round(v)}`}
              onChange={(v) => update({ pinchLockMs: Math.round(v) })}
              onReset={() => update({ pinchLockMs: PINCH_LOCK_MS_DEFAULT })}
              borderTop
            />
          </div>
        )}
      </div>
    </>
  );
}

function SliderRow({
  label,
  description,
  value,
  min,
  max,
  step,
  defaultValue,
  format,
  onChange,
  onReset,
  borderTop,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  onReset: () => void;
  borderTop?: boolean;
}) {
  const isDefault = value === defaultValue;
  return (
    <div
      style={{
        padding: '12px 16px',
        borderTop: borderTop ? '1px solid var(--color-border)' : undefined,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink)' }}>
            {label}
          </div>
          {description && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--color-ink-3)',
                marginTop: 2,
                lineHeight: 1.4,
              }}
            >
              {description}
            </div>
          )}
        </div>
        <span
          className="mono tabnum"
          style={{
            fontSize: 12,
            color: 'var(--color-ink)',
            minWidth: 56,
            textAlign: 'right',
          }}
        >
          {format(value)}
        </span>
        <button
          type="button"
          onClick={onReset}
          disabled={isDefault}
          title="Auf Default zurücksetzen"
          style={{
            border: '1px solid var(--color-border)',
            background: 'transparent',
            color: 'var(--color-ink-3)',
            borderRadius: 'var(--r-2)',
            padding: 4,
            cursor: isDefault ? 'default' : 'pointer',
            opacity: isDefault ? 0.4 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <RotateCcw size={11} />
        </button>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%' }}
      />
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

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  borderTop,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  borderTop?: boolean;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 16px',
        borderTop: borderTop ? '1px solid var(--color-border)' : undefined,
        cursor: 'pointer',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink)' }}>
          {label}
        </div>
        {description && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-ink-3)',
              marginTop: 4,
              lineHeight: 1.5,
            }}
          >
            {description}
          </div>
        )}
      </div>
      <Switch checked={checked} onChange={onChange} ariaLabel={label} />
    </label>
  );
}

function Switch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={(e) => {
        // <label>-Wrapper würde sonst doppelt feuern.
        e.preventDefault();
        onChange(!checked);
      }}
      style={{
        position: 'relative',
        width: 36,
        height: 20,
        flexShrink: 0,
        borderRadius: 999,
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        background: checked ? 'var(--color-accent)' : 'var(--color-border-2)',
        transition: 'background .12s',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
          transition: 'left .12s',
        }}
      />
    </button>
  );
}
