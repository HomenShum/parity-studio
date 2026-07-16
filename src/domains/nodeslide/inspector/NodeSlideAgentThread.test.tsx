// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ThreadPrimitive, type ToolCallMessagePart } from '@assistant-ui/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { NodeSlideAgentMessage, NodeSlideAgentRun } from '../../../../shared/nodeslide';
import {
  NodeSlideThreadMessages,
  NodeSlideThreadRuntimeProvider,
  buildNodeSlideThreadMessages,
} from './NodeSlideAgentThread';

const run: NodeSlideAgentRun = {
  id: 'run-delegated',
  deckId: 'deck-thread',
  idempotencyKey: 'request-1',
  instruction: 'Research the team and update the profile slide.',
  status: 'awaiting_review',
  provider: 'nebius',
  model: 'zai-org/GLM-5.2',
  webResearch: true,
  attempt: 1,
  patchId: 'patch-1',
  createdAt: 1_000,
  updatedAt: 1_200,
};

afterEach(cleanup);

function message(
  overrides: Partial<NodeSlideAgentMessage> &
    Pick<NodeSlideAgentMessage, 'id' | 'role' | 'content'>,
): NodeSlideAgentMessage {
  return {
    deckId: run.deckId,
    runId: run.id,
    createdAt: 1_000,
    ...overrides,
  };
}

function firstToolCall(messages: ReturnType<typeof buildNodeSlideThreadMessages>) {
  const assistant = messages.find((candidate) => candidate.role === 'assistant');
  const part = assistant?.content[0];
  if (!part || part.type !== 'tool-call') throw new Error('Expected a tool-call message part.');
  return part as ToolCallMessagePart;
}

