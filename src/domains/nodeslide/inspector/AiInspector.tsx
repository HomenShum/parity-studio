import {
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  Circle,
  Eye,
  Layers3,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { type FormEvent, type Ref, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentTrace,
  Deck,
  DeckPatch,
  OperationMode,
  PatchOperation,
  PatchScope,
  Slide,
  SlideElement,
} from '../../../../shared/nodeslide';
import type { SlideVariation } from '../../../../shared/nodeslideVariation';

type ScopeChoice = 'deck' | 'slide' | 'elements';

interface AiInspectorProps {
  deck: Deck;
  slide: Slide;
  selectedElements: readonly SlideElement[];
  patches: readonly DeckPatch[];
  traces: readonly AgentTrace[];
  variations: readonly SlideVariation[];
  variationsLoading: boolean;
  isSubmitting: boolean;
  variationBusy: boolean;
  variationGenerating: boolean;
  variationError: string | null;
  previewedVariationId: string | null;
  onPropose: (instruction: string, scope: PatchScope) => void;
  onAccept: (patch: DeckPatch) => void;
  onReject: (patch: DeckPatch) => void;
  onGenerateVariations: () => void;
  onPreviewVariation: (variation: SlideVariation | null) => void;
  onAcceptVariation: (variation: SlideVariation) => void;
  onRejectVariation: (variation: SlideVariation) => void;
}

export function AiInspector({
  deck,
  slide,
  selectedElements,
  patches,
  traces,
  variations,
  variationsLoading,
  isSubmitting,
  variationBusy,
  variationGenerating,
  variationError,
  previewedVariationId,
  onPropose,
  onAccept,
  onReject,
  onGenerateVariations,
  onPreviewVariation,
  onAcceptVariation,
  onRejectVariation,
}: AiInspectorProps) {
  const [instruction, setInstruction] = useState('');
  const [scopeChoice, setScopeChoice] = useState<ScopeChoice>(
    selectedElements.length > 0 ? 'elements' : 'slide',
  );
  const [operationMode, setOperationMode] = useState<OperationMode>('unrestricted');
  const [showPlan, setShowPlan] = useState(true);
  const focusGeneratedBatch = useRef(false);
  const batchBeforeGeneration = useRef<string | undefined>(undefined);
  const firstVariationRef = useRef<HTMLLIElement | null>(null);
  const lastPreviewButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (scopeChoice === 'elements' && selectedElements.length === 0) setScopeChoice('slide');
  }, [scopeChoice, selectedElements.length]);

  const activeTrace = useMemo(
    () =>
      [...traces]
        .sort((a, b) => b.createdAt - a.createdAt)
        .find((trace) => ['planning', 'working', 'awaiting_review'].includes(trace.status)),
    [traces],
  );
  const proposals = useMemo(
    () =>
      [...patches]
        .filter(
          (patch) =>
            ['draft', 'validating', 'ready', 'stale'].includes(patch.status) &&
            patch.source === 'agent',
        )
        .sort((a, b) => b.createdAt - a.createdAt),
    [patches],
  );
  const latestBatchId = variations[0]?.batchId;
  const directions = useMemo(
    () => variations.filter((variation) => variation.batchId === latestBatchId),
    [latestBatchId, variations],
  );
  const previewedVariation = directions.find(
    (variation) =>
      variation.id === previewedVariationId &&
      variation.status === 'ready' &&
      variation.validation.ok &&
      !variation.validation.issues.some((issue) => issue.severity === 'error'),
  );
  const allRejected =
    directions.length === 3 && directions.every((variation) => variation.status === 'rejected');
  const hasFallback = directions.some((variation) => variation.origin === 'deterministic_fallback');

  useEffect(() => {
    if (variationGenerating || !focusGeneratedBatch.current) return;
    if (variationError) {
      focusGeneratedBatch.current = false;
      return;
    }
    if (!latestBatchId || latestBatchId === batchBeforeGeneration.current) return;
    focusGeneratedBatch.current = false;
    firstVariationRef.current?.focus();
  }, [latestBatchId, variationError, variationGenerating]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = instruction.trim();
    if (!text || isSubmitting) return;
    onPropose(text, createScope(scopeChoice, operationMode, deck.id, slide.id, selectedElements));
    setInstruction('');
  };

  const returnToOriginal = () => {
    const previewButton = lastPreviewButtonRef.current;
    onPreviewVariation(null);
    requestAnimationFrame(() => previewButton?.focus());
  };

  return (
    <div className="ns-inspector-scroll ns-ai-inspector">
      <section className="ns-inspector-section ns-ai-intro">
        <div className="ns-section-title-row">
          <div>
            <span className="ns-eyebrow">Scoped copilot</span>
            <h2>Ask NodeSlide</h2>
          </div>
          <span className="ns-route-pill">
            <Sparkles size={11} /> Free route
          </span>
        </div>
        <p>Describe the outcome. You’ll review a structured patch before anything changes.</p>
      </section>

      <section
        className="ns-variation-section"
        aria-labelledby="ns-variation-heading"
        data-testid="variation-section"
      >
        <div className="ns-variation-heading-row">
          <div>
            <span className="ns-eyebrow">Slide directions</span>
            <h2 id="ns-variation-heading">Explore before editing</h2>
          </div>
          <button
            type="button"
            className="ns-button ns-button--accent ns-variation-generate"
            disabled={variationBusy}
            onClick={() => {
              focusGeneratedBatch.current = true;
              batchBeforeGeneration.current = latestBatchId;
              onGenerateVariations();
            }}
            aria-controls="ns-variation-results"
            data-testid="variation-generate"
          >
            {variationGenerating ? (
              <LoaderCircle className="ns-spin" size={14} />
            ) : (
              <Layers3 size={14} />
            )}
            {variationGenerating ? 'Generating...' : 'Generate 3 directions'}
          </button>
        </div>
        <p className="ns-variation-explainer">
          Each direction is materialized and validated. Your slide stays unchanged until Accept.
        </p>

        {previewedVariation ? (
          <div className="ns-variation-preview-banner" aria-live="polite">
            <Eye size={14} />
            <span>
              Previewing <strong>{axesLabel(previewedVariation)}</strong>
            </span>
            <button type="button" onClick={returnToOriginal}>
              Return to original
            </button>
          </div>
        ) : null}

        {variationError ? (
          <div className="ns-variation-error" role="alert">
            <strong>Directions unavailable</strong>
            <span>{variationError}</span>
            <button
              type="button"
              onClick={() => {
                focusGeneratedBatch.current = true;
                batchBeforeGeneration.current = latestBatchId;
                onGenerateVariations();
              }}
              disabled={variationBusy}
            >
              Try again
            </button>
          </div>
        ) : null}

        {hasFallback ? (
          <output className="ns-variation-fallback-note">
            <Sparkles size={13} />
            <span>
              The free route could not safely supply every direction. Clearly labeled deterministic
              fallbacks are shown instead.
            </span>
          </output>
        ) : null}

        <div id="ns-variation-results" aria-busy={variationBusy || variationsLoading}>
          {variationGenerating ? (
            <div className="ns-variation-loading" aria-live="polite">
              <LoaderCircle className="ns-spin" size={16} />
              <span>Generating, materializing, and validating three bounded directions...</span>
            </div>
          ) : variationsLoading ? (
            <div className="ns-variation-loading" aria-live="polite">
              <LoaderCircle className="ns-spin" size={16} />
              <span>Loading saved directions...</span>
            </div>
          ) : directions.length > 0 ? (
            <ul className="ns-variation-list" aria-label="Generated slide directions">
              {directions.map((variation, index) => (
                <VariationCard
                  key={variation.id}
                  focusRef={index === 0 ? firstVariationRef : null}
                  variation={variation}
                  previewed={variation.id === previewedVariationId}
                  {...(variation.id === previewedVariationId
                    ? {
                        previewButtonRef: (node: HTMLButtonElement | null) => {
                          if (node) lastPreviewButtonRef.current = node;
                        },
                      }
                    : {})}
                  busy={variationBusy}
                  onPreview={onPreviewVariation}
                  onAccept={onAcceptVariation}
                  onReject={onRejectVariation}
                />
              ))}
            </ul>
          ) : (
            <div className="ns-variation-empty">
              <Layers3 size={17} />
              <span>
                <strong>No directions yet</strong>
                Generate three reviewable options for this slide.
              </span>
            </div>
          )}
        </div>

        {allRejected ? (
          <output className="ns-variation-all-rejected">
            All three directions were rejected. The original slide remains unchanged.
          </output>
        ) : null}
      </section>

      <form className="ns-ai-composer" onSubmit={submit} data-testid="ai-composer">
        <div className="ns-scope-row" aria-label="AI edit scope">
          <span>Scope</span>
          <div className="ns-chip-group">
            <button
              type="button"
              className={scopeChoice === 'deck' ? 'is-active' : ''}
              onClick={() => setScopeChoice('deck')}
            >
              Deck
            </button>
            <button
              type="button"
              className={scopeChoice === 'slide' ? 'is-active' : ''}
              onClick={() => setScopeChoice('slide')}
            >
              This slide
            </button>
            <button
              type="button"
              className={scopeChoice === 'elements' ? 'is-active' : ''}
              disabled={selectedElements.length === 0}
              onClick={() => setScopeChoice('elements')}
            >
              Selection{selectedElements.length > 0 ? ` · ${selectedElements.length}` : ''}
            </button>
          </div>
        </div>

        <div className="ns-scope-row" aria-label="AI operation mode">
          <span>Mode</span>
          <div className="ns-mode-select-wrap">
            <select
              value={operationMode}
              onChange={(event) => setOperationMode(event.target.value as OperationMode)}
              aria-label="Operation mode"
            >
              <option value="unrestricted">Full edit</option>
              <option value="copy">Copy only</option>
              <option value="style">Style only</option>
              <option value="layout">Layout only</option>
            </select>
          </div>
        </div>

        <label className="ns-composer-field">
          <span className="ns-sr-only">AI instruction</span>
          <textarea
            rows={4}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder={
              scopeChoice === 'elements'
                ? 'Make this feel more decisive…'
                : 'Turn this into a crisp executive story…'
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
                event.currentTarget.form?.requestSubmit();
            }}
          />
          <div className="ns-composer-meta">
            <span>
              <Bot size={12} /> Scope locked before send
            </span>
            <button
              type="submit"
              disabled={!instruction.trim() || isSubmitting}
              aria-label="Propose edit"
              data-testid="ai-submit"
            >
              {isSubmitting ? (
                <LoaderCircle className="ns-spin" size={15} />
              ) : (
                <ArrowUp size={15} />
              )}
            </button>
          </div>
        </label>
        <small className="ns-shortcut-hint">
          <kbd>⌘</kbd>
          <kbd>↵</kbd> to propose · no credits required on free route
        </small>
      </form>

      {activeTrace ? (
        <section className="ns-agent-progress" aria-live="polite">
          <button
            type="button"
            className="ns-progress-heading"
            onClick={() => setShowPlan((value) => !value)}
            aria-expanded={showPlan}
          >
            <span className="ns-agent-orb">
              <LoaderCircle className="ns-spin" size={14} />
            </span>
            <span>
              <strong>{activeTrace.summary}</strong>
              <small>{humanizeStatus(activeTrace.status)}</small>
            </span>
            <ChevronRight size={14} className={showPlan ? 'is-open' : ''} />
          </button>
          {showPlan ? (
            <ol className="ns-plan-list">
              {activeTrace.plan.map((step, index) => (
                <li key={step} className={index === 0 ? 'is-current' : ''}>
                  {index === 0 ? (
                    <LoaderCircle className="ns-spin" size={13} />
                  ) : (
                    <Circle size={10} />
                  )}
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}

      {proposals.length > 0 ? (
        <section className="ns-proposals">
          <div className="ns-section-heading">
            <span>Proposals</span>
            <small>{proposals.length} to review</small>
          </div>
          {proposals.map((patch) => (
            <ProposalCard key={patch.id} patch={patch} onAccept={onAccept} onReject={onReject} />
          ))}
        </section>
      ) : (
        <div className="ns-empty-state ns-empty-state--compact">
          <span>
            <Sparkles size={17} />
          </span>
          <strong>No proposal waiting</strong>
          <p>Ask for a change above. The agent will return a reviewable diff.</p>
        </div>
      )}
    </div>
  );
}

function VariationCard({
  variation,
  previewed,
  previewButtonRef,
  busy,
  focusRef,
  onPreview,
  onAccept,
  onReject,
}: {
  variation: SlideVariation;
  previewed: boolean;
  previewButtonRef?: (node: HTMLButtonElement | null) => void;
  busy: boolean;
  focusRef: Ref<HTMLLIElement> | null;
  onPreview: (variation: SlideVariation | null) => void;
  onAccept: (variation: SlideVariation) => void;
  onReject: (variation: SlideVariation) => void;
}) {
  const validationNotes = variation.validation.issues.filter((issue) => issue.severity !== 'error');
  const validationClean =
    variation.validation.ok &&
    !variation.validation.issues.some((issue) => issue.severity === 'error');
  const reviewable = variation.status === 'ready' && validationClean;
  const previewable = variation.status === 'ready' && validationClean;
  return (
    <li
      ref={focusRef}
      tabIndex={-1}
      className={`ns-variation-card is-${variation.status} ${previewed ? 'is-previewed' : ''}`}
      data-testid="variation-card"
      data-variation-id={variation.id}
    >
      <div className="ns-variation-card-topline">
        <span className={`ns-status-dot ns-status-dot--${variation.status}`} />
        <strong>{variationStatusLabel(variation.status)}</strong>
        <small>based on v{variation.baseDeckVersion}</small>
      </div>
      <h3>{axesLabel(variation)}</h3>
      <div className="ns-variation-axis-pills" aria-label="Variation axes">
        <span>{humanizeAxis(variation.axes.contentAngle)}</span>
        <span>{humanizeAxis(variation.axes.density)}</span>
        <span>{humanizeAxis(variation.axes.layoutArchetype)}</span>
      </div>
      <div className="ns-variation-evidence-row">
        <span className={`is-${variation.origin}`}>
          {variation.origin === 'free_route' ? 'Free route' : 'Deterministic fallback'}
        </span>
        <span className={variation.validation.ok ? 'is-valid' : 'is-invalid'}>
          {variation.validation.ok
            ? validationNotes.length > 0
              ? `Valid / ${validationNotes.length} note${validationNotes.length === 1 ? '' : 's'}`
              : 'Validation clean'
            : 'Validation blocked'}
        </span>
      </div>
      {validationNotes.length > 0 ? (
        <details className="ns-variation-validation-details">
          <summary>View validation notes</summary>
          <ul>
            {validationNotes.map((issue) => (
              <li key={issue.id}>{issue.message}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="ns-variation-change-summary">{variationChangedFields(variation.operations)}</p>
      {variation.fallbackReason ? (
        <p className="ns-variation-fallback-reason">
          Fallback reason: {humanizeDiagnostic(variation.fallbackReason)}
        </p>
      ) : null}
      <details>
        <summary>Review {variation.operations.length} bounded changes</summary>
        <ul>
          {variation.operations.map((operation, index) => (
            <li key={`${operation.op}-${index}`}>{describeOperation(operation)}</li>
          ))}
        </ul>
      </details>
      <div className="ns-variation-actions">
        <button
          ref={previewButtonRef}
          className="ns-button ns-button--quiet"
          type="button"
          onClick={() => onPreview(previewed ? null : variation)}
          disabled={!previewable || busy}
          aria-pressed={previewed}
          data-testid="variation-preview"
        >
          <Eye size={13} /> {previewed ? 'Original' : 'Preview'}
        </button>
        <button
          className="ns-button ns-button--accent"
          type="button"
          onClick={() => onAccept(variation)}
          disabled={!reviewable || busy}
          data-testid="variation-accept"
        >
          <Check size={13} /> Accept
        </button>
        <button
          className="ns-button ns-button--quiet"
          type="button"
          onClick={() => onReject(variation)}
          disabled={!reviewable || busy}
          data-testid="variation-reject"
        >
          <X size={13} /> Reject
        </button>
      </div>
      {variation.status === 'stale' ? (
        <p className="ns-variation-stale-copy">
          The slide changed after generation. This direction cannot overwrite newer work.
        </p>
      ) : null}
      {variation.status === 'accepted' && variation.selectedPatchId ? (
        <p className="ns-variation-selected-copy">
          Applied through patch {variation.selectedPatchId}
        </p>
      ) : null}
    </li>
  );
}

function ProposalCard({
  patch,
  onAccept,
  onReject,
}: {
  patch: DeckPatch;
  onAccept: (patch: DeckPatch) => void;
  onReject: (patch: DeckPatch) => void;
}) {
  const counts = countOperations(patch.operations);
  const stale = patch.status === 'stale';
  return (
    <article
      className={`ns-proposal-card ${stale ? 'is-stale' : ''}`}
      data-testid="proposal-card"
      data-proposal-id={patch.id}
    >
      <div className="ns-proposal-topline">
        <span className={`ns-status-dot ns-status-dot--${patch.status}`} />
        <strong>
          {stale
            ? 'Stale proposal'
            : patch.status === 'ready'
              ? 'Ready to apply'
              : humanizeStatus(patch.status)}
        </strong>
        <small>based on v{patch.baseDeckVersion}</small>
      </div>
      <h3>{patch.summary}</h3>
      <div className="ns-diff-summary">
        {counts.map(({ label, count, kind }) => (
          <span key={kind} className={`is-${kind}`}>
            {kind === 'remove' ? '−' : kind === 'add' ? '+' : '↗'} {count} {label}
          </span>
        ))}
      </div>
      <details>
        <summary>View structured diff</summary>
        <ul>
          {patch.operations.map((operation, index) => (
            <li key={`${operation.op}-${index}`}>{describeOperation(operation)}</li>
          ))}
        </ul>
      </details>
      <div className="ns-proposal-actions">
        {stale ? (
          <button className="ns-button ns-button--quiet" type="button" disabled>
            <RotateCcw size={14} /> Rebase required
          </button>
        ) : (
          <button
            className="ns-button ns-button--accent"
            type="button"
            onClick={() => onAccept(patch)}
            disabled={patch.status !== 'ready'}
            data-testid="proposal-accept"
          >
            <Check size={14} /> Accept
          </button>
        )}
        <button
          className="ns-button ns-button--quiet"
          type="button"
          onClick={() => onReject(patch)}
          data-testid="proposal-reject"
        >
          <X size={14} /> Reject
        </button>
      </div>
    </article>
  );
}

function createScope(
  choice: ScopeChoice,
  operationMode: OperationMode,
  deckId: string,
  slideId: string,
  selectedElements: readonly SlideElement[],
): PatchScope {
  if (choice === 'deck') return { kind: 'deck', deckId, operationMode };
  if (choice === 'elements') {
    return {
      kind: 'elements',
      deckId,
      slideIds: [slideId],
      elementIds: selectedElements.map((element) => element.id),
      operationMode,
    };
  }
  return { kind: 'slide', deckId, slideIds: [slideId], operationMode };
}

function axesLabel(variation: SlideVariation) {
  const angle =
    variation.axes.contentAngle === 'data_led'
      ? 'Evidence-first'
      : variation.axes.contentAngle === 'narrative_led'
        ? 'Story-first'
        : 'Balanced detail';
  return `${angle} / ${humanizeAxis(variation.axes.layoutArchetype)}`;
}

function humanizeAxis(value: string) {
  return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function variationStatusLabel(status: SlideVariation['status']) {
  if (status === 'ready') return 'Ready to review';
  if (status === 'accepted') return 'Accepted';
  if (status === 'rejected') return 'Rejected';
  return 'Stale direction';
}

function variationChangedFields(operations: readonly PatchOperation[]) {
  const fields = new Set<string>();
  for (const operation of operations) {
    if (operation.op === 'replace_text') fields.add('copy');
    else if (operation.op === 'update_style') {
      for (const key of Object.keys(operation.properties)) fields.add(key);
    } else if (operation.op === 'move') {
      fields.add('position');
    } else if (operation.op === 'resize') {
      fields.add('size');
    } else if (operation.op === 'update_slide') {
      for (const key of Object.keys(operation.properties)) fields.add(`slide ${key}`);
    }
  }
  const labels = [...fields].slice(0, 6);
  return `Changes ${labels.join(', ')} across ${operations.length} operation${operations.length === 1 ? '' : 's'}.`;
}

function humanizeDiagnostic(value: string) {
  return value
    .split(';')
    .map((part) => part.trim().replaceAll('_', ' '))
    .filter(Boolean)
    .join('; ');
}

function countOperations(operations: readonly PatchOperation[]) {
  const groups = new Map<'add' | 'remove' | 'change', number>();
  for (const operation of operations) {
    const kind =
      operation.op === 'add_element' || operation.op === 'add_slide'
        ? 'add'
        : operation.op === 'remove_element' || operation.op === 'remove_slide'
          ? 'remove'
          : 'change';
    groups.set(kind, (groups.get(kind) ?? 0) + 1);
  }
  return [...groups.entries()].map(([kind, count]) => ({
    kind,
    count,
    label:
      kind === 'change'
        ? count === 1
          ? 'change'
          : 'changes'
        : kind === 'add'
          ? count === 1
            ? 'addition'
            : 'additions'
          : count === 1
            ? 'removal'
            : 'removals',
  }));
}

function describeOperation(operation: PatchOperation) {
  if (operation.op === 'add_slide')
    return `Add slide “${operation.slide.title}” with ${operation.elements.length} elements at position ${operation.index + 1}`;
  if (operation.op === 'remove_slide') return `Remove slide ${operation.slideId}`;
  if (operation.op === 'update_deck')
    return `Update deck ${Object.keys(operation.properties).join(', ')}`;
  if (operation.op === 'move')
    return `Move ${operation.elementId} to ${percent(operation.x)}, ${percent(operation.y)}`;
  if (operation.op === 'resize')
    return `Resize ${operation.elementId} to ${percent(operation.width)} × ${percent(operation.height)}`;
  if (operation.op === 'replace_text')
    return `Replace copy in ${operation.elementId} with “${truncateOperationText(operation.text)}”`;
  if (operation.op === 'update_style')
    return `Update ${Object.keys(operation.properties).join(', ')} on ${operation.elementId}`;
  if (operation.op === 'add_element')
    return `Add ${operation.element.kind} “${operation.element.name}”`;
  if (operation.op === 'remove_element') return `Remove ${operation.elementId}`;
  if (operation.op === 'reorder_slide') return `Move slide to position ${operation.index + 1}`;
  return `Update slide ${operation.slideId}`;
}

function truncateOperationText(value: string) {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > 90 ? `${clean.slice(0, 87)}…` : clean;
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function humanizeStatus(status: string) {
  return status.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}
