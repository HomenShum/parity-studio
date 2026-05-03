#!/usr/bin/env node
/**
 * Dashboard smoke test:
 * 1. Spawn the MCP server (which lazy-inits the dashboard on first tool call)
 * 2. Send a tool call (parity_decompose with a tiny artifact) to trigger dashboard init
 * 3. Fetch /api/health from the dashboard URL
 * 4. Open SSE connection and confirm 'hello' event arrives
 *
 * Does NOT spend money — parity_decompose will hit the LLM but with a tiny
 * artifact, cost is < $0.05. Set SKIP_LLM=1 to skip and just test server boot.
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(__dirname, '..', 'dist', 'index.js');
const SKIP_LLM = process.env.SKIP_LLM === '1';

function jsonrpc(id, method, params) {
  return `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
}
function jsonrpcNotif(method, params) {
  return `${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.on('data', (d) => {
          body += d;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(body) });
          } catch {
            resolve({ status: res.statusCode, body });
          }
        });
      })
      .on('error', reject);
  });
}

function streamSse(url, durationMs = 2000) {
  return new Promise((resolve, reject) => {
    const events = [];
    const req = http.get(url, (res) => {
      let buf = '';
      res.on('data', (d) => {
        buf += d.toString();
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const p of parts) {
          const eventMatch = p.match(/event: (\S+)/);
          const dataMatch = p.match(/data: (.+)/);
          if (eventMatch?.[1]) {
            events.push({ event: eventMatch[1], data: dataMatch?.[1] ?? '' });
          }
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    setTimeout(() => {
      req.destroy();
      resolve(events);
    }, durationMs);
  });
}

async function main() {
  console.log('=== dashboard smoke test ===');
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Force a deterministic port for the test
      PARITY_DASHBOARD_PORT: '6285',
      PARITY_DASHBOARD: 'server-only', // don't spawn a real browser in CI
    },
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[server stderr] ${chunk}`);
  });

  let buf = '';
  const messages = [];
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let nl = buf.indexOf('\n');
    while (nl !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        messages.push(JSON.parse(line));
      } catch {
        // ignore non-JSON
      }
      nl = buf.indexOf('\n');
    }
  });

  // Initialize handshake
  child.stdin.write(
    jsonrpc(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'dashboard-smoke', version: '0.0.1' },
    }),
  );
  await new Promise((r) => setTimeout(r, 300));
  child.stdin.write(jsonrpcNotif('notifications/initialized', {}));
  await new Promise((r) => setTimeout(r, 200));

  // Trigger dashboard init by calling parity_decompose
  if (!SKIP_LLM) {
    console.log('triggering dashboard init via parity_decompose tool call...');
    child.stdin.write(
      jsonrpc(2, 'tools/call', {
        name: 'parity_decompose',
        arguments: {
          artifactHtml:
            '<html><body><header><h1>Smoke Test</h1></header><main><p>Tiny artifact for dashboard smoke test.</p></main></body></html>',
          decomposeModel: 'claude-haiku-4-5', // cheapest available
        },
      }),
    );
    // Wait for the tool result
    const tStart = Date.now();
    while (!messages.some((m) => m.id === 2) && Date.now() - tStart < 60_000) {
      await new Promise((r) => setTimeout(r, 200));
    }
    const decompResp = messages.find((m) => m.id === 2);
    if (decompResp?.error) {
      console.warn(
        'parity_decompose returned error (continuing dashboard test):',
        decompResp.error.message,
      );
    } else if (decompResp?.result) {
      console.log('parity_decompose ok (took', ((Date.now() - tStart) / 1000).toFixed(1), 's)');
    }
  } else {
    console.log('SKIP_LLM=1, dashboard will not have any runs');
    // Force-spawn the dashboard via direct call by sending another tool list
    child.stdin.write(jsonrpc(2, 'tools/list', {}));
    await new Promise((r) => setTimeout(r, 500));
  }

  // Wait for dashboard to be reachable
  console.log('probing http://127.0.0.1:6285/api/health ...');
  let healthOk = false;
  for (let i = 0; i < 20; i++) {
    try {
      const h = await fetchJson('http://127.0.0.1:6285/api/health');
      if (h.status === 200) {
        console.log('  health:', JSON.stringify(h.body));
        healthOk = true;
        break;
      }
    } catch {
      // not yet up
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!healthOk) {
    console.error('FAIL: dashboard never came up on :6285');
    child.kill();
    process.exit(1);
  }

  // List runs
  const runs = await fetchJson('http://127.0.0.1:6285/api/runs');
  console.log('  runs count:', runs.body.runs?.length ?? 0);

  // Open SSE for 1.5s and confirm hello
  console.log('opening SSE for 1.5s ...');
  const events = await streamSse('http://127.0.0.1:6285/events', 1500);
  const helloFound = events.some((e) => e.event === 'hello');
  console.log('  events received:', events.length, '| hello:', helloFound);
  if (!helloFound) {
    console.error('FAIL: SSE did not deliver hello event');
    child.kill();
    process.exit(1);
  }

  console.log('\nPASS: dashboard server live, SSE streaming, REST endpoints reachable');
  child.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error('smoke test crashed:', err);
  process.exit(1);
});
