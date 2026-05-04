import { buildFigmaBridgeFiles } from './figmaBridge.js';
import { buildQaDogfoodRelayFiles } from './qaDogfoodRelay.js';

export interface DesignMissionOptions {
  request?: string;
  targetFlow?: string;
  lockedSlugs?: string[];
  lockedComponents?: string[];
  allowedChangeScope?: 'design-only' | 'approved-deltas' | 'production-ready';
  allowedDeltas?: string[];
  forbiddenPatterns?: string[];
  includeRuntimeArchitecture?: boolean;
  includeLockedSlugComparison?: boolean;
  includeImplementationMap?: boolean;
  proofMedia?: boolean;
  figmaBridge?: boolean;
  qaDogfoodRelay?: boolean;
  qaFeatureId?: string;
  qaPersonas?: string[];
  qaUserStates?: string[];
  qaWorkflowLanes?: string[];
}

const DEFAULT_ALLOWED_DELTAS = [
  'style chips',
  'source policy chips',
  'batch sample actions',
  'QA badges',
  'source/citation counters',
  'review/export/watch states',
  'memo seed/rubric fit labels',
];

const DEFAULT_FORBIDDEN_PATTERNS = [
  'new top-level nav',
  'new dashboard shell',
  'wizard replacing the existing chat/composer flow',
  'table-only replacement for existing cards',
  'large style gallery above the current composer',
  'generic SaaS redesign language',
];

export function designMissionPromptBlock(mission?: DesignMissionOptions): string {
  if (!mission) return '';
  const lockedSlugs = cleanList(mission.lockedSlugs);
  const lockedComponents = cleanList(mission.lockedComponents);
  const scope = mission.allowedChangeScope ?? 'design-only';
  return `

DESIGN-FIRST PARITY MISSION:
${mission.request ? `User mission: ${mission.request}` : 'User mission: create a design-only Parity Studio staging kit before production edits.'}
${mission.targetFlow ? `Target flow: ${mission.targetFlow}` : 'Target flow: infer from the captured route.'}
Allowed change scope: ${scope}

Locked UI slugs:
${lockedSlugs.length > 0 ? lockedSlugs.map((slug) => `- ${slug}`).join('\n') : '- infer stable slugs from existing route structure'}

Locked existing components:
${lockedComponents.length > 0 ? lockedComponents.map((name) => `- ${name}`).join('\n') : '- preserve existing visible component grammar; do not invent a new shell'}

Design mission rules:
- Treat this as a design staging board, not production implementation.
- Preserve locked components and slugs as non-negotiable unless the user explicitly says otherwise.
- Add memo/batch/inspiration/iteration features as layers inside existing component patterns.
- Do not create a new top-level dashboard/nav if the captured product already has a working shell.
- Emit files that let a coding agent view, comment, verify, approve, and only then apply deltas to the repo.
- Include design.plan.md, design-slug-manifest.json, ui-slugs.json, locked-components.md, proof.checklist.md, browser-qa.proof.json, media.plan.json, figma.bridge.json, qa-dogfood.packet.json, qa-dogfood.plan.md, snapshot-snippets.json, gmail-magic-resend.html, remotion.storyboard.json, and easier-to-read-submission.md in the ui_kit.
- If requested or useful for a larger product change, include decomposed-comparison.html and runtime-architecture.md/html/json with implementation maps and QA gates.`;
}

