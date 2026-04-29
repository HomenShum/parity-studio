import { useMutation, useQuery } from 'convex/react';
import {
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronRight,
  FileEdit,
  FilePlus2,
  FileText,
  FolderTree,
  type LucideIcon,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

interface ChatPanelProps {
  runId: Id<'runs'> | null;
}

const TOOL_META: Record<string, { Icon: LucideIcon; label: string }> = {
  list_files: { Icon: FolderTree, label: 'list_files' },
  read_file: { Icon: FileText, label: 'read_file' },
  upsert_file: { Icon: FileEdit, label: 'upsert_file' },
  iterate_now: { Icon: Sparkles, label: 'iterate_now' },
};

/**
 * ChatPanel — turn-taking conversation with the pi-ai agent. Backed by
 * convex/chat.ts (V8 CRUD) + convex/chatLoop.ts (Node action with
 * pi-ai tool loop). The agent has atomic edit access to every file in
 * the canonical shape via upsert_file, so any preview/, assets/,
 * explorations/, or kit code path is editable from chat.
 */
export function ChatPanel({ runId }: ChatPanelProps) {
  const messages = useQuery(api.chat.list, runId ? { runId } : 'skip');
  const send = useMutation(api.chat.send);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

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
          padding: 'var(--space-7)',
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
              fontSize: 28,
              fontWeight: 400,
              margin: 0,
              color: 'var(--color-text-primary)',
            }}
          >
            Start a run to chat.
          </h2>
          <p style={{ marginTop: 12, lineHeight: 1.5 }}>
            The agent edits any file in the canonical shape via tool calls — drop an image, a kit
            zip, or a prompt into the composer first, then come back here.
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
          padding: 'var(--space-6) var(--space-7)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
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
          padding: 'var(--space-4) var(--space-7)',
          background: 'var(--color-background-secondary)',
        }}
      >
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-lg)',
            padding: 12,
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
            placeholder="Tell the agent what to change… 'soften the radius on Card to 12px and update the preview' / 'rewrite assets/og-foo.svg with darker text'"
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
              minHeight: 60,
            }}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--color-text-faint)',
              }}
            >
              {error ?? 'cmd/ctrl + ⏎ to send · agent can read, write, and create any canonical-shape file'}
            </span>
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
          <div
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--font-size-body)',
              color: 'var(--color-text-primary)',
              lineHeight: 'var(--leading-snug)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {message.content}
          </div>
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
