import {
  Bot,
  Command,
  FilePlus2,
  MessageCircle,
  MonitorPlay,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useModalDialog } from './useModalDialog';

export interface StudioCommand {
  id: string;
  label: string;
  detail: string;
  group: 'Create' | 'Navigate' | 'Share';
  icon: 'ai' | 'design' | 'comments' | 'present' | 'new';
  shortcut?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  commands: readonly StudioCommand[];
  onClose: () => void;
}

const icons = {
  ai: Bot,
  design: SlidersHorizontal,
  comments: MessageCircle,
  present: MonitorPlay,
  new: FilePlus2,
};

export function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const paletteId = useId();
  const resultsId = `${paletteId}-results`;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? commands.filter((command) =>
          `${command.label} ${command.detail}`.toLowerCase().includes(needle),
        )
      : [...commands];
  }, [commands, query]);
  const activeOptionId = filtered[activeIndex] ? `${resultsId}-option-${activeIndex}` : undefined;
  const { dialogRef, handleBackdropMouseDown, handleCancel, handleKeyDown } = useModalDialog({
    open,
    onClose,
    initialFocusRef: searchInputRef,
  });

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="ns-modal-backdrop ns-command-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <dialog
        ref={dialogRef}
        className="ns-command-palette"
        aria-label="Command palette"
        aria-modal="true"
        tabIndex={-1}
        onCancel={handleCancel}
        onKeyDown={handleKeyDown}
        onMouseDown={handleBackdropMouseDown}
      >
        <label className="ns-command-search">
          <Search size={17} />
          <input
            ref={searchInputRef}
            type="search"
            aria-label="Search commands"
            aria-controls={resultsId}
            aria-activedescendant={activeOptionId}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder="Search commands…"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((index) =>
                  filtered.length > 0 ? (index + 1) % filtered.length : 0,
                );
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) =>
                  filtered.length > 0 ? (index - 1 + filtered.length) % filtered.length : 0,
                );
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                const command = filtered[activeIndex];
                if (command) {
                  onClose();
                  command.run();
                }
              }
            }}
          />
          <kbd>ESC</kbd>
        </label>
        <div className="ns-command-results" id={resultsId}>
          {filtered.map((command, index) => {
            const Icon = icons[command.icon];
            return (
              <button
                id={`${resultsId}-option-${index}`}
                type="button"
                aria-current={index === activeIndex ? 'true' : undefined}
                tabIndex={-1}
                className={index === activeIndex ? 'is-active' : ''}
                key={command.id}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  onClose();
                  command.run();
                }}
              >
                <span className="ns-command-result-icon">
                  <Icon size={16} />
                </span>
                <span>
                  <strong>{command.label}</strong>
                  <small>{command.detail}</small>
                </span>
                {command.shortcut ? <kbd>{command.shortcut}</kbd> : <span>{command.group}</span>}
              </button>
            );
          })}
          {filtered.length === 0 ? (
            <output className="ns-command-empty">No commands match “{query}”.</output>
          ) : null}
        </div>
        <footer>
          <span>
            <Command size={11} />K to open
          </span>
          <span>↑↓ navigate</span>
          <span>↵ run</span>
        </footer>
      </dialog>
    </div>
  );
}
