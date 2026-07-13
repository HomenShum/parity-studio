import { describe, expect, it } from 'vitest';

import {
  NODESLIDE_CONVEX_URL,
  NODESLIDE_MCP_PACKAGE,
  buildNodeSlideCodexConfig,
  buildNodeSlideMcpJson,
} from './NodeSlideConnectionsDialog';

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
  });

  it('emits a Codex config with writes approval and explicit production routing', () => {
    const config = buildNodeSlideCodexConfig(env, 'npx.cmd');

    expect(config).toContain(`args = ["-y", "${NODESLIDE_MCP_PACKAGE}"]`);
    expect(config).toContain('default_tools_approval_mode = "writes"');
    expect(config).toContain(`PARITY_CONVEX_URL = "${NODESLIDE_CONVEX_URL}"`);
    expect(config).toContain('PARITY_DASHBOARD = "disabled"');
    expect(config).not.toContain('parity-studio-mcp@latest');
  });
});
