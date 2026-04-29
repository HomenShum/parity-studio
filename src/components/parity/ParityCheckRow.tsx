import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { ParityVerdictPill, type Verdict } from './ParityVerdictPill';

export interface ParityCheckRowProps {
  number: number;
  label: string;
  verdict: Verdict;
  evidence?: string[];
}

export function ParityCheckRow({ number, label, verdict, evidence = [] }: ParityCheckRowProps) {
  const [expanded, setExpanded] = useState(false);
  const expandable = evidence.length > 0;
  const verdictColor =
    verdict === 'pass'
      ? 'var(--color-text-primary)'
      : verdict === 'warn'
        ? 'var(--color-warning)'
        : verdict === 'fail'
          ? 'var(--color-error)'
          : 'var(--color-text-faint)';

  return (
    <div
      style={{
        borderBottom: '1px solid var(--color-border-subtle)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--font-size-body-sm)',
      }}
    >
      <button
        type="button"
        onClick={() => expandable && setExpanded((v) => !v)}
        aria-expanded={expanded}
        disabled={!expandable}
        style={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns: '24px 1fr auto 16px',
          alignItems: 'center',
          gap: 'var(--space-3)',
          background: 'transparent',
          border: 'none',
          padding: '10px var(--space-5)',
          cursor: expandable ? 'pointer' : 'default',
          textAlign: 'left',
          color: verdictColor,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--color-text-faint)',
          }}
        >
          {String(number).padStart(2, '0')}
        </span>
        <span
          style={{
            color: verdict === 'pass' ? 'var(--color-text-primary)' : verdictColor,
            fontWeight: verdict === 'fail' ? 500 : 400,
          }}
        >
          {label}
        </span>
        <ParityVerdictPill verdict={verdict} />
        {expandable ? (
          expanded ? (
            <ChevronDown size={13} style={{ color: 'var(--color-text-faint)' }} />
          ) : (
            <ChevronRight size={13} style={{ color: 'var(--color-text-faint)' }} />
          )
        ) : (
          <span aria-hidden />
        )}
      </button>
      {expandable && expanded ? (
        <div
          style={{
            background: 'var(--color-surface-hover)',
            padding: '10px 14px 12px 38px',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-text-secondary)',
            lineHeight: 'var(--leading-snug)',
            borderTop: '1px solid var(--color-border-subtle)',
            borderBottom: '1px solid var(--color-border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {evidence.map((line, i) => (
            <span key={i}>{line}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
