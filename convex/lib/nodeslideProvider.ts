import { call } from './piAi';

const FREE_PROVIDER = 'openrouter' as const;
const FREE_MODEL = 'openrouter/free';
const MODEL_TIMEOUT_MS = 45_000;

export interface NodeSlideProviderTelemetry {
  provider: string;
  model: string;
  costMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export type NodeSlideProviderResult =
  | { ok: true; value: unknown; telemetry: NodeSlideProviderTelemetry }
  | {
      ok: false;
      reason: string;
      telemetry?: NodeSlideProviderTelemetry;
    };

export async function callNodeSlideFreeJson(args: {
  systemPrompt: string;
  userText: string;
  maxTokens: number;
}): Promise<NodeSlideProviderResult> {
  try {
    const result = await call({
      provider: FREE_PROVIDER,
      modelId: FREE_MODEL,
      systemPrompt: args.systemPrompt,
      userText: args.userText,
      maxTokens: args.maxTokens,
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });
    const telemetry: NodeSlideProviderTelemetry = {
      provider: result.provider,
      model: result.modelUsed || FREE_MODEL,
      costMicroUsd: result.costMicroUsd,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
    if (result.stopReason === 'error') {
      return { ok: false, reason: 'The free route returned an error.', telemetry };
    }
    if (result.stopReason === 'length') {
      return { ok: false, reason: 'The free route response was incomplete.', telemetry };
    }
    const value = parseJsonEnvelope(result.text);
    if (value === undefined) {
      return { ok: false, reason: 'The free route returned malformed JSON.', telemetry };
    }
    return { ok: true, value, telemetry };
  } catch {
    // Provider exceptions are intentionally collapsed so auth values and upstream payloads
    // can never leak into traces or client-visible receipts.
    return { ok: false, reason: 'The free route was unavailable.' };
  }
}

function parseJsonEnvelope(text: string): unknown | undefined {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const objectStart = trimmed.indexOf('{');
    const objectEnd = trimmed.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      try {
        return JSON.parse(trimmed.slice(objectStart, objectEnd + 1)) as unknown;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
