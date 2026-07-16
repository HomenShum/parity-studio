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
  type ExternalStoreAdapter,
  MessagePrimitive,
  type SourceMessagePartProps,
  type TextMessagePartProps,
  type ThreadMessage,
  ThreadPrimitive,
  type ToolCallMessagePart,
  type ToolCallMessagePartProps,
  unstable_useThreadMessageIds,
  useAuiState,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import {
  Bot,
  Check,
  GitBranch,
  GitMerge,
  Globe2,
  LoaderCircle,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  progressionMessages?: NodeSlideAgentMessage[];
}

type ParallelBranchState = 'running' | 'complete' | 'failed';

interface ParallelBranchSummary {
  id: string;
  label: string;
  role: string;
  state: ParallelBranchState;
  stepCount: number;
}

interface ParallelRunGroupSummary {
  id: string;
  branches: ParallelBranchSummary[];
  mergeStatus: NodeSlideAgentRun['status'];
  mergeCheckpoint: string;
}

function branchState(messages: readonly NodeSlideAgentMessage[]): ParallelBranchState {
  if (messages.some((message) => message.toolActivity?.state === 'output-error')) return 'failed';
  if (
    messages.some((message) =>
      ['input-streaming', 'input-available', 'approval-requested'].includes(
        message.toolActivity?.state ?? '',
      ),
    )
  ) {
    return 'running';
  }
  return 'complete';
}

function parallelRunGroups(
  messages: readonly NodeSlideAgentMessage[],
  run: NodeSlideAgentRun,
): ParallelRunGroupSummary[] {
  const grouped = new Map<string, Map<string, NodeSlideAgentMessage[]>>();
  for (const message of messages) {
    if (!message.parallelGroupId || !message.branchId) continue;
    const branches = grouped.get(message.parallelGroupId) ?? new Map();
    const branchMessages = branches.get(message.branchId) ?? [];
    branchMessages.push(message);
    branches.set(message.branchId, branchMessages);
    grouped.set(message.parallelGroupId, branches);
  }
  return [...grouped.entries()].flatMap(([id, branches]) => {
    if (branches.size < 2) return [];
    return [
      {
        id,
        branches: [...branches.entries()].map(([branchId, branchMessages]) => ({
          id: branchId,
          label: branchMessages.find((message) => message.branchLabel)?.branchLabel ?? branchId,
          role: branchMessages.find((message) => message.agentRole)?.agentRole ?? 'agent',
          state: branchState(branchMessages),
          stepCount: branchMessages.length,
        })),
        mergeStatus: run.status,
        mergeCheckpoint: run.checkpoint ?? run.status,
      },
    ];
  });
}

