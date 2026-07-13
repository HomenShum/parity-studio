import { useAction, useConvex, useMutation, useQuery } from 'convex/react';
import type { DefaultFunctionArgs, FunctionReference } from 'convex/server';
import {
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import type {
  AgentEditRequest,
  CommentAnchor,
  DeckComment,
  DeckPatch,
  DeckSnapshot,
  DeckVersion,
  NodeSlideAgentMemory,
  NodeSlideAgentMemoryCategory,
  NodeSlideAgentMessage,
  NodeSlideAgentModelId,
  NodeSlideAgentRun,
  NodeSlideAgentTelemetryPage,
  NodeSlideEditorCapabilityRegistry,
  NodeSlideEditorCommandId,
  NodeSlidePublication,
  NodeSlideWorkspace,
  PatchOperation,
  PatchScope,
  PublishedNodeSlide,
  Slide,
  SlideElement,
} from '../../../shared/nodeslide';
import { operationElementIds } from '../../../shared/nodeslide';
import { applyDeckPatch } from '../../../shared/nodeslidePatch';
import type { TasteProfile } from '../../../shared/nodeslidePreference';
import type { SignatureProfile } from '../../../shared/nodeslideSignature';
import { planSignatureApplication } from '../../../shared/nodeslideSignatureApply';
import type { SlideVariation, VariationBatch } from '../../../shared/nodeslideVariation';
import {
  getDeckOwnerAccessKey,
  getOrCreateSessionId,
  getStoredOwnerAccessKey,
  listStoredDeckAccess,
  storeDeckOwnerAccessKey,
} from '../../lib/sessionIdentity';
import { CommandPalette, type StudioCommand } from './components/CommandPalette';
import {
  type EditorCandidateReceipt,
  type EditorCanvasMode,
  EditorCanvasModes,
  type EditorCompareMode,
} from './components/EditorCanvasModes';
import { NodeSlideLanding } from './components/NodeSlideLanding';
import {
  type OwnerCapabilityRecovery,
  OwnerCapabilityRecoveryDialog,
} from './components/OwnerCapabilityRecoveryDialog';
import { PresenterView } from './components/PresenterView';
import {
  type CreateDeckAdmissionRequest,
  ProjectDialog,
  type RecentDeck,
} from './components/ProjectDialog';
import { PublicationDialog } from './components/PublicationDialog';
import { SlideCanvas } from './components/SlideCanvas';
import {
  type LayerZOrderAction,
  SlideNavigator,
  type SlideNavigatorTab,
} from './components/SlideNavigator';
import { StoryArcOverview } from './components/StoryArcOverview';
import { type StudioThemeMode, StudioToolbar } from './components/StudioToolbar';
import { shouldRevealCandidateCanvas } from './components/editorShellResponsive';
import {
  type EditorRequestToken,
  type WorkspaceReceiptMarker,
  appendDistinctHistoryVersion,
  applyExpectedElementVersions,
  authoritativePredecessorVersion,
  classifyEditorVersionAdvance,
  createEditorRequestGate,
  createSerializedEditorWriteQueue,
  editorCandidateCanAccept,
  editorCandidateReceiptForPatch,
  workspaceReceiptMarker,
  workspaceSatisfiesReceiptMarker,
} from './editorStateIntegrity';
import type {
  AiAgentActivity,
  AiCommentContext,
  AiProposalOptions,
  AiReadReference,
  AiVariationRequest,
} from './inspector/AiInspector';
import { InspectorPanel } from './inspector/InspectorPanel';
import type { InspectorTab } from './inspector/types';
import { extractPptxSignature } from './signature/index';
import {
  NODESLIDE_TASTE_PACKS,
  type NodeSlideTastePackId,
  getNodeSlideTastePack,
} from './signature/packs/index';
import { downloadDeckHtml, downloadPptx, validateSnapshot } from './slidelang/index';
import './nodeslide.css';
import './nodeslideV3.css';

type ConvexArgs<Args> = Args & DefaultFunctionArgs;
type PublicQuery<Args, Result> = FunctionReference<'query', 'public', ConvexArgs<Args>, Result>;
type PublicMutation<Args, Result> = FunctionReference<
  'mutation',
  'public',
  ConvexArgs<Args>,
  Result
>;
type PublicAction<Args, Result> = FunctionReference<'action', 'public', ConvexArgs<Args>, Result>;
interface PatchReceipt {
  patch: DeckPatch;
  workspace?: NodeSlideWorkspace | null;
}

interface VariationGenerationReceipt {
  batch: VariationBatch;
  variations: SlideVariation[];
}

interface VariationAcceptanceReceipt {
  variation: SlideVariation;
  patch: DeckPatch | null;
  workspace?: NodeSlideWorkspace | null;
  rebased?: boolean;
  staleReasons?: string[];
}

type OwnerWorkspace = NodeSlideWorkspace & {
  ownerAccessKey: string;
  shareSlug: string | null;
};

interface ApplyPatchArgs {
  deckId: string;
  ownerAccessKey: string;
  baseDeckVersion: number;
  baseSlideVersions: Record<string, number>;
  baseElementVersions: Record<string, number>;
  scope: PatchScope;
  operations: PatchOperation[];
  summary: string;
  profileId?: string;
  profileDigest?: string;
}

interface EditorWriteContext {
  workspace: NodeSlideWorkspace;
  ownerAccessKey: string;
  requestToken: EditorRequestToken;
}

interface NodeSlideGeneratedApi {
  nodeslide: {
    getWorkspace: PublicQuery<
      { deckId: string; ownerAccessKey: string },
      NodeSlideWorkspace | null
    >;
    getPresenterSnapshot: PublicQuery<{ shareSlug: string }, PublishedNodeSlide | null>;
    getEditorCapabilities: PublicQuery<
      { deckId: string; ownerAccessKey: string },
      NodeSlideEditorCapabilityRegistry
    >;
    attachDataSource: PublicMutation<
      {
        deckId: string;
        ownerAccessKey: string;
        title: string;
        format: 'csv' | 'json' | 'txt';
        content: string;
      },
      AiReadReference
    >;
    deleteDataSource: PublicMutation<
      { deckId: string; ownerAccessKey: string; sourceId: string },
      boolean
    >;
    listAgentRuns: PublicQuery<
      { deckId: string; ownerAccessKey: string; limit?: number },
      NodeSlideAgentRun[]
    >;
    listAgentMessages: PublicQuery<
      { deckId: string; ownerAccessKey: string; limit?: number },
      NodeSlideAgentMessage[]
    >;
    listAgentTelemetryPage: PublicQuery<
      {
        deckId: string;
        ownerAccessKey: string;
        runId: string;
        beforeSequence?: number;
        limit?: number;
      },
      NodeSlideAgentTelemetryPage
    >;
    cancelAgentRun: PublicMutation<
      { deckId: string; ownerAccessKey: string; runId: string },
      NodeSlideAgentRun | null
    >;
    listDecks: PublicQuery<
      { access: Array<{ deckId: string; ownerAccessKey: string }> },
      RecentDeck[]
    >;
    ensureWorkspace: PublicMutation<
      { clientSessionId: string; ownerAccessKey?: string },
      OwnerWorkspace
    >;
    applyPatch: PublicMutation<ApplyPatchArgs, PatchReceipt>;
    acceptPatch: PublicMutation<
      { deckId: string; ownerAccessKey: string; patchId: string },
      PatchReceipt
    >;
    rejectPatch: PublicMutation<
      { deckId: string; ownerAccessKey: string; patchId: string },
      DeckPatch | null
    >;
    proposePropagation: PublicMutation<
      { deckId: string; ownerAccessKey: string; parentPatchId: string },
      PatchReceipt
    >;
    addComment: PublicMutation<
      {
        deckId: string;
        ownerAccessKey: string;
        text: string;
        anchor: CommentAnchor;
        authorId: string;
        authorName: string;
      },
      DeckComment
    >;
    replyComment: PublicMutation<
      {
        parentId: string;
        deckId: string;
        ownerAccessKey: string;
        text: string;
        authorId: string;
        authorName: string;
      },
      DeckComment
    >;
    resolveComment: PublicMutation<
      { deckId: string; ownerAccessKey: string; commentId: string; linkedPatchId?: string },
      DeckComment | null
    >;
    reopenComment: PublicMutation<
      { deckId: string; ownerAccessKey: string; commentId: string },
      DeckComment | null
    >;
    restoreVersion: PublicMutation<
      {
        deckId: string;
        ownerAccessKey: string;
        versionId: string;
        baseDeckVersion: number;
      },
      PatchReceipt
    >;
    publishDeck: PublicMutation<{ deckId: string; ownerAccessKey: string }, PublishedNodeSlide>;
    revokePublication: PublicMutation<
      { deckId: string; ownerAccessKey: string },
      NodeSlidePublication | null
    >;
    touchPresence: PublicMutation<
      {
        deckId: string;
        ownerAccessKey: string;
        sessionId: string;
        displayName: string;
        color: string;
        slideId?: string;
        elementIds: string[];
        cursor?: { x: number; y: number };
      },
      NodeSlideWorkspace['presence']
    >;
  };
  nodeslideMemory: {
    list: PublicQuery<
      { deckId: string; ownerAccessKey: string; status?: 'active' | 'archived' },
      NodeSlideAgentMemory[]
    >;
    create: PublicMutation<
      {
        deckId: string;
        ownerAccessKey: string;
        category: NodeSlideAgentMemoryCategory;
        content: string;
      },
      NodeSlideAgentMemory
    >;
    update: PublicMutation<
      {
        deckId: string;
        ownerAccessKey: string;
        memoryId: string;
        category?: NodeSlideAgentMemoryCategory;
        content?: string;
        status?: 'active' | 'archived';
      },
      NodeSlideAgentMemory
    >;
    remove: PublicMutation<{ deckId: string; ownerAccessKey: string; memoryId: string }, boolean>;
  };
  nodeslideAgent: {
    createDeckFromBrief: PublicAction<CreateDeckAdmissionRequest, OwnerWorkspace>;
    proposeEdit: PublicAction<AgentEditRequest & { ownerAccessKey: string }, PatchReceipt>;
  };
  nodeslideVariations: {
    generate: PublicAction<
      {
        deckId: string;
        ownerAccessKey: string;
        slideId: string;
        providerMode?: 'deterministic' | 'openrouter_free' | 'nebius';
        providerModel?: NodeSlideAgentModelId;
        providerEffort?: import('../../../shared/nodeslide').NodeSlideReasoningEffort;
        providerConsent?: string;
      },
      VariationGenerationReceipt
    >;
    list: PublicQuery<
      { deckId: string; ownerAccessKey: string; slideId: string; limit?: number },
      SlideVariation[]
    >;
    accept: PublicAction<
      { deckId: string; ownerAccessKey: string; variationId: string },
      VariationAcceptanceReceipt
    >;
    reject: PublicMutation<
      { deckId: string; ownerAccessKey: string; variationId: string; reason?: string },
      SlideVariation
    >;
  };
  nodeslideSignatures: {
    saveProfile: PublicMutation<
      { deckId: string; ownerAccessKey: string; profileJson: string },
      string
    >;
    listProfiles: PublicQuery<{ deckId: string; ownerAccessKey: string; limit?: number }, string[]>;
    activateProfile: PublicMutation<
      {
        deckId: string;
        ownerAccessKey: string;
        profileId: string;
        profileDigest: string;
        baseDeckVersion: number;
      },
      NodeSlideWorkspace | null
    >;
    clearActiveProfile: PublicMutation<
      { deckId: string; ownerAccessKey: string; baseDeckVersion: number },
      NodeSlideWorkspace | null
    >;
  };
  nodeslidePreferences: {
    getTasteProfile: PublicQuery<{ deckId: string; ownerAccessKey: string }, TasteProfile | null>;
    syncVariationDecisions: PublicMutation<
      { deckId: string; ownerAccessKey: string; limit?: number },
      { scanned: number; inserted: number; existing: number }
    >;
    recordPatchDecision: PublicMutation<
      { deckId: string; ownerAccessKey: string; patchId: string; sourceEventId?: string },
      { inserted: boolean }
    >;
    recordExportCompleted: PublicMutation<
      { deckId: string; ownerAccessKey: string; kind: 'html' | 'pptx' },
      { exportId: string; inserted: boolean }
    >;
    runEtl: PublicMutation<{ deckId: string; ownerAccessKey: string }, { profile: TasteProfile }>;
    evictSignal: PublicMutation<
      { deckId: string; ownerAccessKey: string; signalId: string },
      TasteProfile | null
    >;
  };
}

const nodeslideApi = api as unknown as NodeSlideGeneratedApi;

function mergeAgentTelemetryPages(
  ...pages: Array<NodeSlideAgentTelemetryPage | undefined>
): NodeSlideAgentTelemetryPage | undefined {
  const available = pages.filter((page): page is NodeSlideAgentTelemetryPage => page !== undefined);
  if (!available.length) return undefined;
  const spans = [
    ...new Map(available.flatMap((page) => page.spans).map((span) => [span.id, span])).values(),
  ].sort((left, right) => right.sequence - left.sequence);
  const events = [
    ...new Map(available.flatMap((page) => page.events).map((event) => [event.id, event])).values(),
  ].sort((left, right) => right.sequence - left.sequence);
  const oldestPage = available.reduce((oldest, page) =>
    (page.nextBeforeSequence ?? Number.MAX_SAFE_INTEGER) <
    (oldest.nextBeforeSequence ?? Number.MAX_SAFE_INTEGER)
      ? page
      : oldest,
  );
  return {
    spans,
    events,
    hasMore: oldestPage.hasMore,
    ...(oldestPage.nextBeforeSequence !== undefined
      ? { nextBeforeSequence: oldestPage.nextBeforeSequence }
      : {}),
    totalRecorded: Math.max(...available.map((page) => page.totalRecorded)),
  };
}

export function NodeSlideStudio() {
  const convex = useConvex();
  const clientSessionId = useMemo(() => getOrCreateSessionId(), []);
  const requestedDeck = useMemo(() => new URLSearchParams(window.location.search).get('deck'), []);
  const requestedShare = useMemo(
    () => new URLSearchParams(window.location.search).get('share'),
    [],
  );
  const [activeDeckId, setActiveDeckId] = useState<string | null>(requestedDeck);
  const [ownerAccessKey, setOwnerAccessKey] = useState<string | null>(() =>
    requestedDeck ? (getDeckOwnerAccessKey(requestedDeck) ?? null) : null,
  );
  const [knownAccess, setKnownAccess] = useState(() => listStoredDeckAccess());
  const [ownerRecovery, setOwnerRecovery] = useState<OwnerCapabilityRecovery | null>(null);
  const [recoveryAccessInput, setRecoveryAccessInput] = useState('');
  const [recoveryAccessRequest, setRecoveryAccessRequest] = useState<string | null>(null);
  const [recoveryAccessError, setRecoveryAccessError] = useState<string | null>(null);
  const [localWorkspace, setLocalWorkspace] = useState<NodeSlideWorkspace | null>(null);
  const [activeSlideId, setActiveSlideId] = useState<string | null>(null);
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const [navigatorTab, setNavigatorTab] = useState<SlideNavigatorTab>('slides');
  const [collapsedNavigatorSections, setCollapsedNavigatorSections] = useState<string[]>([]);
  const [canvasMode, setCanvasMode] = useState<EditorCanvasMode>('edit');
  const [compareMode, setCompareMode] = useState<EditorCompareMode>('side-by-side');
  const [compareSliderPosition, setCompareSliderPosition] = useState(50);
  const [compareOverlayOpacity, setCompareOverlayOpacity] = useState(50);
  const [compareBlinkPaused, setCompareBlinkPaused] = useState(false);
  const [previewedPatchId, setPreviewedPatchId] = useState<string | null>(null);
  const [aiCommentContext, setAiCommentContext] = useState<AiCommentContext | null>(null);
  const [aiAgentActivity, setAiAgentActivity] = useState<AiAgentActivity | null>(null);
  const [traceTelemetryRunId, setTraceTelemetryRunId] = useState<string | null>(null);
  const [olderTelemetryByRun, setOlderTelemetryByRun] = useState<
    Record<string, NodeSlideAgentTelemetryPage | undefined>
  >({});
  const [telemetryLoadingRunId, setTelemetryLoadingRunId] = useState<string | null>(null);
  const [telemetryLoadError, setTelemetryLoadError] = useState<string | null>(null);
  const [activeInspectorTab, setActiveInspectorTab] = useState<InspectorTab>('ai');
  const [studioTheme, setStudioTheme] = useState<StudioThemeMode>(() =>
    readStudioPreference('theme') === 'dark' ? 'dark' : 'light',
  );
  const [navigatorCollapsed, setNavigatorCollapsed] = useState(
    () => window.innerWidth >= 700 && window.innerWidth < 1100,
  );
  const [inspectorCollapsed, setInspectorCollapsed] = useState(() => window.innerWidth < 1100);
  const [inspectorWidth, setInspectorWidth] = useState(340);
  const [zoom, setZoom] = useState(() => {
    if (window.innerWidth < 700) return 40;
    if (window.innerWidth < 1100) return 55;
    return 65;
  });
  const [presentMode, setPresentMode] = useState(
    () => new URLSearchParams(window.location.search).get('present') === '1',
  );
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [sampleRequested, setSampleRequested] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [variationGenerating, setVariationGenerating] = useState(false);
  const [variationDecisionBusy, setVariationDecisionBusy] = useState(false);
  const [tastePackBusy, setTastePackBusy] = useState(false);
  const [variationError, setVariationError] = useState<string | null>(null);
  const [previewedVariation, setPreviewedVariation] = useState<SlideVariation | null>(null);
  const [previewedSignatureProfile, setPreviewedSignatureProfile] =
    useState<SignatureProfile | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [canvasResetKey, setCanvasResetKey] = useState(0);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [clipboardElements, setClipboardElements] = useState<SlideElement[]>([]);
  const bootstrapped = useRef(false);
  const historyDeckRef = useRef<string | null>(null);
  const promptedRecoveryDecks = useRef(new Set<string>());
  const presenceCursorRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const presenceCursorTimerRef = useRef<number | null>(null);
  const workspaceRef = useRef<NodeSlideWorkspace | null>(null);
  const workspaceReceiptMarkerRef = useRef<WorkspaceReceiptMarker | null>(null);
  const activeDeckIdRef = useRef<string | null>(activeDeckId);
  const ownerAccessKeyRef = useRef<string | null>(ownerAccessKey);
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const historyVersionRef = useRef<{ deckId: string; version: number } | null>(null);
  const localCommitVersionsRef = useRef(new Set<number>());
  const editorRequestGateRef = useRef(createEditorRequestGate(activeDeckId));
  const editorWriteQueueRef = useRef(createSerializedEditorWriteQueue());
  editorRequestGateRef.current.setActiveDeck(activeDeckId);
  activeDeckIdRef.current = activeDeckId;
  ownerAccessKeyRef.current = ownerAccessKey;

  useEffect(() => {
    const url = new URL(window.location.href);
    const before = url.toString();
    url.searchParams.delete('qa');
    if (url.searchParams.get('domain') === 'nodeslide') url.searchParams.delete('domain');
    if (url.toString() !== before) window.history.replaceState(null, '', url);
  }, []);

  const ensureWorkspace = useMutation(nodeslideApi.nodeslide.ensureWorkspace);
  const attachDataSource = useMutation(nodeslideApi.nodeslide.attachDataSource);
  const applyPatchMutation = useMutation(nodeslideApi.nodeslide.applyPatch);
  const acceptPatch = useMutation(nodeslideApi.nodeslide.acceptPatch);
  const rejectPatch = useMutation(nodeslideApi.nodeslide.rejectPatch);
  const proposePropagation = useMutation(nodeslideApi.nodeslide.proposePropagation);
  const addComment = useMutation(nodeslideApi.nodeslide.addComment);
  const replyComment = useMutation(nodeslideApi.nodeslide.replyComment);
  const resolveComment = useMutation(nodeslideApi.nodeslide.resolveComment);
  const reopenComment = useMutation(nodeslideApi.nodeslide.reopenComment);
  const restoreVersion = useMutation(nodeslideApi.nodeslide.restoreVersion);
  const publishDeck = useMutation(nodeslideApi.nodeslide.publishDeck);
  const revokePublication = useMutation(nodeslideApi.nodeslide.revokePublication);
  const touchPresence = useMutation(nodeslideApi.nodeslide.touchPresence);
  const deleteDataSource = useMutation(nodeslideApi.nodeslide.deleteDataSource);
  const cancelAgentRun = useMutation(nodeslideApi.nodeslide.cancelAgentRun);
  const createAgentMemory = useMutation(nodeslideApi.nodeslideMemory.create);
  const updateAgentMemory = useMutation(nodeslideApi.nodeslideMemory.update);
  const removeAgentMemory = useMutation(nodeslideApi.nodeslideMemory.remove);
  const createDeckFromBrief = useAction(nodeslideApi.nodeslideAgent.createDeckFromBrief);
  const proposeEdit = useAction(nodeslideApi.nodeslideAgent.proposeEdit);
  const generateVariations = useAction(nodeslideApi.nodeslideVariations.generate);
  const acceptVariation = useAction(nodeslideApi.nodeslideVariations.accept);
  const rejectVariation = useMutation(nodeslideApi.nodeslideVariations.reject);
  const saveSignatureProfile = useMutation(nodeslideApi.nodeslideSignatures.saveProfile);
  const activateSignatureProfile = useMutation(nodeslideApi.nodeslideSignatures.activateProfile);
  const clearActiveSignatureProfile = useMutation(
    nodeslideApi.nodeslideSignatures.clearActiveProfile,
  );
  const syncVariationPreferences = useMutation(
    nodeslideApi.nodeslidePreferences.syncVariationDecisions,
  );
  const recordPreferencePatch = useMutation(nodeslideApi.nodeslidePreferences.recordPatchDecision);
  const recordPreferenceExport = useMutation(
    nodeslideApi.nodeslidePreferences.recordExportCompleted,
  );
  const runPreferenceEtl = useMutation(nodeslideApi.nodeslidePreferences.runEtl);
  const evictTasteSignal = useMutation(nodeslideApi.nodeslidePreferences.evictSignal);
  const queriedWorkspace = useQuery(
    nodeslideApi.nodeslide.getWorkspace,
    activeDeckId && ownerAccessKey ? { deckId: activeDeckId, ownerAccessKey } : 'skip',
  );
  const editorCapabilities = useQuery(
    nodeslideApi.nodeslide.getEditorCapabilities,
    activeDeckId && ownerAccessKey ? { deckId: activeDeckId, ownerAccessKey } : 'skip',
  );
  const recoveredWorkspace = useQuery(
    nodeslideApi.nodeslide.getWorkspace,
    requestedDeck && !ownerAccessKey && recoveryAccessRequest
      ? { deckId: requestedDeck, ownerAccessKey: recoveryAccessRequest }
      : 'skip',
  );
  const sharedSnapshot = useQuery(
    nodeslideApi.nodeslide.getPresenterSnapshot,
    requestedShare ? { shareSlug: requestedShare } : 'skip',
  );
  const recentDeckRows = useQuery(
    nodeslideApi.nodeslide.listDecks,
    knownAccess.length > 0 ? { access: knownAccess } : 'skip',
  );
  const variationRows = useQuery(
    nodeslideApi.nodeslideVariations.list,
    activeDeckId && ownerAccessKey && activeSlideId
      ? { deckId: activeDeckId, ownerAccessKey, slideId: activeSlideId, limit: 30 }
      : 'skip',
  );
  const signatureProfileRows = useQuery(
    nodeslideApi.nodeslideSignatures.listProfiles,
    activeDeckId && ownerAccessKey ? { deckId: activeDeckId, ownerAccessKey, limit: 8 } : 'skip',
  );
  const tasteProfile = useQuery(
    nodeslideApi.nodeslidePreferences.getTasteProfile,
    activeDeckId && ownerAccessKey ? { deckId: activeDeckId, ownerAccessKey } : 'skip',
  );
  const agentRuns = useQuery(
    nodeslideApi.nodeslide.listAgentRuns,
    activeDeckId && ownerAccessKey ? { deckId: activeDeckId, ownerAccessKey, limit: 40 } : 'skip',
  );
  const agentMessages = useQuery(
    nodeslideApi.nodeslide.listAgentMessages,
    activeDeckId && ownerAccessKey ? { deckId: activeDeckId, ownerAccessKey, limit: 100 } : 'skip',
  );
  const agentMemories = useQuery(
    nodeslideApi.nodeslideMemory.list,
    activeDeckId && ownerAccessKey ? { deckId: activeDeckId, ownerAccessKey } : 'skip',
  );
  const latestAgentRunId = agentRuns?.[0]?.id;
  const selectedTelemetryRunId =
    traceTelemetryRunId && agentRuns?.some((run) => run.id === traceTelemetryRunId)
      ? traceTelemetryRunId
      : latestAgentRunId;
  const agentTelemetryHead = useQuery(
    nodeslideApi.nodeslide.listAgentTelemetryPage,
    activeDeckId && ownerAccessKey && selectedTelemetryRunId
      ? {
          deckId: activeDeckId,
          ownerAccessKey,
          runId: selectedTelemetryRunId,
          limit: 200,
        }
      : 'skip',
  );
  const agentTelemetry = useMemo(
    () =>
      selectedTelemetryRunId
        ? mergeAgentTelemetryPages(agentTelemetryHead, olderTelemetryByRun[selectedTelemetryRunId])
        : undefined,
    [agentTelemetryHead, olderTelemetryByRun, selectedTelemetryRunId],
  );
  const loadOlderAgentTelemetry = useCallback(
    async (runId: string, beforeSequence: number) => {
      if (!activeDeckId || !ownerAccessKey || telemetryLoadingRunId) return;
      setTelemetryLoadingRunId(runId);
      setTelemetryLoadError(null);
      try {
        const page = await convex.query(nodeslideApi.nodeslide.listAgentTelemetryPage, {
          deckId: activeDeckId,
          ownerAccessKey,
          runId,
          beforeSequence,
          limit: 200,
        });
        setOlderTelemetryByRun((current) => ({
          ...current,
          [runId]: mergeAgentTelemetryPages(current[runId], page),
        }));
      } catch (error) {
        setTelemetryLoadError(error instanceof Error ? error.message : 'Unknown telemetry error');
      } finally {
        setTelemetryLoadingRunId(null);
      }
    },
    [activeDeckId, convex, ownerAccessKey, telemetryLoadingRunId],
  );
  const localWorkspaceForDeck = localWorkspace?.deck.id === activeDeckId ? localWorkspace : null;
  const localReceiptMarker =
    workspaceReceiptMarkerRef.current?.deckId === activeDeckId
      ? workspaceReceiptMarkerRef.current
      : null;
  const queryCoversLocalReceipt = Boolean(
    queriedWorkspace &&
      (!localReceiptMarker ||
        workspaceSatisfiesReceiptMarker(queriedWorkspace, localReceiptMarker)),
  );
  const workspace =
    queriedWorkspace && localWorkspaceForDeck
      ? queriedWorkspace.deck.version > localWorkspaceForDeck.deck.version ||
        (queriedWorkspace.deck.version === localWorkspaceForDeck.deck.version &&
          queryCoversLocalReceipt)
        ? queriedWorkspace
        : localWorkspaceForDeck
      : (queriedWorkspace ?? localWorkspaceForDeck);
  if (!workspace || workspace.deck.id !== activeDeckId) {
    if (workspaceRef.current?.deck.id !== activeDeckId) workspaceRef.current = null;
  } else if (
    workspaceRef.current?.deck.id !== workspace.deck.id ||
    workspace.deck.version >= workspaceRef.current.deck.version
  ) {
    workspaceRef.current = workspace;
  }
  const variationBusy = variationGenerating || variationDecisionBusy;
  const signatureProfiles = parseSignatureProfileRows(signatureProfileRows ?? []);
  const activeSignatureProfile = workspace?.deck.activeSignatureProfileId
    ? (signatureProfiles.find(
        (profile) =>
          profile.id === workspace.deck.activeSignatureProfileId &&
          profile.source.digest === workspace.deck.activeSignatureProfileDigest,
      ) ??
      NODESLIDE_TASTE_PACKS.find(
        (profile) =>
          profile.id === workspace.deck.activeSignatureProfileId &&
          profile.source.digest === workspace.deck.activeSignatureProfileDigest,
      ))
    : undefined;
  const activeTastePackId = tastePackIdForProfile(activeSignatureProfile);

  const installWorkspace = useCallback(
    (
      next: NodeSlideWorkspace | OwnerWorkspace,
      explicitOwnerAccessKey?: string,
      primary = false,
      allowDeckSwitch = false,
    ) => {
      if (!allowDeckSwitch && activeDeckIdRef.current && activeDeckIdRef.current !== next.deck.id) {
        return false;
      }
      let accessDurable = true;
      const nextOwnerAccessKey =
        'ownerAccessKey' in next ? next.ownerAccessKey : explicitOwnerAccessKey;
      if (nextOwnerAccessKey) {
        const persistence = storeDeckOwnerAccessKey(next.deck.id, nextOwnerAccessKey, primary);
        accessDurable = persistence.durable;
        if (!persistence.durable && !promptedRecoveryDecks.current.has(next.deck.id)) {
          promptedRecoveryDecks.current.add(next.deck.id);
          setOwnerRecovery({
            deckId: next.deck.id,
            deckTitle: next.deck.title,
            ownerAccessKey: nextOwnerAccessKey,
          });
          setToast({
            kind: 'error',
            message:
              'This browser did not save the deck owner key. Save the recovery key before closing this tab.',
          });
        } else if (persistence.durable) {
          promptedRecoveryDecks.current.delete(next.deck.id);
          setOwnerRecovery((current) => (current?.deckId === next.deck.id ? null : current));
        }
        ownerAccessKeyRef.current = nextOwnerAccessKey;
        setOwnerAccessKey(nextOwnerAccessKey);
        setKnownAccess(listStoredDeckAccess());
      }
      const currentWorkspace = workspaceRef.current;
      if (
        currentWorkspace?.deck.id === next.deck.id &&
        currentWorkspace.deck.version > next.deck.version
      ) {
        return accessDurable;
      }
      workspaceReceiptMarkerRef.current = workspaceReceiptMarker(next);
      editorRequestGateRef.current?.setActiveDeck(next.deck.id);
      activeDeckIdRef.current = next.deck.id;
      workspaceRef.current = next;
      setLocalWorkspace(next);
      setActiveDeckId(next.deck.id);
      setActiveSlideId((current) =>
        current && next.deck.slideOrder.includes(current)
          ? current
          : (next.deck.slideOrder[0] ?? null),
      );
      writeDeckToUrl(next.deck.id);
      return accessDurable;
    },
    [],
  );

  useEffect(() => {
    if (!recoveryAccessRequest || recoveredWorkspace === undefined) return;
    if (
      !requestedDeck ||
      activeDeckId !== requestedDeck ||
      !editorRequestGateRef.current?.isDeckCurrent(requestedDeck)
    ) {
      return;
    }
    if (!recoveredWorkspace) {
      setRecoveryAccessRequest(null);
      setRecoveryAccessError('That recovery key did not grant access to this deck.');
      return;
    }
    const recoveredOwnerAccessKey = recoveryAccessRequest;
    setRecoveryAccessRequest(null);
    setRecoveryAccessInput('');
    setRecoveryAccessError(null);
    const accessDurable = installWorkspace(recoveredWorkspace, recoveredOwnerAccessKey);
    if (accessDurable) setToast({ kind: 'success', message: 'Deck access recovered.' });
  }, [activeDeckId, installWorkspace, recoveredWorkspace, recoveryAccessRequest, requestedDeck]);

  useEffect(() => {
    void bootstrapAttempt;
    if (bootstrapped.current || !sampleRequested || requestedDeck || requestedShare) return;
    bootstrapped.current = true;
    setBootstrapError(null);
    const storedOwnerAccessKey = getStoredOwnerAccessKey();
    const requestGate = editorRequestGateRef.current;
    const requestToken = requestGate.begin('bootstrap', activeDeckId);
    void ensureWorkspace({
      clientSessionId,
      ...(storedOwnerAccessKey ? { ownerAccessKey: storedOwnerAccessKey } : {}),
    })
      .then((next) => {
        if (requestGate.isCurrent(requestToken)) {
          installWorkspace(next, undefined, true, true);
        }
      })
      .catch((error: unknown) => {
        if (!requestGate.isCurrent(requestToken)) return;
        const message = errorMessage(error, 'Could not open the sample deck.');
        setBootstrapError(message);
        setToast({ kind: 'error', message });
      });
  }, [
    activeDeckId,
    bootstrapAttempt,
    clientSessionId,
    ensureWorkspace,
    installWorkspace,
    requestedDeck,
    requestedShare,
    sampleRequested,
  ]);

  useEffect(() => {
    if (!workspace) return;
    setLocalWorkspace(workspace);
    setActiveSlideId((current) =>
      current && workspace.deck.slideOrder.includes(current)
        ? current
        : (workspace.deck.slideOrder[0] ?? null),
    );
    if (historyDeckRef.current !== workspace.deck.id) {
      setPreviewedSignatureProfile(null);
      setPreviewedPatchId(null);
      setAiCommentContext(null);
      setCanvasMode('edit');
      setNavigatorTab('slides');
      historyDeckRef.current = workspace.deck.id;
      historyVersionRef.current = {
        deckId: workspace.deck.id,
        version: workspace.deck.version,
      };
      localCommitVersionsRef.current.clear();
      undoStackRef.current = [];
      redoStackRef.current = [];
      setUndoStack([]);
      setRedoStack([]);
      return;
    }

    const previousHistoryVersion = historyVersionRef.current;
    if (
      previousHistoryVersion?.deckId === workspace.deck.id &&
      workspace.deck.version > previousHistoryVersion.version
    ) {
      const advance = classifyEditorVersionAdvance(
        previousHistoryVersion.version,
        workspace.deck.version,
        localCommitVersionsRef.current,
      );
      for (const version of localCommitVersionsRef.current) {
        if (version <= workspace.deck.version) localCommitVersionsRef.current.delete(version);
      }
      if (advance === 'external') {
        undoStackRef.current = [];
        redoStackRef.current = [];
        setUndoStack([]);
        setRedoStack([]);
      }
      historyVersionRef.current = {
        deckId: workspace.deck.id,
        version: workspace.deck.version,
      };
    }
  }, [workspace]);

  useEffect(() => {
    void activeDeckId;
    setAgentBusy(false);
    setVariationGenerating(false);
    setVariationDecisionBusy(false);
    setTastePackBusy(false);
    setShareBusy(false);
  }, [activeDeckId]);

  useEffect(() => {
    if (aiAgentActivity?.status !== 'running') return;
    const startedAt = Date.now();
    const timeout = window.setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      setAiAgentActivity((current) => {
        if (current?.status !== 'running') return current;
        if (elapsedMs >= 20_000) {
          return {
            status: 'delayed',
            elapsedMs,
            ask: current.ask,
            message:
              'The provider is still working. Nothing has changed and you can keep reviewing the deck.',
          };
        }
        return { ...current, elapsedMs };
      });
    }, 500);
    return () => window.clearInterval(timeout);
  }, [aiAgentActivity?.status]);

  useEffect(() => {
    let previousBreakpoint = responsiveBreakpoint(window.innerWidth);
    const onResize = () => {
      const nextBreakpoint = responsiveBreakpoint(window.innerWidth);
      if (nextBreakpoint === previousBreakpoint) return;
      previousBreakpoint = nextBreakpoint;
      if (nextBreakpoint === 'phone') {
        setNavigatorCollapsed(false);
        setInspectorCollapsed(true);
      } else if (nextBreakpoint === 'tablet') {
        setNavigatorCollapsed(true);
        setInspectorCollapsed(true);
      } else {
        setNavigatorCollapsed(false);
        setInspectorCollapsed(false);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const orderedSlides = useMemo(
    () =>
      workspace?.deck.slideOrder
        .map((id) => workspace.slides.find((slide) => slide.id === id))
        .filter((slide): slide is Slide => slide !== undefined) ?? [],
    [workspace],
  );
  const signaturePreviewSnapshot = useMemo(() => {
    if (!workspace || !previewedSignatureProfile) return null;
    const source: DeckSnapshot = {
      deck: workspace.deck,
      slides: workspace.slides,
      elements: workspace.elements,
      sources: workspace.sources,
    };
    const planned = planSignatureApplication(source, previewedSignatureProfile);
    if (!planned.ok) return planned.error.code === 'already_applied' ? source : null;
    return applyDeckPatch(
      source,
      {
        baseDeckVersion: planned.plan.baseDeckVersion,
        operations: planned.plan.operations,
        scope: planned.plan.scope,
      },
      source.deck.updatedAt,
    ).snapshot;
  }, [previewedSignatureProfile, workspace]);
  const activeSlide = orderedSlides.find((slide) => slide.id === activeSlideId) ?? orderedSlides[0];
  const activeSlideIndex = activeSlide
    ? orderedSlides.findIndex((slide) => slide.id === activeSlide.id)
    : -1;
  const slideElements =
    activeSlide && workspace
      ? workspace.elements.filter((element) => element.slideId === activeSlide.id)
      : [];
  const selectedElements = workspace
    ? selectedElementIds
        .map((id) => workspace.elements.find((element) => element.id === id))
        .filter((element): element is SlideElement => element !== undefined)
    : [];
  const previewedPatch = previewedPatchId
    ? (workspace?.patches.find((patch) => patch.id === previewedPatchId) ?? null)
    : null;
  const patchCandidateReceipt =
    previewedPatch && workspace
      ? editorCandidateReceiptForPatch(previewedPatch, workspace.deck)
      : null;
  const patchCandidateSnapshot = useMemo(() => {
    if (
      !workspace ||
      !previewedPatch ||
      !editorCandidateCanAccept(editorCandidateReceiptForPatch(previewedPatch, workspace.deck))
    ) {
      return null;
    }
    try {
      return applyDeckPatch(
        {
          deck: workspace.deck,
          slides: workspace.slides,
          elements: workspace.elements,
          sources: workspace.sources,
        },
        { ...previewedPatch, baseDeckVersion: workspace.deck.version },
        previewedPatch.candidateValidation?.checkedAt ?? previewedPatch.createdAt,
      ).snapshot;
    } catch {
      return null;
    }
  }, [previewedPatch, workspace]);
  const patchCandidateSlide = patchCandidateSnapshot?.slides.find(
    (slide) => slide.id === activeSlide?.id,
  );
  const patchCandidateElements = patchCandidateSlide
    ? (patchCandidateSnapshot?.elements.filter(
        (element) => element.slideId === patchCandidateSlide.id,
      ) ?? [])
    : [];
  const activeVariations = variationRows ?? [];
  const previewMatchesActiveSlide = Boolean(
    previewedVariation &&
      activeSlide &&
      previewedVariation.deckId === workspace?.deck.id &&
      previewedVariation.slideId === activeSlide.id &&
      previewedVariation.baseSlideVersion === activeSlide.version &&
      previewedVariation.status === 'ready' &&
      previewedVariation.validation.ok &&
      !previewedVariation.validation.issues.some((issue) => issue.severity === 'error'),
  );
  const signaturePreviewActive = Boolean(signaturePreviewSnapshot && previewedSignatureProfile);
  const compareCandidateSlide = previewedPatch
    ? patchCandidateSlide
    : previewMatchesActiveSlide && previewedVariation
      ? previewedVariation.candidate.slide
      : signaturePreviewSnapshot
        ? signaturePreviewSnapshot.slides.find((slide) => slide.id === activeSlide?.id)
        : null;
  const compareCandidateElements = previewedPatch
    ? patchCandidateElements
    : previewMatchesActiveSlide && previewedVariation
      ? previewedVariation.candidate.elements
      : signaturePreviewSnapshot && activeSlide
        ? signaturePreviewSnapshot.elements.filter((element) => element.slideId === activeSlide.id)
        : [];
  const compareCandidateReceipt: EditorCandidateReceipt | null = previewedPatch
    ? patchCandidateReceipt
    : previewMatchesActiveSlide && previewedVariation
      ? {
          id: previewedVariation.id,
          status: 'unavailable',
          summary: 'Validated variation preview; no accept-bound patch receipt is available yet.',
          versionLabel: `Variation from slide v${previewedVariation.baseSlideVersion}`,
        }
      : signaturePreviewActive && previewedSignatureProfile
        ? {
            id: previewedSignatureProfile.id,
            status: 'unavailable',
            summary: `${previewedSignatureProfile.name} is a local preview without a persisted patch receipt.`,
          }
        : null;
  const compareCandidateLabel =
    previewedPatch?.summary ??
    (previewedVariation ? variationDirectionLabel(previewedVariation) : null) ??
    previewedSignatureProfile?.name ??
    null;
  const compareOperations =
    previewedPatch?.operations ??
    (previewMatchesActiveSlide && previewedVariation ? previewedVariation.operations : []);
  const affectedSlideIds = previewedPatch?.affectedSlideIds ?? [];
  const aiReferences = useMemo(
    () =>
      workspace && activeSlide
        ? buildAiReferences(workspace, activeSlide, selectedElements)
        : ([] as AiReadReference[]),
    [activeSlide, selectedElements, workspace],
  );
  const aiCommands = useMemo(
    () =>
      (editorCapabilities?.commands ?? fallbackEditorCommands()).map((command) => ({
        id: command.id,
        label: editorCommandLabel(command.id),
        description: editorCommandDescription(command.id),
      })),
    [editorCapabilities],
  );
  const variationContextKey = `${activeDeckId ?? ''}:${activeSlideId ?? ''}`;
  const recentDecks: RecentDeck[] =
    recentDeckRows ??
    (workspace
      ? [
          {
            id: workspace.deck.id,
            title: workspace.deck.title,
            version: workspace.deck.version,
            updatedAt: workspace.deck.updatedAt,
          },
        ]
      : []);

  useEffect(() => {
    setPreviewedVariation((current) => {
      if (
        !current ||
        !activeSlide ||
        current.slideId !== activeSlide.id ||
        current.baseSlideVersion !== activeSlide.version
      ) {
        return null;
      }
      const latest = variationRows?.find((variation) => variation.id === current.id);
      if (
        latest?.status === 'ready' &&
        latest.validation.ok &&
        !latest.validation.issues.some((issue) => issue.severity === 'error')
      ) {
        return latest;
      }
      return variationRows === undefined ? current : null;
    });
  }, [activeSlide, variationRows]);

  useEffect(() => {
    if (variationContextKey !== ':') setVariationError(null);
  }, [variationContextKey]);

  useEffect(() => {
    if (!previewedPatchId || !workspace) return;
    const patch = workspace.patches.find((candidate) => candidate.id === previewedPatchId);
    if (!patch || patch.status === 'accepted' || patch.status === 'rejected') {
      setPreviewedPatchId(null);
      setCanvasMode('edit');
    }
  }, [previewedPatchId, workspace]);

  const sendPresence = useCallback(() => {
    if (!activeDeckId || !ownerAccessKey || !activeSlideId) return;
    void touchPresence({
      deckId: activeDeckId,
      ownerAccessKey,
      sessionId: clientSessionId,
      displayName: 'You',
      color: '#6d5dfc',
      slideId: activeSlideId,
      elementIds: selectedElementIds.slice(0, 24),
      ...(presenceCursorRef.current ? { cursor: presenceCursorRef.current } : {}),
    }).catch(() => undefined);
  }, [
    activeDeckId,
    activeSlideId,
    clientSessionId,
    ownerAccessKey,
    selectedElementIds,
    touchPresence,
  ]);

  useEffect(() => {
    sendPresence();
    const heartbeat = window.setInterval(sendPresence, 10_000);
    return () => window.clearInterval(heartbeat);
  }, [sendPresence]);

  useEffect(
    () => () => {
      if (presenceCursorTimerRef.current !== null) {
        window.clearTimeout(presenceCursorTimerRef.current);
      }
    },
    [],
  );

  const updatePresenceCursor = useCallback(
    (cursor: { x: number; y: number } | null) => {
      presenceCursorRef.current = cursor ?? undefined;
      if (presenceCursorTimerRef.current !== null) {
        window.clearTimeout(presenceCursorTimerRef.current);
      }
      presenceCursorTimerRef.current = window.setTimeout(sendPresence, 140);
    },
    [sendPresence],
  );

  const openOwnedDeck = useCallback((deckId: string) => {
    const nextOwnerAccessKey = getDeckOwnerAccessKey(deckId);
    if (!nextOwnerAccessKey) {
      setToast({
        kind: 'error',
        message:
          'This browser does not hold the owner capability for that deck. Open a view-only share link instead.',
      });
      return;
    }
    editorRequestGateRef.current?.setActiveDeck(deckId);
    activeDeckIdRef.current = deckId;
    workspaceRef.current = null;
    workspaceReceiptMarkerRef.current = null;
    ownerAccessKeyRef.current = nextOwnerAccessKey;
    setOwnerAccessKey(nextOwnerAccessKey);
    setActiveDeckId(deckId);
    setLocalWorkspace(null);
    setProjectsOpen(false);
    writeDeckToUrl(deckId);
  }, []);

  const refreshVariationPreferences = useCallback(async () => {
    if (!workspace || !ownerAccessKey) return;
    try {
      await syncVariationPreferences({
        deckId: workspace.deck.id,
        ownerAccessKey,
        limit: 100,
      });
      await runPreferenceEtl({ deckId: workspace.deck.id, ownerAccessKey });
    } catch {
      // Preference memory is inspectable and best-effort; editing must remain available.
    }
  }, [ownerAccessKey, runPreferenceEtl, syncVariationPreferences, workspace]);

  const enqueueEditorWrite = useCallback(
    <Result,>(
      deckId: string,
      skippedResult: Result,
      write: (context: EditorWriteContext) => Promise<Result>,
    ): Promise<Result> =>
      editorWriteQueueRef.current.enqueue(async () => {
        const currentWorkspace = workspaceRef.current;
        const currentOwnerAccessKey = ownerAccessKeyRef.current;
        const requestGate = editorRequestGateRef.current;
        if (
          !currentWorkspace ||
          currentWorkspace.deck.id !== deckId ||
          !currentOwnerAccessKey ||
          !requestGate.isDeckCurrent(deckId)
        ) {
          return skippedResult;
        }
        return write({
          workspace: currentWorkspace,
          ownerAccessKey: currentOwnerAccessKey,
          requestToken: requestGate.begin('write', deckId),
        });
      }),
    [],
  );

  const recordSuccessfulCommit = useCallback(
    (predecessor: DeckVersion | undefined, resultingVersion: number) => {
      localCommitVersionsRef.current.add(resultingVersion);
      if (!predecessor) return;
      const nextUndoStack = appendDistinctHistoryVersion(undoStackRef.current, predecessor.id);
      undoStackRef.current = nextUndoStack;
      redoStackRef.current = [];
      setUndoStack(nextUndoStack);
      setRedoStack([]);
    },
    [],
  );

  const applyOperations = useCallback(
    async (
      operations: PatchOperation[],
      scope: PatchScope,
      summary: string,
      signatureProfile?: SignatureProfile,
      expectedElementVersions?: Readonly<Record<string, number>>,
      originRequestToken?: EditorRequestToken,
    ) => {
      if (!workspace || !ownerAccessKey || operations.length === 0) return false;
      const requestedDeckId = workspace.deck.id;
      return enqueueEditorWrite(
        requestedDeckId,
        false,
        async ({
          workspace: currentWorkspace,
          ownerAccessKey: currentOwnerAccessKey,
          requestToken,
        }) => {
          const requestGate = editorRequestGateRef.current;
          if (originRequestToken && !requestGate.isCurrent(originRequestToken)) return false;
          const clocks = clocksForScope(currentWorkspace, scope, operations);
          try {
            const receipt = await applyPatchMutation({
              deckId: requestedDeckId,
              ownerAccessKey: currentOwnerAccessKey,
              baseDeckVersion: currentWorkspace.deck.version,
              baseSlideVersions: clocks.baseSlideVersions,
              baseElementVersions: applyExpectedElementVersions(
                clocks.baseElementVersions,
                expectedElementVersions,
              ),
              scope,
              operations,
              summary,
              ...(signatureProfile
                ? {
                    profileId: signatureProfile.id,
                    profileDigest: signatureProfile.source.digest,
                  }
                : {}),
            });
            if (
              !requestGate.isCurrent(requestToken) ||
              (originRequestToken && !requestGate.isCurrent(originRequestToken))
            ) {
              return false;
            }
            if (receipt.patch.status === 'stale') {
              if (receipt.workspace) {
                installWorkspace(receipt.workspace, currentOwnerAccessKey);
              }
              setCanvasResetKey((value) => value + 1);
              setToast({
                kind: 'error',
                message:
                  'This object changed elsewhere. Your local preview was rolled back; review the stale proposal in Versions.',
              });
              setActiveInspectorTab('versions');
              setInspectorCollapsed(false);
              return false;
            }
            if (receipt.patch.status !== 'accepted' || !receipt.workspace) {
              throw new Error('The edit completed without an authoritative commit receipt.');
            }
            recordSuccessfulCommit(
              authoritativePredecessorVersion(receipt.workspace),
              receipt.workspace.deck.version,
            );
            installWorkspace(receipt.workspace, currentOwnerAccessKey);
            void recordPreferencePatch({
              deckId: requestedDeckId,
              ownerAccessKey: currentOwnerAccessKey,
              patchId: receipt.patch.id,
            })
              .then(() =>
                runPreferenceEtl({
                  deckId: requestedDeckId,
                  ownerAccessKey: currentOwnerAccessKey,
                }),
              )
              .catch(() => undefined);
            return true;
          } catch (error) {
            if (
              !requestGate.isCurrent(requestToken) ||
              (originRequestToken && !requestGate.isCurrent(originRequestToken))
            ) {
              return false;
            }
            setCanvasResetKey((value) => value + 1);
            setToast({
              kind: 'error',
              message: errorMessage(error, 'The edit could not be applied.'),
            });
            return false;
          }
        },
      );
    },
    [
      applyPatchMutation,
      enqueueEditorWrite,
      installWorkspace,
      ownerAccessKey,
      recordPreferencePatch,
      recordSuccessfulCommit,
      runPreferenceEtl,
      workspace,
    ],
  );

  const restoreHistory = useCallback(
    async (direction: 'undo' | 'redo') => {
      if (!workspace || !ownerAccessKey) return;
      const requestedDeckId = workspace.deck.id;
      await enqueueEditorWrite(
        requestedDeckId,
        false,
        async ({
          workspace: currentWorkspace,
          ownerAccessKey: currentOwnerAccessKey,
          requestToken,
        }) => {
          const requestGate = editorRequestGateRef.current;
          const sourceStack = direction === 'undo' ? undoStackRef.current : redoStackRef.current;
          const targetId = sourceStack.at(-1);
          if (!targetId) return false;
          const current = currentVersion(currentWorkspace);
          try {
            const receipt = await restoreVersion({
              deckId: requestedDeckId,
              ownerAccessKey: currentOwnerAccessKey,
              versionId: targetId,
              baseDeckVersion: currentWorkspace.deck.version,
            });
            if (!requestGate.isCurrent(requestToken)) return false;
            if (receipt.patch.status !== 'accepted') {
              if (receipt.workspace) {
                installWorkspace(receipt.workspace, currentOwnerAccessKey);
              }
              setToast({
                kind: 'error',
                message:
                  'This deck changed before the restore could apply. Your undo history was preserved.',
              });
              setActiveInspectorTab('versions');
              setInspectorCollapsed(false);
              return false;
            }
            if (!receipt.workspace) {
              throw new Error('Restore completed without a workspace receipt.');
            }
            localCommitVersionsRef.current.add(receipt.workspace.deck.version);
            if (direction === 'undo') {
              undoStackRef.current = undoStackRef.current.slice(0, -1);
              if (current) {
                redoStackRef.current = appendDistinctHistoryVersion(
                  redoStackRef.current,
                  current.id,
                );
              }
            } else {
              redoStackRef.current = redoStackRef.current.slice(0, -1);
              if (current) {
                undoStackRef.current = appendDistinctHistoryVersion(
                  undoStackRef.current,
                  current.id,
                );
              }
            }
            setUndoStack(undoStackRef.current);
            setRedoStack(redoStackRef.current);
            installWorkspace(receipt.workspace, currentOwnerAccessKey);
            setCanvasResetKey((value) => value + 1);
            setToast({
              kind: 'success',
              message: direction === 'undo' ? 'Change undone.' : 'Change redone.',
            });
            return true;
          } catch (error) {
            if (!requestGate.isCurrent(requestToken)) return false;
            setToast({
              kind: 'error',
              message: errorMessage(error, direction === 'undo' ? 'Undo failed.' : 'Redo failed.'),
            });
            return false;
          }
        },
      );
    },
    [enqueueEditorWrite, installWorkspace, ownerAccessKey, restoreVersion, workspace],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (
        (previewMatchesActiveSlide || signaturePreviewActive || previewedPatch) &&
        event.key === 'Escape' &&
        !commandOpen &&
        !projectsOpen &&
        !presentMode
      ) {
        event.preventDefault();
        setPreviewedVariation(null);
        setPreviewedSignatureProfile(null);
        setPreviewedPatchId(null);
        setCanvasMode('edit');
        setSelectedElementIds([]);
        return;
      }
      if (isEditableTarget(event.target) || commandOpen || projectsOpen || presentMode) return;
      if (previewMatchesActiveSlide || signaturePreviewActive || previewedPatch) {
        if (
          event.key !== 'ArrowDown' &&
          event.key !== 'PageDown' &&
          event.key !== 'ArrowUp' &&
          event.key !== 'PageUp' &&
          event.key !== 'ArrowLeft' &&
          event.key !== 'ArrowRight'
        ) {
          return;
        }
      }
      const modified = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (!modified && !event.altKey && (key === 'e' || key === 'o' || key === 'c')) {
        event.preventDefault();
        setCanvasMode(key === 'e' ? 'edit' : key === 'o' ? 'overview' : 'compare');
        return;
      }
      if (modified && key === 'z') {
        event.preventDefault();
        void restoreHistory(event.shiftKey ? 'redo' : 'undo');
        return;
      }
      if (modified && key === 'c' && selectedElements.length > 0) {
        event.preventDefault();
        setClipboardElements(selectedElements.map((element) => structuredClone(element)));
        setToast({
          kind: 'success',
          message: `Copied ${selectedElements.length} element${selectedElements.length === 1 ? '' : 's'}.`,
        });
        return;
      }
      if (modified && key === 'v' && clipboardElements.length > 0 && workspace && activeSlide) {
        event.preventDefault();
        const copies = clipboardElements.map((element, index) =>
          pasteElement(element, activeSlide.id, index),
        );
        void applyOperations(
          copies.map((element) => ({ op: 'add_element', slideId: activeSlide.id, element })),
          elementScope(workspace.deck.id, copies),
          `Pasted ${copies.length} element${copies.length === 1 ? '' : 's'}`,
        ).then((accepted) => {
          if (accepted) setSelectedElementIds(copies.map((element) => element.id));
        });
        return;
      }
      if (modified && key === 'd' && selectedElements.length > 0 && workspace) {
        event.preventDefault();
        const copies = selectedElements
          .filter((element) => !element.locked)
          .map((element, index) => duplicateElement(element, index));
        void applyOperations(
          copies.map((element) => ({ op: 'add_element', slideId: element.slideId, element })),
          elementScope(workspace.deck.id, copies),
          `Duplicated ${copies.length} element${copies.length === 1 ? '' : 's'}`,
        ).then((accepted) => {
          if (accepted) setSelectedElementIds(copies.map((element) => element.id));
        });
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        const next = orderedSlides[Math.min(orderedSlides.length - 1, activeSlideIndex + 1)];
        if (next) selectSlide(next.id, setActiveSlideId, setSelectedElementIds);
      } else if (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const previous = orderedSlides[Math.max(0, activeSlideIndex - 1)];
        if (previous) selectSlide(previous.id, setActiveSlideId, setSelectedElementIds);
      } else if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        selectedElements.length > 0 &&
        workspace
      ) {
        event.preventDefault();
        const operations: PatchOperation[] = selectedElements
          .filter((element) => !element.locked)
          .map((element) => ({
            op: 'remove_element',
            slideId: element.slideId,
            elementId: element.id,
          }));
        const scope = elementScope(workspace.deck.id, selectedElements);
        void applyOperations(
          operations,
          scope,
          `Deleted ${operations.length} element${operations.length === 1 ? '' : 's'}`,
        );
        setSelectedElementIds([]);
      } else if (event.key === 'Escape') {
        if (selectedElementIds.length) setSelectedElementIds([]);
        else if (window.innerWidth <= 1100) setInspectorCollapsed(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeSlideIndex,
    activeSlide,
    applyOperations,
    clipboardElements,
    commandOpen,
    orderedSlides,
    presentMode,
    projectsOpen,
    previewMatchesActiveSlide,
    previewedPatch,
    signaturePreviewActive,
    restoreHistory,
    selectedElementIds.length,
    selectedElements,
    workspace,
  ]);

  const openInspector = (tab: InspectorTab) => {
    setActiveInspectorTab(tab);
    setInspectorCollapsed(false);
  };
  const selectElements = (ids: string[]) => {
    setSelectedElementIds(ids);
    if (ids.length > 0) openInspector('design');
  };

  const createDeck = async (request: CreateDeckAdmissionRequest) => {
    const requestGate = editorRequestGateRef.current;
    const requestToken = requestGate.begin('create-deck', activeDeckId);
    setProjectError(null);
    setCreating(true);
    try {
      const result = await createDeckFromBrief({ ...request });
      if (!requestGate.isCurrent(requestToken)) return;
      setCreating(false);
      const accessDurable = installWorkspace(result, undefined, false, true);
      setProjectsOpen(false);
      if (accessDurable) {
        setToast({
          kind: 'success',
          message:
            request.providerMode === 'deterministic'
              ? 'Deck created deterministically. Your brief stayed inside NodeSlide.'
              : `Deck created after your consented ${request.providerMode === 'nebius' ? 'Nebius' : 'OpenRouter'} attempt. Trace shows the provider result and any deterministic fallback.`,
        });
      }
    } catch (error) {
      if (!requestGate.isCurrent(requestToken)) return;
      const message = errorMessage(error, 'The deck could not be created.');
      setProjectError(message);
      setToast({ kind: 'error', message });
    } finally {
      if (requestGate.isCurrent(requestToken)) setCreating(false);
    }
  };

  const projectsDialog = (
    <ProjectDialog
      open={projectsOpen}
      clientSessionId={clientSessionId}
      recentDecks={recentDecks}
      creating={creating}
      error={projectError}
      onClearError={() => setProjectError(null)}
      onClose={() => {
        setProjectError(null);
        setProjectsOpen(false);
      }}
      onCreate={(request) => void createDeck(request)}
      onOpenDeck={openOwnedDeck}
      initialMode="open"
      createEnabled={false}
    />
  );

  if (requestedShare) {
    if (sharedSnapshot === undefined) return <LoadingScreen title="Opening presentation…" />;
    if (!sharedSnapshot) {
      return (
        <RecoveryScreen
          title="This presentation link is unavailable"
          detail="It may have been revoked, replaced, or copied incorrectly. Ask the owner for a new view-only link."
          primaryLabel="Open NodeSlide"
          onPrimary={() => {
            const url = new URL(window.location.href);
            url.searchParams.delete('share');
            url.searchParams.delete('present');
            window.location.assign(url);
          }}
        />
      );
    }
    const requestedSlide = new URLSearchParams(window.location.search).get('slide') ?? undefined;
    return (
      <PresenterView
        workspace={sharedSnapshot.snapshot}
        showNotes={false}
        {...(requestedSlide ? { initialSlideId: requestedSlide } : {})}
        onExit={() => window.history.back()}
      />
    );
  }

  if (requestedDeck && !ownerAccessKey) {
    return (
      <>
        <RecoveryScreen
          title="This is an editor link, not a share link"
          detail="Raw deck IDs do not grant access. Paste the private recovery key for this deck, open a deck owned by this browser, or ask for a view-only presentation link."
          primaryLabel="Open my decks"
          onPrimary={() => setProjectsOpen(true)}
        >
          <form
            className="ns-recovery-form"
            onSubmit={(event) => {
              event.preventDefault();
              const candidate = recoveryAccessInput.trim();
              if (!candidate || candidate.length > 256 || recoveryAccessRequest) return;
              setRecoveryAccessError(null);
              setRecoveryAccessRequest(candidate);
              setRecoveryAccessInput('');
            }}
          >
            <label htmlFor="nodeslide-owner-recovery-key">Private recovery key</label>
            <input
              id="nodeslide-owner-recovery-key"
              type="password"
              value={recoveryAccessInput}
              onChange={(event) => setRecoveryAccessInput(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              maxLength={256}
              disabled={Boolean(recoveryAccessRequest)}
            />
            {recoveryAccessError ? <output aria-live="polite">{recoveryAccessError}</output> : null}
            <button
              className="ns-button ns-button--accent"
              type="submit"
              disabled={!recoveryAccessInput.trim() || Boolean(recoveryAccessRequest)}
            >
              {recoveryAccessRequest ? <LoaderCircle className="ns-spin" size={15} /> : null}
              {recoveryAccessRequest ? 'Checking key…' : 'Recover deck access'}
            </button>
          </form>
        </RecoveryScreen>
        {projectsDialog}
        {toast ? <Toast toast={toast} onClose={() => setToast(null)} /> : null}
      </>
    );
  }

  if (
    !requestedDeck &&
    !requestedShare &&
    !activeDeckId &&
    !workspace &&
    !sampleRequested &&
    !bootstrapError
  ) {
    return (
      <>
        <NodeSlideLanding
          clientSessionId={clientSessionId}
          recentDecks={recentDecks}
          creating={creating}
          error={projectError}
          onClearError={() => setProjectError(null)}
          onCreate={(request) => void createDeck(request)}
          onExploreSample={() => setSampleRequested(true)}
          onOpenProjects={() => {
            setProjectsOpen(true);
          }}
          onOpenDeck={openOwnedDeck}
        />
        {projectsDialog}
        {toast ? <Toast toast={toast} onClose={() => setToast(null)} /> : null}
      </>
    );
  }

  if (activeDeckId && ownerAccessKey && queriedWorkspace === null && !localWorkspace) {
    return (
      <>
        <RecoveryScreen
          title="Deck unavailable"
          detail="NodeSlide could not find this deck with the capability stored in this browser. Your current URL was left intact."
          primaryLabel="Open another deck"
          onPrimary={() => setProjectsOpen(true)}
        />
        {projectsDialog}
      </>
    );
  }

  if (bootstrapError && !workspace) {
    return (
      <RecoveryScreen
        title="NodeSlide could not start"
        detail={bootstrapError}
        primaryLabel="Retry"
        onPrimary={() => {
          bootstrapped.current = false;
          setBootstrapAttempt((value) => value + 1);
        }}
      />
    );
  }

  if (!workspace || !activeSlide) {
    return <LoadingScreen title={requestedDeck ? 'Opening your deck…' : 'Preparing the sample…'} />;
  }

  if (presentMode) {
    const presentationValidation = validateSnapshot({
      deck: workspace.deck,
      slides: workspace.slides,
      elements: workspace.elements,
      sources: workspace.sources,
    });
    if (!presentationValidation.publishOk) {
      return (
        <RecoveryScreen
          title="This deck is not presentable yet"
          detail={validationBlockMessage(presentationValidation, 'present')}
          primaryLabel="Return to editor"
          onPrimary={() => {
            setPresentMode(false);
            setQueryParam('present', null);
            setActiveInspectorTab('trace');
            setInspectorCollapsed(false);
          }}
        />
      );
    }
    return (
      <PresenterView
        workspace={workspace}
        initialSlideId={activeSlide.id}
        onExit={(slideId) => {
          setActiveSlideId(slideId);
          setPresentMode(false);
          setQueryParam('present', null);
          setQueryParam('slide', null);
        }}
      />
    );
  }

  const snapshot: DeckSnapshot = {
    deck: workspace.deck,
    slides: workspace.slides,
    elements: workspace.elements,
    sources: workspace.sources,
  };
  const exportValidation = validateSnapshot(
    snapshot,
    activeSignatureProfile ? { signatureProfile: activeSignatureProfile } : {},
  );
  const activeSignatureLoading = Boolean(
    workspace.deck.activeSignatureProfileId && signatureProfileRows === undefined,
  );
  const canUndo = undoStack.length > 0;
  const beginPresentation = () => {
    if (activeSignatureLoading) {
      setToast({
        kind: 'error',
        message: 'Loading the active signature receipt. Try again shortly.',
      });
      return;
    }
    if (!exportValidation.publishOk) {
      setActiveInspectorTab('trace');
      setInspectorCollapsed(false);
      setToast({
        kind: 'error',
        message: validationBlockMessage(exportValidation, 'present'),
      });
      return;
    }
    setQueryParam('present', '1');
    setPresentMode(true);
  };
  const exportDeck = (kind: 'html' | 'pptx') => {
    if (activeSignatureLoading) {
      setToast({
        kind: 'error',
        message: 'Loading the active signature receipt. Try again shortly.',
      });
      return;
    }
    if (!exportValidation.publishOk || !exportValidation.cleanOk) {
      setActiveInspectorTab('trace');
      setInspectorCollapsed(false);
      setToast({ kind: 'error', message: validationBlockMessage(exportValidation, 'export') });
      return;
    }
    if (kind === 'html') {
      downloadDeckHtml(snapshot);
      setToast({ kind: 'success', message: 'Validated HTML export prepared.' });
      if (ownerAccessKey) {
        void recordPreferenceExport({
          deckId: workspace.deck.id,
          ownerAccessKey,
          kind,
        })
          .then(() => runPreferenceEtl({ deckId: workspace.deck.id, ownerAccessKey }))
          .catch(() => undefined);
      }
      return;
    }
    void downloadPptx(snapshot)
      .then(() => {
        setToast({ kind: 'success', message: 'Validated PowerPoint export prepared.' });
        if (ownerAccessKey) {
          void recordPreferenceExport({
            deckId: workspace.deck.id,
            ownerAccessKey,
            kind,
          })
            .then(() => runPreferenceEtl({ deckId: workspace.deck.id, ownerAccessKey }))
            .catch(() => undefined);
        }
      })
      .catch((error: unknown) =>
        setToast({
          kind: 'error',
          message: errorMessage(error, 'PowerPoint export failed.'),
        }),
      );
  };
  const applySignatureProfile = (profile: SignatureProfile) => {
    if (!ownerAccessKey || tastePackBusy) return;
    const requestedDeckId = workspace.deck.id;
    const requestedOwnerAccessKey = ownerAccessKey;
    const requestGate = editorRequestGateRef.current;
    const requestToken = requestGate.begin('signature-apply', requestedDeckId);
    setTastePackBusy(true);
    setPreviewedSignatureProfile(null);
    void (async () => {
      try {
        await saveSignatureProfile({
          deckId: requestedDeckId,
          ownerAccessKey: requestedOwnerAccessKey,
          profileJson: JSON.stringify(profile),
        });
        if (!requestGate.isCurrent(requestToken)) return;
        const currentWorkspace = workspaceRef.current;
        if (!currentWorkspace || currentWorkspace.deck.id !== requestedDeckId) return;
        const currentSnapshot: DeckSnapshot = {
          deck: currentWorkspace.deck,
          slides: currentWorkspace.slides,
          elements: currentWorkspace.elements,
          sources: currentWorkspace.sources,
        };
        const result = planSignatureApplication(currentSnapshot, profile);
        if (!result.ok) {
          if (result.error.code !== 'already_applied') throw new Error(result.error.message);
          await enqueueEditorWrite(
            requestedDeckId,
            false,
            async ({
              workspace: writeWorkspace,
              ownerAccessKey: writeOwnerAccessKey,
              requestToken: writeRequestToken,
            }) => {
              if (!requestGate.isCurrent(requestToken)) return false;
              const activated = await activateSignatureProfile({
                deckId: requestedDeckId,
                ownerAccessKey: writeOwnerAccessKey,
                profileId: profile.id,
                profileDigest: profile.source.digest,
                baseDeckVersion: writeWorkspace.deck.version,
              });
              if (
                !requestGate.isCurrent(writeRequestToken) ||
                !requestGate.isCurrent(requestToken)
              ) {
                return false;
              }
              if (activated) {
                recordSuccessfulCommit(
                  authoritativePredecessorVersion(activated),
                  activated.deck.version,
                );
                installWorkspace(activated, writeOwnerAccessKey);
              }
              return true;
            },
          );
          if (!requestGate.isCurrent(requestToken)) return;
          setToast({
            kind: 'success',
            message: `${profile.name} was already present; durable on-brand checks are now active.`,
          });
          return;
        }
        const accepted = await applyOperations(
          result.plan.operations,
          result.plan.scope,
          `Applied ${profile.name} signature`,
          profile,
          undefined,
          requestToken,
        );
        if (accepted && requestGate.isCurrent(requestToken)) {
          setToast({
            kind: 'success',
            message: `${profile.name} applied through a versioned, on-brand-validated patch.`,
          });
        }
      } catch (error) {
        if (!requestGate.isCurrent(requestToken)) return;
        setToast({
          kind: 'error',
          message: errorMessage(error, 'Signature could not be applied.'),
        });
      } finally {
        if (requestGate.isCurrent(requestToken)) setTastePackBusy(false);
      }
    })();
  };
  const uploadSignatureSource = (file: File) => {
    if (!ownerAccessKey || tastePackBusy) return;
    const requestedDeckId = workspace.deck.id;
    const requestedOwnerAccessKey = ownerAccessKey;
    const requestGate = editorRequestGateRef.current;
    const requestToken = requestGate.begin('signature-upload', requestedDeckId);
    setTastePackBusy(true);
    void (async () => {
      try {
        const buffer = await file.arrayBuffer();
        if (!requestGate.isCurrent(requestToken)) return;
        const result = await extractPptxSignature(new Uint8Array(buffer), {
          fileName: file.name,
        });
        if (!requestGate.isCurrent(requestToken)) return;
        if (!result.ok) throw new Error(result.error.message);
        const profileJson = await saveSignatureProfile({
          deckId: requestedDeckId,
          ownerAccessKey: requestedOwnerAccessKey,
          profileJson: JSON.stringify(result.profile),
        });
        if (!requestGate.isCurrent(requestToken)) return;
        const profile = parseSignatureProfileRows([profileJson])[0];
        if (!profile) throw new Error('The saved signature profile could not be decoded.');
        setPreviewedVariation(null);
        setPreviewedSignatureProfile(profile);
        setToast({
          kind: 'success',
          message: `${profile.name} extracted with ${profile.confidence} confidence. Preview before applying.`,
        });
      } catch (error) {
        if (!requestGate.isCurrent(requestToken)) return;
        setToast({ kind: 'error', message: errorMessage(error, 'Past deck could not be read.') });
      } finally {
        if (requestGate.isCurrent(requestToken)) setTastePackBusy(false);
      }
    })();
  };

  const attachAiDataFile = async (file: File): Promise<AiReadReference> => {
    if (!ownerAccessKey) throw new Error('Open an owned deck before attaching data.');
    if (file.size > 24_000) throw new Error('Data attachments must be 24 KB or smaller.');
    const extension = file.name.split('.').pop()?.toLocaleLowerCase() ?? '';
    if (!['csv', 'json', 'txt'].includes(extension)) {
      throw new Error('Attach a CSV, JSON, or TXT data file.');
    }
    const requestedDeckId = workspace.deck.id;
    const requestedOwnerAccessKey = ownerAccessKey;
    const requestGate = editorRequestGateRef.current;
    const requestToken = requestGate.begin('data-upload', requestedDeckId);
    const content = await file.text();
    if (!requestGate.isCurrent(requestToken)) throw new Error('The active deck changed.');
    const reference = await attachDataSource({
      deckId: requestedDeckId,
      ownerAccessKey: requestedOwnerAccessKey,
      title: file.name,
      format: extension as 'csv' | 'json' | 'txt',
      content,
    });
    if (!requestGate.isCurrent(requestToken)) throw new Error('The active deck changed.');
    setToast({ kind: 'success', message: `${file.name} is attached as agent read context.` });
    return reference;
  };

  const deleteAiDataSource = async (sourceId: string) => {
    if (!ownerAccessKey) throw new Error('Open an owned deck before deleting data.');
    const deleted = await deleteDataSource({
      deckId: workspace.deck.id,
      ownerAccessKey,
      sourceId,
    });
    if (deleted) setToast({ kind: 'success', message: 'Private uploaded source deleted.' });
  };

  const cancelAiRun = async (runId: string) => {
    if (!ownerAccessKey) return;
    const cancelled = await cancelAgentRun({
      deckId: workspace.deck.id,
      ownerAccessKey,
      runId,
    });
    if (cancelled?.status === 'cancelled') {
      setAgentBusy(false);
      setAiAgentActivity(null);
      setToast({ kind: 'success', message: 'Agent run cancelled. No changes were applied.' });
    }
  };

  const previewPatch = (patch: DeckPatch | null) => {
    setPreviewedVariation(null);
    setPreviewedSignatureProfile(null);
    if (!patch) {
      setPreviewedPatchId(null);
      setCanvasMode('edit');
      return;
    }
    const currentWorkspace = workspaceRef.current;
    if (
      !currentWorkspace ||
      !editorCandidateCanAccept(editorCandidateReceiptForPatch(patch, currentWorkspace.deck))
    ) {
      setPreviewedPatchId(null);
      setCanvasMode('edit');
      setToast({
        kind: 'error',
        message: "Compare requires this patch's exact successful candidate validation receipt.",
      });
      return;
    }
    setPreviewedPatchId(patch.id);
    const firstAffectedSlideId = 'slideIds' in patch.scope ? patch.scope.slideIds[0] : undefined;
    if (firstAffectedSlideId && currentWorkspace.deck.slideOrder.includes(firstAffectedSlideId)) {
      selectSlide(firstAffectedSlideId, setActiveSlideId, setSelectedElementIds);
    }
    setCanvasMode('compare');
    if (shouldRevealCandidateCanvas(window.innerWidth)) setInspectorCollapsed(true);
  };

  const handleAcceptPatch = (patch: DeckPatch) => {
    if (!ownerAccessKey || !workspace) return;
    const requestedDeckId = workspace.deck.id;
    void enqueueEditorWrite(
      requestedDeckId,
      false,
      async ({
        workspace: currentWorkspace,
        ownerAccessKey: currentOwnerAccessKey,
        requestToken,
      }) => {
        const requestGate = editorRequestGateRef.current;
        const currentPatch =
          currentWorkspace.patches.find((candidate) => candidate.id === patch.id) ?? patch;
        if (
          !editorCandidateCanAccept(
            editorCandidateReceiptForPatch(currentPatch, currentWorkspace.deck),
          )
        ) {
          setToast({
            kind: 'error',
            message: "Accept requires this patch's exact successful candidate validation receipt.",
          });
          return false;
        }
        try {
          const receipt = await acceptPatch({
            deckId: requestedDeckId,
            ownerAccessKey: currentOwnerAccessKey,
            patchId: currentPatch.id,
          });
          if (!requestGate.isCurrent(requestToken)) return false;
          if (receipt.patch.status === 'stale') {
            if (receipt.workspace) {
              installWorkspace(receipt.workspace, currentOwnerAccessKey);
            }
            setActiveInspectorTab('versions');
            setInspectorCollapsed(false);
            setToast({
              kind: 'error',
              message: 'The proposal is stale. Compare it with the current deck before retrying.',
            });
            return false;
          }
          if (receipt.patch.status !== 'accepted' || !receipt.workspace) {
            throw new Error('Accept completed without an authoritative commit receipt.');
          }
          recordSuccessfulCommit(
            authoritativePredecessorVersion(receipt.workspace),
            receipt.workspace.deck.version,
          );
          installWorkspace(receipt.workspace, currentOwnerAccessKey);
          setPreviewedPatchId(null);
          setCanvasMode('edit');
          if (currentPatch.linkedCommentId) setAiCommentContext(null);
          setToast({
            kind: 'success',
            message: 'Validated proposal accepted as a new deck version.',
          });
          void recordPreferencePatch({
            deckId: requestedDeckId,
            ownerAccessKey: currentOwnerAccessKey,
            patchId: receipt.patch.id,
          })
            .then(() =>
              runPreferenceEtl({
                deckId: requestedDeckId,
                ownerAccessKey: currentOwnerAccessKey,
              }),
            )
            .catch(() => undefined);
          return true;
        } catch (error) {
          if (!requestGate.isCurrent(requestToken)) return false;
          setToast({
            kind: 'error',
            message: errorMessage(error, 'The proposal could not be accepted.'),
          });
          return false;
        }
      },
    );
  };

  const handleRejectPatch = (patch: DeckPatch) => {
    if (!ownerAccessKey || !workspace) return;
    const requestedDeckId = workspace.deck.id;
    void enqueueEditorWrite(
      requestedDeckId,
      false,
      async ({
        workspace: currentWorkspace,
        ownerAccessKey: currentOwnerAccessKey,
        requestToken,
      }) => {
        const requestGate = editorRequestGateRef.current;
        try {
          const rejected = await rejectPatch({
            deckId: requestedDeckId,
            ownerAccessKey: currentOwnerAccessKey,
            patchId: patch.id,
          });
          if (!requestGate.isCurrent(requestToken)) return false;
          setPreviewedPatchId((current) => (current === patch.id ? null : current));
          setCanvasMode('edit');
          if (!rejected) return true;
          installWorkspace(
            {
              ...currentWorkspace,
              patches: currentWorkspace.patches.map((candidate) =>
                candidate.id === rejected.id ? rejected : candidate,
              ),
            },
            currentOwnerAccessKey,
          );
          void recordPreferencePatch({
            deckId: requestedDeckId,
            ownerAccessKey: currentOwnerAccessKey,
            patchId: rejected.id,
          })
            .then(() =>
              runPreferenceEtl({
                deckId: requestedDeckId,
                ownerAccessKey: currentOwnerAccessKey,
              }),
            )
            .catch(() => undefined);
          return true;
        } catch (error) {
          if (!requestGate.isCurrent(requestToken)) return false;
          setToast({
            kind: 'error',
            message: errorMessage(error, 'The proposal could not be rejected.'),
          });
          return false;
        }
      },
    );
  };

  const handleProposeEdit = (
    instruction: string,
    scope: PatchScope,
    options: AiProposalOptions<NodeSlideEditorCommandId>,
  ) => {
    if (!ownerAccessKey) return;
    const requestedDeckId = workspace.deck.id;
    const requestedOwnerAccessKey = ownerAccessKey;
    const requestGate = editorRequestGateRef.current;
    const requestToken = requestGate.begin('proposal', requestedDeckId);
    setAgentBusy(true);
    setAiAgentActivity({ status: 'running', elapsedMs: 0, ask: instruction });
    if (options.commandId === 'propagate') {
      const parent = latestPropagatablePatch(workspace.patches);
      if (!parent) {
        setAgentBusy(false);
        setAiAgentActivity(null);
        setToast({
          kind: 'error',
          message: 'Accept a style or visibility proposal before asking NodeSlide to propagate it.',
        });
        return;
      }
      void (async () => {
        try {
          const receipt = await proposePropagation({
            deckId: requestedDeckId,
            ownerAccessKey: requestedOwnerAccessKey,
            parentPatchId: parent.id,
          });
          if (!requestGate.isCurrent(requestToken)) return;
          if (!receipt.workspace) {
            throw new Error('The proposal completed without an authoritative workspace receipt.');
          }
          installWorkspace(receipt.workspace, requestedOwnerAccessKey);
          previewPatch(
            receipt.workspace.patches.find((candidate) => candidate.id === receipt.patch.id) ??
              receipt.patch,
          );
          setAiAgentActivity(null);
        } catch (error) {
          if (!requestGate.isCurrent(requestToken)) return;
          const message = errorMessage(error, 'A safe propagation proposal could not be created.');
          setAiAgentActivity({ status: 'failed', elapsedMs: 0, ask: instruction, message });
          setToast({ kind: 'error', message });
        } finally {
          if (requestGate.isCurrent(requestToken)) setAgentBusy(false);
        }
      })();
      return;
    }

    const clocks = clocksForScope(workspace, scope, []);
    const focusSlideId =
      scope.kind === 'deck' || scope.slideIds.includes(activeSlide.id)
        ? activeSlide.id
        : scope.slideIds[0];
    const { commentContext: _commentContext, ...requestOptions } = options;
    void (async () => {
      try {
        const receipt = await proposeEdit({
          deckId: requestedDeckId,
          ownerAccessKey: requestedOwnerAccessKey,
          instruction,
          baseDeckVersion: workspace.deck.version,
          ...clocks,
          scope,
          ...(focusSlideId ? { focusSlideId } : {}),
          ...requestOptions,
        });
        if (!requestGate.isCurrent(requestToken)) return;
        if (!receipt.workspace) {
          throw new Error('The proposal completed without an authoritative workspace receipt.');
        }
        installWorkspace(receipt.workspace, requestedOwnerAccessKey);
        previewPatch(
          receipt.workspace.patches.find((candidate) => candidate.id === receipt.patch.id) ??
            receipt.patch,
        );
        setAiAgentActivity(null);
      } catch (error) {
        if (!requestGate.isCurrent(requestToken)) return;
        const message = errorMessage(error, 'The agent could not create a proposal.');
        const cancelled = /cancelled before validation|run was cancelled/iu.test(message);
        setAiAgentActivity({
          status: cancelled ? 'cancelled' : 'failed',
          elapsedMs: 0,
          ask: instruction,
          message: cancelled ? 'Run cancelled. No deck changes were applied.' : message,
        });
        setToast({
          kind: cancelled ? 'success' : 'error',
          message: cancelled ? 'Run cancelled. No deck changes were applied.' : message,
        });
      } finally {
        if (requestGate.isCurrent(requestToken)) setAgentBusy(false);
      }
    })();
  };

  const handleGenerateVariations = (request: AiVariationRequest) => {
    if (!ownerAccessKey || variationBusy) return;
    const requestedDeckId = workspace.deck.id;
    const requestedOwnerAccessKey = ownerAccessKey;
    const requestedSlideId = activeSlide.id;
    const requestGate = editorRequestGateRef.current;
    const requestToken = requestGate.begin('variation-generation', requestedDeckId);
    const providerRequest =
      request.providerMode !== 'deterministic'
        ? {
            providerMode: request.providerMode,
            providerModel: request.providerModel,
            providerEffort: request.providerEffort,
            providerConsent: request.providerConsent,
          }
        : { providerMode: request.providerMode };
    setPreviewedPatchId(null);
    setPreviewedVariation(null);
    setVariationError(null);
    setVariationGenerating(true);
    void (async () => {
      try {
        const receipt = await generateVariations({
          deckId: requestedDeckId,
          ownerAccessKey: requestedOwnerAccessKey,
          slideId: requestedSlideId,
          ...providerRequest,
        });
        if (!requestGate.isCurrent(requestToken)) return;
        if (receipt.variations.length !== 3) {
          throw new Error('The variation service did not return exactly three directions.');
        }
        const fallbackCount = receipt.variations.filter(
          (variation) => variation.origin === 'deterministic_fallback',
        ).length;
        setToast({
          kind: 'success',
          message:
            request.providerMode === 'deterministic'
              ? 'Three validated private directions are ready to review.'
              : fallbackCount > 0
                ? `Three validated directions are ready; ${fallbackCount} used an honest fallback.`
                : 'Three validated directions are ready to review.',
        });
        void refreshVariationPreferences();
      } catch (error) {
        if (!requestGate.isCurrent(requestToken)) return;
        const message = errorMessage(
          error,
          'Three safe directions could not be generated for this slide.',
        );
        setVariationError(message);
        setToast({ kind: 'error', message });
      } finally {
        if (requestGate.isCurrent(requestToken)) setVariationGenerating(false);
      }
    })();
  };

  const handleAcceptVariation = (variation: SlideVariation) => {
    if (!ownerAccessKey || variationBusy) return;
    const requestedDeckId = workspace.deck.id;
    setVariationError(null);
    setVariationDecisionBusy(true);
    void enqueueEditorWrite(
      requestedDeckId,
      false,
      async ({
        workspace: currentWorkspace,
        ownerAccessKey: currentOwnerAccessKey,
        requestToken,
      }) => {
        const requestGate = editorRequestGateRef.current;
        const currentSlide = currentWorkspace.slides.find(
          (slide) => slide.id === variation.slideId,
        );
        const currentElements = new Map(
          currentWorkspace.elements.map((element) => [element.id, element]),
        );
        const variationIsCurrent =
          variation.deckId === requestedDeckId &&
          variation.status === 'ready' &&
          variation.validation.ok &&
          !variation.validation.issues.some((issue) => issue.severity === 'error') &&
          currentSlide?.version === variation.baseSlideVersion &&
          Object.entries(variation.baseElementVersions).every(
            ([elementId, version]) => currentElements.get(elementId)?.version === version,
          );
        if (!variationIsCurrent) {
          setVariationError(
            'The slide changed after generation. The direction is stale and cannot overwrite it.',
          );
          setToast({ kind: 'error', message: 'This direction is stale.' });
          setVariationDecisionBusy(false);
          return false;
        }
        try {
          const receipt = await acceptVariation({
            deckId: requestedDeckId,
            ownerAccessKey: currentOwnerAccessKey,
            variationId: variation.id,
          });
          if (!requestGate.isCurrent(requestToken)) return false;
          setPreviewedVariation(null);
          setCanvasMode('edit');
          if (receipt.variation.status === 'stale' || receipt.patch?.status === 'stale') {
            if (receipt.workspace) {
              installWorkspace(receipt.workspace, currentOwnerAccessKey);
            }
            setVariationError(
              'The slide changed after generation. The direction was marked stale and no content was overwritten.',
            );
            setToast({
              kind: 'error',
              message: 'This direction is stale; the newer slide was preserved.',
            });
            return false;
          }
          if (receipt.variation.status !== 'accepted') {
            setToast({
              kind: 'error',
              message: `This direction is already ${receipt.variation.status}.`,
            });
            return false;
          }
          if (!receipt.patch) {
            setToast({ kind: 'success', message: 'This direction was already accepted.' });
            return true;
          }
          if (receipt.patch.status !== 'accepted' || !receipt.workspace) {
            throw new Error('Variation accept completed without an authoritative commit receipt.');
          }
          recordSuccessfulCommit(
            authoritativePredecessorVersion(receipt.workspace),
            receipt.workspace.deck.version,
          );
          installWorkspace(receipt.workspace, currentOwnerAccessKey);
          setToast({ kind: 'success', message: 'Direction accepted through a versioned patch.' });
          void refreshVariationPreferences();
          return true;
        } catch (error) {
          if (!requestGate.isCurrent(requestToken)) return false;
          const message = errorMessage(error, 'The direction could not be accepted.');
          setVariationError(message);
          setToast({ kind: 'error', message });
          return false;
        } finally {
          if (requestGate.isCurrent(requestToken)) setVariationDecisionBusy(false);
        }
      },
    );
  };

  const handleRejectVariation = (variation: SlideVariation) => {
    if (!ownerAccessKey || variationBusy) return;
    const requestedDeckId = workspace.deck.id;
    setVariationError(null);
    setVariationDecisionBusy(true);
    void enqueueEditorWrite(
      requestedDeckId,
      false,
      async ({ ownerAccessKey: currentOwnerAccessKey, requestToken }) => {
        const requestGate = editorRequestGateRef.current;
        try {
          await rejectVariation({
            deckId: requestedDeckId,
            ownerAccessKey: currentOwnerAccessKey,
            variationId: variation.id,
            reason: 'user_rejected',
          });
          if (!requestGate.isCurrent(requestToken)) return false;
          setPreviewedVariation((current) => (current?.id === variation.id ? null : current));
          setCanvasMode('edit');
          void refreshVariationPreferences();
          return true;
        } catch (error) {
          if (!requestGate.isCurrent(requestToken)) return false;
          const message = errorMessage(error, 'The direction could not be rejected.');
          setVariationError(message);
          setToast({ kind: 'error', message });
          return false;
        } finally {
          if (requestGate.isCurrent(requestToken)) setVariationDecisionBusy(false);
        }
      },
    );
  };

  const handleClearSignatureProfile = () => {
    if (!ownerAccessKey || tastePackBusy) return;
    const requestedDeckId = workspace.deck.id;
    setTastePackBusy(true);
    setPreviewedSignatureProfile(null);
    void enqueueEditorWrite(
      requestedDeckId,
      false,
      async ({
        workspace: currentWorkspace,
        ownerAccessKey: currentOwnerAccessKey,
        requestToken,
      }) => {
        const requestGate = editorRequestGateRef.current;
        try {
          const cleared = await clearActiveSignatureProfile({
            deckId: requestedDeckId,
            ownerAccessKey: currentOwnerAccessKey,
            baseDeckVersion: currentWorkspace.deck.version,
          });
          if (!requestGate.isCurrent(requestToken)) return false;
          if (cleared) {
            recordSuccessfulCommit(authoritativePredecessorVersion(cleared), cleared.deck.version);
            installWorkspace(cleared, currentOwnerAccessKey);
          }
          setToast({ kind: 'success', message: 'Active on-brand checks cleared.' });
          return true;
        } catch (error) {
          if (!requestGate.isCurrent(requestToken)) return false;
          setToast({
            kind: 'error',
            message: errorMessage(error, 'Active signature could not be cleared.'),
          });
          return false;
        } finally {
          if (requestGate.isCurrent(requestToken)) setTastePackBusy(false);
        }
      },
    );
  };

  const handleRestoreVersion = (version: DeckVersion) => {
    if (!ownerAccessKey) return;
    const requestedDeckId = workspace.deck.id;
    void enqueueEditorWrite(
      requestedDeckId,
      false,
      async ({
        workspace: currentWorkspace,
        ownerAccessKey: currentOwnerAccessKey,
        requestToken,
      }) => {
        const requestGate = editorRequestGateRef.current;
        try {
          const receipt = await restoreVersion({
            deckId: requestedDeckId,
            ownerAccessKey: currentOwnerAccessKey,
            versionId: version.id,
            baseDeckVersion: currentWorkspace.deck.version,
          });
          if (!requestGate.isCurrent(requestToken)) return false;
          if (receipt.patch.status !== 'accepted') {
            if (receipt.workspace) {
              installWorkspace(receipt.workspace, currentOwnerAccessKey);
            }
            setToast({
              kind: 'error',
              message:
                'This deck changed before the restore could apply. No version history was changed.',
            });
            return false;
          }
          if (!receipt.workspace) {
            throw new Error(
              'Version restore completed without an authoritative workspace receipt.',
            );
          }
          localCommitVersionsRef.current.add(receipt.workspace.deck.version);
          installWorkspace(receipt.workspace, currentOwnerAccessKey);
          undoStackRef.current = [];
          redoStackRef.current = [];
          setUndoStack([]);
          setRedoStack([]);
          setCanvasResetKey((value) => value + 1);
          return true;
        } catch (error) {
          if (!requestGate.isCurrent(requestToken)) return false;
          setToast({
            kind: 'error',
            message: errorMessage(error, 'Version restore failed.'),
          });
          return false;
        }
      },
    );
  };

  const changeElementZOrder = (elementIds: readonly string[], action: LayerZOrderAction) => {
    const targets = elementIds
      .map((id) => workspace.elements.find((element) => element.id === id))
      .filter((element): element is SlideElement => element !== undefined);
    if (targets.some((element) => element.groupId)) {
      setToast({ kind: 'error', message: 'Ungroup grouped layers before changing their z-order.' });
      return;
    }
    const operations = reorderElementOperations(activeSlide, elementIds, action);
    void applyOperations(
      operations,
      elementScope(workspace.deck.id, targets),
      layerZOrderSummary(action, operations.length),
    );
  };
  const commands: StudioCommand[] = [
    {
      id: 'ask-ai',
      label: 'Ask AI',
      detail: 'Open a scoped edit composer',
      group: 'Create',
      icon: 'ai',
      run: () => openInspector('ai'),
    },
    {
      id: 'design',
      label: 'Open design inspector',
      detail: 'Edit position, type, and appearance',
      group: 'Navigate',
      icon: 'design',
      run: () => openInspector('design'),
    },
    {
      id: 'comments',
      label: 'Review comments',
      detail: 'Open anchored review threads',
      group: 'Navigate',
      icon: 'comments',
      run: () => openInspector('comments'),
    },
    {
      id: 'present',
      label: 'Present deck',
      detail: 'Enter presenter mode',
      group: 'Share',
      icon: 'present',
      run: beginPresentation,
    },
    {
      id: 'new',
      label: 'New deck',
      detail: 'Start from the prompt-first landing composer',
      group: 'Create',
      icon: 'new',
      run: () => window.location.assign('/'),
    },
  ];

  return (
    <main
      className="nodeslide-studio"
      data-testid="nodeslide-studio"
      data-app-id="nodeslide"
      data-agent-surface="deck-editor"
      data-mcp-compat="webmcp chrome-devtools-mcp"
      data-screen-id="nodeslide:editor"
      data-screen-title="NodeSlide editor"
      data-screen-path="/?domain=nodeslide"
      data-screen-state={agentBusy ? 'agent-running' : 'ready'}
      data-main-content="true"
      data-ns-theme={studioTheme}
      style={
        {
          '--ns-nav-width': navigatorCollapsed ? '0px' : '300px',
          '--ns-inspector-width': inspectorCollapsed ? '48px' : `${inspectorWidth}px`,
        } as React.CSSProperties
      }
    >
      <StudioToolbar
        title={workspace.deck.title}
        version={workspace.deck.version}
        presence={workspace.presence}
        canUndo={canUndo}
        canRedo={redoStack.length > 0}
        inspectorCollapsed={inspectorCollapsed}
        themeMode={studioTheme}
        navigatorCollapsed={navigatorCollapsed}
        onTitleChange={(title) =>
          void applyOperations(
            [{ op: 'update_deck', properties: { title } }],
            { kind: 'deck', deckId: workspace.deck.id, operationMode: 'unrestricted' },
            `Renamed deck to ${title}`,
          )
        }
        onOpenProjects={() => setProjectsOpen(true)}
        onUndo={() => void restoreHistory('undo')}
        onRedo={() => void restoreHistory('redo')}
        onShare={() => setShareOpen(true)}
        onPresent={beginPresentation}
        onExportHtml={() => exportDeck('html')}
        onExportPptx={() => exportDeck('pptx')}
        onOpenCommandPalette={() => setCommandOpen(true)}
        onToggleInspector={() => setInspectorCollapsed((value) => !value)}
        onThemeModeChange={(mode) => {
          setStudioTheme(mode);
          writeStudioPreference('theme', mode);
        }}
        onToggleNavigator={() => setNavigatorCollapsed((value) => !value)}
        onResetView={() => {
          setNavigatorTab('slides');
          setCanvasMode('edit');
          setActiveInspectorTab('ai');
          setSelectedElementIds([]);
          setPreviewedPatchId(null);
          setPreviewedVariation(null);
          setPreviewedSignatureProfile(null);
          setZoom(65);
          setToast({ kind: 'success', message: 'Editor view reset.' });
        }}
      />

      <div className="ns-studio-grid">
        <SlideNavigator
          slides={orderedSlides}
          elements={workspace.elements}
          theme={workspace.deck.theme}
          activeSlideId={activeSlide.id}
          collapsed={navigatorCollapsed}
          activeTab={navigatorTab}
          comments={workspace.comments}
          patches={workspace.patches}
          sources={workspace.sources}
          validations={workspace.validations}
          collapsedSections={collapsedNavigatorSections}
          propagationSlideIds={affectedSlideIds}
          selectedElementIds={selectedElementIds}
          canAddSlide
          canDeleteSlide={orderedSlides.length > 1}
          onSelectSlide={(slideId) => selectSlide(slideId, setActiveSlideId, setSelectedElementIds)}
          onToggleCollapsed={() => setNavigatorCollapsed((value) => !value)}
          onTabChange={setNavigatorTab}
          onToggleSection={(section) =>
            setCollapsedNavigatorSections((current) =>
              current.includes(section)
                ? current.filter((candidate) => candidate !== section)
                : [...current, section],
            )
          }
          onSelectedElementIdsChange={selectElements}
          onRenameSlide={(slideId, currentTitle) => {
            const title = window.prompt('Rename slide', currentTitle)?.trim();
            if (!title || title === currentTitle) return;
            void applyOperations(
              [{ op: 'update_slide', slideId, properties: { title } }],
              {
                kind: 'slide',
                deckId: workspace.deck.id,
                slideIds: [slideId],
                operationMode: 'unrestricted',
              },
              `Renamed slide to ${title}`,
            );
          }}
          onAddSlide={() => {
            const added = createBlankSlide(workspace, activeSlideIndex + 1);
            void applyOperations(
              [
                {
                  op: 'add_slide',
                  slide: added.slide,
                  elements: added.elements,
                  index: added.index,
                },
              ],
              { kind: 'deck', deckId: workspace.deck.id, operationMode: 'unrestricted' },
              `Added slide ${added.index + 1}`,
            ).then((accepted) => {
              if (accepted) selectSlide(added.slide.id, setActiveSlideId, setSelectedElementIds);
            });
          }}
          onDuplicateSlide={(slideId) => {
            const added = duplicateSlide(workspace, slideId);
            if (!added) return;
            void applyOperations(
              [
                {
                  op: 'add_slide',
                  slide: added.slide,
                  elements: added.elements,
                  index: added.index,
                },
              ],
              { kind: 'deck', deckId: workspace.deck.id, operationMode: 'unrestricted' },
              `Duplicated ${added.slide.title}`,
            ).then((accepted) => {
              if (accepted) selectSlide(added.slide.id, setActiveSlideId, setSelectedElementIds);
            });
          }}
          onDeleteSlide={(slideId) => {
            const index = orderedSlides.findIndex((slide) => slide.id === slideId);
            const fallback = orderedSlides[index + 1] ?? orderedSlides[index - 1];
            void applyOperations(
              [{ op: 'remove_slide', slideId }],
              { kind: 'deck', deckId: workspace.deck.id, operationMode: 'unrestricted' },
              `Deleted slide ${index + 1}`,
            ).then((accepted) => {
              if (accepted && fallback)
                selectSlide(fallback.id, setActiveSlideId, setSelectedElementIds);
            });
          }}
          onReorderSlide={(slideId, index) =>
            void applyOperations(
              [{ op: 'reorder_slide', slideId, index }],
              {
                kind: 'slide',
                deckId: workspace.deck.id,
                slideIds: [slideId],
                operationMode: 'layout',
              },
              `Moved slide to position ${index + 1}`,
            )
          }
          onToggleElementVisibility={(elementId, visible) => {
            const element = workspace.elements.find((candidate) => candidate.id === elementId);
            if (!element) return;
            void applyOperations(
              [{ op: 'set_visibility_v1', slideId: element.slideId, elementId, visible }],
              elementScope(workspace.deck.id, [element]),
              `${visible ? 'Showed' : 'Hid'} ${element.name}`,
            );
          }}
          onGroupElements={(elementIds) => {
            const targets = elementIds
              .map((id) => workspace.elements.find((element) => element.id === id))
              .filter((element): element is SlideElement => element !== undefined);
            if (
              targets.length < 2 ||
              targets.some((element) => element.slideId !== activeSlide.id)
            ) {
              return;
            }
            void applyOperations(
              [
                {
                  op: 'group_elements_v1',
                  slideId: activeSlide.id,
                  elementIds: targets.map((element) => element.id),
                  groupId: uniqueClientId('group'),
                },
              ],
              elementScope(workspace.deck.id, targets),
              `Grouped ${targets.length} layers`,
            );
          }}
          onUngroupElements={(elementIds) => {
            const groupIds = new Set(
              elementIds.flatMap((id) => {
                const groupId = workspace.elements.find((element) => element.id === id)?.groupId;
                return groupId ? [groupId] : [];
              }),
            );
            const operations: PatchOperation[] = [];
            const members: SlideElement[] = [];
            for (const groupId of groupIds) {
              const groupMembers = workspace.elements.filter(
                (element) => element.slideId === activeSlide.id && element.groupId === groupId,
              );
              members.push(...groupMembers);
              operations.push({
                op: 'ungroup_elements_v1',
                slideId: activeSlide.id,
                elementIds: groupMembers.map((element) => element.id),
                groupId,
              });
            }
            void applyOperations(
              operations,
              elementScope(workspace.deck.id, members),
              `Ungrouped ${groupIds.size} layer group${groupIds.size === 1 ? '' : 's'}`,
            );
          }}
          onChangeElementZOrder={changeElementZOrder}
        />

        <EditorCanvasModes
          mode={canvasMode}
          onModeChange={setCanvasMode}
          compareMode={compareMode}
          onCompareModeChange={setCompareMode}
          slides={orderedSlides}
          elements={workspace.elements}
          theme={workspace.deck.theme}
          activeSlideId={activeSlide.id}
          onSelectSlide={(slideId) => selectSlide(slideId, setActiveSlideId, setSelectedElementIds)}
          affectedSlideIds={affectedSlideIds}
          validationStatus={editorValidationStatus(workspace.validations[0])}
          {...(navigatorTab === 'outline'
            ? {
                storyArcBoard: (
                  <StoryArcOverview
                    deck={workspace.deck}
                    slides={orderedSlides}
                    activeSlideId={activeSlide.id}
                    onOpenSlide={(slideId) => {
                      selectSlide(slideId, setActiveSlideId, setSelectedElementIds);
                      setNavigatorTab('slides');
                      setCanvasMode('edit');
                    }}
                  />
                ),
              }
            : {})}
          narrativeBanner={
            activeSlide.notes ? (
              <>
                <strong>Narrative</strong>
                <span>{activeSlide.notes}</span>
              </>
            ) : undefined
          }
          candidateSlide={compareCandidateSlide ?? null}
          candidateElements={compareCandidateElements}
          {...(compareCandidateLabel ? { candidateLabel: compareCandidateLabel } : {})}
          compareOperations={compareOperations}
          candidateReceipt={compareCandidateReceipt}
          sliderPosition={compareSliderPosition}
          onSliderPositionChange={setCompareSliderPosition}
          overlayOpacity={compareOverlayOpacity}
          onOverlayOpacityChange={setCompareOverlayOpacity}
          blinkPaused={compareBlinkPaused}
          onBlinkPausedChange={setCompareBlinkPaused}
          {...(previewedPatch
            ? {
                onAcceptCandidate: () => handleAcceptPatch(previewedPatch),
                onDeclineCandidate: () => handleRejectPatch(previewedPatch),
              }
            : {})}
          editCanvas={
            <SlideCanvas
              key={`${activeSlide.id}:original:${canvasResetKey}`}
              slide={activeSlide}
              slideIndex={activeSlideIndex}
              slideCount={orderedSlides.length}
              deckVersion={workspace.deck.version}
              elements={slideElements}
              comments={workspace.comments}
              presence={workspace.presence.filter((person) => person.sessionId !== clientSessionId)}
              theme={workspace.deck.theme}
              selectedElementIds={selectedElementIds}
              readOnly={false}
              zoom={zoom}
              onZoomChange={setZoom}
              onSelectionChange={selectElements}
              onOpenAi={() => openInspector('ai')}
              onOpenComments={() => openInspector('comments')}
              onDuplicateElements={(ids) => {
                const sourceElements = ids
                  .map((id) => workspace.elements.find((element) => element.id === id))
                  .filter(
                    (element): element is SlideElement => element !== undefined && !element.locked,
                  );
                const copies = sourceElements.map((element, index) =>
                  duplicateElement(element, index),
                );
                const operations: PatchOperation[] = copies.map((element) => ({
                  op: 'add_element',
                  slideId: element.slideId,
                  element,
                }));
                const scope: PatchScope = {
                  kind: 'elements',
                  deckId: workspace.deck.id,
                  slideIds: [...new Set(copies.map((element) => element.slideId))],
                  elementIds: copies.map((element) => element.id),
                  operationMode: 'unrestricted',
                };
                void applyOperations(
                  operations,
                  scope,
                  `Duplicated ${copies.length} element${copies.length === 1 ? '' : 's'}`,
                ).then((accepted) => {
                  if (accepted) setSelectedElementIds(copies.map((element) => element.id));
                });
              }}
              onDeleteElements={(ids) => {
                const targets = ids
                  .map((id) => workspace.elements.find((element) => element.id === id))
                  .filter(
                    (element): element is SlideElement => element !== undefined && !element.locked,
                  );
                void applyOperations(
                  targets.map((element) => ({
                    op: 'remove_element',
                    slideId: element.slideId,
                    elementId: element.id,
                  })),
                  elementScope(workspace.deck.id, targets),
                  `Deleted ${targets.length} element${targets.length === 1 ? '' : 's'}`,
                );
                setSelectedElementIds([]);
              }}
              onApplyLayoutPatch={(operations, elementIds, summary) =>
                void applyOperations(
                  operations,
                  {
                    kind: 'elements',
                    deckId: workspace.deck.id,
                    slideIds: [activeSlide.id],
                    elementIds,
                    operationMode: 'layout',
                  },
                  summary,
                )
              }
              onReplaceText={(elementId, text, baseElementVersion) => {
                const element = workspace.elements.find((candidate) => candidate.id === elementId);
                if (!element || element.locked) return;
                void applyOperations(
                  [{ op: 'replace_text', slideId: element.slideId, elementId, text }],
                  elementScope(workspace.deck.id, [element]),
                  `Updated ${element.name}`,
                  undefined,
                  { [elementId]: baseElementVersion },
                );
              }}
              onReorderElements={(elementIds, direction) =>
                changeElementZOrder(elementIds, direction)
              }
              onCursorChange={updatePresenceCursor}
              onPreviousSlide={() => {
                const previous = orderedSlides[activeSlideIndex - 1];
                if (previous) selectSlide(previous.id, setActiveSlideId, setSelectedElementIds);
              }}
              onNextSlide={() => {
                const next = orderedSlides[activeSlideIndex + 1];
                if (next) selectSlide(next.id, setActiveSlideId, setSelectedElementIds);
              }}
            />
          }
        />

        <InspectorPanel<NodeSlideEditorCommandId>
          workspace={workspace}
          slide={activeSlide}
          selectedElements={selectedElements}
          activeTab={activeInspectorTab}
          collapsed={inspectorCollapsed}
          width={inspectorWidth}
          agentBusy={agentBusy}
          variations={activeVariations}
          variationsLoading={
            Boolean(activeDeckId && ownerAccessKey && activeSlideId) && variationRows === undefined
          }
          variationBusy={variationBusy}
          variationGenerating={variationGenerating}
          variationError={variationError}
          previewedVariationId={previewMatchesActiveSlide ? (previewedVariation?.id ?? null) : null}
          aiReferences={aiReferences}
          aiCommands={aiCommands}
          aiAgentActivity={aiAgentActivity}
          agentRuns={agentRuns ?? []}
          agentMessages={agentMessages ?? []}
          memories={agentMemories ?? []}
          memoriesLoading={Boolean(activeDeckId && ownerAccessKey) && agentMemories === undefined}
          {...(selectedTelemetryRunId ? { agentTelemetryRunId: selectedTelemetryRunId } : {})}
          agentTelemetryLoadingMore={telemetryLoadingRunId === selectedTelemetryRunId}
          {...(telemetryLoadError ? { agentTelemetryLoadError: telemetryLoadError } : {})}
          onSelectAgentRun={(runId) => {
            setTraceTelemetryRunId(runId);
            setTelemetryLoadError(null);
          }}
          onLoadMoreAgentTelemetry={loadOlderAgentTelemetry}
          {...(agentTelemetry ? { agentTelemetry } : {})}
          aiCommentContext={aiCommentContext}
          previewedPatchId={previewedPatchId}
          activeTastePackId={activeTastePackId}
          activeProfileId={workspace.deck.activeSignatureProfileId ?? null}
          previewProfileId={previewedSignatureProfile?.id ?? null}
          signatureProfiles={signatureProfiles}
          tasteProfile={tasteProfile ?? null}
          tasteProfileLoading={tasteProfile === undefined}
          tastePackBusy={tastePackBusy}
          onTabChange={(tab) => {
            if (tab !== 'ai') setPreviewedVariation(null);
            if (tab !== 'design') setPreviewedSignatureProfile(null);
            setActiveInspectorTab(tab);
          }}
          onToggleCollapsed={() => setInspectorCollapsed((value) => !value)}
          onWidthChange={setInspectorWidth}
          onProposeEdit={handleProposeEdit}
          onAttachAiDataFile={attachAiDataFile}
          onCreateAiMemory={async (category, content) => {
            if (!activeDeckId || !ownerAccessKey) throw new Error('Open an owned deck first.');
            await createAgentMemory({ deckId: activeDeckId, ownerAccessKey, category, content });
          }}
          onUpdateAiMemory={async (memoryId, update) => {
            if (!activeDeckId || !ownerAccessKey) throw new Error('Open an owned deck first.');
            await updateAgentMemory({
              deckId: activeDeckId,
              ownerAccessKey,
              memoryId,
              ...update,
            });
          }}
          onDeleteAiMemory={async (memoryId) => {
            if (!activeDeckId || !ownerAccessKey) throw new Error('Open an owned deck first.');
            await removeAgentMemory({ deckId: activeDeckId, ownerAccessKey, memoryId });
          }}
          onDeleteAiDataSource={deleteAiDataSource}
          onCancelAiRun={(runId) => void cancelAiRun(runId)}
          onAcceptPatch={handleAcceptPatch}
          onRejectPatch={handleRejectPatch}
          onPreviewPatch={previewPatch}
          onClearAiCommentContext={() => setAiCommentContext(null)}
          onGenerateVariations={handleGenerateVariations}
          onPreviewVariation={(variation) => {
            if (
              variation &&
              (variation.status !== 'ready' ||
                !variation.validation.ok ||
                variation.validation.issues.some((issue) => issue.severity === 'error') ||
                variation.slideId !== activeSlide.id ||
                variation.baseSlideVersion !== activeSlide.version)
            ) {
              setVariationError(
                'This direction is based on an older slide and can no longer be previewed safely.',
              );
              return;
            }
            if (variation) {
              setSelectedElementIds([]);
              setPreviewedPatchId(null);
              setPreviewedSignatureProfile(null);
              setCanvasMode('compare');
              if (shouldRevealCandidateCanvas(window.innerWidth)) setInspectorCollapsed(true);
            } else {
              setCanvasMode('edit');
            }
            setPreviewedVariation(variation);
          }}
          onAcceptVariation={handleAcceptVariation}
          onRejectVariation={handleRejectVariation}
          onApplyTastePack={(packId) => {
            applySignatureProfile(getNodeSlideTastePack(packId));
          }}
          onApplySignatureProfile={applySignatureProfile}
          onPreviewSignatureProfile={(profile) => {
            setPreviewedVariation(null);
            setPreviewedPatchId(null);
            setSelectedElementIds([]);
            setPreviewedSignatureProfile(profile);
            setCanvasMode(profile ? 'compare' : 'edit');
            if (profile && shouldRevealCandidateCanvas(window.innerWidth)) {
              setInspectorCollapsed(true);
            }
          }}
          onUploadSignatureSource={uploadSignatureSource}
          onClearTastePack={handleClearSignatureProfile}
          onEvictTasteSignal={(signalId) => {
            if (!ownerAccessKey) return;
            void evictTasteSignal({
              deckId: workspace.deck.id,
              ownerAccessKey,
              signalId,
            }).catch((error: unknown) =>
              setToast({
                kind: 'error',
                message: errorMessage(error, 'Taste signal could not be removed.'),
              }),
            );
          }}
          onOpenPreferenceEvidence={() => {
            setActiveInspectorTab('trace');
          }}
          onApplyDesignPatch={(operations, summary) =>
            void applyOperations(
              operations,
              scopeForOperations(workspace, operations, 'unrestricted'),
              summary,
            )
          }
          onAddComment={(text, anchor) =>
            ownerAccessKey
              ? void addComment({
                  deckId: workspace.deck.id,
                  ownerAccessKey,
                  authorId: clientSessionId,
                  authorName: 'You',
                  text,
                  anchor,
                }).catch((error: unknown) =>
                  setToast({
                    kind: 'error',
                    message: errorMessage(error, 'Comment was not posted.'),
                  }),
                )
              : undefined
          }
          onReply={(parentId, text) => {
            const parent = workspace.comments.find((comment) => comment.id === parentId);
            if (parent && ownerAccessKey)
              void replyComment({
                deckId: workspace.deck.id,
                ownerAccessKey,
                parentId,
                authorId: clientSessionId,
                authorName: 'You',
                text,
              }).catch((error: unknown) =>
                setToast({ kind: 'error', message: errorMessage(error, 'Reply was not posted.') }),
              );
          }}
          onSetCommentStatus={(commentId, status) =>
            ownerAccessKey
              ? void (
                  status === 'resolved'
                    ? resolveComment({ deckId: workspace.deck.id, ownerAccessKey, commentId })
                    : reopenComment({ deckId: workspace.deck.id, ownerAccessKey, commentId })
                ).catch((error: unknown) =>
                  setToast({
                    kind: 'error',
                    message: errorMessage(error, 'Comment status was not updated.'),
                  }),
                )
              : undefined
          }
          onSendCommentToAi={(comment) => {
            setAiCommentContext({
              id: comment.id,
              kind: 'comment',
              label: `Comment by ${comment.authorName}`,
              text: comment.text,
              anchor: comment.anchor,
            });
            setActiveInspectorTab('ai');
            setInspectorCollapsed(false);
          }}
          onRestoreVersion={handleRestoreVersion}
        />
      </div>

      {projectsDialog}
      <CommandPalette
        open={commandOpen}
        commands={commands}
        onClose={() => setCommandOpen(false)}
      />
      <OwnerCapabilityRecoveryDialog
        open={Boolean(ownerRecovery) && !projectsOpen}
        recovery={ownerRecovery}
        onClose={() => setOwnerRecovery(null)}
      />
      <PublicationDialog
        open={shareOpen}
        publication={workspace.publication}
        shareUrl={
          workspace.publication?.status === 'active'
            ? publishedDeckUrl(workspace.publication.shareSlug)
            : null
        }
        currentDeckVersion={workspace.deck.version}
        busy={shareBusy}
        onClose={() => setShareOpen(false)}
        onCopy={() => {
          const publication = workspace.publication;
          if (!publication || publication.status !== 'active') return;
          const requestGate = editorRequestGateRef.current;
          const requestToken = requestGate.begin('publication', workspace.deck.id);
          setShareBusy(true);
          void shareDeck(publication.shareSlug)
            .then(() => {
              if (requestGate.isCurrent(requestToken)) {
                setToast({ kind: 'success', message: 'Frozen view-only link copied.' });
              }
            })
            .catch((error: unknown) => {
              if (!requestGate.isCurrent(requestToken)) return;
              setToast({
                kind: 'error',
                message: errorMessage(error, 'Share link could not be copied.'),
              });
            })
            .finally(() => {
              if (requestGate.isCurrent(requestToken)) setShareBusy(false);
            });
        }}
        onPublish={() => {
          if (!ownerAccessKey) return;
          const requestedDeckId = workspace.deck.id;
          const requestedOwnerAccessKey = ownerAccessKey;
          const requestGate = editorRequestGateRef.current;
          const requestToken = requestGate.begin('publication', requestedDeckId);
          setShareBusy(true);
          void publishDeck({
            deckId: requestedDeckId,
            ownerAccessKey: requestedOwnerAccessKey,
          })
            .then(async (published) => {
              if (!requestGate.isCurrent(requestToken)) return;
              try {
                await shareDeck(published.publication.shareSlug);
                if (!requestGate.isCurrent(requestToken)) return;
                setToast({
                  kind: 'success',
                  message: `Published immutable version ${published.publication.deckVersion}; link copied.`,
                });
              } catch {
                if (!requestGate.isCurrent(requestToken)) return;
                setToast({
                  kind: 'error',
                  message: `Published immutable version ${published.publication.deckVersion}, but this browser could not copy the link. Use “Copy existing link” to retry.`,
                });
              }
            })
            .catch((error: unknown) => {
              if (!requestGate.isCurrent(requestToken)) return;
              setToast({
                kind: 'error',
                message: errorMessage(error, 'The current deck could not be published.'),
              });
            })
            .finally(() => {
              if (requestGate.isCurrent(requestToken)) setShareBusy(false);
            });
        }}
        onRevoke={() => {
          if (!ownerAccessKey) return;
          const requestedDeckId = workspace.deck.id;
          const requestedOwnerAccessKey = ownerAccessKey;
          const requestGate = editorRequestGateRef.current;
          const requestToken = requestGate.begin('publication', requestedDeckId);
          setShareBusy(true);
          void revokePublication({
            deckId: requestedDeckId,
            ownerAccessKey: requestedOwnerAccessKey,
          })
            .then(() => {
              if (requestGate.isCurrent(requestToken)) {
                setToast({ kind: 'success', message: 'The view-only link was revoked.' });
              }
            })
            .catch((error: unknown) => {
              if (!requestGate.isCurrent(requestToken)) return;
              setToast({
                kind: 'error',
                message: errorMessage(error, 'The share link could not be revoked.'),
              });
            })
            .finally(() => {
              if (requestGate.isCurrent(requestToken)) setShareBusy(false);
            });
        }}
      />
      {toast ? <Toast toast={toast} onClose={() => setToast(null)} /> : null}
    </main>
  );
}

function variationDirectionLabel(variation: SlideVariation): string {
  const label = `${variation.axes.contentAngle.replace('_', ' ')} · ${variation.axes.layoutArchetype}`;
  return label.replace(/\b\w/g, (character) => character.toUpperCase());
}

function buildAiReferences(
  workspace: NodeSlideWorkspace,
  activeSlide: Slide,
  selectedElements: readonly SlideElement[],
): AiReadReference[] {
  const references = new Map<string, AiReadReference>();
  const add = (reference: AiReadReference) =>
    references.set(`${reference.kind}:${reference.id}`, reference);
  add({ id: workspace.deck.id, kind: 'deck', label: workspace.deck.title });
  add({ id: activeSlide.id, kind: 'slide', label: `Current slide: ${activeSlide.title}` });
  for (const element of selectedElements) {
    add({ id: element.id, kind: 'element', label: `Selected: ${element.name}` });
  }
  for (const slide of workspace.slides) {
    add({ id: slide.id, kind: 'slide', label: `Slide: ${slide.title}` });
  }
  for (const element of workspace.elements.filter(
    (element) => element.slideId === activeSlide.id,
  )) {
    add({ id: element.id, kind: 'element', label: `Layer: ${element.name}` });
  }
  for (const source of workspace.sources) {
    add({ id: source.id, kind: 'source', label: `Source: ${source.title}` });
  }
  for (const comment of workspace.comments.filter((comment) => comment.status === 'open')) {
    add({ id: comment.id, kind: 'comment', label: `Comment by ${comment.authorName}` });
  }
  return [...references.values()].slice(0, 96);
}

function fallbackEditorCommands(): NodeSlideEditorCapabilityRegistry['commands'] {
  return [
    { id: 'edit', authority: 'nodeslideAgent.proposeEdit', proposalKind: 'edit' },
    { id: 'variations', authority: 'nodeslideVariations.generate', proposalKind: 'edit' },
    {
      id: 'propagate',
      authority: 'nodeslide.proposePropagation',
      proposalKind: 'propagation',
    },
  ];
}

function editorCommandLabel(command: NodeSlideEditorCommandId): string {
  if (command === 'variations') return 'Generate three directions';
  if (command === 'propagate') return 'Propagate accepted design behavior';
  return 'Create a scoped edit proposal';
}

function editorCommandDescription(command: NodeSlideEditorCommandId): string {
  if (command === 'variations') return 'Use the bounded three-direction variation authority.';
  if (command === 'propagate')
    return 'Create a separate proposal for semantic matches across slides.';
  return 'Plan an edit inside the selected write scope.';
}

function latestPropagatablePatch(patches: readonly DeckPatch[]): DeckPatch | undefined {
  return [...patches]
    .filter(
      (patch) =>
        patch.status === 'accepted' &&
        patch.proposalKind !== 'propagation' &&
        patch.operations.some(
          (operation) => operation.op === 'update_style' || operation.op === 'set_visibility_v1',
        ),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
}

function reorderElementOperations(
  slide: Slide,
  elementIds: readonly string[],
  action: LayerZOrderAction,
): PatchOperation[] {
  const selected = new Set(elementIds.filter((id) => slide.elementOrder.includes(id)));
  const current = [...slide.elementOrder];
  const operations: PatchOperation[] = [];
  const move = (elementId: string, index: number) => {
    const from = current.indexOf(elementId);
    if (from < 0 || from === index) return;
    current.splice(from, 1);
    const boundedIndex = Math.max(0, Math.min(index, current.length));
    current.splice(boundedIndex, 0, elementId);
    operations.push({
      op: 'reorder_element_v1',
      slideId: slide.id,
      elementId,
      index: boundedIndex,
    });
  };

  if (action === 'front') {
    for (const elementId of slide.elementOrder.filter((id) => selected.has(id))) {
      move(elementId, current.length - 1);
    }
  } else if (action === 'back') {
    for (const elementId of slide.elementOrder.filter((id) => selected.has(id)).reverse()) {
      move(elementId, 0);
    }
  } else if (action === 'forward') {
    for (const elementId of [...slide.elementOrder].reverse()) {
      if (!selected.has(elementId)) continue;
      const index = current.indexOf(elementId);
      if (index >= 0 && index < current.length - 1 && !selected.has(current[index + 1] ?? '')) {
        move(elementId, index + 1);
      }
    }
  } else {
    for (const elementId of slide.elementOrder) {
      if (!selected.has(elementId)) continue;
      const index = current.indexOf(elementId);
      if (index > 0 && !selected.has(current[index - 1] ?? '')) move(elementId, index - 1);
    }
  }
  return operations;
}

function layerZOrderSummary(action: LayerZOrderAction, count: number): string {
  const verb =
    action === 'front'
      ? 'Brought'
      : action === 'forward'
        ? 'Moved'
        : action === 'backward'
          ? 'Moved'
          : 'Sent';
  const destination =
    action === 'front'
      ? 'to front'
      : action === 'forward'
        ? 'forward'
        : action === 'backward'
          ? 'backward'
          : 'to back';
  return `${verb} ${count} layer${count === 1 ? '' : 's'} ${destination}`;
}

function clocksForScope(
  workspace: NodeSlideWorkspace,
  scope: PatchScope,
  operations: readonly PatchOperation[],
) {
  const slideIds = new Set<string>();
  const elementIds = new Set<string>();
  if (operations.length === 0) {
    if (scope.kind === 'deck') {
      for (const slide of workspace.slides) slideIds.add(slide.id);
      for (const element of workspace.elements) elementIds.add(element.id);
    } else {
      for (const id of scope.slideIds) slideIds.add(id);
      if ('elementIds' in scope) {
        for (const id of scope.elementIds) elementIds.add(id);
      } else {
        for (const element of workspace.elements) {
          if (slideIds.has(element.slideId)) elementIds.add(element.id);
        }
      }
    }
  } else {
    for (const operation of operations) {
      if (operation.op === 'update_deck' || operation.op === 'add_slide') continue;
      slideIds.add(operation.slideId);
      if (operation.op === 'remove_slide') {
        for (const element of workspace.elements) {
          if (element.slideId === operation.slideId) elementIds.add(element.id);
        }
      } else if (operation.op !== 'add_element') {
        for (const elementId of operationElementIds(operation)) elementIds.add(elementId);
      }
    }
  }
  return {
    baseSlideVersions: Object.fromEntries(
      workspace.slides
        .filter((slide) => slideIds.has(slide.id))
        .map((slide) => [slide.id, slide.version]),
    ),
    baseElementVersions: Object.fromEntries(
      workspace.elements
        .filter((element) => elementIds.has(element.id))
        .map((element) => [element.id, element.version]),
    ),
  };
}

function parseSignatureProfileRows(rows: readonly string[]): SignatureProfile[] {
  const profiles: SignatureProfile[] = [];
  for (const row of rows) {
    if (typeof row !== 'string' || row.length === 0 || row.length > 1_000_000) continue;
    try {
      const candidate = JSON.parse(row) as Partial<SignatureProfile> | null;
      if (
        candidate &&
        typeof candidate === 'object' &&
        typeof candidate.id === 'string' &&
        typeof candidate.name === 'string' &&
        candidate.source &&
        candidate.tokens
      ) {
        profiles.push(candidate as SignatureProfile);
      }
    } catch {
      // Server rows are validated before storage; a corrupt row fails closed in the UI.
    }
  }
  return profiles;
}

function scopeForOperations(
  workspace: NodeSlideWorkspace,
  operations: readonly PatchOperation[],
  operationMode: 'unrestricted' | 'layout',
): PatchScope {
  if (
    operations.some(
      (operation) =>
        operation.op === 'add_slide' ||
        operation.op === 'remove_slide' ||
        operation.op === 'update_deck',
    )
  ) {
    return { kind: 'deck', deckId: workspace.deck.id, operationMode: 'unrestricted' };
  }
  const slideIds = [
    ...new Set(
      operations.flatMap((operation) => ('slideId' in operation ? [operation.slideId] : [])),
    ),
  ];
  const elementIds = [
    ...new Set(
      operations.flatMap((operation) => {
        return operationElementIds(operation);
      }),
    ),
  ];
  return elementIds.length > 0
    ? { kind: 'elements', deckId: workspace.deck.id, slideIds, elementIds, operationMode }
    : { kind: 'slide', deckId: workspace.deck.id, slideIds, operationMode };
}

function elementScope(deckId: string, elements: readonly SlideElement[]): PatchScope {
  return {
    kind: 'elements',
    deckId,
    slideIds: [...new Set(elements.map((element) => element.slideId))],
    elementIds: elements.map((element) => element.id),
    operationMode: 'unrestricted',
  };
}

function duplicateElement(element: SlideElement, index: number): SlideElement {
  const suffix = `${Date.now().toString(36)}-${index}`;
  return {
    ...structuredClone(element),
    id: `${element.id}-copy-${suffix}`,
    name: `${element.name} copy`,
    bbox: {
      ...element.bbox,
      x: Math.min(1 - element.bbox.width, element.bbox.x + 0.018),
      y: Math.min(1 - element.bbox.height, element.bbox.y + 0.024),
    },
    version: 1,
  };
}

function pasteElement(element: SlideElement, slideId: string, index: number): SlideElement {
  const copy = duplicateElement(element, index);
  return { ...copy, slideId };
}

function createBlankSlide(
  workspace: NodeSlideWorkspace,
  requestedIndex: number,
): { slide: Slide; elements: SlideElement[]; index: number } {
  const index = Math.max(0, Math.min(requestedIndex, workspace.deck.slideOrder.length));
  const slideId = uniqueClientId('slide');
  const titleId = uniqueClientId('element-title');
  const bodyId = uniqueClientId('element-body');
  const capabilities: SlideElement['exportCapabilities'] = [
    'web_native',
    'pptx_editable',
    'google_importable',
  ];
  const elements: SlideElement[] = [
    {
      id: titleId,
      slideId,
      name: 'Slide title',
      kind: 'text',
      role: 'headline',
      bbox: { x: 0.08, y: 0.1, width: 0.84, height: 0.16 },
      rotation: 0,
      content: 'Untitled slide',
      style: {
        color: workspace.deck.theme.colors.ink,
        fontFamily: workspace.deck.theme.typography.display,
        fontSize: 40,
        fontWeight: 700,
        lineHeight: 1.08,
      },
      sourceIds: [],
      locked: false,
      exportCapabilities: [...capabilities],
      version: 1,
    },
    {
      id: bodyId,
      slideId,
      name: 'Body copy',
      kind: 'text',
      role: 'body',
      bbox: { x: 0.08, y: 0.33, width: 0.72, height: 0.3 },
      rotation: 0,
      content: 'Add the point this slide needs to make.',
      style: {
        color: workspace.deck.theme.colors.muted,
        fontFamily: workspace.deck.theme.typography.body,
        fontSize: 24,
        fontWeight: 450,
        lineHeight: 1.35,
      },
      sourceIds: [],
      locked: false,
      exportCapabilities: [...capabilities],
      version: 1,
    },
  ];
  return {
    index,
    slide: {
      id: slideId,
      deckId: workspace.deck.id,
      title: 'Untitled slide',
      section: 'Deck',
      notes: '',
      background: workspace.deck.theme.colors.canvas,
      elementOrder: elements.map((element) => element.id),
      version: 1,
    },
    elements,
  };
}

function duplicateSlide(
  workspace: NodeSlideWorkspace,
  sourceSlideId: string,
): { slide: Slide; elements: SlideElement[]; index: number } | null {
  const source = workspace.slides.find((slide) => slide.id === sourceSlideId);
  const sourceIndex = workspace.deck.slideOrder.indexOf(sourceSlideId);
  if (!source || sourceIndex < 0) return null;
  const slideId = uniqueClientId('slide');
  const sourceElements = source.elementOrder
    .map((elementId) => workspace.elements.find((element) => element.id === elementId))
    .filter((element): element is SlideElement => element !== undefined);
  const elementIds = new Map(
    sourceElements.map((element) => [element.id, uniqueClientId('element')]),
  );
  const elements = sourceElements.map((element) => ({
    ...structuredClone(element),
    id: elementIds.get(element.id) as string,
    slideId,
    version: 1,
  }));
  return {
    index: sourceIndex + 1,
    slide: {
      ...structuredClone(source),
      id: slideId,
      title: `${source.title} copy`,
      elementOrder: source.elementOrder.map((id) => elementIds.get(id) as string),
      version: 1,
    },
    elements,
  };
}

function uniqueClientId(prefix: string) {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}

function currentVersion(workspace: NodeSlideWorkspace): DeckVersion | undefined {
  return (
    workspace.versions.find((version) => version.version === workspace.deck.version) ??
    [...workspace.versions].sort((left, right) => right.version - left.version)[0]
  );
}

function selectSlide(
  slideId: string,
  setSlide: (id: string) => void,
  setElements: (ids: string[]) => void,
) {
  setSlide(slideId);
  setElements([]);
}

function writeDeckToUrl(deckId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('deck', deckId);
  url.searchParams.delete('share');
  url.searchParams.delete('slide');
  window.history.replaceState(null, '', url);
}

function setQueryParam(key: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  window.history.replaceState(null, '', url);
}

async function shareDeck(shareSlug: string) {
  await navigator.clipboard.writeText(publishedDeckUrl(shareSlug));
}

function publishedDeckUrl(shareSlug: string): string {
  const url = new URL(window.location.href);
  url.searchParams.delete('deck');
  url.searchParams.delete('slide');
  url.searchParams.set('share', shareSlug);
  url.searchParams.set('present', '1');
  return url.toString();
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        'input, textarea, select, button, a[href], [role="tab"], [role="menuitem"], [contenteditable="true"]',
      ),
    )
  );
}

function responsiveBreakpoint(width: number): 'phone' | 'tablet' | 'desktop' {
  if (width < 700) return 'phone';
  if (width < 1100) return 'tablet';
  return 'desktop';
}

function validationBlockMessage(
  validation: ReturnType<typeof validateSnapshot>,
  action: 'present' | 'export',
) {
  const actionLabel = action === 'present' ? 'Presentation' : 'Export';
  if (!validation.publishOk) {
    return `${actionLabel} is blocked by ${validation.issues.length} structure, readability, source, or capability issue${validation.issues.length === 1 ? '' : 's'}. Open validation details to resolve them.`;
  }
  return `${actionLabel} is paused until ${validation.issues.length} cleanup warning${validation.issues.length === 1 ? ' is' : 's are'} reviewed.`;
}

function editorValidationStatus(
  validation: NodeSlideWorkspace['validations'][number] | undefined,
): 'verified' | 'needs_review' | 'classification_issue' | 'validating' {
  if (!validation) return 'validating';
  if (!validation.ok || !validation.publishOk) return 'classification_issue';
  if (!validation.cleanOk || validation.issues.length > 0) return 'needs_review';
  return 'verified';
}

function readStudioPreference(key: 'theme'): string | null {
  try {
    return window.localStorage.getItem(`nodeslide.v3.${key}`);
  } catch {
    return null;
  }
}

function writeStudioPreference(key: 'theme', value: string) {
  try {
    window.localStorage.setItem(`nodeslide.v3.${key}`, value);
  } catch {
    // Visual preferences remain available for this session when storage is unavailable.
  }
}

function tastePackIdForProfile(profile: SignatureProfile | undefined): NodeSlideTastePackId | null {
  if (!profile || profile.source.kind !== 'taste_pack') return null;
  const extensions = (
    profile as SignatureProfile & {
      $extensions?: Record<string, { id?: string }>;
    }
  ).$extensions;
  const id = extensions?.['com.nodeslide.tastePack']?.id;
  return id === 'finance-ibcs' || id === 'startup-narrative' ? id : null;
}

function LoadingScreen({ title }: { title: string }) {
  return (
    <main
      className="nodeslide-studio ns-loading-screen"
      data-testid="nodeslide-studio"
      aria-busy="true"
    >
      <output className="ns-sr-only" aria-live="polite">
        {title}
      </output>
      <span className="ns-loading-mark" aria-hidden="true">
        <LoaderCircle className="ns-spin" size={20} />
      </span>
      <strong>{title}</strong>
      <p>Loading canonical slides, sources, comments, and revision clocks.</p>
    </main>
  );
}

function RecoveryScreen({
  title,
  detail,
  primaryLabel,
  onPrimary,
  children,
}: {
  title: string;
  detail: string;
  primaryLabel: string;
  onPrimary: () => void;
  children?: ReactNode;
}) {
  return (
    <main className="nodeslide-studio ns-recovery-screen" data-testid="nodeslide-studio">
      <span className="ns-recovery-mark" aria-hidden="true">
        <ShieldAlert size={22} />
      </span>
      <span className="ns-eyebrow">Safe recovery</span>
      <h1>{title}</h1>
      <p>{detail}</p>
      {children}
      <button className="ns-button ns-button--accent" type="button" onClick={onPrimary}>
        {primaryLabel === 'Retry' ? <RefreshCw size={15} /> : <FolderOpen size={15} />}
        {primaryLabel}
      </button>
    </main>
  );
}

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data;
    if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
      return data.message;
    }
  }
  return error instanceof Error ? error.message : fallback;
}

function Toast({
  toast,
  onClose,
}: { toast: { kind: 'success' | 'error'; message: string }; onClose: () => void }) {
  useEffect(() => {
    if (toast.kind === 'error') return;
    const timeout = window.setTimeout(onClose, 4200);
    return () => window.clearTimeout(timeout);
  }, [onClose, toast.kind]);
  return (
    <output className={`ns-toast is-${toast.kind}`} aria-live="polite">
      {toast.kind === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
      <span>{toast.message}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss notification">
        <X size={14} />
      </button>
    </output>
  );
}
