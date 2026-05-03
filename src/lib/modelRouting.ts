export type Tier = 'frontier' | 'balanced' | 'free';

export type ModelProvider =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'openrouter'
  | 'groq'
  | 'cerebras'
  | 'xai'
  | 'mistral';

export interface ModelOverride {
  provider: ModelProvider;
  modelId: string;
  label?: string;
}

export const MODEL_ROUTERS: Array<{
  value: Tier;
  label: string;
  sublabel: string;
  detail: string;
}> = [
  {
    value: 'balanced',
    label: 'Balanced AI',
    sublabel: 'default',
    detail: 'Recommended quality and cost',
  },
  {
    value: 'frontier',
    label: 'Best quality AI',
    sublabel: 'highest quality',
    detail: 'Slower and more expensive',
  },
  {
    value: 'free',
    label: 'Free AI route',
    sublabel: '$0 LLM route',
    detail: 'Uses free-capable models when available',
  },
];

export const MODEL_PROVIDERS: Array<{ value: ModelProvider; label: string; envVar: string }> = [
  { value: 'anthropic', label: 'Anthropic', envVar: 'ANTHROPIC_API_KEY' },
  { value: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY' },
  { value: 'google', label: 'Google Gemini', envVar: 'GEMINI_API_KEY' },
  { value: 'openrouter', label: 'OpenRouter', envVar: 'OPENROUTER_API_KEY' },
  { value: 'groq', label: 'Groq', envVar: 'GROQ_API_KEY' },
  { value: 'cerebras', label: 'Cerebras', envVar: 'CEREBRAS_API_KEY' },
  { value: 'xai', label: 'xAI', envVar: 'XAI_API_KEY' },
  { value: 'mistral', label: 'Mistral', envVar: 'MISTRAL_API_KEY' },
];

export const MODEL_PRESETS: ModelOverride[] = [
  { provider: 'anthropic', modelId: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { provider: 'anthropic', modelId: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { provider: 'openrouter', modelId: 'moonshotai/kimi-k2.6', label: 'Kimi K2.6' },
  {
    provider: 'openrouter',
    modelId: 'google/gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro via OpenRouter',
  },
  {
    provider: 'openrouter',
    modelId: 'inclusionai/ling-2.6-1t:free',
    label: 'Ling 2.6 free via OpenRouter',
  },
  { provider: 'google', modelId: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro direct' },
];

export function modelRouteLabel(
  tier: Tier,
  modelOverride?: ModelOverride | null,
): {
  title: string;
  detail: string;
  sublabel: string;
} {
  if (modelOverride?.modelId) {
    const provider = MODEL_PROVIDERS.find((p) => p.value === modelOverride.provider);
    return {
      title: modelOverride.label?.trim() || modelOverride.modelId,
      detail: `${provider?.label ?? modelOverride.provider} / ${modelOverride.modelId}`,
      sublabel: 'custom',
    };
  }
  const defaultRouter = MODEL_ROUTERS[0];
  if (!defaultRouter) {
    throw new Error('MODEL_ROUTERS must include at least one route');
  }
  const router = MODEL_ROUTERS.find((r) => r.value === tier) ?? defaultRouter;
  return {
    title: router.label,
    detail: router.detail,
    sublabel: router.sublabel,
  };
}
