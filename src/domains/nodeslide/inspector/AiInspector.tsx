import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import { ThreadPrimitive } from '@assistant-ui/react';
import {
  ArrowDown,
  AtSign,
  Brain,
  Check,
  ChevronRight,
  Circle,
  Command,
  Eye,
  GitCompareArrows,
  Globe2,
  Layers3,
  LoaderCircle,
  Maximize2,
  MessageCircle,
  PlugZap,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  type KeyboardEvent,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type AgentTrace,
  type Deck,
  type DeckPatch,
  NODESLIDE_DEFAULT_AGENT_MODEL,
  NODESLIDE_REASONING_EFFORTS,
  NODESLIDE_SCOPE_SLIDE_LIMIT,
  type NodeSlideAgentMemory,
  type NodeSlideAgentMemoryCategory,
  type NodeSlideAgentMessage,
  type NodeSlideAgentModelId,
  type NodeSlideAgentRun,
  type NodeSlideReasoningEffort,
  type OperationMode,
  type PatchOperation,
  type PatchScope,
  type Slide,
  type SlideElement,
  isNodeSlideAgentModelId,
  nodeSlideAgentModel,
  nodeSlideModelSupportsReasoningEffort,
  nodeSlideProviderModeForModel,
} from '../../../../shared/nodeslide';
import {
  NODESLIDE_BROWSER_DELEGATION_TTL_MS,
  NODESLIDE_DELEGATION_MAX_OPERATIONS,
  NODESLIDE_DELEGATION_MAX_USES,
} from '../../../../shared/nodeslideDelegation';
import type { SlideVariation } from '../../../../shared/nodeslideVariation';
import { NodeSlideConnectionsDialog } from '../components/NodeSlideConnectionsDialog';
import { NodeSlideMemoryDialog } from '../components/NodeSlideMemoryDialog';
import {
  NODESLIDE_COMPOSER_DEFAULT_REASONING_EFFORT,
  NodeSlidePromptComposer,
  nodeSlideNativeEffortLabel,
} from '../composer/NodeSlidePromptComposer';
import {
  nodeSlideComposerSessionKey,
  useNodeSlideComposerSession,
} from '../composer/nodeSlideComposerSession';
import {
  createExternalProviderRequestKey,
  useSessionExternalConsent,
} from '../externalProviderConsent';
import type { AgentSessionApprovalMode } from '../session';
import {
  NodeSlideThreadMessages,
  NodeSlideThreadRuntimeProvider,
  buildNodeSlideThreadMessages,
} from './NodeSlideAgentThread';
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
  NODESLIDE_NEBIUS_REVIEW_CONSENT,
  NODESLIDE_NEBIUS_VARIATIONS_CONSENT,
  NODESLIDE_OPENROUTER_REVIEW_CONSENT,
  NODESLIDE_OPENROUTER_VARIATIONS_CONSENT,
  NODESLIDE_WEB_RESEARCH_CONSENT,
} from './reviewTypes';
import { nodeSlideScopeLabel } from './scopePresentation';

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

type ScopeChoice = 'deck' | 'slide' | 'selected_slides' | 'elements';
type AiReviewProviderConsent = Exclude<
  AiProviderRequest,
  { providerMode: 'deterministic' }
>['providerConsent'];
type AiVariationProviderConsent = Exclude<
  AiVariationProviderRequest,
  { providerMode: 'deterministic' }
>['providerConsent'];

