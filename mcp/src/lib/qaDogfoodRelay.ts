import type { DesignMissionOptions, LockedSlugEntry } from './designMission.js';

const DEFAULT_PERSONAS = [
  'first-time non-technical user',
  'designer or product lead',
  'coding agent maintainer',
];

const DEFAULT_USER_STATES = [
  'new user empty state',
  'returning user with an existing run',
  'needs fix after QA',
  'approved for production implementation',
];

const DEFAULT_WORKFLOW_LANES = [
  'start new run',
  'capture and decompose',
  'comment a granular UI issue',
  'apply a major reimagination safely',
  'use inspiration search',
  'sync stale source snapshot',
  'export handoff zip',
];

export function buildQaDogfoodRelayFiles({
  slug,
  mission,
  lockedSlugEntries,
}: {
  slug: string;
  mission: DesignMissionOptions;
  lockedSlugEntries: LockedSlugEntry[];
}): Record<string, string> {
  const featureId = sanitizeId(mission.qaFeatureId ?? `${slug}.design-mission`);
  const personas = cleanList(mission.qaPersonas, DEFAULT_PERSONAS);
  const userStates = cleanList(mission.qaUserStates, DEFAULT_USER_STATES);
  const workflowLanes = cleanList(mission.qaWorkflowLanes, DEFAULT_WORKFLOW_LANES);
  const snippets = buildSnippetPlan({ lockedSlugEntries });
  const packet = buildPacket({
    featureId,
    slug,
    mission,
    personas,
    userStates,
    workflowLanes,
    snippets,
  });

  return {
    [`ui_kits/${slug}/qa-dogfood.packet.json`]: `${JSON.stringify(packet, null, 2)}\n`,
    [`ui_kits/${slug}/snapshot-snippets.json`]: `${JSON.stringify(snippets, null, 2)}\n`,
    [`ui_kits/${slug}/qa-dogfood.plan.md`]: buildQaDogfoodPlan({
      featureId,
      slug,
      mission,
      personas,
      userStates,
      workflowLanes,
      snippets,
    }),
    [`ui_kits/${slug}/gmail-magic-resend.html`]: buildGmailMagicResendHtml({
      featureId,
      slug,
      mission,
      workflowLanes,
      snippets,
    }),
    [`ui_kits/${slug}/remotion.storyboard.json`]: `${JSON.stringify(
      buildRemotionStoryboard({ featureId, slug, mission, workflowLanes, snippets }),
      null,
      2,
    )}\n`,
    [`ui_kits/${slug}/easier-to-read-submission.md`]: buildEasierSubmissionStub({
      featureId,
      slug,
      mission,
      workflowLanes,
      snippets,
    }),
  };
}

function buildPacket({
  featureId,
  slug,
  mission,
  personas,
  userStates,
  workflowLanes,
  snippets,
}: {
  featureId: string;
  slug: string;
  mission: DesignMissionOptions;
  personas: string[];
  userStates: string[];
  workflowLanes: string[];
  snippets: ReturnType<typeof buildSnippetPlan>;
}) {
  return {
    schemaVersion: 1,
    kind: 'parity.qa-dogfood-relay',
    featureId,
    title: mission.request ?? `QA dogfood packet for ${slug}`,
    surface: slug,
    targetFlow: mission.targetFlow ?? null,
    source: {
      parityRunUrl: '',
      previewUrl: '',
      branch: '',
      commitSha: '',
    },
    lanes: {
      workflows: workflowLanes.map((label) => ({
        id: sanitizeId(label),
        label,
        testUrl: '',
        status: 'pending',
      })),
      personas,
      userStates,
    },
    requiredArtifacts: {
      testLink: '',
      gif: '',
      mp4: '',
      beforeScreenshots: [],
      afterScreenshots: [],
      visualDiffs: [],
      sideBySideReviewUrl: '',
      remotionVideo: '',
      gmailPacketHtml: `ui_kits/${slug}/gmail-magic-resend.html`,
    },
    snippets,
    qaActions: [
      {
        label: 'Approve',
        href: '',
      },
      {
        label: 'Needs fix',
        href: '',
      },
      {
        label: 'Copy agent correction prompt',
        href: '',
      },
      {
        label: 'Magic resend after fix',
        href: '',
      },
    ],
    correctionPromptTemplate:
      'Use Parity Studio on {{previewUrl}}. Fix {{componentSlug}} because expected: {{expected}}, actual: {{actual}}. Re-run browser QA, update qa-dogfood.packet.json, and attach before/after proof before committing.',
    security: {
      providerKeys:
        'local MCP or local browser session only; never include key values in this packet',
      uploadedData:
        'only generated kit artifacts, redacted source context, screenshots, and proof media chosen by the user',
      resendPolicy:
        'Gmail packet should link to artifacts instead of embedding secrets or raw provider output',
    },
  };
}

