import { describe, expect, it, vi } from 'vitest';
import type { NodeSlideAgentMemory } from '../../shared/nodeslide';
import {
  NODESLIDE_MEMORY_RETRIEVAL_LIMIT,
  NODESLIDE_MEMORY_RETRIEVAL_MAX_BYTES,
  selectRelevantMemories,
} from '../nodeslideMemory';

function memory(
  id: string,
  content: string,
  category: NodeSlideAgentMemory['category'] = 'context',
  status: NodeSlideAgentMemory['status'] = 'active',
  updatedAt = 1_000,
): NodeSlideAgentMemory {
  return {
    id,
    deckId: 'deck-memory',
    category,
    content,
    status,
    source: 'user',
    contentDigest: `sha256:${id}`,
    createdAt: 500,
    updatedAt,
    useCount: 0,
  };
}

describe('NodeSlide durable memory retrieval', () => {
  it('ranks relevant user memory ahead of unrelated recent context', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T12:00:00Z'));
    const selected = selectRelevantMemories(
      [
        memory('recent', 'Use a blue gradient for legal updates', 'context', 'active', Date.now()),
        memory(
          'world-cup',
          'For World Cup analysis, cite FIFA data and lead with attendance.',
          'instruction',
          'active',
          Date.now() - 86_400_000,
        ),
      ],
      'Rewrite the World Cup attendance story with stronger evidence',
    );
    expect(selected[0]?.id).toBe('world-cup');
    vi.useRealTimers();
  });

  it('never retrieves archived memory and enforces item and byte bounds', () => {
    const oversized = 'x'.repeat(NODESLIDE_MEMORY_RETRIEVAL_MAX_BYTES + 1);
    const selected = selectRelevantMemories(
      [
        memory('archived', 'World Cup private note', 'fact', 'archived'),
        memory('oversized', oversized, 'context'),
        ...Array.from({ length: 12 }, (_, index) =>
          memory(`active-${index}`, `World Cup audience preference ${index}`, 'preference'),
        ),
      ],
      'World Cup audience',
      99,
    );
    expect(selected).toHaveLength(NODESLIDE_MEMORY_RETRIEVAL_LIMIT);
    expect(selected.map((item) => item.id)).not.toContain('archived');
    expect(selected.map((item) => item.id)).not.toContain('oversized');
    expect(
      selected.reduce(
        (total, item) => total + new TextEncoder().encode(item.content).byteLength,
        0,
      ),
    ).toBeLessThanOrEqual(NODESLIDE_MEMORY_RETRIEVAL_MAX_BYTES);
  });
});