export function withDesignMissionFiles(
  files: Record<string, string>,
  slug: string,
  mission?: DesignMissionOptions,
): Record<string, string> {
  if (!mission) return files;
  const lockedSlugs = cleanList(mission.lockedSlugs);
  const lockedComponents = cleanList(mission.lockedComponents);
  const scope = mission.allowedChangeScope ?? 'design-only';
  const allowedDeltas = cleanList(mission.allowedDeltas).length
    ? cleanList(mission.allowedDeltas)
    : DEFAULT_ALLOWED_DELTAS;
  const forbiddenPatterns = cleanList(mission.forbiddenPatterns).length
    ? cleanList(mission.forbiddenPatterns)
    : DEFAULT_FORBIDDEN_PATTERNS;
  const lockedSlugEntries = buildLockedSlugEntries({
    lockedSlugs,
    lockedComponents,
    allowedDeltas,
  });
  const includeRuntimeArchitecture = mission.includeRuntimeArchitecture !== false;
  const includeLockedSlugComparison = mission.includeLockedSlugComparison !== false;
  const includeImplementationMap = mission.includeImplementationMap !== false;
  const includeQaDogfoodRelay = mission.qaDogfoodRelay !== false;
  const baseFiles = {
    ...files,
    [`ui_kits/${slug}/design-slug-manifest.json`]: `${JSON.stringify(
      {
        schemaVersion: 1,
        mode: 'parity-design-first',
        slug,
        request: mission.request ?? null,
        targetFlow: mission.targetFlow ?? null,
        allowedChangeScope: scope,
        lockedSlugs,
        lockedComponents,
        allowedDeltas,
        forbiddenPatterns,
        rules: [
          'Use these slugs as the editable design surface before production implementation.',
          'Preserve locked existing components unless the user approves a replacement.',
          'Attach new capabilities as layers inside existing component grammar.',
          'Export approved deltas back to the coding agent only after browser/parity proof.',
        ],
      },
      null,
      2,
    )}\n`,
    [`ui_kits/${slug}/design.plan.md`]: buildDesignPlan({
      slug,
      mission,
      lockedSlugs,
      lockedComponents,
      scope,
    }),
    [`ui_kits/${slug}/ui-slugs.json`]: `${JSON.stringify(
      {
        schemaVersion: 1,
        surface: slug,
        mode: 'locked-component-iteration',
        lockedSlugs: lockedSlugEntries,
        forbiddenPatterns,
      },
      null,
      2,
    )}\n`,
    [`ui_kits/${slug}/locked-components.md`]: buildLockedComponentsDoc({
      slug,
      lockedSlugEntries,
      lockedComponents,
      allowedDeltas,
      forbiddenPatterns,
    }),
    [`ui_kits/${slug}/proof.checklist.md`]: buildProofChecklist({
      proofMedia: mission.proofMedia === true,
      includeRuntimeArchitecture,
      includeLockedSlugComparison,
      includeImplementationMap,
      includeQaDogfoodRelay,
    }),
    [`ui_kits/${slug}/browser-qa.proof.json`]: `${JSON.stringify(
      {
        routes: [],
        viewports: ['desktop', 'tablet', 'phone'],
        screenshots: [],
        consoleErrors: [],
        overflowFindings: [],
        clickTargets: [],
        sourceHash: '',
        previewHash: '',
        status: 'pending',
      },
      null,
      2,
    )}\n`,
    [`ui_kits/${slug}/media.plan.json`]: `${JSON.stringify(
      {
        enabled: mission.proofMedia === true,
        scenes: mission.proofMedia
          ? [
              'capture source route',
              'show Parity Studio imported ui_kit',
              'show comment/edit or design slug iteration',
              'show verification and export',
            ]
          : [],
        outputs: [],
        verification: {
          required: mission.proofMedia === true,
          rubric: [
            'video shows source and generated preview clearly',
            'video shows the requested design workflow end-to-end',
            'video shows proof/verification/export state',
          ],
        },
      },
      null,
      2,
    )}\n`,
    [`ui_kits/${slug}/figma.bridge.json`]: `${JSON.stringify(
      {
        enabled: mission.figmaBridge === true,
        mode: mission.figmaBridge ? 'bridge-ready' : 'none',
        frames: [],
        tokens: [],
        assets: [],
        limitations: [
          'Initial bridge is token/asset/frame metadata; full Figma vector component variants require an explicit follow-up tool.',
        ],
      },
      null,
      2,
    )}\n`,
  };

  const comparisonFiles = includeLockedSlugComparison
    ? {
        [`ui_kits/${slug}/decomposed-comparison.html`]: buildComparisonHtml({
          slug,
          mission,
          lockedSlugEntries,
          allowedDeltas,
        }),
      }
    : {};

  const runtimeFiles = includeRuntimeArchitecture
    ? buildRuntimeArchitectureFiles({
        slug,
        mission,
        lockedSlugEntries,
        includeImplementationMap,
      })
    : {};
  const figmaFiles = mission.figmaBridge === true ? buildFigmaBridgeFiles(baseFiles, slug) : {};
  const qaDogfoodFiles = includeQaDogfoodRelay
    ? buildQaDogfoodRelayFiles({ slug, mission, lockedSlugEntries })
    : {};

  return {
    ...baseFiles,
    ...comparisonFiles,
    ...runtimeFiles,
    ...figmaFiles,
    ...qaDogfoodFiles,
  };
}

