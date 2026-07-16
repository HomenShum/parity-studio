import { describe, expect, it } from 'vitest';
import { nodeSlideUserErrorMessage, sanitizeNodeSlideUserError } from './nodeslideUserError';

describe('NodeSlide user-facing errors', () => {
  it('extracts the public message from a wrapped Convex failure without exposing a stack', () => {
    const error = new Error(
      'Uncaught ConvexError: {"kind":"nodeslide_agent","code":"fallback_unavailable","message":"No safe proposal was returned. Retry with a smaller request."} at publicAgentError (../convex/nodeslideAgent.ts:1397:10)',
    );

    expect(nodeSlideUserErrorMessage(error, 'The request failed.')).toBe(
      'No safe proposal was returned. Retry with a smaller request.',
    );
  });

  it('keeps concise product errors and rejects unbounded technical output', () => {
    expect(sanitizeNodeSlideUserError('The image could not be read.', 'Request failed.')).toBe(
      'The image could not be read.',
    );
    expect(sanitizeNodeSlideUserError(`Error: ${'x'.repeat(500)}`, 'Request failed.')).toBe(
      'Request failed.',
    );
  });

  it('removes Convex operation and request wrappers from server failures', () => {
    expect(
      nodeSlideUserErrorMessage(
        new Error(
          '[CONVEX M(nodeslide:acceptPatch)] [Request ID: abc123] Server Error\nUncaught Error: The durable proposal is still finalizing.\n    at handler (../convex/nodeslide.ts:803:3)',
        ),
        'The proposal could not be accepted.',
      ),
    ).toBe('The durable proposal is still finalizing.');

    expect(
      nodeSlideUserErrorMessage(
        new Error('[CONVEX M(nodeslide:acceptPatch)] [Request ID: abc123] Server Error'),
        'The proposal could not be accepted.',
      ),
    ).toBe('The proposal could not be accepted.');
  });

  it('maps raw transport failures to interface copy without exposing debug details', () => {
    expect(
      sanitizeNodeSlideUserError(
        'Convex Server Error: [Request ID: debug-secret] upstream request failed',
        'The agent failed before a reviewable proposal was returned.',
      ),
    ).toBe('The agent failed before a reviewable proposal was returned.');
    expect(
      sanitizeNodeSlideUserError(
        'Internal Server Error (request abc123)',
        'The request could not be completed.',
      ),
    ).toBe('The request could not be completed.');
  });
});
