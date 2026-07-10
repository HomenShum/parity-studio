import {
  Activity,
  Bot,
  ChevronLeft,
  ChevronRight,
  Database,
  History,
  MessageCircle,
  PanelRightClose,
  SlidersHorizontal,
} from 'lucide-react';
import { type PointerEvent as ReactPointerEvent, useEffect, useRef } from 'react';
import type {
  CommentAnchor,
  DeckPatch,
  DeckVersion,
  NodeSlideWorkspace,
  PatchOperation,
  PatchScope,
  Slide,
  SlideElement,
} from '../../../../shared/nodeslide';
import { AiInspector } from './AiInspector';
import { CommentsInspector } from './CommentsInspector';
import { DataInspector } from './DataInspector';
import { DesignInspector } from './DesignInspector';
import { TraceInspector } from './TraceInspector';
import { VersionsInspector } from './VersionsInspector';
import type { InspectorTab } from './types';

interface ResizeState {
  pointerId: number;
  startX: number;
  startWidth: number;
}

interface InspectorPanelProps {
  workspace: NodeSlideWorkspace;
  slide: Slide;
  selectedElements: readonly SlideElement[];
  activeTab: InspectorTab;
  collapsed: boolean;
  width: number;
  agentBusy: boolean;
  onTabChange: (tab: InspectorTab) => void;
  onToggleCollapsed: () => void;
  onWidthChange: (width: number) => void;
  onProposeEdit: (instruction: string, scope: PatchScope) => void;
  onAcceptPatch: (patch: DeckPatch) => void;
  onRejectPatch: (patch: DeckPatch) => void;
  onApplyDesignPatch: (operations: PatchOperation[], summary: string) => void;
  onAddComment: (text: string, anchor: CommentAnchor) => void;
  onReply: (parentId: string, text: string) => void;
  onSetCommentStatus: (commentId: string, status: 'open' | 'resolved') => void;
  onRestoreVersion: (version: DeckVersion) => void;
}

const tabs: Array<{ id: InspectorTab; label: string; icon: typeof Bot }> = [
  { id: 'ai', label: 'AI', icon: Bot },
  { id: 'design', label: 'Design', icon: SlidersHorizontal },
  { id: 'comments', label: 'Comments', icon: MessageCircle },
  { id: 'versions', label: 'Versions', icon: History },
  { id: 'data', label: 'Data', icon: Database },
  { id: 'trace', label: 'Trace', icon: Activity },
];

export function InspectorPanel({
  workspace,
  slide,
  selectedElements,
  activeTab,
  collapsed,
  width,
  agentBusy,
  onTabChange,
  onToggleCollapsed,
  onWidthChange,
  onProposeEdit,
  onAcceptPatch,
  onRejectPatch,
  onApplyDesignPatch,
  onAddComment,
  onReply,
  onSetCommentStatus,
  onRestoreVersion,
}: InspectorPanelProps) {
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
          {tabs.slice(0, 4).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
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
        aria-label="Resize inspector"
        title="Drag to resize inspector"
      />
      <div className="ns-inspector-topbar">
        <div>
          <span className="ns-eyebrow">Inspector</span>
          <strong>
            {selectedElements.length > 0 ? `${selectedElements.length} selected` : slide.title}
          </strong>
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
            onClick={() => onTabChange(id)}
          >
            <Icon size={14} />
            <span>{label}</span>
            {id === 'comments' && openComments > 0 ? <i>{openComments}</i> : null}
            {id === 'ai' && agentBusy ? <i className="is-live" /> : null}
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
            deck={workspace.deck}
            slide={slide}
            selectedElements={selectedElements}
            patches={workspace.patches}
            traces={workspace.traces}
            isSubmitting={agentBusy}
            onPropose={onProposeEdit}
            onAccept={onAcceptPatch}
            onReject={onRejectPatch}
          />
        ) : null}
        {activeTab === 'design' ? (
          <DesignInspector
            slide={slide}
            selectedElements={selectedElements}
            theme={workspace.deck.theme}
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
          <DataInspector sources={workspace.sources} selectedElements={selectedElements} />
        ) : null}
        {activeTab === 'trace' ? (
          <TraceInspector traces={workspace.traces} validations={workspace.validations} />
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

function validationLabel(validation: NodeSlideWorkspace['validations'][number] | undefined) {
  if (!validation) return 'Awaiting validation';
  if (!validation.ok) return `${validation.issues.length} structure checks need review`;
  if (!validation.publishOk) return `${validation.issues.length} issues block presenting or export`;
  if (!validation.cleanOk) return `${validation.issues.length} cleanup warnings`;
  return 'Structure, presentation, and cleanup checks passed';
}
