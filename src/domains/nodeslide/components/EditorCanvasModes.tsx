import { Pause, Play } from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useId,
  useMemo,
} from 'react';
import type { PatchOperation, Slide, SlideElement, ThemeSpec } from '../../../../shared/nodeslide';
import {
  type EditorCandidateReceipt,
  type EditorCandidateStatus,
  editorCandidateCanAccept,
} from '../editorStateIntegrity';
import './editorShell.css';
import { SlideRenderer } from './SlideRenderer';

export type { EditorCandidateReceipt, EditorCandidateStatus } from '../editorStateIntegrity';

export type EditorCanvasMode = 'edit' | 'overview' | 'compare';
export type EditorCompareMode = 'side-by-side' | 'slider' | 'overlay' | 'blink';
export type EditorCompareOperationTone = 'change' | 'addition' | 'removal';

export interface EditorCompareOperation {
  id?: string;
  label: string;
  tone?: EditorCompareOperationTone;
}

export interface EditorCanvasModesProps {
  mode: EditorCanvasMode;
  onModeChange: (mode: EditorCanvasMode) => void;
  compareMode: EditorCompareMode;
  onCompareModeChange: (mode: EditorCompareMode) => void;

  slides: readonly Slide[];
  elements: readonly SlideElement[];
  theme: ThemeSpec;
  activeSlideId: string;
  editCanvas: ReactNode;
  onSelectSlide?: (slideId: string) => void;
  affectedSlideIds?: readonly string[];
  narrativeBanner?: ReactNode;
  storyArcBoard?: ReactNode;
  validationStatus?: 'verified' | 'needs_review' | 'classification_issue' | 'validating';

  baselineCanvas?: ReactNode;
  baselineLabel?: string;
  candidateCanvas?: ReactNode;
  candidateSlide?: Slide | null;
  candidateElements?: readonly SlideElement[];
  candidateLabel?: string;
  compareOperations?: readonly (PatchOperation | EditorCompareOperation)[];
  candidateReceipt?: EditorCandidateReceipt | null;

  sliderPosition?: number;
  onSliderPositionChange?: (position: number) => void;
  overlayOpacity?: number;
  onOverlayOpacityChange?: (opacity: number) => void;
  blinkPaused?: boolean;
  onBlinkPausedChange?: (paused: boolean) => void;
  onAcceptCandidate?: () => void;
  onDeclineCandidate?: () => void;
}

const CANVAS_MODES: readonly EditorCanvasMode[] = ['edit', 'overview', 'compare'];
const COMPARE_MODES: readonly EditorCompareMode[] = ['side-by-side', 'slider', 'overlay', 'blink'];
const MAX_COMPARE_OPERATION_CHIPS = 6;

