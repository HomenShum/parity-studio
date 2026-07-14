'use client';

import { cn } from '@/lib/utils';
import { BookIcon, ChevronDownIcon } from 'lucide-react';
import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

export type SourcesProps = ComponentProps<typeof CollapsiblePrimitive.Root>;

export const Sources = ({ className, ...props }: SourcesProps) => (
  <CollapsiblePrimitive.Root
    className={cn('not-prose mb-4 text-primary text-xs', className)}
    {...props}
  />
);

export type SourcesTriggerProps = ComponentProps<typeof CollapsiblePrimitive.Trigger> & {
  count: number;
};

export const SourcesTrigger = ({ className, count, children, ...props }: SourcesTriggerProps) => (
  <CollapsiblePrimitive.Trigger className={cn('flex items-center gap-2', className)} {...props}>
    {children ?? (
      <>
        <p className="font-medium">Used {count} sources</p>
        <ChevronDownIcon className="h-4 w-4" />
      </>
    )}
  </CollapsiblePrimitive.Trigger>
);

export type SourcesContentProps = ComponentProps<typeof CollapsiblePrimitive.Content>;

export const SourcesContent = ({ className, ...props }: SourcesContentProps) => (
  <CollapsiblePrimitive.Content
    className={cn(
      'mt-3 flex w-fit flex-col gap-2 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:animate-in data-[state=open]:slide-in-from-top-2',
      className,
    )}
    {...props}
  />
);

export type SourceProps = ComponentProps<'a'>;

export const Source = ({ href, title, children, ...props }: SourceProps) => (
  <a
    className="flex items-center gap-2"
    href={href}
    rel="noreferrer noopener"
    target="_blank"
    {...props}
  >
    {children ?? (
      <>
        <BookIcon className="h-4 w-4" />
        <span className="block font-medium">{title}</span>
      </>
    )}
  </a>
);
