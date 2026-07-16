import { Source, Sources, SourcesContent, SourcesTrigger } from '@/components/ai-elements/sources';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import {
  AssistantRuntimeProvider,
  MessagePartPrimitive,
  MessagePrimitive,
  type SourceMessagePartProps,
  type TextMessagePartProps,
  type ThreadMessage,
  ThreadPrimitive,
  type ToolCallMessagePartProps,
  useAuiState,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import { Bot, Globe2, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import type {
  NodeSlideAgentMessage,
  NodeSlideAgentRun,
  NodeSlideAgentToolState,
} from '../../../../shared/nodeslide';

const ACTIVE_RUN_STATUSES = new Set<NodeSlideAgentRun['status']>([
  'queued',
  'researching',
  'planning',
  'validating',
]);

interface BuildThreadOptions {
  optimisticAsk?: string;
  optimisticId?: string;
}

interface RunMessageGroup {
  run: NodeSlideAgentRun;
  messages: NodeSlideAgentMessage[];
}

function projectMessageHierarchy(
  ordered: readonly NodeSlideAgentMessage[],
): NodeSlideAgentMessage[] {
  const byId = new Map(ordered.map((message) => [message.id, message] as const));
  const childrenByParent = new Map<string, NodeSlideAgentMessage[]>();
  const nestedIds = new Set<string>();
  for (const message of ordered) {
    const parentId = message.parentMessageId;
    if (!parentId || parentId === message.id || !byId.has(parentId)) continue;
    const children = childrenByParent.get(parentId) ?? [];
    children.push(message);
    childrenByParent.set(parentId, children);
    nestedIds.add(message.id);
  }

  const projected = new Set<string>();
  const project = (
    message: NodeSlideAgentMessage,
    ancestors: ReadonlySet<string>,
  ): NodeSlideAgentMessage => {
    projected.add(message.id);
    const nextAncestors = new Set(ancestors).add(message.id);
    const declaredChildren = message.messages ?? [];
    const persistedChildren = childrenByParent.get(message.id) ?? [];
    const uniqueChildren = [...declaredChildren, ...persistedChildren].filter(
      (child, index, children) =>
        !nextAncestors.has(child.id) &&
        children.findIndex((item) => item.id === child.id) === index,
    );
    if (!uniqueChildren.length) return message;
    return {
      ...message,
      messages: uniqueChildren.map((child) => project(child, nextAncestors)),
    };
  };

  const roots = ordered
    .filter((message) => !nestedIds.has(message.id))
    .map((message) => project(message, new Set()));
  // Malformed cycles fail open as flat readable rows instead of disappearing from the audit trail.
  for (const message of ordered) {
    if (!projected.has(message.id)) {
      const { parentMessageId: _parentMessageId, ...readableRoot } = message;
      roots.push(readableRoot);
    }
  }
  return roots;
}

function assistantMetadata(custom: Record<string, unknown>) {
  return {
    unstable_state: null,
    unstable_annotations: [],
    unstable_data: [],
    steps: [],
    custom,
  } as const;
}

function passiveMetadata(custom: Record<string, unknown>) {
  return { custom } as const;
}

function sourceParts(message: NodeSlideAgentMessage) {
  const referenced = new Set(message.sourceIds ?? []);
  return (message.resolvedSources ?? []).flatMap((source) => {
    if (!referenced.has(source.id) || !isSafeResolvedSource(source.title, source.url)) return [];
    return [
      {
        type: 'source' as const,
        sourceType: 'url' as const,
        id: source.id,
        url: source.url,
        title: source.title,
      },
    ];
  });
}

function unresolvedSourcePart(message: NodeSlideAgentMessage) {
  const referenced = new Set(message.sourceIds ?? []);
  const resolved = new Set(
    (message.resolvedSources ?? [])
      .filter((source) => isSafeResolvedSource(source.title, source.url))
      .map((source) => source.id),
  );
  const count = [...referenced].filter((sourceId) => !resolved.has(sourceId)).length;
  if (!count) return [];
  return [
    {
      type: 'text' as const,
      text: `${count} persisted source snapshot${count === 1 ? '' : 's'}`,
    },
  ];
}

function toolArgs(message: NodeSlideAgentMessage): Record<string, string> {
  const activity = message.toolActivity;
  if (!activity) return {};
  const args: Record<string, string> = {
    __nodeslideToolState: activity.state,
  };
  if (activity.errorText) args['__nodeslideErrorText'] = activity.errorText;
  if (message.agentRole) args['__nodeslideAgentRole'] = message.agentRole;
  if (message.branchLabel) args['__nodeslideBranchLabel'] = message.branchLabel;
  if (activity.input === undefined) return args;
  try {
    args['input'] = JSON.stringify(activity.input);
  } catch {
    args['input'] = String(activity.input);
  }
  return args;
}

function toolCallResult(message: NodeSlideAgentMessage): unknown {
  const activity = message.toolActivity;
  if (!activity) return undefined;
  if (activity.state === 'input-streaming' || activity.state === 'input-available')
    return undefined;
  if (activity.state === 'output-error') {
    return { error: activity.errorText ?? message.content };
  }
  if (activity.output !== undefined) return activity.output;
  return message.content;
}

function messageToThreadMessage(message: NodeSlideAgentMessage): ThreadMessage {
  const createdAt = new Date(message.createdAt);
  const custom = {
    runId: message.runId,
    sourceIds: message.sourceIds ?? [],
    toolState: message.toolActivity?.state,
    agentRole: message.agentRole,
    branchLabel: message.branchLabel,
  };
  if (message.role === 'user') {
    return {
      id: message.id,
      role: 'user',
      content: [{ type: 'text', text: message.content }],
      attachments: [],
      metadata: passiveMetadata(custom),
      createdAt,
    };
  }
  if (message.role === 'system') {
    return {
      id: message.id,
      role: 'system',
      content: [{ type: 'text', text: message.content }],
      metadata: passiveMetadata(custom),
      createdAt,
    };
  }
  if (message.role === 'tool' && message.toolName && message.toolActivity) {
    const result = toolCallResult(message);
    return {
      id: message.id,
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: message.toolCallId ?? `tool:${message.id}`,
          toolName: message.toolName,
          args: toolArgs(message),
          argsText: JSON.stringify(message.toolActivity.input ?? {}),
          ...(result !== undefined ? { result } : {}),
          ...(message.toolActivity.state === 'output-error' ? { isError: true } : {}),
          ...(message.messages?.length
            ? { messages: message.messages.map(messageToThreadMessage) }
            : {}),
        },
        ...sourceParts(message),
        ...unresolvedSourcePart(message),
      ],
      status:
        result === undefined
          ? { type: 'running' }
          : message.toolActivity.state === 'output-error'
            ? {
                type: 'incomplete',
                reason: 'error',
                error: { message: message.toolActivity.errorText ?? message.content },
              }
            : { type: 'complete', reason: 'stop' },
      metadata: assistantMetadata(custom),
      createdAt,
    };
  }
  return {
    id: message.id,
    role: 'assistant',
    content: [
      { type: 'text', text: message.content },
      ...sourceParts(message),
      ...unresolvedSourcePart(message),
    ],
    status: { type: 'complete', reason: 'stop' },
    metadata: assistantMetadata(custom),
    createdAt,
  };
}