function flattenMessages(messages: readonly NodeSlideAgentMessage[]): NodeSlideAgentMessage[] {
  return messages.flatMap((message) => [message, ...flattenMessages(message.messages ?? [])]);
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
    branchId: message.branchId,
    branchLabel: message.branchLabel,
    parallelGroupId: message.parallelGroupId,
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
  const flattenedNestedMessages = flattenMessages(nestedMessages);
  const progressionMessages = flattenMessages(group.progressionMessages ?? group.messages);
  const firstNested = nestedMessages[0];
  const isRunning = ACTIVE_RUN_STATUSES.has(group.run.status);
  const isError = group.run.status === 'failed';
  const branchCount = new Set(
    flattenedNestedMessages.flatMap((message) => (message.branchId ? [message.branchId] : [])),
  ).size;
  const parallelGroupCount = new Set(
    flattenedNestedMessages.flatMap((message) =>
      message.parallelGroupId ? [message.parallelGroupId] : [],
    ),
  ).size;
  const parallelBranchCount = new Set(
    flattenedNestedMessages.flatMap((message) =>
      message.parallelGroupId && message.branchId ? [message.branchId] : [],
    ),
  ).size;
  const persistedParallelGroups = parallelRunGroups(flattenedNestedMessages, group.run);
  const roleProgression = progressionMessages.reduce<string[]>((roles, message) => {
    if (message.agentRole && roles.at(-1) !== message.agentRole) roles.push(message.agentRole);
    return roles;
  }, []);
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
          __nodeslideStepCount: String(flattenedNestedMessages.length),
          __nodeslideBranchCount: String(branchCount),
          __nodeslideParallelGroupCount: String(parallelGroupCount),
          __nodeslideParallelBranchCount: String(parallelBranchCount),
          __nodeslideParallelGroups: JSON.stringify(persistedParallelGroups),
          __nodeslideRoleProgression: roleProgression.join('|'),
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
    const invocation = runInvocationMessage({
      run,
      messages: invocationMessages,
      progressionMessages: groupMessages,
    });
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
    deck_repl: 'Deck inspection',
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

function parsedParallelRunGroups(value: unknown): ParallelRunGroupSummary[] {
  if (typeof value !== 'string' || value === '[]') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((group): group is ParallelRunGroupSummary => {
      if (!group || typeof group !== 'object') return false;
      const candidate = group as Partial<ParallelRunGroupSummary>;
      return (
        typeof candidate.id === 'string' &&
        typeof candidate.mergeStatus === 'string' &&
        typeof candidate.mergeCheckpoint === 'string' &&
        Array.isArray(candidate.branches) &&
        candidate.branches.length > 1
      );
    });
  } catch {
    return [];
  }
}

function parallelStateIcon(state: ParallelBranchState) {
  if (state === 'failed') return <TriangleAlert size={12} aria-hidden="true" />;
  if (state === 'running') return <LoaderCircle className="ns-spin" size={12} aria-hidden="true" />;
  return <Check size={12} aria-hidden="true" />;
}

function runStatusLabel(status: NodeSlideAgentRun['status']) {
  return status.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase());
}

function ParallelRunCard({ group }: { group: ParallelRunGroupSummary }) {
  const mergeRunning = ACTIVE_RUN_STATUSES.has(group.mergeStatus);
  const mergeFailed = group.mergeStatus === 'failed';
  return (
    <section
      className="ns-parallel-run-card"
      data-testid="parallel-run-card"
      aria-label={`Parallel run ${group.id}`}
    >
      <header>
        <span>
          <GitBranch size={13} aria-hidden="true" /> Parallel run
        </span>
        <small>{group.branches.length} branches</small>
      </header>
      <div className="ns-parallel-run-branches">
        {group.branches.map((branch) => (
          <article key={branch.id} data-branch-state={branch.state}>
            <span className="ns-parallel-state-icon">{parallelStateIcon(branch.state)}</span>
            <span>
              <strong>{branch.label}</strong>
              <small>
                {agentRoleLabel(branch.role)} · {branch.stepCount}{' '}
                {branch.stepCount === 1 ? 'step' : 'steps'}
              </small>
            </span>
            <output>{branch.state}</output>
          </article>
        ))}
      </div>
      <footer data-merge-state={mergeFailed ? 'failed' : mergeRunning ? 'running' : 'complete'}>
        <GitMerge size={13} aria-hidden="true" />
        <span>
          <strong>Merge</strong>
          <small>{group.mergeCheckpoint}</small>
        </span>
        <output>{runStatusLabel(group.mergeStatus)}</output>
      </footer>
    </section>
  );
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
  const parallelBranchCount = Number(toolArgs['__nodeslideParallelBranchCount'] ?? 0);
  const branchLabel = String(toolArgs['__nodeslideBranchLabel'] ?? '').trim();
  const agentRole = String(toolArgs['__nodeslideAgentRole'] ?? '').trim();
  const roleProgression = String(toolArgs['__nodeslideRoleProgression'] ?? '')
    .split('|')
    .map((role) => role.trim())
    .filter(Boolean);
  const parallelGroups = parsedParallelRunGroups(toolArgs['__nodeslideParallelGroups']);
  const isRunInvocation = part.toolName === 'invoke_nodeslide_agent';
  // The run card already exposes branch and merge failure state. Keep the full
  // provenance thread one click away without letting it dominate the chat.
  const toolOpen = isRunInvocation ? false : state !== 'output-available';
  const title = toolActivityTitle({
    toolName: part.toolName,
    isRunInvocation,
    nestedMessageCount,
    branchCount,
    parallelBranchCount,
    parallelGroupCount,
    branchLabel,
    agentRole,
  });
  return (
    <>
      {isRunInvocation
        ? parallelGroups.map((group) => <ParallelRunCard group={group} key={group.id} />)
        : null}
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
                  {isRunInvocation && roleProgression.length
                    ? `${roleProgression.map((role) => agentRoleLabel(role)).join(' → ')} · `
                    : ''}
                  {nestedMessageCount} {nestedMessageCount === 1 ? 'step' : 'steps'} · read-only
                </small>
              </header>
              <NodeSlideNestedMessages messages={part.messages ?? []} />
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
    </>
  );
}

