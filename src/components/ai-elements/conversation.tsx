'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { UIMessage } from 'ai';
import { ArrowDownIcon, DownloadIcon } from 'lucide-react';
import type { ComponentProps, ReactNode, RefObject } from 'react';
import { createContext, useCallback, useContext, useLayoutEffect, useRef } from 'react';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';

const EXTERNAL_SCROLL_BOTTOM_THRESHOLD_PX = 24;
const ExternalScrollOwnerContext = createContext(false);

export type ConversationProps = ComponentProps<typeof StickToBottom> & {
  /**
   * Keeps an existing review surface as the only scroll owner. When supplied,
   * Conversation follows that element only while `follow` is true.
   */
  scrollOwnerRef?: RefObject<HTMLElement | null>;
  follow?: boolean;
};

export const Conversation = ({
  children,
  className,
  contextRef,
  damping,
  follow = true,
  initial = 'smooth',
  instance,
  mass,
  resize = 'smooth',
  scrollOwnerRef,
  stiffness,
  targetScrollTop,
  ...props
}: ConversationProps) => {
  const previousOwner = useRef<HTMLElement | null>(null);
  const previousScrollHeight = useRef<number | null>(null);

  useLayoutEffect(() => {
    const owner = scrollOwnerRef?.current ?? null;
    if (!owner) return;
    if (previousOwner.current !== owner) {
      previousOwner.current = owner;
      previousScrollHeight.current = null;
    }

    const priorHeight = previousScrollHeight.current;
    const currentHeight = owner.scrollHeight;
    const wasAtBottom =
      priorHeight === null ||
      owner.scrollTop + owner.clientHeight >= priorHeight - EXTERNAL_SCROLL_BOTTOM_THRESHOLD_PX;

    if (follow && wasAtBottom) {
      owner.scrollTop = Math.max(0, currentHeight - owner.clientHeight);
    }
    previousScrollHeight.current = currentHeight;
  });

  if (scrollOwnerRef) {
    if (typeof children === 'function') {
      throw new Error('Function children require Conversation to own its scroll container.');
    }
    return (
      <ExternalScrollOwnerContext.Provider value>
        <div
          className={cn('relative', className)}
          data-follow={follow ? 'true' : 'false'}
          role="log"
          {...props}
        >
          {children as ReactNode}
        </div>
      </ExternalScrollOwnerContext.Provider>
    );
  }

  return (
    <StickToBottom
      className={cn('relative flex-1 overflow-y-hidden', className)}
      initial={initial}
      resize={resize}
      role="log"
      {...(contextRef !== undefined ? { contextRef } : {})}
      {...(damping !== undefined ? { damping } : {})}
      {...(instance !== undefined ? { instance } : {})}
      {...(mass !== undefined ? { mass } : {})}
      {...(stiffness !== undefined ? { stiffness } : {})}
      {...(targetScrollTop !== undefined ? { targetScrollTop } : {})}
      {...props}
    >
      {children}
    </StickToBottom>
  );
};

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

export const ConversationContent = ({
  children,
  className,
  scrollClassName,
  ...props
}: ConversationContentProps) => {
  const usesExternalScrollOwner = useContext(ExternalScrollOwnerContext);
  if (usesExternalScrollOwner) {
    if (typeof children === 'function') {
      throw new Error('Function children require Conversation to own its scroll container.');
    }
    return (
      <div className={cn('flex flex-col gap-8 p-4', className)} {...props}>
        {children}
      </div>
    );
  }
  return (
    <StickToBottom.Content
      className={cn('flex flex-col gap-8 p-4', className)}
      {...(scrollClassName !== undefined ? { scrollClassName } : {})}
      {...props}
    >
      {children}
    </StickToBottom.Content>
  );
};

export type ConversationEmptyStateProps = ComponentProps<'div'> & {
  title?: string;
  description?: string;
  icon?: ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = 'No messages yet',
  description = 'Start a conversation to see messages here',
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      'flex size-full flex-col items-center justify-center gap-3 p-8 text-center',
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon ? <div className="text-muted-foreground">{icon}</div> : null}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  return !isAtBottom ? (
    <Button
      className={cn(
        'absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full dark:bg-background dark:hover:bg-muted',
        className,
      )}
      onClick={handleScrollToBottom}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      <ArrowDownIcon className="size-4" />
    </Button>
  ) : null;
};

const getMessageText = (message: UIMessage): string =>
  message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');

export type ConversationDownloadProps = Omit<ComponentProps<typeof Button>, 'onClick'> & {
  messages: UIMessage[];
  filename?: string;
  formatMessage?: (message: UIMessage, index: number) => string;
};

const defaultFormatMessage = (message: UIMessage): string => {
  const roleLabel = message.role.charAt(0).toUpperCase() + message.role.slice(1);
  return `**${roleLabel}:** ${getMessageText(message)}`;
};

export const messagesToMarkdown = (
  messages: UIMessage[],
  formatMessage: (message: UIMessage, index: number) => string = defaultFormatMessage,
): string => messages.map((message, index) => formatMessage(message, index)).join('\n\n');

export const ConversationDownload = ({
  messages,
  filename = 'conversation.md',
  formatMessage = defaultFormatMessage,
  className,
  children,
  ...props
}: ConversationDownloadProps) => {
  const handleDownload = useCallback(() => {
    const markdown = messagesToMarkdown(messages, formatMessage);
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [messages, filename, formatMessage]);

  return (
    <Button
      className={cn(
        'absolute top-4 right-4 rounded-full dark:bg-background dark:hover:bg-muted',
        className,
      )}
      onClick={handleDownload}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      {children ?? <DownloadIcon className="size-4" />}
    </Button>
  );
};
