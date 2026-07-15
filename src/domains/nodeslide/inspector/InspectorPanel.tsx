import {
  Activity,
  Bot,
  Braces,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  History,
  MessageCircle,
  MoreHorizontal,
  PanelRightClose,
  SlidersHorizontal,
} from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import type {
  CommentAnchor,
  DeckComment,
  DeckPatch,
  DeckVersion,
  NodeSlideAgentMemory,
  NodeSlideAgentMemoryCategory,
  NodeSlideAgentMessage,
  NodeSlideAgentRun,
  NodeSlideAgentTelemetryPage,
  NodeSlideWorkspace,
  PatchOperation,
  PatchScope,
  Slide,
  SlideElement,
} from '../../../../shared/nodeslide';
import type { TasteProfile } from '../../../../shared/nodeslidePreference';
import type { SignatureProfile } from '../../../../shared/nodeslideSignature';
import type { SlideVariation } from '../../../../shared/nodeslideVariation';
import { NODESLIDE_RESPONSIVE_DRAWER_QUERY } from '../components/editorShellResponsive';
import {
  OverlayBackdrop,
  PopoverSurface,
  getRovingFocusIndex,
  useDrawerSurface,
  useViewportMatch,
} from '../components/overlayPrimitives';
import type { NodeSlideTastePackId } from '../signature/packs/index';
import {
  type AiAgentActivity,
  type AiCommentContext,
  type AiComposerCommand,
  AiInspector,
  type AiProposalOptions,
  type AiReadReference,
  type AiReviewablePatch,
  type AiSuggestedAction,
  type AiVariationRequest,
} from './AiInspector';
import { CommentsInspector } from './CommentsInspector';
import { DataInspector } from './DataInspector';
import { DesignInspector } from './DesignInspector';
import { JsonInspector, type JsonPatchProposalCallback } from './JsonInspector';
import { TraceInspector } from './TraceInspector';
import { VersionsInspector } from './VersionsInspector';
import type { InspectorTab } from './types';
import './reviewInspector.css';

interface ResizeState {
  pointerId: number;
  startX: number;
  startWidth: number;
}

export interface InspectorPanelProps<CommandId extends string = string> {
  workspace: NodeSlideWorkspace;
  slide: Slide;
  selectedElements: readonly SlideElement[];
  selectedSlideIds?: readonly string[];
  ownerAccessKey?: string;
  activeTab: InspectorTab;
  collapsed: boolean;
  width: number;
  agentBusy: boolean;
  variations: readonly SlideVariation[];
  variationsLoading: boolean;
  variationBusy: boolean;
  variationGenerating: boolean;
  variationError: string | null;
  previewedVariationId: string | null;
  aiReferences?: readonly AiReadReference[];
  aiCommands?: readonly AiComposerCommand<CommandId>[];
  aiSuggestedActions?: readonly AiSuggestedAction[];
  aiAgentActivity?: AiAgentActivity | null;
  agentRuns?: readonly NodeSlideAgentRun[];
  agentMessages?: readonly NodeSlideAgentMessage[];
  memories?: readonly NodeSlideAgentMemory[];
  memoriesLoading?: boolean;
  agentTelemetry?: NodeSlideAgentTelemetryPage;
  agentTelemetryRunId?: string;
  agentTelemetryLoadingMore?: boolean;
  agentTelemetryLoadError?: string;
  aiCommentContext?: AiCommentContext | null;
  previewedPatchId?: string | null;
  activeTastePackId: NodeSlideTastePackId | null;
  tastePackBusy: boolean;
  activeProfileId?: string | null;
  previewProfileId?: string | null;
  signatureProfiles?: readonly SignatureProfile[];
  tasteProfile?: TasteProfile | null;
  tasteProfileLoading?: boolean;
  onTabChange: (tab: InspectorTab) => void;
  onToggleCollapsed: () => void;
  onWidthChange: (width: number) => void;
  onProposeEdit: (
    instruction: string,
    scope: PatchScope,
    options: AiProposalOptions<CommandId>,
  ) => void;
  onAttachAiDataFile?: (file: File) => Promise<AiReadReference>;
  onCreateAiMemory?: (category: NodeSlideAgentMemoryCategory, content: string) => Promise<void>;
  onUpdateAiMemory?: (
    memoryId: string,
    update: Partial<Pick<NodeSlideAgentMemory, 'category' | 'content' | 'status'>>,
  ) => Promise<void>;
  onDeleteAiMemory?: (memoryId: string) => Promise<void>;
  onDeleteAiDataSource?: (sourceId: string) => Promise<void>;
  onCancelAiRun?: (runId: string) => void;
  onRetryAiRun?: () => void;
  onSelectAgentRun?: (runId: string) => void;
  onLoadMoreAgentTelemetry?: (runId: string, beforeSequence: number) => void | Promise<void>;
  onAcceptPatch: (patch: DeckPatch) => void;
  onRejectPatch: (patch: DeckPatch) => void;
  onPreviewPatch?: (patch: AiReviewablePatch | null) => void;
  onClearAiCommentContext?: () => void;
  onGenerateVariations: (request: AiVariationRequest) => void;
  onPreviewVariation: (variation: SlideVariation | null) => void;
  onAcceptVariation: (variation: SlideVariation) => void;
  onRejectVariation: (variation: SlideVariation) => void;
  onApplyTastePack: (packId: NodeSlideTastePackId) => void;
  onClearTastePack: () => void;
  onApplySignatureProfile?: (profile: SignatureProfile) => void;
  onPreviewSignatureProfile?: (profile: SignatureProfile | null) => void;
  onUploadSignatureSource?: (file: File) => void;
  onEvictTasteSignal?: (signalId: string) => void;
  onOpenPreferenceEvidence?: (eventId: string) => void;
  onApplyDesignPatch: (operations: PatchOperation[], summary: string) => void;
  onProposeJsonPatch?: JsonPatchProposalCallback;
  onImportSourceFile?: (file: File, kind: 'json' | 'pptx') => Promise<string>;
  onAddComment: (text: string, anchor: CommentAnchor) => void;
  onReply: (parentId: string, text: string) => void;
  onSetCommentStatus: (commentId: string, status: 'open' | 'resolved') => void;
  onSendCommentToAi?: (comment: DeckComment) => void;
  onRestoreVersion: (version: DeckVersion) => void;
}