/**
 * Nested assistant-ui message-part providers use positional lookups that can become stale while a
 * live tool appends steps or the responsive layout remounts. Render the read-only child journal
 * from its immutable message payload instead; the top-level thread still uses assistant-ui.
 */
const NESTED_MESSAGE_PAGE_SIZE = 20;

function flattenThreadMessages(messages: readonly ThreadMessage[]): ThreadMessage[] {
  const flattened: ThreadMessage[] = [];
  const visited = new Set<string>();
  const visit = (message: ThreadMessage) => {
    if (visited.has(message.id)) return;
    visited.add(message.id);
    flattened.push(message);
    for (const part of message.content) {
      if (part.type !== 'tool-call') continue;
      for (const child of part.messages ?? []) visit(child);
    }
  };
  for (const message of messages) visit(message);
  return flattened;
}

interface NestedMessageWindow {
  visibleIds: ReadonlySet<string>;
  positions: ReadonlyMap<string, number>;
  total: number;
}

function NodeSlideNestedMessages({ messages }: { messages: readonly ThreadMessage[] }) {
  const flattenedMessages = useMemo(() => flattenThreadMessages(messages), [messages]);
  const [visibleCount, setVisibleCount] = useState(() =>
    Math.min(NESTED_MESSAGE_PAGE_SIZE, flattenedMessages.length),
  );
  const boundedVisibleCount = Math.min(visibleCount, flattenedMessages.length);
  const messageWindow = useMemo<NestedMessageWindow>(() => {
    const visibleMessages = flattenedMessages.slice(0, boundedVisibleCount);
    return {
      visibleIds: new Set(visibleMessages.map((message) => message.id)),
      positions: new Map(flattenedMessages.map((message, index) => [message.id, index + 1])),
      total: flattenedMessages.length,
    };
  }, [boundedVisibleCount, flattenedMessages]);
  const remainingCount = flattenedMessages.length - boundedVisibleCount;
  const nextPageCount = Math.min(NESTED_MESSAGE_PAGE_SIZE, remainingCount);

  return (
    <div
      className="ns-agent-nested-journal"
      data-testid="agent-nested-messages"
      data-total-steps={flattenedMessages.length}
      data-visible-steps={boundedVisibleCount}
    >
      <ol
        className="ns-agent-nested-messages"
        aria-label={`Agent run steps, ${boundedVisibleCount} of ${flattenedMessages.length} shown`}
      >
        <NodeSlideNestedMessageTree messages={messages} window={messageWindow} />
      </ol>
      {remainingCount > 0 ? (
        <button
          type="button"
          className="ns-agent-nested-show-more"
          data-testid="agent-nested-show-more"
          onClick={() => setVisibleCount((count) => count + NESTED_MESSAGE_PAGE_SIZE)}
        >
          Show {nextPageCount} more ({boundedVisibleCount} of {flattenedMessages.length} shown)
        </button>
      ) : null}
    </div>
  );
}

