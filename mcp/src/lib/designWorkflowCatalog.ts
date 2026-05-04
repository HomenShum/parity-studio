export interface DesignWorkflowCatalogEntry {
  id: string;
  label: string;
  scenario: 'capture' | 'iteration' | 'inspiration' | 'handoff' | 'qa' | 'figma';
  whenToUse: string;
  primaryTool: string;
  requiredInputs: string[];
  generatedProof: string[];
  approvalGate: string;
}

export interface DiscoveryQuestion {
  id: string;
  prompt: string;
  requiredWhen: string;
  safeDefault: string;
  blocksProductionApply: boolean;
}

export interface DesignWorkflowCatalogPayload {
  schemaVersion: 1;
  product: 'parity-studio';
  source: 'open-design-takeaways-adapted';
  positioning: {
    openDesign: string;
    parityStudio: string;
  };
  workflows: DesignWorkflowCatalogEntry[];
  discoveryQuestions: DiscoveryQuestion[];
  agentRule: string;
}

export const DESIGN_WORKFLOW_CATALOG: DesignWorkflowCatalogEntry[] = [
  {
    id: 'existing-app-to-ui-kit',
    label: 'Existing app route to verified ui_kit',
    scenario: 'capture',
    whenToUse:
      'The user has a running product route and wants to stage design work before editing production code.',
    primaryTool: 'parity_platform_to_ui_kit',
    requiredInputs: ['app URL or localhost route', 'projectRoot', 'source of truth route'],
    generatedProof: [
      'captured source HTML',
      'ui_kits/<slug>/',
      'parity.contract.json',
      'parity report',
    ],
    approvalGate: 'Do not apply production deltas until the user approves the imported Parity run.',
  },
  {
    id: 'design-first-slug-board',
    label: 'Design/UI slug board before implementation',
    scenario: 'iteration',
    whenToUse:
      'The user wants broad redesign, granular tweaks, locked-component iteration, or a Figma-like staging board.',
    primaryTool: 'parity_design_mission',
    requiredInputs: ['target flow', 'locked components or inferred slugs', 'allowed change scope'],
    generatedProof: [
      'design-slug-manifest.json',
      'design-workflow.catalog.json',
      'discovery.questions.json',
      'runtime-architecture.*',
      'proof.checklist.md',
    ],
    approvalGate:
      'Use parity_apply_approved_design dryRun first; write repo files only after approval.',
  },
  {
    id: 'inspiration-search-apply',
    label: 'Reference inspiration search and safe apply',
    scenario: 'inspiration',
    whenToUse:
      'The user needs design direction but cannot name the pattern, competitor, or visual system themselves.',
    primaryTool: 'hosted Inspiration workflow plus parity_chat_advise',
    requiredInputs: ['current screen diagnosis', 'target audience', 'copy/no-copy constraints'],
    generatedProof: [
      'reference provenance',
      'recommended redesign plan',
      'agent brief',
      'before/after snippets',
    ],
    approvalGate:
      'Never copy proprietary assets; convert references into abstract product patterns.',
  },
  {
    id: 'comment-scoped-repair',
    label: 'Comment-scoped repair',
    scenario: 'iteration',
    whenToUse:
      'The user pins a bbox or file comment and wants a local visual issue fixed without rewriting the whole kit.',
    primaryTool: 'parity_chat_advise',
    requiredInputs: ['runId', 'commentId or selected file', 'expected visible result'],
    generatedProof: ['chat trace', 'changed files', 'Parity Coach readout', 'browser QA proof'],
    approvalGate:
      'Agent must summarize visible before/after impact and run verification before closing.',
  },
  {
    id: 'qa-dogfood-relay',
    label: 'QA dogfood packet and readable submission',
    scenario: 'qa',
    whenToUse:
      'The user wants every visible change to ship with test links, snippets, GIF/MP4 plan, and resendable proof.',
    primaryTool: 'parity_design_mission plus easier-to-read-submissions',
    requiredInputs: ['feature id', 'workflow lanes', 'personas/user states'],
    generatedProof: [
      'qa-dogfood.packet.json',
      'snapshot-snippets.json',
      'gmail-magic-resend.html',
      'remotion.storyboard.json',
    ],
    approvalGate:
      'Feature is not merge-ready until the packet shows the user states and correction prompts.',
  },
  {
    id: 'figma-bridge-round-trip',
    label: 'Figma bridge import/export',
    scenario: 'figma',
    whenToUse:
      'The user needs the approved kit visible in Figma, or wants a Figma JSON/bridge import converted into a ui_kit.',
    primaryTool: 'parity_figma_export or parity_figma_import',
    requiredInputs: ['ui_kit files or Figma REST/bridge JSON', 'target frame/component naming'],
    generatedProof: ['figma/manifest.json', 'figma/code.js', 'figma/parity-figma-bridge.json'],
    approvalGate:
      'Treat Figma output as design proof; production implementation still uses approved mappings.',
  },
  {
    id: 'approved-delta-apply',
    label: 'Approved design deltas to production repo',
    scenario: 'handoff',
    whenToUse:
      'The user approved the Parity Studio design board and wants exact repo file changes.',
    primaryTool: 'parity_apply_approved_design',
    requiredInputs: ['projectRoot', 'slug', 'explicit mappings or staging folder', 'dryRun review'],
    generatedProof: [
      'dry-run mapping report',
      'changed file list',
      'test/browser verification summary',
    ],
    approvalGate: 'Reject writes outside projectRoot and always run dryRun before write mode.',
  },
];