function buildDesignPlan({
  slug,
  mission,
  lockedSlugs,
  lockedComponents,
  scope,
}: {
  slug: string;
  mission: DesignMissionOptions;
  lockedSlugs: string[];
  lockedComponents: string[];
  scope: string;
}): string {
  return `# ${slug} Design Mission

## Mission

${mission.request ?? 'Create a design-first Parity Studio staging kit before production edits.'}

## Target Flow

${mission.targetFlow ?? 'Infer the target user flow from the captured route and visible UI.'}

## Allowed Change Scope

${scope}

## Locked UI Slugs

${lockedSlugs.length > 0 ? lockedSlugs.map((slugName) => `- \`${slugName}\``).join('\n') : '- Infer slugs from the captured UI and preserve existing component grammar.'}

## Locked Existing Components

${lockedComponents.length > 0 ? lockedComponents.map((name) => `- ${name}`).join('\n') : '- Preserve the current shell, navigation, cards, composer, and report patterns unless explicitly approved.'}

## Workflow

1. Use this kit as the design board before production implementation.
2. Iterate only the scoped slugs/components requested by the user.
3. Verify with browser screenshots, parity checks, and end-user impact readout.
4. Export approved deltas for the coding agent to implement in the real repo.
5. Do not apply production code changes until the user approves the Parity Studio result.
`;
}

function buildProofChecklist({
  proofMedia,
  includeRuntimeArchitecture,
  includeLockedSlugComparison,
  includeImplementationMap,
  includeQaDogfoodRelay,
}: {
  proofMedia: boolean;
  includeRuntimeArchitecture: boolean;
  includeLockedSlugComparison: boolean;
  includeImplementationMap: boolean;
  includeQaDogfoodRelay: boolean;
}): string {
  return `# Proof Checklist

- [ ] Source route captured and redacted.
- [ ] Locked UI slugs/components declared.
- [ ] ui-slugs.json names every locked component slug.
- [ ] locked-components.md states allowed and forbidden deltas.
${includeLockedSlugComparison ? '- [ ] decomposed-comparison.html shows current vs proposed by locked slug.' : '- [ ] Locked-slug comparison intentionally skipped.'}
${includeRuntimeArchitecture ? '- [ ] Runtime architecture handoff exists as md/html/json.' : '- [ ] Runtime architecture handoff intentionally skipped.'}
${includeImplementationMap ? '- [ ] Frontend/backend/database/agent implementation maps are present.' : '- [ ] Implementation map intentionally skipped.'}
- [ ] Design-only kit imported into Parity Studio.
- [ ] Preview renders the current source-equivalent surface.
- [ ] User can comment/select/tweak scoped UI slugs.
- [ ] Agent can make granular edits and major reimagination variants inside allowed scope.
- [ ] Parity Coach reviewed for end-user impact.
- [ ] Browser QA screenshots captured for desktop/tablet/phone.
- [ ] Console errors and overflow issues reviewed.
${includeQaDogfoodRelay ? '- [ ] QA dogfood packet includes links, GIF/MP4 plan, before/after snippets, lanes, and correction prompts.' : '- [ ] QA dogfood relay intentionally skipped.'}
- [ ] Export ZIP generated for approved kit.
${proofMedia ? '- [ ] MP4/GIF proof recorded and video-verified.' : '- [ ] Proof media intentionally skipped for this mission.'}
- [ ] Production repo changes are blocked until user approves the design board.
`;
}

export interface LockedSlugEntry {
  slug: string;
  status: 'locked';
  preserve: string[];
  allowedDelta: string[];
}

function buildLockedSlugEntries({
  lockedSlugs,
  lockedComponents,
  allowedDeltas,
}: {
  lockedSlugs: string[];
  lockedComponents: string[];
  allowedDeltas: string[];
}): LockedSlugEntry[] {
  const preserve =
    lockedComponents.length > 0
      ? lockedComponents
      : [
          'existing shell',
          'primary navigation',
          'main composer or CTA',
          'current card/list rhythm',
          'visible copy and hierarchy',
        ];
  const slugs =
    lockedSlugs.length > 0
      ? lockedSlugs
      : lockedComponents.map((component) => `inferred.${slugify(component)}`);
  return slugs.map((lockedSlug) => ({
    slug: lockedSlug,
    status: 'locked',
    preserve,
    allowedDelta: allowedDeltas,
  }));
}

function buildLockedComponentsDoc({
  slug,
  lockedSlugEntries,
  lockedComponents,
  allowedDeltas,
  forbiddenPatterns,
}: {
  slug: string;
  lockedSlugEntries: LockedSlugEntry[];
  lockedComponents: string[];
  allowedDeltas: string[];
  forbiddenPatterns: string[];
}): string {
  return `# ${slug} Locked Components

