import { useMutation, useQuery } from 'convex/react';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

interface CommentOverlayProps {
  runId: Id<'runs'> | null;
  artifactVersion: number;
  active: boolean;
  messageToken: string;
  targetFile?: string | null;
  onAutoFixKicked?: () => void;
}

interface Bbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DraftBbox {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
}

interface PendingComment {
  bbox: Bbox;
  selector?: string;
  domPath?: string;
  elementLabel?: string;
  tagName?: string;
  textSnippet?: string;
  componentHint?: string;
}

interface VisibleComment {
  _id: Id<'comments'>;
  artifactVersion: number;
  status: 'open' | 'addressed' | 'dismissed';
  text: string;
  bbox?: Bbox;
  targetFile?: string;
  selector?: string;
  elementLabel?: string;
  textSnippet?: string;
}

const QUICK_ACTIONS: Array<{ id: string; label: string; template: (el?: string) => string }> = [
  {
    id: 'space-up',
    label: '+ space',
    template: (el) => `Increase spacing on ${el ?? 'this element'} by about 25%.`,
  },
  {
    id: 'space-down',
    label: '- space',
    template: (el) => `Decrease spacing on ${el ?? 'this element'} by about 25%.`,
  },
  {
    id: 'contrast-up',
    label: '+ contrast',
    template: (el) =>
      `Increase the contrast on ${el ?? 'this element'} so foreground and background separate clearly.`,
  },
  {
    id: 'contrast-down',
    label: '- contrast',
    template: (el) => `Soften the contrast on ${el ?? 'this element'} without losing readability.`,
  },
  {
    id: 'text-up',
    label: '+ text',
    template: (el) => `Make the type larger on ${el ?? 'this element'} and tighten line-height.`,
  },
  {
    id: 'text-down',
    label: '- text',
    template: (el) => `Make the type smaller on ${el ?? 'this element'} by one size step.`,
  },
  {
    id: 'radius-up',
    label: '+ radius',
    template: (el) => `Round ${el ?? 'this element'} more using the next-larger radius token.`,
  },
  {
    id: 'radius-down',
    label: '- radius',
    template: (el) => `Sharpen ${el ?? 'this element'} with a smaller radius token.`,
  },
];