function NodeSlideNestedMessageTree({
  messages,
  window,
}: {
  messages: readonly ThreadMessage[];
  window: NestedMessageWindow;
}) {
  return messages.map((message) => {
    if (!window.visibleIds.has(message.id)) return null;
    const custom = (message.metadata as { custom?: Record<string, unknown> }).custom ?? {};
    const roleLabel =
      message.role === 'user'
        ? 'You asked'
        : message.role === 'system'
          ? 'System'
          : agentRoleLabel(String(custom['agentRole'] ?? ''));
    return (
      <li
        className={`ns-agent-nested-message is-${message.role}`}
        key={message.id}
        data-message-role={message.role}
        aria-posinset={window.positions.get(message.id)}
        aria-setsize={window.total}
      >
        <span className="ns-eyebrow">{roleLabel}</span>
        {message.content.map((part, index) => {
          if (part.type === 'text') return <p key={`${message.id}:text:${index}`}>{part.text}</p>;
          if (part.type === 'source' && part.sourceType === 'url') {
            return (
              <a
                href={part.url}
                key={`${message.id}:source:${part.id}`}
                target="_blank"
                rel="noreferrer"
              >
                {part.title ?? part.url}
              </a>
            );
          }
          if (part.type === 'tool-call') {
            return (
              <NodeSlideNestedToolCall
                key={`${message.id}:tool:${part.toolCallId}`}
                part={part}
                window={window}
              />
            );
          }
          return null;
        })}
      </li>
    );
  });
}

