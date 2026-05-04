import { PROVIDER_KEY_ENV } from './byok.js';
import { type SupportedProvider, inferProvider } from './llmClient.js';

export interface AgentRuntimeProfile {
  id: 'claude-code' | 'codex' | 'cursor' | 'windsurf' | 'generic-mcp';
  label: string;
  transport: 'stdio-mcp';
  strengths: string[];
  approvals: string[];
  recommendedTools: string[];
}

export const AGENT_RUNTIME_PROFILES: AgentRuntimeProfile[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    transport: 'stdio-mcp',
    strengths: ['project skill files', 'approval-gated shell/tool use', 'large-context repo edits'],
    approvals: ['provider env keys stay in MCP config', 'approve production apply mappings'],
    recommendedTools: [
      'parity_design_mission',
      'parity_platform_to_ui_kit',
      'parity_apply_approved_design',
    ],
  },
  {
    id: 'codex',
    label: 'Codex',
    transport: 'stdio-mcp',
    strengths: ['repo-aware implementation', 'browser QA handoff', 'git/push verification'],
    approvals: ['keep secrets in local environment', 'commit only after browser and tests pass'],
    recommendedTools: [
      'parity_design_mission',
      'parity_export_zip',
      'parity_apply_approved_design',
    ],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    transport: 'stdio-mcp',
    strengths: ['codebase navigation', 'component mapping', 'local preview iteration'],
    approvals: ['scope MCP env to provider keys used by selected models'],
    recommendedTools: [
      'parity_platform_to_ui_kit',
      'parity_decompose',
      'parity_apply_approved_design',
    ],
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    transport: 'stdio-mcp',
    strengths: ['agentic repo edits', 'multi-file refactors', 'local preview loops'],
    approvals: ['use dryRun before applying approved design mappings'],
    recommendedTools: ['parity_design_mission', 'parity_verify', 'parity_apply_approved_design'],
  },
  {
    id: 'generic-mcp',
    label: 'Generic MCP client',
    transport: 'stdio-mcp',
    strengths: ['portable tool discovery', 'local BYOK', 'zip handoff'],
    approvals: ['explicitly approve upload/import to hosted Parity Studio'],
    recommendedTools: ['parity_studio', 'parity_byok_status', 'parity_export_zip'],
  },
];

export function buildAgentRuntimeMetadata(models: readonly string[] = []): {
  profiles: AgentRuntimeProfile[];
  providerEnvAllowlist: string[];
  safeEnvPolicy: string[];
  modelProviders: Array<{ model: string; provider: SupportedProvider; envVar: string }>;
} {
  const modelProviders = models.map((model) => {
    const provider = inferProvider(model);
    return { model, provider, envVar: PROVIDER_KEY_ENV[provider] };
  });
  return {
    profiles: AGENT_RUNTIME_PROFILES,
    providerEnvAllowlist: allowedProviderEnv(modelProviders.map((item) => item.provider)),
    safeEnvPolicy: [
      'Pass only provider keys required by the selected models.',
      'Do not forward unrelated provider keys to child agents or subprocesses.',
      'Never return, log, write, or upload secret values.',
      'Use parity_byok_status for presence checks; it returns env var names and booleans only.',
      'Use parity_apply_approved_design dryRun before writing production files.',
    ],
    modelProviders,
  };
}

export function filterSafeAgentEnv(
  env: NodeJS.ProcessEnv,
  models: readonly string[] = [],
): Record<string, string> {
  const metadata = buildAgentRuntimeMetadata(models);
  const allowed = new Set([
    'PATH',
    'Path',
    'HOME',
    'USERPROFILE',
    'SystemRoot',
    'TEMP',
    'TMP',
    'PARITY_CONVEX_URL',
    'PARITY_CONVEX_HTTP_URL',
    'PARITY_GENERATE_MODEL',
    'PARITY_DECOMPOSE_MODEL',
    'PARITY_JUDGE_MODEL',
    ...metadata.providerEnvAllowlist,
  ]);
  const out: Record<string, string> = {};
  for (const key of allowed) {
    const value = env[key];
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

function allowedProviderEnv(providers: readonly SupportedProvider[]): string[] {
  const providerSet = new Set(providers);
  return Array.from(providerSet)
    .map((provider) => PROVIDER_KEY_ENV[provider])
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}
