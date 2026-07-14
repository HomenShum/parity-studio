'use client';

import { cn } from '@/lib/utils';
import { ChevronDownIcon, SearchIcon } from 'lucide-react';
import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

export type TaskItemFileProps = ComponentProps<'div'>;

export const TaskItemFile = ({ children, className, ...props }: TaskItemFileProps) => (
  <div
    className={cn(
      'inline-flex items-center gap-1 rounded-md border bg-secondary px-1.5 py-0.5 text-foreground text-xs',
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

export type TaskItemProps = ComponentProps<'div'>;

export const TaskItem = ({ children, className, ...props }: TaskItemProps) => (
  <div className={cn('text-muted-foreground text-sm', className)} {...props}>
    {children}
  </div>
);

export type TaskProps = ComponentProps<typeof CollapsiblePrimitive.Root>;

export const Task = ({ defaultOpen = true, className, ...props }: TaskProps) => (
  <CollapsiblePrimitive.Root className={cn(className)} defaultOpen={defaultOpen} {...props} />
);

export type TaskTriggerProps = ComponentProps<typeof CollapsiblePrimitive.Trigger> & {
  title: string;
};

export const TaskTrigger = ({ children, className, title, ...props }: TaskTriggerProps) => (
  <CollapsiblePrimitive.Trigger asChild className={cn('group', className)} {...props}>
    {children ?? (
      <div className="flex w-full cursor-pointer items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground">
        <SearchIcon className="size-4" />
        <p className="text-sm">{title}</p>
        <ChevronDownIcon className="size-4 transition-transform group-data-[state=open]:rotate-180" />
      </div>
    )}
  </CollapsiblePrimitive.Trigger>
);

export type TaskContentProps = ComponentProps<typeof CollapsiblePrimitive.Content>;

export const TaskContent = ({ children, className, ...props }: TaskContentProps) => (
  <CollapsiblePrimitive.Content
    className={cn(
      'text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:animate-in data-[state=open]:slide-in-from-top-2',
      className,
    )}
    {...props}
  >
    <div className="mt-4 space-y-2 border-muted border-l-2 pl-4">{children}</div>
  </CollapsiblePrimitive.Content>
);
