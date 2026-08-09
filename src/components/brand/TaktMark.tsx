// Taktline Brand-Mark: geometrisches Quadrat mit gestaffelten Balken + Diamant.
// Funktioniert ab 16px. Verwendung: Header (22px), Login (44px), Hero (96px).

type Props = {
  size?: number;
  inverted?: boolean;
};

export function TaktMark({ size = 28 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <rect x="0" y="0" width="32" height="32" rx="5" fill="#e8590c" />
      <rect x="5" y="9" width="16" height="3.5" rx="1.2" fill="#fff" />
      <rect x="9" y="14.25" width="14" height="3.5" rx="1.2" fill="#fff" />
      <rect x="5" y="19.5" width="11" height="3.5" rx="1.2" fill="#fff" />
      <path d="M25 8 L28 11 L25 14 L22 11 Z" fill="#fff" />
    </svg>
  );
}

type WordmarkProps = {
  size?: number;
  withMark?: boolean;
  color?: string;
};

export function TaktWordmark({ size = 18, withMark = true, color }: WordmarkProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontWeight: 700,
        fontSize: size,
        letterSpacing: '0.08em',
        color: color ?? 'var(--color-ink)',
        lineHeight: 1,
      }}
    >
      {withMark && <TaktMark size={size * 1.3} />}
      <span>TAKTLINE</span>
    </span>
  );
}