export const INSPECTOR_TABS: Array<{ id: InspectorTab; label: string; icon: typeof Bot }> = [
  { id: 'ai', label: 'AI', icon: Bot },
  { id: 'design', label: 'Design', icon: SlidersHorizontal },
  { id: 'comments', label: 'Comments', icon: MessageCircle },
  { id: 'versions', label: 'Versions', icon: History },
  { id: 'data', label: 'Evidence', icon: Database },
  { id: 'json', label: 'JSON', icon: Braces },
  { id: 'trace', label: 'Trace', icon: Activity },
];

const PRIMARY_INSPECTOR_TAB_IDS = new Set<InspectorTab>([
  'ai',
  'design',
  'comments',
  'data',
  'trace',
]);

export const PRIMARY_INSPECTOR_TABS = INSPECTOR_TABS.filter(({ id }) =>
  PRIMARY_INSPECTOR_TAB_IDS.has(id),
);

export const MORE_INSPECTOR_TABS = INSPECTOR_TABS.filter(
  ({ id }) => !PRIMARY_INSPECTOR_TAB_IDS.has(id),
);

export function InspectorPanel<CommandId extends string = string>({
  workspace,
  slide,
  selectedElements,
  selectedSlideIds = [],
  ownerAccessKey,
  activeTab,
  collapsed,
  width,
  agentBusy,
  variations,
  variationsLoading,
  variationBusy,
  variationGenerating,
  variationError,
  previewedVariationId,
  aiReferences = [],
  aiCommands = [],
  aiSuggestedActions,
  aiAgentActivity,
  agentRuns = [],
  agentMessages = [],
  memories = [],
  memoriesLoading = false,
  agentTelemetry,
  agentTelemetryRunId,
  agentTelemetryLoadingMore = false,
  agentTelemetryLoadError,
  aiCommentContext = null,
  previewedPatchId = null,
  activeTastePackId,
  tastePackBusy,
  activeProfileId = null,
  previewProfileId = null,
  signatureProfiles = [],
  tasteProfile = null,
  tasteProfileLoading = false,
  onTabChange,
  onToggleCollapsed,
  onWidthChange,
  onProposeEdit,
  onAttachAiDataFile,
  onCreateAiMemory,
  onUpdateAiMemory,
  onDeleteAiMemory,
  onDeleteAiDataSource,
  onCancelAiRun,
  onRetryAiRun,
  onSelectAgentRun,
  onLoadMoreAgentTelemetry,
  onAcceptPatch,
  onRejectPatch,
  onPreviewPatch,
  onClearAiCommentContext,
  onGenerateVariations,
  onPreviewVariation,
  onAcceptVariation,
  onRejectVariation,
  onApplyTastePack,
  onClearTastePack,
  onApplySignatureProfile,
  onPreviewSignatureProfile,
  onUploadSignatureSource,
  onEvictTasteSignal,
  onOpenPreferenceEvidence,
  onApplyDesignPatch,
  onProposeJsonPatch,
  onImportSourceFile,
  onAddComment,
  onReply,
  onSetCommentStatus,
  onSendCommentToAi,
  onRestoreVersion,
}: InspectorPanelProps<CommandId>) {
  const resizeRef = useRef<ResizeState | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const mountedTabsRef = useRef<Set<InspectorTab>>(new Set());
  const shouldRestoreDrawerFocusRef = useRef(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuId = useId();
  const drawerViewport = useViewportMatch(NODESLIDE_RESPONSIVE_DRAWER_QUERY);
  const drawerOpen = drawerViewport && !collapsed;
  rememberInspectorTab(mountedTabsRef.current, activeTab);
  shouldRestoreDrawerFocusRef.current = collapsed;
  const { surfaceRef: drawerRef, handleKeyDown: handleDrawerKeyDown } =
    useDrawerSurface<HTMLElement>({
      open: drawerOpen,
      onClose: onToggleCollapsed,
      initialFocusRef: closeButtonRef,
      shouldRestoreFocusRef: shouldRestoreDrawerFocusRef,
    });

  useEffect(() => {
    if (collapsed) setMoreOpen(false);
  }, [collapsed]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const resize = resizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      onWidthChange(clampWidth(resize.startWidth + resize.startX - event.clientX));
    };
    const stop = (event: PointerEvent) => {
      if (resizeRef.current?.pointerId !== event.pointerId) return;
      resizeRef.current = null;
      document.documentElement.classList.remove('ns-is-resizing');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      document.documentElement.classList.remove('ns-is-resizing');
    };
  }, [onWidthChange]);

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    resizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
    document.documentElement.classList.add('ns-is-resizing');
    event.preventDefault();
  };

  const openComments = workspace.comments.filter(
    (comment) => !comment.parentId && comment.status === 'open',
  ).length;
  const validation = workspace.validations[0];

  return (
    <>
      <OverlayBackdrop
        open={drawerOpen}
        className="ns-inspector-backdrop"
        onDismiss={onToggleCollapsed}
      />
      <aside
        ref={drawerRef}
        className={`ns-inspector${collapsed ? ' is-collapsed' : ''}${drawerOpen ? ' is-drawer-open' : ''}`}
        aria-label={collapsed ? 'Inspector collapsed' : 'NodeSlide inspector'}
        aria-hidden={drawerViewport && collapsed ? true : undefined}
        role={drawerOpen ? 'dialog' : undefined}
        aria-modal={drawerOpen ? true : undefined}
        data-overlay-mode={drawerViewport ? 'drawer' : 'pane'}
        style={{ width }}
        data-testid="inspector"
        onKeyDown={drawerOpen ? handleDrawerKeyDown : undefined}
      >
        <div className="ns-inspector-collapsed-shell" hidden={!collapsed}>
          <button
            className="ns-inspector-collapsed-button"
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Open inspector"
          >
            <ChevronLeft size={16} />
            <span>Inspector</span>
          </button>
          <div className="ns-inspector-collapsed-tabs">
            {INSPECTOR_TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={activeTab === id ? 'is-active' : ''}
                aria-pressed={activeTab === id}
                onClick={() => {
                  onTabChange(id);
                  onToggleCollapsed();
                }}
                aria-label={`Open ${label}`}
                title={label}
              >
                <Icon size={15} />
                {id === 'comments' && openComments > 0 ? <i>{openComments}</i> : null}
              </button>
            ))}
          </div>
        </div>
        <div className="ns-inspector-expanded-shell" hidden={collapsed} inert={collapsed}>
          <button
            className="ns-inspector-resizer"
            type="button"
            onPointerDown={startResize}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                onWidthChange(clampWidth(width + 16));
              }
              if (event.key === 'ArrowRight') {
                event.preventDefault();
                onWidthChange(clampWidth(width - 16));
              }
            }}
            aria-label="Resize inspector"
            title="Drag or use Left and Right arrow keys to resize inspector"
          />
          <div className="ns-inspector-topbar">
            <div className="ns-inspector-context-summary">
              <span className="ns-eyebrow">Inspector</span>
              <div className="ns-inspector-context-chips" aria-label="Current inspector context">
                <span className="is-slide" title={slide.title}>
                  Slide · {slide.title}
                </span>
                <span className={selectedElements.length > 0 ? 'is-selection' : 'is-empty'}>
                  Selection · {selectedElements.length > 0 ? selectedElements.length : 'none'}
                </span>
                {selectedSlideIds.length >= 2 ? (
                  <span className="is-selection">Slides · {selectedSlideIds.length}</span>
                ) : null}
              </div>
            </div>
            <button
              ref={closeButtonRef}
              className="ns-icon-button"
              type="button"
              onClick={onToggleCollapsed}
              aria-label="Collapse inspector"
            >
              <PanelRightClose size={16} />
            </button>
          </div>
          <nav className="ns-inspector-nav" aria-label="Inspector views">
            <div className="ns-inspector-tabs" role="tablist" aria-label="Primary inspector views">
              {PRIMARY_INSPECTOR_TABS.map(({ id, label, icon: Icon }) => (
                <button
                  type="button"
                  role="tab"
                  id={`ns-tab-${id}`}
                  aria-controls={`ns-tabpanel-${id}`}
                  aria-selected={activeTab === id}
                  className={activeTab === id ? 'is-active' : ''}
                  data-testid={`inspector-tab-${id}`}
                  key={id}
                  tabIndex={activeTab === id ? 0 : -1}
                  onClick={() => {
                    setMoreOpen(false);
                    onTabChange(id);
                  }}
                  onKeyDown={(event) => handlePrimaryInspectorTabKeyDown(event, id, onTabChange)}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                  {id === 'comments' && openComments > 0 ? <i>{openComments}</i> : null}
                  {id === 'ai' && (agentBusy || variationBusy) ? <i className="is-live" /> : null}
                </button>
              ))}
            </div>
            <div className="ns-inspector-more">
              <button
                ref={moreTriggerRef}
                id="ns-inspector-more-trigger"
                className={`ns-inspector-more-trigger ${
                  MORE_INSPECTOR_TABS.some(({ id }) => id === activeTab) ? 'is-active' : ''
                }`}
                type="button"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                aria-controls={moreMenuId}
                aria-label={`More inspector views${
                  MORE_INSPECTOR_TABS.find(({ id }) => id === activeTab)?.label
                    ? `, current: ${MORE_INSPECTOR_TABS.find(({ id }) => id === activeTab)?.label}`
                    : ''
                }`}
                data-testid="inspector-more"
                onClick={() => setMoreOpen((open) => !open)}
              >
                <MoreHorizontal size={14} aria-hidden="true" />
                <span>More</span>
                <ChevronDown size={11} aria-hidden="true" />
              </button>
              <PopoverSurface
                open={moreOpen}
                id={moreMenuId}
                surfaceRole="menu"
                ariaLabel="More inspector views"
                className="ns-popover ns-inspector-more-menu"
                triggerRef={moreTriggerRef}
                onClose={() => setMoreOpen(false)}
              >
                {MORE_INSPECTOR_TABS.map(({ id, label, icon: Icon }) => (
                  <button
                    type="button"
                    role="menuitem"
                    className={activeTab === id ? 'is-active' : ''}
                    data-testid={`inspector-tab-${id}`}
                    key={id}
                    onClick={() => {
                      onTabChange(id);
                      setMoreOpen(false);
                    }}
                  >
                    <Icon size={14} aria-hidden="true" />
                    <span>{label}</span>
                    {activeTab === id ? <span className="ns-sr-only">Current view</span> : null}
                  </button>
                ))}
              </PopoverSurface>
            </div>
          </nav>

          <div className="ns-inspector-content">
            {mountedTabsRef.current.has('ai') ? (
              <InspectorTabPanel id="ai" activeTab={activeTab}>
                <AiInspector
                  key={workspace.deck.id}
                  deck={workspace.deck}
                  slide={slide}
                  selectedElements={selectedElements}
                  selectedSlideIds={selectedSlideIds}
                  workspaceElements={workspace.elements}
                  patches={workspace.patches}
                  traces={workspace.traces}
                  agentRuns={agentRuns}
                  agentMessages={agentMessages}
                  memories={memories}
                  memoriesLoading={memoriesLoading}
                  variations={variations}
                  variationsLoading={variationsLoading}
                  isSubmitting={agentBusy}
                  variationBusy={variationBusy}
                  variationGenerating={variationGenerating}
                  variationError={variationError}
                  previewedVariationId={previewedVariationId}
                  references={aiReferences}
                  commands={aiCommands}
                  commentContext={aiCommentContext}
                  previewedPatchId={previewedPatchId}
                  {...(aiSuggestedActions ? { suggestedActions: aiSuggestedActions } : {})}
                  {...(aiAgentActivity !== undefined ? { agentActivity: aiAgentActivity } : {})}
                  {...(onPreviewPatch ? { onPreviewPatch } : {})}
                  {...(onClearAiCommentContext
                    ? { onClearCommentContext: onClearAiCommentContext }
                    : {})}
                  onPropose={onProposeEdit}
                  {...(onAttachAiDataFile ? { onAttachDataFile: onAttachAiDataFile } : {})}
                  {...(onCreateAiMemory ? { onCreateMemory: onCreateAiMemory } : {})}
                  {...(onUpdateAiMemory ? { onUpdateMemory: onUpdateAiMemory } : {})}
                  {...(onDeleteAiMemory ? { onDeleteMemory: onDeleteAiMemory } : {})}
                  {...(onCancelAiRun ? { onCancelRun: onCancelAiRun } : {})}
                  {...(onRetryAiRun ? { onRetryRun: onRetryAiRun } : {})}
                  onAccept={onAcceptPatch}
                  onReject={onRejectPatch}
                  onGenerateVariations={onGenerateVariations}
                  onPreviewVariation={onPreviewVariation}
                  onAcceptVariation={onAcceptVariation}
                  onRejectVariation={onRejectVariation}
                />
              </InspectorTabPanel>
            ) : null}
            {mountedTabsRef.current.has('design') ? (
              <InspectorTabPanel id="design" activeTab={activeTab}>
                <DesignInspector
                  slide={slide}
                  slideElements={workspace.elements.filter(
                    (element) => element.slideId === slide.id,
                  )}
                  selectedElements={selectedElements}
                  theme={workspace.deck.theme}
                  activeTastePackId={activeTastePackId}
                  activeProfileId={activeProfileId}
                  previewProfileId={previewProfileId}
                  profiles={signatureProfiles}
                  busy={tastePackBusy}
                  onApplyTastePack={onApplyTastePack}
                  onApplyProfile={onApplySignatureProfile}
                  onPreviewProfile={onPreviewSignatureProfile}
                  onUploadSource={onUploadSignatureSource}
                  tasteProfile={tasteProfile}
                  tasteProfileLoading={tasteProfileLoading}
                  onEvictTasteSignal={onEvictTasteSignal}
                  onOpenPreferenceEvidence={onOpenPreferenceEvidence}
                  onClearTastePack={onClearTastePack}
                  onApplyPatch={onApplyDesignPatch}
                />
              </InspectorTabPanel>
            ) : null}
            {mountedTabsRef.current.has('comments') ? (
              <InspectorTabPanel id="comments" activeTab={activeTab}>
                <CommentsInspector
                  deckId={workspace.deck.id}
                  slide={slide}
                  selectedElements={selectedElements}
                  comments={workspace.comments}
                  onAddComment={onAddComment}
                  onReply={onReply}
                  onSetStatus={onSetCommentStatus}
                  onSendToAi={(comment) => {
                    onSendCommentToAi?.(comment);
                    onTabChange('ai');
                  }}
                />
              </InspectorTabPanel>
            ) : null}
            {mountedTabsRef.current.has('versions') ? (
              <InspectorTabPanel id="versions" activeTab={activeTab}>
                <VersionsInspector
                  deck={workspace.deck}
                  versions={workspace.versions}
                  patches={workspace.patches}
                  onRestore={onRestoreVersion}
                />
              </InspectorTabPanel>
            ) : null}
            {mountedTabsRef.current.has('data') ? (
              <InspectorTabPanel id="data" activeTab={activeTab}>
                <DataInspector
                  sources={workspace.sources}
                  selectedElements={selectedElements}
                  {...(ownerAccessKey
                    ? {
                        ownerDataExport: {
                          deckId: workspace.deck.id,
                          deckTitle: workspace.deck.title,
                          ownerAccessKey,
                        },
                      }
                    : {})}
                  {...(onDeleteAiDataSource ? { onDeleteSource: onDeleteAiDataSource } : {})}
                />
              </InspectorTabPanel>
            ) : null}
            {mountedTabsRef.current.has('json') ? (
              <InspectorTabPanel id="json" activeTab={activeTab}>
                <JsonInspector
                  snapshot={{
                    deck: workspace.deck,
                    slides: workspace.slides,
                    elements: workspace.elements,
                    sources: workspace.sources,
                  }}
                  slide={slide}
                  selectedElements={selectedElements}
                  patches={workspace.patches}
                  {...(onProposeJsonPatch ? { onProposePatch: onProposeJsonPatch } : {})}
                  {...(onImportSourceFile ? { onImportSourceFile } : {})}
                />
              </InspectorTabPanel>
            ) : null}
            {mountedTabsRef.current.has('trace') ? (
              <InspectorTabPanel id="trace" activeTab={activeTab}>
                <TraceInspector
                  traces={workspace.traces}
                  validations={workspace.validations}
                  patches={workspace.patches}
                  agentRuns={agentRuns}
                  agentMessages={agentMessages}
                  sources={workspace.sources}
                  {...(agentTelemetryRunId ? { agentTelemetryRunId } : {})}
                  agentTelemetryLoadingMore={agentTelemetryLoadingMore}
                  {...(agentTelemetryLoadError ? { agentTelemetryLoadError } : {})}
                  {...(onSelectAgentRun ? { onSelectAgentRun } : {})}
                  {...(onLoadMoreAgentTelemetry ? { onLoadMoreAgentTelemetry } : {})}
                  {...(agentTelemetry ? { agentTelemetry } : {})}
                />
              </InspectorTabPanel>
            ) : null}
          </div>

          <button
            className="ns-inspector-footer"
            type="button"
            data-testid="validation-status"
            onClick={() => onTabChange('trace')}
            aria-label={`${validationLabel(validation)}. Open validation details.`}
          >
            <span className={validation?.cleanOk ? 'is-ok' : validation ? 'has-issues' : ''} />
            <output aria-live="polite">{validationLabel(validation)}</output>
            <ChevronRight size={12} />
          </button>
        </div>
      </aside>
    </>
  );
}

