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

export interface PostDecomposeStage {
  id: string;
  label: string;
  purpose: string;
  agentAction: string;
  requiredEvidence: string[];
  blocksProductionApply: boolean;
}

export interface DirectionCard {
  id: string;
  label: string;
  useWhen: string;
  visualBias: string;
  preserves: string[];
  avoid: string[];
  acceptance: string[];
}

export interface FiveDCritiqueAxis {
  id: string;
  label: string;
  question: string;
  failSignal: string;
  requiredEvidence: string;
}

export interface DesignSystemRuleSection {
  id: string;
  title: string;
  purpose: string;
  sourceEvidence: string[];
  agentRule: string;
}

export interface SkillRoute {
  id: string;
  label: string;
  trigger: string;
  mustRead: string[];
  mayWrite: string[];
  mustNever: string[];
  outputProof: string[];
}

export interface DesignSystemSkillsPayload {
  schemaVersion: 1;
  kind: 'parity.design-system-skills';
  slug: string | null;
  targetFlow: string | null;
  designSystemPolicy: string;
  designSystemSections: DesignSystemRuleSection[];
  skillRoutes: SkillRoute[];
  openDesignBorrowed: string[];
  openDesignNotBorrowed: string[];
  sources: {
    openDesignDesignSystems: string;
    openDesignSkills: string;
    openDesignReferences: string;
  };
}

