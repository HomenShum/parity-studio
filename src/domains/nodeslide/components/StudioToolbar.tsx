import {
  ChevronDown,
  Command,
  Download,
  FileCode2,
  FileType2,
  Globe2,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  Play,
  Redo2,
  RotateCcw,
  Share2,
  Sparkles,
  Sun,
  Undo2,
} from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import type { Presence } from '../../../../shared/nodeslide';

export type StudioThemeMode = 'light' | 'dark';
export type StudioLanguage = 'en' | 'zh-CN';

export interface StudioToolbarProps {
  title: string;
  version: number;
  presence: readonly Presence[];
  canUndo: boolean;
  canRedo: boolean;
  inspectorCollapsed: boolean;
  themeMode?: StudioThemeMode;
  language?: StudioLanguage;
  plainLanguage?: boolean;
  copyIncludesContextAndSources?: boolean;
  navigatorCollapsed?: boolean;
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
  onThemeModeChange?: (mode: StudioThemeMode) => void;
  onLanguageChange?: (language: StudioLanguage) => void;
  onPlainLanguageChange?: (enabled: boolean) => void;
  onCopyIncludesContextAndSourcesChange?: (enabled: boolean) => void;
  onToggleNavigator?: () => void;
  onResetView?: () => void;
}

export function StudioToolbar({
  title,
  version,
  presence,
  canUndo,
  canRedo,
  inspectorCollapsed,
  themeMode,
  language,
  plainLanguage,
  copyIncludesContextAndSources,
  navigatorCollapsed = false,
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
  onThemeModeChange,
  onLanguageChange,
  onPlainLanguageChange,
  onCopyIncludesContextAndSourcesChange,
  onToggleNavigator,
  onResetView,
}: StudioToolbarProps) {
  const [draftTitle, setDraftTitle] = useState(title);
  const [exportOpen, setExportOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [localThemeMode, setLocalThemeMode] = useState<StudioThemeMode>('light');
  const [localLanguage, setLocalLanguage] = useState<StudioLanguage>('en');
  const [localPlainLanguage, setLocalPlainLanguage] = useState(false);
  const [localCopyIncludesContextAndSources, setLocalCopyIncludesContextAndSources] =
    useState(true);
  const exportRef = useRef<HTMLDivElement>(null);
  const languageRef = useRef<HTMLDivElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const languageTriggerRef = useRef<HTMLButtonElement>(null);
  const exportPopoverId = useId();
  const languagePopoverId = useId();
  const languageRadioName = useId();

  const activeThemeMode = themeMode ?? localThemeMode;
  const activeLanguage = language ?? localLanguage;
  const plainLanguageEnabled = plainLanguage ?? localPlainLanguage;
  const copyContextEnabled = copyIncludesContextAndSources ?? localCopyIncludesContextAndSources;

  useEffect(() => setDraftTitle(title), [title]);
  useEffect(() => {
    if (!exportOpen && !languageOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (exportOpen && !exportRef.current?.contains(target)) setExportOpen(false);
      if (languageOpen && !languageRef.current?.contains(target)) setLanguageOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const restoreFocus = languageOpen ? languageTriggerRef.current : exportTriggerRef.current;
      setExportOpen(false);
      setLanguageOpen(false);
      requestAnimationFrame(() => restoreFocus?.focus());
    };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [exportOpen, languageOpen]);

  const commitTitle = () => {
    const next = draftTitle.trim();
    if (next && next !== title) onTitleChange(next);
    else setDraftTitle(title);
  };

  const changeThemeMode = (next: StudioThemeMode) => {
    if (themeMode === undefined) setLocalThemeMode(next);
    onThemeModeChange?.(next);
  };

  const changeLanguage = (next: StudioLanguage) => {
    if (language === undefined) setLocalLanguage(next);
    onLanguageChange?.(next);
  };

  const changePlainLanguage = (next: boolean) => {
    if (plainLanguage === undefined) setLocalPlainLanguage(next);
    onPlainLanguageChange?.(next);
  };

  const changeCopyContext = (next: boolean) => {
    if (copyIncludesContextAndSources === undefined) {
      setLocalCopyIncludesContextAndSources(next);
    }
    onCopyIncludesContextAndSourcesChange?.(next);
  };

  return (
    <header
      className="ns-toolbar ns-toolbar--v3"
      data-theme-mode={activeThemeMode}
      data-language={activeLanguage}
      onKeyDown={stopStudioNavigationFromControls}
    >
      <div className="ns-toolbar-left">
        <button
          className="ns-toolbar-brand ns-toolbar-brand--v3"
          type="button"
          onClick={onOpenProjects}
          aria-label="Create or open a NodeSlide deck"
          data-testid="new-deck-trigger"
        >
          <span className="ns-wordmark-mark ns-wordmark-mark--v3" aria-hidden="true">
            N
          </span>
          <span className="ns-wordmark">NodeSlide</span>
        </button>

        <span className="ns-toolbar-slash" aria-hidden="true">
          /
        </span>

        <div className="ns-deck-identity ns-deck-identity--v3">
          <input
            aria-label="Deck title"
            data-testid="deck-title"
            className="ns-title-input ns-title-input--v3"
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
          <span className="ns-version-label ns-version-pill">v{version}</span>
        </div>

        {onToggleNavigator ? (
          <button
            className="ns-icon-button ns-navigator-toggle"
            type="button"
            onClick={onToggleNavigator}
            aria-label={navigatorCollapsed ? 'Open slide navigator' : 'Collapse slide navigator'}
            aria-pressed={navigatorCollapsed}
            title={navigatorCollapsed ? 'Open slide navigator' : 'Collapse slide navigator'}
          >
            {navigatorCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        ) : null}
      </div>

      <div className="ns-toolbar-center">
        <div className="ns-control-group ns-toolbar-history" aria-label="History controls">
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
      </div>

      <div className="ns-toolbar-actions ns-toolbar-actions--v3">
        <button
          className="ns-icon-button ns-theme-toggle"
          type="button"
          aria-label={activeThemeMode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-pressed={activeThemeMode === 'dark'}
          title={activeThemeMode === 'dark' ? 'Light theme' : 'Dark theme'}
          onClick={() => changeThemeMode(activeThemeMode === 'dark' ? 'light' : 'dark')}
        >
          {activeThemeMode === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        <div className="ns-export-menu ns-language-menu" ref={languageRef}>
          <button
            ref={languageTriggerRef}
            className="ns-button ns-button--quiet ns-language-trigger"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={languageOpen}
            aria-controls={languagePopoverId}
            aria-label={`Language and clarity: ${languageLabel(activeLanguage)}`}
            title="Language & clarity"
            onClick={() => {
              setExportOpen(false);
              setLanguageOpen((value) => !value);
            }}
          >
            <Globe2 size={14} />
            <span>{activeLanguage === 'en' ? 'EN' : '简'}</span>
            <ChevronDown size={12} />
          </button>

          {languageOpen ? (
            <dialog
              open
              className="ns-popover ns-export-popover ns-language-popover"
              id={languagePopoverId}
              aria-label="Language and clarity"
            >
              <header className="ns-language-popover-heading">
                <strong>Language &amp; clarity</strong>
                <small>
                  English is active. Additional localization and copy policies are preview-only.
                </small>
              </header>

              <div
                className="ns-language-options"
                role="radiogroup"
                aria-label="Presentation language"
              >
                <label
                  className={`ns-language-option ${activeLanguage === 'en' ? 'is-active' : ''}`}
                >
                  <input
                    className="ns-sr-only"
                    type="radio"
                    name={languageRadioName}
                    value="en"
                    checked={activeLanguage === 'en'}
                    onChange={() => changeLanguage('en')}
                  />
                  <span>English</span>
                  <small>EN</small>
                </label>
                <label
                  className={`ns-language-option ${activeLanguage === 'zh-CN' ? 'is-active' : ''}`}
                >
                  <input
                    className="ns-sr-only"
                    type="radio"
                    name={languageRadioName}
                    value="zh-CN"
                    checked={activeLanguage === 'zh-CN'}
                    disabled
                    onChange={() => changeLanguage('zh-CN')}
                  />
                  <span>简体中文</span>
                  <small>简</small>
                </label>
              </div>

              <div className="ns-clarity-options">
                <label className="ns-clarity-toggle">
                  <input
                    type="checkbox"
                    checked={plainLanguageEnabled}
                    disabled
                    onChange={(event) => changePlainLanguage(event.currentTarget.checked)}
                  />
                  <span>
                    <strong>Plain language</strong>
                    <small>Prefer direct, broadly readable wording.</small>
                  </span>
                </label>
                <label className="ns-clarity-toggle">
                  <input
                    type="checkbox"
                    checked={copyContextEnabled}
                    disabled
                    onChange={(event) => changeCopyContext(event.currentTarget.checked)}
                  />
                  <span>
                    <strong>Copy includes context + sources</strong>
                    <small>Keep evidence and source context attached when copying.</small>
                  </span>
                </label>
              </div>
            </dialog>
          ) : null}
        </div>

        {onResetView ? (
          <button
            className="ns-button ns-button--quiet ns-reset-view"
            type="button"
            onClick={() => {
              setExportOpen(false);
              setLanguageOpen(false);
              onResetView();
            }}
            aria-label="Reset demo view"
            title="Reset the local demo view"
          >
            <RotateCcw size={14} /> <span>Reset demo</span>
          </button>
        ) : null}

        {presence.length > 0 ? (
          <div
            className="ns-presence ns-toolbar-presence"
            aria-label={`${presence.length} collaborators present`}
          >
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
        ) : null}

        <button
          className="ns-button ns-button--quiet ns-toolbar-labeled ns-toolbar-share"
          type="button"
          onClick={onShare}
          aria-label="Share deck"
          title="Share deck"
          data-testid="share"
        >
          <Share2 size={15} /> <span>Share</span>
        </button>
        <button
          className="ns-button ns-button--quiet ns-toolbar-labeled ns-toolbar-present"
          type="button"
          onClick={onPresent}
          aria-label="Present deck"
          title="Present deck"
          data-testid="present"
        >
          <Play size={14} /> <span>Present</span>
        </button>

        <div className="ns-export-menu" ref={exportRef}>
          <button
            ref={exportTriggerRef}
            className="ns-button ns-button--accent ns-toolbar-labeled ns-toolbar-export"
            type="button"
            aria-haspopup="menu"
            aria-expanded={exportOpen}
            aria-controls={exportPopoverId}
            aria-label="Export deck"
            title="Export deck"
            onClick={() => {
              setLanguageOpen(false);
              setExportOpen((value) => !value);
            }}
          >
            <Download size={15} /> <span>Export</span> <ChevronDown size={13} />
          </button>
          {exportOpen ? (
            <div className="ns-popover ns-export-popover" id={exportPopoverId} role="menu">
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
          className="ns-command-button ns-command-button--compact ns-toolbar-secondary"
          type="button"
          onClick={onOpenCommandPalette}
          aria-label="Open command palette"
          title="Commands (Command K)"
        >
          <Sparkles size={14} />
          <span className="ns-sr-only">Commands</span>
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
            <PanelRightOpen size={16} />
          </button>
        ) : null}
      </div>
    </header>
  );
}

function languageLabel(language: StudioLanguage) {
  return language === 'en' ? 'English' : '简体中文';
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