describe('NodeSlide assistant-ui thread adapter', () => {
  it('projects a durable run as one tool call with a recursively renderable child conversation', () => {
    const projected = buildNodeSlideThreadMessages(
      [
        message({ id: 'message-user', role: 'user', content: run.instruction }),
        message({
          id: 'message-search',
          role: 'tool',
          content: 'Searching persisted team sources.',
          toolName: 'web_search',
          toolCallId: 'tool-search-1',
          toolActivity: { state: 'output-available', output: { sources: 3 } },
        }),
        message({
          id: 'message-agent',
          role: 'assistant',
          content: 'A validated profile update is ready for review.',
        }),
      ],
      [run],
    );

    expect(projected).toHaveLength(3);
    expect(projected[0]).toMatchObject({ id: 'message-user', role: 'user' });
    const invocation = firstToolCall(projected);
    expect(invocation.toolName).toBe('invoke_nodeslide_agent');
    expect(invocation.messages).toHaveLength(1);
    expect(invocation.messages?.map((child) => child.id)).toEqual(['message-search']);
    expect(projected[2]).toMatchObject({ id: 'message-agent', role: 'assistant' });
  });

  it('uses persisted parentMessageId lineage without duplicating child rows at the top level', () => {
    const projected = buildNodeSlideThreadMessages(
      [
        message({
          id: 'message-delegate',
          role: 'tool',
          content: 'Delegating visual research.',
          toolName: 'delegate_researcher',
          toolCallId: 'delegate-1',
          toolActivity: { state: 'output-available', output: { status: 'complete' } },
        }),
        message({
          id: 'message-child',
          parentMessageId: 'message-delegate',
          role: 'assistant',
          content: 'The researcher found three source-bound portraits.',
          createdAt: 1_001,
        }),
      ],
      [],
    );

    expect(projected).toHaveLength(1);
    const delegate = firstToolCall(projected);
    expect(delegate.toolCallId).toBe('delegate-1');
    expect(delegate.messages).toHaveLength(1);
    expect(delegate.messages?.[0]).toMatchObject({ id: 'message-child', role: 'assistant' });
  });

  it('retains causal durable order when server timestamps are equal', () => {
    const projected = buildNodeSlideThreadMessages(
      [
        message({ id: 'message-z', role: 'assistant', content: 'First persisted event.' }),
        message({ id: 'message-a', role: 'assistant', content: 'Second persisted event.' }),
      ],
      [],
    );

    expect(projected.map((item) => item.id)).toEqual(['message-z', 'message-a']);
  });

  it('renders delegated messages recursively with inherited tool UI and no nested composer', () => {
    const projected = buildNodeSlideThreadMessages(
      [
        message({ id: 'message-user', role: 'user', content: run.instruction }),
        message({
          id: 'message-search',
          role: 'tool',
          content: 'Searching persisted team sources.',
          toolName: 'web_search',
          toolActivity: { state: 'output-available', output: { sources: 3 } },
        }),
        message({
          id: 'message-agent',
          role: 'assistant',
          content: 'A validated profile update is ready for review.',
        }),
      ],
      [{ ...run, status: 'planning' }],
    );

    render(
      <NodeSlideThreadRuntimeProvider isRunning={false} messages={projected}>
        <ThreadPrimitive.Root>
          <NodeSlideThreadMessages />
        </ThreadPrimitive.Root>
      </NodeSlideThreadRuntimeProvider>,
    );

    expect(screen.getByText('Run details')).toBeVisible();
    expect(screen.getByText('1 step · read-only')).toBeVisible();
    expect(screen.getByText('Web search')).toBeVisible();
    expect(screen.getByText('A validated profile update is ready for review.')).toBeVisible();
    expect(screen.getAllByTestId('agent-tool')).toHaveLength(2);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('keeps the A03 final answer visible while U07 completed tool activity stays collapsed', () => {
    const projected = buildNodeSlideThreadMessages(
      [
        message({
          id: 'a03-user',
          role: 'user',
          content: 'Continue until the deck is presentation-ready.',
        }),
        message({
          id: 'a03-read',
          role: 'tool',
          content: 'Read the current deck context.',
          toolName: 'read_context',
          toolActivity: { state: 'output-available', output: { slides: 7 } },
        }),
        message({
          id: 'a03-final',
          role: 'assistant',
          content: 'The deck is ready for review.',
        }),
      ],
      [{ ...run, instruction: 'Continue until the deck is presentation-ready.' }],
    );

    render(
      <NodeSlideThreadRuntimeProvider isRunning={false} messages={projected}>
        <ThreadPrimitive.Root>
          <NodeSlideThreadMessages />
        </ThreadPrimitive.Root>
      </NodeSlideThreadRuntimeProvider>,
    );

    expect(screen.getByText('The deck is ready for review.')).toBeVisible();
    expect(screen.getByText('Agent activity · 1 step')).toBeVisible();
    expect(screen.queryByText('Read the current deck context.')).toBeNull();
  });

  it('renders the durable presentation-role progression across nested sequential handoffs', () => {
    const roleMessages: NodeSlideAgentMessage[] = [
      message({ id: 'roles-user', role: 'user', content: 'Make the deck presentation-ready.' }),
      message({
        id: 'roles-research',
        role: 'tool',
        content: 'Reviewed the authorized evidence.',
        toolName: 'delegate_researcher',
        agentRole: 'researcher',
        branchId: 'presentation-research',
        branchLabel: 'Evidence research',
        toolActivity: { state: 'output-available' },
      }),
      message({
        id: 'roles-analysis',
        parentMessageId: 'roles-research',
        role: 'tool',
        content: 'Analyzed the audience and evidence.',
        toolName: 'delegate_analyst',
        agentRole: 'analyst',
        branchId: 'presentation-analysis',
        branchLabel: 'Audience analysis',
        toolActivity: { state: 'output-available' },
      }),
      message({
        id: 'roles-story',
        parentMessageId: 'roles-analysis',
        role: 'tool',
        content: 'Shaped the narrative.',
        toolName: 'delegate_storyteller',
        agentRole: 'storyteller',
        branchId: 'presentation-story',
        branchLabel: 'Narrative structure',
        toolActivity: { state: 'output-available' },
      }),
      message({
        id: 'roles-design',
        parentMessageId: 'roles-story',
        role: 'tool',
        content: 'Prepared bounded slide operations.',
        toolName: 'delegate_designer',
        agentRole: 'designer',
        branchId: 'presentation-design',
        branchLabel: 'Slide design',
        toolActivity: { state: 'output-available' },
      }),
      message({
        id: 'roles-executor',
        parentMessageId: 'roles-design',
        role: 'tool',
        content: 'Inspected and measured the exact bounded candidate.',
        toolName: 'deck_repl',
        agentRole: 'executor',
        branchId: 'presentation-execution',
        branchLabel: 'Bounded deck execution',
        toolActivity: { state: 'output-available' },
      }),
      message({
        id: 'roles-fact-check',
        parentMessageId: 'roles-executor',
        role: 'tool',
        content: 'Checked evidence bindings and layout rules.',
        toolName: 'candidate_validation',
        agentRole: 'fact_checker',
        branchId: 'presentation-fact-check',
        branchLabel: 'Evidence check',
        toolActivity: { state: 'output-available' },
      }),
      message({
        id: 'roles-review',
        role: 'assistant',
        content: 'The proposal is ready for human review.',
        agentRole: 'reviewer',
        branchId: 'presentation-review',
        branchLabel: 'Human review',
      }),
    ];
    const projected = buildNodeSlideThreadMessages(roleMessages, [
      { ...run, status: 'planning', instruction: 'Make the deck presentation-ready.' },
    ]);
    const invocation = firstToolCall(projected);

    expect(invocation.args).toMatchObject({
      __nodeslideStepCount: '6',
      __nodeslideBranchCount: '6',
      __nodeslideParallelGroupCount: '0',
      __nodeslideRoleProgression:
        'researcher|analyst|storyteller|designer|executor|fact_checker|reviewer',
    });
    expect(invocation.messages).toHaveLength(1);

    render(
      <NodeSlideThreadRuntimeProvider isRunning={false} messages={projected}>
        <ThreadPrimitive.Root>
          <NodeSlideThreadMessages />
        </ThreadPrimitive.Root>
      </NodeSlideThreadRuntimeProvider>,
    );

    expect(
      screen.getByText(/Researcher.*Executor.*Fact checker.*6 steps.*read-only/),
    ).toBeVisible();
    expect(screen.getByText('The proposal is ready for human review.')).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('keeps legacy planner, executor, and validator roles readable', () => {
    const projected = buildNodeSlideThreadMessages(
      [
        message({ id: 'legacy-user', role: 'user', content: 'Refresh the legacy deck.' }),
        message({
          id: 'legacy-plan',
          role: 'assistant',
          content: 'Planned the edit.',
          agentRole: 'planner',
        }),
        message({
          id: 'legacy-execute',
          role: 'assistant',
          content: 'Executed the edit.',
          agentRole: 'executor',
        }),
        message({
          id: 'legacy-validate',
          role: 'assistant',
          content: 'Validated the edit.',
          agentRole: 'validator',
        }),
      ],
      [{ ...run, status: 'planning', instruction: 'Refresh the legacy deck.' }],
    );

    expect(firstToolCall(projected).args).toMatchObject({
      __nodeslideRoleProgression: 'planner|executor|validator',
    });

    render(
      <NodeSlideThreadRuntimeProvider isRunning={false} messages={projected}>
        <ThreadPrimitive.Root>
          <NodeSlideThreadMessages />
        </ThreadPrimitive.Root>
      </NodeSlideThreadRuntimeProvider>,
    );

    expect(screen.getByText('Planner → Executor → Validator · 2 steps · read-only')).toBeVisible();
    expect(screen.getByText('Validator')).toBeVisible();
  });

  it('labels only persisted parallel planner-to-executor branches for F17/F18 review', () => {
    const projected = buildNodeSlideThreadMessages(
      [
        message({
          id: 'parallel-user',
          role: 'user',
          content: 'Continue until the deck is presentation-ready.',
        }),
        message({
          id: 'parallel-plan',
          role: 'assistant',
          agentRole: 'planner',
          content: 'Split the readiness pass into two independent branches.',
        }),
        message({
          id: 'parallel-narrative',
          role: 'tool',
          toolName: 'delegate_executor',
          toolCallId: 'delegate-narrative',
          agentRole: 'executor',
          branchId: 'narrative',
          branchLabel: 'Narrative',
          parallelGroupId: 'readiness-wave-1',
          content: 'Prepared a CAS-bound narrative edit.',
          toolActivity: { state: 'output-available', output: { slideIds: ['slide-1'] } },
        }),
        message({
          id: 'parallel-evidence',
          role: 'tool',
          toolName: 'delegate_researcher',
          toolCallId: 'delegate-evidence',
          agentRole: 'researcher',
          branchId: 'evidence',
          branchLabel: 'Evidence',
          parallelGroupId: 'readiness-wave-1',
          content: 'Prepared an independent source-bound update.',
          toolActivity: { state: 'output-available', output: { slideIds: ['slide-2'] } },
        }),
        message({
          id: 'parallel-final',
          role: 'assistant',
          agentRole: 'executor',
          content: 'Both branches are ready for review.',
        }),
      ],
      [{ ...run, instruction: 'Continue until the deck is presentation-ready.' }],
    );

    const invocation = firstToolCall(projected);
    expect(invocation.args).toMatchObject({
      __nodeslideStepCount: '3',
      __nodeslideBranchCount: '2',
      __nodeslideParallelGroupCount: '1',
    });

    render(
      <NodeSlideThreadRuntimeProvider isRunning={false} messages={projected}>
        <ThreadPrimitive.Root>
          <NodeSlideThreadMessages />
        </ThreadPrimitive.Root>
      </NodeSlideThreadRuntimeProvider>,
    );

    expect(screen.getByText('Agent activity · 3 steps · 2 parallel branches')).toBeVisible();
    expect(screen.getByText('Both branches are ready for review.')).toBeVisible();
    expect(screen.getByText('Executor')).toBeVisible();
  });
});