export interface PostDecomposeProcessPayload {
  schemaVersion: 1;
  kind: 'parity.post-decompose-process';
  slug: string | null;
  targetFlow: string | null;
  lockedComponents: string[];
  canonicalLoop: string[];
  stages: PostDecomposeStage[];
  directionCards: DirectionCard[];
  p0Checklist: string[];
  fiveDCritique: FiveDCritiqueAxis[];
  agentRule: string;
  sources: {
    openDesign: string;
    discoveryPrompt: string;
    directionLibrary: string;
  };
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
  postDecomposeProcess: PostDecomposeProcessPayload;
  designSystemSkills: DesignSystemSkillsPayload;
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

export const POST_DECOMPOSE_STAGES: PostDecomposeStage[] = [
  {
    id: 'discovery-lock',
    label: 'Discovery lock',
    purpose:
      'Freeze source of truth, target flow, locked components, allowed scope, proof requirements, and privacy mode before new design work.',
    agentAction:
      'Read discovery.questions.json, fill safe defaults only where non-blocking, and ask before production apply if a blocking answer is missing.',
    requiredEvidence: ['discovery.questions.json', 'parity.contract.json'],
    blocksProductionApply: true,
  },
  {
    id: 'direction-cards',
    label: 'Direction cards',
    purpose:
      'Turn vague style requests into one selected deterministic direction, without replacing the source product grammar.',
    agentAction:
      'Choose or ask the user to choose one direction card; bind its constraints into design.plan.md before generating variants.',
    requiredEvidence: ['direction-cards.json', 'design.plan.md'],
    blocksProductionApply: true,
  },
  {
    id: 'seed-capture-baseline',
    label: 'Seed/capture baseline',
    purpose:
      'Use the exact captured route, screenshot, or imported kit as the baseline seed instead of drawing a fresh approximation.',
    agentAction:
      'Open the source capture and preview side by side; every proposed delta must point back to a visible source region or slug.',
    requiredEvidence: ['source capture', 'ui_kits/<slug>/index.html', 'browser-qa.proof.json'],
    blocksProductionApply: true,
  },
  {
    id: 'p0-checklist',
    label: 'P0 checklist',
    purpose:
      'Block approval if the kit loses source recognizability, hides critical user flow state, or skips QA proof.',
    agentAction:
      'Run p0-checklist.md after each meaningful iteration and repair all P0 misses before export/apply.',
    requiredEvidence: ['p0-checklist.md', 'proof.checklist.md'],
    blocksProductionApply: true,
  },
  {
    id: 'five-d-critique',
    label: '5D critique',
    purpose:
      'Score the proposal beyond aesthetics: desire, density, direction, data, and delivery.',
    agentAction:
      'Write a brief score and concrete repair for any axis below pass threshold; rerun after repairs.',
    requiredEvidence: ['five-d-critique.json', 'End-user impact readout'],
    blocksProductionApply: false,
  },
  {
    id: 'approval-handoff',
    label: 'Approval handoff',
    purpose:
      'Convert approved design-only changes into repo-safe implementation mapping and QA proof.',
    agentAction:
      'Export ZIP, summarize changed slugs, create apply mapping, and require user approval before writing production files.',
    requiredEvidence: ['approved export ZIP', 'runtime-architecture.*', 'qa-dogfood.packet.json'],
    blocksProductionApply: true,
  },
];

export const DIRECTION_CARDS: DirectionCard[] = [
  {
    id: 'tech-utility-core',
    label: 'Tech utility core',
    useWhen:
      'The existing app is functional and needs clearer hierarchy, state, and controls without losing its product identity.',
    visualBias:
      'Plain utility, visible state, restrained color, dense but scannable controls, precise spacing.',
    preserves: [
      'current app shell',
      'current nav',
      'production terminology',
      'existing cards/lists',
    ],
    avoid: ['marketing landing-page polish', 'generic glassmorphism', 'new dashboard shell'],
    acceptance: [
      'The current route remains recognizable at first glance.',
      'Primary action and current state become easier to see.',
    ],
  },
  {
    id: 'card-memory',
    label: 'Card memory',
    useWhen:
      'The product creates reusable saved artifacts, reports, notes, or research objects that should feel alive over time.',
    visualBias:
      'Card-first memory surfaces with source/status badges, review states, and lightweight recurrence cues.',
    preserves: ['existing card grammar', 'source metadata', 'saved report rhythm'],
    avoid: ['table-only rewrites', 'heavy dashboards', 'decorative memory metaphors'],
    acceptance: [
      'Saved objects show why they matter now.',
      'Review, reuse, and export states are visible without extra navigation.',
    ],
  },
  {
    id: 'report-editorial',
    label: 'Report editorial',
    useWhen: 'The page needs stronger reading flow, source-backed claims, and export confidence.',
    visualBias:
      'Editorial hierarchy, clear sections, restrained accents, readable long-form density.',
    preserves: ['report structure', 'citation/source affordances', 'export/review flow'],
    avoid: ['fake metrics', 'oversized hero treatment', 'unverified decorative charts'],
    acceptance: [
      'A first-time reader can scan the point, evidence, and next action.',
      'Source quality and confidence are visible where decisions happen.',
    ],
  },
  {
    id: 'calm-command-surface',
    label: 'Calm command surface',
    useWhen:
      'The workflow has many actions and needs to feel easier without hiding power-user capability.',
    visualBias: 'Command-first layout, one primary action, progressive disclosure, quiet panels.',
    preserves: ['keyboard/agent flow', 'primary composer', 'existing action vocabulary'],
    avoid: ['wizard-first flow', 'too many primary buttons', 'buried expert controls'],
    acceptance: [
      'A beginner knows the next step.',
      'A power user can still reach advanced controls in one or two interactions.',
    ],
  },
];

export const P0_CHECKLIST: string[] = [
  'Exact source capture or imported source-equivalent preview is present.',
  'Locked slugs/components are named before proposing changes.',
  'The proposal is an overlay/minimal delta unless the user explicitly approved reimagination.',
  'No fake live data, fake metrics, or invented source claims are introduced.',
  'The current user flow remains navigable and recognizable.',
  'Browser QA proof includes desktop plus any requested mobile/tablet states.',
  'End-user impact readout explains why the change matters to the user’s users.',
  'Production apply is blocked until export, proof, and user approval are present.',
];

export const FIVE_D_CRITIQUE: FiveDCritiqueAxis[] = [
  {
    id: 'desirability',
    label: 'Desirability',
    question: 'Does this make the existing product more useful and trustworthy, or just prettier?',
    failSignal: 'The proposal looks polished but hides the reason users came to the page.',
    requiredEvidence: 'End-user impact readout plus before/after screenshot.',
  },
  {
    id: 'density',
    label: 'Density',
    question:
      'Does the page show the right amount of information for the workflow and user expertise?',
    failSignal: 'Beginners are overwhelmed, or power users lose important context.',
    requiredEvidence: 'Visible hierarchy notes and responsive screenshot.',
  },
  {
    id: 'direction',
    label: 'Direction',
    question: 'Is there a selected direction card and does the proposal follow it consistently?',
    failSignal: 'Mixed visual languages, generic SaaS styling, or a new shell without approval.',
    requiredEvidence: 'direction-cards.json selection and design.plan.md constraints.',
  },
  {
    id: 'data',
    label: 'Data',
    question:
      'Are live data, sources, costs, model choices, and confidence states represented honestly?',
    failSignal: 'The design invents numbers, hides uncertainty, or masks missing API wiring.',
    requiredEvidence: 'parity.contract.json, api-wiring.plan.md, or honest placeholder notes.',
  },
  {
    id: 'delivery',
    label: 'Delivery',
    question:
      'Can an agent or engineer apply the approved delta safely without reinterpreting the design?',
    failSignal: 'No slug mapping, no QA proof, no apply plan, or ambiguous production scope.',
    requiredEvidence: 'runtime-architecture.*, qa-dogfood packet, and approved export ZIP.',
  },
];

export const DESIGN_SYSTEM_SECTIONS: DesignSystemRuleSection[] = [
  {
    id: 'visual-theme-atmosphere',
    title: 'Visual Theme & Atmosphere',
    purpose: 'Name the product posture already present in the captured source.',
    sourceEvidence: ['source screenshot', 'dominant page structure', 'existing copy tone'],
    agentRule:
      'Describe the current product feel first. Do not replace it with a brand reference unless the user asks.',
  },
  {
    id: 'color-palette-roles',
    title: 'Color Palette & Roles',
    purpose: 'Extract semantic color roles from tokens.css, CSS variables, or computed styles.',
    sourceEvidence: ['tokens.css', 'colors_and_type.css', 'captured CSS'],
    agentRule:
      'Prefer source-derived semantic tokens. If borrowing a reference palette, map it to roles and keep source hierarchy.',
  },
  {
    id: 'typography-rules',
    title: 'Typography Rules',
    purpose: 'Lock display/body/mono roles, scale, weight, line-height, and density.',
    sourceEvidence: ['captured CSS', 'computed font styles', 'visible headings/body text'],
    agentRule:
      'Keep typography recognizable before experimenting. Any new type direction needs before/after proof.',
  },
  {
    id: 'component-stylings',
    title: 'Component Stylings',
    purpose: 'Document cards, buttons, nav, composer, lists, comments, coach, and export controls.',
    sourceEvidence: ['ui-slugs.json', 'locked-components.md', 'component files'],
    agentRule:
      'Layer new capabilities into existing component grammar unless reimagination is explicitly approved.',
  },
  {
    id: 'layout-principles',
    title: 'Layout Principles',
    purpose: 'Capture shell, rails, panels, canvas, breakpoints, and information density.',
    sourceEvidence: ['source capture', 'browser QA screenshots', 'parity.contract.json'],
    agentRule:
      'Do not introduce a new shell or nav hierarchy without approval. Preserve workflow orientation.',
  },
  {
    id: 'depth-elevation',
    title: 'Depth & Elevation',
    purpose: 'Lock radius, border, shadow, surface stacking, and annotation treatment.',
    sourceEvidence: ['tokens.css', 'preview screenshots', 'comment overlay behavior'],
    agentRule:
      'Use elevation to clarify state, not decoration. Persistent annotations must not look like defects.',
  },
  {
    id: 'dos-donts',
    title: "Do's and Don'ts",
    purpose: 'Translate product-specific taste and anti-patterns into explicit agent constraints.',
    sourceEvidence: ['post-decompose.method.md', 'direction-cards.json', 'user comments'],
    agentRule:
      'Write project-specific constraints. Avoid generic SaaS redesign language and fake metrics.',
  },
  {
    id: 'responsive-behavior',
    title: 'Responsive Behavior',
    purpose: 'Define desktop, tablet, phone, and multi-surface behavior for the decomposed kit.',
    sourceEvidence: ['parity.project.json', 'browser-qa.proof.json', 'surface selector'],
    agentRule:
      'Preserve the selected surface intent and verify at the requested viewports before export.',
  },
  {
    id: 'agent-prompt-guide',
    title: 'Agent Prompt Guide',
    purpose:
      'Tell coding agents exactly how to use the design system when editing or applying deltas.',
    sourceEvidence: ['skills.parity.md', 'skill-routing.json', 'AGENTS.md'],
    agentRule:
      'Route every request through the smallest skill route and produce proof before closing.',
  },
];

export const SKILL_ROUTES: SkillRoute[] = [
  {
    id: 'route-capture-decompose',
    label: 'Route capture and decompose',
    trigger: 'User has an existing running app, hosted URL, screenshot, or handoff ZIP.',
    mustRead: ['parity.contract.json', 'design-system.rules.json'],
    mayWrite: ['ui_kits/<slug>/**', 'parity.project.json', 'browser-qa.proof.json'],
    mustNever: ['Upload local provider keys', 'invent a replacement shell before source capture'],
    outputProof: ['canonical ui_kit ZIP', 'parity report', 'source capture evidence'],
  },
  {
    id: 'locked-component-repair',
    label: 'Locked component repair',
    trigger: 'User comments on a bbox/file or asks for a scoped visual fix.',
    mustRead: ['locked-components.md', 'ui-slugs.json', 'DESIGN.md'],
    mayWrite: ['target component file', 'tokens.css', 'proof.checklist.md'],
    mustNever: ['Rewrite unrelated slugs', 'leave a persistent annotation that looks like a bug'],
    outputProof: ['before/after note', 'Parity Coach readout', 'browser QA result'],
  },
  {
    id: 'inspiration-director',
    label: 'Inspiration director',
    trigger: 'User wants references, competitor patterns, or a more premium direction.',
    mustRead: ['direction-cards.json', 'design-system.rules.json', 'open-design-takeaways.md'],
    mayWrite: ['design.plan.md', 'post-decompose.method.md', 'qa-dogfood.plan.md'],
    mustNever: ['Copy proprietary layouts/assets', 'treat reference brands as official assets'],
    outputProof: ['reference provenance', 'abstracted pattern list', 'safe apply brief'],
  },
  {
    id: 'qa-dogfood-relay',
    label: 'QA dogfood relay',
    trigger: 'User wants proof, release assets, GIF/MP4, or easier-to-read submission packets.',
    mustRead: ['qa-dogfood.packet.json', 'snapshot-snippets.json', 'remotion.storyboard.json'],
    mayWrite: ['qa-dogfood.plan.md', 'gmail-magic-resend.html', 'easier-to-read-submission.md'],
    mustNever: ['Mark distribution ready without proof for key user states'],
    outputProof: ['test links', 'before/after snippets', 'media plan', 'correction prompts'],
  },
  {
    id: 'figma-bridge',
    label: 'Figma bridge',
    trigger: 'User wants Figma import/export or design review in Figma.',
    mustRead: ['figma.bridge.json', 'design-system.rules.json', 'tokens.css'],
    mayWrite: ['figma/manifest.json', 'figma/code.js', 'figma/ui.html'],
    mustNever: ['Claim perfect vector parity without verification'],
    outputProof: ['Figma bridge ZIP', 'frame/component map', 'round-trip import notes'],
  },
  {
    id: 'approved-production-apply',
    label: 'Approved production apply',
    trigger: 'User approved the Parity design and asks to update the real repo.',
    mustRead: ['runtime-architecture.*', 'post-decompose.process.json', 'proof.checklist.md'],
    mayWrite: ['approved mapped repo files after dryRun approval'],
    mustNever: ['Write outside projectRoot', 'skip dryRun', 'apply unapproved design variants'],
    outputProof: ['dry-run mapping', 'changed files', 'tests/browser verification'],
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
    postDecomposeProcess: buildPostDecomposeProcessPayload({}),
    designSystemSkills: buildDesignSystemSkillsPayload({}),
    agentRule:
      'Pick the smallest workflow that proves the user request. If the source is an existing product, prefer capture/decompose/design-mission before generating from scratch.',
  };
}

export function buildPostDecomposeProcessPayload(args: {
  slug?: string;
  targetFlow?: string;
  lockedComponents?: string[];
}): PostDecomposeProcessPayload {
  return {
    schemaVersion: 1,
    kind: 'parity.post-decompose-process',
    slug: args.slug ?? null,
    targetFlow: args.targetFlow ?? null,
    lockedComponents: args.lockedComponents ?? [],
    canonicalLoop: [
      'source route or imported handoff',
      'canonical ui_kit decomposition',
      'discovery lock',
      'direction card',
      'exact capture baseline',
      'P0 checklist',
      '5D critique',
      'browser QA proof',
      'approved export',
      'production apply mapping',
    ],
    stages: POST_DECOMPOSE_STAGES,
    directionCards: DIRECTION_CARDS,
    p0Checklist: P0_CHECKLIST,
    fiveDCritique: FIVE_D_CRITIQUE,
    agentRule:
      'After decomposition, do not jump straight to a fresh mock. Lock discovery, choose a direction card, preserve the exact baseline, pass P0 checks, run 5D critique, and only then export/apply approved deltas.',
    sources: {
      openDesign: 'https://github.com/nexu-io/open-design',
      discoveryPrompt:
        'https://raw.githubusercontent.com/nexu-io/open-design/main/apps/web/src/prompts/discovery.ts',
      directionLibrary:
        'https://raw.githubusercontent.com/nexu-io/open-design/main/apps/web/src/prompts/directions.ts',
    },
  };
}

export function buildPostDecomposeMethodDoc(
  args: {
    slug?: string;
    targetFlow?: string;
    lockedComponents?: string[];
  } = {},
): string {
  const process = buildPostDecomposeProcessPayload(args);
  return `# Post-Decompose Design Method

This kit uses Open Design as a process reference, not as a replacement visual style. Parity Studio's wedge is still: existing source -> verified ui_kit -> scoped repair -> QA proof -> approved production apply.

## Canonical Loop

${process.canonicalLoop.map((step, index) => `${index + 1}. ${step}`).join('\n')}

## Source Context

- Slug: ${process.slug ?? 'not specified'}
- Target flow: ${process.targetFlow ?? 'infer from source route'}
- Locked components: ${process.lockedComponents.length ? process.lockedComponents.join(', ') : 'infer before production apply'}

## Stages

${process.stages
  .map(
    (stage) => `### ${stage.label}

- Purpose: ${stage.purpose}
- Agent action: ${stage.agentAction}
- Required evidence: ${stage.requiredEvidence.join(', ')}
- Blocks production apply: ${stage.blocksProductionApply ? 'yes' : 'no'}`,
  )
  .join('\n\n')}

## Direction Cards

${process.directionCards
  .map(
    (card) => `### ${card.label}

- Use when: ${card.useWhen}
- Bias: ${card.visualBias}
- Preserve: ${card.preserves.join(', ')}
- Avoid: ${card.avoid.join(', ')}
- Acceptance: ${card.acceptance.join(' ')}`,
  )
  .join('\n\n')}

## P0 Checklist

${process.p0Checklist.map((item) => `- [ ] ${item}`).join('\n')}

## 5D Critique

${process.fiveDCritique
  .map(
    (axis) =>
      `- ${axis.label}: ${axis.question} Fail signal: ${axis.failSignal} Evidence: ${axis.requiredEvidence}`,
  )
  .join('\n')}

## Agent Rule

${process.agentRule}
`;
}

export function buildDesignSystemSkillsPayload(args: {
  slug?: string;
  targetFlow?: string;
}): DesignSystemSkillsPayload {
  return {
    schemaVersion: 1,
    kind: 'parity.design-system-skills',
    slug: args.slug ?? null,
    targetFlow: args.targetFlow ?? null,
    designSystemPolicy:
      'Extract the active design system from the source product first. Imported DESIGN.md or Open Design-style brand systems may guide direction, but they cannot override source parity, locked components, or approval gates.',
    designSystemSections: DESIGN_SYSTEM_SECTIONS,
    skillRoutes: SKILL_ROUTES,
    openDesignBorrowed: [
      'Portable DESIGN.md shape with nine sections',
      'Every skill reads the selected design system before output',
      'Skill catalog as explicit routing rather than hidden prompt magic',
      'Design-system dropdown mindset: pick constraints before pixels',
    ],
    openDesignNotBorrowed: [
      'Large bundled third-party design-system catalog inside Parity Studio',
      'Brand-copying or official-brand claims',
      'Free-form artifact generation as the default for existing products',
    ],
    sources: {
      openDesignDesignSystems: 'https://github.com/nexu-io/open-design/tree/main/design-systems',
      openDesignSkills: 'https://github.com/nexu-io/open-design/tree/main/skills',
      openDesignReferences:
        'https://raw.githubusercontent.com/nexu-io/open-design/main/docs/references.md',
    },
  };
}

export function buildDesignSystemMethodDoc(
  args: {
    slug?: string;
    targetFlow?: string;
  } = {},
): string {
  const payload = buildDesignSystemSkillsPayload(args);
  return `# Design System And Skill Routing

Parity uses a source-first design system. Extract the current product's rules before applying inspiration.

## Policy

${payload.designSystemPolicy}

## DESIGN.md Sections

${payload.designSystemSections
  .map(
    (section) => `### ${section.title}

- Purpose: ${section.purpose}
- Source evidence: ${section.sourceEvidence.join(', ')}
- Agent rule: ${section.agentRule}`,
  )
  .join('\n\n')}

## Skill Routes

${payload.skillRoutes
  .map(
    (route) => `### ${route.label}

- Trigger: ${route.trigger}
- Must read: ${route.mustRead.join(', ')}
- May write: ${route.mayWrite.join(', ')}
- Must never: ${route.mustNever.join(', ')}
- Output proof: ${route.outputProof.join(', ')}`,
  )
  .join('\n\n')}

## What We Borrow From Open Design

${payload.openDesignBorrowed.map((item) => `- ${item}`).join('\n')}

## What We Do Not Borrow

${payload.openDesignNotBorrowed.map((item) => `- ${item}`).join('\n')}
`;
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

## What Happens After Decomposition

- Discovery lock: confirm source of truth, target flow, locked slugs, allowed scope, proof, and privacy mode.
- Direction cards: select a deterministic design direction so the agent does not freestyle a new visual language.
- Seed/capture baseline: treat the exact capture as the starting point; proposed designs should be overlays or minimal deltas unless the user approves reimagination.
- P0 checklist: block production apply when exactness, flow clarity, data honesty, browser QA, or approval proof is missing.
- 5D critique: score desirability, density, direction, data, and delivery before export.
- Approval handoff: export the approved ui_kit and apply only mapped deltas to the production repo.

## Design Systems And Skills

- Open Design treats each design-system folder as a portable DESIGN.md context read by every skill.
- Parity adapts that as a source-first DESIGN.md emitted per ui_kit, plus design-system.rules.json and skill-routing.json.
- The active design system must be extracted from the captured product before references are applied.
- Skills are routing contracts: route capture, locked component repair, inspiration director, QA dogfood relay, Figma bridge, and approved production apply.
- Reference systems can shape direction, but they cannot override exact source parity, locked components, data honesty, or approval gates.
`;
}
