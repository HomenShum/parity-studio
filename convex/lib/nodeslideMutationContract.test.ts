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

  it('validates claim lineage before persisting an agent proposal and stores it on the trace', () => {
    const mutationSource = readFileSync(resolve(process.cwd(), 'convex/nodeslide.ts'), 'utf8');
    const schemaSource = readFileSync(resolve(process.cwd(), 'convex/schema.ts'), 'utf8');
    const lineageGate = mutationSource.indexOf('const sourceLineage = buildNodeSlideSourceLineage');
    const persistence = mutationSource.indexOf(
      "const proposal = await persistProposal(ctx, { ...args, source: 'agent' })",
    );

    expect(lineageGate).toBeGreaterThan(0);
    expect(persistence).toBeGreaterThan(lineageGate);
    expect(mutationSource).toContain('...sourceLineage');
    expect(schemaSource).toContain('sourceBindingStatus: v.optional');
    expect(schemaSource).toContain('claimSourceBindings: v.optional');
  });
});
