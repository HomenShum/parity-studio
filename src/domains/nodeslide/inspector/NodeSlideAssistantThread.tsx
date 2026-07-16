import {
  AssistantRuntimeProvider,
  MessagePartPrimitive,
  MessagePrimitive,
  type ThreadMessageLike,
  ThreadPrimitive,
  useAuiState,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import {
  ArrowDown,
  CheckCircle2,
  GitBranch,
  Globe2,
  LoaderCircle,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { type PropsWithChildren, useCallback, useMemo } from 'react';
import type { NodeSlideAgentMessage, NodeSlideAgentRun } from '../../../../shared/nodeslide';

interface NodeSlideAssistantRuntimeProps extends PropsWithChildren {
  messages: readonly NodeSlideAgentMessage[];
  runs: readonly NodeSlideAgentRun[];
  running: boolean;
}

type ToolActivity = Pick<
  NodeSlideAgentMessage,
  'id' | 'content' | 'toolName' | 'agentRole' | 'branchId' | 'branchLabel' | 'createdAt'
>;

type ProjectedAgentMessage = NodeSlideAgentMessage & {
  toolActivities?: readonly ToolActivity[];
};

type NodeSlideMessageMetadata = {
  originalRole: NodeSlideAgentMessage['role'];
  runId: string;
  toolName?: string;
  sourceCount: number;
  runStatus?: NodeSlideAgentRun['status'];
  provider?: string;
  model?: string;
  runDurationMs?: number;
  runToolCount: number;
  runBranchCount: number;
  runAttempt: number;
  agentRole?: NodeSlideAgentMessage['agentRole'];
  branchId?: string;
  branchLabel?: string;
  parallelGroupId?: string;
  toolActivities?: readonly ToolActivity[];
  isLastAssistantInRun: boolean;
};

/**
 * Consecutive tool receipts are one readable activity group. The projection never
 * invents orchestration: branch and role labels only come from persisted events.
 */
export function projectNodeSlideAgentMessages(
  messages: readonly NodeSlideAgentMessage[],
): ProjectedAgentMessage[] {
  const projected: ProjectedAgentMessage[] = [];
  for (const message of messages) {
    const previous = projected.at(-1);
    const sameExecutionLane = message.parallelGroupId
      ? previous?.parallelGroupId === message.parallelGroupId
      : previous?.branchId === message.branchId && !previous?.parallelGroupId;
    const sameToolGroup =
      message.role === 'tool' &&
      previous?.role === 'tool' &&
      previous.runId === message.runId &&
      sameExecutionLane;

    if (sameToolGroup && previous) {
      previous.toolActivities = [
        ...(previous.toolActivities ?? [toolActivity(previous)]),
        toolActivity(message),
      ];
      previous.content = `${previous.content}\n${message.content}`;
      continue;
    }

    projected.push({
      ...message,
      ...(message.role === 'tool' ? { toolActivities: [toolActivity(message)] } : {}),
    });
  }
  return projected;
}

export function NodeSlideAssistantRuntime({
  messages,
  runs,
  running,
  children,
}: NodeSlideAssistantRuntimeProps) {
  const projectedMessages = useMemo(() => projectNodeSlideAgentMessages(messages), [messages]);
  const runsById = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs]);
  const runStats = useMemo(() => {
    const stats = new Map<
      string,
      { toolCount: number; branches: Set<string>; lastAssistantId?: string }
    >();
    for (const message of messages) {
      const current = stats.get(message.runId) ?? { toolCount: 0, branches: new Set<string>() };
      if (message.role === 'tool') current.toolCount += 1;
      if (message.branchId) current.branches.add(message.branchId);
      if (message.role === 'assistant' || message.role === 'system') {
        current.lastAssistantId = message.id;
      }
      stats.set(message.runId, current);
    }
    return stats;
  }, [messages]);
  const convertMessage = useCallback(
    (message: ProjectedAgentMessage): ThreadMessageLike => {
      const run = runsById.get(message.runId);
      const stats = runStats.get(message.runId);
      const metadata: NodeSlideMessageMetadata = {
        originalRole: message.role,
        runId: message.runId,
        sourceCount: message.sourceIds?.length ?? 0,
        runToolCount: stats?.toolCount ?? 0,
        runBranchCount: stats?.branches.size ?? 0,
        runAttempt: run?.attempt ?? 1,
        isLastAssistantInRun: stats?.lastAssistantId === message.id,
        ...(message.toolName ? { toolName: message.toolName } : {}),
        ...(message.agentRole ? { agentRole: message.agentRole } : {}),
        ...(message.branchId ? { branchId: message.branchId } : {}),
        ...(message.branchLabel ? { branchLabel: message.branchLabel } : {}),
        ...(message.parallelGroupId ? { parallelGroupId: message.parallelGroupId } : {}),
        ...(message.toolActivities ? { toolActivities: message.toolActivities } : {}),
        ...(run
          ? {
              runStatus: run.status,
              provider: run.provider,
              model: run.model,
              runDurationMs: Math.max(0, (run.completedAt ?? run.updatedAt) - run.createdAt),
            }
          : {}),
      };

      return {
        id: message.id,
        role: message.role === 'user' ? 'user' : 'assistant',
        createdAt: new Date(message.createdAt),
        content: [{ type: 'text', text: message.content }],
        metadata: { custom: metadata },
      };
    },
    [runsById, runStats],
  );
  const onNew = useCallback(async () => {}, []);
  const runtime = useExternalStoreRuntime({
    messages: projectedMessages,
    convertMessage,
    isRunning: running,
    isSendDisabled: true,
    onNew,
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

export function NodeSlideAssistantMessages() {
  return (
    <ThreadPrimitive.Messages
      components={{
        Message: NodeSlideAssistantMessage,
      }}
    />
  );
}

export function NodeSlideAssistantScrollButton() {
  return (
    <ThreadPrimitive.ScrollToBottom
      className="ns-aui-scroll-bottom"
      aria-label="Jump to latest agent activity"
    >
      <ArrowDown size={14} />
    </ThreadPrimitive.ScrollToBottom>
  );
}

function NodeSlideAssistantMessage() {
  const message = useAuiState((state) => state.message);
  const metadata = (message.metadata.custom ?? {}) as NodeSlideMessageMetadata;
  const isUser = metadata.originalRole === 'user';
  const isTool = metadata.originalRole === 'tool';
  const isFailure = metadata.runStatus === 'failed' || metadata.runStatus === 'cancelled';
  const isActive = ['queued', 'researching', 'planning', 'validating'].includes(
    metadata.runStatus ?? '',
  );
  const showRunSummary =
    isUser &&
    (metadata.runToolCount > 1 ||
      metadata.runBranchCount > 1 ||
      (metadata.runDurationMs ?? 0) >= 5_000 ||
      metadata.runAttempt > 1);

  if (isTool) {
    const activities = metadata.toolActivities ?? [];
    const branchCount = new Set(activities.flatMap((activity) => activity.branchId ?? [])).size;
    return (
      <MessagePrimitive.Root
        className="ns-aui-tool-event"
        data-testid="agent-message-tool"
        data-run-id={metadata.runId}
      >
        <details>
          <summary>
            {branchCount > 1 ? <GitBranch size={13} /> : <Globe2 size={13} />}
            <span>{activitySummary(activities, metadata.toolName)}</span>
            <small>
              {activities.length} {activities.length === 1 ? 'step' : 'steps'}
              {branchCount > 1 ? ` · ${branchCount} branches` : ''}
            </small>
          </summary>
          <ol className="ns-aui-tool-list">
            {activities.map((activity) => (
              <li key={activity.id}>
                <span className="ns-aui-tool-dot" aria-hidden="true" />
                <div>
                  <strong>{humanizeToolName(activity.toolName)}</strong>
                  {activity.agentRole || activity.branchLabel ? (
                    <small>
                      {activity.agentRole ? agentRoleLabel(activity.agentRole) : ''}
                      {activity.agentRole && activity.branchLabel ? ' · ' : ''}
                      {activity.branchLabel ?? ''}
                    </small>
                  ) : null}
                  <p>{activity.content}</p>
                </div>
              </li>
            ))}
          </ol>
        </details>
      </MessagePrimitive.Root>
    );
  }

  return (
    <MessagePrimitive.Root
      className={`ns-aui-message ${isUser ? 'is-user' : 'is-assistant'}${
        metadata.branchId ? ' is-branch' : ''
      }`}
      data-testid={`agent-message-${isUser ? 'user' : 'assistant'}`}
      data-run-id={metadata.runId}
      data-branch-id={metadata.branchId}
    >
      {!isUser ? (
        <span className="ns-aui-avatar" aria-hidden="true">
          {metadata.branchId ? <GitBranch size={14} /> : <Sparkles size={14} />}
        </span>
      ) : null}
      <div className="ns-aui-message-body">
        <div className="ns-aui-message-meta">
          <strong>{isUser ? 'You' : agentRoleLabel(metadata.agentRole)}</strong>
          {!isUser && metadata.branchLabel ? (
            <span className="ns-aui-branch-label">{metadata.branchLabel}</span>
          ) : null}
          {!isUser && metadata.runStatus && metadata.isLastAssistantInRun ? (
            <span className={isFailure ? 'has-failed' : isActive ? 'is-active' : ''}>
              {isFailure ? (
                <TriangleAlert size={11} />
              ) : isActive ? (
                <LoaderCircle className="ns-spin" size={11} />
              ) : (
                <CheckCircle2 size={11} />
              )}
              {runStatusLabel(metadata.runStatus)}
            </span>
          ) : null}
        </div>
        <MessagePrimitive.Parts components={{ Text: NodeSlideTextPart }} />
        {showRunSummary ? (
          <div className="ns-aui-run-summary" aria-label="Run summary">
            {metadata.runToolCount > 0 ? <span>{metadata.runToolCount} steps</span> : null}
            {metadata.runBranchCount > 1 ? (
              <span>{metadata.runBranchCount} parallel branches</span>
            ) : null}
            {(metadata.runDurationMs ?? 0) >= 5_000 ? (
              <span>{formatDuration(metadata.runDurationMs ?? 0)}</span>
            ) : null}
            {metadata.runAttempt > 1 ? <span>Attempt {metadata.runAttempt}</span> : null}
          </div>
        ) : null}
        {!isUser && (metadata.sourceCount > 0 || metadata.model) ? (
          <footer>
            {metadata.sourceCount > 0 ? (
              <span>
                {metadata.sourceCount} source snapshot{metadata.sourceCount === 1 ? '' : 's'}
              </span>
            ) : null}
            {metadata.model ? <span title={metadata.provider}>{metadata.model}</span> : null}
          </footer>
        ) : null}
      </div>
    </MessagePrimitive.Root>
  );
}

function NodeSlideTextPart() {
  return (
    <p className="ns-aui-message-text">
      <MessagePartPrimitive.Text />
    </p>
  );
}

function toolActivity(message: NodeSlideAgentMessage): ToolActivity {
  return {
    id: message.id,
    content: message.content,
    createdAt: message.createdAt,
    ...(message.toolName ? { toolName: message.toolName } : {}),
    ...(message.agentRole ? { agentRole: message.agentRole } : {}),
    ...(message.branchId ? { branchId: message.branchId } : {}),
    ...(message.branchLabel ? { branchLabel: message.branchLabel } : {}),
  };
}

function activitySummary(activities: readonly ToolActivity[], fallbackToolName?: string) {
  if (activities.length <= 1) return humanizeToolName(activities[0]?.toolName ?? fallbackToolName);
  const branchCount = new Set(activities.flatMap((activity) => activity.branchId ?? [])).size;
  return branchCount > 1 ? 'Parallel agent activity' : 'Agent activity';
}

function humanizeToolName(toolName?: string) {
  if (!toolName) return 'Tool';
  const knownLabels: Record<string, string> = {
    candidate_validation: 'Validation',
    validate_patch: 'Validate patch',
    web_research: 'Web research',
    read_context: 'Read context',
    patch_proposal: 'Patch proposal',
  };
  return (
    knownLabels[toolName] ??
    toolName
      .replaceAll('_', ' ')
      .replaceAll('-', ' ')
      .replace(/^./, (letter) => letter.toUpperCase())
  );
}

function agentRoleLabel(role?: NodeSlideAgentMessage['agentRole']) {
  if (!role) return 'NodeSlide';
  const labels: Record<NonNullable<NodeSlideAgentMessage['agentRole']>, string> = {
    planner: 'Planner',
    executor: 'Executor',
    researcher: 'Researcher',
    validator: 'Validator',
  };
  return labels[role];
}

function formatDuration(durationMs: number) {
  if (durationMs < 60_000) return `${Math.max(1, Math.round(durationMs / 1_000))}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function runStatusLabel(status: NodeSlideAgentRun['status']) {
  const labels: Record<NodeSlideAgentRun['status'], string> = {
    queued: 'Queued',
    researching: 'Researching',
    planning: 'Planning',
    validating: 'Validating',
    awaiting_review: 'Ready for review',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };
  return labels[status];
}