This kit is in locked-component iteration mode. Do not replace the existing product shell. Layer changes inside the existing component grammar.

## Locked Slugs

${lockedSlugEntries.length > 0 ? lockedSlugEntries.map((entry) => `- \`${entry.slug}\``).join('\n') : '- No explicit slugs provided; infer stable slugs before production implementation.'}

## Locked Existing Components

${lockedComponents.length > 0 ? lockedComponents.map((component) => `- ${component}`).join('\n') : '- Preserve the current shell, navigation, cards, composer, and report patterns unless explicitly approved.'}

## Allowed Deltas

${allowedDeltas.map((delta) => `- ${delta}`).join('\n')}

## Forbidden Deltas

${forbiddenPatterns.map((pattern) => `- ${pattern}`).join('\n')}

## Agent Rule

If a requested change requires replacing a locked component, stop and ask for approval before changing the production repo.
`;
}

function buildComparisonHtml({
  slug,
  mission,
  lockedSlugEntries,
  allowedDeltas,
}: {
  slug: string;
  mission: DesignMissionOptions;
  lockedSlugEntries: LockedSlugEntry[];
  allowedDeltas: string[];
}): string {
  const lockedList =
    lockedSlugEntries.length > 0
      ? lockedSlugEntries.map((entry) => `<li><code>${escapeHtml(entry.slug)}</code></li>`).join('')
      : '<li>Infer locked slugs from captured route before implementation.</li>';
  const deltaList = allowedDeltas.map((delta) => `<li>${escapeHtml(delta)}</li>`).join('');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(slug)} locked component comparison</title>
    <style>
      body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #fbf7ef; color: #20150f; }
      main { padding: 32px; }
      h1 { font-family: Georgia, serif; font-size: 36px; margin: 0 0 8px; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; margin-top: 24px; }
      .card { border: 1px solid #e4d7c9; border-radius: 18px; background: #fffaf3; padding: 20px; min-height: 280px; box-shadow: 0 18px 50px rgba(61, 40, 27, 0.08); }
      .tag { display: inline-block; border-radius: 999px; background: #e45f3d; color: white; padding: 6px 10px; font-size: 12px; font-weight: 700; }
      code { background: #f2e6d9; border-radius: 6px; padding: 2px 6px; }
      li { margin: 8px 0; }
    </style>
  </head>
  <body>
    <main>
      <span class="tag">locked component mode</span>
      <h1>${escapeHtml(slug)}</h1>
      <p>${escapeHtml(mission.request ?? 'Current vs proposed design-only staging board.')}</p>
      <section class="grid">
        <article class="card">
          <h2>Current decomposition</h2>
          <p>Preserve these slugs/components as the source of truth.</p>
          <ul>${lockedList}</ul>
        </article>
        <article class="card">
          <h2>Proposed locked delta</h2>
          <p>Only these additive changes are allowed without explicit approval.</p>
          <ul>${deltaList}</ul>
        </article>
      </section>
      <p>Implementation hook: apply approved deltas back to the production repo only after browser QA and user approval.</p>
    </main>
  </body>
</html>
`;
}

