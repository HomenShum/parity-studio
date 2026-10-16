// @vitest-environment node
/**
 * The vendored NodeSlide planner (frozen copy) rejects only stopReason 'error'. Persona: a deck owner asks the local
 * BYOK planner for an edit; the reply reaches the 3,000-token cap just after a syntactically complete JSON object.
 * Before the shared seam enforced completion, that reply parsed and was saved as if the model had stopped. `call()`
 * now throws for any unfinished reply, so the frozen planner never sees one. Real call() through a fake Google
 * transport (no spend).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IncompleteCompletionError } from './llmClient';
import { type NodeSlideWorkspace, planLocalByokEdit } from './nodeslideTools';

vi.setConfig({ testTimeout: 30_000 });

const workspace: NodeSlideWorkspace = {
  deck: { id: 'deck_1', title: 'Test deck', version: 3, slideOrder: ['slide_1'] },
  slides: [{ id: 'slide_1', title: 'Opening', version: 2 }],
  elements: [],
  sources: [],
  patches: [],
  traces: [],
  versions: [],
  validations: [],
};

const proposal = JSON.stringify({
  summary: 'Replace headline',
  operations: [{ op: 'replace_text', slideId: 'slide_1', elementId: 'element_1', text: 'After' }],
});

const transport = (finishReason: string) =>
  vi.fn(
    async () =>
      new Response(
        `data: ${JSON.stringify({
          candidates: [{ content: { role: 'model', parts: [{ text: proposal }] }, finishReason }],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 3000,
            totalTokenCount: 3010,
          },
        })}\n\n`,
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
  );

const plan = () =>
  planLocalByokEdit({
    workspace,
    instruction: 'Replace the headline',
    scope: { kind: 'slide', deckId: 'deck_1', slideIds: ['slide_1'], operationMode: 'copy' },
    model: 'google/gemini-3.1-pro-preview',
  });

beforeEach(() => {
  vi.stubEnv('GEMINI_API_KEY', 'test-key-not-real');
  vi.stubEnv('GOOGLE_API_KEY', 'test-key-not-real');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('planLocalByokEdit never receives an unfinished reply', () => {
  it('a complete JSON proposal that ended at the output cap (MAX_TOKENS) is refused, with its billed cost', async () => {
    vi.stubGlobal('fetch', transport('MAX_TOKENS'));
    const err = await plan().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IncompleteCompletionError);
    expect((err as Error).message).toMatch(/truncated at its output cap/);
    expect((err as IncompleteCompletionError).costUsd).toBeGreaterThan(0);
  });

  it('the same proposal that ended with STOP is accepted (control)', async () => {
    vi.stubGlobal('fetch', transport('STOP'));
    expect((await plan()).operations).toHaveLength(1);
  });
});
