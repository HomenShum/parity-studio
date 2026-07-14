import { useAction, useMutation, useQuery } from 'convex/react';
import {
  ArrowUp,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Copy,
  FileEdit,
  FilePlus2,
  FileText,
  FolderTree,
  ListChecks,
  type LucideIcon,
  Palette,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { useT } from '../../lib/i18n';
import type { ModelOverride, Tier } from '../../lib/modelRouting';
import { ModelRoutePicker } from '../model/ModelRoutePicker';

interface ChatPanelProps {
  runId: Id<'runs'> | null;
  variant?: 'workspace' | 'rail';
}

const TOOL_META: Record<string, { Icon: LucideIcon; labelKey: string }> = {
  list_files: { Icon: FolderTree, labelKey: 'chat.tools.list_files' },
  read_file: { Icon: FileText, labelKey: 'chat.tools.read_file' },
  read_design_system: { Icon: Palette, labelKey: 'chat.tools.read_design_system' },
  upsert_file: { Icon: FileEdit, labelKey: 'chat.tools.upsert_file' },
  set_todos: { Icon: ListChecks, labelKey: 'chat.tools.set_todos' },
  done: { Icon: CheckCircle2, labelKey: 'chat.tools.done' },
  iterate_now: { Icon: Sparkles, labelKey: 'chat.tools.iterate_now' },
};

/**
 * ChatPanel â€” turn-taking conversation with the pi-ai agent. Backed by
 * convex/chat.ts (V8 CRUD) + convex/chatLoop.ts (Node action with
 * pi-ai tool loop). The agent has atomic edit access to every file in
 * the canonical shape via upsert_file, so any preview/, assets/,
 * explorations/, or kit code path is editable from chat.
 */
export function ChatPanel({ runId, variant = 'workspace' }: ChatPanelProps) {
  const t = useT();
  const messages = useQuery(api.chat.list, runId ? { runId } : 'skip');
  const run = useQuery(api.runs.get, runId ? { runId } : 'skip');
  const send = useMutation(api.chat.send);
  const setModelSelection = useMutation(api.runs.setModelSelection);
  const enhance = useAction(api.chatLoop.enhance);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const currentTier: Tier = (run?.tier as Tier | undefined) ?? 'balanced';
  const currentModelOverride = run?.modelOverride as ModelOverride | undefined;
  async function chooseTier(tier: Tier) {
    if (!runId) return;
    await setModelSelection({ runId, tier });
  }
  async function chooseCustom(modelOverride: ModelOverride) {
    if (!runId) return;
    await setModelSelection({ runId, modelOverride });
  }

  async function onEnhance() {
    if (enhancing || draft.trim().length === 0) return;
    setEnhancing(true);
    setError(null);
    try {
      const result = await enhance(runId ? { text: draft, runId } : { text: draft });
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
            {t('chat.startTitle')}
          </h2>
          <p style={{ marginTop: 12, lineHeight: 1.5 }}>{t('chat.startBody')}</p>
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
          padding: variant === 'rail' ? 'var(--space-3)' : 'var(--space-4) var(--space-6)',
          display: 'flex',
          flexDirection: 'column',
          gap: variant === 'rail' ? 'var(--space-2)' : 'var(--space-3)',
        }}
      >
        {messages === undefined ? (
          <div
            style={{
              color: 'var(--color-text-faint)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
            }}
          >
            {t('chat.loading')}
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
              gap: 6,
              fontSize: 11,
              color: 'var(--color-text-secondary)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: 'var(--color-accent)',
                animation: 'pulse 1.2s ease-in-out infinite',
              }}
            />
            {t('chat.sending')}
          </div>
        ) : null}
      </div>

      <div
        style={{
          borderTop: '1px solid var(--color-border-subtle)',
          padding:
            variant === 'rail' ? 'var(--space-2) var(--space-3)' : 'var(--space-3) var(--space-6)',
          background: 'var(--color-background-secondary)',
        }}
      >
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-lg)',
            padding: variant === 'rail' ? 8 : 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
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
            placeholder={t('chat.placeholder')}
            aria-label={t('chat.aria')}
            rows={2}
            disabled={busy}
            style={{
              resize: 'none',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--font-size-body-sm)',
              color: 'var(--color-text-primary)',
              lineHeight: 'var(--leading-snug)',
              minHeight: variant === 'rail' ? 36 : 44,
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
              <ModelRoutePicker
                tier={currentTier}
                modelOverride={currentModelOverride ?? null}
                onRouter={(tier) => void chooseTier(tier)}
                onCustom={(modelOverride) => void chooseCustom(modelOverride)}
              />
              <span style={{ lineHeight: 1.35 }}>{error ?? t('chat.helper')}</span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                onClick={onEnhance}
                disabled={enhancing || busy || draft.trim().length === 0}
                aria-label={t('chat.enhance')}
                title={t('chat.enhanceTitle')}
                style={{
                  display: 'inline-grid',
                  placeItems: 'center',
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  background: enhancing
                    ? 'var(--color-accent-soft)'
                    : draft.trim().length === 0
                      ? 'var(--color-surface-active)'
                      : 'var(--color-surface-hover)',
                  color: enhancing
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
                aria-label={t('chat.send')}
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
  const t = useT();
  if (message.role === 'user') {
    const content = displayUserContent(message.content, t);
    return (
      <div
        style={{
          alignSelf: 'flex-end',
          maxWidth: '75%',
          background: 'var(--color-accent-soft)',
          border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
          padding: '8px 12px',
          borderRadius: 'var(--radius-lg)',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--font-size-body-sm)',
          color: 'var(--color-text-primary)',
          lineHeight: 'var(--leading-snug)',
          whiteSpace: 'pre-wrap',
        }}
      >
        {content}
      </div>
    );
  }
  if (message.role === 'tool') {
    return <ToolResultRow message={message} />;
  }
  return <AssistantRow message={message} />;
}

function AssistantRow({ message }: { message: MessageRow }) {
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasTools = message.toolCalls && message.toolCalls.length > 0;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span
        aria-hidden
        style={{
          width: 24,
          height: 24,
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-accent)',
          color: 'var(--color-on-accent)',
          display: 'inline-grid',
          placeItems: 'center',
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        <Bot size={12} />
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {message.content.length > 0 ? <MarkdownContent text={message.content} /> : null}
        {hasTools ? (
          <ToolGroup
            calls={message.toolCalls!}
            expanded={toolsExpanded}
            onToggle={() => setToolsExpanded((v) => !v)}
          />
        ) : null}
        {message.content.length > 0 ? (
          <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(message.content);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              aria-label="Copy"
              style={{
                display: 'inline-grid',
                placeItems: 'center',
                width: 24,
                height: 24,
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                background: 'transparent',
                color: copied ? 'var(--color-success)' : 'var(--color-text-faint)',
                cursor: 'pointer',
              }}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ToolGroup({
  calls,
  expanded,
  onToggle,
}: {
  calls: Array<{ id: string; name: string; args: string }>;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (calls.length === 1) {
    return <ToolCallCard call={calls[0]!} />;
  }
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          background: 'var(--color-surface-hover)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-sm)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--color-text-secondary)',
          cursor: 'pointer',
        }}
      >
        <ChevronRight
          size={11}
          style={{
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: 'transform 120ms ease',
          }}
        />
        <Wrench size={11} />
        <span>{calls.length} tool calls</span>
      </button>
      {expanded ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
          {calls.map((tc) => <ToolCallCard key={tc.id} call={tc} />)}
        </div>
      ) : null}
    </div>
  );
}

function displayUserContent(
  content: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (content.startsWith('Auto-fix triggered:')) {
    const firstLine = content.split('\n')[0]?.replace('Auto-fix triggered:', '').trim();
    return firstLine ? t('chat.askAgentToFix', { issue: firstLine }) : t('chat.askAgentDefault');
  }
  return content;
}

function MarkdownContent({ text }: { text: string }) {
  const blocks = parseMarkdownBlocks(text);
  const blockKeyCounts = new Map<string, number>();
  const nextBlockKey = (block: MarkdownBlock) => {
    const seed =
      block.type === 'paragraph' ? `p:${block.text}` : `${block.type}:${block.items.join('|')}`;
    const count = blockKeyCounts.get(seed) ?? 0;
    blockKeyCounts.set(seed, count + 1);
    return `${seed}:${count}`;
  };
  const nextItemKey = (seen: Map<string, number>, item: string) => {
    const count = seen.get(item) ?? 0;
    seen.set(item, count + 1);
    return `${item}:${count}`;
  };
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
      {blocks.map((block) => {
        if (block.type === 'ul') {
          const itemKeyCounts = new Map<string, number>();
          return (
            <ul
              key={nextBlockKey(block)}
              style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}
            >
              {block.items.map((item) => (
                <li key={nextItemKey(itemKeyCounts, item)}>{renderInlineMarkdown(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === 'ol') {
          const itemKeyCounts = new Map<string, number>();
          return (
            <ol
              key={nextBlockKey(block)}
              style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}
            >
              {block.items.map((item) => (
                <li key={nextItemKey(itemKeyCounts, item)}>{renderInlineMarkdown(item)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={nextBlockKey(block)} style={{ margin: 0 }}>
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
  const partKeyCounts = new Map<string, number>();
  return parts.map((part) => {
    const count = partKeyCounts.get(part) ?? 0;
    partKeyCounts.set(part, count + 1);
    const key = `${part}:${count}`;
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={key}
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
    return <span key={key}>{part}</span>;
  });
}

function ToolCallCard({ call }: { call: { id: string; name: string; args: string } }) {
  const t = useT();
  const knownMeta = TOOL_META[call.name];
  const meta = knownMeta ?? { Icon: Wrench, labelKey: 'chat.tools.tool' };
  const { Icon } = meta;
  const label = knownMeta ? t(meta.labelKey) : call.name;
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
        gap: 6,
        padding: '3px 8px',
        background: 'var(--color-surface-hover)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        color: 'var(--color-text-secondary)',
        alignSelf: 'flex-start',
      }}
    >
      <ToolIcon size={11} />
      <span style={{ color: 'var(--color-text-primary)' }}>{label}</span>
      {path ? (
        <span
          style={{
            color: 'var(--color-accent)',
            maxWidth: 280,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {path}
        </span>
      ) : null}
    </div>
  );
}

function ToolResultRow({ message }: { message: MessageRow }) {
  const t = useT();
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
  const knownMeta = TOOL_META[message.toolName ?? ''];
  const meta = knownMeta ?? { Icon: Wrench, labelKey: 'chat.tools.tool' };
  const { Icon } = meta;
  const label = knownMeta ? t(meta.labelKey) : (message.toolName ?? t('chat.tools.tool'));
  return (
    <div
      style={{
        marginLeft: 32,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        color: 'var(--color-text-faint)',
      }}
    >
      <Icon size={10} />
      <span>{label}</span>
      <span>{t('chat.toolComplete')}</span>
    </div>
  );
}

function TodosChecklist({ items }: { items: Array<{ text: string; checked: boolean }> }) {
  const t = useT();
  if (items.length === 0) {
    return (
      <div
        style={{
          marginLeft: 32,
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--color-text-faint)',
        }}
      >
        {t('chat.agentMadePlan')}
      </div>
    );
  }
  return (
    <div
      style={{
        marginLeft: 32,
        background: 'var(--color-surface-hover)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          letterSpacing: 'var(--tracking-eyebrow)',
          textTransform: 'uppercase',
          color: 'var(--color-text-secondary)',
          marginBottom: 1,
        }}
      >
        <ListChecks size={10} />
        {t('chat.agentPlan')} ({items.filter((i) => i.checked).length}/{items.length})
      </div>
      {items.map((it, i) => (
        <div
          key={`${i}-${it.text.slice(0, 20)}`}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--font-size-body-sm)',
            color: it.checked ? 'var(--color-text-faint)' : 'var(--color-text-primary)',
            textDecoration: it.checked ? 'line-through' : 'none',
            lineHeight: 1.4,
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
            {it.checked ? <Check size={11} /> : <Circle size={11} />}
          </span>
          <span>{it.text}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyHint() {
  const t = useT();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 'var(--space-4)',
        background: 'var(--color-surface)',
        border: '1px dashed var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--font-size-body-sm)',
        color: 'var(--color-text-secondary)',
        lineHeight: 1.5,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 18,
          color: 'var(--color-text-primary)',
          fontWeight: 400,
        }}
      >
        {t('chat.emptyTitle')}
      </div>
      <div>
        {t('chat.emptyBodyPrefix')} <em>&quot;{t('chat.emptyExample1')}&quot;</em>,{' '}
        <em>&quot;{t('chat.emptyExample2')}&quot;</em>, or{' '}
        <em>&quot;{t('chat.emptyExample3')}&quot;</em>
      </div>
    </div>
  );
}