function runInvocationMessage(group: RunMessageGroup): ThreadMessage | null {
  const nestedMessages = group.messages.filter((message) => message.role !== 'user');
  if (nestedMessages.length === 0) return null;
  const firstNested = nestedMessages[0];
  const isRunning = ACTIVE_RUN_STATUSES.has(group.run.status);
  const isError = group.run.status === 'failed';
  const branchCount = new Set(
    nestedMessages.flatMap((message) => (message.branchId ? [message.branchId] : [])),
  ).size;
  const parallelGroupCount = new Set(
    nestedMessages.flatMap((message) => (message.parallelGroupId ? [message.parallelGroupId] : [])),
  ).size;
  const toolResult = isRunning
    ? undefined
    : {
        status: group.run.status,
        checkpoint: group.run.checkpoint ?? group.run.status,
        ...(group.run.patchId ? { patchId: group.run.patchId } : {}),
      };
  return {
    id: `run-invocation:${group.run.id}`,
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: `invoke:${group.run.id}`,
        toolName: 'invoke_nodeslide_agent',
        args: {
          instruction: group.run.instruction,
          __nodeslideStepCount: String(nestedMessages.length),
          __nodeslideBranchCount: String(branchCount),
          __nodeslideParallelGroupCount: String(parallelGroupCount),
        },
        argsText: JSON.stringify({ instruction: group.run.instruction }),
        ...(toolResult ? { result: toolResult } : {}),
        ...(isError ? { isError: true } : {}),
        messages: nestedMessages.map(messageToThreadMessage),
      },
    ],
    status: isRunning
      ? { type: 'running' }
      : isError
        ? {
            type: 'incomplete',
            reason: 'error',
            error: { message: group.run.error ?? 'Run failed' },
          }
        : { type: 'complete', reason: 'stop' },
    metadata: assistantMetadata({ runId: group.run.id, nested: true, readOnly: true }),
    createdAt: new Date(firstNested?.createdAt ?? group.run.createdAt),
  };
}

