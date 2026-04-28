import { useMutation, useQuery } from 'convex/react';
import { useRef, useState } from 'react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

/**
 * CommentOverlay — drag a region on top of the preview iframe to drop a
 * pinned comment. Bbox is normalized 0..1 over the iframe's bounding box
 * so it survives viewport switches.
 *
 * Activated by the "Comment mode" button in ActionSidebar (pass `active`
 * via prop). When active, the overlay sits above the iframe with
 * pointer-events: auto and intercepts clicks. When inactive, it's
 * pointer-events: none and just renders the existing comment markers.
 */
interface CommentOverlayProps {
  runId: Id<'runs'> | null;
  artifactVersion: number;
  active: boolean;
  /** Optional ui_kit file path to scope the next comment to (set via FilesPanel click). */
  targetFile?: string | null;
}

interface DraftBbox {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
}

export function CommentOverlay({ runId, artifactVersion, active, targetFile }: CommentOverlayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<DraftBbox | null>(null);
  const [pendingBbox, setPendingBbox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [pendingText, setPendingText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation(api.comments.create);
  const dismiss = useMutation(api.comments.dismiss);
  const comments = useQuery(api.comments.listForRun, runId ? { runId } : 'skip');

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
    if (!active || pendingBbox !== null) return;
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
    if (w < 0.01 || h < 0.01) {
      // Treat tiny drags as no-bbox annotation (general comment on the artifact)
      setPendingBbox({ x: 0, y: 0, w: 1, h: 1 });
    } else {
      setPendingBbox({ x, y, w, h });
    }
  }

  async function onSubmit() {
    if (runId === null || pendingBbox === null) return;
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
        text: pendingText,
      };
      // Drop bbox if the user opted to comment on the whole artifact
      if (!(pendingBbox.x === 0 && pendingBbox.y === 0 && pendingBbox.w === 1 && pendingBbox.h === 1)) {
        args.bbox = pendingBbox;
      }
      if (targetFile && targetFile.length > 0) {
        args.targetFile = targetFile;
      }
      await create(args);
      setPendingBbox(null);
      setPendingText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function onCancel() {
    setPendingBbox(null);
    setPendingText('');
    setError(null);
  }

  const overlayStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    pointerEvents: active || pendingBbox !== null ? 'auto' : 'none',
    cursor: active && pendingBbox === null ? 'crosshair' : 'default',
  };

  return (
    <div
      ref={containerRef}
      style={overlayStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Existing comments (always shown when there's a runId) */}
      {(comments ?? []).map((c) => {
        if (c.bbox === undefined) return null;
        const dimColor =
          c.status === 'open' ? 'rgba(217, 119, 87, 0.7)' :
          c.status === 'addressed' ? 'rgba(34, 197, 94, 0.5)' :
          'rgba(108, 117, 125, 0.4)';
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
            }}
            title={`${c.status}: ${c.text}`}
            onDoubleClick={() => void dismiss({ commentId: c._id })}
          />
        );
      })}

      {/* In-progress drag rectangle */}
      {draft !== null ? (
        <div
          style={{
            position: 'absolute',
            left: `${Math.min(draft.startX, draft.curX) * 100}%`,
            top: `${Math.min(draft.startY, draft.curY) * 100}%`,
            width: `${Math.abs(draft.curX - draft.startX) * 100}%`,
            height: `${Math.abs(draft.curY - draft.startY) * 100}%`,
            border: '2px dashed #d97757',
            background: 'rgba(217, 119, 87, 0.08)',
            pointerEvents: 'none',
          }}
        />
      ) : null}

      {/* Pending comment popover */}
      {pendingBbox !== null ? (
        <div
          style={{
            position: 'absolute',
            left: `${pendingBbox.x * 100}%`,
            top: `${(pendingBbox.y + pendingBbox.h) * 100}%`,
            transform: 'translateY(8px)',
            background: '#24253a',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            borderRadius: 6,
            padding: 12,
            width: 280,
            zIndex: 10,
            pointerEvents: 'auto',
          }}
        >
          <textarea
            autoFocus
            value={pendingText}
            onChange={(e) => setPendingText(e.target.value)}
            placeholder="what should change here?"
            style={{
              width: '100%',
              minHeight: 60,
              background: '#1a1b26',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#e4e4e7',
              borderRadius: 4,
              padding: 8,
              fontSize: 13,
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
          {error !== null ? (
            <div style={{ color: '#ff7b72', fontSize: 11, marginTop: 6 }}>{error}</div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="tab" onClick={onCancel}>
              cancel
            </button>
            <button
              type="button"
              className="generate-button"
              style={{ padding: '6px 14px', fontSize: 13 }}
              disabled={pendingText.trim().length === 0}
              onClick={() => void onSubmit()}
            >
              save
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
