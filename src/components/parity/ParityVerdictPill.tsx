import { useT } from '../../lib/i18n';

export type Verdict = 'pass' | 'warn' | 'fail' | 'unavailable';

const COLOR: Record<Verdict, { bg: string; fg: string }> = {
  pass: { bg: 'transparent', fg: 'var(--color-success)' },
  warn: { bg: 'transparent', fg: 'var(--color-warning)' },
  fail: { bg: 'transparent', fg: 'var(--color-error)' },
  unavailable: { bg: 'transparent', fg: 'var(--color-text-faint)' },
};

export function ParityVerdictPill({ verdict }: { verdict: Verdict }) {
  const t = useT();
  const c = COLOR[verdict];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: c.fg,
        fontWeight: 500,
      }}
    >
      <span aria-hidden style={{ fontSize: 9 }}>
        {'>'}
      </span>
      {t(`parity.verdict.${verdict}`)}
    </span>
  );
}
