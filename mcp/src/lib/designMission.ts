export interface DesignMissionOptions {
  request?: string;
  targetFlow?: string;
  lockedSlugs?: string[];
  lockedComponents?: string[];
  allowedChangeScope?: 'design-only' | 'approved-deltas' | 'production-ready';
  proofMedia?: boolean;
  figmaBridge?: boolean;
}

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
- Include design.plan.md, design-slug-manifest.json, proof.checklist.md, browser-qa.proof.json, media.plan.json, and figma.bridge.json in the ui_kit.`;
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
  return {
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
    [`ui_kits/${slug}/design.plan.md`]: buildDesignPlan({ slug, mission, lockedSlugs, lockedComponents, scope }),
    [`ui_kits/${slug}/proof.checklist.md`]: buildProofChecklist({ proofMedia: mission.proofMedia === true }),
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

function buildProofChecklist({ proofMedia }: { proofMedia: boolean }): string {
  return `# Proof Checklist

- [ ] Source route captured and redacted.
- [ ] Locked UI slugs/components declared.
- [ ] Design-only kit imported into Parity Studio.
- [ ] Preview renders the current source-equivalent surface.
- [ ] User can comment/select/tweak scoped UI slugs.
- [ ] Agent can make granular edits and major reimagination variants inside allowed scope.
- [ ] Parity Coach reviewed for end-user impact.
- [ ] Browser QA screenshots captured for desktop/tablet/phone.
- [ ] Console errors and overflow issues reviewed.
- [ ] Export ZIP generated for approved kit.
${proofMedia ? '- [ ] MP4/GIF proof recorded and video-verified.' : '- [ ] Proof media intentionally skipped for this mission.'}
- [ ] Production repo changes are blocked until user approves the design board.
`;
}

function cleanList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}
