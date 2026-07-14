import { describe, expect, it } from 'vitest';

import { nodeSlideErrorMessage } from './NodeSlideStudio';

describe('nodeSlideErrorMessage', () => {
  it('keeps actionable server messages while removing Convex transport wrappers', () => {
    const error = new Error(
      '[CONVEX A(nodeslideAgent:proposeEdit)] [Request ID: abc123] Server Error Uncaught Error: The deck changed while this proposal was running.\n    at handler (../convex/nodeslideAgent.ts:99:3)',
    );

    expect(nodeSlideErrorMessage(error, 'The proposal could not be created.')).toBe(
      'The deck changed while this proposal was running.',
    );
  });

  it('does not expose infrastructure-only failures to the interface', () => {
    const error = new Error(
      '[CONVEX A(nodeslideAgent:proposeEdit)] [Request ID: abc123] Server Error',
    );

    expect(nodeSlideErrorMessage(error, 'The proposal could not be created.')).toBe(
      'The proposal could not be created.',
    );
  });

  it('prefers a safe structured error message', () => {
    const error = {
      data: { message: 'Reconnect the deck owner capability and try again.' },
      message: 'Convex Server Error',
    };

    expect(nodeSlideErrorMessage(error, 'The deck could not be opened.')).toBe(
      'Reconnect the deck owner capability and try again.',
    );
  });
});
