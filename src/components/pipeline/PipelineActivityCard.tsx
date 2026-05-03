import { Box, type LucideIcon, RotateCw, ShieldCheck, Sparkles } from 'lucide-react';
import { useT } from '../../lib/i18n';

export type PipelineStage = 'generate' | 'decompose' | 'verify' | 'iterate';
export type PipelineState = 'idle' | 'running' | 'done' | 'failed';

const STAGE_META: Record<PipelineStage, { Icon: LucideIcon }> = {
  generate: {
    Icon: Sparkles,
  },
  decompose: {
    Icon: Box,
  },
  verify: {
    Icon: ShieldCheck,
  },
  iterate: {
    Icon: RotateCw,
  },
};

const DOT_COLOR: Record<PipelineState, string> = {
  idle: 'var(--color-text-faint)',
  running: 'var(--color-warning)',
  done: 'var(--color-success)',
  failed: 'var(--color-error)',
};

export interface PipelineActivityCardProps {
  stage: PipelineStage;
  state: PipelineState;
  description?: string | undefined;
  ageLabel?: string | undefined;
  edits?: number | undefined;
  src?: number | undefined;
  onClick?: (() => void) | undefined;
  active?: boolean | undefined;
  interactive?: boolean | undefined;
}

export function PipelineActivityCard({
  stage,
  state,
  description,
  ageLabel,
  edits,
  src,
  onClick,
  active = false,
  interactive = onClick !== undefined,
}: PipelineActivityCardProps) {
  const t = useT();
  const meta = STAGE_META[stage];
  const { Icon } = meta;
  const Component = interactive ? 'button' : 'div';
  return (
    <Component
      {...(interactive ? { type: 'button', onClick } : {})}
      aria-current={active ? 'true' : undefined}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: active ? 'var(--color-accent-soft)' : 'var(--color-surface)',
        border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
        borderRadius: 'var(--radius-md)',
        padding: '12px 14px',
        cursor: interactive ? 'pointer' : 'default',
        fontFamily: 'var(--font-sans)',
        color: 'var(--color-text-primary)',
        boxShadow: 'var(--shadow-soft)',
        transition:
          'background var(--duration-faster) var(--ease-out), border-color var(--duration-faster) var(--ease-out)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            display: 'inline-grid',
            placeItems: 'center',
            width: 22,
            height: 22,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-surface-active)',
            color: 'var(--color-text-secondary)',
          }}
          aria-hidden
        >
          <Icon size={12} />
        </span>
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: DOT_COLOR[state],
          }}
        />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--font-size-mono-sm)',
            fontWeight: 500,
            color: 'var(--color-text-primary)',
            letterSpacing: '0.02em',
          }}
        >
          {t(`pipeline.stages.${stage}.label`)}
        </span>
      </div>
      <div
        style={{
          fontSize: 'var(--font-size-body-sm)',
          lineHeight: 'var(--leading-snug)',
          color: 'var(--color-text-secondary)',
          marginBottom: 10,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {description ?? t(`pipeline.stages.${stage}.description`)}
      </div>
      {ageLabel || edits !== undefined || src !== undefined ? (
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--color-text-faint)',
            display: 'flex',
            gap: 10,
            letterSpacing: '0.02em',
          }}
        >
          {ageLabel ? <span>{ageLabel}</span> : null}
          {edits !== undefined ? (
            <span>{t('pipeline.editCount', { count: edits, plural: edits === 1 ? '' : 's' })}</span>
          ) : null}
          {src !== undefined ? <span>{t('pipeline.sourceCount', { count: src })}</span> : null}
        </div>
      ) : null}
    </Component>
  );
}
