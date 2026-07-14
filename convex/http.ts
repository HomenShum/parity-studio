import { httpRouter } from 'convex/server';
import JSZip from 'jszip';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { httpAction } from './_generated/server';
import { buildDesignSystemShowcaseFiles } from './lib/designSystemShowcase';
import { buildFigmaBridgeFiles } from './lib/figmaBridge';

const http = httpRouter();

http.route({
  path: '/api/nodeslide/google/oauth/callback',
  method: 'GET',
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const state = url.searchParams.get('state')?.trim();
    if (!state || state.length > 256) {
      return new Response('This Google Slides connection link is invalid or expired.', {
        status: 400,
        headers: {
          'cache-control': 'no-store',
          'content-type': 'text/plain; charset=utf-8',
        },
      });
    }
    const code = url.searchParams.get('code')?.trim();
    const error = url.searchParams.get('error')?.trim();
    if ((code?.length ?? 0) > 4096 || (error?.length ?? 0) > 256) {
      return new Response('This Google Slides connection response is invalid.', {
        status: 400,
        headers: {
          'cache-control': 'no-store',
          'content-type': 'text/plain; charset=utf-8',
        },
      });
    }
    const { redirectTo } = await ctx.runAction(internal.nodeslideGoogleAuth.complete, {
      state,
      ...(code ? { code } : {}),
      ...(error ? { error } : {}),
    });
    return new Response(null, {
      status: 302,
      headers: {
        'cache-control': 'no-store',
        location: redirectTo,
        'referrer-policy': 'no-referrer',
      },
    });
  }),
});

/**
 * GET /api/runs/:id/{zip|html|markdown|figma}
 *
 * Multi-format export. ui_kits.files holds the full canonical shape;
 * each format projects from there:
 *   - zip      → JSZip bundle (canonical NodeBench skill-pack shape)
 *   - html     → single-file HTML with tokens.css inlined
 *   - markdown → prose handoff for coding agents
 *   - figma    → Figma development-plugin bridge bundle
 *
 * Convex requires a single pathPrefix per registration, so all three
 * formats live under one handler that dispatches by URL suffix.
 */
