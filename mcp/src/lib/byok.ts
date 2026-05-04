import { type SupportedProvider, inferProvider } from './llmClient.js';

export const PROVIDER_KEY_ENV: Record<SupportedProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  xai: 'XAI_API_KEY',
  mistral: 'MISTRAL_API_KEY',
};

export interface ModelKeyStatus {
  model: string;
  provider: SupportedProvider;
  envVar: string;
  present: boolean;
}

export function localByokStatus(models: readonly string[]): {
  mode: 'local-mcp-byok';
  models: ModelKeyStatus[];
  safeKeyPolicy: string;
  missingEnvVars: string[];
} {
  const statuses = models.map((model) => {
    const provider = inferProvider(model);
    const envVar = PROVIDER_KEY_ENV[provider];
    return {
      model,
      provider,
      envVar,
      present: Boolean(process.env[envVar]),
    };
  });
  const missingEnvVars = Array.from(
    new Set(statuses.filter((status) => !status.present).map((status) => status.envVar)),
  );
  return {
    mode: 'local-mcp-byok',
    models: statuses,
    safeKeyPolicy:
      'Provider keys are read from this local MCP process env only. Values are never returned, logged, written into kit files, or uploaded to Parity Studio.',
    missingEnvVars,
  };
}

export function requireLocalKeys(models: readonly string[]): ReturnType<typeof localByokStatus> {
  const status = localByokStatus(models);
  if (status.missingEnvVars.length > 0) {
    const missing = status.missingEnvVars.join(', ');
    const modelList = status.models.map((item) => `${item.model} -> ${item.envVar}`).join('; ');
    throw new Error(
      `Local MCP BYOK is missing required provider env var(s): ${missing}. ` +
        `Set them in the MCP server env. Model key map: ${modelList}. Key values are never sent to Parity Studio.`,
    );
  }
  return status;
}