/**
 * Adapts NodeSlide's durable message/run records to assistant-ui's canonical thread shape.
 * Matching durable runs become tool calls whose `messages` carry a read-only, recursively
 * renderable child conversation. Flat legacy rows remain readable without invented nesting.
 */
export function buildNodeSlideThreadMessages(
  messages: readonly NodeSlideAgentMessage[],
  runs: readonly NodeSlideAgentRun[],
  options: BuildThreadOptions = {},
): ThreadMessage[] {
  // Preserve durable query order when multiple events share the same server timestamp.
  // Modern JavaScript sorting is stable, so equal timestamps retain their causal sequence.
  const ordered = [...messages].sort((left, right) => left.createdAt - right.createdAt);
  const threaded = projectMessageHierarchy(ordered);
  const byRun = new Map<string, NodeSlideAgentMessage[]>();
  for (const message of threaded) {
    const bucket = byRun.get(message.runId) ?? [];
    bucket.push(message);
    byRun.set(message.runId, bucket);
  }
  const runById = new Map(runs.map((run) => [run.id, run]));
  const output: ThreadMessage[] = [];
  const handledRuns = new Set<string>();

  for (const message of threaded) {
    const run = runById.get(message.runId);
    if (!run) {
      output.push(messageToThreadMessage(message));
      continue;
    }
    if (handledRuns.has(run.id)) continue;
    handledRuns.add(run.id);
    const groupMessages = byRun.get(run.id) ?? [];
    const userMessages = groupMessages.filter((candidate) => candidate.role === 'user');
    const finalAssistant = [...groupMessages]
      .reverse()
      .find((candidate) => candidate.role === 'assistant');
    const invocationMessages = finalAssistant
      ? groupMessages.filter((candidate) => candidate.id !== finalAssistant.id)
      : groupMessages;
    output.push(...userMessages.map(messageToThreadMessage));
    const invocation = runInvocationMessage({ run, messages: invocationMessages });
    if (invocation) output.push(invocation);
    if (finalAssistant) output.push(messageToThreadMessage(finalAssistant));
  }

  const optimisticAsk = options.optimisticAsk?.trim();
  const latestPersistedUserAsk = [...ordered]
    .reverse()
    .find((message) => message.role === 'user')
    ?.content.trim();
  if (optimisticAsk && optimisticAsk !== latestPersistedUserAsk) {
    output.push({
      id: options.optimisticId ?? 'nodeslide-optimistic-user-ask',
      role: 'user',
      content: [{ type: 'text', text: optimisticAsk }],
      attachments: [],
      metadata: passiveMetadata({ optimistic: true }),
      createdAt: new Date(),
    });
  }
  return output;
}

