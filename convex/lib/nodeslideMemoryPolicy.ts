import type { NodeSlideAgentMemory } from '../../shared/nodeslide';

export type NodeSlideMemoryUse = 'standing_instruction' | 'retrieved_memory';

/**
 * Only a user-authored memory explicitly categorized as an instruction is a
 * standing instruction. Agent-authored or inferred memory never silently
 * acquires instruction authority.
 */
export function nodeSlideMemoryUse(memory: NodeSlideAgentMemory): NodeSlideMemoryUse {
  return memory.category === 'instruction' && memory.source === 'user'
    ? 'standing_instruction'
    : 'retrieved_memory';
}

export function isNodeSlideStandingInstruction(memory: NodeSlideAgentMemory): boolean {
  return nodeSlideMemoryUse(memory) === 'standing_instruction';
}
