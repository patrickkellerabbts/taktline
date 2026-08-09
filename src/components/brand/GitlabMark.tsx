// GitLab-Logo, vereinfacht inline (kein externes Asset).

type Props = { size?: number };

export function GitlabMark({ size = 16 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ display: 'block' }}
    >
      <path d="M12 21.5L4 11l1.5-5L8 11h8l2.5-5L20 11 12 21.5z" fill="#fc6d26" />
      <path d="M12 21.5L8 11h8L12 21.5z" fill="#e24329" />
      <path d="M4 11l-1 4a1 1 0 0 0 .4 1.1L12 21.5 4 11z" fill="#fca326" />
      <path d="M20 11l1 4a1 1 0 0 1-.4 1.1L12 21.5 20 11z" fill="#fca326" />
    </svg>
  );
}
