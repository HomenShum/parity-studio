import { useState } from 'react';
import type { Deck, Slide, SlideElement } from '../../../../shared/nodeslide';
import { SlideRenderer } from './SlideRenderer';

/** Shape returned by the token-authenticated getApproverReviewState query. */
export interface ApproverReviewState {
  approverLabel: string;
  required: boolean;
  deckVersion: number;
  validated: boolean;
  alreadySignedOff: boolean;
  workspace: {
    deck: Pick<Deck, 'title' | 'theme' | 'slideOrder'>;
    slides: Slide[];
    elements: SlideElement[];
  };
}

interface ApproverReviewViewProps {
  /** undefined = query in flight; null = token not valid for this deck. */
  state: ApproverReviewState | null | undefined;
  tokenSubmitted: boolean;
  busy: boolean;
  error: string | null;
  onSubmitToken: (token: string) => void;
  onSignOff: (reviewedDeckVersion: number) => void;
  onOpenApp: () => void;
}

/**
 * The approver's own surface (?approve=<deckId>): authenticated by pasted token only,
 * never the owner key, so the two publish roles can finally be two people. The approver
 * reads the real slides and signs off the exact version they reviewed — the version is
 * pinned when the content first renders, so a concurrent owner edit surfaces as an
 * explicit "deck advanced" banner instead of silently re-targeting the attestation.
 */
export function ApproverReviewView({
  state,
  tokenSubmitted,
  busy,
  error,
  onSubmitToken,
  onSignOff,
  onOpenApp,
}: ApproverReviewViewProps) {
  const [tokenDraft, setTokenDraft] = useState('');
  // Pin the version whose slides the approver is actually reading. The sign-off always
  // sends this pinned value (the server CAS backstops it), never the live query value —
  // a live value would relabel itself on a concurrent edit and defeat the pin.
  const [reviewedVersion, setReviewedVersion] = useState<number | null>(null);
  if (state && reviewedVersion === null) setReviewedVersion(state.deckVersion);
  const deckAdvanced =
    state != null && reviewedVersion !== null && state.deckVersion !== reviewedVersion;

  if (!tokenSubmitted || state === null) {
    return (
      <div className="nodeslide-studio ns-approver-surface" data-testid="approver-surface">
        <section className="ns-approver-gate">
          <span className="ns-eyebrow">NodeSlide · publish review</span>
          <h1>Review this deck as an approver</h1>
          {state === null ? (
            <p className="ns-approver-error" role="alert">
              This approver capability is not valid for the deck. It may have been revoked or pasted
              incorrectly — ask the owner for a fresh capability.
            </p>
          ) : (
            <p>
              Paste the approver capability you were sent. It authenticates you as the reviewer — no
              account or owner access involved.
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (tokenDraft.trim()) onSubmitToken(tokenDraft.trim());
            }}
          >
            <input
              type="password"
              value={tokenDraft}
              placeholder="Paste approver capability"
              aria-label="Approver capability token"
              data-testid="approver-token-input"
              onChange={(event) => setTokenDraft(event.target.value)}
            />
            <button type="submit" disabled={!tokenDraft.trim()} data-testid="approver-token-submit">
              Open review
            </button>
          </form>
          <button type="button" className="ns-approver-exit" onClick={onOpenApp}>
            Open NodeSlide instead
          </button>
        </section>
      </div>
    );
  }

  if (state === undefined) {
    return (
      <div className="nodeslide-studio ns-approver-surface" data-testid="approver-surface">
        <section className="ns-approver-gate">
          <span className="ns-eyebrow">NodeSlide · publish review</span>
          <h1>Opening the deck for review…</h1>
        </section>
      </div>
    );
  }

  const orderedSlides = state.workspace.deck.slideOrder
    .map((id) => state.workspace.slides.find((slide) => slide.id === id))
    .filter((slide): slide is Slide => slide !== undefined);

  return (
    <div className="nodeslide-studio ns-approver-surface" data-testid="approver-surface">
      <header className="ns-approver-bar" data-testid="approver-bar">
        <div>
          <span className="ns-eyebrow">Publish review · {state.approverLabel}</span>
          <h1>{state.workspace.deck.title}</h1>
        </div>
        <div className="ns-approver-actions">
          <span
            className={`ns-approver-pill ${state.validated ? 'is-validated' : 'is-unvalidated'}`}
          >
            v{state.deckVersion} ·{' '}
            {state.validated ? 'validation receipt present' : 'no validation receipt'}
          </span>
          {state.alreadySignedOff ? (
            <span className="ns-approver-pill is-signed" data-testid="approver-signed">
              Signed off v{state.deckVersion}
            </span>
          ) : (
            <button
              type="button"
              data-testid="approver-sign-off"
              disabled={busy || deckAdvanced || !state.validated || reviewedVersion === null}
              onClick={() => {
                if (reviewedVersion !== null) onSignOff(reviewedVersion);
              }}
            >
              {busy ? 'Signing off…' : `Sign off v${reviewedVersion ?? state.deckVersion}`}
            </button>
          )}
        </div>
      </header>
      {deckAdvanced ? (
        <div className="ns-approver-banner" role="alert" data-testid="approver-advanced">
          The deck advanced to v{state.deckVersion} while you were reviewing v{reviewedVersion}.
          <button type="button" onClick={() => setReviewedVersion(state.deckVersion)}>
            Review v{state.deckVersion}
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="ns-approver-banner is-error" role="alert">
          {error}
        </div>
      ) : null}
      <main className="ns-approver-slides" aria-label="Slides under review">
        {orderedSlides.map((slide, index) => (
          <figure key={slide.id} className="ns-approver-slide">
            <figcaption>
              {index + 1} / {orderedSlides.length} · {slide.title}
            </figcaption>
            <SlideRenderer
              slide={slide}
              elements={state.workspace.elements.filter((element) => element.slideId === slide.id)}
              theme={state.workspace.deck.theme}
            />
          </figure>
        ))}
      </main>
    </div>
  );
}
