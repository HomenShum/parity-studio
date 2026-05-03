import {
  Check,
  ChevronDown,
  Gauge,
  KeyRound,
  Leaf,
  type LucideIcon,
  Rocket,
  Wrench,
} from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import {
  MODEL_PRESETS,
  MODEL_PROVIDERS,
  MODEL_ROUTERS,
  type ModelOverride,
  type ModelProvider,
  type Tier,
} from '../../lib/modelRouting';

const ROUTER_ICON: Record<Tier, LucideIcon> = {
  balanced: Gauge,
  frontier: Rocket,
  free: Leaf,
};

export function ModelRoutePicker({
  tier,
  modelOverride,
  onRouter,
  onCustom,
  placement = 'up',
  width = 'min(100%, 292px)',
}: {
  tier: Tier;
  modelOverride?: ModelOverride | null;
  onRouter: (tier: Tier) => void;
  onCustom: (modelOverride: ModelOverride) => void;
  placement?: 'up' | 'down';
  width?: number | string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<ModelProvider>(modelOverride?.provider ?? 'openrouter');
  const [modelId, setModelId] = useState(modelOverride?.modelId ?? '');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = modelOverride?.modelId
    ? {
        title: modelOverride.label?.trim() || modelOverride.modelId,
        detail: `${MODEL_PROVIDERS.find((p) => p.value === modelOverride.provider)?.label ?? modelOverride.provider} / ${modelOverride.modelId}`,
        sublabel: t('model.custom'),
      }
    : {
        title: t(`model.${tier}.label`),
        detail: t(`model.${tier}.detail`),
        sublabel:
          tier === 'balanced'
            ? t('model.default')
            : tier === 'frontier'
              ? t('model.highestQuality')
              : t('model.freeRoute'),
      };
  const customActive = Boolean(modelOverride?.modelId);
  const Icon = customActive ? Wrench : ROUTER_ICON[tier];
  const tone = customActive ? customTone : routerTone(tier);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const root = rootRef.current;
      if (root && !root.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!modelOverride) return;
    setProvider(modelOverride.provider);
    setModelId(modelOverride.modelId);
  }, [modelOverride]);

  return (
    <div ref={rootRef} style={{ position: 'relative', width, maxWidth: '100%' }}>
      <button
        type="button"
        aria-label={t('model.aiChoiceWithSelection', { selection: selected.title })}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((value) => !value)}
        style={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns: '28px minmax(0, 1fr) auto',
          alignItems: 'center',
          gap: 8,
          padding: '7px 9px',
          borderRadius: 'var(--radius-lg)',
          border: `1px solid ${tone.border}`,
          background: tone.background,
          color: tone.foreground,
          boxShadow: open ? 'var(--shadow-card)' : 'var(--shadow-soft)',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 28,
            height: 28,
            borderRadius: 'var(--radius-md)',
            display: 'grid',
            placeItems: 'center',
            background: tone.iconBackground,
            color: tone.foreground,
            border: `1px solid ${tone.border}`,
          }}
        >
          <Icon size={14} />
        </span>
        <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              fontWeight: 650,
              color: 'var(--color-text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {selected.title}
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              color: 'var(--color-text-faint)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {selected.sublabel} - {selected.detail}
          </span>
        </span>
        <ChevronDown
          size={14}
          style={{
            color: 'var(--color-text-secondary)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform var(--duration-fast) var(--ease-out)',
          }}
        />
      </button>
      {open ? (
        <div
          aria-label={t('model.chooseAiModel')}
          style={{
            position: 'absolute',
            left: 0,
            [placement === 'up' ? 'bottom' : 'top']: 'calc(100% + 8px)',
            width: 360,
            maxWidth: 'calc(100vw - 48px)',
            maxHeight: 'min(70vh, 560px)',
            overflowY: 'auto',
            padding: 8,
            borderRadius: 'var(--radius-xl)',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-elevated)',
            zIndex: 80,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <MenuTitle>{t('model.aiChoice')}</MenuTitle>
          <MenuCopy>{t('model.copy')}</MenuCopy>

          {MODEL_ROUTERS.map((router) => {
            const RouterIcon = ROUTER_ICON[router.value];
            const optionTone = routerTone(router.value);
            const active = !customActive && router.value === tier;
            const right =
              router.value === 'balanced'
                ? t('model.default')
                : router.value === 'frontier'
                  ? t('model.highestQuality')
                  : t('model.freeRoute');
            return (
              <OptionButton
                key={router.value}
                active={active}
                tone={optionTone}
                onClick={() => {
                  onRouter(router.value);
                  setOpen(false);
                }}
                right={active ? t('model.active') : right}
                icon={<RouterIcon size={14} />}
                title={t(`model.${router.value}.label`)}
                detail={t(`model.${router.value}.detail`)}
              />
            );
          })}

          <MenuTitle>{t('model.advanced')}</MenuTitle>
          <MenuCopy>{t('model.advancedCopy')}</MenuCopy>

          <div style={{ display: 'grid', gap: 6 }}>
            {MODEL_PRESETS.map((preset) => {
              const active =
                customActive &&
                preset.provider === modelOverride?.provider &&
                preset.modelId === modelOverride.modelId;
              return (
                <OptionButton
                  key={`${preset.provider}:${preset.modelId}`}
                  active={active}
                  tone={customTone}
                  onClick={() => {
                    onCustom(preset);
                    setProvider(preset.provider);
                    setModelId(preset.modelId);
                    setOpen(false);
                  }}
                  right={active ? t('model.active') : preset.provider}
                  icon={<KeyRound size={14} />}
                  title={preset.label ?? preset.modelId}
                  detail={preset.modelId}
                />
              );
            })}
          </div>

          <div
            style={{
              display: 'grid',
              gap: 7,
              padding: 10,
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border-subtle)',
              background: 'var(--color-background-secondary)',
            }}
          >
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value as ModelProvider)}
              aria-label={t('model.customProvider')}
              style={fieldStyle}
            >
              {MODEL_PROVIDERS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label} ({item.envVar})
                </option>
              ))}
            </select>
            <input
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              placeholder={t('model.customModelPlaceholder')}
              aria-label={t('model.customModelId')}
              spellCheck={false}
              style={fieldStyle}
            />
            <button
              type="button"
              onClick={() => {
                const trimmed = modelId.trim();
                if (!trimmed) return;
                onCustom({ provider, modelId: trimmed, label: trimmed });
                setOpen(false);
              }}
              disabled={modelId.trim().length === 0}
              style={{
                height: 34,
                border: '1px solid var(--color-accent)',
                borderRadius: 'var(--radius-md)',
                background:
                  modelId.trim().length > 0 ? 'var(--color-accent)' : 'var(--color-surface-active)',
                color:
                  modelId.trim().length > 0 ? 'var(--color-on-accent)' : 'var(--color-text-faint)',
                cursor: modelId.trim().length > 0 ? 'pointer' : 'not-allowed',
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--font-size-body-sm)',
                fontWeight: 700,
              }}
            >
              {t('model.useCustomModel')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuTitle({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: '6px 8px 0',
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        color: 'var(--color-text-faint)',
        textTransform: 'uppercase',
        letterSpacing: 'var(--tracking-label)',
      }}
    >
      {children}
    </div>
  );
}

