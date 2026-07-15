import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NODESLIDE_DELEGATION_MUTATION_TIMEOUT_MS,
  withNodeSlideDelegationDeadline,
} from './delegationClient';

afterEach(() => {
  vi.useRealTimers();
});

describe('NodeSlide delegation client deadline', () => {
  it('rejects a never-settling authority mutation at the bounded deadline', async () => {
    vi.useFakeTimers();
    const result = withNodeSlideDelegationDeadline(
      new Promise<never>(() => undefined),
      'Delegation grant issuance',
    );
    const rejection = expect(result).rejects.toThrow(
      'Delegation grant issuance timed out. Review mode remains active.',
    );

    await vi.advanceTimersByTimeAsync(NODESLIDE_DELEGATION_MUTATION_TIMEOUT_MS);
    await rejection;
  });

  it('returns a settled mutation and clears its deadline', async () => {
    vi.useFakeTimers();
    await expect(
      withNodeSlideDelegationDeadline(Promise.resolve('revoked'), 'Delegation revocation'),
    ).resolves.toBe('revoked');
    expect(vi.getTimerCount()).toBe(0);
  });
});
