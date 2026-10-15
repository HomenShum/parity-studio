// @vitest-environment node
/**
 * Wiring proof for the MCP tools: a reply that did not finish must never be parsed into a kit, never replace a
 * complete stored kit, and must still be counted in the run's cost. Persona: a designer runs parity_decompose and
 * parity_pipeline; a 24,000-token reply is cut off mid tokens.css, the iterate reply is cut off, the visual judge
 * runs out of its 4,000 tokens. Real handlers (index.ts registers them on a recording McpServer stand-in) and the
 * real call() against a fake Anthropic transport, so no spend. A failure that dropped the unfinished reply's cost
 * made the run look cheaper than what was billed.
 */
import { getModel } from '@earendil-works/pi-ai/compat';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (args: Record<string, unknown>) => Promise<unknown>;
const handlers = new Map<string, Handler>();

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    registerTool(name: string, _cfg: unknown, handler: Handler) {
      handlers.set(name, handler);
    }
    registerResource() {}
    registerPrompt() {}
    async connect() {}
  },
}));
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({ StdioServerTransport: class {} }));
vi.mock('./lib/render.js', () => ({
  renderHtmlToPng: async () => ({ base64: 'cG5n', latencyMs: 1 }),
  shutdownRenderer: async () => undefined,
}));

vi.setConfig({ testTimeout: 30_000 });