function clampWidth(width: number) {
  return Math.min(560, Math.max(304, width));
}

interface InspectorTabPanelProps {
  id: InspectorTab;
  activeTab: InspectorTab;
  children: ReactNode;
}

function InspectorTabPanel({ id, activeTab, children }: InspectorTabPanelProps) {
  return (
    <section
      className="ns-inspector-tabpanel"
      role="tabpanel"
      id={`ns-tabpanel-${id}`}
      aria-labelledby={
        MORE_INSPECTOR_TABS.some(({ id: secondaryId }) => secondaryId === id)
          ? 'ns-inspector-more-trigger'
          : `ns-tab-${id}`
      }
      hidden={activeTab !== id}
    >
      {children}
    </section>
  );
}

function handlePrimaryInspectorTabKeyDown(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  currentTab: InspectorTab,
  onTabChange: (tab: InspectorTab) => void,
) {
  const nextTab = primaryInspectorTabAfterKey(currentTab, event.key);
  if (!nextTab) return;
  event.preventDefault();
  onTabChange(nextTab);
  requestAnimationFrame(() => document.getElementById(`ns-tab-${nextTab}`)?.focus());
}

export function primaryInspectorTabAfterKey(
  currentTab: InspectorTab,
  key: string,
): InspectorTab | null {
  const currentIndex = PRIMARY_INSPECTOR_TABS.findIndex(({ id }) => id === currentTab);
  const nextIndex = getRovingFocusIndex(PRIMARY_INSPECTOR_TABS.length, currentIndex, key);
  return nextIndex === null ? null : (PRIMARY_INSPECTOR_TABS[nextIndex]?.id ?? null);
}

export function rememberInspectorTab(mountedTabs: Set<InspectorTab>, activeTab: InspectorTab) {
  mountedTabs.add(activeTab);
  return mountedTabs;
}

export function inspectorTabAfterKey(currentTab: InspectorTab, key: string): InspectorTab | null {
  const currentIndex = INSPECTOR_TABS.findIndex(({ id }) => id === currentTab);
  const nextIndex = getRovingFocusIndex(INSPECTOR_TABS.length, currentIndex, key);
  return nextIndex === null ? null : (INSPECTOR_TABS[nextIndex]?.id ?? null);
}

function validationLabel(validation: NodeSlideWorkspace['validations'][number] | undefined) {
  if (!validation) return 'Awaiting validation';
  if (!validation.ok) return `${validation.issues.length} structure checks need review`;
  if (!validation.publishOk) return `${validation.issues.length} issues block presenting or export`;
  if (!validation.cleanOk) return `${validation.issues.length} cleanup warnings`;
  return 'Structure, presentation, and cleanup checks passed';
}