function NodeSlideNestedToolCall({
  part,
  window,
}: {
  part: ToolCallMessagePart;
  window: NestedMessageWindow;
}) {
  const rawArgs = (part.args as Record<string, unknown> | undefined) ?? {};
  const encodedState = rawArgs['__nodeslideToolState'];
  const state =
    typeof encodedState === 'string' &&
    ['input-streaming', 'input-available', 'output-available', 'output-error'].includes(
      encodedState,
    )
      ? (encodedState as NodeSlideAgentToolState)
      : part.isError
        ? 'output-error'
        : part.result !== undefined
          ? 'output-available'
          : 'input-available';
  const displayArgs = Object.fromEntries(
    Object.entries(rawArgs).filter(([key]) => !key.startsWith('__nodeslide')),
  );
  const nestedMessages = part.messages ?? [];
  return (
    <Tool
      className={`ns-ai-v3-tool ${nestedMessages.length ? 'is-agent-handoff' : ''}`}
      data-testid="agent-tool"
      data-tool-state={state}
      defaultOpen={state !== 'output-available'}
    >
      <ToolHeader
        state={state}
        title={humanizeToolName(part.toolName)}
        toolName={part.toolName}
        type="dynamic-tool"
      />
      <ToolContent>
        {nestedMessages.length ? (
          <ol
            className="ns-agent-nested-messages ns-agent-nested-sublist"
            aria-label="Nested agent steps"
          >
            <NodeSlideNestedMessageTree messages={nestedMessages} window={window} />
          </ol>
        ) : (
          <>
            {Object.keys(displayArgs).length ? <ToolInput input={displayArgs} /> : null}
            {part.result !== undefined || part.isError || state === 'output-error' ? (
              <ToolOutput
                errorText={
                  part.isError || state === 'output-error'
                    ? String(
                        (part.result as { error?: unknown })?.error ??
                          rawArgs['__nodeslideErrorText'] ??
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

const THREAD_VIRTUALIZATION_THRESHOLD = 24;
const THREAD_ESTIMATED_MESSAGE_HEIGHT = 96;
const THREAD_VIRTUAL_OVERSCAN = 480;

interface NodeSlideVirtualRangeInput {
  messageIds: readonly string[];
  measuredHeights: ReadonlyMap<string, number>;
  scrollTop: number;
  viewportHeight: number;
  estimatedHeight?: number;
  overscan?: number;
}

export interface NodeSlideVirtualRange {
  start: number;
  end: number;
  beforeHeight: number;
  afterHeight: number;
  totalHeight: number;
}

/** Pure range calculation kept exportable for dynamic-height regression tests. */
export function computeNodeSlideVirtualRange({
  messageIds,
  measuredHeights,
  scrollTop,
  viewportHeight,
  estimatedHeight = THREAD_ESTIMATED_MESSAGE_HEIGHT,
  overscan = THREAD_VIRTUAL_OVERSCAN,
}: NodeSlideVirtualRangeInput): NodeSlideVirtualRange {
  const offsets = [0];
  for (const id of messageIds) {
    offsets.push((offsets.at(-1) ?? 0) + (measuredHeights.get(id) ?? estimatedHeight));
  }
  const totalHeight = offsets.at(-1) ?? 0;
  const visibleTop = Math.max(0, scrollTop - overscan);
  const visibleBottom = Math.min(totalHeight, scrollTop + viewportHeight + overscan);
  let start = 0;
  while (start < messageIds.length && (offsets[start + 1] ?? totalHeight) < visibleTop) {
    start += 1;
  }
  let end = start;
  while (end < messageIds.length && (offsets[end] ?? 0) <= visibleBottom) end += 1;
  end = Math.min(messageIds.length, Math.max(end, start + 1));
  return {
    start,
    end,
    beforeHeight: offsets[start] ?? 0,
    afterHeight: Math.max(0, totalHeight - (offsets[end] ?? totalHeight)),
    totalHeight,
  };
}

function MeasuredThreadMessage({
  messageId,
  onMeasure,
}: {
  messageId: string;
  onMeasure: (messageId: string, height: number) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => {
      const height = row.getBoundingClientRect().height;
      if (height > 0) onMeasure(messageId, height);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const height =
        entries[0]?.borderBoxSize?.[0]?.blockSize ?? row.getBoundingClientRect().height;
      if (height > 0) onMeasure(messageId, height);
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, [messageId, onMeasure]);
  return (
    <div className="ns-agent-virtual-row" data-message-id={messageId} ref={rowRef}>
      <ThreadPrimitive.Unstable_MessageById
        messageId={messageId}
        components={THREAD_MESSAGE_COMPONENTS}
      />
    </div>
  );
}

export function NodeSlideThreadRuntimeProvider({
  children,
  isRunning,
  isSendDisabled = false,
  messages,
  onCancel,
  onNew,
}: {
  children: ReactNode;
  isRunning: boolean;
  isSendDisabled?: boolean;
  messages: readonly ThreadMessage[];
  onCancel?: ExternalStoreAdapter['onCancel'];
  onNew?: ExternalStoreAdapter['onNew'];
}) {
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning,
    isSendDisabled,
    onNew: onNew ?? (async () => undefined),
    ...(onCancel ? { onCancel } : {}),
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

export function NodeSlideThreadMessages({
  scrollContainerRef,
}: {
  scrollContainerRef?: RefObject<HTMLElement | null>;
}) {
  const messageIds = unstable_useThreadMessageIds();
  const measuredHeightsRef = useRef(new Map<string, number>());
  const [, setMeasurementRevision] = useState(0);
  const [viewport, setViewport] = useState<{ scrollTop: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const container = scrollContainerRef?.current;
    if (!container) return;
    let frame = 0;
    const syncViewport = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setViewport({
          scrollTop: container.scrollTop,
          height: Math.max(1, container.clientHeight),
        });
      });
    };
    syncViewport();
    container.addEventListener('scroll', syncViewport, { passive: true });
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncViewport);
    observer?.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      container.removeEventListener('scroll', syncViewport);
    };
  }, [scrollContainerRef]);

  const estimatedTotal = messageIds.reduce(
    (total, id) => total + (measuredHeightsRef.current.get(id) ?? THREAD_ESTIMATED_MESSAGE_HEIGHT),
    0,
  );
  const viewportHeight = viewport?.height ?? 640;
  const range = useMemo(
    () =>
      computeNodeSlideVirtualRange({
        messageIds,
        measuredHeights: measuredHeightsRef.current,
        scrollTop: viewport?.scrollTop ?? Math.max(0, estimatedTotal - viewportHeight),
        viewportHeight,
      }),
    [estimatedTotal, messageIds, viewport, viewportHeight],
  );
  const onMeasure = useCallback(
    (messageId: string, height: number) => {
      const measurements = measuredHeightsRef.current;
      const previous = measurements.get(messageId) ?? THREAD_ESTIMATED_MESSAGE_HEIGHT;
      if (Math.abs(previous - height) < 0.5) return;
      const index = messageIds.indexOf(messageId);
      const container = scrollContainerRef?.current;
      if (container && index >= 0) {
        let rowTop = 0;
        for (let cursor = 0; cursor < index; cursor += 1) {
          const id = messageIds[cursor];
          if (id) rowTop += measurements.get(id) ?? THREAD_ESTIMATED_MESSAGE_HEIGHT;
        }
        if (rowTop < container.scrollTop) container.scrollTop += height - previous;
      }
      measurements.set(messageId, height);
      setMeasurementRevision((revision) => revision + 1);
    },
    [messageIds, scrollContainerRef],
  );

  if (!scrollContainerRef || messageIds.length <= THREAD_VIRTUALIZATION_THRESHOLD) {
    return (
      <div className="ns-agent-virtual-list" data-virtualized="false">
        <ThreadPrimitive.Messages components={THREAD_MESSAGE_COMPONENTS} />
      </div>
    );
  }

  return (
    <div
      className="ns-agent-virtual-list is-virtualized"
      data-testid="agent-virtualized-messages"
      data-virtualized="true"
      data-rendered-count={range.end - range.start}
    >
      <div className="ns-agent-virtual-spacer" style={{ height: range.beforeHeight }} />
      {messageIds.slice(range.start, range.end).map((messageId) => (
        <MeasuredThreadMessage messageId={messageId} onMeasure={onMeasure} key={messageId} />
      ))}
      <div className="ns-agent-virtual-spacer" style={{ height: range.afterHeight }} />
    </div>
  );
}

function agentRoleLabel(role?: string, toolName?: string) {
  const normalized = role?.trim().toLowerCase();
  if (normalized) {
    const humanized = normalized.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\s+/g, ' ');
    return humanized.replace(/^./, (character) => character.toUpperCase());
  }
  const delegatedRole = toolName?.match(/^delegate[_-](.+)$/)?.[1];
  if (delegatedRole) return humanizeToolName(delegatedRole);
  return 'NodeSlide';
}

function toolActivityTitle({
  toolName,
  isRunInvocation,
  nestedMessageCount,
  branchCount,
  parallelBranchCount,
  parallelGroupCount,
  branchLabel,
  agentRole,
}: {
  toolName: string;
  isRunInvocation: boolean;
  nestedMessageCount: number;
  branchCount: number;
  parallelBranchCount: number;
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
      const displayedBranchCount = parallelGroupCount > 0 ? parallelBranchCount : branchCount;
      parts.push(
        `${displayedBranchCount} ${parallelGroupCount > 0 ? 'parallel ' : ''}${
          displayedBranchCount === 1 ? 'branch' : 'branches'
        }`,
      );
    }
    return parts.join(' · ');
  }
  return [agentRole ? agentRoleLabel(agentRole) : humanizeToolName(toolName), branchLabel]
    .filter(Boolean)
    .join(' · ');
}
