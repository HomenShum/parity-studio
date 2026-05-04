#!/usr/bin/env node
/**
 * Smoke test for parity-studio-mcp via stdio.
 *
 * Uses the official MCP client transport rather than hand-written JSON-RPC
 * framing, so it tracks SDK protocol changes and verifies the same path real
 * MCP clients use.
 *
 * Usage:
 *   node scripts/smoke-test.mjs
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(__dirname, '..', 'dist', 'index.js');

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    env: {
      ...process.env,
      // Tool listing should not boot or open the local dashboard.
      PARITY_DASHBOARD: process.env.PARITY_DASHBOARD ?? 'disabled',
    },
  });
  const client = new Client({ name: 'parity-studio-mcp-smoke-test', version: '0.0.1' });

  await client.connect(transport);
  const toolsResp = await client.listTools();
  const tools = toolsResp.tools ?? [];

  console.log('=== tools/list response ===');
  console.log(`Found ${tools.length} tools:\n`);
  for (const t of tools) {
    console.log(`  - ${t.name}`);
    console.log(`      ${t.description?.split('\n')[0]?.slice(0, 90)}...`);
  }

  const required = ['parity_design_mission', 'parity_figma_export', 'parity_figma_import'];
  const names = new Set(tools.map((tool) => tool.name));
  const missing = required.filter((name) => !names.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing required tools: ${missing.join(', ')}`);
  }

  await client.close();
}

main().catch((err) => {
  console.error('smoke-test failed:', err);
  process.exit(1);
});
