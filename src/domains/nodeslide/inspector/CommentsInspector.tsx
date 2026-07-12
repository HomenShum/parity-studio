import {
  Bot,
  CheckCircle2,
  CornerDownRight,
  MapPin,
  MessageCircle,
  Reply,
  RotateCcw,
  Send,
} from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import type {
  BoundingBox,
  CommentAnchor,
  DeckComment,
  Slide,
  SlideElement,
} from '../../../../shared/nodeslide';

type AnchorChoice = 'deck' | 'slide' | 'element' | 'bounding_box';

export interface CommentsInspectorProps {
  deckId: string;
  slide: Slide;
  selectedElements: readonly SlideElement[];
  comments: readonly DeckComment[];
  onAddComment: (text: string, anchor: CommentAnchor) => void;
  onReply: (parentId: string, text: string) => void;
  onSetStatus: (commentId: string, status: 'open' | 'resolved') => void;
  onSendToAi: (comment: DeckComment) => void;
}

export function CommentsInspector({
  deckId,
  slide,
  selectedElements,
  comments,
  onAddComment,
  onReply,
  onSetStatus,
  onSendToAi,
}: CommentsInspectorProps) {
  const [anchorChoice, setAnchorChoice] = useState<AnchorChoice>(
    selectedElements.length > 0 ? 'element' : 'slide',
  );
  const [text, setText] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  useEffect(() => {
    if (
      (anchorChoice === 'element' || anchorChoice === 'bounding_box') &&
      selectedElements.length === 0
    ) {
      setAnchorChoice('slide');
    }
  }, [anchorChoice, selectedElements.length]);

  const threads = useMemo(() => {
    const roots = comments.filter((comment) => !comment.parentId);
    return roots
      .map((comment) => ({
        comment,
        replies: comments
          .filter((candidate) => candidate.parentId === comment.id)
          .sort((a, b) => a.createdAt - b.createdAt),
      }))
      .filter(({ comment }) => showResolved || comment.status === 'open')
      .sort((a, b) => b.comment.updatedAt - a.comment.updatedAt);
  }, [comments, showResolved]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = text.trim();
    if (!next) return;
    onAddComment(next, makeAnchor(anchorChoice, deckId, slide.id, selectedElements));
    setText('');
  };

  const openCount = comments.filter(
    (comment) => !comment.parentId && comment.status === 'open',
  ).length;
  const resolvedCount = comments.filter(
    (comment) => !comment.parentId && comment.status === 'resolved',
  ).length;

  return (
    <div className="ns-inspector-scroll ns-comments-inspector">
      <section className="ns-inspector-section">
        <div className="ns-section-title-row">
          <div>
            <span className="ns-eyebrow">Review together</span>
            <h2>Comments</h2>
          </div>
          <span className="ns-count-pill">{openCount} open</span>
        </div>
        <p>Anchor feedback to the deck, slide, selected element, or its current bounding box.</p>
      </section>

      <form className="ns-comment-composer" onSubmit={submit}>
        <div className="ns-anchor-options" aria-label="Comment anchor">
          <span>
            <MapPin size={12} /> Anchor
          </span>
          <div className="ns-chip-group">
            <button
              type="button"
              className={anchorChoice === 'deck' ? 'is-active' : ''}
              onClick={() => setAnchorChoice('deck')}
            >
              Deck
            </button>
            <button
              type="button"
              className={anchorChoice === 'slide' ? 'is-active' : ''}
              onClick={() => setAnchorChoice('slide')}
            >
              Slide
            </button>
            <button
              type="button"
              className={anchorChoice === 'element' ? 'is-active' : ''}
              disabled={selectedElements.length === 0}
              onClick={() => setAnchorChoice('element')}
            >
              Element
            </button>
            <button
              type="button"
              className={anchorChoice === 'bounding_box' ? 'is-active' : ''}
              disabled={selectedElements.length === 0}
              onClick={() => setAnchorChoice('bounding_box')}
            >
              Box
            </button>
          </div>
        </div>
        <label className="ns-comment-field">
          <span className="ns-sr-only">Add comment</span>
          <textarea
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Leave focused feedback…"
          />
          <button type="submit" disabled={!text.trim()} aria-label="Post comment">
            <Send size={14} />
          </button>
        </label>
      </form>

      <div className="ns-comment-filter">
        <button
          type="button"
          className={!showResolved ? 'is-active' : ''}
          onClick={() => setShowResolved(false)}
        >
          Open <span>{openCount}</span>
        </button>
        <button
          type="button"
          className={showResolved ? 'is-active' : ''}
          onClick={() => setShowResolved(true)}
        >
          All <span>{openCount + resolvedCount}</span>
        </button>
      </div>

      <section className="ns-comment-threads" aria-label="Comment threads">
        {threads.length === 0 ? (
          <div className="ns-empty-state ns-empty-state--compact">
            <span>
              <MessageCircle size={17} />
            </span>
            <strong>{showResolved ? 'No comments yet' : 'All clear'}</strong>
            <p>
              {showResolved
                ? 'Start the first review thread above.'
                : 'There are no open review threads.'}
            </p>
          </div>
        ) : (
          threads.map(({ comment, replies }) => (
            <article
              className={`ns-comment-thread ${comment.status === 'resolved' ? 'is-resolved' : ''}`}
              key={comment.id}
            >
              <div className="ns-comment-author-row">
                <span className="ns-avatar ns-avatar--comment">{initials(comment.authorName)}</span>
                <span>
                  <strong>{comment.authorName}</strong>
                  <small>
                    {relativeTime(comment.createdAt)} · {anchorLabel(comment)}
                  </small>
                </span>
                <button
                  type="button"
                  aria-label={comment.status === 'open' ? 'Resolve comment' : 'Reopen comment'}
                  title={comment.status === 'open' ? 'Resolve' : 'Reopen'}
                  onClick={() =>
                    onSetStatus(comment.id, comment.status === 'open' ? 'resolved' : 'open')
                  }
                >
                  {comment.status === 'open' ? <CheckCircle2 size={15} /> : <RotateCcw size={14} />}
                </button>
              </div>
              <p>{comment.text}</p>
              {replies.map((reply) => (
                <div className="ns-comment-reply" key={reply.id}>
                  <CornerDownRight size={13} />
                  <div>
                    <strong>{reply.authorName}</strong>
                    <small>{relativeTime(reply.createdAt)}</small>
                    <p>{reply.text}</p>
                  </div>
                </div>
              ))}
              {replyingTo === comment.id ? (
                <form
                  className="ns-reply-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const next = replyText.trim();
                    if (!next) return;
                    onReply(comment.id, next);
                    setReplyText('');
                    setReplyingTo(null);
                  }}
                >
                  <input
                    value={replyText}
                    onChange={(event) => setReplyText(event.target.value)}
                    aria-label="Reply"
                    placeholder="Write a reply…"
                  />
                  <button type="submit" disabled={!replyText.trim()} aria-label="Post reply">
                    <Send size={13} />
                  </button>
                </form>
              ) : (
                <button
                  className="ns-reply-button"
                  type="button"
                  onClick={() => setReplyingTo(comment.id)}
                >
                  <Reply size={13} /> Reply
                </button>
              )}
              {comment.status === 'open' ? (
                <button
                  className="ns-comment-send-ai"
                  type="button"
                  onClick={() => onSendToAi(comment)}
                  aria-label={`Send comment from ${comment.authorName} to AI`}
                >
                  <Bot size={13} /> Send to AI
                </button>
              ) : null}
            </article>
          ))
        )}
      </section>
    </div>
  );
}

function makeAnchor(
  choice: AnchorChoice,
  deckId: string,
  slideId: string,
  selectedElements: readonly SlideElement[],
): CommentAnchor {
  if (choice === 'deck') return { type: 'deck', deckId };
  if (choice === 'slide') return { type: 'slide', deckId, slideId };
  if (choice === 'element') {
    const elementId = selectedElements.at(-1)?.id;
    if (elementId) return { type: 'element', deckId, slideId, elementId };
    return { type: 'slide', deckId, slideId };
  }
  return {
    type: 'bounding_box',
    deckId,
    slideId,
    bbox: unionBoxes(selectedElements.map((element) => element.bbox)),
  };
}

function unionBoxes(boxes: BoundingBox[]): BoundingBox {
  if (boxes.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x, y, width: right - x, height: bottom - y };
}

function anchorLabel(comment: DeckComment) {
  if (comment.anchor.type === 'bounding_box') return 'box';
  return comment.anchor.type;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function relativeTime(timestamp: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