interface AiProviderConsentGrant {
  providerMode: Exclude<AiProviderMode, 'deterministic'>;
  reviewConsent: AiReviewProviderConsent;
  variationConsent: AiVariationProviderConsent;
}

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
  selectedSlideIds?: readonly string[];
  workspaceElements?: readonly SlideElement[];
  patches: readonly AiReviewablePatch[];
  traces: readonly AgentTrace[];
  agentRuns?: readonly NodeSlideAgentRun[];
  agentMessages?: readonly NodeSlideAgentMessage[];
  memories?: readonly NodeSlideAgentMemory[];
  memoriesLoading?: boolean;
  approvalMode?: AgentSessionApprovalMode;
  approvalBusy?: boolean;
  approvalExpiresAt?: number;
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
  initialProviderModel?: NodeSlideAgentModelId;
  previewedPatchId?: string | null;
  onPropose: (
    instruction: string,
    writeScope: PatchScope,
    options: AiProposalOptions<CommandId>,
  ) => void;
  onAttachDataFile?: (file: File) => Promise<AiReadReference>;
  onCreateMemory?: (category: NodeSlideAgentMemoryCategory, content: string) => Promise<void>;
  onUpdateMemory?: (
    memoryId: string,
    update: Partial<Pick<NodeSlideAgentMemory, 'category' | 'content' | 'status'>>,
  ) => Promise<void>;
  onDeleteMemory?: (memoryId: string) => Promise<void>;
  onApprovalModeChange?: (mode: AgentSessionApprovalMode) => void;
  onCancelRun?: (runId: string) => void;
  onRetryRun?: () => void;
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
  selectedSlideIds = [],
  workspaceElements = [],
  patches,
  traces,
  agentRuns = [],
  agentMessages = [],
  memories = [],
  memoriesLoading = false,
  approvalMode = 'review',
  approvalBusy = false,
  approvalExpiresAt,
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
  initialProviderMode = 'nebius',
  initialProviderModel = NODESLIDE_DEFAULT_AGENT_MODEL,
  previewedPatchId = null,
  onPropose,
  onAttachDataFile,
  onCreateMemory,
  onUpdateMemory,
  onDeleteMemory,
  onApprovalModeChange,
  onCancelRun,
  onRetryRun,
  onAccept,
  onReject,
  onPreviewPatch,
  onClearCommentContext,
  onGenerateVariations,
  onPreviewVariation,
  onAcceptVariation,
  onRejectVariation,
}: AiInspectorProps<CommandId>) {
  const composerSession = useNodeSlideComposerSession(
    nodeSlideComposerSessionKey('editor', deck.id),
    { text: initialInstruction },
  );
  const instruction = composerSession.text;
  const [scopeChoice, setScopeChoice] = useState<ScopeChoice>(
    selectedElements.length > 0 ? 'elements' : 'slide',
  );
  const [operationMode, setOperationMode] = useState<OperationMode>('unrestricted');
  const [designBehavior, setDesignBehavior] = useState<AiDesignBehaviorPolicy>('refine');
  const [referenceUse, setReferenceUse] = useState<AiReferenceUsePolicy>('context_only');
  const [providerMode, setProviderMode] = useState<AiProviderMode>(initialProviderMode);
  const [providerModel, setProviderModel] = useState<NodeSlideAgentModelId>(initialProviderModel);
  const [providerEffort, setProviderEffort] = useState<NodeSlideReasoningEffort>(
    NODESLIDE_COMPOSER_DEFAULT_REASONING_EFFORT,
  );
  const [webResearch, setWebResearch] = useState(false);
  const [providerControlsOpen, setProviderControlsOpen] = useState(false);
  const [selectedReadContext, setSelectedReadContext] =
    useState<readonly AiReadReference[]>(initialReadContext);
  const [selectedCommand, setSelectedCommand] = useState<AiComposerCommand<CommandId> | null>(null);
  const [cursorPosition, setCursorPosition] = useState(instruction.length);
  const [dismissedMenuKey, setDismissedMenuKey] = useState<string | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [optimisticAsk, setOptimisticAsk] = useState<string | null>(null);
  const [showPlan, setShowPlan] = useState(true);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [submissionPreparing, setSubmissionPreparing] = useState(false);
  const submissionPreparingRef = useRef(false);
  const handleSubmissionPreparingChange = useCallback((preparing: boolean) => {
    submissionPreparingRef.current = preparing;
    setSubmissionPreparing(preparing);
  }, []);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const clearAttachmentError = useCallback(() => setAttachmentError(null), []);
  const approvalBusyRef = useRef(approvalBusy);
  approvalBusyRef.current = approvalBusy;
  const approvalSignature = `${approvalMode}:${approvalExpiresAt ?? 0}:${approvalBusy ? 'busy' : 'ready'}`;
  const approvalControlLocked =
    approvalBusy || attachmentBusy || submissionPreparing || isSubmitting;
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const activeMemoryCount = memories.filter((memory) => memory.status === 'active').length;
  const useMemoryForRun = memoryEnabled && activeMemoryCount > 0;
  const composerId = useId();
  const providerName = `${composerId}-provider`;
  const menuId = `${composerId}-menu`;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const reviewScrollRef = useRef<HTMLDivElement | null>(null);
  const focusGeneratedBatch = useRef(false);
  const batchBeforeGeneration = useRef<string | undefined>(undefined);
  const firstVariationRef = useRef<HTMLLIElement | null>(null);
  const lastPreviewButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem('nodeslide.agent-model');
    const storedModel = isNodeSlideAgentModelId(stored) ? stored : NODESLIDE_DEFAULT_AGENT_MODEL;
    if (isNodeSlideAgentModelId(stored)) {
      setProviderModel(storedModel);
      setProviderMode(nodeSlideProviderModeForModel(storedModel));
    }
    const storedEffort = window.localStorage.getItem('nodeslide.agent-effort');
    if (
      NODESLIDE_REASONING_EFFORTS.some((effort) => effort.id === storedEffort) &&
      nodeSlideModelSupportsReasoningEffort(storedModel, storedEffort as NodeSlideReasoningEffort)
    ) {
      setProviderEffort(storedEffort as NodeSlideReasoningEffort);
    } else {
      setProviderEffort('high');
    }
  }, []);

  useEffect(() => {
    const enabled = window.localStorage.getItem(`nodeslide.memory-enabled:${deck.id}`) === 'true';
    setMemoryEnabled(enabled);
  }, [deck.id]);

  const setPersistentMemoryEnabled = (enabled: boolean) => {
    setMemoryEnabled(enabled);
    window.localStorage.setItem(`nodeslide.memory-enabled:${deck.id}`, String(enabled));
  };

  useEffect(() => {
    if (scopeChoice === 'elements' && selectedElements.length === 0) setScopeChoice('slide');
    if (scopeChoice === 'selected_slides' && selectedSlideIds.length < 2) setScopeChoice('slide');
    setScopeError(null);
  }, [scopeChoice, selectedElements.length, selectedSlideIds.length]);

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
  const showExplicitContext = Boolean(commentContext || requestedReadContext.length > 0);

  const externalRequestConsentKey = createExternalProviderRequestKey('editor-action', {
    deck: { id: deck.id, version: deck.version },
    slide: { id: slide.id, version: slide.version },
    instruction,
    attachments: composerSession.attachments,
    scopeChoice,
    selectedSlideIds,
    selectedElements: selectedElements.map((element) => ({
      id: element.id,
      slideId: element.slideId,
      version: element.version,
    })),
    operationMode,
    designBehavior,
    referenceUse,
    readContext: requestedReadContext,
    commandId: selectedCommand?.id ?? null,
    commentContext,
    providerMode,
    providerModel,
    providerEffort,
    webResearch,
    memory: useMemoryForRun
      ? memories
          .filter((memory) => memory.status === 'active')
          .map((memory) => ({
            id: memory.id,
            contentDigest: memory.contentDigest,
            updatedAt: memory.updatedAt,
          }))
      : [],
  });
  const externalConsent = useSessionExternalConsent();
  const deterministicWebResearch = providerMode === 'deterministic' && webResearch;
  const requiresExternalConsent = providerMode !== 'deterministic' || webResearch;
  const providerConfigurationValid =
    providerMode === 'deterministic' ||
    nodeSlideModelSupportsReasoningEffort(providerModel, providerEffort);
  const providerReady =
    providerConfigurationValid && (!requiresExternalConsent || externalConsent.granted);
  const submissionSignature = `${externalRequestConsentKey}:${approvalSignature}:session-${
    externalConsent.granted ? 'consented' : 'unconsented'
  }`;
  const submissionSignatureRef = useRef(submissionSignature);
  const submissionRevisionRef = useRef(0);
  if (submissionSignatureRef.current !== submissionSignature) {
    submissionSignatureRef.current = submissionSignature;
    submissionRevisionRef.current += 1;
  }

  const selectedAgentModel = nodeSlideAgentModel(providerModel);
  const activeDurableRun = agentRuns.find((run) =>
    ['queued', 'researching', 'planning', 'validating'].includes(run.status),
  );
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
  const showSuggested =
    !instruction.trim() &&
    proposals.length === 0 &&
    !resolvedActivity &&
    !activeTrace &&
    !menuOpen &&
    !composerExpanded;
  const showDirectionThread = Boolean(
    variationGenerating || variationsLoading || variationError || directions.length > 0,
  );
  const scopeSummary = commentContext
    ? commentContext.label
    : scopeChoice === 'deck'
      ? 'Whole deck'
      : scopeChoice === 'selected_slides'
        ? `${selectedSlideIds.length} selected slides`
        : scopeChoice === 'elements'
          ? `${selectedElements.length} selected`
          : 'Whole slide';
  const recentMessages = agentMessages.slice(-24);
  const threadMessages = useMemo(
    () =>
      buildNodeSlideThreadMessages(recentMessages, agentRuns, {
        optimisticAsk: visibleAsk,
        optimisticId: `${composerId}-optimistic-user-ask`,
      }),
    [agentRuns, composerId, recentMessages, visibleAsk],
  );
  const activityAutoScrollPaused = proposals.length > 0 || directions.length > 0;
  const activityHasScrollTarget = Boolean(
    recentMessages.length > 0 || visibleAsk || resolvedActivity || activeTrace,
  );
  const hasReviewableProposal = proposals.length > 0;
  const compactReviewComposer =
    hasReviewableProposal &&
    !composerExpanded &&
    !providerControlsOpen &&
    !instruction.trim() &&
    !menuOpen;
  const inspectorState = hasReviewableProposal
    ? 'is-awaiting-review'
    : activeDurableRun || isSubmitting || activeTrace?.status === 'working'
      ? 'is-running'
      : resolvedActivity && isFailureActivity(resolvedActivity)
        ? 'has-failed'
        : 'is-idle';

  const updateInstruction = (value: string, cursor = value.length) => {
    composerSession.setText(value);
    setCursorPosition(cursor);
    setDismissedMenuKey(null);
    setMenuIndex(0);
  };

  const chooseProviderModel = (value: string) => {
    if (value === 'deterministic') {
      setProviderMode('deterministic');
      setProviderControlsOpen(false);
      return;
    }
    if (!isNodeSlideAgentModelId(value)) return;
    setProviderModel(value);
    setProviderMode(nodeSlideProviderModeForModel(value));
    if (!nodeSlideModelSupportsReasoningEffort(value, providerEffort)) {
      setProviderEffort('high');
      window.localStorage.setItem('nodeslide.agent-effort', 'high');
    }
    window.localStorage.setItem('nodeslide.agent-model', value);
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

  const requestVariations = (
    source: AiVariationRequest['source'],
    ask?: string,
    readContext: readonly AiReadReference[] = requestedReadContext,
  ) => {
    if (variationBusy || !providerReady) return;
    const variationConsentGrant = externalConsent.granted
      ? aiProviderConsentGrant(providerMode)
      : null;
    const variationProvider = createAiVariationProviderRequest(
      providerMode,
      variationConsentGrant?.variationConsent ?? null,
      providerModel,
      providerEffort,
    );
    if (!variationProvider || (webResearch && !externalConsent.granted)) return;
    focusGeneratedBatch.current = true;
    batchBeforeGeneration.current = latestBatchId;
    if (ask) setOptimisticAsk(ask);
    onGenerateVariations({
      ...variationProvider,
      readContext,
      designBehavior,
      referenceUse,
      source,
      ...(commentContext ? { commentContext } : {}),
    });
  };

  const submit = async (submittedInstruction: string, files: readonly File[]) => {
    const text = submittedInstruction.trim();
    if (!text) throw new Error('Enter an instruction before proposing an edit.');
    if (isSubmitting || attachmentBusy) {
      throw new Error('A request is already being prepared. Wait for it to finish and try again.');
    }
    if (approvalBusyRef.current) {
      throw new Error('Change handling is updating. Review it and submit again.');
    }
    if (!providerReady) {
      throw new Error(
        deterministicWebResearch
          ? 'Allow Web for this browser tab once, then press Enter or Propose again.'
          : 'Allow external AI for this browser tab once, then press Enter or Propose again.',
      );
    }
    const submittedRevision = submissionRevisionRef.current;
    const requestChanged = () =>
      approvalBusyRef.current || submissionRevisionRef.current !== submittedRevision;
    let submittedReadContext = requestedReadContext;
    if (files.length > 0) {
      if (!onAttachDataFile) throw new Error('Data attachments are unavailable for this deck.');
      setAttachmentBusy(true);
      setAttachmentError(null);
      try {
        const attachedReferences: AiReadReference[] = [];
        for (const file of files) {
          attachedReferences.push(await onAttachDataFile(file));
          if (requestChanged()) {
            throw new Error(
              'Change handling or request settings changed while data was attached. Review and submit again.',
            );
          }
        }
        const deduped = new Map<string, AiReadReference>();
        for (const reference of [...requestedReadContext, ...attachedReferences]) {
          deduped.set(referenceKey(reference), reference);
        }
        submittedReadContext = [...deduped.values()];
        setSelectedReadContext(submittedReadContext);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'The data file could not be attached.';
        setAttachmentError(message);
        throw error;
      } finally {
        setAttachmentBusy(false);
      }
    }
    if (requestChanged()) {
      throw new Error(
        'Change handling or request settings changed before submission. Review and submit again.',
      );
    }
    const command =
      selectedCommand ?? commandFromInstruction(submittedInstruction, availableCommands);
    if (command && isVariationsCommand(command.id)) {
      requestVariations('command', text, submittedReadContext);
      updateInstruction('');
      setSelectedCommand(null);
      return;
    }
    const writeScope = commentContext
      ? createCommentScope(commentContext, operationMode, deck, workspaceElements)
      : createScope(
          scopeChoice,
          operationMode,
          deck.id,
          slide.id,
          selectedSlideIds,
          selectedElements,
        );
    if (!writeScope) {
      setScopeError(
        `Select between 2 and ${NODESLIDE_SCOPE_SLIDE_LIMIT} slides for a bounded multi-slide edit.`,
      );
      return;
    }
    setScopeError(null);
    const submittedConsentGrant = externalConsent.granted
      ? aiProviderConsentGrant(providerMode)
      : null;
    const submittedProvider = createAiProviderRequest(
      providerMode,
      submittedConsentGrant?.reviewConsent ?? null,
      providerModel,
      providerEffort,
    );
    const submittedWebResearchConsent =
      externalConsent.granted && webResearch ? NODESLIDE_WEB_RESEARCH_CONSENT : null;
    if (
      !submittedProvider ||
      (webResearch && submittedWebResearchConsent !== NODESLIDE_WEB_RESEARCH_CONSENT)
    ) {
      return;
    }
    const options: AiProposalOptions<CommandId> = {
      ...submittedProvider,
      readContext: submittedReadContext,
      designBehavior,
      referenceUse,
      memoryMode: useMemoryForRun ? 'relevant' : 'off',
      idempotencyKey:
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...(webResearch && submittedWebResearchConsent
        ? {
            webResearch: true,
            webResearchConsent: submittedWebResearchConsent,
          }
        : {}),
      ...(commentContext ? { commentContext } : {}),
      ...(command && !isVariationsCommand(command.id)
        ? {
            commandId: command.id as Exclude<CommandId, '/variations' | 'variations'>,
          }
        : {}),
    };
    setOptimisticAsk(text);
    onPropose(text, writeScope, options);
    setProviderControlsOpen(false);
    setComposerExpanded(false);
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
    if (menuOpen && event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
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
    // The shared PromptInputTextarea owns plain Enter-to-submit and Shift+Enter.
    // Keeping one keyboard path avoids duplicate requestSubmit behavior here.
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
    <div className={`ns-inspector-scroll ns-ai-inspector ns-ai-v3-shell ${inspectorState}`}>
      {showExplicitContext ? (
        <section
          className="ns-ai-v3-context"
          aria-labelledby={`${composerId}-context-heading`}
          data-testid="ai-context-header"
        >
          <div className="ns-ai-v3-context-heading">
            <span className="ns-eyebrow" id={`${composerId}-context-heading`}>
              Added context
            </span>
            <span className="ns-ai-v3-context-policy">Read-only</span>
          </div>
          <div className="ns-ai-v3-context-chips" aria-label="Explicit AI context">
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
        </section>
      ) : null}

      <NodeSlideThreadRuntimeProvider
        isRunning={Boolean(activeDurableRun)}
        messages={threadMessages}
      >
        <ThreadPrimitive.Root className="ns-agent-thread" data-testid="assistant-ui-thread">
          <ThreadPrimitive.Viewport
            className="ns-ai-v3-review-scroll"
            data-testid="ai-review-scroll"
            data-follow={!activityAutoScrollPaused && activityHasScrollTarget ? 'true' : 'false'}
            ref={reviewScrollRef}
            role="log"
            autoScroll={!activityAutoScrollPaused && activityHasScrollTarget}
          >
            {!visibleAsk &&
            !resolvedActivity &&
            !activeTrace &&
            proposals.length === 0 &&
            !showDirectionThread &&
            recentMessages.length === 0 ? (
              <section className="ns-ai-v3-chat-turn is-agent ns-ai-v3-welcome">
                <span className="ns-ai-v3-agent-mark" aria-hidden="true">
                  <Sparkles size={14} />
                </span>
                <div>
                  <span className="ns-eyebrow">NodeSlide</span>
                  <strong>What should we change?</strong>
                  <p>
                    Describe the outcome. I’ll return a scoped, validated patch for review before
                    anything changes.
                  </p>
                </div>
              </section>
            ) : null}

            <div className="ns-ai-v3-conversation" data-testid="assistant-ui-messages">
              <NodeSlideThreadMessages />
            </div>

            {resolvedActivity || activeTrace ? (
              <section
                className={`ns-agent-progress ns-ai-v3-progress ${
                  resolvedActivity?.status === 'cancelled'
                    ? 'has-cancelled'
                    : resolvedActivity && isFailureActivity(resolvedActivity)
                      ? 'has-failed'
                      : ''
                }`}
                aria-live="polite"
                {...(resolvedActivity && isFailureActivity(resolvedActivity)
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
                    {resolvedActivity?.status === 'cancelled' ? (
                      <X size={14} />
                    ) : resolvedActivity && isFailureActivity(resolvedActivity) ? (
                      <TriangleAlert size={14} />
                    ) : (
                      <LoaderCircle className="ns-spin" size={14} />
                    )}
                  </span>
                  <span>
                    <strong>
                      {activeDurableRun
                        ? durableRunLabel(activeDurableRun.status)
                        : resolvedActivity
                          ? agentPhaseLabel(resolvedActivity)
                          : activeTrace?.status === 'working'
                            ? 'Drafting proposal'
                            : 'Reading context'}
                    </strong>
                    <small>{activeTrace?.summary ?? 'Preparing a bounded, reviewable patch'}</small>
                  </span>
                  <ChevronRight size={14} className={showPlan ? 'is-open' : ''} />
                </button>
                {activeDurableRun && onCancelRun ? (
                  <button
                    type="button"
                    className="ns-agent-cancel"
                    onClick={() => onCancelRun(activeDurableRun.id)}
                    data-testid="ai-cancel-run"
                  >
                    <X size={12} /> Cancel run
                  </button>
                ) : null}
                {resolvedActivity && isTerminalActivity(resolvedActivity) ? (
                  <div className="ns-agent-honesty-state">
                    <strong>
                      {activityMessage(resolvedActivity) ??
                        (resolvedActivity.status === 'cancelled'
                          ? 'Run cancelled. No deck changes were applied.'
                          : resolvedActivity.status === 'timed_out'
                            ? 'The request timed out before a reviewable proposal was returned.'
                            : 'The agent failed before a reviewable proposal was returned.')}
                    </strong>
                    <p>No proposal was created or applied. Your deck remains unchanged.</p>
                    {resolvedActivity.status !== 'cancelled' && onRetryRun ? (
                      <button
                        type="button"
                        className="ns-agent-retry"
                        onClick={onRetryRun}
                        data-testid="ai-retry-run"
                      >
                        <RotateCcw size={12} /> Retry the same request
                      </button>
                    ) : null}
                  </div>
                ) : resolvedActivity?.status === 'delayed' ? (
                  <output className="ns-agent-delay-state">
                    <strong>{resolvedActivity.message ?? 'The provider is still working.'}</strong>
                    <p>No proposal has been created or applied yet.</p>
                  </output>
                ) : showPlan && activeTrace?.plan.length ? (
                  // AI Elements Task is intentionally not mounted here: persisted traces expose
                  // labels, but no stable per-step lifecycle. Neutral bullets avoid inventing one.
                  <ol className="ns-plan-list">
                    {activeTrace.plan.map((step, index) => (
                      <li key={`${activeTrace.id}:${index}:${step}`}>
                        <Circle size={10} />
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
            ) : null}

            {showDirectionThread ? (
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
                        : `Consent is required before using ${providerNameForMode(providerMode)}`
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
                  Each direction is materialized and validated. Your slide stays unchanged until
                  Accept.
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
                        ? 'The selected external model could not safely supply every direction. Clearly labeled deterministic fallbacks are shown instead.'
                        : 'Three private deterministic directions are ready. No instruction or slide context left NodeSlide.'}
                    </span>
                  </output>
                ) : null}

                <div id="ns-variation-results" aria-busy={variationBusy || variationsLoading}>
                  {variationGenerating ? (
                    <div className="ns-variation-loading" aria-live="polite">
                      <LoaderCircle className="ns-spin" size={16} />
                      <span>
                        Generating, materializing, and validating three bounded directions...
                      </span>
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
            ) : null}
            <ThreadPrimitive.ScrollToBottom
              className="ns-agent-thread-scroll-bottom"
              aria-label="Scroll to latest message"
            >
              <ArrowDown size={14} />
            </ThreadPrimitive.ScrollToBottom>
            <ThreadPrimitive.ViewportFooter className="ns-agent-thread-footer">
              <div
                className={`ns-ai-composer ns-ai-v3-composer ${composerExpanded ? 'is-expanded' : ''} ${
                  compactReviewComposer ? 'is-review-compact' : ''
                }`}
                data-testid="ai-composer"
                data-composer-mode={compactReviewComposer ? 'follow-up' : 'full'}
                onFocusCapture={() => {
                  if (compactReviewComposer) setComposerExpanded(true);
                }}
              >
                {showSuggested ? (
                  <section
                    className="ns-ai-suggested-actions ns-ai-v3-suggested-actions"
                    aria-label="Suggested prompts"
                  >
                    <span>Suggested actions</span>
                    <div>
                      <button
                        type="button"
                        className="is-primary"
                        onClick={() => requestVariations('button')}
                        disabled={approvalControlLocked || variationBusy || !providerReady}
                        data-testid="ai-generate-directions"
                      >
                        <Layers3 size={12} /> Generate 3 directions
                      </button>
                      {contextSuggestions.map((action) => (
                        <button
                          key={action.id}
                          type="button"
                          disabled={approvalControlLocked}
                          onClick={() => updateInstruction(action.instruction)}
                          data-testid="ai-suggested-action"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                    <small>
                      Suggestions only prefill the composer; they never send automatically.
                    </small>
                  </section>
                ) : null}

                <div
                  className="ns-ai-v3-policy-summary"
                  aria-label="Current agent scope and policy"
                >
                  <span className="is-scope">{scopeSummary}</span>
                  <span>{operationModeLabel(operationMode)}</span>
                  <span>{designBehaviorLabel(designBehavior)}</span>
                  <span>{referenceUseLabel(referenceUse)}</span>
                  <button
                    type="button"
                    className={approvalMode === 'auto_apply' ? 'is-delegated' : ''}
                    data-testid="ai-approval-summary"
                    onClick={() => setProviderControlsOpen((current) => !current)}
                    aria-expanded={providerControlsOpen}
                    aria-controls="nodeslide-ai-advanced-controls"
                    aria-label={
                      approvalMode === 'auto_apply' ? 'Auto-apply safe edits' : 'Review changes'
                    }
                  >
                    {approvalMode === 'auto_apply' ? <Sparkles size={11} /> : <Eye size={11} />}
                    {approvalMode === 'auto_apply' ? 'Auto-apply safe edits' : 'Review changes'}
                  </button>
                </div>

                <details
                  id="nodeslide-ai-advanced-controls"
                  className="ns-ai-v3-controls-disclosure"
                  data-testid="ai-provider-controls"
                  open={providerControlsOpen}
                  onToggle={(event) => setProviderControlsOpen(event.currentTarget.open)}
                >
                  <summary
                    data-testid="ai-provider-summary"
                    aria-label="Advanced provider, privacy, scope, and editing controls"
                  >
                    <span>Advanced controls</span>
                    <span
                      className={`ns-route-pill ${
                        providerMode !== 'deterministic' ? 'is-external' : 'is-private'
                      }`}
                    >
                      {providerMode === 'deterministic' ? (
                        <>
                          <ShieldCheck size={11} /> Private
                        </>
                      ) : (
                        <>
                          <Sparkles size={11} /> {providerNameForMode(providerMode)}
                        </>
                      )}
                    </span>
                  </summary>
                  <div className="ns-ai-v3-controls-body">
                    <div className="ns-ai-v3-route-summary" data-testid="ai-provider-route-status">
                      {providerMode === 'deterministic' ? (
                        <>
                          <ShieldCheck size={13} /> External model: off · Private deterministic
                        </>
                      ) : (
                        <>
                          <Sparkles size={13} /> External model: on ·{' '}
                          {providerNameForMode(providerMode)} · {selectedAgentModel.label} ·{' '}
                          {nodeSlideNativeEffortLabel(providerEffort)} effort
                          <span
                            className={externalConsent.granted ? 'has-consent' : 'needs-consent'}
                          >
                            {externalConsent.granted ? 'Consent attached' : 'Consent required'}
                          </span>
                        </>
                      )}
                    </div>
                    {onApprovalModeChange ? (
                      <fieldset
                        className="ns-ai-approval-controls"
                        data-testid="ai-approval-controls"
                      >
                        <legend>Change handling</legend>
                        <label className={approvalMode === 'review' ? 'is-active' : ''}>
                          <input
                            type="radio"
                            name={`${providerName}-approval`}
                            value="review"
                            checked={approvalMode === 'review'}
                            disabled={approvalControlLocked}
                            onChange={() => {
                              if (!approvalControlLocked) onApprovalModeChange('review');
                            }}
                          />
                          <Eye size={15} />
                          <span>
                            <strong>Review before applying</strong>
                            <small>Compare every proposal and choose Accept or Reject.</small>
                          </span>
                        </label>
                        <label className={approvalMode === 'auto_apply' ? 'is-active' : ''}>
                          <input
                            type="radio"
                            name={`${providerName}-approval`}
                            value="auto_apply"
                            checked={approvalMode === 'auto_apply'}
                            disabled={approvalControlLocked}
                            onChange={() => {
                              if (!approvalControlLocked) onApprovalModeChange('auto_apply');
                            }}
                          />
                          {approvalBusy ? (
                            <LoaderCircle className="ns-spin" size={15} />
                          ) : (
                            <Sparkles size={15} />
                          )}
                          <span>
                            <strong>Apply validated edits automatically</strong>
                            <small>
                              {NODESLIDE_BROWSER_DELEGATION_TTL_MS / (60 * 60 * 1_000)} hours · up
                              to {NODESLIDE_DELEGATION_MAX_USES} proposals ·{' '}
                              {NODESLIDE_DELEGATION_MAX_OPERATIONS} non-destructive operations each.
                              Stale, invalid, remove, hide, and publish actions stop for review.
                            </small>
                          </span>
                        </label>
                        {approvalBusy ? (
                          <output className="ns-ai-approval-status">
                            Updating change handling…
                          </output>
                        ) : null}
                        {approvalMode === 'auto_apply' && approvalExpiresAt ? (
                          <output className="ns-ai-approval-status">
                            Active until{' '}
                            {new Date(approvalExpiresAt).toLocaleTimeString([], {
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </output>
                        ) : null}
                      </fieldset>
                    ) : null}
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
                            disabled={approvalControlLocked}
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
                            aria-pressed={scopeChoice === 'deck'}
                            disabled={approvalControlLocked}
                            onClick={() => setScopeChoice('deck')}
                          >
                            Deck
                          </button>
                          <button
                            type="button"
                            className={scopeChoice === 'slide' ? 'is-active' : ''}
                            aria-pressed={scopeChoice === 'slide'}
                            disabled={approvalControlLocked}
                            onClick={() => setScopeChoice('slide')}
                          >
                            This slide
                          </button>
                          {selectedSlideIds.length >= 2 ? (
                            <button
                              type="button"
                              className={scopeChoice === 'selected_slides' ? 'is-active' : ''}
                              aria-pressed={scopeChoice === 'selected_slides'}
                              disabled={approvalControlLocked}
                              onClick={() => setScopeChoice('selected_slides')}
                            >
                              Selected slides ({selectedSlideIds.length})
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={scopeChoice === 'elements' ? 'is-active' : ''}
                            aria-pressed={scopeChoice === 'elements'}
                            disabled={approvalControlLocked || selectedElements.length === 0}
                            onClick={() => setScopeChoice('elements')}
                          >
                            Selection
                            {selectedElements.length > 0 ? ` · ${selectedElements.length}` : ''}
                          </button>
                        </div>
                      </div>
                    )}

                    {scopeError ? (
                      <p className="ns-ai-v3-inline-error" role="alert">
                        {scopeError}
                      </p>
                    ) : null}

                    <div className="ns-ai-policy-grid">
                      <label>
                        <span>Operation mode</span>
                        <select
                          value={operationMode}
                          disabled={approvalControlLocked}
                          onChange={(event) =>
                            setOperationMode(event.target.value as OperationMode)
                          }
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
                          disabled={approvalControlLocked}
                          onChange={(event) =>
                            setDesignBehavior(event.target.value as AiDesignBehaviorPolicy)
                          }
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
                          disabled={approvalControlLocked}
                          onChange={(event) =>
                            setReferenceUse(event.target.value as AiReferenceUsePolicy)
                          }
                          data-testid="ai-reference-use"
                        >
                          <option value="context_only">Context only</option>
                          <option value="inspiration">Use as inspiration</option>
                          <option value="style_direction">Follow style direction</option>
                        </select>
                      </label>
                    </div>
                  </div>
                </details>

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
                        disabled={approvalControlLocked}
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
                        disabled={approvalControlLocked}
                        onClick={removeCommand}
                        aria-label={`Remove command ${selectedCommand.label}`}
                      >
                        {commandToken(selectedCommand.id)} <X size={10} />
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {/* NodeSlidePromptComposer renders the public agent-operability hooks
            data-testid="ai-model-select" and data-testid="ai-data-file-input". */}
                <NodeSlidePromptComposer
                  allowAttachments={Boolean(onAttachDataFile)}
                  attachmentAccept=".csv,.json,.txt,text/csv,application/json,text/plain"
                  attachmentInputTestId="ai-data-file-input"
                  attachmentMaxFiles={1}
                  submissionRevision={submissionRevisionRef.current}
                  onSubmissionPreparingChange={handleSubmissionPreparingChange}
                  attachButtonTestId="ai-attach-data"
                  attachLabel="Attach data file"
                  composerClassName="ns-ai-v3-prompt"
                  disabled={
                    !instruction.trim() ||
                    isSubmitting ||
                    approvalBusy ||
                    attachmentBusy ||
                    submissionPreparing
                  }
                  effort={providerEffort}
                  effortLabel="Reasoning effort"
                  effortOptions={NODESLIDE_REASONING_EFFORTS.filter((effort) =>
                    nodeSlideModelSupportsReasoningEffort(providerModel, effort.id),
                  )}
                  effortTestId="ai-effort-select"
                  footerStatus={
                    requestedReadContext.length > 0
                      ? `${requestedReadContext.length} explicit reference${
                          requestedReadContext.length === 1 ? '' : 's'
                        }`
                      : 'Scoped context'
                  }
                  model={providerMode === 'deterministic' ? 'deterministic' : providerModel}
                  modelLabel="Agent model"
                  modelTestId="ai-model-select"
                  onAttachmentError={setAttachmentError}
                  onAttachmentsChange={clearAttachmentError}
                  onEffortChange={(effort) => {
                    setProviderEffort(effort);
                    window.localStorage.setItem('nodeslide.agent-effort', effort);
                  }}
                  onModelChange={chooseProviderModel}
                  onSubmit={({ text, files }) => submit(text, files)}
                  onTextareaKeyDown={handleComposerKeyDown}
                  onTextareaSelect={(event) =>
                    setCursorPosition(event.currentTarget.selectionStart)
                  }
                  onTextChange={updateInstruction}
                  placeholder={
                    compactReviewComposer
                      ? 'Ask a follow-up or request a revision...'
                      : commentContext
                        ? 'Address this review comment without resolving it...'
                        : scopeChoice === 'elements'
                          ? 'Make this feel more decisive...'
                          : 'Turn this into a crisp executive story...'
                  }
                  session={composerSession}
                  interactionDisabled={approvalControlLocked}
                  status={
                    isSubmitting || attachmentBusy || submissionPreparing ? 'submitted' : 'ready'
                  }
                  submitLabel="Propose edit"
                  submitContent={<span className="ns-ai-submit-label">Propose</span>}
                  submitTestId="ai-submit"
                  submitTools={
                    <PromptInputButton
                      aria-label={composerExpanded ? 'Collapse composer' : 'Expand composer'}
                      aria-pressed={composerExpanded}
                      className="ns-ai-v3-expand-composer"
                      disabled={approvalControlLocked}
                      onClick={() => setComposerExpanded((expanded) => !expanded)}
                      title={composerExpanded ? 'Collapse composer' : 'Expand composer'}
                    >
                      <Maximize2 size={14} />
                      <span className="ns-ai-tool-label">
                        {composerExpanded ? 'Collapse' : 'Expand'}
                      </span>
                    </PromptInputButton>
                  }
                  textareaAria={{
                    'aria-autocomplete': 'list',
                    'aria-expanded': menuOpen,
                    'aria-haspopup': 'menu',
                    ...(menuOpen ? { 'aria-controls': menuId } : {}),
                  }}
                  textareaId={composerId}
                  textareaLabel="AI instruction"
                  textareaRef={textareaRef}
                  textareaRows={compactReviewComposer ? 1 : composerExpanded ? 9 : 3}
                  tools={
                    <>
                      <PromptInputButton
                        aria-label="Connect BYOK model or coding agent"
                        className="ns-ai-tool-button"
                        data-testid="ai-connect-agent"
                        disabled={approvalControlLocked}
                        onClick={() => setConnectionsOpen(true)}
                        title="Connect BYOK model or coding agent"
                      >
                        <PlugZap size={14} />
                        <span className="ns-ai-tool-label">Connect</span>
                      </PromptInputButton>
                      <span style={{ display: 'contents' }}>
                        <PromptInputButton
                          aria-label="Toggle web research"
                          className="ns-ai-tool-button"
                          aria-pressed={webResearch}
                          data-testid="ai-web-research-toggle"
                          disabled={approvalControlLocked}
                          onClick={() => {
                            setWebResearch((enabled) => !enabled);
                          }}
                          title="Search the web and persist source snapshots before planning"
                          variant={webResearch ? 'default' : 'ghost'}
                        >
                          <Globe2 size={14} />
                          <span className="ns-ai-tool-label">Web</span>
                        </PromptInputButton>
                      </span>
                      {requiresExternalConsent || externalConsent.granted ? (
                        <label
                          className={`ns-session-consent-pill ns-ai-session-consent ${
                            externalConsent.granted ? 'is-ready' : ''
                          }`}
                          title={
                            deterministicWebResearch
                              ? 'Allow web research for this browser tab'
                              : 'Allow selected external models and optional web research for this browser tab'
                          }
                        >
                          <input
                            type="checkbox"
                            checked={externalConsent.granted}
                            onChange={(event) => {
                              externalConsent.setGranted(event.target.checked);
                              setAttachmentError(null);
                            }}
                            data-agent-web-consent="session"
                            data-testid="ai-provider-consent"
                          />
                          <ShieldCheck size={13} aria-hidden="true" />
                          <span>
                            {deterministicWebResearch
                              ? externalConsent.granted
                                ? 'Web allowed'
                                : 'Allow Web'
                              : externalConsent.granted
                                ? 'Session allowed'
                                : 'Allow this session'}
                          </span>
                        </label>
                      ) : null}
                      {onCreateMemory && onUpdateMemory && onDeleteMemory ? (
                        <PromptInputButton
                          aria-label="Manage deck memory"
                          className="ns-ai-tool-button"
                          aria-pressed={useMemoryForRun}
                          data-testid="ai-memory"
                          disabled={approvalControlLocked}
                          onClick={() => setMemoryOpen(true)}
                          title="Manage durable deck memory"
                          variant={useMemoryForRun ? 'default' : 'ghost'}
                        >
                          <Brain size={14} />
                          <span className="ns-ai-tool-label">Memory</span>
                          {memories.length ? (
                            <span className="ns-prompt-badge">{activeMemoryCount}</span>
                          ) : null}
                        </PromptInputButton>
                      ) : null}
                      <PromptInputButton
                        aria-label="Add read context reference"
                        className="ns-ai-tool-button ns-ai-tool-context"
                        disabled={approvalControlLocked || references.length === 0}
                        onClick={() => openTokenMenu('@')}
                        title="Add read context"
                      >
                        <AtSign size={14} />
                        <span className="ns-ai-tool-label">Context</span>
                      </PromptInputButton>
                      <PromptInputButton
                        aria-label="Add command"
                        className="ns-ai-tool-button ns-ai-tool-command"
                        disabled={approvalControlLocked}
                        onClick={() => openTokenMenu('/')}
                        title="Add command"
                      >
                        <Command size={14} />
                        <span className="ns-ai-tool-label">Command</span>
                      </PromptInputButton>
                    </>
                  }
                />

                {attachmentError ? (
                  <output className="ns-ai-attachment-error" role="alert">
                    {attachmentError}
                  </output>
                ) : null}

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
                        disabled={approvalControlLocked}
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
                          disabled={approvalControlLocked}
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
                  <kbd>↵</kbd> to propose · <kbd>⇧</kbd>
                  <kbd>↵</kbd> for a new line
                </small>
              </div>
            </ThreadPrimitive.ViewportFooter>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </NodeSlideThreadRuntimeProvider>
      <NodeSlideConnectionsDialog
        open={connectionsOpen}
        onClose={() => setConnectionsOpen(false)}
        deckId={deck.id}
      />
      {onCreateMemory && onUpdateMemory && onDeleteMemory ? (
        <NodeSlideMemoryDialog
          open={memoryOpen}
          memories={memories}
          loading={memoriesLoading}
          enabled={memoryEnabled}
          onEnabledChange={setPersistentMemoryEnabled}
          onClose={() => setMemoryOpen(false)}
          onCreate={onCreateMemory}
          onUpdate={onUpdateMemory}
          onDelete={onDeleteMemory}
        />
      ) : null}
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
            ? 'External model route'
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
          <dd>{nodeSlideScopeLabel(patch.scope)}</dd>
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
  providerConsent: AiReviewProviderConsent | null,
  model: NodeSlideAgentModelId = NODESLIDE_DEFAULT_AGENT_MODEL,
  effort: NodeSlideReasoningEffort = NODESLIDE_COMPOSER_DEFAULT_REASONING_EFFORT,
): AiProviderRequest | null {
  if (mode === 'deterministic') return { providerMode: 'deterministic' };
  const expectedConsent =
    mode === 'nebius' ? NODESLIDE_NEBIUS_REVIEW_CONSENT : NODESLIDE_OPENROUTER_REVIEW_CONSENT;
  if (
    providerConsent === null ||
    providerConsent !== expectedConsent ||
    !nodeSlideModelSupportsReasoningEffort(model, effort)
  ) {
    return null;
  }
  return {
    providerMode: mode,
    providerModel: model,
    providerEffort: effort,
    providerConsent,
  };
}

export function createAiVariationProviderRequest(
  mode: AiProviderMode,
  providerConsent: AiVariationProviderConsent | null,
  model: NodeSlideAgentModelId = NODESLIDE_DEFAULT_AGENT_MODEL,
  effort: NodeSlideReasoningEffort = NODESLIDE_COMPOSER_DEFAULT_REASONING_EFFORT,
): AiVariationProviderRequest | null {
  if (mode === 'deterministic') return { providerMode: 'deterministic' };
  const expectedConsent =
    mode === 'nebius'
      ? NODESLIDE_NEBIUS_VARIATIONS_CONSENT
      : NODESLIDE_OPENROUTER_VARIATIONS_CONSENT;
  if (
    providerConsent === null ||
    providerConsent !== expectedConsent ||
    !nodeSlideModelSupportsReasoningEffort(model, effort)
  ) {
    return null;
  }
  return {
    providerMode: mode,
    providerModel: model,
    providerEffort: effort,
    providerConsent,
  };
}

function aiProviderConsentGrant(mode: AiProviderMode): AiProviderConsentGrant | null {
  if (mode === 'nebius') {
    return {
      providerMode: mode,
      reviewConsent: NODESLIDE_NEBIUS_REVIEW_CONSENT,
      variationConsent: NODESLIDE_NEBIUS_VARIATIONS_CONSENT,
    };
  }
  if (mode === 'openrouter_free') {
    return {
      providerMode: mode,
      reviewConsent: NODESLIDE_OPENROUTER_REVIEW_CONSENT,
      variationConsent: NODESLIDE_OPENROUTER_VARIATIONS_CONSENT,
    };
  }
  return null;
}

function providerNameForMode(mode: AiProviderMode): string {
  if (mode === 'nebius') return 'Nebius';
  if (mode === 'openrouter_free') return 'OpenRouter';
  return 'Private';
}

export function agentPhaseLabel(activity: AiAgentActivity): string {
  if (activity.status === 'delayed') return 'Still working';
  if (activity.status === 'timed_out') return 'Timed out';
  if (activity.status === 'cancelled') return 'Cancelled';
  if (activity.status === 'failed') return 'Failed';
  return activity.elapsedMs >= AI_DRAFTING_PHASE_MS ? 'Drafting proposal' : 'Reading context';
}

function isTerminalActivity(activity: AiAgentActivity): boolean {
  return isFailureActivity(activity) || activity.status === 'cancelled';
}

function isFailureActivity(activity: AiAgentActivity): boolean {
  return activity.status === 'timed_out' || activity.status === 'failed';
}

function activityMessage(activity: AiAgentActivity): string | undefined {
  return 'message' in activity ? activity.message : undefined;
}

function durableRunLabel(status: NodeSlideAgentRun['status']) {
  if (status === 'queued') return 'Queued';
  if (status === 'researching') return 'Researching sources';
  if (status === 'planning') return 'Planning edit';
  if (status === 'validating') return 'Validating candidate';
  return 'Working';
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
  selectedSlideIds: readonly string[],
  selectedElements: readonly SlideElement[],
): PatchScope | null {
  if (choice === 'deck') return { kind: 'deck', deckId, operationMode };
  if (choice === 'selected_slides') {
    const exactSlideIds = [...new Set(selectedSlideIds)];
    if (exactSlideIds.length < 2 || exactSlideIds.length > NODESLIDE_SCOPE_SLIDE_LIMIT) return null;
    return { kind: 'slide', deckId, slideIds: exactSlideIds, operationMode };
  }
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

function operationModeLabel(value: OperationMode) {
  if (value === 'copy') return 'Copy only';
  if (value === 'style') return 'Style only';
  if (value === 'layout') return 'Layout only';
  return 'Full edit';
}

function designBehaviorLabel(value: AiDesignBehaviorPolicy) {
  if (value === 'preserve') return 'Preserve exactly';
  if (value === 'refine') return 'Refine subtly';
  if (value === 'rebalance') return 'Rebalance hierarchy';
  if (value === 'reinterpret') return 'Explore direction';
  return 'Reimagine boldly';
}

function referenceUseLabel(value: AiReferenceUsePolicy) {
  if (value === 'inspiration') return 'Use references as inspiration';
  if (value === 'style_direction') return 'Follow reference style';
  return 'Context only';
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
    } else if (operation.op === 'update_chart') {
      fields.add('chart data');
    } else if (operation.op === 'update_image') {
      fields.add('image asset');
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
  if (operation.op === 'update_chart')
    return `Update ${operation.chart.chartType} chart data on ${operation.elementId}`;
  if (operation.op === 'update_image') return `Replace image asset in ${operation.elementId}`;
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