export const DISCOVERY_QUESTIONS: DiscoveryQuestion[] = [
  {
    id: 'source-of-truth',
    prompt:
      'What is the source of truth: running app route, screenshot, Figma file, existing ui_kit, or prompt?',
    requiredWhen: 'always',
    safeDefault:
      'Use the running app route when available; otherwise preserve the imported artifact.',
    blocksProductionApply: true,
  },
  {
    id: 'target-flow',
    prompt: 'Which end-to-end user flow should the design prove?',
    requiredWhen: 'broad redesign, QA packet, or demo video',
    safeDefault: 'Infer from visible route and name it in design.plan.md.',
    blocksProductionApply: true,
  },
  {
    id: 'locked-components',
    prompt: 'Which components or slugs must remain recognizable?',
    requiredWhen: 'existing product, locked-component iteration, or codebase handoff',
    safeDefault:
      'Lock the shell, primary nav, main composer/CTA, cards/lists, and current hierarchy.',
    blocksProductionApply: true,
  },
  {
    id: 'allowed-scope',
    prompt: 'Is this design-only, approved-deltas, or production-ready?',
    requiredWhen: 'always',
    safeDefault: 'design-only',
    blocksProductionApply: true,
  },
  {
    id: 'reference-policy',
    prompt:
      'Can the agent search references, and should it use competitors, design systems, or public inspiration only?',
    requiredWhen: 'inspiration workflow',
    safeDefault:
      'Use references as abstract patterns only; do not copy assets or proprietary layouts.',
    blocksProductionApply: false,
  },
  {
    id: 'proof-requirements',
    prompt:
      'What proof is required before approval: screenshots, GIF, MP4, browser QA, Figma bridge, or Gmail packet?',
    requiredWhen: 'handoff, release, or user-facing workflow change',
    safeDefault: 'Browser QA plus before/after snippets; add GIF/MP4 for README/release work.',
    blocksProductionApply: false,
  },
  {
    id: 'byok-privacy',
    prompt: 'Should model calls use hosted defaults, local MCP BYOK, or hosted BYOK?',
    requiredWhen: 'local app capture, private repo, or user-provided keys',
    safeDefault: 'local MCP BYOK; never upload provider key values.',
    blocksProductionApply: false,
  },
];