export function EditorCanvasModes({
  mode,
  onModeChange,
  compareMode,
  onCompareModeChange,
  slides,
  elements,
  theme,
  activeSlideId,
  editCanvas,
  onSelectSlide,
  affectedSlideIds = [],
  narrativeBanner,
  storyArcBoard,
  validationStatus = 'validating',
  baselineCanvas,
  baselineLabel,
  candidateCanvas,
  candidateSlide,
  candidateElements,
  candidateLabel,
  compareOperations = [],
  candidateReceipt,
  sliderPosition = 50,
  onSliderPositionChange,
  overlayOpacity = 50,
  onOverlayOpacityChange,
  blinkPaused = true,
  onBlinkPausedChange,
  onAcceptCandidate,
  onDeclineCandidate,
}: EditorCanvasModesProps) {
  const shellId = useId();
  const activeSlide = slides.find((slide) => slide.id === activeSlideId);
  const activeSlideIndex = slides.findIndex((slide) => slide.id === activeSlideId);
  const activeElements = activeSlide
    ? elements.filter((element) => element.slideId === activeSlide.id)
    : [];
  const affectedSet = useMemo(() => new Set(affectedSlideIds), [affectedSlideIds]);
  const operations = useMemo(
    () => compareOperations.map(normalizeCompareOperation),
    [compareOperations],
  );
  const safeSliderPosition = clamp(sliderPosition, 5, 95);
  const safeOverlayOpacity = clamp(overlayOpacity, 0, 100);
  const effectiveBlinkPaused = blinkPaused || !onBlinkPausedChange;
  const hasCandidateCanvas =
    candidateCanvas !== undefined && candidateCanvas !== null && candidateCanvas !== false;
  const hasCandidate = hasCandidateCanvas || Boolean(candidateSlide);
  const resolvedBaselineLabel =
    baselineLabel ?? (activeSlide ? `Baseline · v${activeSlide.version}` : 'Baseline');
  const resolvedCandidateLabel =
    candidateLabel ?? (candidateReceipt?.id ? `Candidate · ${candidateReceipt.id}` : 'Candidate');
  const baselineView =
    baselineCanvas ??
    (activeSlide ? (
      <SlideRenderer
        slide={activeSlide}
        elements={activeElements}
        theme={theme}
        className="ns-editor-shell-slide"
      />
    ) : (
      <div className="ns-compare-missing-slide">The active baseline slide is unavailable.</div>
    ));
  const resolvedCandidateElements =
    candidateElements ??
    (candidateSlide ? elements.filter((element) => element.slideId === candidateSlide.id) : []);
  const candidateView = hasCandidateCanvas ? (
    candidateCanvas
  ) : candidateSlide ? (
    <SlideRenderer
      slide={candidateSlide}
      elements={resolvedCandidateElements}
      theme={theme}
      className="ns-editor-shell-slide"
    />
  ) : null;

  return (
    <section
      className="ns-editor-canvas-modes"
      aria-label="Editor canvas"
      data-canvas-mode={mode}
      onKeyDown={stopStudioNavigationFromControls}
    >
      <header className="ns-editor-modebar">
        {storyArcBoard ? (
          <span className="ns-story-mode-label">Story arc</span>
        ) : (
          <div className="ns-editor-mode-controls" role="tablist" aria-label="Canvas views">
            {CANVAS_MODES.map((canvasMode) => (
              <button
                type="button"
                role="tab"
                id={`${shellId}-${canvasMode}-tab`}
                aria-controls={`${shellId}-${canvasMode}-panel`}
                aria-selected={mode === canvasMode}
                className={mode === canvasMode ? 'is-active' : ''}
                key={canvasMode}
                tabIndex={mode === canvasMode ? 0 : -1}
                onClick={() => onModeChange(canvasMode)}
                onKeyDown={(event) =>
                  handleTabKeyDown(event, CANVAS_MODES, canvasMode, onModeChange)
                }
              >
                {capitalize(canvasMode)}
              </button>
            ))}
          </div>
        )}
        <div className="ns-editor-mode-context">
          <span className="ns-editor-slide-number">
            {activeSlide ? String(activeSlideIndex + 1).padStart(2, '0') : '—'}
          </span>
          <strong>{activeSlide?.title ?? 'No active slide'}</strong>
        </div>
        <span className={`ns-editor-validation is-${validationStatus}`}>{validationStatus}</span>
      </header>

      {mode === 'compare' && !storyArcBoard ? (
        <div className="ns-compare-toolbar">
          <div
            className="ns-compare-mode-controls"
            role="tablist"
            aria-label="Comparison presentation"
          >
            {COMPARE_MODES.map((comparisonMode) => (
              <button
                type="button"
                role="tab"
                aria-controls={`${shellId}-comparison`}
                aria-selected={compareMode === comparisonMode}
                className={compareMode === comparisonMode ? 'is-active' : ''}
                key={comparisonMode}
                tabIndex={compareMode === comparisonMode ? 0 : -1}
                onClick={() => onCompareModeChange(comparisonMode)}
                onKeyDown={(event) =>
                  handleTabKeyDown(event, COMPARE_MODES, comparisonMode, onCompareModeChange)
                }
              >
                {compareModeLabel(comparisonMode)}
              </button>
            ))}
          </div>
          <span>{hasCandidate ? 'proposal · pending review' : 'no proposal pending'}</span>
          {narrativeBanner ? <span className="ns-sr-only">{narrativeBanner}</span> : null}
        </div>
      ) : null}

      {mode === 'edit' && narrativeBanner && !storyArcBoard ? (
        <aside className="ns-narrative-banner" aria-label="Narrative context">
          <span className="ns-narrative-label">Slide job</span>
          {narrativeBanner}
        </aside>
      ) : null}

      {storyArcBoard ? (
        <div className="ns-story-arc-host">{storyArcBoard}</div>
      ) : (
        <div
          className={`ns-editor-mode-panel is-${mode}`}
          role="tabpanel"
          id={`${shellId}-${mode}-panel`}
          aria-labelledby={`${shellId}-${mode}-tab`}
        >
          {mode === 'edit' ? (
            <div className="ns-editor-edit-canvas" data-testid="editor-edit-canvas">
              {editCanvas}
            </div>
          ) : null}

          {mode === 'overview' ? (
            <section className="ns-editor-overview" aria-label="Deck overview">
              <ol className="ns-overview-grid">
                {slides.map((slide, index) => {
                  const affected = affectedSet.has(slide.id);
                  const active = slide.id === activeSlideId;
                  const slideElements = elements.filter((element) => element.slideId === slide.id);
                  return (
                    <li
                      className={`${affected ? 'is-affected' : ''} ${active ? 'is-active' : ''}`}
                      data-affected={affected ? 'true' : 'false'}
                      key={slide.id}
                    >
                      <button
                        type="button"
                        aria-current={active ? 'page' : undefined}
                        aria-label={`Open slide ${index + 1}: ${slide.title}${affected ? ', affected by propagation preview' : ''}`}
                        data-testid={`overview-slide-${slide.id}`}
                        onClick={() => onSelectSlide?.(slide.id)}
                      >
                        <span className="ns-overview-thumbnail">
                          <SlideRenderer
                            slide={slide}
                            elements={slideElements}
                            theme={theme}
                            className="ns-editor-shell-slide"
                          />
                        </span>
                        <span className="ns-overview-caption">
                          <span>
                            {String(index + 1).padStart(2, '0')} · {slide.title}
                          </span>
                          {affected ? (
                            <span
                              className="ns-affected-halo-label"
                              data-affected-slide-id={slide.id}
                            >
                              <span aria-hidden="true" /> Affected
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}

          {mode === 'compare' ? (
            hasCandidate ? (
              <section
                className="ns-editor-compare"
                id={`${shellId}-comparison`}
                aria-label="Baseline and candidate comparison"
              >
                <div
                  className={`ns-compare-stage is-${compareMode}`}
                  data-compare-mode={compareMode}
                  style={
                    {
                      '--ns-compare-position': `${safeSliderPosition}%`,
                      '--ns-compare-opacity': safeOverlayOpacity / 100,
                    } as CSSProperties
                  }
                >
                  {compareMode === 'side-by-side' ? (
                    <>
                      <ComparisonFrame label={resolvedBaselineLabel} kind="baseline">
                        {baselineView}
                      </ComparisonFrame>
                      <CompareSeam operations={operations} />
                      <ComparisonFrame label={resolvedCandidateLabel} kind="candidate">
                        {candidateView}
                      </ComparisonFrame>
                    </>
                  ) : (
                    <>
                      <div className="ns-compare-composite">
                        <div className="ns-compare-composite-label is-baseline">
                          {resolvedBaselineLabel}
                        </div>
                        <div className="ns-compare-layer is-baseline">{baselineView}</div>
                        <div
                          className={`ns-compare-layer is-candidate is-${compareMode} ${compareMode === 'blink' && effectiveBlinkPaused ? 'is-paused' : ''}`}
                        >
                          {candidateView}
                        </div>
                        <div className="ns-compare-composite-label is-candidate">
                          {resolvedCandidateLabel}
                        </div>
                      </div>
                      <CompareSeam operations={operations} />
                    </>
                  )}
                </div>

                {compareMode === 'slider' ? (
                  <label className="ns-compare-adjustment">
                    <span>Candidate reveal</span>
                    <input
                      type="range"
                      min="5"
                      max="95"
                      step="1"
                      value={safeSliderPosition}
                      disabled={!onSliderPositionChange}
                      aria-label="Candidate reveal position"
                      onChange={(event) =>
                        onSliderPositionChange?.(Number(event.currentTarget.value))
                      }
                    />
                    <output>{safeSliderPosition}%</output>
                  </label>
                ) : null}
                {compareMode === 'overlay' ? (
                  <label className="ns-compare-adjustment">
                    <span>Candidate opacity</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={safeOverlayOpacity}
                      disabled={!onOverlayOpacityChange}
                      aria-label="Candidate overlay opacity"
                      onChange={(event) =>
                        onOverlayOpacityChange?.(Number(event.currentTarget.value))
                      }
                    />
                    <output>{safeOverlayOpacity}%</output>
                  </label>
                ) : null}
                {compareMode === 'blink' ? (
                  <div className="ns-compare-adjustment">
                    <span>Alternate baseline and candidate</span>
                    <button
                      type="button"
                      aria-pressed={!effectiveBlinkPaused}
                      disabled={!onBlinkPausedChange}
                      onClick={() => onBlinkPausedChange?.(!blinkPaused)}
                    >
                      {effectiveBlinkPaused ? <Play size={13} /> : <Pause size={13} />}
                      {effectiveBlinkPaused ? 'Resume blink' : 'Pause blink'}
                    </button>
                  </div>
                ) : null}

                <CandidateReceipt
                  baselineLabel={resolvedBaselineLabel}
                  candidateLabel={resolvedCandidateLabel}
                  operationCount={operations.length}
                  receipt={candidateReceipt}
                  onAccept={onAcceptCandidate}
                  onDecline={onDeclineCandidate}
                />
              </section>
            ) : (
              <section
                className="ns-editor-compare ns-compare-empty"
                aria-live="polite"
                data-testid="no-candidate-state"
              >
                <div className="ns-compare-stage is-side-by-side">
                  <ComparisonFrame label={resolvedBaselineLabel} kind="baseline">
                    {baselineView}
                  </ComparisonFrame>
                  <ComparisonFrame label="Proposal" kind="candidate">
                    <div className="ns-compare-placeholder">
                      <span className="ns-eyebrow">Proposal</span>
                      <h2>No proposal yet</h2>
                      <p>Preview a proposal from the AI tab to draft and review one.</p>
                      <span className="ns-sr-only">No candidate to compare</span>
                    </div>
                  </ComparisonFrame>
                </div>
                {candidateReceipt ? (
                  <CandidateReceipt
                    baselineLabel={resolvedBaselineLabel}
                    candidateLabel={resolvedCandidateLabel}
                    operationCount={operations.length}
                    receipt={candidateReceipt}
                    onAccept={onAcceptCandidate}
                    onDecline={onDeclineCandidate}
                  />
                ) : null}
              </section>
            )
          ) : null}
        </div>
      )}
    </section>
  );
}

interface NormalizedCompareOperation {
  id: string;
  label: string;
  tone: EditorCompareOperationTone;
}

function ComparisonFrame({
  label,
  kind,
  children,
}: {
  label: string;
  kind: 'baseline' | 'candidate';
  children: ReactNode;
}) {
  return (
    <figure className={`ns-compare-frame is-${kind}`}>
      <figcaption>{label}</figcaption>
      <div className="ns-compare-surface">{children}</div>
    </figure>
  );
}

function CompareSeam({ operations }: { operations: readonly NormalizedCompareOperation[] }) {
  const visibleOperations = operations.slice(0, MAX_COMPARE_OPERATION_CHIPS);
  const remainingCount = Math.max(0, operations.length - visibleOperations.length);
  return (
    <aside className="ns-compare-seam" aria-label="Candidate operations" data-testid="compare-seam">
      <span className="ns-compare-seam-line" aria-hidden="true" />
      <ul>
        {operations.length > 0 ? (
          visibleOperations.map((operation) => (
            <li
              className={`is-${operation.tone}`}
              data-operation-id={operation.id}
              key={operation.id}
            >
              {operation.label}
            </li>
          ))
        ) : (
          <li className="is-empty">No operations supplied</li>
        )}
        {remainingCount > 0 ? <li className="is-summary">+{remainingCount} more changes</li> : null}
      </ul>
    </aside>
  );
}

function CandidateReceipt({
  baselineLabel,
  candidateLabel,
  operationCount,
  receipt,
  onAccept,
  onDecline,
}: {
  baselineLabel: string;
  candidateLabel: string;
  operationCount: number;
  receipt: EditorCandidateReceipt | null | undefined;
  onAccept: (() => void) | undefined;
  onDecline: (() => void) | undefined;
}) {
  const status = receipt?.status ?? 'unavailable';
  const acceptEnabled = editorCandidateCanAccept(receipt);
  return (
    <footer
      className={`ns-candidate-receipt is-${status}`}
      aria-live="polite"
      aria-label="Candidate receipt"
      data-candidate-status={status}
      data-testid="candidate-receipt"
    >
      <span>
        Compare · {baselineLabel} → {candidateLabel}
      </span>
      <span className="ns-candidate-status">{candidateStatusLabel(status)}</span>
      <span>
        {operationCount} {operationCount === 1 ? 'operation' : 'operations'}
      </span>
      {receipt?.versionLabel ? <span>{receipt.versionLabel}</span> : null}
      {receipt?.summary ? <strong>{receipt.summary}</strong> : null}
      {onAccept || onDecline ? (
        <span className="ns-candidate-actions">
          {onAccept ? (
            <button
              type="button"
              onClick={onAccept}
              disabled={!acceptEnabled}
              title={
                acceptEnabled
                  ? 'Accept this exact validated patch candidate'
                  : 'Accept requires a successful patch- and candidate-digest-bound receipt'
              }
            >
              Accept
            </button>
          ) : null}
          {onDecline ? (
            <button type="button" onClick={onDecline}>
              Decline
            </button>
          ) : null}
        </span>
      ) : null}
    </footer>
  );
}

function normalizeCompareOperation(
  operation: PatchOperation | EditorCompareOperation,
  index: number,
): NormalizedCompareOperation {
  if ('label' in operation) {
    return {
      id: operation.id?.trim() || `operation-${index + 1}`,
      label: operation.label,
      tone: operation.tone ?? 'change',
    };
  }
  return {
    id: `${operation.op}-${operationTarget(operation)}-${index}`,
    label: `${operation.op.replaceAll('_', ' ')} · ${operationTarget(operation)}`,
    tone:
      operation.op === 'add_element' || operation.op === 'add_slide'
        ? 'addition'
        : operation.op === 'remove_element' || operation.op === 'remove_slide'
          ? 'removal'
          : 'change',
  };
}

function operationTarget(operation: PatchOperation) {
  if (operation.op === 'add_slide') return operation.slide.id;
  if (operation.op === 'add_element') return operation.element.id;
  if (operation.op === 'group_elements_v1' || operation.op === 'ungroup_elements_v1')
    return operation.groupId;
  if (operation.op === 'update_deck') return 'deck';
  if ('elementId' in operation) return operation.elementId;
  return operation.slideId;
}

function candidateStatusLabel(status: EditorCandidateStatus) {
  if (status === 'ready') return 'Candidate ready';
  if (status === 'validating') return 'Candidate validating';
  if (status === 'warning') return 'Candidate has warnings';
  if (status === 'invalid') return 'Candidate invalid';
  if (status === 'stale') return 'Candidate stale';
  return 'Candidate receipt unavailable';
}

function compareModeLabel(mode: EditorCompareMode) {
  return mode === 'side-by-side' ? 'Side by side' : capitalize(mode);
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function clamp(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function handleTabKeyDown<T extends string>(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  tabs: readonly T[],
  activeTab: T,
  onTabChange: (tab: T) => void,
) {
  let nextIndex: number | undefined;
  const activeIndex = tabs.indexOf(activeTab);
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
    nextIndex = (activeIndex + 1) % tabs.length;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
    nextIndex = (activeIndex - 1 + tabs.length) % tabs.length;
  if (event.key === 'Home') nextIndex = 0;
  if (event.key === 'End') nextIndex = tabs.length - 1;
  if (nextIndex === undefined) return;
  const nextTab = tabs[nextIndex];
  if (!nextTab) return;
  event.preventDefault();
  event.stopPropagation();
  onTabChange(nextTab);
  const buttons =
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  buttons?.[nextIndex]?.focus();
}

function stopStudioNavigationFromControls(event: ReactKeyboardEvent<HTMLElement>) {
  if (
    event.key === ' ' ||
    event.key === 'ArrowUp' ||
    event.key === 'ArrowDown' ||
    event.key === 'ArrowLeft' ||
    event.key === 'ArrowRight' ||
    event.key === 'PageUp' ||
    event.key === 'PageDown'
  ) {
    event.stopPropagation();
  }
}
