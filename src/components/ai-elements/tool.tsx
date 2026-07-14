'use client';

import { cn } from '@/lib/utils';
import type { DynamicToolUIPart, ToolUIPart } from 'ai';
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from 'lucide-react';
import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { isValidElement } from 'react';

export type ToolProps = ComponentProps<typeof CollapsiblePrimitive.Root>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <CollapsiblePrimitive.Root
    className={cn('group not-prose mb-4 w-full rounded-md border', className)}
    {...props}
  />
);

export type ToolPart = ToolUIPart | DynamicToolUIPart;

type ToolHeaderTriggerProps = Omit<ComponentProps<typeof CollapsiblePrimitive.Trigger>, 'type'>;

export type ToolHeaderProps = ToolHeaderTriggerProps &
  (
    | { type: ToolUIPart['type']; state: ToolUIPart['state']; toolName?: never }
    | {
        type: DynamicToolUIPart['type'];
        state: DynamicToolUIPart['state'];
        toolName: string;
      }
  );

const statusLabels: Record<ToolPart['state'], string> = {
  'approval-requested': 'Awaiting Approval',
  'approval-responded': 'Responded',
  'input-available': 'Running',
  'input-streaming': 'Pending',
  'output-available': 'Completed',
  'output-denied': 'Denied',
  'output-error': 'Error',
};

const statusIcons: Record<ToolPart['state'], ReactNode> = {
  'approval-requested': <ClockIcon className="size-4 text-yellow-600" />,
  'approval-responded': <CheckCircleIcon className="size-4 text-blue-600" />,
  'input-available': <ClockIcon className="size-4 animate-pulse" />,
  'input-streaming': <CircleIcon className="size-4" />,
  'output-available': <CheckCircleIcon className="size-4 text-green-600" />,
  'output-denied': <XCircleIcon className="size-4 text-orange-600" />,
  'output-error': <XCircleIcon className="size-4 text-red-600" />,
};

export const getStatusBadge = (status: ToolPart['state']) => (
  <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-xs">
    {statusIcons[status]}
    {statusLabels[status]}
  </span>
);

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  toolName,
  ...props
}: ToolHeaderProps & { title?: string }) => {
  const derivedName = type === 'dynamic-tool' ? toolName : type.split('-').slice(1).join('-');

  return (
    <CollapsiblePrimitive.Trigger
      className={cn('flex w-full items-center justify-between gap-4 p-3', className)}
      {...props}
    >
      <div className="flex items-center gap-2">
        <WrenchIcon className="size-4 text-muted-foreground" />
        <span className="font-medium text-sm">{title ?? derivedName}</span>
        {getStatusBadge(state)}
      </div>
      <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
    </CollapsiblePrimitive.Trigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsiblePrimitive.Content>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsiblePrimitive.Content
    className={cn(
      'space-y-4 p-4 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:animate-in data-[state=open]:slide-in-from-top-2',
      className,
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<'div'> & {
  input: ToolPart['input'];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn('space-y-2 overflow-hidden', className)} {...props}>
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
      Parameters
    </h4>
    <ToolValue value={input} />
  </div>
);

export type ToolOutputProps = ComponentProps<'div'> & {
  output?: ToolPart['output'];
  errorText?: ToolPart['errorText'];
};

export const ToolOutput = ({ className, output, errorText, ...props }: ToolOutputProps) => {
  if (output === undefined && !errorText) return null;

  return (
    <div className={cn('space-y-2', className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? 'Error' : 'Result'}
      </h4>
      <div
        className={cn(
          'overflow-x-auto rounded-md text-xs [&_table]:w-full',
          errorText ? 'bg-destructive/10 text-destructive' : 'bg-muted/50 text-foreground',
        )}
      >
        {errorText ? <div>{errorText}</div> : null}
        {output !== undefined ? <ToolValue value={output} /> : null}
      </div>
    </div>
  );
};

function ToolValue({ value }: { value: unknown }) {
  if (isValidElement(value)) return value;
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 text-xs">
      <code>{text ?? String(value)}</code>
    </pre>
  );
}