function buildSnippetPlan({ lockedSlugEntries }: { lockedSlugEntries: LockedSlugEntry[] }) {
  const slugs =
    lockedSlugEntries.length > 0
      ? lockedSlugEntries.map((entry) => entry.slug)
      : ['app-shell', 'primary-composer', 'preview-canvas', 'parity-coach'];
  return slugs.map((componentSlug) => ({
    componentSlug,
    expectedChange: '',
    before: '',
    after: '',
    diff: '',
    verdict: 'pending',
    correctionPrompt:
      'Attach before/after/diff screenshots and describe the visible end-user impact before asking the coding agent to patch production code.',
  }));
}

function buildQaDogfoodPlan({
  featureId,
  slug,
  mission,
  personas,
  userStates,
  workflowLanes,
  snippets,
}: {
  featureId: string;
  slug: string;
  mission: DesignMissionOptions;
  personas: string[];
  userStates: string[];
  workflowLanes: string[];
  snippets: ReturnType<typeof buildSnippetPlan>;
}): string {
  return `# QA Dogfood Relay

Feature: ${featureId}
Surface: ${slug}

## Mission

${mission.request ?? 'Generate a Parity Studio design proof and package it for review.'}

## What must be easy to resend

- Test link to the Parity run or deployed preview.
- GIF for the primary workflow.
- MP4 for the end-to-end workflow, ideally rendered by Remotion.
- Before, after, and diff screenshots for every visible component snippet.
- Side-by-side review URL.
- Clear lanes for workflow, persona, and user state.
- Correction prompt that the coding agent can apply without guessing.

## Workflow lanes

${workflowLanes.map((lane) => `- ${lane}`).join('\n')}

## Personas

${personas.map((persona) => `- ${persona}`).join('\n')}

## User states

${userStates.map((state) => `- ${state}`).join('\n')}

## Snapshot snippets

${snippets.map((snippet) => `- ${snippet.componentSlug}: before, after, diff, expected change, actual result, correction prompt`).join('\n')}

## Minimum done bar

1. Every changed visual surface has a before/after/diff snippet.
2. The main workflow has a GIF and the final demo has an MP4.
3. The End-user impact readout says what changes for the customer's end users, not just what the parity score means.
4. qa-dogfood.packet.json points at the generated artifacts.
5. easier-to-read-submission.md summarizes the same evidence for the commit or PR.
6. The production codebase is not patched until the Parity Studio design board is approved.
`;
}

