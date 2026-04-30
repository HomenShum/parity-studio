export interface KitContractInput {
  slug: string;
  runId?: string | undefined;
  prompt?: string | undefined;
  sourceHtml?: string | undefined;
  sourceType?: 'generated-html' | 'platform-route' | 'imported-kit' | 'image' | 'unknown' | undefined;
  sourceUrl?: string | undefined;
  sourceTitle?: string | undefined;
  selector?: string | undefined;
  viewport?: { width: number; height: number } | undefined;
  consoleErrors?: string[] | undefined;
  codeContext?: { filesRead: number; bytesRead: number; root?: string | undefined } | undefined;
  importToParityStudio?: boolean | undefined;
  byokMode?: 'hosted-default' | 'local-mcp-byok' | 'hosted-byok' | undefined;
  createdAtIso?: string | undefined;
}

export interface KitOperatingContract {
  schemaVersion: 1;
  generator: 'parity-studio';
  slug: string;
  source: {
    type: NonNullable<KitContractInput['sourceType']>;
    prompt: string;
    routeUrl: string | null;
    title: string | null;
    selector: string | null;
    htmlHash: string | null;
    hashAlgorithm: 'fnv1a32' | 'none';
    capturedAt: string;
    viewport: { width: number; height: number } | null;
    consoleErrorBudget: 0;
    consoleErrors: string[];
    codeContext: { filesRead: number; bytesRead: number; root?: string | undefined } | null;
  };
  intent: {
    surface: string;
    userGoal: string;
    mustPreserve: string[];
  };
  appearance: {
    matchSource: string[];
    tokenPolicy: string[];
  };
  organization: {
    pageRole: string;
    informationArchitecture: string[];
    commandFirstActions: string[];
  };
  performance: {
    budgets: {
      cachedDbReadMs: number;
      tabSwitchMs: number;
      routeTransitionPerceivedMs: number;
      commandPaletteMs: number;
      agentSuggestionRenderMs: number;
      backgroundWork: string;
    };
    rules: string[];
  };
  api: {
    mode: 'plan-first';
    requiredEnvVars: string[];
    liveWiringChecks: string[];
    sideEffectPolicy: string;
  };
  qa: {
    browserRoutes: string[];
    selectors: string[];
    consoleErrorBudget: 0;
    screenshotRequired: boolean;
    overflowChecks: boolean;
    dogfoodSteps: string[];
  };
  agentPolicy: {
    impactClasses: string[];
    editProtocol: string[];
    approvalGates: string[];
    contractUpdateRule: string;
  };
  privacy: {
    byokMode: NonNullable<KitContractInput['byokMode']>;
    localKeyPolicy: string;
    hostedUploadPolicy: string;
    telemetryPolicy: string;
  };
}

export function withOperatingContract(
  files: Record<string, string>,
  input: KitContractInput,
): Record<string, string> {
  const generated = buildOperatingContractFiles(input);
  const out = { ...files };
  const contractPath = `ui_kits/${input.slug}/parity.contract.json`;

  // The contract is computed from trusted route/run metadata, so it wins over
  // model output for provenance/security fields.
  out[contractPath] = generated[contractPath] ?? out[contractPath] ?? '';

  for (const [path, content] of Object.entries(generated)) {
    if (path === contractPath) continue;
    if (!(path in out)) out[path] = content;
  }

  return out;
}

export function buildOperatingContractFiles(input: KitContractInput): Record<string, string> {
  const contract = buildOperatingContract(input);
  const slug = input.slug;
  return {
    [`ui_kits/${slug}/parity.contract.json`]: `${JSON.stringify(contract, null, 2)}\n`,
    [`ui_kits/${slug}/performance.budget.json`]: `${JSON.stringify(buildPerformanceBudget(contract), null, 2)}\n`,
    [`ui_kits/${slug}/api-wiring.plan.md`]: buildApiWiringPlan(contract),
    [`ui_kits/${slug}/qa.plan.md`]: buildQaPlan(contract),
    [`.claude/skills/${slug}/SKILL.md`]: buildClaudeSkill(contract),
    [`.cursor/rules/${slug}-parity-studio.mdc`]: buildCursorRule(contract),
    'AGENTS.md': buildAgentsMd(contract),
  };
}

