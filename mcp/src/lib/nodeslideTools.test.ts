import { afterEach, describe, expect, it } from 'vitest';

import { localByokStatus } from './byok.js';
import {
  type NodeSlideWorkspace,
  canonicalNodeSlideSnapshot,
  nodeSlidePatchOperationSchema,
  paginateNodeSlideItems,
  planLocalByokEdit,
  registerNodeSlideTools,
  requireExplicitConsent,
  resolveScope,
  unappliedProposalReceipt,
} from './nodeslideTools.js';

const workspace: NodeSlideWorkspace = {
  deck: { id: 'deck_1', title: 'Test deck', version: 3, slideOrder: ['slide_1'] },
  slides: [{ id: 'slide_1', title: 'Opening', version: 2 }],
  elements: [
    {
      id: 'element_1',
      slideId: 'slide_1',
      name: 'Headline',
      kind: 'text',
      role: 'headline',
      content: 'Before',
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
};

const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;

afterEach(() => {
  if (originalOpenRouterKey === undefined) {
    Reflect.deleteProperty(process.env, 'OPENROUTER_API_KEY');
  } else {
    process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  }
});

describe('NodeSlide MCP governance', () => {
  it('refuses every external path without explicit consent', () => {
    expect(() => requireExplicitConsent(false, 'local BYOK model egress')).toThrow(
      'Explicit consent',
    );
    expect(() => requireExplicitConsent(true, 'local BYOK model egress')).not.toThrow();
  });

  it('rejects element scope that reaches outside the authorized slide', () => {
    expect(() =>
      resolveScope(workspace, {
        scope: 'elements',
        slideId: 'slide_1',
        elementIds: ['not_in_slide'],
        operationMode: 'copy',
      }),
    ).toThrow('Every elementId must belong');
  });

  it('accepts a local BYOK JSON plan but never gives the model a provider key', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-value-never-echo';
    let captured = '';
    const result = await planLocalByokEdit({
      workspace,
      instruction: 'Replace the headline',
      scope: {
        kind: 'slide',
        deckId: 'deck_1',
        slideIds: ['slide_1'],
        operationMode: 'copy',
      },
      model: 'z-ai/glm-5.2',
      complete: async (input) => {
        captured = JSON.stringify(input);
        return {
          text: JSON.stringify({
            summary: 'Replace headline',
            operations: [
              {
                op: 'replace_text',
                slideId: 'slide_1',
                elementId: 'element_1',
                text: 'After',
              },
            ],
          }),
          costUsd: 0.001,
          inputTokens: 100,
          outputTokens: 20,
          modelUsed: 'z-ai/glm-5.2',
          provider: 'openrouter',
          stopReason: 'stop',
        };
      },
    });
    expect(result.operations).toHaveLength(1);
    expect(captured).not.toContain(process.env.OPENROUTER_API_KEY);
    expect(JSON.stringify(localByokStatus(['z-ai/glm-5.2']))).not.toContain(
      process.env.OPENROUTER_API_KEY,
    );
  });

  it('fails closed on invalid model JSON', async () => {
    await expect(
      planLocalByokEdit({
        workspace,
        instruction: 'Change it',
        scope: {
          kind: 'slide',
          deckId: 'deck_1',
          slideIds: ['slide_1'],
          operationMode: 'unrestricted',
        },
        model: 'z-ai/glm-5.2',
        complete: async () => ({
          text: 'not json',
          costUsd: 0,
          inputTokens: 1,
          outputTokens: 1,
          modelUsed: 'z-ai/glm-5.2',
          provider: 'openrouter',
          stopReason: 'stop',
        }),
      }),
    ).rejects.toThrow('No proposal was saved');
  });

  it('proves propose_edit is non-mutating before returning success', () => {
    const receipt = unappliedProposalReceipt(
      {
        patch: { id: 'patch_1', status: 'ready', candidateValidation: { ok: true } },
        workspace: { ...workspace, deck: { ...workspace.deck, version: 3 } },
      },
      3,
    );
    expect(receipt).toMatchObject({ applied: false, deckVersionBefore: 3, deckVersionAfter: 3 });
    expect(() =>
      unappliedProposalReceipt(
        {
          patch: { id: 'patch_1', status: 'accepted' },
          workspace: { ...workspace, deck: { ...workspace.deck, version: 4 } },
        },
        3,
      ),
    ).toThrow('Governance violation');
  });

  it('orders the canonical snapshot and strips owner capabilities recursively', () => {
    const unordered = {
      ...workspace,
      deck: {
        ...workspace.deck,
        slideOrder: ['slide_2', 'slide_1'],
        ownerAccessKey: 'owner-secret',
      },
      slides: [
        { id: 'slide_1', title: 'One', version: 1, elementOrder: ['element_1'] },
        { id: 'slide_2', title: 'Two', version: 1, elementOrder: ['element_2'] },
      ],
      elements: [
        workspace.elements[0],
        { ...workspace.elements[0], id: 'element_2', slideId: 'slide_2' },
      ],
    } satisfies NodeSlideWorkspace;
    const snapshot = canonicalNodeSlideSnapshot(unordered);
    expect(snapshot.slides.map((slide) => slide.id)).toEqual(['slide_2', 'slide_1']);
    expect(snapshot.elements.map((element) => element.id)).toEqual(['element_2', 'element_1']);
    expect(JSON.stringify(snapshot)).not.toContain('owner-secret');
    expect(JSON.stringify(snapshot)).not.toContain('ownerAccessKey');
  });

  it('binds pagination cursors to the deck version, collection, and filter', () => {
    const first = paginateNodeSlideItems(['a', 'b', 'c'], {
      deckId: 'deck_1',
      deckVersion: 3,
      collection: 'elements',
      filter: 'slide_1',
      limit: 2,
    });
    expect(first).toMatchObject({ items: ['a', 'b'], hasMore: true, total: 3, limit: 2 });
    const second = paginateNodeSlideItems(['a', 'b', 'c'], {
      deckId: 'deck_1',
      deckVersion: 3,
      collection: 'elements',
      filter: 'slide_1',
      cursor: first.nextCursor ?? undefined,
      limit: 2,
    });
    expect(second).toMatchObject({ items: ['c'], hasMore: false, nextCursor: null });
    expect(() =>
      paginateNodeSlideItems(['a', 'b', 'c'], {
        deckId: 'deck_1',
        deckVersion: 4,
        collection: 'elements',
        filter: 'slide_1',
        cursor: first.nextCursor ?? undefined,
      }),
    ).toThrow('invalid or stale');
  });

  it('exposes an exact discriminated PatchOperation contract', () => {
    expect(
      nodeSlidePatchOperationSchema.safeParse({
        op: 'replace_text',
        slideId: 'slide_1',
        elementId: 'element_1',
        text: 'After',
      }).success,
    ).toBe(true);
    expect(
      nodeSlidePatchOperationSchema.safeParse({
        op: 'replace_text',
        slideId: 'slide_1',
        elementId: 'element_1',
        text: 'After',
        ownerAccessKey: 'must-not-pass-through',
      }).success,
    ).toBe(false);
    expect(nodeSlidePatchOperationSchema.safeParse({ op: 'run_javascript' }).success).toBe(false);
  });

  it('routes exact external operations through the existing unapplied proposal action', async () => {
    type ToolHandler = (args: Record<string, unknown>) => Promise<{
      content: Array<{ type: 'text'; text: string }>;
    }>;
    const handlers = new Map<string, ToolHandler>();
    const server = {
      registerTool: (name: string, _definition: unknown, handler: ToolHandler) =>
        handlers.set(name, handler),
    };
    const calls: Array<{
      kind: string;
      path: string;
      args: Record<string, unknown>;
    }> = [];
    const convexCall = async (
      kind: 'query' | 'mutation' | 'action',
      path: string,
      args: Record<string, unknown>,
    ) => {
      calls.push({ kind, path, args });
      if (path === 'nodeslide:getWorkspace') return workspace;
      if (path === 'nodeslideAgent:proposeExternalAgentEdit') {
        return {
          patch: {
            id: 'patch_external',
            status: 'ready',
            candidateValidation: { ok: true },
          },
          workspace,
        };
      }
      throw new Error(`Unexpected path ${path}`);
    };
    registerNodeSlideTools(server as never, convexCall);
    expect([...handlers.keys()]).toEqual(
      expect.arrayContaining([
        'nodeslide.get_snapshot',
        'nodeslide.list_elements',
        'nodeslide.export_spec',
        'nodeslide.propose_patch',
      ]),
    );

    const propose = handlers.get('nodeslide.propose_patch');
    expect(propose).toBeDefined();
    await expect(
      propose?.({
        deckId: 'deck_1',
        ownerAccessKey: 'owner-key',
        client: 'codex',
        instruction: 'Replace the headline',
        summary: 'Replace headline',
        scope: {
          kind: 'elements',
          deckId: 'deck_1',
          slideIds: ['slide_1'],
          elementIds: ['element_1'],
          operationMode: 'copy',
        },
        operations: [
          {
            op: 'replace_text',
            slideId: 'slide_1',
            elementId: 'element_1',
            text: 'After',
          },
        ],
        baseDeckVersion: 3,
        baseSlideVersions: { slide_1: 2 },
        baseElementVersions: { element_1: 4 },
        idempotencyKey: 'codex-edit-1',
        consent: false,
      }),
    ).rejects.toThrow('Explicit consent');
    expect(calls).toHaveLength(0);

    const response = await propose?.({
      deckId: 'deck_1',
      ownerAccessKey: 'owner-key',
      client: 'codex',
      model: 'gpt-codex',
      instruction: 'Replace the headline',
      summary: 'Replace headline',
      scope: {
        kind: 'elements',
        deckId: 'deck_1',
        slideIds: ['slide_1'],
        elementIds: ['element_1'],
        operationMode: 'copy',
      },
      operations: [
        {
          op: 'replace_text',
          slideId: 'slide_1',
          elementId: 'element_1',
          text: 'After',
        },
      ],
      baseDeckVersion: 3,
      baseSlideVersions: { slide_1: 2 },
      baseElementVersions: { element_1: 4 },
      idempotencyKey: 'codex-edit-1',
      consent: true,
    });
    expect(JSON.parse(response?.content[0]?.text ?? '{}')).toMatchObject({
      applied: false,
      deckVersionBefore: 3,
      deckVersionAfter: 3,
    });
    expect(calls.map((call) => `${call.kind}:${call.path}`)).toEqual([
      'query:nodeslide:getWorkspace',
      'action:nodeslideAgent:proposeExternalAgentEdit',
    ]);
    expect(calls[1]?.args).toMatchObject({
      baseDeckVersion: 3,
      baseSlideVersions: { slide_1: 2 },
      baseElementVersions: { element_1: 4 },
      idempotencyKey: 'codex-edit-1',
      provider: 'external-agent',
      model: 'codex:gpt-codex',
      submissionKind: 'external_agent',
      providerConsent: 'nodeslide_external_agent_patch_v1',
      operations: [{ op: 'replace_text', elementId: 'element_1', text: 'After' }],
    });
    expect(calls.some((call) => call.kind === 'mutation')).toBe(false);
    expect(JSON.stringify(response)).not.toContain('owner-key');
  });
});