const sse = (events: Array<[string, unknown]>): Response =>
  new Response(events.map(([n, d]) => `event: ${n}\ndata: ${JSON.stringify(d)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

/** One Anthropic reply: stop_reason 'end_turn' finishes, 'max_tokens' is the cap, 'refusal' is a Claude 5.5 refusal. */
const anthropicReply = (text: string, stopReason: string, outputTokens = 1000): Response =>
  sse([
    [
      'message_start',
      {
        type: 'message_start',
        message: {
          id: 'm',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [],
          stop_reason: null,
          usage: { input_tokens: 500, output_tokens: 1 },
        },
      },
    ],
    [
      'content_block_start',
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ],
    [
      'content_block_delta',
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    ],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    [
      'message_delta',
      {
        type: 'message_delta',
        delta: { stop_reason: stopReason },
        usage: { output_tokens: outputTokens },
      },
    ],
    ['message_stop', { type: 'message_stop' }],
  ]);

const HTML = `<html><body>${'<p>hello world</p>'.repeat(10)}</body></html>`;
const FENCE = '```';
const kit = (css: string) =>
  `${FENCE}html path=ui_kits/demo/index.html\n${HTML}\n${FENCE}\n${FENCE}css path=ui_kits/demo/tokens.css\n${css}\n${FENCE}\n`;
const sections = Array.from(
  { length: 40 },
  (_, i) =>
    `<section class="s${i}"><h2>Heading number ${i}</h2><p>Paragraph ${i} alpha${i} beta${i}</p><button>Action ${i}</button></section>`,
).join('');
const RICH_HTML = `<html><head><style>:root{--brand:#123456}</style></head><body>${sections}</body></html>`;
// Half the source's sections: 10 of 16 deterministic checks pass (60-85%, 'needs_iteration'), so the pipeline iterates. The stored kit must survive a cut-off iterate reply.
const THIN_HTML = `<html><body>${sections.slice(0, sections.length / 2)}</body></html>`;
const THIN_KIT = `${FENCE}html path=ui_kits/demo/index.html
${THIN_HTML}
${FENCE}
${FENCE}css path=ui_kits/demo/tokens.css
:root { --brand: #123456; }
${FENCE}
${FENCE}json path=ui_kits/demo/manifest.json
{}
${FENCE}
${FENCE}md path=ui_kits/demo/README.md
# demo
${FENCE}
`;
// index.html complete, tokens.css cut off mid-declaration: the reply Codex reproduced.
const CUT_KIT = `${FENCE}html path=ui_kits/demo/index.html\n${HTML}\n${FENCE}\n${FENCE}css path=ui_kits/demo/tokens.css\n:root { --a: `;

// Catalog price in USD for one reply (per-million rates), the same table call() prices from.
const priceUsd = (modelId: string, inTokens: number, outTokens: number): number => {
  // biome-ignore lint/suspicious/noExplicitAny: pi-ai's getModel is typed against its compile-time registry
  const { cost } = (getModel as any)('anthropic', modelId) as {
    cost: { input: number; output: number };
  };
  return (inTokens * cost.input + outTokens * cost.output) / 1_000_000;
};

let replies: Response[] = [];
let requests = 0;

beforeEach(() => {
  replies = [];
  requests = 0;
  vi.stubEnv('PARITY_DASHBOARD', 'disabled');
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      requests += 1;
      const next = replies.shift();
      if (next === undefined) throw new Error('unexpected extra request');
      return next;
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function tool(name: string): Promise<Handler> {
  if (handlers.size === 0) {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await import('./index');
    for (let i = 0; i < 100 && !handlers.has('parity_pipeline'); i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  const handler = handlers.get(name);
  if (handler === undefined) throw new Error(`tool ${name} was not registered`);
  return handler;
}

describe('parity_decompose', () => {
  it('a reply cut off at the 24,000-token cap is an error, not a successful kit with warnings []', async () => {
    replies = [anthropicReply(CUT_KIT, 'max_tokens', 24_000)];
    const decompose = await tool('parity_decompose');
    await expect(
      decompose({ artifactHtml: HTML, decomposeModel: 'claude-opus-5-5' }),
    ).rejects.toThrow(
      /decompose stage truncated at its output cap.*no kit was returned \(billed \$/,
    );
  });

  it('a refusal is an error', async () => {
    replies = [anthropicReply('', 'refusal', 5)];
    const decompose = await tool('parity_decompose');
    await expect(
      decompose({ artifactHtml: HTML, decomposeModel: 'claude-opus-5-5' }),
    ).rejects.toThrow(/decompose stage error/);
  });

  it('control: the same kit finished normally is returned', async () => {
    replies = [anthropicReply(kit(':root { --a: 1; }'), 'end_turn')];
    const decompose = await tool('parity_decompose');
    const out = (await decompose({ artifactHtml: HTML, decomposeModel: 'claude-opus-5-5' })) as {
      content: Array<{ text: string }>;
    };
    expect(JSON.parse(out.content[0]?.text ?? '{}').fileCount).toBe(2);
  });
});

describe('parity_pipeline records the cost of a reply that did not finish', () => {
  const failedRun = async (args: Record<string, unknown>) => {
    const { eventBus } = await import('./dashboard/events');
    const before = new Set(eventBus.listRuns().map((r) => r.id));
    const pipeline = await tool('parity_pipeline');
    await expect(
      pipeline({
        prompt: 'a landing page',
        generateModel: 'claude-sonnet-5-5',
        decomposeModel: 'claude-opus-5-5',
        judgeModel: 'claude-sonnet-5-5',
        ...args,
      }),
    ).rejects.toThrow();
    const created = eventBus.listRuns().filter((r) => !before.has(r.id));
    expect(created).toHaveLength(1);
    return created[0] as NonNullable<ReturnType<typeof eventBus.getRun>>;
  };

  it('generate cut off at its cap: the run fails and the billed reply is in the cost', async () => {
    replies = [anthropicReply('<html><body>half', 'max_tokens', 16_000)];
    const record = await failedRun({});
    expect(record.status).toBe('failed');
    expect(record.errorMessage).toMatch(/generate stage truncated at its output cap/);
    expect(record.costUsd).toBeGreaterThan(0);
  });

  it('judge cut off at its cap: the judge reply is in the cost next to generate and decompose', async () => {
    replies = [
      anthropicReply(HTML, 'end_turn'),
      anthropicReply(kit(':root { --a: 1; }'), 'end_turn'),
      anthropicReply('{"summary":"cl', 'max_tokens', 4_000),
    ];
    const record = await failedRun({ sourceImageBase64: 'cG5n', sourceImageMimeType: 'image/png' });
    expect(requests).toBe(3);
    expect(record.errorMessage).toMatch(
      /visual judge truncated at its output cap.*no score reported/,
    );
    // Every reply reports 500 input tokens; output is 1,000 (generate), 1,000 (decompose), 4,000 (judge).
    const expected =
      priceUsd('claude-sonnet-5-5', 500, 1_000) +
      priceUsd('claude-opus-5-5', 500, 1_000) +
      priceUsd('claude-sonnet-5-5', 500, 4_000);
    expect(record.costUsd).toBeCloseTo(expected, 6);
  });

  it('iterate cut off: the previous kit is kept and the cut-off reply is in the cost', async () => {
    // A thin kit against a rich source falls below parity, so the pipeline iterates.
    replies = [
      anthropicReply(RICH_HTML, 'end_turn'),
      anthropicReply(THIN_KIT, 'end_turn'),
      anthropicReply(CUT_KIT, 'max_tokens', 24_000),
    ];
    const record = await failedRun({});
    expect(requests).toBe(3);
    expect(record.errorMessage).toMatch(
      /iterate stage truncated at its output cap.*previous kit was kept/,
    );
    expect(Object.keys(record.uiKitFiles ?? {}).some((f) => f.endsWith('tokens.css'))).toBe(true);
    // generate 1,000 + decompose 1,000 + iterate 24,000 output tokens: the iterate reply dominates the cost.
    expect(record.costUsd).toBeGreaterThan(0.2);
  });
});
