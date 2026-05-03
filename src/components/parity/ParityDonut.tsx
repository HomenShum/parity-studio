import { useT } from '../../lib/i18n';

interface ParityDonutProps {
  pass: number;
  warn: number;
  fail: number;
  unavailable?: number;
  size?: number;
  thickness?: number;
}

const COLORS = {
  pass: 'var(--color-success)',
  warn: 'var(--color-warning)',
  fail: 'var(--color-error)',
  unavailable: 'var(--color-border)',
} as const;

/**
 * SVG donut visualizing the pass/warn/fail/unavailable mix.
 * Pure derivation — no animation, no DOM weight.
 */
export function ParityDonut({
  pass,
  warn,
  fail,
  unavailable = 0,
  size = 92,
  thickness = 12,
}: ParityDonutProps) {
  const t = useT();
  const total = Math.max(1, pass + warn + fail + unavailable);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const order: Array<keyof typeof COLORS> = ['pass', 'warn', 'fail', 'unavailable'];
  const counts = { pass, warn, fail, unavailable };
  let acc = 0;
  return (
    <svg
      width={size}
      height={size}
      role="img"
      aria-label={t('parity.donutLabel', { pass, warn, fail })}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--color-border-subtle)"
        strokeWidth={thickness}
      />
      {order.map((key) => {
        const v = counts[key];
        if (v === 0) return null;
        const dash = (v / total) * c;
        const offset = -acc;
        acc += dash;
        return (
          <circle
            key={key}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={COLORS[key]}
            strokeWidth={thickness}
            strokeDasharray={`${dash} ${c - dash}`}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dasharray var(--duration-base) var(--ease-out)' }}
          />
        );
      })}
    </svg>
  );
}
