import { useAction, useMutation, useQuery } from 'convex/react';
import {
  ArrowUp,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  FileEdit,
  FilePlus2,
  FileText,
  FolderTree,
  Gauge,
  Leaf,
  ListChecks,
  type LucideIcon,
  Palette,
  Rocket,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

interface ChatPanelProps {
  runId: Id<'runs'> | null;
  variant?: 'workspace' | 'rail';
}

const TOOL_META: Record<string, { Icon: LucideIcon; label: string }> = {
  list_files: { Icon: FolderTree, label: 'list_files' },
  read_file: { Icon: FileText, label: 'read_file' },
  read_design_system: { Icon: Palette, label: 'read_design_system' },
  upsert_file: { Icon: FileEdit, label: 'upsert_file' },
  set_todos: { Icon: ListChecks, label: 'set_todos' },
  done: { Icon: CheckCircle2, label: 'done' },
  iterate_now: { Icon: Sparkles, label: 'iterate_now' },
};

type Tier = 'frontier' | 'balanced' | 'free';

const MODEL_ROUTERS: Array<{
  value: Tier;
  label: string;
  sublabel: string;
  detail: string;
}> = [
  {
    value: 'balanced',
    label: 'Balanced router',
    sublabel: 'default',
    detail: 'Claude + Kimi route for quality/cost balance',
  },
  {
    value: 'frontier',
    label: 'Frontier models',
    sublabel: 'highest quality',
    detail: 'Opus/Sonnet route for hard edits',
  },
  {
    value: 'free',
    label: 'Free model router',
    sublabel: '$0 LLM route',
    detail: 'OpenRouter free pool with paid fallback only if required',
  },
];

const ROUTER_ICON: Record<Tier, LucideIcon> = {
  balanced: Gauge,
  frontier: Rocket,
  free: Leaf,
};

/**
 * ChatPanel — turn-taking conversation with the pi-ai agent. Backed by
 * convex/chat.ts (V8 CRUD) + convex/chatLoop.ts (Node action with
 * pi-ai tool loop). The agent has atomic edit access to every file in
 * the canonical shape via upsert_file, so any preview/, assets/,
 * explorations/, or kit code path is editable from chat.
 */
export function ChatPanel({ runId, variant = 'workspace' }: ChatPanelProps) {
  const messages = useQuery(api.chat.list, runId ? { runId } : 'skip');
  const run = useQuery(api.runs.get, runId ? { runId } : 'skip');
  const send = useMutation(api.chat.send);
  const setTier = useMutation(api.runs.setTier);
  const enhance = useAction(api.chatLoop.enhance);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const currentTier: Tier = ((run?.tier as Tier | undefined) ?? 'balanced');
  async function chooseTier(tier: Tier) {
    if (!runId) return;
    await setTier({ runId, tier });
  }

  async function onEnhance() {
    if (enhancing || draft.trim().length === 0) return;
    setEnhancing(true);
    setError(null);
    try {
      const result = await enhance({ text: draft });
      setDraft(result.text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnhancing(false);
    }
  }

  // Auto-scroll to the bottom whenever new turns arrive.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new messages
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages?.length]);

  if (runId === null) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: variant === 'rail' ? 'var(--space-5)' : 'var(--space-7)',
          textAlign: 'center',
          color: 'var(--color-text-secondary)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <Bot size={28} aria-hidden style={{ color: 'var(--color-accent)', marginBottom: 12 }} />
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: variant === 'rail' ? 22 : 28,
              fontWeight: 400,
              margin: 0,
              color: 'var(--color-text-primary)',
            }}
          >
            Start a run to chat.
          </h2>
          <p style={{ marginTop: 12, lineHeight: 1.5 }}>
            The agent edits any file in the canonical shape via tool calls. Start or import a source below.
          </p>
        </div>
      </div>
    );
  }

  async function onSubmit() {
    if (!runId) return;
    const text = draft.trim();
    if (text.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      await send({ runId, text });
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const turns = messages ?? [];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        minHeight: 0,
        minWidth: 0,
      }}
    >
      <div
        ref={scrollerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: variant === 'rail' ? 'var(--space-4)' : 'var(--space-6) var(--space-7)',
          display: 'flex',
          flexDirection: 'column',
          gap: variant === 'rail' ? 'var(--space-3)' : 'var(--space-4)',
        }}
      >
        {messages === undefined ? (
          <div style={{ color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            loading conversation…
          </div>
        ) : turns.length === 0 ? (
          <EmptyHint />
        ) : (
          turns.map((m) => <Turn key={String(m._id)} message={m} />)
        )}
        {busy ? (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 'var(--font-size-body-sm)',
              color: 'var(--color-text-secondary)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--color-accent)',
                animation: 'pulse 1.2s ease-in-out infinite',
              }}
            />
            sending…
          </div>
        ) : null}
      </div>

      <div
        style={{
          borderTop: '1px solid var(--color-border-subtle)',
          padding: variant === 'rail' ? 'var(--space-3) var(--space-4)' : 'var(--space-4) var(--space-7)',
          background: 'var(--color-background-secondary)',
        }}
      >
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-lg)',
            padding: variant === 'rail' ? 10 : 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (!busy) void onSubmit();
              }
            }}
            placeholder="Tell the agent what to change... 'soften the radius on Card to 12px and update the preview' / 'rewrite assets/og-foo.svg with darker text'"
            aria-label="Chat with the parity-studio agent"
            rows={3}
            disabled={busy}
            style={{
              resize: 'none',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--font-size-body)',
              color: 'var(--color-text-primary)',
              lineHeight: 'var(--leading-snug)',
              minHeight: variant === 'rail' ? 48 : 60,
            }}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 4,
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--color-text-faint)',
                minWidth: 0,
                flex: 1,
              }}
            >
              <RouterSelect currentTier={currentTier} onSelect={(tier) => void chooseTier(tier)} />
              <span style={{ lineHeight: 1.35 }}>
                {error ?? 'cmd/ctrl + enter to send - sparkle rewrites the draft before sending (~$0.002)'}
              </span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                onClick={onEnhance}
                disabled={enhancing || busy || draft.trim().length === 0}
                aria-label="Rewrite draft before sending with the small model"
                title="Rewrite your draft into a clearer, more specific prompt before sending. Uses the small model and costs about $0.002 per call."
                style={{
                  display: 'inline-grid',
                  placeItems: 'center',
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  background:
                    enhancing
                      ? 'var(--color-accent-soft)'
                      : draft.trim().length === 0
                        ? 'var(--color-surface-active)'
                        : 'var(--color-surface-hover)',
                  color:
                    enhancing
                      ? 'var(--color-accent)'
                      : draft.trim().length === 0
                        ? 'var(--color-text-faint)'
                        : 'var(--color-text-primary)',
                  border: `1px solid ${enhancing ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                  cursor: enhancing || draft.trim().length === 0 ? 'not-allowed' : 'pointer',
                  animation: enhancing ? 'pulse 1.2s ease-in-out infinite' : 'none',
                }}
              >
                <Sparkles size={13} />
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={busy || draft.trim().length === 0}
                aria-label="Send to agent"
                style={{
                  display: 'inline-grid',
                  placeItems: 'center',
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  background:
                    busy || draft.trim().length === 0
                      ? 'var(--color-surface-active)'
                      : 'var(--color-accent)',
                  color:
                    busy || draft.trim().length === 0
                      ? 'var(--color-text-faint)'
                      : 'var(--color-on-accent)',
                  border: 'none',
                  cursor: busy || draft.trim().length === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                <ArrowUp size={13} />
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function RouterSelect({
  currentTier,
  onSelect,
}: {
  currentTier: Tier;
  onSelect: (tier: Tier) => void;
}) {
  const selected = MODEL_ROUTERS.find((router) => router.value === currentTier) ?? (MODEL_ROUTERS[0] as (typeof MODEL_ROUTERS)[number]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const Icon = ROUTER_ICON[currentTier];
  const tone = routerTone(currentTier);

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

  return (
    <div
      ref={rootRef}
      style={{
        position: 'relative',
        width: 'min(100%, 292px)',
        maxWidth: '100%',
      }}
    >
      <button
        type="button"
        aria-label="Model router"
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
          transition: 'border-color var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out)',
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
            {selected.label}
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
          role="listbox"
          aria-label="Choose model router"
          style={{
            position: 'absolute',
            left: 0,
            bottom: 'calc(100% + 8px)',
            width: 338,
            maxWidth: 'calc(100vw - 48px)',
            padding: 6,
            borderRadius: 'var(--radius-xl)',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-elevated)',
            zIndex: 60,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div
            style={{
              padding: '6px 8px 4px',
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              color: 'var(--color-text-faint)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-label)',
            }}
          >
            Model routing
          </div>
          {MODEL_ROUTERS.map((router) => {
            const RouterIcon = ROUTER_ICON[router.value];
            const optionTone = routerTone(router.value);
            const active = router.value === currentTier;
            return (
              <button
                key={router.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onSelect(router.value);
                  setOpen(false);
                }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '30px minmax(0, 1fr) auto',
                  alignItems: 'center',
                  gap: 9,
                  width: '100%',
                  padding: '9px 10px',
                  borderRadius: 'var(--radius-lg)',
                  border: `1px solid ${active ? optionTone.border : 'transparent'}`,
                  background: active ? optionTone.background : 'transparent',
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
                    background: optionTone.iconBackground,
                    color: optionTone.foreground,
                  }}
                >
                  <RouterIcon size={14} />
                </span>
                <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 650 }}>
                    {router.label}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontSize: 11,
                      color: 'var(--color-text-secondary)',
                      lineHeight: 1.35,
                    }}
                  >
                    {router.detail}
                  </span>
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    color: active ? optionTone.foreground : 'var(--color-text-faint)',
                    border: `1px solid ${active ? optionTone.border : 'var(--color-border-subtle)'}`,
                    borderRadius: 'var(--radius-pill)',
                    padding: '2px 6px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {active ? 'Active' : router.sublabel}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function routerTone(tier: Tier): {
  background: string;
  iconBackground: string;
  foreground: string;
  border: string;
} {
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

interface MessageRow {
  _id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: Array<{ id: string; name: string; args: string }>;
  toolName?: string;
  modelId?: string;
  costMicroUsd?: number;
}

function Turn({ message }: { message: MessageRow }) {
  if (message.role === 'user') {
    return (
      <div
        style={{
          alignSelf: 'flex-end',
          maxWidth: '75%',
          background: 'var(--color-accent-soft)',
          border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
          padding: '10px 14px',
          borderRadius: 'var(--radius-lg)',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--font-size-body)',
          color: 'var(--color-text-primary)',
          lineHeight: 'var(--leading-snug)',
          whiteSpace: 'pre-wrap',
        }}
      >
        {message.content}
      </div>
    );
  }
  if (message.role === 'tool') {
    return <ToolResultRow message={message} />;
  }
  return <AssistantRow message={message} />;
}

function AssistantRow({ message }: { message: MessageRow }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span
        aria-hidden
        style={{
          width: 28,
          height: 28,
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-accent)',
          color: 'var(--color-on-accent)',
          display: 'inline-grid',
          placeItems: 'center',
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        <Bot size={14} />
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {message.content.length > 0 ? (
          <MarkdownContent text={message.content} />
        ) : null}
        {message.toolCalls && message.toolCalls.length > 0
          ? message.toolCalls.map((tc) => <ToolCallCard key={tc.id} call={tc} />)
          : null}
        {message.modelId ? (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--color-text-faint)',
              display: 'inline-flex',
              gap: 8,
            }}
          >
            <span>{message.modelId}</span>
            {message.costMicroUsd !== undefined && message.costMicroUsd > 0 ? (
              <span>· ${(message.costMicroUsd / 1_000_000).toFixed(4)}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MarkdownContent({ text }: { text: string }) {
  const blocks = parseMarkdownBlocks(text);
  return (
    <div
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--font-size-body)',
        color: 'var(--color-text-primary)',
        lineHeight: 1.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {blocks.map((block, index) => {
        if (block.type === 'ul') {
          return (
            <ul key={index} style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
              {block.items.map((item, itemIndex) => (
                <li key={`${itemIndex}-${item.slice(0, 20)}`}>{renderInlineMarkdown(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === 'ol') {
          return (
            <ol key={index} style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
              {block.items.map((item, itemIndex) => (
                <li key={`${itemIndex}-${item.slice(0, 20)}`}>{renderInlineMarkdown(item)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={index} style={{ margin: 0 }}>
            {renderInlineMarkdown(block.text)}
          </p>
        );
      })}
    </div>
  );
}

type MarkdownBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] };

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: Extract<MarkdownBlock, { type: 'ul' | 'ol' }> | null = null;

  function flushParagraph() {
    if (paragraph.length === 0) return;
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  }

  function flushList() {
    if (!list) return;
    blocks.push(list);
    list = null;
  }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      if (!list || list.type !== 'ul') {
        flushList();
        list = { type: 'ul', items: [] };
      }
      list.items.push(unordered[1] as string);
      continue;
    }

    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (!list || list.type !== 'ol') {
        flushList();
        list = { type: 'ol', items: [] };
      }
      list.items.push(ordered[1] as string);
      continue;
    }

    flushList();
    paragraph.push(line.replace(/^#{1,3}\s+/, ''));
  }

  flushParagraph();
  flushList();
  return blocks.length > 0 ? blocks : [{ type: 'paragraph', text }];
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={index}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.92em',
            background: 'var(--color-surface-hover)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
            padding: '1px 4px',
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

function ToolCallCard({ call }: { call: { id: string; name: string; args: string } }) {
  const meta = TOOL_META[call.name] ?? { Icon: Wrench, label: call.name };
  const { Icon } = meta;
  let argsObj: Record<string, unknown> = {};
  try {
    argsObj = JSON.parse(call.args);
  } catch {}
  const path = (argsObj['path'] as string) ?? '';
  const isCreate = call.name === 'upsert_file' && path !== '';
  const ToolIcon = isCreate ? FilePlus2 : Icon;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        background: 'var(--color-surface-hover)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: 'var(--color-text-secondary)',
        alignSelf: 'flex-start',
      }}
    >
      <ToolIcon size={12} />
      <span style={{ color: 'var(--color-text-primary)' }}>{meta.label}</span>
      {path ? (
        <span style={{ color: 'var(--color-accent)', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {path}
        </span>
      ) : null}
    </div>
  );
}

function ToolResultRow({ message }: { message: MessageRow }) {
  // Set_todos special-case: render an inline checklist instead of plain text.
  if (message.toolName === 'set_todos' && message.content.startsWith('__todos__:')) {
    try {
      const items = JSON.parse(message.content.slice('__todos__:'.length)) as Array<{
        text: string;
        checked: boolean;
      }>;
      return <TodosChecklist items={items} />;
    } catch {
      // fall through to default text rendering
    }
  }
  const [open, setOpen] = useState(false);
  const meta = TOOL_META[message.toolName ?? ''] ?? { Icon: Wrench, label: message.toolName ?? 'tool' };
  const { Icon } = meta;
  const preview = message.content.split('\n').slice(0, 1).join('').slice(0, 100);
  const hasMore = message.content.length > preview.length;
  return (
    <div style={{ marginLeft: 38 }}>
      <button
        type="button"
        onClick={() => hasMore && setOpen((v) => !v)}
        disabled={!hasMore}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: 'transparent',
          border: 'none',
          padding: 0,
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--color-text-faint)',
          cursor: hasMore ? 'pointer' : 'default',
        }}
      >
        {hasMore ? (open ? <ChevronDown size={11} /> : <ChevronRight size={11} />) : <span style={{ width: 11 }} />}
        <Icon size={11} />
        <span style={{ color: 'var(--color-text-secondary)' }}>{meta.label}</span>
        <span>·</span>
        <span style={{ maxWidth: 480, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {preview}
        </span>
      </button>
      {open ? (
        <pre
          style={{
            marginTop: 6,
            padding: '10px 12px',
            background: 'var(--color-surface-hover)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--color-text-secondary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 320,
            overflow: 'auto',
          }}
        >
          {message.content}
        </pre>
      ) : null}
    </div>
  );
}

function TodosChecklist({ items }: { items: Array<{ text: string; checked: boolean }> }) {
  if (items.length === 0) {
    return (
      <div
        style={{
          marginLeft: 38,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--color-text-faint)',
        }}
      >
        (set_todos called with empty list)
      </div>
    );
  }
  return (
    <div
      style={{
        marginLeft: 38,
        background: 'var(--color-surface-hover)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: 'var(--tracking-eyebrow)',
          textTransform: 'uppercase',
          color: 'var(--color-text-secondary)',
          marginBottom: 2,
        }}
      >
        <ListChecks size={11} />
        Plan ({items.filter((i) => i.checked).length}/{items.length})
      </div>
      {items.map((it, i) => (
        <div
          key={`${i}-${it.text.slice(0, 20)}`}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--font-size-body-sm)',
            color: it.checked ? 'var(--color-text-faint)' : 'var(--color-text-primary)',
            textDecoration: it.checked ? 'line-through' : 'none',
            lineHeight: 1.5,
          }}
        >
          <span
            aria-hidden
            style={{
              flexShrink: 0,
              marginTop: 2,
              color: it.checked ? 'var(--color-success)' : 'var(--color-text-faint)',
            }}
          >
            {it.checked ? <Check size={13} /> : <Circle size={13} />}
          </span>
          <span>{it.text}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyHint() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 'var(--space-6)',
        background: 'var(--color-surface)',
        border: '1px dashed var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--font-size-body-sm)',
        color: 'var(--color-text-secondary)',
        lineHeight: 1.6,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 22,
          color: 'var(--color-text-primary)',
          fontWeight: 400,
        }}
      >
        Talk to the agent.
      </div>
      <div>The agent has atomic edit access to every file in the canonical shape:</div>
      <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
        <li>
          <code>ui_kits/&lt;slug&gt;/components/*.tsx</code> — your active product code
        </li>
        <li>
          <code>preview/component-*.html</code>, <code>preview/tokens-*.html</code> — specimen
          pages
        </li>
        <li>
          <code>assets/logo-mark.svg</code>, <code>assets/og-&lt;slug&gt;.svg</code> — brand
        </li>
        <li>
          <code>explorations/iter-N.html</code> — iteration history
        </li>
        <li>
          <code>README.md</code>, <code>SKILL.md</code>, <code>colors_and_type.css</code> — top-level docs
        </li>
      </ul>
      <div>
        Try: <em>"add a new preview page for an outlined Button variant"</em> or{' '}
        <em>"rewrite the og card to use a darker background"</em>.
      </div>
    </div>
  );
}