export function buildOperatingContract(input: KitContractInput): KitOperatingContract {
  const sourceType = input.sourceType ?? 'unknown';
  const prompt = input.prompt?.trim() || '(not provided)';
  const sourceHash =
    input.sourceHtml && input.sourceHtml.trim().length > 0 ? stableHash(input.sourceHtml) : null;
  const route = input.sourceUrl ?? null;
  const title = input.sourceTitle ?? null;
  const sourceLabel = route ?? title ?? prompt ?? input.slug;
  const byokMode = input.byokMode ?? 'hosted-default';

  return {
    schemaVersion: 1,
    generator: 'parity-studio',
    slug: input.slug,
    source: {
      type: sourceType,
      prompt,
      routeUrl: route,
      title,
      selector: input.selector ?? null,
      htmlHash: sourceHash,
      hashAlgorithm: sourceHash ? 'fnv1a32' : 'none',
      capturedAt: input.createdAtIso ?? new Date(0).toISOString(),
      viewport: input.viewport ?? null,
      consoleErrorBudget: 0,
      consoleErrors: (input.consoleErrors ?? []).slice(0, 20),
      codeContext: input.codeContext ?? null,
    },
    intent: {
      surface: input.slug,
      userGoal: `Preserve and iterate the UI surface from ${sourceLabel}.`,
      mustPreserve: [
        'Visible text, labels, numbers, and navigation copy stay verbatim unless the user asks to rewrite them.',
        'Layout hierarchy, density, component grouping, and dominant visual weight match the captured source.',
        'Generated components stay scoped to this slug and remain easy for coding agents to integrate.',
      ],
    },
    appearance: {
      matchSource: [
        'Typography scale, font weight contrast, color hierarchy, radius, shadows, and spacing must be traceable to tokens.css.',
        'Comments and bbox edits must target a meaningful visual element, not an arbitrary blank region.',
        'Iteration should produce visible before/after movement when the request is visual.',
      ],
      tokenPolicy: [
        'Use semantic CSS custom properties instead of hardcoded one-off values.',
        'Add or rename tokens only when the new name improves intent or reuse.',
        'Keep tweak-schema.json aligned with user-adjustable visual tokens.',
      ],
    },
    organization: {
      pageRole: 'A product route decomposed into a portable ui_kit slug.',
      informationArchitecture: [
        'Keep top-level navigation, primary content, secondary panels, and drill-in surfaces distinct.',
        'Prefer constrained, legible model objects over scattered props and duplicated markup.',
        'Collapse background agent/status detail unless the user invokes it or it is essential to the task.',
      ],
      commandFirstActions: [
        'Primary user actions should be discoverable as buttons and keyboard/command-palette candidates.',
        'External writes, destructive changes, and production side effects require explicit approval.',
      ],
    },
    performance: {
      budgets: {
        cachedDbReadMs: 50,
        tabSwitchMs: 75,
        routeTransitionPerceivedMs: 150,
        commandPaletteMs: 50,
        agentSuggestionRenderMs: 150,
        backgroundWork: 'idle-only',
      },
      rules: [
        'Keep route payloads small and active-first; lazy-load bodies and secondary panes.',
        'Use virtualization or pagination for long lists.',
        'Do not block visible interaction on background agent work, polling, or telemetry.',
        'Prefer shared read-model snapshots and explicit cache invalidation over repeated live reads.',
      ],
    },
    api: {
      mode: 'plan-first',
      requiredEnvVars: [],
      liveWiringChecks: [
        'Identify mock data before replacing it with live API calls.',
        'Document every endpoint, request shape, response shape, loading state, and error state before wiring.',
        'Verify live wiring in a browser with console/network checks before marking complete.',
      ],
      sideEffectPolicy:
        'No external writes, billing actions, user messaging, or destructive mutations without explicit user approval.',
    },
    qa: {
      browserRoutes: route ? [route] : [],
      selectors: input.selector ? [input.selector] : [],
      consoleErrorBudget: 0,
      screenshotRequired: true,
      overflowChecks: true,
      dogfoodSteps: [
        'Run static lint on edited kit files.',
        'Open the target route in a live browser and check for console errors.',
        'Compare source and generated render for visible text, structure, spacing, and interaction states.',
        'Exercise the primary CTA and any newly wired API path in mock and live modes when applicable.',
      ],
    },
    agentPolicy: {
      impactClasses: ['appearance', 'performance', 'organization', 'api', 'accessibility', 'privacy'],
      editProtocol: [
        'Read parity.contract.json before editing.',
        'Classify the user request by impact class before choosing files.',
        'Read target files before upserting changes.',
        'Update parity.contract.json, performance.budget.json, api-wiring.plan.md, or qa.plan.md when the edit changes their assumptions.',
        'If no contract file changes are needed, state "no contract change" in the final response.',
      ],
      approvalGates: [
        'Secrets or BYOK credential changes',
        'Hosted upload of captured private route content',
        'Network egress to a new provider',
        'External API writes or destructive mutations',
      ],
      contractUpdateRule:
        'Every generation, decomposition, comment, edit, export, and MCP handoff must either update this contract or explicitly state no contract change.',
    },
    privacy: {
      byokMode,
      localKeyPolicy:
        'Local MCP BYOK reads provider keys from the user machine environment only; keys must never be written into kit files, sent to Parity Studio, or logged.',
      hostedUploadPolicy: input.importToParityStudio === false
        ? 'Hosted upload disabled for this run.'
        : 'Hosted import uploads generated kit files and captured source artifact only; provider API keys remain local.',
      telemetryPolicy:
        'Telemetry may include model ids, token counts, latency, costs, verifier status, and file names; redact secrets and user data from captured artifacts before upload.',
    },
  };
}

