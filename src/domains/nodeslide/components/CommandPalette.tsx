import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import {
  Bot,
  Command,
  FilePlus2,
  MessageCircle,
  MonitorPlay,
  SlidersHorizontal,
} from 'lucide-react';

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
  return (
    <CommandDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      title="Command palette"
      description="Search NodeSlide commands"
      className="ns-command-palette"
      overlayClassName="nodeslide-studio ns-modal-backdrop"
      portalContainer={
        typeof document === 'undefined'
          ? null
          : document.querySelector<HTMLElement>('.nodeslide-studio:not(.ns-modal-backdrop)')
      }
      showCloseButton={false}
    >
      <CommandInput autoFocus className="ns-command-search" placeholder="Search commands…" />
      <CommandList className="ns-command-results">
        <CommandEmpty className="ns-command-empty">No commands match.</CommandEmpty>
        {commands.map((command) => {
          const Icon = icons[command.icon];
          return (
            <CommandItem
              key={command.id}
              value={`${command.label} ${command.detail} ${command.group}`}
              onSelect={() => {
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
              <CommandShortcut>{command.shortcut ?? command.group}</CommandShortcut>
            </CommandItem>
          );
        })}
      </CommandList>
      <footer>
        <span>
          <Command size={11} />K to open
        </span>
        <span>↑↓ navigate</span>
        <span>↵ run</span>
      </footer>
    </CommandDialog>
  );
}
