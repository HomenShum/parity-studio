const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_FREE_MODELS = [
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-nano-9b-v2:free',
] as const;
const MODEL_TIMEOUT_MS = 45_000;
const MAX_RESPONSE_CHARS = 32_000;
const OPENROUTER_ATTRIBUTION_HEADERS = {
  'HTTP-Referer': 'https://parity.studio',
  'X-Title': 'Parity Studio NodeSlide',
};

export interface NodeSlideProviderTelemetry {
  provider: string;
  model: string;
  costMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface NodeSlideJsonSchema {
  name: string;
  schema: Record<string, unknown>;
}

export type NodeSlideProviderResult =
  | { ok: true; value: unknown; telemetry: NodeSlideProviderTelemetry }
  | {
      ok: false;
      reason: string;
      telemetry?: NodeSlideProviderTelemetry;
    };

interface NodeSlideProviderDependencies {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  modelCandidates?: readonly string[];
  timeoutMs?: number;
}

export async function callNodeSlideFreeJson(
  args: {
    systemPrompt: string;
    userText: string;
    maxTokens: number;
    jsonSchema?: NodeSlideJsonSchema;
  },
  dependencies: NodeSlideProviderDependencies = {},
): Promise<NodeSlideProviderResult> {
  const apiKey = dependencies.apiKey ?? process.env['OPENROUTER_API_KEY']?.trim();
  if (!apiKey) return { ok: false, reason: 'The free route was unavailable.' };

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const modelCandidates =
    dependencies.modelCandidates ??
    configuredFreeModels(process.env['NODESLIDE_OPENROUTER_MODELS']);
  const deadline = Date.now() + (dependencies.timeoutMs ?? MODEL_TIMEOUT_MS);
  let lastReason = 'The free route was unavailable.';
  let lastTelemetry: NodeSlideProviderTelemetry | undefined;

  for (const model of modelCandidates) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;

    try {
      const response = await fetchImpl(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...OPENROUTER_ATTRIBUTION_HEADERS,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: args.systemPrompt },
            { role: 'user', content: args.userText },
          ],
          temperature: 0,
          max_tokens: args.maxTokens,
          response_format: args.jsonSchema
            ? {
                type: 'json_schema',
                json_schema: {
                  name: args.jsonSchema.name,
                  strict: true,
                  schema: args.jsonSchema.schema,
                },
              }
            : { type: 'json_object' },
          provider: { require_parameters: true },
          reasoning: { effort: 'low', exclude: true },
          plugins: [{ id: 'response-healing' }],
        }),
        signal: AbortSignal.timeout(remainingMs),
      });

      if (!response.ok) {
        lastReason =
          response.status === 429
            ? 'The free route was temporarily capacity limited.'
            : 'The free route returned an error.';
        if (response.status === 401 || response.status === 403) break;
        continue;
      }

      const payload = await response.json();
      const telemetry = providerTelemetry(payload, model);
      lastTelemetry = telemetry;
      const choice = firstChoice(payload);
      if (choice?.finishReason === 'length') {
        lastReason = 'The free route response was incomplete.';
        continue;
      }
      if (!choice?.content || choice.content.length > MAX_RESPONSE_CHARS) {
        lastReason = 'The free route returned malformed JSON.';
        continue;
      }
      const value = parseJsonEnvelope(choice.content);
      if (value === undefined) {
        lastReason = 'The free route returned malformed JSON.';
        continue;
      }
      return { ok: true, value, telemetry };
    } catch {
      // Provider exceptions are intentionally collapsed so auth values and upstream payloads
      // can never leak into traces or client-visible receipts.
      lastReason = 'The free route was unavailable.';
    }
  }

  return lastTelemetry
    ? { ok: false, reason: lastReason, telemetry: lastTelemetry }
    : { ok: false, reason: lastReason };
}

function configuredFreeModels(configured: string | undefined): readonly string[] {
  const models = configured
    ?.split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  return models?.length ? models : DEFAULT_FREE_MODELS;
}

function firstChoice(payload: unknown): { content: string; finishReason?: string } | null {
  if (!isRecord(payload) || !Array.isArray(payload['choices'])) return null;
  const choice = payload['choices'][0];
  if (
    !isRecord(choice) ||
    !isRecord(choice['message']) ||
    typeof choice['message']['content'] !== 'string'
  ) {
    return null;
  }
  return {
    content: choice['message']['content'],
    ...(typeof choice['finish_reason'] === 'string'
      ? { finishReason: choice['finish_reason'] }
      : {}),
  };
}

function providerTelemetry(payload: unknown, requestedModel: string): NodeSlideProviderTelemetry {
  const record = isRecord(payload) ? payload : {};
  const usage = isRecord(record['usage']) ? record['usage'] : {};
  const costUsd = numberField(usage['cost']);
  return {
    provider: 'openrouter',
    model:
      typeof record['model'] === 'string' && record['model'] ? record['model'] : requestedModel,
    costMicroUsd: Math.max(0, Math.round(costUsd * 1_000_000)),
    inputTokens: Math.max(0, Math.round(numberField(usage['prompt_tokens']))),
    outputTokens: Math.max(0, Math.round(numberField(usage['completion_tokens']))),
  };
}

function numberField(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
