import {
  Activity,
  Bot,
  Braces,
  ChevronLeft,
  ChevronRight,
  Database,
  History,
  MessageCircle,
  PanelRightClose,
  SlidersHorizontal,
} from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
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
import { JsonInspector } from './JsonInspector';
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
  onAddComment: (text: string, anchor: CommentAnchor) => void;
  onReply: (parentId: string, text: string) => void;
  onSetCommentStatus: (commentId: string, status: 'open' | 'resolved') => void;
  onSendCommentToAi?: (comment: DeckComment) => void;
  onRestoreVersion: (version: DeckVersion) => void;
}

const tabs: Array<{ id: InspectorTab; label: string; icon: typeof Bot }> = [
  { id: 'ai', label: 'AI', icon: Bot },
  { id: 'design', label: 'Design', icon: SlidersHorizontal },
  { id: 'comments', label: 'Comments', icon: MessageCircle },
  { id: 'versions', label: 'Versions', icon: History },
  { id: 'data', label: 'Evidence', icon: Database },
  { id: 'json', label: 'JSON', icon: Braces },
  { id: 'trace', label: 'Trace', icon: Activity },
];

export function InspectorPanel<CommandId extends string = string>({
  workspace,
  slide,
  selectedElements,
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
  onAddComment,
  onReply,
  onSetCommentStatus,
  onSendCommentToAi,
  onRestoreVersion,
}: InspectorPanelProps<CommandId>) {
  const resizeRef = useRef<ResizeState | null>(null);

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

  if (collapsed) {
    return (
      <aside
        className="ns-inspector is-collapsed"
        aria-label="Inspector collapsed"
        data-testid="inspector"
      >
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
          {tabs.map(({ id, label, icon: Icon }) => (
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
      </aside>
    );
  }

  return (
    <aside
      className="ns-inspector"
      aria-label="NodeSlide inspector"
      style={{ width }}
      data-testid="inspector"
    >
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
          </div>
        </div>
        <button
          className="ns-icon-button"
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Collapse inspector"
        >
          <PanelRightClose size={16} />
        </button>
      </div>
      <div className="ns-inspector-tabs" role="tablist" aria-label="Inspector views">
        {tabs.map(({ id, label, icon: Icon }) => (
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
            onClick={() => onTabChange(id)}
            onKeyDown={(event) => handleInspectorTabKeyDown(event, id, onTabChange)}
          >
            <Icon size={14} />
            <span>{label}</span>
            {id === 'comments' && openComments > 0 ? <i>{openComments}</i> : null}
            {id === 'ai' && (agentBusy || variationBusy) ? <i className="is-live" /> : null}
          </button>
        ))}
      </div>

      <div
        className="ns-inspector-content"
        role="tabpanel"
        id={`ns-tabpanel-${activeTab}`}
        aria-labelledby={`ns-tab-${activeTab}`}
      >
        {activeTab === 'ai' ? (
          <AiInspector
            key={workspace.deck.id}
            deck={workspace.deck}
            slide={slide}
            selectedElements={selectedElements}
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
            {...(onClearAiCommentContext ? { onClearCommentContext: onClearAiCommentContext } : {})}
            onPropose={onProposeEdit}
            {...(onAttachAiDataFile ? { onAttachDataFile: onAttachAiDataFile } : {})}
            {...(onCreateAiMemory ? { onCreateMemory: onCreateAiMemory } : {})}
            {...(onUpdateAiMemory ? { onUpdateMemory: onUpdateAiMemory } : {})}
            {...(onDeleteAiMemory ? { onDeleteMemory: onDeleteAiMemory } : {})}
            {...(onCancelAiRun ? { onCancelRun: onCancelAiRun } : {})}
            onAccept={onAcceptPatch}
            onReject={onRejectPatch}
            onGenerateVariations={onGenerateVariations}
            onPreviewVariation={onPreviewVariation}
            onAcceptVariation={onAcceptVariation}
            onRejectVariation={onRejectVariation}
          />
        ) : null}
        {activeTab === 'design' ? (
          <DesignInspector
            slide={slide}
            slideElements={workspace.elements.filter((element) => element.slideId === slide.id)}
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
        ) : null}
        {activeTab === 'comments' ? (
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
        ) : null}
        {activeTab === 'versions' ? (
          <VersionsInspector
            deck={workspace.deck}
            versions={workspace.versions}
            patches={workspace.patches}
            onRestore={onRestoreVersion}
          />
        ) : null}
        {activeTab === 'data' ? (
          <DataInspector
            sources={workspace.sources}
            selectedElements={selectedElements}
            {...(onDeleteAiDataSource ? { onDeleteSource: onDeleteAiDataSource } : {})}
          />
        ) : null}
        {activeTab === 'json' ? (
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
            onApplyPatch={onApplyDesignPatch}
          />
        ) : null}
        {activeTab === 'trace' ? (
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
    </aside>
  );
}

function clampWidth(width: number) {
  return Math.min(560, Math.max(304, width));
}

function handleInspectorTabKeyDown(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  currentTab: InspectorTab,
  onTabChange: (tab: InspectorTab) => void,
) {
  const currentIndex = tabs.findIndex(({ id }) => id === currentTab);
  let nextIndex = currentIndex;
  if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
  else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = tabs.length - 1;
  else return;
  event.preventDefault();
  const nextTab = tabs[nextIndex]?.id;
  if (!nextTab) return;
  onTabChange(nextTab);
  requestAnimationFrame(() => document.getElementById(`ns-tab-${nextTab}`)?.focus());
}

function validationLabel(validation: NodeSlideWorkspace['validations'][number] | undefined) {
  if (!validation) return 'Awaiting validation';
  if (!validation.ok) return `${validation.issues.length} structure checks need review`;
  if (!validation.publishOk) return `${validation.issues.length} issues block presenting or export`;
  if (!validation.cleanOk) return `${validation.issues.length} cleanup warnings`;
  return 'Structure, presentation, and cleanup checks passed';
}