function buildRuntimeArchitectureFiles({
  slug,
  mission,
  lockedSlugEntries,
  includeImplementationMap,
}: {
  slug: string;
  mission: DesignMissionOptions;
  lockedSlugEntries: LockedSlugEntry[];
  includeImplementationMap: boolean;
}): Record<string, string> {
  const runtime = {
    schemaVersion: 1,
    surface: slug,
    request: mission.request ?? null,
    targetFlow: mission.targetFlow ?? null,
    implementationRule: [
      'No new app shell unless explicitly approved',
      'Layer changes inside existing locked UI slugs',
      'Use Parity Studio as design proof before production implementation',
    ],
    lockedSlugs: lockedSlugEntries.map((entry) => entry.slug),
    frontend: includeImplementationMap
      ? [
          {
            area: 'captured route UI',
            change: 'Apply approved visual and interaction deltas inside locked slugs',
            lockedSlugs: lockedSlugEntries.map((entry) => entry.slug),
          },
        ]
      : [],
    backend: includeImplementationMap
      ? [
          {
            area: 'app server/API layer',
            change: 'Add only the state/actions required by the approved UI delta',
          },
        ]
      : [],
    database: includeImplementationMap
      ? [
          {
            object: 'feature state',
            purpose: 'Persist user-approved design/runtime changes only when needed',
            keyFields: ['ownerId', 'surfaceSlug', 'status', 'updatedAt'],
          },
        ]
      : [],
    agents: [
      'Capture source route',
      'Decompose locked slugs',
      'Stage proposed delta',
      'Run browser QA',
      'Explain end-user impact',
      'Export approved handoff',
      'Apply production patch only after approval',
    ],
    permissions: [
      {
        input: 'local provider keys',
        default: 'local MCP environment only',
        constraint: 'never write key values into generated kit files or hosted runs',
      },
      {
        input: 'source route content',
        default: 'redact obvious secrets',
        constraint: 'user controls whether imported artifacts are uploaded to hosted Parity Studio',
      },
    ],
    phases: [
      'Design-only locked slug capture',
      'Current vs proposed comparison',
      'Browser QA and Parity Coach review',
      'Approved delta export',
      'Production implementation',
    ],
  };
  return {
    [`ui_kits/${slug}/runtime-architecture.json`]: `${JSON.stringify(runtime, null, 2)}\n`,
    [`ui_kits/${slug}/runtime-architecture.md`]: buildRuntimeMarkdown({ slug, mission, runtime }),
    [`ui_kits/${slug}/runtime-architecture.html`]: buildRuntimeHtml({ slug, mission, runtime }),
  };
}

function buildRuntimeMarkdown({
  slug,
  mission,
  runtime,
}: {
  slug: string;
  mission: DesignMissionOptions;
  runtime: {
    lockedSlugs: string[];
    agents: string[];
    phases: string[];
  };
}): string {
  return `# ${slug} Runtime Architecture Handoff

## Current Runtime Shape

Captured route plus local code context are the current source of truth.

## Proposed Runtime Layer

${mission.request ?? 'Stage a design-first change in Parity Studio before production implementation.'}

## User Flow Sequence

${mission.targetFlow ?? 'Infer the flow from the captured route and visible UI.'}

## Frontend Change Map

${runtime.lockedSlugs.length > 0 ? runtime.lockedSlugs.map((lockedSlug) => `- Keep \`${lockedSlug}\` recognizable; layer approved deltas inside it.`).join('\n') : '- Infer locked slugs before production implementation.'}

## Backend Change Map

- Add backend state/actions only if the approved UI delta requires them.

## Database Object Map

- Add persistence only for approved feature state, user settings, or audit/proof metadata.

## Agent/Runtime Pipeline

${runtime.agents.map((agent) => `- ${agent}`).join('\n')}

## Permission Diagram

- Provider keys stay in the local MCP environment.
- Hosted Parity Studio receives generated artifacts only when import is enabled.
- Production repo changes require explicit approval after design proof.

## Implementation Phases

${runtime.phases.map((phase) => `- ${phase}`).join('\n')}

## Verification Plan

- Browser QA for source route and Parity preview.
- Locked slug drift review.
- End-user impact readout.
- Export ZIP proof before production patching.
`;
}

function buildRuntimeHtml({
  slug,
  mission,
  runtime,
}: {
  slug: string;
  mission: DesignMissionOptions;
  runtime: {
    lockedSlugs: string[];
    agents: string[];
    phases: string[];
  };
}): string {
  const locked = runtime.lockedSlugs
    .map((item) => `<li><code>${escapeHtml(item)}</code></li>`)
    .join('');
  const agents = runtime.agents.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const phases = runtime.phases.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(slug)} runtime architecture</title>
    <style>
      body { margin: 0; background: #fbf7ef; color: #21160f; font-family: ui-sans-serif, system-ui, sans-serif; }
      main { max-width: 980px; margin: 0 auto; padding: 40px; }
      h1 { font-family: Georgia, serif; font-size: 40px; margin: 0 0 8px; }
      section { border: 1px solid #e4d7c9; border-radius: 18px; background: #fffaf3; padding: 20px; margin: 16px 0; }
      code { background: #f2e6d9; border-radius: 6px; padding: 2px 6px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Runtime Architecture Handoff</h1>
      <p>${escapeHtml(mission.request ?? 'Design-first staging layer before production implementation.')}</p>
      <section><h2>Locked slugs</h2><ul>${locked || '<li>Infer before implementation.</li>'}</ul></section>
      <section><h2>Agent pipeline</h2><ul>${agents}</ul></section>
      <section><h2>Implementation phases</h2><ul>${phases}</ul></section>
    </main>
  </body>
</html>
`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cleanList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}
