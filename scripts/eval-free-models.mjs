#!/usr/bin/env node
/**
 * Parity-studio-specific model eval. Replaces the prior nodebench eval
 * baseline (which graded entity-intelligence research, not tool-using
 * code agents) with one that exercises THIS app's actual surface:
 * read_file / upsert_file / set_todos / done.
 *
 * For each candidate model:
 *   - send 5 prompts that REQUIRE tool calls
 *   - score on tool_call_made, tool_args_valid, task_completed
 *   - measure latency + (free vs paid)
 *
 * Pulls models from pi-ai's catalog so the slugs are guaranteed valid
 * (the previous fix lesson — pi-ai getModel returns undefined for
 * unknown slugs and crashes downstream).
 *
 * Usage:
 *   OPENROUTER_API_KEY=... ANTHROPIC_API_KEY=... node scripts/eval-free-models.mjs
 *
 * Output:
 *   runs/eval-free-<stamp>/raw.jsonl       per-call records
 *   runs/eval-free-<stamp>/summary.md      ranked markdown table
 */

import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type, complete, getModel } from '@mariozechner/pi-ai';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// ── Models under test ──────────────────────────────────────────────────
// All slugs verified against pi-ai 0.70.2 models.generated.js.
//
// 2026-04-29 second-run notes:
//   - inclusionai/ling-2.6-flash:free was DEPRECATED to paid → removed.
//   - llama-3.3-70b-instruct:free + gemma-4-31b-it:free hit upstream
//     provider rate-limits in run 1. Re-included to verify whether the
//     retry+attribution-headers path now lets them complete.
const MODELS = [
  // Free tier candidates
  {
    provider: 'openrouter',
    modelId: 'inclusionai/ling-2.6-1t:free',
    tier: 'free',
    label: 'ling-2.6-1t',
  },
  {
    provider: 'openrouter',
    modelId: 'meta-llama/llama-3.3-70b-instruct:free',
    tier: 'free',
    label: 'llama-3.3-70b',
  },
  {
    provider: 'openrouter',
    modelId: 'google/gemma-4-26b-a4b-it:free',
    tier: 'free',
    label: 'gemma-4-26b',
  },
  {
    provider: 'openrouter',
    modelId: 'google/gemma-4-31b-it:free',
    tier: 'free',
    label: 'gemma-4-31b',
  },
  // Paid baselines
  { provider: 'anthropic', modelId: 'claude-haiku-4-5', tier: 'paid', label: 'haiku-4-5' },
  { provider: 'anthropic', modelId: 'claude-sonnet-4-5', tier: 'paid', label: 'sonnet-4-5' },
];

// OpenRouter app-attribution headers (recommended in their API docs;
// apps that send these get higher rate-limit allocations).
const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://parity.studio',
  'X-Title': 'Parity Studio (eval-free-models)',
};