export function CommentOverlay({
  runId,
  artifactVersion,
  active,
  messageToken,
  targetFile,
  onAutoFixKicked,
}: CommentOverlayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<DraftBbox | null>(null);
  const [pending, setPending] = useState<PendingComment | null>(null);
  const [pendingText, setPendingText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [regionMode, setRegionMode] = useState(false);
  const [notesVisible, setNotesVisible] = useState(true);

  const create = useMutation(api.comments.create);
  const dismiss = useMutation(api.comments.dismiss);
  const startAdviseLoop = useMutation(api.chat.startAdviseLoop);
  const comments = useQuery(api.comments.listForRun, runId ? { runId } : 'skip');

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data as {
        type?: string;
        token?: string;
        selector?: string;
        domPath?: string;
        rect?: Bbox;
        tagName?: string;
        text?: string;
        textSnippet?: string;
        componentHint?: string;
      } | null;
      if (!data || data.type !== 'parity:element-click') return;
      if (data.token !== messageToken) return;
      if (!active || !runId || !data.rect) return;
      const label = data.tagName
        ? `${data.tagName.toUpperCase()}${data.text ? ` - ${data.text.slice(0, 44)}${data.text.length > 44 ? '...' : ''}` : ''}`
        : undefined;
      setPending({
        bbox: data.rect,
        ...(data.selector ? { selector: data.selector } : {}),
        ...(data.domPath ? { domPath: data.domPath } : {}),
        ...(label ? { elementLabel: label } : {}),
        ...(data.tagName ? { tagName: data.tagName } : {}),
        ...(data.textSnippet ? { textSnippet: data.textSnippet } : {}),
        ...(data.componentHint ? { componentHint: data.componentHint } : {}),
      });
      setPendingText('');
      setError(null);
      setRegionMode(false);
      setNotesVisible(true);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [active, messageToken, runId]);

  function relCoords(e: PointerEvent<HTMLDivElement>): { x: number; y: number } | null {
    const el = containerRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!active || !regionMode || pending !== null) return;
    const c = relCoords(e);
    if (!c) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraft({ startX: c.x, startY: c.y, curX: c.x, curY: c.y });
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (draft === null) return;
    const c = relCoords(e);
    if (!c) return;
    setDraft({ ...draft, curX: c.x, curY: c.y });
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (draft === null) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const x = Math.min(draft.startX, draft.curX);
    const y = Math.min(draft.startY, draft.curY);
    const w = Math.abs(draft.curX - draft.startX);
    const h = Math.abs(draft.curY - draft.startY);
    setDraft(null);
    if (w < 0.01 || h < 0.01) return;
    setPending({ bbox: { x, y, w, h }, elementLabel: 'REGION' });
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
        bbox?: Bbox;
        targetFile?: string;
        selector?: string;
        domPath?: string;
        elementLabel?: string;
        tagName?: string;
        textSnippet?: string;
        componentHint?: string;
      } = { runId, artifactVersion, text };
      args.bbox = pending.bbox;
      if (targetFile && targetFile.length > 0) args.targetFile = targetFile;
      if (pending.selector) args.selector = pending.selector;
      if (pending.domPath) args.domPath = pending.domPath;
      if (pending.elementLabel) args.elementLabel = pending.elementLabel;
      if (pending.tagName) args.tagName = pending.tagName;
      if (pending.textSnippet) args.textSnippet = pending.textSnippet;
      if (pending.componentHint) args.componentHint = pending.componentHint;
      let commentId: Id<'comments'>;
      try {
        commentId = await create(args);
      } catch (err) {
        const legacyArgs = {
          runId,
          artifactVersion,
          text,
          bbox: pending.bbox,
          ...(targetFile && targetFile.length > 0 ? { targetFile } : {}),
        };
        commentId = await create(legacyArgs);
      }
      setPending(null);
      setPendingText('');
      setRegionMode(false);
      setNotesVisible(true);
      if (autoFix) {
        await startAdviseLoop({ runId, kind: 'comment', commentId });
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
    setRegionMode(false);
  }

  function applyQuickAction(template: (el?: string) => string) {
    const text = template(pending?.elementLabel);
    setPendingText(text);
  }

  const visibleComments = ((comments ?? []) as VisibleComment[])
    .filter((c) => c.status !== 'dismissed')
    .filter((c) => c.artifactVersion === artifactVersion);
  const orderedComments = visibleComments.slice().reverse();

  const showAnnotationBoxes = active && notesVisible;
  const showCommentRail = active && pending === null;

  const overlayStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    zIndex: 10,
    pointerEvents: pending !== null || (active && regionMode) ? 'auto' : 'none',
    cursor: active && regionMode && pending === null ? 'crosshair' : 'default',
  };

  return (
    <div
      ref={containerRef}
      style={overlayStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {showAnnotationBoxes
        ? orderedComments.map((c, index) => {
            if (c.bbox === undefined) return null;
            const color = c.status === 'open' ? 'var(--color-accent)' : 'var(--color-success)';
            return (
              <div
                key={c._id}
                style={{
                  position: 'absolute',
                  left: `${c.bbox.x * 100}%`,
                  top: `${c.bbox.y * 100}%`,
                  width: `${c.bbox.w * 100}%`,
                  height: `${c.bbox.h * 100}%`,
                  border: `2px dashed ${color}`,
                  borderRadius: 8,
                  background: c.status === 'open' ? 'rgba(199, 109, 84, 0.035)' : 'transparent',
                  pointerEvents: 'auto',
                  cursor: 'pointer',
                  opacity: c.status === 'open' ? 0.72 : 0.45,
                }}
                title={`${c.status}: ${c.text}`}
                onDoubleClick={() => void dismiss({ commentId: c._id })}
              >
                <span
                  style={{
                    position: 'absolute',
                    right: -9,
                    top: -9,
                    width: 18,
                    height: 18,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: 999,
                    background: color,
                    color: '#fff',
                    fontSize: 10,
                    fontFamily: 'var(--font-mono)',
                    boxShadow: '0 3px 10px rgba(0,0,0,0.18)',
                  }}
                >
                  {index + 1}
                </span>
              </div>
            );
          })
        : null}

      {draft !== null ? (
        <div
          style={{
            position: 'absolute',
            left: `${Math.min(draft.startX, draft.curX) * 100}%`,
            top: `${Math.min(draft.startY, draft.curY) * 100}%`,
            width: `${Math.abs(draft.curX - draft.startX) * 100}%`,
            height: `${Math.abs(draft.curY - draft.startY) * 100}%`,
            border: '2px dashed var(--color-accent)',
            background: 'rgba(199, 109, 84, 0.1)',
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

      {showCommentRail ? (
        <CommentRail
          comments={orderedComments}
          notesVisible={notesVisible}
          regionMode={regionMode}
          onToggleNotes={() => setNotesVisible((next) => !next)}
          onToggleRegionMode={() => setRegionMode((next) => !next)}
          onDismiss={(commentId) => void dismiss({ commentId })}
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
  const anchorAbove = pending.bbox.y + pending.bbox.h > 0.7;
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: `${pending.bbox.x * 100}%`,
          top: `${pending.bbox.y * 100}%`,
          width: `${pending.bbox.w * 100}%`,
          height: `${pending.bbox.h * 100}%`,
          border: '2px solid var(--color-accent)',
          borderRadius: 8,
          background: 'rgba(199, 109, 84, 0.1)',
          pointerEvents: 'none',
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.04)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: `${Math.max(0, Math.min(0.58, pending.bbox.x)) * 100}%`,
          ...(anchorAbove
            ? { bottom: `${(1 - pending.bbox.y) * 100}%`, marginBottom: 8 }
            : { top: `${(pending.bbox.y + pending.bbox.h) * 100}%`, marginTop: 8 }),
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-elevated)',
          padding: 12,
          width: 340,
          zIndex: 30,
          pointerEvents: 'auto',
          fontFamily: 'var(--font-sans)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--color-text-secondary)',
              letterSpacing: 'var(--tracking-eyebrow)',
              textTransform: 'uppercase',
            }}
          >
            {pending.elementLabel ?? 'SELECTED REGION'}
          </div>
          {pending.selector ? (
            <code style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>
              {pending.selector}
            </code>
          ) : null}
        </div>
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
          value={text}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Describe the exact change for this element..."
          style={{
            width: '100%',
            minHeight: 68,
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
        <div
          style={{
            display: 'flex',
            gap: 6,
            marginTop: 8,
            justifyContent: 'flex-end',
            alignItems: 'center',
          }}
        >
          <button type="button" onClick={onCancel} style={secondaryButtonStyle}>
            cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(false)}
            disabled={text.trim().length === 0}
            style={secondaryButtonStyle}
          >
            save
          </button>
          <button
            type="button"
            onClick={() => onSubmit(true)}
            disabled={text.trim().length === 0}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background:
                text.trim().length === 0 ? 'var(--color-surface-active)' : 'var(--color-accent)',
              color:
                text.trim().length === 0 ? 'var(--color-text-faint)' : 'var(--color-on-accent)',
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              fontWeight: 600,
              cursor: text.trim().length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            save + auto-fix
          </button>
        </div>
      </div>
    </>
  );
}

function CommentRail({
  comments,
  notesVisible,
  regionMode,
  onToggleNotes,
  onToggleRegionMode,
  onDismiss,
}: {
  comments: VisibleComment[];
  notesVisible: boolean;
  regionMode: boolean;
  onToggleNotes: () => void;
  onToggleRegionMode: () => void;
  onDismiss: (commentId: Id<'comments'>) => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        right: 14,
        top: 14,
        width: 270,
        maxHeight: 'calc(100% - 28px)',
        overflow: 'auto',
        background: 'rgba(253, 246, 240, 0.96)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 16,
        boxShadow: 'var(--shadow-elevated)',
        padding: 12,
        zIndex: 25,
        pointerEvents: 'auto',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        <strong style={{ fontSize: 13 }}>Review comments {comments.length}</strong>
        <button type="button" onClick={onToggleNotes} style={tinyButtonStyle}>
          {notesVisible ? 'Hide boxes' : 'Show boxes'}
        </button>
      </div>
      <button
        type="button"
        onClick={onToggleRegionMode}
        style={{
          ...tinyButtonStyle,
          width: '100%',
          marginBottom: 10,
          background: regionMode ? 'var(--color-accent-soft)' : 'var(--color-surface)',
          color: regionMode ? 'var(--color-accent)' : 'var(--color-text-primary)',
        }}
      >
        {regionMode ? 'Drag a region on preview' : 'Click any element to pin'}
      </button>
      <div style={{ display: 'grid', gap: 8 }}>
        {comments.length === 0 ? (
          <div style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>
            Click an element in the preview to leave a scoped note.
          </div>
        ) : (
          <div style={{ color: 'var(--color-text-secondary)', fontSize: 11, lineHeight: 1.35 }}>
            Boxes are annotations, not generated UI. Turn off Comment mode or hide boxes for a clean
            preview.
          </div>
        )}
        {comments.map((comment, index) => (
          <div
            key={comment._id}
            style={{
              display: 'grid',
              gridTemplateColumns: '20px 1fr auto',
              gap: 8,
              alignItems: 'start',
              borderTop: index === 0 ? 'none' : '1px solid var(--color-border-subtle)',
              paddingTop: index === 0 ? 0 : 8,
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                display: 'grid',
                placeItems: 'center',
                borderRadius: 999,
                background:
                  comment.status === 'open' ? 'var(--color-accent)' : 'var(--color-success)',
                color: '#fff',
                fontSize: 10,
                fontFamily: 'var(--font-mono)',
              }}
            >
              {index + 1}
            </span>
            <div>
              <div style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--color-text-primary)' }}>
                {comment.text}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--color-text-faint)',
                  marginTop: 3,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {comment.elementLabel ?? comment.selector ?? comment.targetFile ?? comment.status}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(comment._id)}
              style={iconButtonStyle}
              title="Dismiss comment"
            >
              x
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const secondaryButtonStyle: CSSProperties = {
  padding: '6px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-border-subtle)',
  background: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-sans)',
  fontSize: 12,
  cursor: 'pointer',
};

const tinyButtonStyle: CSSProperties = {
  padding: '5px 8px',
  borderRadius: 999,
  border: '1px solid var(--color-border-subtle)',
  background: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-sans)',
  fontSize: 11,
  cursor: 'pointer',
};

const iconButtonStyle: CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 999,
  border: '1px solid var(--color-border-subtle)',
  background: 'transparent',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
  lineHeight: 1,
};
