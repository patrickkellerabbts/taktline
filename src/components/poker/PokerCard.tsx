import { Coffee } from 'lucide-react';
import { pokerCard, type PokerCardValue } from '@/lib/agile/poker';

// Eine Spielkarte. Vorderseite: Farbe wird von kleinen zu grossen Werten wärmer,
// damit man die Streuung beim Aufdecken auf einen Blick sieht. Rückseite im
// Taktline-Orange mit dem Logo. Das Umdrehen ist reines CSS (3D-Flip).

type Size = 'hand' | 'table' | 'mini';

type Props = {
  value: PokerCardValue | null;
  /** Rückseite zeigen. Wechselt das auf false, dreht sich die Karte um. */
  faceDown?: boolean;
  size?: Size;
  selected?: boolean;
  /** Markiert die höchste oder niedrigste Karte nach dem Aufdecken. */
  highlight?: 'min' | 'max' | null;
  /** Verzögerung fürs Umdrehen, damit die Karten nacheinander kippen. */
  flipDelayMs?: number;
};

function tone(value: PokerCardValue): string {
  switch (value) {
    case '0':
    case '0.5':
    case '1':
      return 'teal';
    case '2':
    case '3':
      return 'blue';
    case '5':
    case '8':
      return 'orange';
    case '13':
    case '20':
      return 'red';
    case '40':
    case '100':
      return 'violet';
    case '?':
      return 'slate';
    case 'coffee':
      return 'coffee';
  }
}

function Face({ value }: { value: PokerCardValue }) {
  const card = pokerCard(value);
  const glyph = value === 'coffee' ? <Coffee className="pcard__glyph-icon" strokeWidth={2.2} /> : card.face;
  const corner = value === 'coffee' ? <Coffee size={11} strokeWidth={2.4} /> : card.face;
  return (
    <div className="pcard__face pcard__front" data-tone={tone(value)}>
      <span className="pcard__corner pcard__corner--tl">
        {corner}
        <i className="pcard__pip" />
      </span>
      <span className="pcard__corner pcard__corner--br">
        {corner}
        <i className="pcard__pip" />
      </span>
      <span className="pcard__center">
        <span className="pcard__glyph" data-long={card.face.length > 2 ? '' : undefined}>
          {glyph}
        </span>
        <span className="pcard__caption">{card.caption}</span>
      </span>
    </div>
  );
}

function Back() {
  return (
    <div className="pcard__face pcard__back" aria-hidden="true">
      <div className="pcard__back-frame">
        <svg viewBox="0 0 32 32" className="pcard__back-mark">
          <rect x="5" y="9" width="16" height="3.5" rx="1.2" fill="currentColor" />
          <rect x="9" y="14.25" width="14" height="3.5" rx="1.2" fill="currentColor" />
          <rect x="5" y="19.5" width="11" height="3.5" rx="1.2" fill="currentColor" />
          <path d="M25 8 L28 11 L25 14 L22 11 Z" fill="currentColor" />
        </svg>
        <span className="pcard__back-word">TAKTLINE</span>
      </div>
    </div>
  );
}

export function PokerCard({ value, faceDown = false, size = 'table', selected, highlight, flipDelayMs = 0 }: Props) {
  return (
    <div
      className="pcard"
      data-size={size}
      data-selected={selected ? '' : undefined}
      data-highlight={highlight ?? undefined}
      data-down={faceDown || value === null ? '' : undefined}
      style={{ '--flip-delay': `${flipDelayMs}ms` } as React.CSSProperties}
    >
      <div className="pcard__inner">
        {value !== null ? <Face value={value} /> : <div className="pcard__face pcard__front" data-tone="slate" />}
        <Back />
      </div>
    </div>
  );
}
