import { afterEach, describe, expect, it } from 'vitest';

import { localByokStatus } from './byok.js';
import {
  type NodeSlideWorkspace,
  planLocalByokEdit,
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
});