function buildPerformanceBudget(contract: KitOperatingContract): Record<string, unknown> {
  return {
    schemaVersion: 1,
    slug: contract.slug,
    budgets: contract.performance.budgets,
    rules: contract.performance.rules,
    verification: [
      'Use browser performance timing or app-local perf markers where available.',
      'Fail the handoff if route transitions, tab switches, or command surfaces regress visibly.',
      'Keep agent suggestions non-blocking and render partial progress within 150ms.',
    ],
  };
}

function buildApiWiringPlan(contract: KitOperatingContract): string {
  return `# ${contract.slug} API wiring plan

## Mode

Plan first. Do not replace mock/static data with live calls until endpoints,
auth, loading states, error states, and approval gates are explicit.

## Required env vars

${contract.api.requiredEnvVars.length ? contract.api.requiredEnvVars.map((v) => `- \`${v}\``).join('\n') : '- None declared yet. Add names here before wiring live APIs.'}

## Live wiring checklist

${contract.api.liveWiringChecks.map((item) => `- [ ] ${item}`).join('\n')}

## Side-effect policy

${contract.api.sideEffectPolicy}
`;
}

function buildQaPlan(contract: KitOperatingContract): string {
  const routes = contract.qa.browserRoutes.length
    ? contract.qa.browserRoutes.map((route) => `- \`${route}\``).join('\n')
    : '- Add the local or hosted route that renders this kit.';
  const selectors = contract.qa.selectors.length
    ? contract.qa.selectors.map((selector) => `- \`${selector}\``).join('\n')
    : '- Add stable selectors for primary navigation, hero/content, CTA, comments, and export.';

  return `# ${contract.slug} QA plan

## Browser routes

${routes}

## Stable selectors

${selectors}

## Required checks

${contract.qa.dogfoodSteps.map((step) => `- [ ] ${step}`).join('\n')}
- [ ] Confirm console errors are ${contract.qa.consoleErrorBudget}.
- [ ] Capture before/after screenshots for meaningful visual edits.
- [ ] Check horizontal/vertical overflow at desktop and mobile widths.
`;
}

function buildClaudeSkill(contract: KitOperatingContract): string {
  const name = skillName(contract.slug);
  return `---
name: ${name}
description: Use this skill when integrating, verifying, or iterating the ${contract.slug} Parity Studio ui_kit. Read the operating contract, performance budget, API wiring plan, and QA plan before editing.
---

# Parity Studio ${contract.slug}

Follow this workflow:

1. Read \`ui_kits/${contract.slug}/parity.contract.json\`.
2. Read \`ui_kits/${contract.slug}/performance.budget.json\`, \`api-wiring.plan.md\`, and \`qa.plan.md\`.
3. Classify the request as appearance, performance, organization, api, accessibility, or privacy.
4. Edit the smallest relevant files under \`ui_kits/${contract.slug}/\`.
5. Run static checks and live browser QA when the host app is available.
6. Update the contract/plans when assumptions changed; otherwise state "no contract change".

Never expose BYOK provider keys. Local MCP keys stay in local env only.
`;
}

function buildCursorRule(contract: KitOperatingContract): string {
  return `---
description: Parity Studio operating rules for ${contract.slug}
globs:
  - "ui_kits/${contract.slug}/**/*"
alwaysApply: false
---

Before editing this kit, read \`ui_kits/${contract.slug}/parity.contract.json\`.
Classify each request as appearance, performance, organization, api,
accessibility, or privacy. Preserve visible source text/numbers verbatim unless
the user asks for copy changes. Run static checks and live browser QA for
non-trivial changes. Never write provider API keys into files or logs.
`;
}

function buildAgentsMd(contract: KitOperatingContract): string {
  return `# Agent instructions for ${contract.slug}

This repository contains a Parity Studio ui_kit export. Treat
\`ui_kits/${contract.slug}/parity.contract.json\` as the source of truth for
intent, parity, performance, API wiring, QA, and BYOK/privacy policy.

Required workflow:

1. Read the contract before edits.
2. Classify impact: appearance, performance, organization, api, accessibility, or privacy.
3. Keep edits scoped to the requested surface.
4. Preserve visible source text, labels, and numbers unless the user explicitly changes copy.
5. Update contract/plans when assumptions change, or state "no contract change".
6. Verify with lint plus live browser QA when the host app is runnable.

Security:

- Do not read, print, commit, or upload provider API keys.
- Local MCP BYOK keys stay in local env/config and are never sent to Parity Studio.
- Ask for approval before hosted uploads of private route captures or external side effects.
`;
}

function stableHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

function skillName(slug: string): string {
  return `parity-${slug}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}
