import { Info } from 'lucide-react';
import { useT } from '../../lib/i18n';

interface CostTelemetryProps {
  totalMicroUsd: number;
  generateMicroUsd: number;
  decomposeMicroUsd: number;
  verifyMicroUsd: number;
}

function fmt(micro: number): string {
  return `$${(micro / 1_000_000).toFixed(4)}`;
}

const CELL: React.CSSProperties = {
  background: 'var(--color-surface-hover)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

export function CostTelemetry({
  totalMicroUsd,
  generateMicroUsd,
  decomposeMicroUsd,
  verifyMicroUsd,
}: CostTelemetryProps) {
  const t = useT();
  const cells = [
    { label: t('cost.total'), value: fmt(totalMicroUsd), accent: true },
    { label: t('cost.generate'), value: fmt(generateMicroUsd) },
    { label: t('cost.decompose'), value: fmt(decomposeMicroUsd) },
    { label: t('cost.verify'), value: fmt(verifyMicroUsd) },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'var(--font-sans)',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 'var(--tracking-eyebrow)',
          color: 'var(--color-text-secondary)',
          textTransform: 'uppercase',
        }}
      >
        <span aria-hidden style={{ fontSize: 13 }}>
          $
        </span>
        {t('cost.telemetry')}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
        }}
      >
        {cells.map((c) => (
          <div key={c.label} style={CELL}>
            <span
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: '0.06em',
                color: 'var(--color-text-secondary)',
                textTransform: 'uppercase',
              }}
            >
              {c.label}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                fontWeight: 600,
                color: c.accent ? 'var(--color-text-primary)' : 'var(--color-text-primary)',
              }}
            >
              {c.value}
            </span>
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--color-text-faint)',
        }}
      >
        {t('cost.typical')}
        <Info size={11} aria-hidden />
      </div>
    </div>
  );
}
