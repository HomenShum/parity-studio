import { useMutation, useQuery } from 'convex/react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

/**
 * CommentOverlay — drop a comment on the rendered preview.
 *
 * Two modes coexist:
 *
 *   1. **Element-click** (default in comment mode): click any element in
 *      the iframe; a helper script (injected by ArtifactPreview when
 *      commentModeActive=true) posts the element's selector + normalized
 *      rect via `window.postMessage`. The overlay shows an anchored
 *      bubble with quick-action buttons (spacing/contrast/text/radius)
 *      that pre-fill the comment text.
 *
 *   2. **Drag-bbox** (legacy): drag a region for free-form scoping
 *      when the user wants a region that doesn't map to a single
 *      element. Tiny drags collapse to whole-artifact comments.
 *
 * Quick actions mirror OCD's shape — each button writes a short, scoped
 * instruction the iterate / chat agent can act on without ambiguity.
 */
interface CommentOverlayProps {
  runId: Id<'runs'> | null;
  artifactVersion: number;
  active: boolean;
  /** Optional ui_kit file path to scope the next comment to (set via FilesPanel click). */
  targetFile?: string | null;
  /**
   * Optional: switch to the chat tab when an auto-fix kicks off so the
   * user sees the advisor-executor conversation unfold.
   */
  onAutoFixKicked?: () => void;
}

interface DraftBbox {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
}

interface PendingComment {
  bbox: { x: number; y: number; w: number; h: number };
  /** Optional CSS selector, populated when a click came from the iframe helper. */
  selector?: string;
  /** Optional element label like "BUTTON · Continue" for the bubble header. */
  elementLabel?: string;
}

const QUICK_ACTIONS: Array<{ id: string; label: string; template: (el?: string) => string }> = [
  { id: 'space-up', label: '+ space', template: (el) => `Increase spacing on ${el ?? 'this element'} by ~25%.` },
  { id: 'space-down', label: '− space', template: (el) => `Decrease spacing on ${el ?? 'this element'} by ~25%.` },
  { id: 'contrast-up', label: '+ contrast', template: (el) => `Increase the contrast on ${el ?? 'this element'} so foreground/background diverge more clearly.` },
  { id: 'contrast-down', label: '− contrast', template: (el) => `Soften the contrast on ${el ?? 'this element'} — pull the foreground/background tones closer together.` },
  { id: 'text-up', label: '+ text', template: (el) => `Make the type larger on ${el ?? 'this element'} (~+1 size step) and tighten line-height.` },
  { id: 'text-down', label: '− text', template: (el) => `Make the type smaller on ${el ?? 'this element'} (~-1 size step).` },
  { id: 'radius-up', label: '+ radius', template: (el) => `Round ${el ?? 'this element'} more — use the next-larger radius token.` },
  { id: 'radius-down', label: '− radius', template: (el) => `Sharpen ${el ?? 'this element'} — use a smaller radius token (or 0 for crisp).` },
];

