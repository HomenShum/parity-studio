#!/usr/bin/env node
/**
 * Smoke test for parity-studio-mcp via stdio. Spawns the server, sends an
 * MCP initialize handshake + tools/list, prints the result, exits.
 *
 * Usage:
 *   node scripts/smoke-test.mjs
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(__dirname, '..', 'dist', 'index.js');

function jsonrpc(id, method, params) {
  return `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
}

function jsonrpcNotif(method, params) {
  return `${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`;
}

async function main() {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env },
  });

  let buf = '';
  const messages = [];
  let resolveDone;
  const done = new Promise((r) => {
    resolveDone = r;
  });

  child.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let nl = buf.indexOf('\n');
    while (nl !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        messages.push(msg);
        // Wait for both initialize response (id=1) and tools/list response (id=2)
        if (messages.some((m) => m.id === 2)) resolveDone();
      } catch {
        console.error('non-JSON line from server:', line);
      }
      nl = buf.indexOf('\n');
    }
  });

  // Stage 1: initialize
  child.stdin.write(
    jsonrpc(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'parity-studio-mcp-smoke-test', version: '0.0.1' },
    }),
  );
  // Stage 2: notifications/initialized then tools/list
  setTimeout(() => {
    child.stdin.write(jsonrpcNotif('notifications/initialized', {}));
    child.stdin.write(jsonrpc(2, 'tools/list', {}));
  }, 300);

  await Promise.race([
    done,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 10s')), 10_000)),
  ]);

  const initResp = messages.find((m) => m.id === 1);
  const toolsResp = messages.find((m) => m.id === 2);

  console.log('=== initialize response ===');
  console.log(JSON.stringify(initResp, null, 2));
  console.log('\n=== tools/list response ===');
  console.log(`Found ${toolsResp?.result?.tools?.length ?? 0} tools:\n`);
  for (const t of toolsResp?.result?.tools ?? []) {
    console.log(`  - ${t.name}`);
    console.log(`      ${t.description?.split('\n')[0]?.slice(0, 90)}...`);
  }

  child.stdin.end();
  child.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error('smoke-test failed:', err);
  process.exit(1);
});
