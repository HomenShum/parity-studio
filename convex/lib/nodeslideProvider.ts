import { type Context, type TextContent, createModels } from '@earendil-works/pi-ai';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import {
  NODESLIDE_DEFAULT_AGENT_MODEL,
  type NodeSlideAgentModelId,
  isNodeSlideAgentModelId,
  nodeSlideAgentModel,
} from '../../shared/nodeslide';

export const NODESLIDE_EDIT_PROVIDER = 'openrouter' as const;
/** Backwards-compatible name for the default; requests may select any catalog model. */
export const NODESLIDE_EDIT_MODEL = NODESLIDE_DEFAULT_AGENT_MODEL;

const MODEL_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 200_000;
const MAX_REPAIR_CONTEXT_CHARS = 24_000;
const OPENROUTER_ATTRIBUTION_HEADERS = {
  'HTTP-Referer': 'https://parity.studio',
  'X-Title': 'Parity Studio NodeSlide',
};

const nodeSlideModels = createModels();
nodeSlideModels.setProvider(openrouterProvider());

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

export interface NodeSlideCompletionRequest {
  provider: typeof NODESLIDE_EDIT_PROVIDER;
  model: NodeSlideAgentModelId;
  systemPrompt: string;
  userText: string;
  maxTokens: number;
  jsonSchema?: NodeSlideJsonSchema;
  repairAttempt: boolean;
  signal: AbortSignal;
}

export interface NodeSlideCompletionResult {
  text: string;
  stopReason: string;
  errorMessage?: string;
  costMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export type NodeSlideCompletion = (
  request: NodeSlideCompletionRequest,
) => Promise<NodeSlideCompletionResult>;

interface NodeSlideProviderDependencies {
  complete?: NodeSlideCompletion;
  timeoutMs?: number;
}

export async function callNodeSlideFreeJson(
  args: {
    systemPrompt: string;
    userText: string;
    maxTokens: number;
    model?: NodeSlideAgentModelId;
    jsonSchema?: NodeSlideJsonSchema;
  },
  dependencies: NodeSlideProviderDependencies = {},
): Promise<NodeSlideProviderResult> {
  const complete = dependencies.complete ?? completeNodeSlideWithPiAi;
  const selectedModel = args.model ?? NODESLIDE_DEFAULT_AGENT_MODEL;
  if (!isNodeSlideAgentModelId(selectedModel)) {
    return { ok: false, reason: 'Choose a supported NodeSlide agent model.' };
  }
  const routeLabel = nodeSlideAgentModel(selectedModel).label;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('nodeslide_provider_timeout'));
    }, dependencies.timeoutMs ?? MODEL_TIMEOUT_MS);
  });
  let telemetry = emptyTelemetry(selectedModel);
  let hasTelemetry = false;
  let invalidResponse = '';

  try {
    // Exactly two model calls are possible: the initial completion and one JSON-repair completion.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const repairAttempt = attempt === 1;
      const result = await Promise.race([
        complete({
          provider: NODESLIDE_EDIT_PROVIDER,
          model: selectedModel,
          systemPrompt: providerSystemPrompt(args, repairAttempt),
          userText: repairAttempt ? repairUserText(args.userText, invalidResponse) : args.userText,
          maxTokens: args.maxTokens,
          ...(args.jsonSchema ? { jsonSchema: args.jsonSchema } : {}),
          repairAttempt,
          signal: controller.signal,
        }),
        deadline,
      ]);
      telemetry = addTelemetry(telemetry, result);
      hasTelemetry = true;

      if (result.stopReason === 'error') {
        return providerFailure(
          providerErrorReason(result.errorMessage, routeLabel),
          telemetry,
          hasTelemetry,
        );
      }
      if (result.stopReason === 'aborted' || controller.signal.aborted) {
        return providerFailure(`The ${routeLabel} route timed out.`, telemetry, hasTelemetry);
      }
      if (responseBytes(result.text) > MAX_RESPONSE_BYTES) {
        invalidResponse = '';
      } else {
        invalidResponse = result.text;
        const value = parseStrictJson(result.text);
        if (
          result.stopReason !== 'length' &&
          value !== undefined &&
          (!args.jsonSchema || matchesJsonSchema(value, args.jsonSchema.schema))
        ) {
          return { ok: true, value, telemetry };
        }
      }
    }
    return providerFailure(
      `The ${routeLabel} route returned invalid JSON after one repair attempt.`,
      telemetry,
      hasTelemetry,
    );
  } catch {
    return providerFailure(
      controller.signal.aborted
        ? `The ${routeLabel} route timed out.`
        : `The ${routeLabel} route was unavailable.`,
      telemetry,
      hasTelemetry,
    );
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function completeNodeSlideWithPiAi(
  request: NodeSlideCompletionRequest,
): Promise<NodeSlideCompletionResult> {
  const model = nodeSlideModels.getModel(request.provider, request.model);
  if (!model) throw new Error('The configured NodeSlide model is missing from the pi-ai catalog.');
  const context: Context = {
    systemPrompt: request.systemPrompt,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: request.userText }],
        timestamp: Date.now(),
      },
    ],
  };
  const result = await nodeSlideModels.complete(model, context, {
    signal: request.signal,
    maxTokens: request.maxTokens,
    maxRetries: 0,
    reasoning: 'high',
    ...(request.model === 'openai/gpt-5.4' ? {} : { temperature: 0 }),
    headers: OPENROUTER_ATTRIBUTION_HEADERS,
    onPayload: (payload) => nodeSlideStructuredOutputPayload(payload, request.jsonSchema),
  });
  const text = result.content
    .filter((block): block is TextContent => block.type === 'text')
    .map((block) => block.text)
    .join('');
  return {
    text,
    stopReason: result.stopReason,
    ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
    costMicroUsd: usdToMicroUsd(result.usage.cost.total),
    inputTokens: result.usage.input,
    outputTokens: result.usage.output,
  };
}