function MenuCopy({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: '0 8px 4px',
        fontFamily: 'var(--font-sans)',
        fontSize: 11,
        lineHeight: 1.35,
        color: 'var(--color-text-secondary)',
      }}
    >
      {children}
    </div>
  );
}

function OptionButton({
  active,
  tone,
  onClick,
  right,
  icon,
  title,
  detail,
}: {
  active: boolean;
  tone: Tone;
  onClick: () => void;
  right: string;
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  const t = useT();
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: '30px minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: 9,
        width: '100%',
        padding: '9px 10px',
        borderRadius: 'var(--radius-lg)',
        border: `1px solid ${active ? tone.border : 'transparent'}`,
        background: active ? tone.background : 'transparent',
        color: 'var(--color-text-primary)',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 30,
          height: 30,
          borderRadius: 'var(--radius-md)',
          display: 'grid',
          placeItems: 'center',
          background: tone.iconBackground,
          color: tone.foreground,
        }}
      >
        {icon}
      </span>
      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 650 }}>
          {title}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 11,
            color: 'var(--color-text-secondary)',
            lineHeight: 1.35,
          }}
        >
          {detail}
        </span>
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          color: active ? tone.foreground : 'var(--color-text-faint)',
          border: `1px solid ${active ? tone.border : 'var(--color-border-subtle)'}`,
          borderRadius: 'var(--radius-pill)',
          padding: '2px 6px',
          whiteSpace: 'nowrap',
        }}
      >
        {active ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Check size={10} />
            {t('model.active')}
          </span>
        ) : (
          right
        )}
      </span>
    </button>
  );
}

interface Tone {
  background: string;
  iconBackground: string;
  foreground: string;
  border: string;
}

function routerTone(tier: Tier): Tone {
  if (tier === 'free') {
    return {
      background: 'color-mix(in srgb, var(--color-success) 10%, var(--color-surface))',
      iconBackground: 'color-mix(in srgb, var(--color-success) 16%, var(--color-surface))',
      foreground: 'var(--color-success)',
      border: 'color-mix(in srgb, var(--color-success) 34%, var(--color-border-subtle))',
    };
  }
  if (tier === 'frontier') {
    return {
      background: 'var(--color-accent-soft)',
      iconBackground: 'color-mix(in srgb, var(--color-accent) 14%, var(--color-surface))',
      foreground: 'var(--color-accent)',
      border: 'color-mix(in srgb, var(--color-accent) 40%, var(--color-border-subtle))',
    };
  }
  return {
    background: 'linear-gradient(135deg, var(--color-surface), var(--color-surface-hover))',
    iconBackground: 'var(--color-background-secondary)',
    foreground: 'var(--color-text-secondary)',
    border: 'var(--color-border-subtle)',
  };
}

const customTone: Tone = {
  background: 'color-mix(in srgb, var(--color-warning) 12%, var(--color-surface))',
  iconBackground: 'color-mix(in srgb, var(--color-warning) 18%, var(--color-surface))',
  foreground: 'var(--color-warning)',
  border: 'color-mix(in srgb, var(--color-warning) 42%, var(--color-border-subtle))',
};

const fieldStyle: CSSProperties = {
  height: 34,
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
  padding: '0 10px',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  outline: 'none',
};
