'use node';

import {
  type AssistantMessage,
  type Context,
  type Message,
  type TextContent,
  type Tool,
  type ToolCall,
  complete as piComplete,
  getModel,
} from '@mariozechner/pi-ai';
import { Type } from '@sinclair/typebox';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalAction } from './_generated/server';
import { usdToMicroUsd } from './lib/piAi';
import { lintKit } from './lib/staticLint';

// Same provider/model knobs as the pipeline. Override via Convex env:
//   npx convex env set CHAT_PROVIDER anthropic
//   npx convex env set CHAT_MODEL claude-sonnet-4-5
const CHAT_PROVIDER = (process.env['CHAT_PROVIDER'] ?? 'anthropic') as 'anthropic' | 'openrouter';
const CHAT_MODEL =
  process.env['CHAT_MODEL'] ??
  (CHAT_PROVIDER === 'anthropic' ? 'claude-sonnet-4-5' : 'moonshotai/kimi-k2.6');

const SYSTEM_PROMPT = `You are the Parity Studio chat agent. The user is iterating on a UI kit they generated or imported into parity-studio. The kit lives as a flat map of file paths under one ui_kit row in Convex; you have direct atomic edit access to every path in the canonical NodeBench skill-pack shape:

- README.md, SKILL.md, colors_and_type.css (top-level docs)
- ui_kits/<slug>/index.html, components/*.tsx, tokens.css, manifest.json, README.md, HANDOFF.md (the active product)
- ui_kits/<slug>/tweak-schema.json (drives the live Tweaks panel — declare per-token UI hints: { kind: 'color' | 'number' | 'enum' | 'boolean' | 'string', label?, min?, max?, step?, unit?, options?, placeholder? })
- assets/logo-mark.svg, assets/og-<slug>.svg, assets/README.md (brand artifacts)
- preview/_shell.css, preview/index.html, preview/component-*.html, preview/tokens-*.html (specimen pages)
- explorations/iter-N.html, explorations/README.md (iteration history)
- screenshots/README.md, scraps/README.md (hook points; binaries injected at zip time)

Tools at your disposal:
- list_files() — every path in the kit
- read_file({ path }) — content (capped at 30 KB inline for context)
- upsert_file({ path, content }) — atomic write; creates if new, replaces if existing. Cap: 200 KB.
- done({ paths? }) — runs static lint over the kit (or specified paths). Use AFTER making edits to confirm no syntax errors / a11y regressions / dangling debug statements. Returns { status: 'ok' | 'has_warnings' | 'has_errors', findings: [...] }. If status='has_errors', fix and call again.
- iterate_now() — guidance only; user-driven via the right-rail Iterate now button

Conventions:
- Speak in the user's language. Be concise — 1–3 short sentences before/between tool calls.
- Before editing, always read_file the target so you operate on the latest content.
- After a batch of edits, summarize what changed and offer the next move.
- Never invent file paths — if unsure, list_files first.
- The 16-row deterministic parity rubric (right rail) doesn't auto-rerun on edits; mention this when changes are non-trivial so the user can hit Iterate now.`;

const TOOLS: Tool[] = [
  {
    name: 'list_files',
    description: 'List every path currently in the active ui_kit.',
    parameters: Type.Object({}),
  },
  {
    name: 'read_file',
    description: 'Read the content of a single file in the kit.',
    parameters: Type.Object({
      path: Type.String({ description: 'Exact path inside the kit' }),
    }),
  },
  {
    name: 'upsert_file',
    description: 'Atomic write across the full canonical shape (ui_kits/, preview/, assets/, explorations/, top-level docs, READMEs).',
    parameters: Type.Object({
      path: Type.String({ description: 'Path inside the kit. 1..200 chars.' }),
      content: Type.String({ description: 'New file content. Capped at 200 KB.' }),
    }),
  },
  {
    name: 'done',
    description:
      'Run static lint across the kit (HTML/JSX structural balance, duplicate ids, img missing alt, button accessible name, a without href, brace balance, leftover console/debugger, JSON.parse). Returns status + findings. Call AFTER editing to self-verify. If status="has_errors", fix the listed issues and call again before declaring complete.',
    parameters: Type.Object({
      paths: Type.Optional(
        Type.Array(Type.String(), { description: 'Optional subset of paths. Empty = lint every file in the kit.' }),
      ),
    }),
  },
  {
    name: 'iterate_now',
    description: 'Guidance only — the user kicks iterate from the right-rail button.',
    parameters: Type.Object({}),
  },
];

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    totalTokens: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