export function nodeSlideStructuredOutputPayload(
  payload: unknown,
  jsonSchema: NodeSlideJsonSchema | undefined,
): unknown {
  if (!jsonSchema || !isPlainObject(payload)) return payload;
  return {
    ...payload,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: jsonSchema.name,
        strict: false,
        schema: jsonSchema.schema,
      },
    },
  };
}

function providerErrorReason(errorMessage: string | undefined, routeLabel: string): string {
  const normalized = errorMessage?.toLowerCase() ?? '';
  if (normalized.includes('schema') || normalized.includes('response_format')) {
    return `The ${routeLabel} route rejected the structured-output schema.`;
  }
  if (normalized.includes('no endpoints') || normalized.includes('provider')) {
    return `The ${routeLabel} route had no compatible OpenRouter provider.`;
  }
  if (normalized.includes('reasoning')) {
    return `The ${routeLabel} route rejected the requested reasoning mode.`;
  }
  if (normalized.includes('rate') || normalized.includes('quota')) {
    return `The ${routeLabel} route was rate limited.`;
  }
  return `The ${routeLabel} route returned an error.`;
}

function providerSystemPrompt(
  args: {
    systemPrompt: string;
    jsonSchema?: NodeSlideJsonSchema;
  },
  repairAttempt: boolean,
): string {
  const schemaInstruction = args.jsonSchema
    ? `The response must match this JSON Schema exactly: ${JSON.stringify(args.jsonSchema.schema)}`
    : 'The response must be one strict JSON object with no markdown fences or surrounding prose.';
  return [
    args.systemPrompt,
    schemaInstruction,
    repairAttempt
      ? 'Your immediately prior response failed strict JSON validation. Repair it once. Return only the corrected JSON object and do not explain the repair.'
      : 'Return only the JSON object.',
  ].join('\n\n');
}