function buildGmailMagicResendHtml({
  featureId,
  slug,
  mission,
  workflowLanes,
  snippets,
}: {
  featureId: string;
  slug: string;
  mission: DesignMissionOptions;
  workflowLanes: string[];
  snippets: ReturnType<typeof buildSnippetPlan>;
}): string {
  const lanes = workflowLanes.map((lane) => `<li>${escapeHtml(lane)}</li>`).join('');
  const snippetRows = snippets
    .map(
      (snippet) => `<tr>
        <td>${escapeHtml(snippet.componentSlug)}</td>
        <td>before / after / diff pending</td>
        <td>${escapeHtml(snippet.correctionPrompt)}</td>
      </tr>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(featureId)} QA packet</title>
    <style>
      body { margin: 0; padding: 24px; background: #fbf7ef; color: #23160f; font-family: Arial, sans-serif; }
      .card { max-width: 760px; margin: 0 auto; background: #fffaf3; border: 1px solid #e7d8ca; border-radius: 18px; padding: 24px; }
      h1 { margin: 0 0 8px; font-family: Georgia, serif; font-size: 30px; }
      a.button { display: inline-block; margin: 8px 8px 8px 0; padding: 10px 14px; border-radius: 999px; background: #dc5f42; color: #fff; text-decoration: none; font-weight: 700; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th, td { border-top: 1px solid #eaded2; text-align: left; padding: 10px; vertical-align: top; font-size: 13px; }
      code { background: #f1e6dc; border-radius: 6px; padding: 2px 5px; }
    </style>
  </head>
  <body>
    <div class="card">
      <p><code>${escapeHtml(slug)}</code></p>
      <h1>${escapeHtml(mission.request ?? `QA packet for ${slug}`)}</h1>
      <p>Feature ID: <code>${escapeHtml(featureId)}</code></p>
      <p>Open this from Gmail on desktop or phone. Fill the links after capture/render/send.</p>
      <p>
        <a class="button" href="#">Open test link</a>
        <a class="button" href="#">Approve</a>
        <a class="button" href="#">Needs fix</a>
        <a class="button" href="#">Magic resend after fix</a>
      </p>
      <h2>Workflow lanes</h2>
      <ul>${lanes}</ul>
      <h2>Snapshot snippets</h2>
      <table>
        <thead><tr><th>Component</th><th>Proof</th><th>Correction prompt</th></tr></thead>
        <tbody>${snippetRows}</tbody>
      </table>
    </div>
  </body>
</html>
`;
}

function buildRemotionStoryboard({
  featureId,
  slug,
  mission,
  workflowLanes,
  snippets,
}: {
  featureId: string;
  slug: string;
  mission: DesignMissionOptions;
  workflowLanes: string[];
  snippets: ReturnType<typeof buildSnippetPlan>;
}) {
  return {
    schemaVersion: 1,
    videoId: featureId,
    title: mission.request ?? `${slug} workflow demo`,
    durationSeconds: 45,
    scenes: [
      {
        type: 'workflow-lanes',
        title: 'What this feature proves',
        lanes: workflowLanes,
      },
      {
        type: 'screenshot-compare',
        title: 'Before and after visible changes',
        snippets: snippets.map((snippet) => snippet.componentSlug),
      },
      {
        type: 'parity-studio-proof',
        title: 'Comment, edit, verify, export',
        requiredBeats: [
          'open Parity Studio run',
          'show selected component or comment',
          'show agent applying the fix',
          'show verification/readout',
          'show export or implementation handoff',
        ],
      },
    ],
  };
}

function buildEasierSubmissionStub({
  featureId,
  slug,
  mission,
  workflowLanes,
  snippets,
}: {
  featureId: string;
  slug: string;
  mission: DesignMissionOptions;
  workflowLanes: string[];
  snippets: ReturnType<typeof buildSnippetPlan>;
}): string {
  return `# Easier-to-read submission

Feature: ${featureId}
Surface: ${slug}

## User-visible outcome

${mission.request ?? 'Parity Studio design proof and QA relay packet generated.'}

## Links

- Parity run:
- Preview:
- Side-by-side review:
- GIF:
- MP4:
- Gmail packet: ui_kits/${slug}/gmail-magic-resend.html

## Workflow lanes covered

${workflowLanes.map((lane) => `- ${lane}`).join('\n')}

## Snapshot snippets

${snippets.map((snippet) => `- ${snippet.componentSlug}: before / after / diff pending`).join('\n')}

## Correction prompt

Use Parity Studio to fix the highest-impact snippet first. Attach before/after/diff evidence, rerun browser QA, update qa-dogfood.packet.json, then update the relevant CHANGELOG lane before committing.
`;
}

function sanitizeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

function cleanList(values: string[] | undefined, fallback: string[]): string[] {
  const cleaned = [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
  return cleaned.length > 0 ? cleaned : fallback;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