export const runAgentLoop = internalAction({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }): Promise<void> => {
    const uiKit = await ctx.runQuery(internal.uiKits.getLatestInternal, { runId });
    if (uiKit === null) {
      await ctx.runMutation(internal.chat.insertTurn, {
        runId,
        role: 'assistant',
        content: 'No ui_kit yet — drop an image, kit zip, or prompt into the composer first, then ping me.',
        turn: await ctx.runQuery(internal.chat.nextTurnNumber, { runId }),
      });
      return;
    }

    const history = await ctx.runQuery(internal.chat.listForLoadInternal, { runId });

    const messages: Message[] = [];
    for (const m of history) {
      if (m.role === 'user') {
        messages.push({ role: 'user', content: m.content, timestamp: m._creationTime });
      } else if (m.role === 'assistant') {
        const blocks: AssistantMessage['content'] = [];
        if (m.content.length > 0) blocks.push({ type: 'text', text: m.content });
        if (m.toolCalls) {
          for (const tc of m.toolCalls) {
            blocks.push({
              type: 'toolCall',
              id: tc.id,
              name: tc.name,
              arguments: safeParseJson(tc.args) ?? {},
            });
          }
        }
        messages.push({
          role: 'assistant',
          content: blocks,
          api: 'anthropic-messages',
          provider: m.provider ?? CHAT_PROVIDER,
          model: m.modelId ?? CHAT_MODEL,
          usage: emptyUsage(),
          stopReason: 'stop',
          timestamp: m._creationTime,
        } as AssistantMessage);
      } else {
        messages.push({
          role: 'toolResult',
          toolCallId: m.toolCallId ?? 'unknown',
          toolName: m.toolName ?? 'unknown',
          content: [{ type: 'text', text: m.content }],
          isError: false,
          timestamp: m._creationTime,
        });
      }
    }

    const MAX_HOPS = 8;
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      // biome-ignore lint/suspicious/noExplicitAny: pi-ai's getModel surface
      const model = (getModel as any)(CHAT_PROVIDER, CHAT_MODEL);
      const ctxObj: Context = {
        systemPrompt: SYSTEM_PROMPT,
        messages,
        tools: TOOLS,
      };
      let result: AssistantMessage;
      try {
        result = await piComplete(model, ctxObj, { maxOutputTokens: 4_000 });
      } catch (err) {
        await ctx.runMutation(internal.chat.insertTurn, {
          runId,
          role: 'assistant',
          content: `(agent error: ${err instanceof Error ? err.message : String(err)})`,
          turn: await ctx.runQuery(internal.chat.nextTurnNumber, { runId }),
        });
        return;
      }

      const textBlocks = result.content.filter((b): b is TextContent => b.type === 'text');
      const toolCalls = result.content.filter((b): b is ToolCall => b.type === 'toolCall');
      const text = textBlocks.map((b) => b.text).join('').trim();

      await ctx.runMutation(internal.chat.insertTurn, {
        runId,
        role: 'assistant',
        content: text,
        turn: await ctx.runQuery(internal.chat.nextTurnNumber, { runId }),
        ...(toolCalls.length > 0
          ? {
              toolCalls: toolCalls.map((tc) => ({
                id: tc.id,
                name: tc.name,
                args: JSON.stringify(tc.arguments ?? {}),
              })),
            }
          : {}),
        modelId: result.model,
        provider: result.provider,
        costMicroUsd: usdToMicroUsd(result.usage.cost.total),
      });

      messages.push({
        role: 'assistant',
        content: result.content,
        api: result.api,
        provider: result.provider,
        model: result.model,
        usage: result.usage,
        stopReason: result.stopReason,
        timestamp: Date.now(),
      } as AssistantMessage);

      if (toolCalls.length === 0) return;

      for (const tc of toolCalls) {
        let payload: string;
        let isError = false;
        try {
          payload = await executeTool(ctx, runId, tc.name, tc.arguments ?? {});
        } catch (err) {
          payload = `error: ${err instanceof Error ? err.message : String(err)}`;
          isError = true;
        }
        await ctx.runMutation(internal.chat.insertTurn, {
          runId,
          role: 'tool',
          content: payload,
          turn: await ctx.runQuery(internal.chat.nextTurnNumber, { runId }),
          toolCallId: tc.id,
          toolName: tc.name,
        });
        messages.push({
          role: 'toolResult',
          toolCallId: tc.id,
          toolName: tc.name,
          content: [{ type: 'text', text: payload }],
          isError,
          timestamp: Date.now(),
        });
      }
    }

    await ctx.runMutation(internal.chat.insertTurn, {
      runId,
      role: 'assistant',
      content: '(agent stopped after 8 tool hops — ask me to continue if needed)',
      turn: await ctx.runQuery(internal.chat.nextTurnNumber, { runId }),
    });
  },
});

