import { httpRouter } from 'convex/server';
import JSZip from 'jszip';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { httpAction } from './_generated/server';

const http = httpRouter();

/**
 * GET /api/runs/:id/zip
 *
 * Returns the latest ui_kit for the run as a downloadable ZIP. Includes a
 * HANDOFF.md file with integration instructions for Claude Code / Cursor /
 * Windsurf so the bundle is self-explanatory.
 *
 * 404 if the run doesn't exist or no ui_kit has been produced yet.
 *
 * Note: this lives in convex/http.ts (Node runtime) because JSZip's
 * generateAsync('nodebuffer') needs the Node Buffer API. The other queries
 * in this repo can stay in the default V8 runtime.
 */
http.route({
  pathPrefix: '/api/runs/',
  method: 'GET',
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/api\/runs\/([a-z0-9_]+)\/zip$/i);
    if (m === null || m[1] === undefined) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    const runId = m[1] as Id<'runs'>;

    const uiKit = await ctx.runQuery(internal.uiKits.getLatestInternal, { runId });
    if (uiKit === null) {
      return new Response(JSON.stringify({ error: 'no_ui_kit_yet' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    const run = await ctx.runQuery(internal.runs.getInternal, { runId });
    const parity = await ctx.runQuery(internal.parityReports.getLatestInternal, { runId });

    const zip = new JSZip();
    const files = uiKit.files as Record<string, string>;
    // Files are already prefixed with `ui_kits/<slug>/`; copy verbatim.
    // The branch handles edge cases where a future writer might store
    // bare relative paths.
    for (const [path, content] of Object.entries(files)) {
      const out = path.startsWith(`ui_kits/${uiKit.slug}/`) ? path : `ui_kits/${uiKit.slug}/${path}`;
      zip.file(out, content);
    }

    // ── Canonical NodeBench skill-pack shape ─────────────────────────
    // See docs/CANONICAL_KIT.md. Symmetric with the importer in
    // src/components/composer/ComposerCard.tsx — a zip exported here
    // imports back cleanly without information loss.

    const parityLine =
      parity && parity.totalChecks > 0
        ? `${parity.passCount}/${parity.totalChecks} ${parity.status}`
        : 'n/a';
    const sourceMime = run?.sourceImageMimeType;
    const sourceB64 = run?.sourceImageBase64;
    const sourceExt = sourceMime ? sourceMime.split('/')[1] ?? 'png' : null;

    zip.file(
      'README.md',
      `# ${uiKit.slug} — Parity Studio export

A componentized \`ui_kit/\` produced by parity-studio. This zip follows
the canonical NodeBench AI Skill-pack shape and round-trips cleanly:
drop it back into parity-studio.vercel.app to import the same kit.

**Run:** ${String(runId)}
**Source prompt:** ${run?.prompt ?? '(image-only)'}
**Parity:** ${parityLine}
**Cost:** $${((run?.costMicroUsd ?? 0) / 1_000_000).toFixed(4)}
**Iterations:** ${run?.iterationsCompleted ?? 0}

## What's inside

- \`SKILL.md\` — Claude Skill descriptor; load this folder via Claude Code's \`.claude/skills/\` mechanism
- \`colors_and_type.css\` — root token entry; imports the active slug's \`tokens.css\`
- \`ui_kits/${uiKit.slug}/\` — the active product
  - \`index.html\` — full rendered artifact
  - \`components/\` — extracted React components (.tsx)
  - \`tokens.css\` — per-kit design tokens
  - \`manifest.json\` — slug + schemaVersion + entry point
  - \`HANDOFF.md\` — verbatim coding-agent instructions
${sourceB64 && sourceExt ? `- \`uploads/source.${sourceExt}\` — original source image` : ''}

See [docs/CANONICAL_KIT.md](https://github.com/HomenShum/parity-studio/blob/main/docs/CANONICAL_KIT.md) for the full shape contract.
`,
    );

    zip.file(
      'SKILL.md',
      `---
name: ${uiKit.slug}
description: ${run?.prompt ?? `${uiKit.slug} — UI kit produced by parity-studio with deterministic ${parityLine} parity`}
user-invocable: true
---

Read README.md within this skill, then explore the ui_kits/${uiKit.slug}/
folder. The kit ships with .tsx components, tokens.css, and a rendered
index.html. Import directly into a React + Vite project, or hand the
folder to Claude Code with: "integrate ui_kits/${uiKit.slug}/ into <route>".

If you need to verify or iterate further, drop this same zip back into
https://parity-studio.vercel.app — it round-trips.
`,
    );

    zip.file(
      'colors_and_type.css',
      `/* ==========================================================================
   ${uiKit.slug} — Colors & Type
   Root token entry. Imports the active slug's per-kit tokens.css so a
   consumer can include this single file and get the full token surface.
   ========================================================================== */

@import url('./ui_kits/${uiKit.slug}/tokens.css');
`,
    );

    if (sourceB64 && sourceExt) {
      // JSZip accepts base64 strings for binary files when given { base64: true }.
      zip.file(`uploads/source.${sourceExt}`, sourceB64, { base64: true });
    }

    const handoff = `# ${uiKit.slug} — handoff

Generated by parity-studio run ${String(runId)}.

Source prompt: ${run?.prompt ?? '(image-only)'}
Final parity:  ${parityLine}
Total cost:    $${((run?.costMicroUsd ?? 0) / 1_000_000).toFixed(4)}
Iterations:    ${run?.iterationsCompleted ?? 0}

## Integrate with Claude Code / Cursor / Windsurf

Unzip into your repo at the path of your choice. Then ask your coding agent:

> Integrate the ui_kits/${uiKit.slug}/ folder into the existing app at <your route>.
> Use components/*.tsx as the building blocks. Wire tokens.css into your global stylesheet.
> Preserve all visible text and numbers verbatim — they came from the source mockup.

Verify visually before merging. If parity drifted from your render, run
parity_verify (via parity-studio-mcp) with the integrated render to surface gaps.

manifest.json schemaVersion 1 contract is stable across minor versions.
`;
    zip.file(`ui_kits/${uiKit.slug}/HANDOFF.md`, handoff);

    // V8 runtime: use 'arraybuffer' since Convex's Response typing prefers
    // ArrayBuffer/string over Uint8Array (which carries an ArrayBufferLike
    // generic that doesn't satisfy BodyInit in the strict path).
    const buf = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
    return new Response(buf, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${uiKit.slug}.zip"`,
        'cache-control': 'private, no-store',
      },
    });
  }),
});

export default http;
