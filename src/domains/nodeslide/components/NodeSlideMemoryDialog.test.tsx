import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { NodeSlideAgentMemory } from '../../../../shared/nodeslide';
import { NodeSlideMemoryDialog } from './NodeSlideMemoryDialog';

const memories: NodeSlideAgentMemory[] = [
  {
    id: 'memory-1',
    deckId: 'deck-1',
    category: 'preference',
    content: 'Prefer concise executive headlines and cite every market claim.',
    status: 'active',
    source: 'user',
    contentDigest: 'sha256:abc',
    createdAt: 1,
    updatedAt: 2,
    lastUsedAt: 3,
    useCount: 2,
  },
];

describe('NodeSlide memory manager', () => {
  it('makes persistence, lifecycle, egress, and trace behavior explicit', () => {
    const markup = renderToStaticMarkup(
      <NodeSlideMemoryDialog
        open
        memories={memories}
        enabled
        onEnabledChange={() => undefined}
        onClose={() => undefined}
        onCreate={async () => undefined}
        onUpdate={async () => undefined}
        onDelete={async () => undefined}
      />,
    );

    expect(markup).toContain('data-testid="memory-dialog"');
    expect(markup).toContain('What should this agent remember?');
    expect(markup).toContain('Use relevant memory in new runs');
    expect(markup).toContain('Edit');
    expect(markup).toContain('Archive');
    expect(markup).toContain('Delete');
    expect(markup).toContain('Public shares never include memory');
    expect(markup).toContain('explicitly consented external-model request');
    expect(markup).toContain('Trace stores IDs and digests—not memory text');
    expect(markup).toContain('used 2 times');
  });
});
