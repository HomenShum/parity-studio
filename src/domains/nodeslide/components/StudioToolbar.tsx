import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  ChevronDown,
  Command,
  Download,
  FileCode2,
  FileJson2,
  FilePlus2,
  FileType2,
  FolderOpen,
  Globe2,
  KeyRound,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  Play,
  Plug,
  Redo2,
  RotateCcw,
  Share2,
  Sparkles,
  Sun,
  Trash2,
  Undo2,
} from 'lucide-react';
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useState } from 'react';
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
  onNewDeck: () => void;
  onOpenProjects: () => void;
  onOpenConnections: () => void;
  onBackupRecoveryKey: () => void;
  onDeleteDeck: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onShare: () => void;
  onPresent: () => void;
  onExportHtml: () => void;
  onExportJson: () => void;
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
  onNewDeck,
  onOpenProjects,
  onOpenConnections,
  onBackupRecoveryKey,
  onDeleteDeck,
  onUndo,
  onRedo,
  onShare,
  onPresent,
  onExportHtml,
  onExportJson,
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
  const [projectOpen, setProjectOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [localThemeMode, setLocalThemeMode] = useState<StudioThemeMode>('light');
  const [localLanguage, setLocalLanguage] = useState<StudioLanguage>('en');
  const [localPlainLanguage, setLocalPlainLanguage] = useState(false);
  const [localCopyIncludesContextAndSources, setLocalCopyIncludesContextAndSources] =
    useState(true);

  const activeThemeMode = themeMode ?? localThemeMode;
  const activeLanguage = language ?? localLanguage;
  const plainLanguageEnabled = plainLanguage ?? localPlainLanguage;
  const copyContextEnabled = copyIncludesContextAndSources ?? localCopyIncludesContextAndSources;

  useEffect(() => setDraftTitle(title), [title]);

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
        <div className="ns-toolbar-brand ns-toolbar-brand--v3">
          <span className="ns-wordmark-mark ns-wordmark-mark--v3" aria-hidden="true">
            N
          </span>
          <span className="ns-wordmark">NodeSlide</span>
        </div>

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
        <DropdownMenu
          open={projectOpen}
          onOpenChange={(nextOpen) => {
            setProjectOpen(nextOpen);
            if (nextOpen) {
              setExportOpen(false);
              setLanguageOpen(false);
            }
          }}
        >
          <div className="ns-export-menu ns-project-menu">
            <DropdownMenuTrigger asChild>
              <button
                className="ns-button ns-button--quiet ns-toolbar-labeled"
                type="button"
                aria-label="Project actions"
                title="Project actions"
                data-testid="project-actions-trigger"
              >
                <FolderOpen size={14} /> <span>Project</span> <ChevronDown size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              aria-label="Project actions"
              className="ns-popover ns-export-popover ns-project-popover"
              portalContainer={
                typeof document === 'undefined'
                  ? null
                  : document.querySelector<HTMLElement>('.nodeslide-studio')
              }
            >
              {[
                {
                  testId: 'new-deck-trigger',
                  icon: FilePlus2,
                  label: 'New deck',
                  detail: 'Start from the prompt-first landing',
                  run: onNewDeck,
                },
                {
                  icon: FolderOpen,
                  label: 'Open deck',
                  detail: 'Choose a deck owned by this browser',
                  run: onOpenProjects,
                },
                {
                  icon: Plug,
                  label: 'Connections',
                  detail: 'Google Slides, model keys, and MCP',
                  run: onOpenConnections,
                },
                {
                  icon: KeyRound,
                  label: 'Back up recovery key',
                  detail: "Copy this deck's private owner key",
                  run: onBackupRecoveryKey,
                },
                {
                  icon: Trash2,
                  label: 'Delete deck',
                  detail: 'Permanently erase this deck and its data',
                  run: onDeleteDeck,
                  destructive: true,
                },
              ].map(({ testId, icon: Icon, label, detail, run, destructive }) => (
                <DropdownMenuItem
                  key={label}
                  asChild
                  variant={destructive ? 'destructive' : 'default'}
                >
                  <button type="button" data-testid={testId} onClick={run}>
                    <span className="ns-menu-icon">
                      <Icon size={17} />
                    </span>
                    <span>
                      <strong>{label}</strong>
                      <small>{detail}</small>
                    </span>
                  </button>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </div>
        </DropdownMenu>

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

        <Popover
          open={languageOpen}
          onOpenChange={(nextOpen) => {
            setLanguageOpen(nextOpen);
            if (nextOpen) {
              setProjectOpen(false);
              setExportOpen(false);
            }
          }}
        >
          <div className="ns-export-menu ns-language-menu">
            <PopoverTrigger asChild>
              <button
                className="ns-button ns-button--quiet ns-language-trigger"
                type="button"
                aria-label={`Language and clarity: ${languageLabel(activeLanguage)}`}
                title="Language & clarity"
              >
                <Globe2 size={14} />
                <span>{activeLanguage === 'en' ? 'EN' : '简'}</span>
                <ChevronDown size={12} />
              </button>
            </PopoverTrigger>

            <PopoverContent
              align="end"
              aria-label="Language and clarity"
              className="ns-popover ns-export-popover ns-language-popover"
              portalContainer={
                typeof document === 'undefined'
                  ? null
                  : document.querySelector<HTMLElement>('.nodeslide-studio')
              }
            >
              <header className="ns-language-popover-heading">
                <strong>Language &amp; clarity</strong>
                <small>
                  English is active. Additional localization and copy policies are preview-only.
                </small>
              </header>

              <RadioGroup
                className="ns-language-options"
                aria-label="Presentation language"
                value={activeLanguage}
                onValueChange={(value) => changeLanguage(value as StudioLanguage)}
              >
                <label
                  htmlFor="ns-language-en"
                  className={`ns-language-option ${activeLanguage === 'en' ? 'is-active' : ''}`}
                >
                  <RadioGroupItem id="ns-language-en" className="ns-sr-only" value="en" />
                  <span>English</span>
                  <small>EN</small>
                </label>
                <label
                  htmlFor="ns-language-zh-cn"
                  className={`ns-language-option ${activeLanguage === 'zh-CN' ? 'is-active' : ''}`}
                >
                  <RadioGroupItem
                    id="ns-language-zh-cn"
                    className="ns-sr-only"
                    value="zh-CN"
                    disabled
                  />
                  <span>简体中文</span>
                  <small>简</small>
                </label>
              </RadioGroup>

              <div className="ns-clarity-options">
                <label className="ns-clarity-toggle" htmlFor="ns-plain-language">
                  <Checkbox
                    id="ns-plain-language"
                    type="button"
                    checked={plainLanguageEnabled}
                    disabled
                    onCheckedChange={(checked) => changePlainLanguage(checked === true)}
                  />
                  <span>
                    <strong>Plain language</strong>
                    <small>Prefer direct, broadly readable wording.</small>
                  </span>
                </label>
                <label className="ns-clarity-toggle" htmlFor="ns-copy-context">
                  <Checkbox
                    id="ns-copy-context"
                    type="button"
                    checked={copyContextEnabled}
                    disabled
                    onCheckedChange={(checked) => changeCopyContext(checked === true)}
                  />
                  <span>
                    <strong>Copy includes context + sources</strong>
                    <small>Keep evidence and source context attached when copying.</small>
                  </span>
                </label>
              </div>
            </PopoverContent>
          </div>
        </Popover>

        {onResetView ? (
          <button
            className="ns-button ns-button--quiet ns-reset-view"
            type="button"
            onClick={() => {
              setProjectOpen(false);
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

        <DropdownMenu
          open={exportOpen}
          onOpenChange={(nextOpen) => {
            setExportOpen(nextOpen);
            if (nextOpen) {
              setProjectOpen(false);
              setLanguageOpen(false);
            }
          }}
        >
          <div className="ns-export-menu">
            <DropdownMenuTrigger asChild>
              <button
                className="ns-button ns-button--accent ns-toolbar-labeled ns-toolbar-export"
                type="button"
                aria-label="Export deck"
                title="Export deck"
              >
                <Download size={15} /> <span>Export</span> <ChevronDown size={13} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              aria-label="Export deck"
              className="ns-popover ns-export-popover"
              portalContainer={
                typeof document === 'undefined'
                  ? null
                  : document.querySelector<HTMLElement>('.nodeslide-studio')
              }
            >
              {[
                {
                  testId: 'export-html',
                  icon: FileCode2,
                  label: 'Interactive HTML',
                  detail: 'Web-native deck and notes',
                  run: onExportHtml,
                },
                {
                  testId: 'export-json',
                  icon: FileJson2,
                  label: 'Deck JSON',
                  detail: 'Validated, re-openable NodeSlide snapshot',
                  run: onExportJson,
                },
                {
                  testId: 'export-pptx',
                  icon: FileType2,
                  label: 'PowerPoint',
                  detail: 'Editable PPTX with fallbacks',
                  run: onExportPptx,
                },
              ].map(({ testId, icon: Icon, label, detail, run }) => (
                <DropdownMenuItem key={testId} asChild>
                  <button type="button" data-testid={testId} onClick={run}>
                    <span className="ns-menu-icon">
                      <Icon size={17} />
                    </span>
                    <span>
                      <strong>{label}</strong>
                      <small>{detail}</small>
                    </span>
                  </button>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </div>
        </DropdownMenu>

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

        <button
          className="ns-icon-button ns-inspector-reopen"
          type="button"
          onClick={onToggleInspector}
          aria-label={inspectorCollapsed ? 'Ask AI' : 'Close AI'}
          aria-controls="nodeslide-inspector"
          aria-expanded={!inspectorCollapsed}
          title={inspectorCollapsed ? 'Ask AI' : 'Close AI'}
        >
          <PanelRightOpen size={16} />
          <span className="ns-inspector-reopen-label">
            {inspectorCollapsed ? 'Ask AI' : 'Close AI'}
          </span>
        </button>
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
