import { useAction, useMutation, useQuery } from 'convex/react';
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
  NodeSlidePublication,
  NodeSlideWorkspace,
  PatchOperation,
  PatchScope,
  PublishedNodeSlide,
  Slide,
  SlideElement,
} from '../../../shared/nodeslide';
import { isElementOperation } from '../../../shared/nodeslide';
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
import { FirstRunDialog } from './components/FirstRunDialog';
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
import { SlideNavigator } from './components/SlideNavigator';
import { StudioToolbar } from './components/StudioToolbar';
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
  snapshot?: DeckSnapshot;
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

interface NodeSlideGeneratedApi {
  nodeslide: {
    getWorkspace: PublicQuery<
      { deckId: string; ownerAccessKey: string },
      NodeSlideWorkspace | null
    >;
    getPresenterSnapshot: PublicQuery<{ shareSlug: string }, PublishedNodeSlide | null>;
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
      { deckId: string; ownerAccessKey: string; commentId: string },
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
  };
  nodeslideAgent: {
    createDeckFromBrief: PublicAction<CreateDeckAdmissionRequest, OwnerWorkspace>;
    proposeEdit: PublicAction<AgentEditRequest & { ownerAccessKey: string }, { patchId: string }>;
  };
  nodeslideVariations: {
    generate: PublicAction<
      { deckId: string; ownerAccessKey: string; slideId: string },
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

export function NodeSlideStudio() {
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
  const [activeInspectorTab, setActiveInspectorTab] = useState<InspectorTab>('ai');
  const [navigatorCollapsed, setNavigatorCollapsed] = useState(
    () => window.innerWidth <= 1100 && window.innerWidth > 720,
  );
  const [inspectorCollapsed, setInspectorCollapsed] = useState(() => window.innerWidth <= 1100);
  const [inspectorWidth, setInspectorWidth] = useState(388);
  const [zoom, setZoom] = useState(() => {
    if (window.innerWidth <= 720) return 35;
    if (window.innerWidth <= 1100) return 62;
    if (window.innerWidth <= 1360) return 55;
    if (window.innerWidth <= 1600) return 65;
    return 82;
  });
  const [presentMode, setPresentMode] = useState(
    () => new URLSearchParams(window.location.search).get('present') === '1',
  );
  const [projectsOpen, setProjectsOpen] = useState(false);
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
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [canvasResetKey, setCanvasResetKey] = useState(0);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [clipboardElements, setClipboardElements] = useState<SlideElement[]>([]);
  const [firstRunOpen, setFirstRunOpen] = useState(
    () => !requestedDeck && !requestedShare && !hasSeenFirstRun(),
  );
  const bootstrapped = useRef(false);
  const historyDeckRef = useRef<string | null>(null);
  const promptedRecoveryDecks = useRef(new Set<string>());

  const ensureWorkspace = useMutation(nodeslideApi.nodeslide.ensureWorkspace);
  const applyPatchMutation = useMutation(nodeslideApi.nodeslide.applyPatch);
  const acceptPatch = useMutation(nodeslideApi.nodeslide.acceptPatch);
  const rejectPatch = useMutation(nodeslideApi.nodeslide.rejectPatch);
  const addComment = useMutation(nodeslideApi.nodeslide.addComment);
  const replyComment = useMutation(nodeslideApi.nodeslide.replyComment);
  const resolveComment = useMutation(nodeslideApi.nodeslide.resolveComment);
  const reopenComment = useMutation(nodeslideApi.nodeslide.reopenComment);
  const restoreVersion = useMutation(nodeslideApi.nodeslide.restoreVersion);
  const publishDeck = useMutation(nodeslideApi.nodeslide.publishDeck);
  const revokePublication = useMutation(nodeslideApi.nodeslide.revokePublication);
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
  const workspace =
    queriedWorkspace ?? (localWorkspace?.deck.id === activeDeckId ? localWorkspace : null);
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
    ) => {
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
        setOwnerAccessKey(nextOwnerAccessKey);
        setKnownAccess(listStoredDeckAccess());
      }
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
  }, [installWorkspace, recoveredWorkspace, recoveryAccessRequest]);

  useEffect(() => {
    void bootstrapAttempt;
    if (bootstrapped.current || requestedDeck || requestedShare) return;
    bootstrapped.current = true;
    setBootstrapError(null);
    const storedOwnerAccessKey = getStoredOwnerAccessKey();
    void ensureWorkspace({
      clientSessionId,
      ...(storedOwnerAccessKey ? { ownerAccessKey: storedOwnerAccessKey } : {}),
    })
      .then((next) => installWorkspace(next, undefined, true))
      .catch((error: unknown) => {
        const message = errorMessage(error, 'Could not open the sample deck.');
        setBootstrapError(message);
        setToast({ kind: 'error', message });
      });
  }, [
    bootstrapAttempt,
    clientSessionId,
    ensureWorkspace,
    installWorkspace,
    requestedDeck,
    requestedShare,
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
      historyDeckRef.current = workspace.deck.id;
      setUndoStack(
        [...workspace.versions]
          .filter((version) => version.version < workspace.deck.version)
          .sort((left, right) => left.version - right.version)
          .map((version) => version.id),
      );
      setRedoStack([]);
    }
  }, [workspace]);

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
  const canvasSlide =
    previewMatchesActiveSlide && previewedVariation
      ? previewedVariation.candidate.slide
      : (signaturePreviewSnapshot?.slides.find((slide) => slide.id === activeSlide?.id) ??
        activeSlide);
  const canvasElements =
    previewMatchesActiveSlide && previewedVariation
      ? previewedVariation.candidate.elements
      : signaturePreviewSnapshot && activeSlide
        ? signaturePreviewSnapshot.elements.filter((element) => element.slideId === activeSlide.id)
        : slideElements;
  const signaturePreviewActive = Boolean(signaturePreviewSnapshot && previewedSignatureProfile);
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

  const applyOperations = useCallback(
    async (
      operations: PatchOperation[],
      scope: PatchScope,
      summary: string,
      signatureProfile?: SignatureProfile,
    ) => {
      if (!workspace || !ownerAccessKey || operations.length === 0) return false;
      const clocks = clocksForScope(workspace, scope, operations);
      const beforeVersion = currentVersion(workspace);
      try {
        const receipt = await applyPatchMutation({
          deckId: workspace.deck.id,
          ownerAccessKey,
          baseDeckVersion: workspace.deck.version,
          ...clocks,
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
        if (receipt.patch.status === 'stale') {
          if (receipt.workspace) installWorkspace(receipt.workspace, ownerAccessKey);
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
        if (beforeVersion) {
          setUndoStack((stack) =>
            stack.at(-1) === beforeVersion.id ? stack : [...stack, beforeVersion.id],
          );
          setRedoStack([]);
        }
        if (receipt.workspace) installWorkspace(receipt.workspace, ownerAccessKey);
        void recordPreferencePatch({
          deckId: workspace.deck.id,
          ownerAccessKey,
          patchId: receipt.patch.id,
        })
          .then(() => runPreferenceEtl({ deckId: workspace.deck.id, ownerAccessKey }))
          .catch(() => undefined);
        return true;
      } catch (error) {
        setCanvasResetKey((value) => value + 1);
        setToast({ kind: 'error', message: errorMessage(error, 'The edit could not be applied.') });
        return false;
      }
    },
    [
      applyPatchMutation,
      installWorkspace,
      ownerAccessKey,
      recordPreferencePatch,
      runPreferenceEtl,
      workspace,
    ],
  );

  const restoreHistory = useCallback(
    async (direction: 'undo' | 'redo') => {
      if (!workspace || !ownerAccessKey) return;
      const sourceStack = direction === 'undo' ? undoStack : redoStack;
      const targetId = sourceStack.at(-1);
      if (!targetId) return;
      const current = currentVersion(workspace);
      try {
        const receipt = await restoreVersion({
          deckId: workspace.deck.id,
          ownerAccessKey,
          versionId: targetId,
          baseDeckVersion: workspace.deck.version,
        });
        if (receipt.patch.status !== 'accepted') {
          if (receipt.workspace) installWorkspace(receipt.workspace, ownerAccessKey);
          setToast({
            kind: 'error',
            message:
              'This deck changed before the restore could apply. Your undo history was preserved.',
          });
          setActiveInspectorTab('versions');
          setInspectorCollapsed(false);
          return;
        }
        if (!receipt.workspace) throw new Error('Restore completed without a workspace receipt.');
        if (direction === 'undo') {
          setUndoStack((stack) => stack.slice(0, -1));
          if (current) setRedoStack((stack) => [...stack, current.id]);
        } else {
          setRedoStack((stack) => stack.slice(0, -1));
          if (current) setUndoStack((stack) => [...stack, current.id]);
        }
        installWorkspace(receipt.workspace, ownerAccessKey);
        setCanvasResetKey((value) => value + 1);
        setToast({
          kind: 'success',
          message: direction === 'undo' ? 'Change undone.' : 'Change redone.',
        });
      } catch (error) {
        setToast({
          kind: 'error',
          message: errorMessage(error, direction === 'undo' ? 'Undo failed.' : 'Redo failed.'),
        });
      }
    },
    [installWorkspace, ownerAccessKey, redoStack, restoreVersion, undoStack, workspace],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (
        (previewMatchesActiveSlide || signaturePreviewActive) &&
        event.key === 'Escape' &&
        !commandOpen &&
        !projectsOpen &&
        !presentMode
      ) {
        event.preventDefault();
        setPreviewedVariation(null);
        setPreviewedSignatureProfile(null);
        setSelectedElementIds([]);
        return;
      }
      if (isEditableTarget(event.target) || commandOpen || projectsOpen || presentMode) return;
      if (previewMatchesActiveSlide || signaturePreviewActive) {
        if (
          event.key !== 'ArrowDown' &&
          event.key !== 'PageDown' &&
          event.key !== 'ArrowUp' &&
          event.key !== 'PageUp'
        ) {
          return;
        }
      }
      const modified = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
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
      if (event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault();
        const next = orderedSlides[Math.min(orderedSlides.length - 1, activeSlideIndex + 1)];
        if (next) selectSlide(next.id, setActiveSlideId, setSelectedElementIds);
      } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
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
    setCreating(true);
    try {
      const result = await createDeckFromBrief({ ...request });
      const accessDurable = installWorkspace(result);
      markFirstRunSeen();
      setFirstRunOpen(false);
      setProjectsOpen(false);
      if (accessDurable) {
        setToast({
          kind: 'success',
          message:
            request.providerMode === 'deterministic'
              ? 'Deck created deterministically. Your brief stayed inside NodeSlide.'
              : 'Deck created after your consented OpenRouter attempt. Trace shows whether OpenRouter or the deterministic fallback produced it.',
        });
      }
    } catch (error) {
      setToast({ kind: 'error', message: errorMessage(error, 'The deck could not be created.') });
    } finally {
      setCreating(false);
    }
  };

  const projectsDialog = (
    <ProjectDialog
      open={projectsOpen}
      clientSessionId={clientSessionId}
      recentDecks={recentDecks}
      creating={creating}
      onClose={() => setProjectsOpen(false)}
      onCreate={(request) => void createDeck(request)}
      onOpenDeck={openOwnedDeck}
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
    setTastePackBusy(true);
    setPreviewedSignatureProfile(null);
    void saveSignatureProfile({
      deckId: workspace.deck.id,
      ownerAccessKey,
      profileJson: JSON.stringify(profile),
    })
      .then(async () => {
        const result = planSignatureApplication(snapshot, profile);
        if (!result.ok) {
          if (result.error.code !== 'already_applied') throw new Error(result.error.message);
          const activated = await activateSignatureProfile({
            deckId: workspace.deck.id,
            ownerAccessKey,
            profileId: profile.id,
            profileDigest: profile.source.digest,
            baseDeckVersion: workspace.deck.version,
          });
          if (activated) installWorkspace(activated, ownerAccessKey);
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
        );
        if (accepted) {
          setToast({
            kind: 'success',
            message: `${profile.name} applied through a versioned, on-brand-validated patch.`,
          });
        }
      })
      .catch((error: unknown) =>
        setToast({
          kind: 'error',
          message: errorMessage(error, 'Signature could not be applied.'),
        }),
      )
      .finally(() => setTastePackBusy(false));
  };
  const uploadSignatureSource = (file: File) => {
    if (!ownerAccessKey || tastePackBusy) return;
    setTastePackBusy(true);
    void file
      .arrayBuffer()
      .then((buffer) =>
        extractPptxSignature(new Uint8Array(buffer), {
          fileName: file.name,
        }),
      )
      .then(async (result) => {
        if (!result.ok) throw new Error(result.error.message);
        const profileJson = await saveSignatureProfile({
          deckId: workspace.deck.id,
          ownerAccessKey,
          profileJson: JSON.stringify(result.profile),
        });
        const profile = parseSignatureProfileRows([profileJson])[0];
        if (!profile) throw new Error('The saved signature profile could not be decoded.');
        setPreviewedVariation(null);
        setPreviewedSignatureProfile(profile);
        setToast({
          kind: 'success',
          message: `${profile.name} extracted with ${profile.confidence} confidence. Preview before applying.`,
        });
      })
      .catch((error: unknown) =>
        setToast({ kind: 'error', message: errorMessage(error, 'Past deck could not be read.') }),
      )
      .finally(() => setTastePackBusy(false));
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
      detail: 'Create from a structured brief',
      group: 'Create',
      icon: 'new',
      run: () => setProjectsOpen(true),
    },
  ];

  return (
    <main
      className="nodeslide-studio"
      data-testid="nodeslide-studio"
      style={
        {
          '--ns-nav-width': navigatorCollapsed ? '52px' : '246px',
          '--ns-inspector-width': inspectorCollapsed ? '52px' : `${inspectorWidth}px`,
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
      />

      <div className="ns-studio-grid">
        <SlideNavigator
          slides={orderedSlides}
          elements={workspace.elements}
          theme={workspace.deck.theme}
          activeSlideId={activeSlide.id}
          collapsed={navigatorCollapsed}
          canAddSlide
          canDeleteSlide={orderedSlides.length > 1}
          onSelectSlide={(slideId) => selectSlide(slideId, setActiveSlideId, setSelectedElementIds)}
          onToggleCollapsed={() => setNavigatorCollapsed((value) => !value)}
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
        />

        <SlideCanvas
          key={`${activeSlide.id}:${previewMatchesActiveSlide ? previewedVariation?.id : (previewedSignatureProfile?.id ?? 'original')}:${canvasResetKey}`}
          slide={canvasSlide ?? activeSlide}
          slideIndex={activeSlideIndex}
          slideCount={orderedSlides.length}
          deckVersion={workspace.deck.version}
          elements={canvasElements}
          comments={workspace.comments}
          presence={workspace.presence}
          theme={workspace.deck.theme}
          selectedElementIds={selectedElementIds}
          readOnly={previewMatchesActiveSlide || signaturePreviewActive}
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
            const copies = sourceElements.map((element, index) => duplicateElement(element, index));
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
          onPreviousSlide={() => {
            const previous = orderedSlides[activeSlideIndex - 1];
            if (previous) selectSlide(previous.id, setActiveSlideId, setSelectedElementIds);
          }}
          onNextSlide={() => {
            const next = orderedSlides[activeSlideIndex + 1];
            if (next) selectSlide(next.id, setActiveSlideId, setSelectedElementIds);
          }}
        />

        <InspectorPanel
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
          onProposeEdit={(instruction, scope) => {
            if (!ownerAccessKey) return;
            const clocks = clocksForScope(workspace, scope, []);
            setAgentBusy(true);
            void proposeEdit({
              deckId: workspace.deck.id,
              ownerAccessKey,
              instruction,
              baseDeckVersion: workspace.deck.version,
              ...clocks,
              scope,
            })
              .catch((error: unknown) =>
                setToast({
                  kind: 'error',
                  message: errorMessage(error, 'The agent could not create a proposal.'),
                }),
              )
              .finally(() => setAgentBusy(false));
          }}
          onAcceptPatch={(patch) => {
            if (!ownerAccessKey) return;
            const beforeVersion = currentVersion(workspace);
            void acceptPatch({
              deckId: workspace.deck.id,
              ownerAccessKey,
              patchId: patch.id,
            })
              .then((receipt) => {
                if (receipt.patch.status === 'stale') {
                  setActiveInspectorTab('versions');
                  setToast({
                    kind: 'error',
                    message:
                      'The proposal is stale. Compare it with the current deck before retrying.',
                  });
                  return;
                }
                if (beforeVersion) {
                  setUndoStack((stack) => [...stack, beforeVersion.id]);
                  setRedoStack([]);
                }
                if (receipt.workspace) installWorkspace(receipt.workspace, ownerAccessKey);
                void recordPreferencePatch({
                  deckId: workspace.deck.id,
                  ownerAccessKey,
                  patchId: receipt.patch.id,
                })
                  .then(() => runPreferenceEtl({ deckId: workspace.deck.id, ownerAccessKey }))
                  .catch(() => undefined);
              })
              .catch((error: unknown) =>
                setToast({
                  kind: 'error',
                  message: errorMessage(error, 'The proposal could not be accepted.'),
                }),
              );
          }}
          onRejectPatch={(patch) => {
            if (!ownerAccessKey) return;
            void rejectPatch({
              deckId: workspace.deck.id,
              ownerAccessKey,
              patchId: patch.id,
            })
              .then((rejected) => {
                if (!rejected) return;
                return recordPreferencePatch({
                  deckId: workspace.deck.id,
                  ownerAccessKey,
                  patchId: rejected.id,
                }).then(() => runPreferenceEtl({ deckId: workspace.deck.id, ownerAccessKey }));
              })
              .catch((error: unknown) =>
                setToast({
                  kind: 'error',
                  message: errorMessage(error, 'The proposal could not be rejected.'),
                }),
              );
          }}
          onGenerateVariations={() => {
            if (!ownerAccessKey || variationBusy) return;
            setPreviewedVariation(null);
            setVariationError(null);
            setVariationGenerating(true);
            void generateVariations({
              deckId: workspace.deck.id,
              ownerAccessKey,
              slideId: activeSlide.id,
            })
              .then((receipt) => {
                if (receipt.variations.length !== 3) {
                  throw new Error('The variation service did not return exactly three directions.');
                }
                const fallbackCount = receipt.variations.filter(
                  (variation) => variation.origin === 'deterministic_fallback',
                ).length;
                setToast({
                  kind: 'success',
                  message:
                    fallbackCount > 0
                      ? `Three validated directions are ready; ${fallbackCount} used an honest fallback.`
                      : 'Three validated free-route directions are ready to review.',
                });
                void refreshVariationPreferences();
              })
              .catch((error: unknown) => {
                const message = errorMessage(
                  error,
                  'Three safe directions could not be generated for this slide.',
                );
                setVariationError(message);
                setToast({ kind: 'error', message });
              })
              .finally(() => setVariationGenerating(false));
          }}
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
            if (variation) setSelectedElementIds([]);
            setPreviewedVariation(variation);
          }}
          onAcceptVariation={(variation) => {
            if (!ownerAccessKey || variationBusy) return;
            const beforeVersion = currentVersion(workspace);
            setVariationError(null);
            setVariationDecisionBusy(true);
            void acceptVariation({
              deckId: workspace.deck.id,
              ownerAccessKey,
              variationId: variation.id,
            })
              .then((receipt) => {
                setPreviewedVariation(null);
                if (receipt.variation.status === 'stale' || receipt.patch?.status === 'stale') {
                  setVariationError(
                    'The slide changed after generation. The direction was marked stale and no content was overwritten.',
                  );
                  setToast({
                    kind: 'error',
                    message: 'This direction is stale; the newer slide was preserved.',
                  });
                  return;
                }
                if (receipt.variation.status !== 'accepted') {
                  setToast({
                    kind: 'error',
                    message: `This direction is already ${receipt.variation.status}.`,
                  });
                  return;
                }
                if (!receipt.patch) {
                  setToast({ kind: 'success', message: 'This direction was already accepted.' });
                  return;
                }
                if (beforeVersion) {
                  setUndoStack((stack) => [...stack, beforeVersion.id]);
                  setRedoStack([]);
                }
                if (receipt.workspace) installWorkspace(receipt.workspace, ownerAccessKey);
                setToast({
                  kind: 'success',
                  message: 'Direction accepted through a versioned patch.',
                });
                void refreshVariationPreferences();
              })
              .catch((error: unknown) => {
                const message = errorMessage(error, 'The direction could not be accepted.');
                setVariationError(message);
                setToast({ kind: 'error', message });
              })
              .finally(() => setVariationDecisionBusy(false));
          }}
          onRejectVariation={(variation) => {
            if (!ownerAccessKey || variationBusy) return;
            setVariationError(null);
            setVariationDecisionBusy(true);
            void rejectVariation({
              deckId: workspace.deck.id,
              ownerAccessKey,
              variationId: variation.id,
              reason: 'user_rejected',
            })
              .then(() => {
                setPreviewedVariation((current) => (current?.id === variation.id ? null : current));
                void refreshVariationPreferences();
              })
              .catch((error: unknown) => {
                const message = errorMessage(error, 'The direction could not be rejected.');
                setVariationError(message);
                setToast({ kind: 'error', message });
              })
              .finally(() => setVariationDecisionBusy(false));
          }}
          onApplyTastePack={(packId) => {
            applySignatureProfile(getNodeSlideTastePack(packId));
          }}
          onApplySignatureProfile={applySignatureProfile}
          onPreviewSignatureProfile={(profile) => {
            setPreviewedVariation(null);
            setSelectedElementIds([]);
            setPreviewedSignatureProfile(profile);
          }}
          onUploadSignatureSource={uploadSignatureSource}
          onClearTastePack={() => {
            if (!ownerAccessKey || tastePackBusy) return;
            setTastePackBusy(true);
            setPreviewedSignatureProfile(null);
            void clearActiveSignatureProfile({
              deckId: workspace.deck.id,
              ownerAccessKey,
              baseDeckVersion: workspace.deck.version,
            })
              .then((cleared) => {
                if (cleared) installWorkspace(cleared, ownerAccessKey);
                setToast({ kind: 'success', message: 'Active on-brand checks cleared.' });
              })
              .catch((error: unknown) =>
                setToast({
                  kind: 'error',
                  message: errorMessage(error, 'Active signature could not be cleared.'),
                }),
              )
              .finally(() => setTastePackBusy(false));
          }}
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
          onRestoreVersion={(version: DeckVersion) => {
            if (!ownerAccessKey) return;
            void restoreVersion({
              deckId: workspace.deck.id,
              ownerAccessKey,
              versionId: version.id,
              baseDeckVersion: workspace.deck.version,
            })
              .then((receipt) => {
                if (receipt.patch.status !== 'accepted') {
                  if (receipt.workspace) installWorkspace(receipt.workspace, ownerAccessKey);
                  setToast({
                    kind: 'error',
                    message:
                      'This deck changed before the restore could apply. No version history was changed.',
                  });
                  return;
                }
                if (receipt.workspace) {
                  installWorkspace(receipt.workspace, ownerAccessKey);
                  setUndoStack([]);
                  setRedoStack([]);
                  setCanvasResetKey((value) => value + 1);
                }
              })
              .catch((error: unknown) =>
                setToast({
                  kind: 'error',
                  message: errorMessage(error, 'Version restore failed.'),
                }),
              );
          }}
        />
      </div>

      {projectsDialog}
      <FirstRunDialog
        open={firstRunOpen && !projectsOpen}
        onCreate={() => {
          setFirstRunOpen(false);
          setProjectsOpen(true);
        }}
        onExplore={() => {
          markFirstRunSeen();
          setFirstRunOpen(false);
        }}
      />
      <CommandPalette
        open={commandOpen}
        commands={commands}
        onClose={() => setCommandOpen(false)}
      />
      <OwnerCapabilityRecoveryDialog
        open={Boolean(ownerRecovery) && !firstRunOpen && !projectsOpen}
        recovery={ownerRecovery}
        onClose={() => setOwnerRecovery(null)}
      />
      <PublicationDialog
        open={shareOpen}
        publication={workspace.publication}
        currentDeckVersion={workspace.deck.version}
        busy={shareBusy}
        onClose={() => setShareOpen(false)}
        onCopy={() => {
          const publication = workspace.publication;
          if (!publication || publication.status !== 'active') return;
          setShareBusy(true);
          void shareDeck(publication.shareSlug)
            .then(() => setToast({ kind: 'success', message: 'Frozen view-only link copied.' }))
            .catch((error: unknown) =>
              setToast({
                kind: 'error',
                message: errorMessage(error, 'Share link could not be copied.'),
              }),
            )
            .finally(() => setShareBusy(false));
        }}
        onPublish={() => {
          if (!ownerAccessKey) return;
          setShareBusy(true);
          void publishDeck({ deckId: workspace.deck.id, ownerAccessKey })
            .then(async (published) => {
              try {
                await shareDeck(published.publication.shareSlug);
                setToast({
                  kind: 'success',
                  message: `Published immutable version ${published.publication.deckVersion}; link copied.`,
                });
              } catch {
                setToast({
                  kind: 'error',
                  message: `Published immutable version ${published.publication.deckVersion}, but this browser could not copy the link. Use “Copy existing link” to retry.`,
                });
              }
            })
            .catch((error: unknown) =>
              setToast({
                kind: 'error',
                message: errorMessage(error, 'The current deck could not be published.'),
              }),
            )
            .finally(() => setShareBusy(false));
        }}
        onRevoke={() => {
          if (!ownerAccessKey) return;
          setShareBusy(true);
          void revokePublication({ deckId: workspace.deck.id, ownerAccessKey })
            .then(() => setToast({ kind: 'success', message: 'The view-only link was revoked.' }))
            .catch((error: unknown) =>
              setToast({
                kind: 'error',
                message: errorMessage(error, 'The share link could not be revoked.'),
              }),
            )
            .finally(() => setShareBusy(false));
        }}
      />
      {toast ? <Toast toast={toast} onClose={() => setToast(null)} /> : null}
    </main>
  );
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
      } else if (isElementOperation(operation) && operation.op !== 'add_element') {
        elementIds.add(operation.elementId);
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
        if (!isElementOperation(operation)) return [];
        return [operation.op === 'add_element' ? operation.element.id : operation.elementId];
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
  const url = new URL(window.location.href);
  url.searchParams.delete('deck');
  url.searchParams.delete('slide');
  url.searchParams.set('share', shareSlug);
  url.searchParams.set('present', '1');
  await navigator.clipboard.writeText(url.toString());
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
  if (width <= 720) return 'phone';
  if (width <= 1100) return 'tablet';
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

function hasSeenFirstRun() {
  try {
    return window.localStorage.getItem('nodeslide.firstRun.v1') === 'seen';
  } catch {
    return false;
  }
}

function markFirstRunSeen() {
  try {
    window.localStorage.setItem('nodeslide.firstRun.v1', 'seen');
  } catch {
    // The welcome can reappear in hardened storage contexts without blocking use.
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
