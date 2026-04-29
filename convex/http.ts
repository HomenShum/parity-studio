import { httpRouter } from 'convex/server';
import JSZip from 'jszip';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { httpAction } from './_generated/server';

const http = httpRouter();

/**
 * GET /api/runs/:id/zip
 *
 * Returns the run's stored canonical shape as a downloadable ZIP. As of
 * the canonical-shape-in-storage migration, ui_kits.files holds the
 * full shape (top-level docs, assets/, preview/, explorations/, kit
 * code, screenshots/scraps READMEs) — this handler just zips what's
 * there and injects the binary source image at zip time.
 *
 * That makes the export a pure projection of stored state — every file
 * in this zip is editable in-place via uiKits.patchFile, including
 * preview/component-X.html, assets/og-X.svg, and explorations/iter-N.html.
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

    const zip = new JSZip();
    const files = uiKit.files as Record<string, string>;
    for (const [path, content] of Object.entries(files)) {
      zip.file(path, content);
    }

    // Inject binaries the storage layer can't carry as text.
    const sourceB64 = run?.sourceImageBase64;
    const sourceMime = run?.sourceImageMimeType;
    const sourceExt = sourceMime ? sourceMime.split('/')[1] ?? 'png' : null;
    if (sourceB64 && sourceExt) {
      zip.file(`uploads/source.${sourceExt}`, sourceB64, { base64: true });
      zip.file(`screenshots/source.${sourceExt}`, sourceB64, { base64: true });
    }

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
