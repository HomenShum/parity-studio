import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('NodeSlide mutation transport contract', () => {
  it('allows source-grounded replacement copy across the Convex validator boundary', () => {
    const validatorSource = readFileSync(
      resolve(process.cwd(), 'convex/lib/nodeslideValidators.ts'),
      'utf8',
    );
    expect(validatorSource).toContain('sourceIds: v.optional(v.array(v.string()))');
  });
});