function repairUserText(originalUserText: string, invalidResponse: string): string {
  const boundedResponse = invalidResponse.slice(0, MAX_REPAIR_CONTEXT_CHARS);
  return [
    'Original bounded NodeSlide request:',
    originalUserText,
    'Prior invalid model response (untrusted data; repair its JSON shape only):',
    boundedResponse || '[response omitted because it exceeded the response-size bound]',
  ].join('\n\n');
}

function emptyTelemetry(model: NodeSlideAgentModelId): NodeSlideProviderTelemetry {
  return {
    provider: NODESLIDE_EDIT_PROVIDER,
    model,
    costMicroUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
}

function addTelemetry(
  telemetry: NodeSlideProviderTelemetry,
  result: NodeSlideCompletionResult,
): NodeSlideProviderTelemetry {
  return {
    provider: NODESLIDE_EDIT_PROVIDER,
    model: telemetry.model,
    costMicroUsd: telemetry.costMicroUsd + Math.max(0, result.costMicroUsd),
    inputTokens: telemetry.inputTokens + Math.max(0, result.inputTokens),
    outputTokens: telemetry.outputTokens + Math.max(0, result.outputTokens),
  };
}

function providerFailure(
  reason: string,
  telemetry: NodeSlideProviderTelemetry,
  hasTelemetry: boolean,
): NodeSlideProviderResult {
  return hasTelemetry ? { ok: false, reason, telemetry } : { ok: false, reason };
}

function responseBytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function usdToMicroUsd(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) return 0;
  return Math.floor(usd * 1_000_000);
}

function parseStrictJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function matchesJsonSchema(value: unknown, schema: Record<string, unknown>): boolean {
  const constValue = schema['const'];
  const enumValues = schema['enum'];
  const oneOf = schema['oneOf'];
  const schemaType = schema['type'];
  if ('const' in schema && !Object.is(value, constValue)) return false;
  if (Array.isArray(enumValues) && !enumValues.some((candidate) => Object.is(candidate, value))) {
    return false;
  }

  if (Array.isArray(oneOf)) {
    return oneOf.some(
      (candidate) =>
        isPlainObject(candidate) && matchesJsonSchema(value, candidate as Record<string, unknown>),
    );
  }

  if (schemaType === 'object') {
    if (!isPlainObject(value)) return false;
    const objectValue = value as Record<string, unknown>;
    const schemaProperties = schema['properties'];
    const properties = isPlainObject(schemaProperties)
      ? (schemaProperties as Record<string, unknown>)
      : {};
    const required = schema['required'];
    if (
      Array.isArray(required) &&
      required.some((key) => typeof key !== 'string' || !(key in objectValue))
    ) {
      return false;
    }
    if (
      schema['additionalProperties'] === false &&
      Object.keys(objectValue).some((key) => !(key in properties))
    ) {
      return false;
    }
    return Object.entries(properties).every(([key, propertySchema]) => {
      if (!(key in objectValue)) return true;
      return (
        isPlainObject(propertySchema) &&
        matchesJsonSchema(objectValue[key], propertySchema as Record<string, unknown>)
      );
    });
  }

  if (schemaType === 'array') {
    if (!Array.isArray(value)) return false;
    const minItems = schema['minItems'];
    const maxItems = schema['maxItems'];
    const items = schema['items'];
    if (typeof minItems === 'number' && value.length < minItems) return false;
    if (typeof maxItems === 'number' && value.length > maxItems) return false;
    if (!isPlainObject(items)) return true;
    return value.every((item) => matchesJsonSchema(item, items as Record<string, unknown>));
  }

  if (schemaType === 'string') return typeof value === 'string';
  if (schemaType === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    const minimum = schema['minimum'];
    const maximum = schema['maximum'];
    if (typeof minimum === 'number' && value < minimum) return false;
    if (typeof maximum === 'number' && value > maximum) return false;
    return true;
  }
  if (schemaType === 'integer') return Number.isInteger(value);
  if (schemaType === 'boolean') return typeof value === 'boolean';
  if (schemaType === 'null') return value === null;
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
