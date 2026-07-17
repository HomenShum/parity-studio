import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  NODESLIDE_CONVEX_URL,
  NODESLIDE_MCP_PACKAGE,
  buildNodeSlideCodexConfig,
  buildNodeSlideMcpJson,
} from './NodeSlideConnectionsDialog';

const dialogSource = readFileSync(
  new URL('./NodeSlideConnectionsDialog.tsx', import.meta.url),
  'utf8',
);

const env = {
  PARITY_CONVEX_URL: NODESLIDE_CONVEX_URL,
  PARITY_DASHBOARD: 'disabled',
  NODESLIDE_BYOK_MODEL: 'z-ai/glm-5.2',
  OPENROUTER_API_KEY: 'qa-placeholder',
};

describe('NodeSlide coding-agent connection config', () => {
  it('pins Claude and Cursor to the production-served MCP package', () => {
    const config = JSON.parse(buildNodeSlideMcpJson(env, 'npx.cmd'));

    expect(config.mcpServers.nodeslide.command).toBe('npx.cmd');
    expect(config.mcpServers.nodeslide.args).toEqual(['-y', NODESLIDE_MCP_PACKAGE]);
    expect(config.mcpServers.nodeslide.env).toEqual(env);
    expect(JSON.stringify(config)).not.toContain('parity-studio-mcp@latest');
    expect(JSON.stringify(config).toLowerCase()).not.toContain('consent');
  });

  it('emits a Codex config with writes approval and explicit production routing', () => {
    const config = buildNodeSlideCodexConfig(env, 'npx.cmd');

    expect(config).toContain(`args = ["-y", "${NODESLIDE_MCP_PACKAGE}"]`);
    expect(config).toContain('default_tools_approval_mode = "writes"');
    expect(config).toContain(`PARITY_CONVEX_URL = "${NODESLIDE_CONVEX_URL}"`);
    expect(config).toContain('PARITY_DASHBOARD = "disabled"');
    expect(config).not.toContain('parity-studio-mcp@latest');
    expect(config.toLowerCase()).not.toContain('consent');
  });

  it('keeps the pinned MCP tarball in Vercel deployments', () => {
    const vercelIgnore = readFileSync(
      new URL('../../../../.vercelignore', import.meta.url),
      'utf8',
    );
    const archiveIgnore = vercelIgnore.indexOf('*.tgz');
    const packageInclude = vercelIgnore.indexOf('!public/downloads/parity-studio-mcp-*.tgz');

    expect(archiveIgnore).toBeGreaterThanOrEqual(0);
    expect(packageInclude).toBeGreaterThan(archiveIgnore);
  });

  it('wires per-deck Google OAuth without storing credentials in the browser', () => {
    expect(dialogSource).toContain('api.nodeslideGoogleAuth.getStatus');
    expect(dialogSource).toContain('api.nodeslideGoogleAuth.begin');
    expect(dialogSource).toContain('api.nodeslideGoogleAuth.disconnect');
    expect(dialogSource).toContain('<code>drive.file</code> scope');
    expect(dialogSource).toContain('api.nodeslideGoogleSlidesRuntime.createPresentation');
    expect(dialogSource).toContain('api.nodeslideGoogleSlidesRuntime.attachPresentation');
    expect(dialogSource).toContain('api.nodeslideGoogleSlidesRuntime.planPull');
    expect(dialogSource).toContain('api.nodeslideGoogleSlidesRuntime.finalizePull');
    expect(dialogSource).toContain('api.nodeslideGoogleSlidesRuntime.planPush');
    expect(dialogSource).toContain('api.nodeslideGoogleSlidesRuntime.executePush');
    expect(dialogSource).toContain('api.nodeslideGoogleSlidesRuntime.cancelPending');
    expect(dialogSource).toContain('api.nodeslideGoogleSlidesRuntime.resetAttachment');
    expect(dialogSource).toContain('every remote write is read back and verified');
    expect(dialogSource).toContain('Google Slides URL or presentation ID');
    expect(dialogSource).toContain('Create compatible target');
    expect(dialogSource).toContain('exact semantic match');
    expect(dialogSource).toContain('does not authorize arbitrary files');
    expect(dialogSource).toContain('Re-plan Google pull');
    expect(dialogSource).toContain('Re-plan NodeSlide push');
    expect(dialogSource).toContain('Reset rejected pull');
    expect(dialogSource).toContain('Reset stale pull');
    expect(dialogSource).toContain('Cancel pending push');
    expect(dialogSource).not.toContain('does not push or pull slides yet');
    expect(dialogSource).not.toContain('accessToken');
    expect(dialogSource).not.toContain('refreshToken');
  });
});
