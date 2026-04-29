import { ArrowDown, Image as ImageIcon, MessageSquare, MousePointer2, Package, Pencil, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const STEPS: Array<{ n: string; Icon: LucideIcon; title: string; body: string }> = [
  {
    n: '01',
    Icon: ImageIcon,
    title: 'Drop a gpt-image-2 image',
    body: 'Or generate one on the spot from a text prompt — sparkles ✨ in the composer.',
  },
  {
    n: '02',
    Icon: Sparkles,
    title: 'Break it into UI components',
    body: 'Exact parity, not approximations. The decomposer emits real .tsx components + tokens.css.',
  },
  {
    n: '03',
    Icon: MousePointer2,
    title: 'Select a component',
    body: 'Click any file in the tree — the next comment scopes to that component, not the whole artifact.',
  },
  {
    n: '04',
    Icon: MessageSquare,
    title: 'Comment on it',
    body: 'Drop a pinned bbox on the rendered preview, or a free-form note. Comment mode lives in the top-right.',
  },
  {
    n: '05',
    Icon: Pencil,
    title: 'Iterate the scoped slice',
    body: 'Iterate now folds your comment + selected file into a re-decompose. The previous bundle stays intact.',
  },
  {
    n: '06',
    Icon: Package,
    title: 'Export as a ui design kit',
    body: 'One-click ZIP of the ui_kit/<slug>/ tree — handoff to Claude Code / Cursor / Windsurf.',
  },
];

/**
 * LandingGuidance — visible in the canvas center when no run is active.
 *
 * Mirrors the README's "6-step user flow" verbatim so a first-time visitor
 * sees the entire mental model before they click anything. Every step
 * points at the surface that fulfills it (composer, file tree, top-right
 * cluster, etc.) so the layout is self-documenting.
 */
export function LandingGuidance() {
  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: 'var(--space-9) var(--space-7) var(--space-12)',
      }}
    >
      <div
        style={{
          maxWidth: 880,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--space-7)',
        }}
      >
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: 'var(--tracking-eyebrow)',
              color: 'var(--color-text-secondary)',
              textTransform: 'uppercase',
            }}
          >
            New design session
          </span>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--font-size-display-xl)',
              fontWeight: 400,
              lineHeight: 'var(--leading-heading)',
              letterSpacing: '-0.02em',
              color: 'var(--color-text-primary)',
              margin: 0,
            }}
          >
            Image to verified ui_kit, in six steps.
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--font-size-body-lg)',
              color: 'var(--color-text-secondary)',
              lineHeight: 'var(--leading-snug)',
              maxWidth: 620,
              margin: '0 auto',
            }}
          >
            Drop a sketch. Watch the agent break it into real components. Comment, iterate, export — every step honest, every cost shown, every parity check named.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 'var(--space-3)',
            width: '100%',
          }}
        >
          {STEPS.map((s) => {
            const { Icon } = s;
            return (
              <div
                key={s.n}
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 'var(--space-4)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  boxShadow: 'var(--shadow-soft)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span
                    style={{
                      display: 'inline-grid',
                      placeItems: 'center',
                      width: 28,
                      height: 28,
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--color-accent-soft)',
                      color: 'var(--color-accent)',
                    }}
                    aria-hidden
                  >
                    <Icon size={14} />
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      letterSpacing: '0.08em',
                      color: 'var(--color-text-faint)',
                    }}
                  >
                    {s.n}
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: 'var(--font-size-body)',
                    fontWeight: 600,
                    color: 'var(--color-text-primary)',
                    lineHeight: 'var(--leading-snug)',
                  }}
                >
                  {s.title}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: 'var(--font-size-body-sm)',
                    color: 'var(--color-text-secondary)',
                    lineHeight: 'var(--leading-snug)',
                  }}
                >
                  {s.body}
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 18px',
            borderRadius: 'var(--radius-pill)',
            background: 'var(--color-accent-soft)',
            border: '1px solid var(--color-accent)',
            color: 'var(--color-accent)',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--font-size-body-sm)',
            fontWeight: 500,
          }}
        >
          <ArrowDown size={14} />
          Start from the composer in the bottom-left rail
        </div>
      </div>
    </div>
  );
}