http.route({
  pathPrefix: '/api/runs/',
  method: 'GET',
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/api\/runs\/([a-z0-9_]+)\/(zip|html|markdown|figma)$/i);
    if (m === null || m[1] === undefined || m[2] === undefined) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    const runId = m[1] as Id<'runs'>;
    const format = m[2].toLowerCase() as 'zip' | 'html' | 'markdown' | 'figma';

    const uiKit = await ctx.runQuery(internal.uiKits.getLatestInternal, { runId });
    if (uiKit === null) {
      return new Response(JSON.stringify({ error: 'no_ui_kit_yet' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    const run = await ctx.runQuery(internal.runs.getInternal, { runId });
    await ctx.runMutation(internal.designRevisions.recordInternal, {
      runId,
      uiKitId: uiKit._id,
      kind: 'export',
      label: `Exported ${format}`,
      summary: `Downloaded ${format} export for ${uiKit.slug}.`,
      changedPaths: [],
      files: uiKit.files,
      source: 'app',
    });

    if (format === 'zip') {
      const zip = new JSZip();
      const baseFiles = uiKit.files as Record<string, string>;
      const showcaseFiles = buildDesignSystemShowcaseFiles(baseFiles, uiKit.slug);
      const files = {
        ...baseFiles,
        ...showcaseFiles,
        ...buildFigmaBridgeFiles({ ...baseFiles, ...showcaseFiles }, uiKit.slug, {
          runId: String(runId),
          activeSurface: uiKit.slug,
        }),
      };
      for (const [path, content] of Object.entries(files)) {
        zip.file(path, content);
      }
      const sourceB64 = run?.sourceImageBase64;
      const sourceMime = run?.sourceImageMimeType;
      const sourceExt = sourceMime ? (sourceMime.split('/')[1] ?? 'png') : null;
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
    }

    if (format === 'figma') {
      const zip = new JSZip();
      const baseFiles = uiKit.files as Record<string, string>;
      const files = {
        ...baseFiles,
        ...buildDesignSystemShowcaseFiles(baseFiles, uiKit.slug),
      };
      const bridgeFiles = buildFigmaBridgeFiles(files, uiKit.slug, {
        runId: String(runId),
        activeSurface: uiKit.slug,
      });
      for (const [path, content] of Object.entries(bridgeFiles)) {
        zip.file(path, content);
      }
      const buf = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
      return new Response(buf, {
        status: 200,
        headers: {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="${uiKit.slug}-figma-bridge.zip"`,
          'cache-control': 'private, no-store',
        },
      });
    }

    if (format === 'html') {
      const artifact = await ctx.runQuery(internal.artifacts.getLatestInternal, { runId });
      if (artifact === null) {
        return new Response(JSON.stringify({ error: 'no_artifact' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      const files = uiKit.files as Record<string, string>;
      const tokensCss = files[`ui_kits/${uiKit.slug}/tokens.css`] ?? '';
      let html = artifact.html;
      if (tokensCss) {
        const tag = `<style data-parity-tokens="inlined">\n${tokensCss}\n</style>\n`;
        html = html.includes('<head>') ? html.replace('<head>', `<head>\n${tag}`) : tag + html;
      }
      return new Response(html, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-disposition': `attachment; filename="${uiKit.slug}.html"`,
          'cache-control': 'private, no-store',
        },
      });
    }

    // markdown
    const parity = await ctx.runQuery(internal.parityReports.getLatestInternal, { runId });
    const files = uiKit.files as Record<string, string>;
    const slug = uiKit.slug;
    const parityLine =
      parity && parity.totalChecks > 0
        ? `${parity.passCount}/${parity.totalChecks} ${parity.status}`
        : 'n/a';
    const out: string[] = [];

    out.push(`# ${slug}\n`);
    out.push(`> Parity Studio export · run ${String(runId)}\n`);
    out.push(`- **Source prompt:** ${run?.prompt ?? '(image-only)'}`);
    out.push(`- **Parity:** ${parityLine}`);
    out.push(`- **Cost:** $${((run?.costMicroUsd ?? 0) / 1_000_000).toFixed(4)}`);
    out.push(`- **Iterations:** ${run?.iterationsCompleted ?? 0}`);
    out.push('');

    const readme = files['README.md'];
    if (readme) {
      out.push('## README\n');
      out.push(readme);
      out.push('');
    }
    const skill = files['SKILL.md'];
    if (skill) {
      out.push('## SKILL\n');
      out.push('```yaml');
      out.push(skill);
      out.push('```');
      out.push('');
    }

    const contract = files[`ui_kits/${slug}/parity.contract.json`];
    if (contract) {
      out.push('## Operating Contract\n');
      out.push('```json');
      out.push(contract.length > 8000 ? `${contract.slice(0, 8000)}\n// truncated` : contract);
      out.push('```');
      out.push('');
    }

    out.push(`## Components — \`ui_kits/${slug}/\`\n`);
    const componentEntries = Object.entries(files)
      .filter(([p]) => /\.(tsx|jsx)$/.test(p))
      .sort(([a], [b]) => a.localeCompare(b));
    for (const [path, content] of componentEntries) {
      const base = (path.split('/').slice(-1)[0] ?? '').replace(/\.(tsx|jsx)$/, '');
      out.push(`### ${base}\n`);
      out.push(`\`${path}\``);
      out.push('');
      const head = content.split('\n').slice(0, 30).join('\n');
      out.push('```tsx');
      out.push(head);
      if (content.split('\n').length > 30) {
        out.push(`// …${content.split('\n').length - 30} more lines`);
      }
      out.push('```');
      out.push('');
    }

    const tokens = files[`ui_kits/${slug}/tokens.css`];
    if (tokens) {
      out.push('## Tokens\n');
      out.push('```css');
      out.push(tokens);
      out.push('```');
      out.push('');
    }

    const indexHtml = files[`ui_kits/${slug}/index.html`];
    if (indexHtml) {
      out.push('## Rendered artifact\n');
      out.push('```html');
      out.push(
        indexHtml.length > 8000
          ? `${indexHtml.slice(0, 8000)}\n<!-- …truncated at 8 KB -->`
          : indexHtml,
      );
      out.push('```');
      out.push('');
    }

    out.push('---');
    out.push(
      'Generated by [Parity Studio](https://parity-studio.vercel.app). Drop the same kit zip back in to round-trip.',
    );

    return new Response(out.join('\n'), {
      status: 200,
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${slug}.md"`,
        'cache-control': 'private, no-store',
      },
    });
  }),
});

export default http;