function isSafeResolvedSource(title: string, url: string) {
  if (!title.trim()) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function humanizeToolName(toolName?: string) {
  if (!toolName) return 'Tool';
  const knownLabels: Record<string, string> = {
    candidate_validation: 'Validation',
    invoke_nodeslide_agent: 'NodeSlide agent',
    memory_retrieval: 'Memory retrieval',
    source_snapshot: 'Source capture',
    web_research: 'Web research',
    web_search: 'Web search',
  };
  if (knownLabels[toolName]) return knownLabels[toolName];
  return toolName.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function threadToolState(part: ToolCallMessagePartProps): NodeSlideAgentToolState {
  if (part.isError) return 'output-error';
  if (part.result !== undefined) return 'output-available';
  return 'input-available';
}

function NodeSlideTextPart({ text }: TextMessagePartProps) {
  return <p>{text}</p>;
}

function NodeSlideSourcePart({ id, title, url }: SourceMessagePartProps) {
  if (!url || !isSafeResolvedSource(title ?? '', url)) return null;
  return (
    <Sources data-testid="agent-message-sources">
      <SourcesTrigger count={1} />
      <SourcesContent>
        <Source href={url} key={id} title={title ?? url} />
      </SourcesContent>
    </Sources>
  );
}

function NodeSlideToolCallPart(part: ToolCallMessagePartProps) {
  const toolArgs = (part.args as Record<string, unknown> | undefined) ?? {};
  const encodedToolState = toolArgs['__nodeslideToolState'];
  const persistedToolState = useAuiState(
    (state) => state.message.metadata.custom['toolState'] as NodeSlideAgentToolState | undefined,
  );
  const state =
    typeof encodedToolState === 'string' &&
    ['input-streaming', 'input-available', 'output-available', 'output-error'].includes(
      encodedToolState,
    )
      ? (encodedToolState as NodeSlideAgentToolState)
      : (persistedToolState ?? threadToolState(part));
  const displayArgs = Object.fromEntries(
    Object.entries(toolArgs).filter(([key]) => !key.startsWith('__nodeslide')),
  );
  const encodedErrorText = toolArgs['__nodeslideErrorText'];
  const hasNestedMessages = Boolean(part.messages?.length);
  const nestedMessageCount = Number(toolArgs['__nodeslideStepCount'] ?? part.messages?.length ?? 0);
  const branchCount = Number(toolArgs['__nodeslideBranchCount'] ?? 0);
  const parallelGroupCount = Number(toolArgs['__nodeslideParallelGroupCount'] ?? 0);
  const branchLabel = String(toolArgs['__nodeslideBranchLabel'] ?? '').trim();
  const agentRole = String(toolArgs['__nodeslideAgentRole'] ?? '').trim();
  const isRunInvocation = part.toolName === 'invoke_nodeslide_agent';
  const toolOpen = state !== 'output-available';
  const title = toolActivityTitle({
    toolName: part.toolName,
    isRunInvocation,
    nestedMessageCount,
    branchCount,
    parallelGroupCount,
    branchLabel,
    agentRole,
  });
  return (
    <Tool
      className={`ns-ai-v3-tool ${hasNestedMessages ? 'is-agent-handoff' : ''}`}
      data-testid="agent-tool"
      data-tool-state={state}
      defaultOpen={toolOpen}
    >
      <ToolHeader state={state} title={title} toolName={part.toolName} type="dynamic-tool" />
      <ToolContent>
        {hasNestedMessages ? (
          <section
            className="ns-agent-handoff-thread"
            aria-label="Read-only sub-agent conversation"
          >
            <header>
              <span>
                <Bot size={12} />
                {isRunInvocation
                  ? 'Run details'
                  : `${agentRoleLabel(agentRole, part.toolName)} handoff`}
              </span>
              <small>
                {nestedMessageCount} {nestedMessageCount === 1 ? 'step' : 'steps'} · read-only
              </small>
            </header>
            <MessagePartPrimitive.Messages components={THREAD_MESSAGE_COMPONENTS} />
          </section>
        ) : (
          <>
            {Object.keys(displayArgs).length ? <ToolInput input={displayArgs} /> : null}
            {part.result !== undefined || part.isError || state === 'output-error' ? (
              <ToolOutput
                errorText={
                  part.isError || state === 'output-error'
                    ? String(
                        (part.result as { error?: unknown })?.error ??
                          encodedErrorText ??
                          'Tool failed',
                      )
                    : undefined
                }
                output={part.isError || state === 'output-error' ? undefined : part.result}
              />
            ) : null}
          </>
        )}
      </ToolContent>
    </Tool>
  );
}

function NodeSlideThreadMessage() {
  const role = useAuiState((state) => state.message.role);
  const optimistic = useAuiState((state) => state.message.metadata.custom['optimistic'] === true);
  const agentRole = useAuiState(
    (state) => state.message.metadata.custom['agentRole'] as string | undefined,
  );
  const branchLabel = useAuiState(
    (state) => state.message.metadata.custom['branchLabel'] as string | undefined,
  );
  return (
    <MessagePrimitive.Root
      className={`ns-ai-v3-chat-turn is-${role === 'user' ? 'user' : 'agent'} ns-agent-message`}
      data-testid={optimistic ? 'optimistic-user-ask' : `agent-message-${role}`}
      data-message-role={role}
    >
      {role !== 'user' ? (
        <span className="ns-ai-v3-agent-mark" aria-hidden="true">
          {role === 'system' ? <Globe2 size={14} /> : <Sparkles size={14} />}
        </span>
      ) : null}
      <div className="ns-agent-message-content">
        <span className="ns-eyebrow">
          {role === 'user' ? 'You asked' : role === 'system' ? 'System' : agentRoleLabel(agentRole)}
          {role !== 'user' && branchLabel ? (
            <small className="ns-agent-branch-label">{branchLabel}</small>
          ) : null}
        </span>
        <MessagePrimitive.Parts
          components={{
            Text: NodeSlideTextPart,
            Source: NodeSlideSourcePart,
            tools: { Fallback: NodeSlideToolCallPart },
          }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}

const THREAD_MESSAGE_COMPONENTS = { Message: NodeSlideThreadMessage } as const;

export function NodeSlideThreadRuntimeProvider({
  children,
  isRunning,
  messages,
}: {
  children: ReactNode;
  isRunning: boolean;
  messages: readonly ThreadMessage[];
}) {
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning,
    onNew: async () => undefined,
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

export function NodeSlideThreadMessages() {
  return <ThreadPrimitive.Messages components={THREAD_MESSAGE_COMPONENTS} />;
}

function agentRoleLabel(role?: string, toolName?: string) {
  const normalized = role?.trim().toLowerCase();
  if (normalized) return normalized.replace(/^./, (character) => character.toUpperCase());
  const delegatedRole = toolName?.match(/^delegate[_-](.+)$/)?.[1];
  if (delegatedRole) return humanizeToolName(delegatedRole);
  return 'NodeSlide';
}

function toolActivityTitle({
  toolName,
  isRunInvocation,
  nestedMessageCount,
  branchCount,
  parallelGroupCount,
  branchLabel,
  agentRole,
}: {
  toolName: string;
  isRunInvocation: boolean;
  nestedMessageCount: number;
  branchCount: number;
  parallelGroupCount: number;
  branchLabel: string;
  agentRole: string;
}) {
  if (isRunInvocation) {
    const parts = [
      'Agent activity',
      `${nestedMessageCount} ${nestedMessageCount === 1 ? 'step' : 'steps'}`,
    ];
    if (branchCount > 1) {
      parts.push(
        `${branchCount} ${parallelGroupCount > 0 ? 'parallel ' : ''}${
          branchCount === 1 ? 'branch' : 'branches'
        }`,
      );
    }
    return parts.join(' · ');
  }
  return [agentRole ? agentRoleLabel(agentRole) : humanizeToolName(toolName), branchLabel]
    .filter(Boolean)
    .join(' · ');
}
