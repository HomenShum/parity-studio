// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ThreadPrimitive, type ToolCallMessagePart } from '@assistant-ui/react';
import { describe, expect, it } from 'vitest';
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

    expect(projected).toHaveLength(2);
    expect(projected[0]).toMatchObject({ id: 'message-user', role: 'user' });
    const invocation = firstToolCall(projected);
    expect(invocation.toolName).toBe('invoke_nodeslide_agent');
    expect(invocation.messages).toHaveLength(2);
    expect(invocation.messages?.map((child) => child.id)).toEqual([
      'message-search',
      'message-agent',
    ]);
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
      [run],
    );

    render(
      <NodeSlideThreadRuntimeProvider isRunning={false} messages={projected}>
        <ThreadPrimitive.Root>
          <NodeSlideThreadMessages />
        </ThreadPrimitive.Root>
      </NodeSlideThreadRuntimeProvider>,
    );

    expect(screen.getByText('Agent handoff')).toBeVisible();
    expect(screen.getByText('Read-only')).toBeVisible();
    expect(screen.getByText('Web search')).toBeVisible();
    expect(screen.getByText('A validated profile update is ready for review.')).toBeVisible();
    expect(screen.getAllByTestId('agent-tool')).toHaveLength(2);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