const isRetriableError = (msg) => {
  if (!msg) return false;
  const lower = String(msg).toLowerCase();
  return (
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('rate-limit') ||
    lower.includes('temporarily rate-limited') ||
    lower.includes('upstream')
  );
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Tool surface (mirrors parity-studio's chat agent) ──────────────────
const TOOLS = [
  {
    name: 'list_files',
    description: 'List every path in the kit. No args.',
    parameters: Type.Object({}),
  },
  {
    name: 'read_file',
    description: 'Read a single file by path.',
    parameters: Type.Object({ path: Type.String() }),
  },
  {
    name: 'upsert_file',
    description: 'Atomic write. Creates the path if new, replaces if existing. ≤200 KB content.',
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
  },
  {
    name: 'set_todos',
    description: 'Publish a checklist. Each item: { text, checked: boolean }.',
    parameters: Type.Object({
      items: Type.Array(Type.Object({ text: Type.String(), checked: Type.Boolean() })),
    }),
  },
  {
    name: 'done',
    description: 'Run static lint over the kit. Returns { status, findings }.',
    parameters: Type.Object({ paths: Type.Optional(Type.Array(Type.String())) }),
  },
];

const SYSTEM_PROMPT =
  'You are the Parity Studio chat agent. The kit lives as a flat map of paths under one ui_kit row. You have these tools: list_files, read_file, upsert_file, set_todos, done. ALWAYS use the tool that fits — never describe what you would do, just call the tool. Be concise.';

// ── Eval queries — every one REQUIRES at least one tool call ──────────
const QUERIES = [
  {
    id: 'q1-list-then-read',
    expects: ['list_files', 'read_file'],
    prompt: 'List the files in the kit, then read the first .tsx file you find.',
  },
  {
    id: 'q2-todos-plan',
    expects: ['set_todos'],
    prompt:
      "Plan a 3-step refresh of the design tokens via set_todos. Items should be concrete actions naming files like ui_kits/foo/tokens.css. Don't actually edit anything.",
  },
  {
    id: 'q3-read-then-upsert',
    expects: ['read_file', 'upsert_file'],
    prompt:
      'Read ui_kits/test/tokens.css then upsert_file the same path with the line "--color-brand: #4F7A52;" appended.',
  },
  {
    id: 'q4-done-lint',
    expects: ['done'],
    prompt: 'Run a lint check across the entire kit using the done tool. Just call it.',
  },
  {
    id: 'q5-just-read',
    expects: ['read_file'],
    prompt: 'Read the file at path "assets/logo-mark.svg" and tell me what it contains.',
  },
];

// ── Per-call scoring ───────────────────────────────────────────────────
function scoreCall({ result, error, expects }) {
  if (error) return { ok: 0, T: 0, V: 0, C: 0, error: String(error).slice(0, 200) };
  const calls = (result.content ?? []).filter((b) => b.type === 'toolCall');
  const text = (result.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // T: at least one expected tool was called
  const calledNames = new Set(calls.map((c) => c.name));
  const T = expects.some((e) => calledNames.has(e)) ? 1 : 0;

  // V: every tool call has parseable args matching the schema (loose check)
  let V = 1;
  for (const c of calls) {
    if (c.name === 'read_file' || c.name === 'upsert_file') {
      if (!c.arguments?.path || typeof c.arguments.path !== 'string') V = 0;
    }
    if (c.name === 'upsert_file') {
      if (typeof c.arguments?.content !== 'string') V = 0;
    }
    if (c.name === 'set_todos') {
      if (!Array.isArray(c.arguments?.items) || c.arguments.items.length === 0) V = 0;
    }
  }

  // C: response is coherent — either tool calls fired or there's >50 chars of text
  const C = calls.length > 0 || text.length > 50 ? 1 : 0;

  return { ok: T && V && C, T, V, C, callsMade: calls.map((c) => c.name).join(','), error: '' };
}

// ── Main eval loop ─────────────────────────────────────────────────────
async function evalOne(modelSpec, query) {
  const t0 = Date.now();
  let result;
  let error;
  const isOpenRouter = modelSpec.provider === 'openrouter';
  const baseOptions = {
    maxOutputTokens: 1500,
    ...(isOpenRouter ? { headers: OPENROUTER_HEADERS, maxRetries: 3 } : {}),
  };
  try {
    const model = getModel(modelSpec.provider, modelSpec.modelId);
    if (!model)
      throw new Error(`pi-ai catalog miss for ${modelSpec.provider}/${modelSpec.modelId}`);
    const ctx = {
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: query.prompt, timestamp: Date.now() }],
      tools: TOOLS,
    };
    // Soft-error retry loop: pi-ai surfaces upstream 429s as
    // stopReason='error' on a 200 response. Try up to 3 times.
    const MAX_SOFT_RETRIES = isOpenRouter ? 2 : 0;
    for (let attempt = 0; attempt <= MAX_SOFT_RETRIES; attempt += 1) {
      result = await complete(model, ctx, baseOptions);
      const isSoftError = result.stopReason === 'error' && isRetriableError(result.errorMessage);
      if (!isSoftError || attempt === MAX_SOFT_RETRIES) break;
      const waitMs = 1000 * 3 ** attempt + Math.floor(Math.random() * 500);
      await sleep(waitMs);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const ms = Date.now() - t0;
  const score = scoreCall({ result, error, expects: query.expects });
  return {
    queryId: query.id,
    model: modelSpec.label,
    provider: modelSpec.provider,
    modelId: modelSpec.modelId,
    tier: modelSpec.tier,
    ms,
    stopReason: result?.stopReason,
    errorMessage: result?.errorMessage,
    ...score,
  };
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = resolve(repoRoot, 'runs', `eval-free-${stamp}`);
  await mkdir(outDir, { recursive: true });
  const rawPath = resolve(outDir, 'raw.jsonl');
  console.log(`[eval] outDir = ${outDir}`);
  console.log(`[eval] models = ${MODELS.length} · queries = ${QUERIES.length}`);

  const records = [];
  for (const m of MODELS) {
    for (const q of QUERIES) {
      process.stdout.write(`  ${m.label.padEnd(18)} ${q.id.padEnd(20)} `);
      const rec = await evalOne(m, q);
      const tag = rec.ok ? '✓' : rec.error ? '✗ (err)' : `✗ T=${rec.T} V=${rec.V} C=${rec.C}`;
      console.log(`${tag.padEnd(18)} ${rec.ms}ms ${rec.callsMade ? `[${rec.callsMade}]` : ''}`);
      records.push(rec);
      await appendFile(rawPath, `${JSON.stringify(rec)}\n`);
    }
  }

  // Aggregate per model
  const byModel = new Map();
  for (const r of records) {
    if (!byModel.has(r.model)) {
      byModel.set(r.model, {
        label: r.model,
        modelId: r.modelId,
        provider: r.provider,
        tier: r.tier,
        n: 0,
        ok: 0,
        err: 0,
        totalMs: 0,
        Tsum: 0,
        Vsum: 0,
        Csum: 0,
      });
    }
    const a = byModel.get(r.model);
    a.n += 1;
    a.ok += r.ok;
    if (r.error) a.err += 1;
    a.totalMs += r.ms;
    a.Tsum += r.T;
    a.Vsum += r.V;
    a.Csum += r.C;
  }

  const ranked = [...byModel.values()]
    .map((a) => ({
      ...a,
      pct: ((a.ok / a.n) * 100).toFixed(0),
      avgMs: Math.round(a.totalMs / a.n),
      score: a.Tsum + a.Vsum + a.Csum, // 0..15 (3 dims × 5 queries)
    }))
    .sort((x, y) => y.score - x.score || x.avgMs - y.avgMs);

  const md = [
    `# Parity-studio free-model eval — ${stamp}`,
    '',
    'Each model handled 5 tool-using queries that mirror the chat-agent surface (list_files / read_file / upsert_file / set_todos / done).',
    '',
    '| Rank | Model | Tier | Score | Pass% | T | V | C | Errors | Avg latency |',
    '|---:|---|---|---:|---:|---:|---:|---:|---:|---:|',
    ...ranked.map(
      (r, i) =>
        `| ${i + 1} | \`${r.modelId}\` | ${r.tier} | ${r.score}/15 | ${r.pct}% | ${r.Tsum}/5 | ${r.Vsum}/5 | ${r.Csum}/5 | ${r.err} | ${r.avgMs}ms |`,
    ),
    '',
    'Score = T (tool fired when expected) + V (args valid) + C (coherent response). Each ∈ 0..5 across the 5 queries.',
    'Tied scores break by latency. Errors = pi-ai threw before scoring.',
    '',
    '## Rec',
    '',
    `Top free model: \`${ranked.find((r) => r.tier === 'free')?.modelId ?? 'none clean'}\`.`,
    `Top paid baseline: \`${ranked.find((r) => r.tier === 'paid')?.modelId ?? 'none clean'}\`.`,
  ].join('\n');

  const summaryPath = resolve(outDir, 'summary.md');
  await writeFile(summaryPath, md);
  console.log(`\n[eval] summary → ${summaryPath}`);
  console.log(`\n${md}`);
}

main().catch((err) => {
  console.error('[eval] fatal:', err);
  process.exit(1);
});