export function buildDesignWorkflowCatalogPayload(): DesignWorkflowCatalogPayload {
  return {
    schemaVersion: 1,
    product: 'parity-studio',
    source: 'open-design-takeaways-adapted',
    positioning: {
      openDesign:
        'Broad local-first artifact generator and Claude Design alternative: skills, design systems, media, sandbox preview, export.',
      parityStudio:
        'Narrow trust layer for existing products: capture/decompose into ui_kit slugs, verify parity, comment/repair, QA proof, then apply approved deltas.',
    },
    workflows: DESIGN_WORKFLOW_CATALOG,
    discoveryQuestions: DISCOVERY_QUESTIONS,
    agentRule:
      'Pick the smallest workflow that proves the user request. If the source is an existing product, prefer capture/decompose/design-mission before generating from scratch.',
  };
}

export function buildDiscoveryQuestionsPayload(args: {
  request?: string;
  targetFlow?: string;
  lockedComponents?: string[];
  allowedChangeScope?: string;
}): {
  schemaVersion: 1;
  status: 'ready' | 'needs_user_answers';
  answered: Record<string, string | string[]>;
  unanswered: DiscoveryQuestion[];
  safeDefaults: Record<string, string>;
} {
  const answered: Record<string, string | string[]> = {};
  if (args.request) answered.request = args.request;
  if (args.targetFlow) answered['target-flow'] = args.targetFlow;
  if (args.lockedComponents && args.lockedComponents.length > 0) {
    answered['locked-components'] = args.lockedComponents;
  }
  if (args.allowedChangeScope) answered['allowed-scope'] = args.allowedChangeScope;

  const unanswered = DISCOVERY_QUESTIONS.filter((question) => {
    if (question.id === 'target-flow') return !args.targetFlow;
    if (question.id === 'locked-components') {
      return !args.lockedComponents || args.lockedComponents.length === 0;
    }
    if (question.id === 'allowed-scope') return !args.allowedChangeScope;
    return false;
  });

  return {
    schemaVersion: 1,
    status: unanswered.some((question) => question.blocksProductionApply)
      ? 'needs_user_answers'
      : 'ready',
    answered,
    unanswered,
    safeDefaults: Object.fromEntries(DISCOVERY_QUESTIONS.map((q) => [q.id, q.safeDefault])),
  };
}

export function buildOpenDesignTakeawaysDoc(): string {
  return `# Open Design Takeaways For Parity Studio

## What Open Design Does Well

- Local-first daemon with project persistence and BYOK configuration.
- Broad skill and design-system catalog before the model starts designing.
- Preflight discovery form so the agent locks surface, audience, direction, and constraints before creating pixels.
- Sandboxed iframe preview and multi-format exports.
- MCP access to the currently open design project so coding agents can read live design artifacts instead of stale ZIPs.

## What Parity Studio Deliberately Does Differently

- Parity starts from an existing source route, screenshot, Figma bridge, Claude Design/Open CoDesign export, or ui_kit and decomposes it into verified slugs.
- Parity treats design as a staging layer before production implementation, not as a free-form artifact generator.
- Parity requires parity.contract.json, QA proof, end-user impact readout, and approval gates before production deltas are applied.
- Parity's MCP can capture existing app routes, produce ui_kit ZIPs, import hosted runs, and dry-run approved mappings back to a repo.

## Contribution Candidates Upstream

- Codex CLI launch compatibility where Open Design still references deprecated flags.
- DESIGN.md/design-package finalization from source plus chat transcript.
- Queued follow-up messages while an agent run is in flight.
- Clearer MCP install and currently-open-project handoff patterns.
- Kilo/custom agent adapter coverage.

## Product Rule

Use Open Design-style catalog and discovery discipline, but keep Parity Studio's wedge: existing app to verified ui_kit to scoped comment/edit to QA proof to approved production apply.
`;
}
