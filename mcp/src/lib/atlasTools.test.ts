import { describe, expect, it } from 'vitest';
import { registerAtlasTools } from './atlasTools';

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
}>;

function harness() {
  const handlers = new Map<string, ToolHandler>();
  const definitions = new Map<string, { description: string }>();
  registerAtlasTools({
    registerTool: (name: string, definition: { description: string }, handler: ToolHandler) => {
      definitions.set(name, definition);
      handlers.set(name, handler);
    },
  } as never);
  return { handlers, definitions };
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const { handlers } = harness();
  const handler = handlers.get(name);
  if (!handler) throw new Error(`Tool ${name} was not registered.`);
  const result = await handler(args);
  return JSON.parse(result.content[0]?.text ?? 'null');
}

describe('Atlas MCP tools', () => {
  it('registers the full read-only Atlas surface', () => {
    const { definitions } = harness();
    expect([...definitions.keys()].sort()).toEqual([
      'atlas.check_topology',
      'atlas.check_usage',
      'atlas.inspect_archetype',
      'atlas.list_sources',
      'atlas.search_archetypes',
    ]);
  });

  it('lets an agent find the archetype that demands a real diagram', async () => {
    const result = (await call('atlas.search_archetypes', { text: 'architecture' })) as {
      results: { id: string; requiredArtifactKinds: string[] }[];
    };
    const architecture = result.results.find((entry) => entry.id === 'systems.architecture');
    expect(architecture?.requiredArtifactKinds).toContain('diagram');
  });

  it('caps results and reports the cap rather than truncating silently', async () => {
    const result = (await call('atlas.search_archetypes', { limit: 50 })) as {
      count: number;
      capped: number;
    };
    expect(result.count).toBeLessThanOrEqual(50);
    expect(result.capped).toBe(50);
  });

  it('returns an actionable error for an unknown archetype instead of an empty object', async () => {
    const result = (await call('atlas.inspect_archetype', { archetypeId: 'systems.vibes' })) as {
      error: string;
      hint: string;
    };
    expect(result.error).toMatch(/Unknown archetype/);
    expect(result.hint).toMatch(/atlas.search_archetypes/);
  });

  it('denies retrieval indexing of a remote-reference source with a stated reason', async () => {
    const result = (await call('atlas.check_usage', {
      sourceId: 'mobbin',
      intents: ['rag-index'],
    })) as { allowed: boolean; reasons: string[] };
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/impossible under access mode remote-mcp/);
  });

  it('allows what the open mirror lane genuinely permits', async () => {
    const result = (await call('atlas.check_usage', {
      sourceId: 'uiverse',
      intents: ['download', 'cache'],
    })) as { allowed: boolean; attributionRequired: boolean };
    expect(result.allowed).toBe(true);
    expect(result.attributionRequired).toBe(true);
  });

  it('fails closed for a source that was never reviewed', async () => {
    const result = (await call('atlas.check_usage', {
      sourceId: 'random-blog',
      intents: ['download'],
    })) as { allowed: boolean; reasons: string[] };
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toMatch(/unreviewed sources are denied/);
  });

  it('catches prose standing in for an architecture diagram', async () => {
    const result = (await call('atlas.check_topology', {
      archetypeId: 'systems.architecture',
      producedArtifactKinds: ['text'],
      detectedSubstitutes: ['prose-as-architecture'],
    })) as { passed: boolean; violations: string[] };
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(2);
  });

  it('passes a slide that produced the required diagram', async () => {
    const result = (await call('atlas.check_topology', {
      archetypeId: 'systems.architecture',
      producedArtifactKinds: ['diagram'],
    })) as { passed: boolean };
    expect(result.passed).toBe(true);
  });

  it('exposes source lanes without leaking permission internals', async () => {
    const sources = (await call('atlas.list_sources')) as { id: string; accessMode: string }[];
    expect(sources.map((entry) => entry.id)).toContain('mobbin');
    expect(sources.every((entry) => !('permissions' in entry))).toBe(true);
  });
});