export function CommentOverlay({
  runId,
  artifactVersion,
  active,
  targetFile,
  onAutoFixKicked,
}: CommentOverlayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<DraftBbox | null>(null);
  const [pending, setPending] = useState<PendingComment | null>(null);
  const [pendingText, setPendingText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation(api.comments.create);
  const dismiss = useMutation(api.comments.dismiss);
  const startAdviseLoop = useMutation(api.chat.startAdviseLoop);
  const comments = useQuery(api.comments.listForRun, runId ? { runId } : 'skip');

  // Listen for element-click events posted from the iframe helper script.
  // The script only fires when commentModeActive=true (it's injected
  // conditionally by ArtifactPreview).
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data as { type?: string; selector?: string; rect?: { x: number; y: number; w: number; h: number }; tagName?: string; text?: string } | null;
      if (!data || data.type !== 'parity:element-click') return;
      if (!active || !runId) return;
      if (!data.rect) return;
      const label = data.tagName
        ? `${data.tagName.toUpperCase()}${data.text ? ` · ${data.text.slice(0, 40)}${data.text.length > 40 ? '…' : ''}` : ''}`
        : undefined;
      setPending({
        bbox: data.rect,
        ...(data.selector ? { selector: data.selector } : {}),
        ...(label ? { elementLabel: label } : {}),
      });
      setPendingText('');
      setError(null);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [active, runId]);

  function relCoords(e: React.PointerEvent<HTMLDivElement>): { x: number; y: number } | null {
    const el = containerRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!active || pending !== null) return;
    const c = relCoords(e);
    if (!c) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraft({ startX: c.x, startY: c.y, curX: c.x, curY: c.y });
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (draft === null) return;
    const c = relCoords(e);
    if (!c) return;
    setDraft({ ...draft, curX: c.x, curY: c.y });
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (draft === null) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const x = Math.min(draft.startX, draft.curX);
    const y = Math.min(draft.startY, draft.curY);
    const w = Math.abs(draft.curX - draft.startX);
    const h = Math.abs(draft.curY - draft.startY);
    setDraft(null);
    if (w < 0.005 && h < 0.005) {
      // Tiny drag — let the iframe's element-click flow handle it
      // (the click event will fire postMessage). Don't trap as a bbox.
      return;
    }
    setPending({ bbox: { x, y, w, h } });
  }

  async function onSubmit(textOverride?: string, autoFix = false) {
    if (runId === null || pending === null) return;
    const text = (textOverride ?? pendingText).trim();
    if (text.length === 0) {
      setError('write something or pick a quick action');
      return;
    }
    setError(null);
    try {
      const args: {
        runId: Id<'runs'>;
        artifactVersion: number;
        text: string;
        bbox?: { x: number; y: number; w: number; h: number };
        targetFile?: string;
      } = {
        runId,
        artifactVersion,
        text,
      };
      const isWhole =
        pending.bbox.x === 0 &&
        pending.bbox.y === 0 &&
        pending.bbox.w === 1 &&
        pending.bbox.h === 1;
      if (!isWhole) args.bbox = pending.bbox;
      if (targetFile && targetFile.length > 0) args.targetFile = targetFile;
      const commentId = await create(args);
      setPending(null);
      setPendingText('');
      if (autoFix) {
        await startAdviseLoop({
          runId,
          kind: 'comment',
          commentId,
        });
        if (onAutoFixKicked) onAutoFixKicked();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function onCancel() {
    setPending(null);
    setPendingText('');
    setError(null);
  }

  function applyQuickAction(template: (el?: string) => string) {
    const text = template(pending?.elementLabel);
    setPendingText(text);
    // Quick actions auto-fix: the user picked a precise template, so we
    // can confidently kick off the advisor-executor without a second click.
    void onSubmit(text, true);
  }

  const overlayStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    pointerEvents: active || pending !== null ? 'auto' : 'none',
    cursor: active && pending === null ? 'crosshair' : 'default',
  };

  return (
    <div
      ref={containerRef}
      style={overlayStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {(comments ?? []).map((c) => {
        if (c.bbox === undefined) return null;
        const dimColor =
          c.status === 'open'
            ? 'var(--color-accent)'
            : c.status === 'addressed'
              ? 'var(--color-success)'
              : 'var(--color-text-faint)';
        return (
          <div
            key={c._id}
            style={{
              position: 'absolute',
              left: `${c.bbox.x * 100}%`,
              top: `${c.bbox.y * 100}%`,
              width: `${c.bbox.w * 100}%`,
              height: `${c.bbox.h * 100}%`,
              border: `2px solid ${dimColor}`,
              borderRadius: 4,
              pointerEvents: 'auto',
              cursor: 'pointer',
              opacity: c.status === 'open' ? 0.85 : 0.55,
            }}
            title={`${c.status}: ${c.text}`}
            onDoubleClick={() => void dismiss({ commentId: c._id })}
          />
        );
      })}

      {draft !== null ? (
        <div
          style={{
            position: 'absolute',
            left: `${Math.min(draft.startX, draft.curX) * 100}%`,
            top: `${Math.min(draft.startY, draft.curY) * 100}%`,
            width: `${Math.abs(draft.curX - draft.startX) * 100}%`,
            height: `${Math.abs(draft.curY - draft.startY) * 100}%`,
            border: '2px dashed var(--color-accent)',
            background: 'var(--color-accent-soft)',
            pointerEvents: 'none',
          }}
        />
      ) : null}

      {pending !== null ? (
        <PendingBubble
          pending={pending}
          text={pendingText}
          onChange={setPendingText}
          onSubmit={(autoFix) => void onSubmit(undefined, autoFix)}
          onCancel={onCancel}
          onQuickAction={applyQuickAction}
          error={error}
        />
      ) : null}
    </div>
  );
}

function PendingBubble({
  pending,
  text,
  onChange,
  onSubmit,
  onCancel,
  onQuickAction,
  error,
}: {
  pending: PendingComment;
  text: string;
  onChange: (next: string) => void;
  onSubmit: (autoFix: boolean) => void;
  onCancel: () => void;
  onQuickAction: (template: (el?: string) => string) => void;
  error: string | null;
}) {
  // Anchor below the bbox; if the bbox is in the bottom 30%, anchor above.
  const anchorAbove = pending.bbox.y + pending.bbox.h > 0.7;
  return (
    <>
      {/* Highlight ring around the targeted region */}
      <div
        style={{
          position: 'absolute',
          left: `${pending.bbox.x * 100}%`,
          top: `${pending.bbox.y * 100}%`,
          width: `${pending.bbox.w * 100}%`,
          height: `${pending.bbox.h * 100}%`,
          border: '2px solid var(--color-accent)',
          borderRadius: 4,
          background: 'var(--color-accent-soft)',
          pointerEvents: 'none',
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.04)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: `${Math.max(0, Math.min(0.5, pending.bbox.x)) * 100}%`,
          ...(anchorAbove
            ? { bottom: `${(1 - pending.bbox.y) * 100}%`, marginBottom: 8 }
            : { top: `${(pending.bbox.y + pending.bbox.h) * 100}%`, marginTop: 8 }),
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-elevated)',
          padding: 12,
          width: 320,
          zIndex: 20,
          pointerEvents: 'auto',
          fontFamily: 'var(--font-sans)',
        }}
      >
        {pending.elementLabel ? (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--color-text-secondary)',
              letterSpacing: 'var(--tracking-eyebrow)',
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
            {pending.elementLabel}
          </div>
        ) : null}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 4,
            marginBottom: 8,
          }}
        >
          {QUICK_ACTIONS.map((qa) => (
            <button
              key={qa.id}
              type="button"
              onClick={() => onQuickAction(qa.template)}
              style={{
                padding: '5px 4px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border-subtle)',
                background: 'var(--color-surface-hover)',
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                cursor: 'pointer',
                textAlign: 'center',
              }}
              title={qa.template(pending.elementLabel)}
            >
              {qa.label}
            </button>
          ))}
        </div>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Or write your own — what should change here?"
          style={{
            width: '100%',
            minHeight: 60,
            background: 'var(--color-surface-hover)',
            border: '1px solid var(--color-border-subtle)',
            color: 'var(--color-text-primary)',
            borderRadius: 'var(--radius-sm)',
            padding: 8,
            fontSize: 13,
            fontFamily: 'var(--font-sans)',
            resize: 'vertical',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        {error !== null ? (
          <div
            style={{
              color: 'var(--color-error)',
              fontSize: 11,
              marginTop: 6,
              fontFamily: 'var(--font-mono)',
            }}
          >
            {error}
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border-subtle)',
              background: 'transparent',
              color: 'var(--color-text-secondary)',
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(false)}
            disabled={text.trim().length === 0}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border-subtle)',
              background: 'var(--color-surface)',
              color:
                text.trim().length === 0 ? 'var(--color-text-faint)' : 'var(--color-text-primary)',
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              cursor: text.trim().length === 0 ? 'not-allowed' : 'pointer',
            }}
            title="Save the comment for the next manual iterate. Won't kick off any LLM calls."
          >
            save
          </button>
          <button
            type="button"
            onClick={() => onSubmit(true)}
            disabled={text.trim().length === 0}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background:
                text.trim().length === 0 ? 'var(--color-surface-active)' : 'var(--color-accent)',
              color:
                text.trim().length === 0 ? 'var(--color-text-faint)' : 'var(--color-on-accent)',
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              fontWeight: 500,
              cursor: text.trim().length === 0 ? 'not-allowed' : 'pointer',
            }}
            title="Save the comment AND kick off the advisor-executor agent to fix it now."
          >
            ✨ save + auto-fix
          </button>
        </div>
      </div>
    </>
  );
}