async function executeTool(
  // biome-ignore lint/suspicious/noExplicitAny: action ctx
  ctx: any,
  runId: Id<'runs'>,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const uiKit = await ctx.runQuery(internal.uiKits.getLatestInternal, { runId });
  if (uiKit === null) return 'error: no ui_kit row for this run';
  const files = (uiKit.files as Record<string, string>) ?? {};

  switch (name) {
    case 'list_files': {
      const paths = Object.keys(files).sort();
      return paths.length === 0 ? '(empty kit)' : `${paths.length} files:\n${paths.join('\n')}`;
    }
    case 'read_file': {
      const path = String(args['path'] ?? '');
      if (!path) return 'error: read_file requires "path"';
      const content = files[path];
      if (content === undefined) return `error: path "${path}" not in kit`;
      return content.length > 30_000
        ? `${content.slice(0, 30_000)}\n\n[…truncated at 30 KB; full content is ${content.length} chars]`
        : content;
    }
    case 'upsert_file': {
      const path = String(args['path'] ?? '');
      const content = String(args['content'] ?? '');
      if (!path) return 'error: upsert_file requires "path"';
      if (path.length > 200) return 'error: path > 200 chars';
      if (content.length > 200_000) return 'error: content > 200 KB';
      const result = await ctx.runMutation(internal.uiKits.upsertFileInternal, {
        uiKitId: uiKit._id,
        path,
        content,
      });
      return `${result.created ? 'created' : 'updated'} ${path} (${result.sizeBytes} bytes)`;
    }
    case 'done': {
      const paths = Array.isArray(args['paths']) ? (args['paths'] as string[]) : undefined;
      const report = lintKit(files, paths);
      const head = `${report.summary} [status: ${report.status}]`;
      if (report.findings.length === 0) return head;
      const lines = report.findings
        .slice(0, 50)
        .map((f) => `  ${f.severity.toUpperCase()} ${f.path}:${f.line} [${f.rule}] ${f.message}`)
        .join('\n');
      const more = report.findings.length > 50 ? `\n…+${report.findings.length - 50} more findings (call done with narrower paths to drill in)` : '';
      return `${head}\n${lines}${more}`;
    }
    case 'iterate_now':
      return 'iterate_now is user-driven — surface the suggestion in your reply and the user can hit the Iterate now button in the right rail.';
    default:
      return `error: unknown tool "${name}"`;
  }
}

function safeParseJson(s: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
