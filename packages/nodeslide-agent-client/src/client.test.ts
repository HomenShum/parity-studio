import { describe, expect, it, vi } from 'vitest';

import { NodeSlideAgentClient, type NodeSlideWorkspace } from './index.js';

function workspace(overrides: Partial<NodeSlideWorkspace> = {}): NodeSlideWorkspace {
  return {
    deck: { id: 'deck-1', title: 'Pilot', version: 3, slideOrder: ['slide-1'] },
    slides: [{ id: 'slide-1', title: 'Opening', version: 2 }],
    elements: [
      {
        id: 'headline-1',
        slideId: 'slide-1',
        name: 'Headline',
        kind: 'text',
        content: 'Old headline',
        bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 },
        style: {},
        sourceIds: [],
        locked: false,
        version: 4,
      },
    ],
    sources: [],
    patches: [],
    traces: [],
    versions: [],
    validations: [],
    ...overrides,
  };
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify({ status: 'success', value }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function requestBody(input: RequestInfo | URL, init?: RequestInit) {
  void input;
  return JSON.parse(String(init?.body)) as {
    path: string;
    args: Record<string, unknown>;
  };
}

describe('NodeSlideAgentClient', () => {
  it('creates a deterministic proposal without changing the deck version', async () => {
    const current = workspace();
    const proposal = {
      id: 'patch-1',
      status: 'ready',
      baseDeckVersion: 3,
      candidateDigest: 'digest-1',
      candidateValidation: { valid: true },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = requestBody(input, init);
      if (body.path === 'nodeslide:getWorkspace') return jsonResponse(current);
      if (body.path === 'nodeslideAgent:proposeEdit') {
        expect(body.args).toMatchObject({
          deckId: 'deck-1',
          ownerAccessKey: 'owner-secret',
          baseDeckVersion: 3,
          baseSlideVersions: { 'slide-1': 2 },
          baseElementVersions: { 'headline-1': 4 },
          providerMode: 'deterministic',
          scope: {
            kind: 'slide',
            deckId: 'deck-1',
            slideIds: ['slide-1'],
            operationMode: 'copy',
          },
        });
        return jsonResponse({ patch: proposal, workspace: current });
      }
      throw new Error(`Unexpected path ${body.path}`);
    });
    const client = new NodeSlideAgentClient({
      convexUrl: 'https://example.convex.cloud',
      ownerAccessKey: 'owner-secret',
      fetch: fetchMock as typeof fetch,
    });

    const receipt = await client.proposeEdit({
      deckId: 'deck-1',
      instruction: 'Replace the headline',
      scope: 'slide',
      slideId: 'slide-1',
      operationMode: 'copy',
      execution: 'deterministic',
      consent: false,
    });

    expect(receipt).toMatchObject({
      proposal,
      applied: false,
      deckVersionBefore: 3,
      deckVersionAfter: 3,
    });
  });

  it('fails closed before mutation when the reviewed digest does not match', async () => {
    const current = workspace({
      patches: [
        {
          id: 'patch-1',
          status: 'ready',
          baseDeckVersion: 3,
          candidateDigest: 'stored-digest',
        },
      ],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = requestBody(input, init);
      if (body.path === 'nodeslide:getWorkspace') return jsonResponse(current);
      throw new Error(`Mutation should not run: ${body.path}`);
    });
    const client = new NodeSlideAgentClient({
      convexUrl: 'https://example.convex.cloud',
      ownerAccessKey: 'owner-secret',
      fetch: fetchMock as typeof fetch,
    });

    await expect(
      client.acceptProposal({
        deckId: 'deck-1',
        patchId: 'patch-1',
        expectedCandidateDigest: 'different-digest',
        expectedBaseDeckVersion: 3,
        reviewSummary: 'Approved the headline change.',
      }),
    ).rejects.toThrow(/digest no longer matches/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts only the exact reviewed proposal and returns the new deck version', async () => {
    const readyPatch = {
      id: 'patch-1',
      status: 'ready',
      baseDeckVersion: 3,
      candidateDigest: 'digest-1',
    };
    const current = workspace({ patches: [readyPatch] });
    const acceptedPatch = { ...readyPatch, status: 'accepted' };
    const acceptedWorkspace = workspace({
      deck: { ...current.deck, version: 4 },
      patches: [acceptedPatch],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = requestBody(input, init);
      if (body.path === 'nodeslide:getWorkspace') return jsonResponse(current);
      if (body.path === 'nodeslide:acceptPatch') {
        return jsonResponse({ patch: acceptedPatch, workspace: acceptedWorkspace });
      }
      throw new Error(`Unexpected path ${body.path}`);
    });
    const client = new NodeSlideAgentClient({
      convexUrl: 'https://example.convex.cloud',
      ownerAccessKey: 'owner-secret',
      fetch: fetchMock as typeof fetch,
    });

    await expect(
      client.acceptProposal({
        deckId: 'deck-1',
        patchId: 'patch-1',
        expectedCandidateDigest: 'digest-1',
        expectedBaseDeckVersion: 3,
        reviewSummary: 'Approved the headline change.',
      }),
    ).resolves.toMatchObject({
      decision: 'accepted',
      deckVersionBefore: 3,
      deckVersionAfter: 4,
      candidateDigest: 'digest-1',
    });
  });

  it('verifies rejection leaves the canonical deck version unchanged', async () => {
    const readyPatch = {
      id: 'patch-1',
      status: 'ready',
      baseDeckVersion: 3,
      candidateDigest: 'digest-1',
    };
    const current = workspace({ patches: [readyPatch] });
    const rejectedPatch = { ...readyPatch, status: 'rejected' };
    let workspaceReads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = requestBody(input, init);
      if (body.path === 'nodeslide:getWorkspace') {
        workspaceReads += 1;
        return jsonResponse(
          workspaceReads === 1 ? current : workspace({ patches: [rejectedPatch] }),
        );
      }
      if (body.path === 'nodeslide:rejectPatch') return jsonResponse(rejectedPatch);
      throw new Error(`Unexpected path ${body.path}`);
    });
    const client = new NodeSlideAgentClient({
      convexUrl: 'https://example.convex.cloud',
      ownerAccessKey: 'owner-secret',
      fetch: fetchMock as typeof fetch,
    });

    await expect(
      client.rejectProposal({
        deckId: 'deck-1',
        patchId: 'patch-1',
        expectedCandidateDigest: 'digest-1',
        expectedBaseDeckVersion: 3,
        reviewSummary: 'Reject this direction.',
      }),
    ).resolves.toMatchObject({
      decision: 'rejected',
      deckVersionBefore: 3,
      deckVersionAfter: 3,
    });
  });
});
