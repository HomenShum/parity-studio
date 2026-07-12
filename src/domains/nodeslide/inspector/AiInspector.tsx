import {
  ArrowUp,
  AtSign,
  Bot,
  Check,
  ChevronRight,
  Circle,
  Command,
  Eye,
  GitCompareArrows,
  Layers3,
  LoaderCircle,
  Maximize2,
  MessageCircle,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  type FormEvent,
  type KeyboardEvent,
  type Ref,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
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
import {
  AI_DRAFTING_PHASE_MS,
  type AiAgentActivity,
  type AiCommentContext,
  type AiComposerCommand,
  type AiDesignBehaviorPolicy,
  type AiProposalOptions,
  type AiProviderMode,
  type AiProviderRequest,
  type AiReadReference,
  type AiReferenceUsePolicy,
  type AiReviewablePatch,
  type AiSuggestedAction,
  type AiVariationProviderRequest,
  type AiVariationRequest,
  NODESLIDE_OPENROUTER_REVIEW_CONSENT,
  NODESLIDE_OPENROUTER_VARIATIONS_CONSENT,
} from './reviewTypes';

export {
  AI_DRAFTING_PHASE_MS,
  NODESLIDE_OPENROUTER_REVIEW_CONSENT,
  NODESLIDE_OPENROUTER_VARIATIONS_CONSENT,
} from './reviewTypes';
export type {
  AiAgentActivity,
  AiCandidateValidationReceipt,
  AiCommentContext,
  AiComposerCommand,
  AiDesignBehaviorPolicy,
  AiProposalOptions,
  AiProposalPolicy,
  AiProviderMode,
  AiProviderRequest,
  AiReadReference,
  AiReadReferenceKind,
  AiReferenceUsePolicy,
  AiReviewablePatch,
  AiSuggestedAction,
  AiVariationProviderRequest,
  AiVariationRequest,
} from './reviewTypes';

type ScopeChoice = 'deck' | 'slide' | 'elements';

interface ComposerTrigger {
  kind: 'reference' | 'command';
  query: string;
  start: number;
  end: number;
}

export interface AiInspectorProps<CommandId extends string = string> {
  deck: Deck;
  slide: Slide;
  selectedElements: readonly SlideElement[];
  workspaceElements?: readonly SlideElement[];
  patches: readonly AiReviewablePatch[];
  traces: readonly AgentTrace[];
  variations: readonly SlideVariation[];
  variationsLoading: boolean;
  isSubmitting: boolean;
  variationBusy: boolean;
  variationGenerating: boolean;
  variationError: string | null;
  previewedVariationId: string | null;
  references?: readonly AiReadReference[];
  commands?: readonly AiComposerCommand<CommandId>[];
  suggestedActions?: readonly AiSuggestedAction[];
  agentActivity?: AiAgentActivity | null;
  commentContext?: AiCommentContext | null;
  initialInstruction?: string;
  initialReadContext?: readonly AiReadReference[];
  initialProviderMode?: AiProviderMode;
  previewedPatchId?: string | null;
  onPropose: (
    instruction: string,
    writeScope: PatchScope,
    options: AiProposalOptions<CommandId>,
  ) => void;
  onAccept: (patch: DeckPatch) => void;
  onReject: (patch: DeckPatch) => void;
  onPreviewPatch?: (patch: AiReviewablePatch | null) => void;
  onClearCommentContext?: () => void;
  onGenerateVariations: (request: AiVariationRequest) => void;
  onPreviewVariation: (variation: SlideVariation | null) => void;
  onAcceptVariation: (variation: SlideVariation) => void;
  onRejectVariation: (variation: SlideVariation) => void;
}

export function AiInspector<CommandId extends string = string>({
  deck,
  slide,
  selectedElements,
  workspaceElements = [],
  patches,
  traces,
  variations,
  variationsLoading,
  isSubmitting,
  variationBusy,
  variationGenerating,
  variationError,
  previewedVariationId,
  references = [],
  commands = [],
  suggestedActions,
  agentActivity,
  commentContext = null,
  initialInstruction = '',
  initialReadContext = [],
  initialProviderMode = 'deterministic',
  previewedPatchId = null,
  onPropose,
  onAccept,
  onReject,
  onPreviewPatch,
  onClearCommentContext,
  onGenerateVariations,
  onPreviewVariation,
  onAcceptVariation,
  onRejectVariation,
}: AiInspectorProps<CommandId>) {
  const [instruction, setInstruction] = useState(initialInstruction);
  const [scopeChoice, setScopeChoice] = useState<ScopeChoice>(
    selectedElements.length > 0 ? 'elements' : 'slide',
  );
  const [operationMode, setOperationMode] = useState<OperationMode>('unrestricted');
  const [designBehavior, setDesignBehavior] = useState<AiDesignBehaviorPolicy>('refine');
  const [referenceUse, setReferenceUse] = useState<AiReferenceUsePolicy>('context_only');
  const [providerMode, setProviderMode] = useState<AiProviderMode>(initialProviderMode);
  const [providerConsent, setProviderConsent] = useState(false);
  const [selectedReadContext, setSelectedReadContext] =
    useState<readonly AiReadReference[]>(initialReadContext);
  const [selectedCommand, setSelectedCommand] = useState<AiComposerCommand<CommandId> | null>(null);
  const [cursorPosition, setCursorPosition] = useState(initialInstruction.length);
  const [dismissedMenuKey, setDismissedMenuKey] = useState<string | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [optimisticAsk, setOptimisticAsk] = useState<string | null>(null);
  const [showPlan, setShowPlan] = useState(true);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const composerId = useId();
  const providerName = `${composerId}-provider`;
  const menuId = `${composerId}-menu`;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
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
        .find((trace) => trace.status === 'planning' || trace.status === 'working'),
    [traces],
  );
  const latestTrace = useMemo(
    () => [...traces].sort((a, b) => b.createdAt - a.createdAt)[0],
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
  const proposalTraceByPatchId = useMemo(() => {
    const byPatchId = new Map<string, AgentTrace>();
    for (const trace of [...traces].sort((a, b) => a.createdAt - b.createdAt)) {
      if (trace.patchId) byPatchId.set(trace.patchId, trace);
    }
    return byPatchId;
  }, [traces]);
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
  const hasProviderFallback = directions.some(
    (variation) =>
      variation.origin === 'deterministic_fallback' &&
      variation.fallbackReason !== 'provider_not_requested',
  );
  const hasPrivateDeterministicDirections = directions.some(
    (variation) =>
      variation.origin === 'deterministic_fallback' &&
      variation.fallbackReason === 'provider_not_requested',
  );

  useEffect(() => {
    if (variationGenerating || !focusGeneratedBatch.current) return;
    if (variationError) {
      focusGeneratedBatch.current = false;
      return;
    }
    if (!latestBatchId || latestBatchId === batchBeforeGeneration.current) return;
    focusGeneratedBatch.current = false;
    setOptimisticAsk(null);
    firstVariationRef.current?.focus();
  }, [latestBatchId, variationError, variationGenerating]);

  useEffect(() => {
    if (!proposals[0] || isSubmitting || agentActivity !== undefined) return;
    setOptimisticAsk(null);
  }, [agentActivity, isSubmitting, proposals]);

  const availableCommands: readonly AiComposerCommand<CommandId>[] = [
    {
      id: '/variations' as CommandId,
      label: 'Generate three directions',
      description: 'Dispatch the existing bounded variation workflow.',
    },
    ...commands.filter((command) => !isVariationsCommand(command.id)),
  ];
  const rawTrigger = composerTrigger(instruction, cursorPosition);
  const rawTriggerKey = rawTrigger
    ? `${rawTrigger.kind}:${rawTrigger.start}:${rawTrigger.query}:${instruction}`
    : null;
  const activeTrigger = rawTrigger && rawTriggerKey !== dismissedMenuKey ? rawTrigger : null;
  const normalizedQuery = activeTrigger?.query.toLocaleLowerCase() ?? '';
  const matchingReferences =
    activeTrigger?.kind === 'reference'
      ? references.filter((reference) =>
          `${reference.label} ${reference.kind} ${reference.id}`
            .toLocaleLowerCase()
            .includes(normalizedQuery),
        )
      : [];
  const matchingCommands =
    activeTrigger?.kind === 'command'
      ? availableCommands.filter((command) =>
          `${command.id} ${command.label}`.toLocaleLowerCase().includes(normalizedQuery),
        )
      : [];
  const menuItemCount = matchingReferences.length + matchingCommands.length;
  const menuOpen = Boolean(activeTrigger && menuItemCount > 0);

  const requestedReadContext = useMemo(() => {
    const deduped = new Map<string, AiReadReference>();
    for (const reference of selectedReadContext) deduped.set(referenceKey(reference), reference);
    return [...deduped.values()];
  }, [selectedReadContext]);

  const provider = createAiProviderRequest(providerMode, providerConsent);
  const providerReady = providerMode === 'deterministic' || providerConsent;
  const resolvedActivity = resolveActivity(
    agentActivity,
    isSubmitting,
    optimisticAsk,
    activeTrace,
    latestTrace,
  );
  const visibleAsk = resolvedActivity?.ask.trim() || optimisticAsk?.trim() || '';
  const contextSuggestions =
    suggestedActions ?? defaultSuggestedActions(selectedElements.length, commentContext);

  const updateInstruction = (value: string, cursor = value.length) => {
    setInstruction(value);
    setCursorPosition(cursor);
    setDismissedMenuKey(null);
    setMenuIndex(0);
  };

  const insertToken = (token: string) => {
    if (!activeTrigger) return;
    const next = `${instruction.slice(0, activeTrigger.start)}${token} ${instruction.slice(
      activeTrigger.end,
    )}`;
    const nextCursor = activeTrigger.start + token.length + 1;
    updateInstruction(next, nextCursor);
    queueMicrotask(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const chooseReference = (reference: AiReadReference) => {
    insertToken(`@${reference.label}`);
    setSelectedReadContext((current) =>
      current.some((candidate) => referenceKey(candidate) === referenceKey(reference))
        ? current
        : [...current, reference],
    );
  };

  const chooseCommand = (command: AiComposerCommand<CommandId>) => {
    insertToken(commandToken(command.id));
    setSelectedCommand(command);
  };

  const openTokenMenu = (token: '@' | '/') => {
    const spacer = instruction.length > 0 && !/\s$/.test(instruction) ? ' ' : '';
    const next = `${instruction}${spacer}${token}`;
    updateInstruction(next);
    queueMicrotask(() => textareaRef.current?.focus());
  };

  const requestVariations = (source: AiVariationRequest['source'], ask?: string) => {
    const variationProvider = createAiVariationProviderRequest(providerMode, providerConsent);
    if (!variationProvider || variationBusy) return;
    focusGeneratedBatch.current = true;
    batchBeforeGeneration.current = latestBatchId;
    if (ask) setOptimisticAsk(ask);
    onGenerateVariations({
      ...variationProvider,
      readContext: requestedReadContext,
      designBehavior,
      referenceUse,
      source,
      ...(commentContext ? { commentContext } : {}),
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = instruction.trim();
    if (!text || isSubmitting || !provider) return;
    const command = selectedCommand ?? commandFromInstruction(instruction, availableCommands);
    if (command && isVariationsCommand(command.id)) {
      requestVariations('command', text);
      updateInstruction('');
      setSelectedCommand(null);
      return;
    }
    const writeScope = commentContext
      ? createCommentScope(commentContext, operationMode, deck, workspaceElements)
      : createScope(scopeChoice, operationMode, deck.id, slide.id, selectedElements);
    const options: AiProposalOptions<CommandId> = {
      ...provider,
      readContext: requestedReadContext,
      designBehavior,
      referenceUse,
      ...(commentContext ? { commentContext } : {}),
      ...(command && !isVariationsCommand(command.id)
        ? {
            commandId: command.id as Exclude<CommandId, '/variations' | 'variations'>,
          }
        : {}),
    };
    setOptimisticAsk(text);
    onPropose(text, writeScope, options);
    updateInstruction('');
    setSelectedCommand(null);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setMenuIndex((current) => {
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        return (current + delta + menuItemCount) % menuItemCount;
      });
      return;
    }
    if (menuOpen && event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      const reference = matchingReferences[menuIndex];
      if (reference) chooseReference(reference);
      else {
        const command = matchingCommands[menuIndex - matchingReferences.length];
        if (command) chooseCommand(command);
      }
      return;
    }
    if (menuOpen && event.key === 'Escape') {
      event.preventDefault();
      setDismissedMenuKey(rawTriggerKey);
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const removeReadReference = (reference: AiReadReference) => {
    setSelectedReadContext((current) =>
      current.filter((candidate) => referenceKey(candidate) !== referenceKey(reference)),
    );
    updateInstruction(removeVisibleToken(instruction, `@${reference.label}`));
  };

  const removeCommand = () => {
    if (selectedCommand) {
      updateInstruction(removeVisibleToken(instruction, commandToken(selectedCommand.id)));
    }
    setSelectedCommand(null);
  };

  const returnToOriginal = () => {
    const previewButton = lastPreviewButtonRef.current;
    onPreviewVariation(null);
    requestAnimationFrame(() => previewButton?.focus());
  };

  return (
    <div className="ns-inspector-scroll ns-ai-inspector ns-ai-v3-shell">
      <section
        className="ns-ai-v3-context"
        aria-labelledby={`${composerId}-context-heading`}
        data-testid="ai-context-header"
      >
        <div className="ns-ai-v3-context-heading">
          <span className="ns-eyebrow" id={`${composerId}-context-heading`}>
            Context
          </span>
          <span className="ns-ai-v3-context-policy">Read context · locked write scope</span>
        </div>
        <div className="ns-ai-v3-context-chips" aria-label="Active AI context">
          <span className="ns-ai-v3-context-chip is-slide">
            Slide {String(Math.max(1, deck.slideOrder.indexOf(slide.id) + 1)).padStart(2, '0')} ·{' '}
            {slide.title}
          </span>
          {selectedElements.length > 0 ? (
            <span className="ns-ai-v3-context-chip is-selection">
              Selection · {selectedElements.length}
            </span>
          ) : null}
          {commentContext ? (
            <span className="ns-ai-v3-context-chip is-comment">
              <MessageCircle size={11} /> {commentContext.label}
            </span>
          ) : null}
          {requestedReadContext.map((reference) => (
            <span
              className="ns-ai-v3-context-chip is-reference"
              key={`context-${referenceKey(reference)}`}
            >
              @{reference.label}
            </span>
          ))}
        </div>
        <p className="ns-ai-v3-context-note">
          {requestedReadContext.length > 0
            ? `${requestedReadContext.length} explicit read reference${requestedReadContext.length === 1 ? '' : 's'} added to scoped context.`
            : 'Scoped context by default; explicit @ references are additive.'}
        </p>
      </section>

      <div className="ns-ai-v3-review-scroll" data-testid="ai-review-scroll">
        <section className="ns-inspector-section ns-ai-intro ns-ai-v3-intro">
          <div className="ns-section-title-row">
            <div>
              <span className="ns-eyebrow">Scoped copilot</span>
              <h2>Ask NodeSlide</h2>
            </div>
            <span
              className={`ns-route-pill ${
                providerMode === 'openrouter_free' ? 'is-external' : 'is-private'
              }`}
              data-testid="ai-provider-summary"
            >
              {providerMode === 'deterministic' ? (
                <>
                  <ShieldCheck size={11} /> Private / deterministic
                </>
              ) : (
                <>
                  <Sparkles size={11} /> External / OpenRouter
                </>
              )}
            </span>
          </div>
          <p>Describe the outcome. You’ll review a structured patch before anything changes.</p>
        </section>

        {visibleAsk ? (
          <section
            className="ns-ai-optimistic-ask ns-ai-v3-chat-turn is-user"
            data-testid="optimistic-user-ask"
          >
            <span>You asked</span>
            <p>{visibleAsk}</p>
          </section>
        ) : null}

        {resolvedActivity || activeTrace ? (
          <section
            className={`ns-agent-progress ns-ai-v3-progress ${
              resolvedActivity && resolvedActivity.status !== 'running' ? 'has-failed' : ''
            }`}
            aria-live="polite"
            {...(resolvedActivity && resolvedActivity.status !== 'running'
              ? { role: 'alert' as const }
              : {})}
          >
            <button
              type="button"
              className="ns-progress-heading"
              onClick={() => setShowPlan((value) => !value)}
              aria-expanded={showPlan}
            >
              <span className="ns-agent-orb">
                {resolvedActivity && resolvedActivity.status !== 'running' ? (
                  <TriangleAlert size={14} />
                ) : (
                  <LoaderCircle className="ns-spin" size={14} />
                )}
              </span>
              <span>
                <strong>
                  {resolvedActivity
                    ? agentPhaseLabel(resolvedActivity)
                    : activeTrace?.status === 'working'
                      ? 'Drafting proposal'
                      : 'Reading context'}
                </strong>
                <small>{activeTrace?.summary ?? 'Preparing a bounded, reviewable patch'}</small>
              </span>
              <ChevronRight size={14} className={showPlan ? 'is-open' : ''} />
            </button>
            {resolvedActivity && resolvedActivity.status !== 'running' ? (
              <div className="ns-agent-honesty-state">
                <strong>
                  {resolvedActivity.message ??
                    (resolvedActivity.status === 'timed_out'
                      ? 'The request timed out before a reviewable proposal was returned.'
                      : 'The agent failed before a reviewable proposal was returned.')}
                </strong>
                <p>No proposal was created or applied. Your deck remains unchanged.</p>
              </div>
            ) : showPlan && activeTrace?.plan.length ? (
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
          <section className="ns-proposals ns-ai-v3-proposals">
            <div className="ns-section-heading">
              <span>Proposals</span>
              <small>{proposals.length} to review</small>
            </div>
            {proposals.map((patch) => (
              <ProposalCard
                key={patch.id}
                patch={patch}
                {...(proposalTraceByPatchId.get(patch.id)
                  ? { trace: proposalTraceByPatchId.get(patch.id) }
                  : {})}
                previewed={patch.id === previewedPatchId}
                {...(onPreviewPatch ? { onPreview: onPreviewPatch } : {})}
                onAccept={onAccept}
                onReject={onReject}
              />
            ))}
          </section>
        ) : (
          <div className="ns-empty-state ns-empty-state--compact ns-ai-v3-empty-review">
            <span>
              <Sparkles size={17} />
            </span>
            <strong>No proposal waiting</strong>
            <p>Ask for a change below. The agent will return a reviewable diff.</p>
          </div>
        )}

        <section
          className="ns-variation-section ns-ai-v3-directions"
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
              disabled={variationBusy || !providerReady}
              onClick={() => requestVariations('button')}
              aria-controls="ns-variation-results"
              data-testid="variation-generate"
              title={
                providerReady
                  ? 'Generate three bounded directions'
                  : 'Consent is required before using OpenRouter'
              }
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
                onClick={() => requestVariations('button')}
                disabled={variationBusy || !providerReady}
              >
                Try again
              </button>
            </div>
          ) : null}

          {hasProviderFallback || hasPrivateDeterministicDirections ? (
            <output className="ns-variation-fallback-note">
              <Sparkles size={13} />
              <span>
                {hasProviderFallback
                  ? 'The external GLM 5.2 route could not safely supply every direction. Clearly labeled deterministic fallbacks are shown instead.'
                  : 'Three private deterministic directions are ready. No instruction or slide context left NodeSlide.'}
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

        {contextSuggestions.length > 0 ? (
          <section
            className="ns-ai-suggested-actions ns-ai-v3-suggested-actions"
            aria-label="Suggested prompts"
          >
            <span>Suggested actions</span>
            <div>
              {contextSuggestions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => updateInstruction(action.instruction)}
                  data-testid="ai-suggested-action"
                >
                  {action.label}
                </button>
              ))}
            </div>
            <small>Suggestions only prefill the composer; they never send automatically.</small>
          </section>
        ) : null}
      </div>

      <form
        className={`ns-ai-composer ns-ai-v3-composer ${composerExpanded ? 'is-expanded' : ''}`}
        onSubmit={submit}
        data-testid="ai-composer"
      >
        <details className="ns-ai-v3-route-disclosure">
          <summary className="ns-ai-v3-route-summary">
            {providerMode === 'deterministic' ? (
              <>
                <ShieldCheck size={13} /> Web: off · Private deterministic
              </>
            ) : (
              <>
                <Sparkles size={13} /> Web: external · OpenRouter · GLM 5.2
                <span className={providerConsent ? 'has-consent' : 'needs-consent'}>
                  {providerConsent ? 'Consent attached' : 'Consent required'}
                </span>
              </>
            )}
          </summary>
          <fieldset className="ns-ai-provider-controls ns-ai-v3-provider-controls">
            <legend>Provider and privacy</legend>
            <label className={providerMode === 'deterministic' ? 'is-active' : ''}>
              <input
                type="radio"
                name={providerName}
                value="deterministic"
                checked={providerMode === 'deterministic'}
                onChange={() => {
                  setProviderMode('deterministic');
                  setProviderConsent(false);
                }}
                data-testid="ai-provider-deterministic"
              />
              <ShieldCheck size={15} />
              <span>
                <strong>Deterministic and private</strong>
                <small>No instruction or context is sent to an external model.</small>
              </span>
            </label>
            <label className={providerMode === 'openrouter_free' ? 'is-active' : ''}>
              <input
                type="radio"
                name={providerName}
                value="openrouter_free"
                checked={providerMode === 'openrouter_free'}
                onChange={() => {
                  setProviderMode('openrouter_free');
                  setProviderConsent(false);
                }}
                data-testid="ai-provider-openrouter"
              />
              <Sparkles size={15} />
              <span>
                <strong>OpenRouter · GLM 5.2 — external</strong>
                <small>
                  Sends this ask, selected read context, and scoped slide content to the named GLM
                  5.2 model through OpenRouter.
                </small>
              </span>
            </label>
            <label className="ns-ai-provider-consent">
              <input
                type="checkbox"
                checked={providerConsent}
                disabled={providerMode !== 'openrouter_free'}
                onChange={(event) => setProviderConsent(event.target.checked)}
                data-testid="ai-provider-consent"
              />
              <span>
                I explicitly consent to this external OpenRouter request
                <small>
                  Required for each selected external mode. The versioned consent token is attached
                  to propose and variation callbacks.
                </small>
              </span>
            </label>
          </fieldset>
        </details>

        {commentContext ? (
          <div className="ns-ai-comment-scope-chip" data-testid="ai-comment-scope-chip">
            <MessageCircle size={14} />
            <span>
              <small>Comment write scope</small>
              <strong>{commentContext.label}</strong>
            </span>
            {onClearCommentContext ? (
              <button
                type="button"
                onClick={onClearCommentContext}
                aria-label={`Remove comment scope ${commentContext.label}`}
              >
                <X size={13} />
              </button>
            ) : null}
          </div>
        ) : (
          <div className="ns-scope-row" aria-label="AI write scope">
            <span>Write</span>
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
        )}

        <div className="ns-ai-policy-grid">
          <label>
            <span>Operation mode</span>
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
          </label>
          <label>
            <span>Design behavior</span>
            <select
              value={designBehavior}
              onChange={(event) => setDesignBehavior(event.target.value as AiDesignBehaviorPolicy)}
              data-testid="ai-design-behavior"
            >
              <option value="preserve">Preserve exactly</option>
              <option value="refine">Refine subtly</option>
              <option value="rebalance">Rebalance hierarchy</option>
              <option value="reinterpret">Explore a new direction</option>
              <option value="reimagine">Reimagine boldly</option>
            </select>
          </label>
          <label>
            <span>Reference use</span>
            <select
              value={referenceUse}
              onChange={(event) => setReferenceUse(event.target.value as AiReferenceUsePolicy)}
              data-testid="ai-reference-use"
            >
              <option value="context_only">Context only</option>
              <option value="inspiration">Use as inspiration</option>
              <option value="style_direction">Follow style direction</option>
            </select>
          </label>
        </div>

        <div className="ns-composer-token-toolbar ns-ai-v3-composer-toolbar">
          <button
            type="button"
            onClick={() => openTokenMenu('@')}
            disabled={references.length === 0}
            aria-label="Add read context reference"
          >
            <AtSign size={12} /> Context
          </button>
          <button type="button" onClick={() => openTokenMenu('/')} aria-label="Add command">
            <Command size={12} /> Insert
          </button>
          <span>
            {requestedReadContext.length > 0
              ? `${requestedReadContext.length} explicit reference${requestedReadContext.length === 1 ? '' : 's'}`
              : 'Scoped context by default'}
          </span>
        </div>

        {commentContext || selectedReadContext.length > 0 || selectedCommand ? (
          <div className="ns-composer-tokens" aria-label="Composer tokens">
            {commentContext ? (
              <span className="is-comment">
                <MessageCircle size={11} /> @{commentContext.label}
              </span>
            ) : null}
            {selectedReadContext.map((reference) => (
              <button
                key={referenceKey(reference)}
                type="button"
                onClick={() => removeReadReference(reference)}
                aria-label={`Remove read context ${reference.label}`}
              >
                @{reference.label} <X size={10} />
              </button>
            ))}
            {selectedCommand ? (
              <button
                type="button"
                className="is-command"
                onClick={removeCommand}
                aria-label={`Remove command ${selectedCommand.label}`}
              >
                {commandToken(selectedCommand.id)} <X size={10} />
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="ns-composer-field ns-ai-v3-composer-field">
          <label className="ns-sr-only" htmlFor={composerId}>
            AI instruction
          </label>
          <textarea
            ref={textareaRef}
            id={composerId}
            rows={composerExpanded ? 9 : 3}
            value={instruction}
            onChange={(event) => {
              updateInstruction(event.target.value, event.target.selectionStart);
            }}
            onSelect={(event) => setCursorPosition(event.currentTarget.selectionStart)}
            placeholder={
              commentContext
                ? 'Address this review comment without resolving it...'
                : scopeChoice === 'elements'
                  ? 'Make this feel more decisive...'
                  : 'Turn this into a crisp executive story...'
            }
            onKeyDown={handleComposerKeyDown}
            aria-autocomplete="list"
            aria-controls={menuOpen ? menuId : undefined}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          />
          <div className="ns-composer-meta">
            <span>
              <Bot size={12} /> Read context is separate from locked write scope
            </span>
            <button
              type="button"
              className="ns-ai-v3-expand-composer"
              onClick={() => setComposerExpanded((expanded) => !expanded)}
              aria-label={composerExpanded ? 'Collapse composer' : 'Expand composer'}
              aria-pressed={composerExpanded}
              title={composerExpanded ? 'Collapse composer' : 'Expand composer'}
            >
              <Maximize2 size={14} />
            </button>
            <button
              type="submit"
              disabled={!instruction.trim() || isSubmitting || !providerReady}
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
        </div>

        {menuOpen ? (
          <div
            id={menuId}
            className="ns-composer-menu"
            role="menu"
            tabIndex={-1}
            aria-label={activeTrigger?.kind === 'reference' ? 'Read context' : 'Commands'}
          >
            {matchingReferences.map((reference, index) => (
              <button
                key={referenceKey(reference)}
                id={`${menuId}-option-${index}`}
                type="button"
                role="menuitem"
                className={menuIndex === index ? 'is-active' : ''}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseReference(reference)}
              >
                <AtSign size={12} />
                <span>
                  <strong>{reference.label}</strong>
                  <small>{humanizeAxis(reference.kind)}</small>
                </span>
              </button>
            ))}
            {matchingCommands.map((command, commandIndex) => {
              const index = matchingReferences.length + commandIndex;
              return (
                <button
                  key={command.id}
                  id={`${menuId}-option-${index}`}
                  type="button"
                  role="menuitem"
                  className={menuIndex === index ? 'is-active' : ''}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseCommand(command)}
                >
                  <Command size={12} />
                  <span>
                    <strong>{commandToken(command.id)}</strong>
                    <small>{command.description ?? command.label}</small>
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        <small className="ns-shortcut-hint">
          <kbd>⌘</kbd>
          <kbd>↵</kbd> to propose ·{' '}
          {providerMode === 'deterministic'
            ? 'private deterministic processing'
            : providerConsent
              ? 'external OpenRouter consent attached'
              : 'external OpenRouter consent required'}
        </small>
      </form>
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
          {variation.origin === 'free_route'
            ? 'OpenRouter · GLM 5.2 · external'
            : variation.fallbackReason === 'provider_not_requested'
              ? 'Private deterministic'
              : 'Deterministic fallback'}
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
      {variation.fallbackReason && variation.fallbackReason !== 'provider_not_requested' ? (
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
  trace,
  previewed,
  onPreview,
  onAccept,
  onReject,
}: {
  patch: AiReviewablePatch;
  trace?: AgentTrace | undefined;
  previewed: boolean;
  onPreview?: (patch: AiReviewablePatch | null) => void;
  onAccept: (patch: DeckPatch) => void;
  onReject: (patch: DeckPatch) => void;
}) {
  const counts = countOperations(patch.operations);
  const stale = patch.status === 'stale';
  const candidateValidation =
    patch.candidateValidation?.patchId === patch.id ? patch.candidateValidation : undefined;
  const previewAvailable = patch.status === 'ready' && Boolean(onPreview);
  return (
    <article
      className={`ns-proposal-card ${stale ? 'is-stale' : ''} ${previewed ? 'is-previewed' : ''}`}
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
      <dl className="ns-proposal-evidence" aria-label="Proposal evidence">
        <div>
          <dt>Write scope</dt>
          <dd>{scopeEvidence(patch.scope)}</dd>
        </div>
        <div>
          <dt>Base</dt>
          <dd>{baseEvidence(patch)}</dd>
        </div>
        <div>
          <dt>Operations</dt>
          <dd>{patch.operations.length} ops</dd>
        </div>
        {trace?.provider && trace.model ? (
          <div>
            <dt>Provider · model</dt>
            <dd>
              {trace.provider} · {trace.model}
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="ns-diff-summary">
        {counts.map(({ label, count, kind }) => (
          <span key={kind} className={`is-${kind}`}>
            {kind === 'remove' ? '−' : kind === 'add' ? '+' : '↗'} {count} {label}
          </span>
        ))}
      </div>
      {candidateValidation ? (
        <div
          className={`ns-candidate-validation ${
            candidateValidation.ok ? 'is-valid' : 'is-invalid'
          }`}
          data-testid="candidate-validation"
        >
          <strong>Candidate validation {candidateValidation.ok ? 'passed' : 'needs review'}</strong>
          <small>Receipt {candidateValidation.id}</small>
          {candidateValidation.issues.length > 0 ? (
            <ul>
              {candidateValidation.issues.map((issue) => (
                <li key={issue.id}>
                  {humanizeAxis(issue.severity)} · {issue.message}
                </li>
              ))}
            </ul>
          ) : (
            <span>No candidate-specific issues.</span>
          )}
        </div>
      ) : null}
      <details>
        <summary>View structured diff</summary>
        <ul>
          {patch.operations.map((operation, index) => (
            <li key={`${operation.op}-${index}`}>{describeOperation(operation)}</li>
          ))}
        </ul>
      </details>
      <div className="ns-proposal-actions">
        <button
          className="ns-button ns-button--quiet"
          type="button"
          onClick={() => onPreview?.(previewed ? null : patch)}
          disabled={!previewAvailable}
          aria-pressed={previewed}
          title={
            onPreview ? 'Preview candidate beside the current slide' : 'Compare is not connected'
          }
          data-testid="proposal-preview"
        >
          <GitCompareArrows size={13} /> {previewed ? 'End compare' : 'Preview / Compare'}
        </button>
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

export function createAiProviderRequest(
  mode: AiProviderMode,
  consentGranted: boolean,
): AiProviderRequest | null {
  if (mode === 'deterministic') return { providerMode: 'deterministic' };
  if (!consentGranted) return null;
  return {
    providerMode: 'openrouter_free',
    providerConsent: NODESLIDE_OPENROUTER_REVIEW_CONSENT,
  };
}

export function createAiVariationProviderRequest(
  mode: AiProviderMode,
  consentGranted: boolean,
): AiVariationProviderRequest | null {
  if (mode === 'deterministic') return { providerMode: 'deterministic' };
  if (!consentGranted) return null;
  return {
    providerMode: 'openrouter_free',
    providerConsent: NODESLIDE_OPENROUTER_VARIATIONS_CONSENT,
  };
}

export function agentPhaseLabel(activity: AiAgentActivity): string {
  if (activity.status === 'timed_out') return 'Timed out';
  if (activity.status === 'failed') return 'Failed';
  return activity.elapsedMs >= AI_DRAFTING_PHASE_MS ? 'Drafting proposal' : 'Reading context';
}

function resolveActivity(
  controlled: AiAgentActivity | null | undefined,
  isSubmitting: boolean,
  optimisticAsk: string | null,
  activeTrace: AgentTrace | undefined,
  latestTrace: AgentTrace | undefined,
): AiAgentActivity | null {
  if (controlled !== undefined) return controlled;
  if (isSubmitting || activeTrace) {
    return {
      status: 'running',
      elapsedMs: activeTrace?.status === 'working' ? AI_DRAFTING_PHASE_MS : 0,
      ask: optimisticAsk ?? '',
    };
  }
  if (latestTrace?.status === 'failed') {
    return {
      status: 'failed',
      elapsedMs: Math.max(
        0,
        (latestTrace.completedAt ?? latestTrace.createdAt) - latestTrace.createdAt,
      ),
      ask: optimisticAsk ?? '',
      message: latestTrace.summary,
    };
  }
  return null;
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

export function createCommentScope(
  comment: AiCommentContext,
  operationMode: OperationMode,
  deck: Deck,
  elements: readonly SlideElement[],
): PatchScope {
  const deckSlideIds = new Set(deck.slideOrder);
  const anchor = comment.anchor;
  let slideIds: string[];
  let elementIds: string[];

  if (anchor.type === 'deck') {
    slideIds = [...deck.slideOrder];
    elementIds = elements
      .filter((element) => deckSlideIds.has(element.slideId))
      .map((element) => element.id);
  } else if (anchor.type === 'element') {
    slideIds = [anchor.slideId];
    elementIds = [anchor.elementId];
  } else {
    slideIds = [anchor.slideId];
    elementIds = elements
      .filter(
        (element) =>
          element.slideId === anchor.slideId &&
          (anchor.type !== 'bounding_box' || boundingBoxesIntersect(element.bbox, anchor.bbox)),
      )
      .map((element) => element.id);
  }

  return {
    kind: 'comment',
    deckId: anchor.deckId,
    slideIds,
    elementIds,
    commentId: comment.id,
    operationMode,
  };
}

function boundingBoxesIntersect(left: SlideElement['bbox'], right: SlideElement['bbox']): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function composerTrigger(value: string, cursor: number): ComposerTrigger | null {
  const boundedCursor = Math.max(0, Math.min(cursor, value.length));
  const beforeCursor = value.slice(0, boundedCursor);
  const match = /(?:^|\s)([@/])([^\s@/]*)$/.exec(beforeCursor);
  if (!match || match.index === undefined) return null;
  const token = match[1];
  if (token !== '@' && token !== '/') return null;
  const leadingWhitespace = match[0].startsWith(token) ? 0 : 1;
  return {
    kind: token === '@' ? 'reference' : 'command',
    query: match[2] ?? '',
    start: match.index + leadingWhitespace,
    end: boundedCursor,
  };
}

function commandFromInstruction<CommandId extends string>(
  instruction: string,
  commands: readonly AiComposerCommand<CommandId>[],
): AiComposerCommand<CommandId> | null {
  const commandTokens = new Set(
    [...instruction.matchAll(/(?:^|\s)\/([a-zA-Z0-9_-]+)/g)].map((match) => `/${match[1]}`),
  );
  return commands.find((command) => commandTokens.has(commandToken(command.id))) ?? null;
}

function commandToken(commandId: string) {
  return commandId.startsWith('/') ? commandId : `/${commandId}`;
}

function isVariationsCommand(commandId: string) {
  return commandToken(commandId) === '/variations';
}

function referenceKey(reference: AiReadReference) {
  return `${reference.kind}:${reference.id}`;
}

function removeVisibleToken(instruction: string, token: string) {
  const index = instruction.indexOf(token);
  if (index < 0) return instruction;
  return `${instruction.slice(0, index)}${instruction.slice(index + token.length)}`
    .replace(/\s{2,}/g, ' ')
    .trimStart();
}

function defaultSuggestedActions(
  selectedElementCount: number,
  commentContext: AiCommentContext | null,
): readonly AiSuggestedAction[] {
  if (commentContext) {
    return [
      {
        id: 'address-comment',
        label: 'Address the feedback',
        instruction: 'Address this comment with the smallest scoped change.',
      },
      {
        id: 'explain-comment-tradeoff',
        label: 'Propose a tradeoff',
        instruction: 'Propose a scoped response that explains the tradeoff in this comment.',
      },
    ];
  }
  if (selectedElementCount > 0) {
    return [
      {
        id: 'tighten-selection',
        label: 'Tighten selection',
        instruction: 'Tighten the selected elements while preserving their facts.',
      },
      {
        id: 'align-selection',
        label: 'Improve alignment',
        instruction: 'Improve alignment and hierarchy within the selected elements.',
      },
    ];
  }
  return [
    {
      id: 'sharpen-slide',
      label: 'Sharpen the story',
      instruction: 'Sharpen this slide’s main point without adding unsupported facts.',
    },
    {
      id: 'reduce-density',
      label: 'Reduce density',
      instruction: 'Reduce visual and copy density while preserving the evidence.',
    },
  ];
}

function scopeEvidence(scope: PatchScope) {
  if (scope.kind === 'deck') return 'Entire deck';
  if (scope.kind === 'slide')
    return `${scope.slideIds.length} slide${scope.slideIds.length === 1 ? '' : 's'}`;
  if (scope.kind === 'elements') {
    return `${scope.elementIds.length} element${scope.elementIds.length === 1 ? '' : 's'} on ${
      scope.slideIds.length
    } slide${scope.slideIds.length === 1 ? '' : 's'}`;
  }
  if (scope.kind === 'bounding_box') return `Bounding box on ${scope.slideIds.length} slide`;
  return `Comment ${scope.commentId}`;
}

function baseEvidence(patch: DeckPatch) {
  const slideClocks = Object.keys(patch.baseSlideVersions).length;
  const elementClocks = Object.keys(patch.baseElementVersions).length;
  const clocks = [
    slideClocks > 0 ? `${slideClocks} slide clock${slideClocks === 1 ? '' : 's'}` : '',
    elementClocks > 0 ? `${elementClocks} element clock${elementClocks === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return `Deck v${patch.baseDeckVersion}${clocks.length > 0 ? ` · ${clocks.join(' · ')}` : ''}`;
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
  return `Changes ${labels.join(', ')} across ${operations.length} operation${
    operations.length === 1 ? '' : 's'
  }.`;
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
    return `Add slide “${operation.slide.title}” with ${operation.elements.length} elements at position ${
      operation.index + 1
    }`;
  if (operation.op === 'remove_slide') return `Remove slide ${operation.slideId}`;
  if (operation.op === 'update_deck')
    return `Update deck ${Object.keys(operation.properties).join(', ')}`;
  if (operation.op === 'move')
    return `Move ${operation.elementId} to ${percent(operation.x)}, ${percent(operation.y)}`;
  if (operation.op === 'resize')
    return `Resize ${operation.elementId} to ${percent(operation.width)} × ${percent(
      operation.height,
    )}`;
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
  return clean.length > 90 ? `${clean.slice(0, 87)}...` : clean;
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function humanizeStatus(status: string) {
  return status.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}
