import {
  ChevronDown,
  Command,
  Download,
  FileCode2,
  FileType2,
  PanelRightClose,
  Play,
  Redo2,
  Share2,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';
import type { Presence } from '../../../../shared/nodeslide';

interface StudioToolbarProps {
  title: string;
  version: number;
  presence: readonly Presence[];
  canUndo: boolean;
  canRedo: boolean;
  inspectorCollapsed: boolean;
  onTitleChange: (title: string) => void;
  onOpenProjects: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onShare: () => void;
  onPresent: () => void;
  onExportHtml: () => void;
  onExportPptx: () => void;
  onOpenCommandPalette: () => void;
  onToggleInspector: () => void;
}

export function StudioToolbar({
  title,
  version,
  presence,
  canUndo,
  canRedo,
  inspectorCollapsed,
  onTitleChange,
  onOpenProjects,
  onUndo,
  onRedo,
  onShare,
  onPresent,
  onExportHtml,
  onExportPptx,
  onOpenCommandPalette,
  onToggleInspector,
}: StudioToolbarProps) {
  const [draftTitle, setDraftTitle] = useState(title);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDraftTitle(title), [title]);
  useEffect(() => {
    if (!exportOpen) return;
    const close = (event: MouseEvent) => {
      if (!exportRef.current?.contains(event.target as Node)) setExportOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [exportOpen]);

  const commitTitle = () => {
    const next = draftTitle.trim();
    if (next && next !== title) onTitleChange(next);
    else setDraftTitle(title);
  };

  return (
    <header className="ns-toolbar" onKeyDown={stopStudioNavigationFromControls}>
      <button
        className="ns-toolbar-brand"
        type="button"
        onClick={onOpenProjects}
        aria-label="Create or open a NodeSlide deck"
        data-testid="new-deck-trigger"
      >
        <span className="ns-wordmark-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="ns-wordmark">NodeSlide</span>
        <span className="ns-wordmark-badge">Studio</span>
      </button>

      <div className="ns-deck-identity">
        <input
          aria-label="Deck title"
          data-testid="deck-title"
          className="ns-title-input"
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setDraftTitle(title);
              event.currentTarget.blur();
            }
          }}
        />
        <span className="ns-version-label">
          <span className="ns-branch-dot" /> main · v{version}
        </span>
      </div>

      <div className="ns-toolbar-actions">
        <div className="ns-control-group" aria-label="History controls">
          <button
            className="ns-icon-button"
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 size={15} />
          </button>
          <button
            className="ns-icon-button"
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 size={15} />
          </button>
        </div>

        <div className="ns-presence" aria-label={`${presence.length} collaborators present`}>
          {presence.slice(0, 3).map((person) => (
            <span
              className="ns-avatar"
              key={person.id}
              title={person.displayName}
              style={{ background: person.color }}
            >
              {initials(person.displayName)}
            </span>
          ))}
          {presence.length > 3 ? (
            <span className="ns-avatar ns-avatar--more">+{presence.length - 3}</span>
          ) : null}
        </div>

        <button
          className="ns-button ns-button--quiet ns-toolbar-labeled"
          type="button"
          onClick={onShare}
          aria-label="Share deck"
          title="Share deck"
          data-testid="share"
        >
          <Share2 size={15} /> <span>Share</span>
        </button>
        <button
          className="ns-button ns-button--dark ns-toolbar-labeled"
          type="button"
          onClick={onPresent}
          aria-label="Present deck"
          title="Present deck"
          data-testid="present"
        >
          <Play size={14} fill="currentColor" /> <span>Present</span>
        </button>

        <div className="ns-export-menu" ref={exportRef}>
          <button
            className="ns-button ns-button--quiet ns-toolbar-labeled"
            type="button"
            aria-haspopup="menu"
            aria-expanded={exportOpen}
            aria-label="Export deck"
            title="Export deck"
            onClick={() => setExportOpen((value) => !value)}
          >
            <Download size={15} /> <span>Export</span> <ChevronDown size={13} />
          </button>
          {exportOpen ? (
            <div className="ns-popover ns-export-popover" role="menu">
              <button
                type="button"
                role="menuitem"
                data-testid="export-html"
                onClick={() => {
                  setExportOpen(false);
                  onExportHtml();
                }}
              >
                <span className="ns-menu-icon">
                  <FileCode2 size={17} />
                </span>
                <span>
                  <strong>Interactive HTML</strong>
                  <small>Web-native deck and notes</small>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="export-pptx"
                onClick={() => {
                  setExportOpen(false);
                  onExportPptx();
                }}
              >
                <span className="ns-menu-icon">
                  <FileType2 size={17} />
                </span>
                <span>
                  <strong>PowerPoint</strong>
                  <small>Editable PPTX with fallbacks</small>
                </span>
              </button>
            </div>
          ) : null}
        </div>

        <button
          className="ns-command-button"
          type="button"
          onClick={onOpenCommandPalette}
          aria-label="Open command palette"
        >
          <Sparkles size={14} />
          <span>Commands</span>
          <kbd>
            <Command size={10} />K
          </kbd>
        </button>
        {inspectorCollapsed ? (
          <button
            className="ns-icon-button ns-inspector-reopen"
            type="button"
            onClick={onToggleInspector}
            aria-label="Open inspector"
            title="Open inspector"
          >
            <PanelRightClose size={16} />
          </button>
        ) : null}
      </div>
    </header>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
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
