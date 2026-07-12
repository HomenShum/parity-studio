'use node';

import {
  type AssistantMessage,
  type Context,
  type Message,
  type TextContent,
  type Tool,
  type ToolCall,
  getModel,
  complete as piComplete,
} from '@earendil-works/pi-ai/compat';
import { Type } from '@sinclair/typebox';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalAction } from './_generated/server';
import { type Phase, type RunModelConfig, resolveRunModel } from './lib/autoRouter';
import { type SupportedProvider, usdToMicroUsd } from './lib/piAi';
import { QUALITY_GATE_MAX_REPAIRS } from './lib/qualityGate';
import { lintKit } from './lib/staticLint';

// Two-tier model setup so the advisor (planning, fast/cheap) can run a
// different model than the executor (tool-using, accurate). When only
// CHAT_MODEL is set, both phases use it. The split kicks in when the
// user message starts with "Auto-fix triggered:" — the first turn (the
// set_todos call) prefers ADVISOR, subsequent execute/verify turns use
// EXECUTOR.
//
// Recommended via your nodebench eval ranking (set in Convex env):
//   CHAT_ADVISOR_PROVIDER=openrouter
//   CHAT_ADVISOR_MODEL=tencent/hunyuan-3              # 5.0s, fastest reliable
//   CHAT_EXECUTOR_PROVIDER=openrouter
//   CHAT_EXECUTOR_MODEL=nvidia/nemotron-3-super-120b  # best reliable, 14.5s
// (Slugs subject to openrouter's catalog — verify with their /models endpoint.)
//
// Defaults: Claude Sonnet 4.6 for both when using Anthropic directly.
const CHAT_PROVIDER = (process.env['CHAT_PROVIDER'] ?? 'anthropic') as 'anthropic' | 'openrouter';
const CHAT_MODEL =
  process.env['CHAT_MODEL'] ??
  (CHAT_PROVIDER === 'anthropic' ? 'claude-sonnet-4-6' : 'moonshotai/kimi-k2.6');
// Advisor + Executor envs are read inline at hop time (in runAgentLoop)
// since the tier resolver is the new default; only fall back to env on
// explicit override. We keep the ADVISOR_* constants here for the
// enhance action's fallback chain (ENHANCE_PROVIDER → ADVISOR_PROVIDER →
// CHAT_PROVIDER → 'anthropic').
const ADVISOR_PROVIDER = (process.env['CHAT_ADVISOR_PROVIDER'] ?? CHAT_PROVIDER) as
  | 'anthropic'
  | 'openrouter';
const ADVISOR_MODEL = process.env['CHAT_ADVISOR_MODEL'] ?? CHAT_MODEL;

// Enhance-prompt model. When a runId is provided, this follows the run router's
// enhance phase. CHAT_ENHANCE_PROVIDER / CHAT_ENHANCE_MODEL remain explicit
// deployment overrides for ops.
const ENHANCE_PROVIDER = (process.env['CHAT_ENHANCE_PROVIDER'] ?? ADVISOR_PROVIDER) as
  | 'anthropic'
  | 'openrouter';
const ENHANCE_MODEL = process.env['CHAT_ENHANCE_MODEL'] ?? ADVISOR_MODEL;
const CHAT_AUTO_CONTINUE_MAX = Math.max(
  0,
  Number.parseInt(process.env['CHAT_AUTO_CONTINUE_MAX'] ?? '3', 10) || 0,
);

const SUPPORTED_PROVIDER_VALUES: SupportedProvider[] = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'groq',
  'cerebras',
  'xai',
  'mistral',
];

function asSupportedProvider(
  value: string | undefined,
  fallback: SupportedProvider,
): SupportedProvider {
  return SUPPORTED_PROVIDER_VALUES.includes(value as SupportedProvider)
    ? (value as SupportedProvider)
    : fallback;
}

function resolvePhaseModel({
  runId,
  run,
  phase,
  fallbackProvider,
  fallbackModel,
  providerEnvKey,
  modelEnvKey,
}: {
  runId: Id<'runs'> | undefined;
  run: RunModelConfig | null | undefined;
  phase: Phase;
  fallbackProvider: SupportedProvider;
  fallbackModel: string;
  providerEnvKey: string;
  modelEnvKey: string;
}): {
  provider: SupportedProvider;
  modelId: string;
  source: 'router' | 'custom' | 'env' | 'fallback';
} {
  let provider = fallbackProvider;
  let modelId = fallbackModel;
  let source: 'router' | 'custom' | 'env' | 'fallback' = 'fallback';
  if (runId !== undefined) {
    const resolved = resolveRunModel(run, phase, String(runId));
    provider = resolved.provider;
    modelId = resolved.modelId;
    source = run?.modelOverride !== undefined && phase !== 'judge' ? 'custom' : 'router';
  }
  const providerOverride = process.env[providerEnvKey];
  const modelOverride = process.env[modelEnvKey];
  if (providerOverride !== undefined || modelOverride !== undefined) {
    provider = asSupportedProvider(providerOverride, provider);
    modelId = modelOverride ?? modelId;
    source = 'env';
  }
  return { provider, modelId, source };
}

// Verbatim from Kilo Code (packages/opencode/src/kilocode/enhance-prompt.ts).
// Single instruction; no system identity, no tools, no surrounding chat
// context — just rewrite. Bare model call mirrors Kilo's `singleCompletionHandler`.
const ENHANCE_INSTRUCTION =
  'Generate an enhanced version of this prompt (reply with only the enhanced prompt - no conversation, explanations, lead-in, bullet points, placeholders, or surrounding quotes):';

function cleanEnhanced(text: string): string {
  // Strip leading/trailing code fences and outer surrounding quotes.
  const stripped = text.replace(/^```\w*\n?|```$/g, '').trim();
  return stripped.replace(/^(['"])([\s\S]*)\1$/, '$2').trim();
}

/**
 * Public enhance action — single-shot prompt rewrite.
 *
 * UX: user types a draft in the ChatPanel composer, clicks the ✨ button.
 * We call a small/cheap model with the Kilo INSTRUCTION as system prompt
 * and the user's text as a single user message. Returns the cleaned
 * rewrite for the frontend to drop into the composer in place of the draft.
 *
 * Stateless — does NOT touch chat_messages. The user reviews + edits +
 * sends via the normal chat:send flow afterwards (matches Kilo's UX:
 * enhanced prompt is editable, not auto-sent).
 *
 * Cost: ~$0.001-$0.005 per call on advisor-tier models. Free-tier route
 * possible via CHAT_ENHANCE_MODEL=openrouter/<free-slug>.
 */
export const enhance = action({
  args: { text: v.string(), runId: v.optional(v.id('runs')) },
  handler: async (
    ctx,
    { text, runId },
  ): Promise<{ text: string; modelUsed: string; provider: string }> => {
    const trimmed = text.trim();
    if (trimmed.length === 0) throw new Error('chat:enhance text is empty');
    if (trimmed.length > 8000) throw new Error('chat:enhance text > 8000 chars');
    const run =
      runId !== undefined ? await ctx.runQuery(internal.runs.getInternal, { runId }) : null;
    const routed = resolvePhaseModel({
      runId,
      run,
      phase: 'enhance',
      fallbackProvider: ENHANCE_PROVIDER,
      fallbackModel: ENHANCE_MODEL,
      providerEnvKey: 'CHAT_ENHANCE_PROVIDER',
      modelEnvKey: 'CHAT_ENHANCE_MODEL',
    });

    // biome-ignore lint/suspicious/noExplicitAny: pi-ai's getModel surface
    const model = (getModel as any)(routed.provider, routed.modelId);
    const ctxObj: Context = {
      systemPrompt: ENHANCE_INSTRUCTION,
      messages: [{ role: 'user', content: trimmed, timestamp: Date.now() }],
    };
    const result = await piComplete(model, ctxObj, { maxOutputTokens: 1_000 });
    const textBlocks = result.content.filter((b): b is TextContent => b.type === 'text');
    const out = cleanEnhanced(textBlocks.map((b) => b.text).join(''));
    if (out.length === 0) {
      // Some free models return empty on rewrite; fail loudly so the UI
      // can surface a "couldn't enhance — try again" affordance.
      throw new Error('chat:enhance produced empty rewrite');
    }
    return { text: out, modelUsed: result.model, provider: result.provider };
  },
});

const PARITY_EXPLAIN_SYSTEM = `You are Parity Studio's parity coach.
Translate a deterministic UI parity report into language a first-time builder, vibe designer, or vibe coder can act on.

Rules:
- Do not expose internal scoring jargon unless it helps the user.
- Be honest about readiness. If failures remain, say it is not ready to distribute yet.
- Explain how the gaps affect the user's end users first: trust, comprehension, click confidence, accessibility, perceived quality, and whether the page feels real or like a static mockup.
- Tie that end-user impact to what the builder sees in the Preview tab and what they can open in the Files tab.
- Mention the visible screen title, hero text, or CTA if provided.
- Name 2-4 exact file paths to inspect/edit when files are provided.
- Write 5-6 short labeled lines: Readout, End-user impact, Where it shows up, Files the agent may edit, Fix next, Confidence.
- Mention at most 3 concrete failing/warning areas by name.
- If repairAttempts/repairCap are provided, mention whether the ambient quality gate still has repair attempts left.
- Do not give generic advice like "make one visible iteration" unless you also name the screen area and file path.
- Fix next should be phrased as an agent-ready user request, e.g. "Ask the agent to rebuild the header/hero/CTA so a visitor understands X and can click Y."
- No markdown table. No markdown bold/italic. No sales language.`;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function cleanParityExplanation(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[ \t]{2,}$/gm, '')
    .trim();
}

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTagText(html: string, tag: string, limit: number): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  for (const match of html.matchAll(re)) {
    const text = stripHtml(String(match[1] ?? ''));
    if (text.length > 0 && !out.includes(text)) out.push(text.slice(0, 120));
    if (out.length >= limit) break;
  }
  return out;
}

function chooseExplainFiles(
  files: Record<string, string>,
  slug: string,
  checks: Array<{ label: string; status: string }>,
): string[] {
  const paths = Object.keys(files).sort();
  const issueText = checks
    .filter((check) => check.status === 'fail' || check.status === 'warn')
    .slice(0, 6)
    .map((check) => check.label.toLowerCase())
    .join(' ');
  const chosen: string[] = [];
  const add = (predicate: (path: string) => boolean, limit = 3) => {
    for (const path of paths.filter(predicate).slice(0, limit)) {
      if (!chosen.includes(path)) chosen.push(path);
    }
  };

  add((path) => path === `ui_kits/${slug}/index.html`, 1);
  if (
    issueText.includes('structure') ||
    issueText.includes('component') ||
    issueText.includes('layout')
  ) {
    add((path) => path.startsWith(`ui_kits/${slug}/components/`) && path.endsWith('.tsx'), 4);
  }
  if (
    issueText.includes('spacing') ||
    issueText.includes('color') ||
    issueText.includes('typography') ||
    issueText.includes('font')
  ) {
    add((path) => path === `ui_kits/${slug}/tokens.css`, 1);
    add((path) => path.endsWith('.css') && path.includes(slug), 2);
  }
  add((path) => /parity\.contract\.json|qa\.plan\.md|api-wiring\.plan\.md$/.test(path), 3);
  add((path) => path.startsWith(`ui_kits/${slug}/components/`) && path.endsWith('.tsx'), 3);
  return chosen.slice(0, 5);
}

function buildExplainFallback(
  payload: {
    runStatus: string;
    status: unknown;
    passCount: unknown;
    totalChecks: unknown;
    checks: Array<{ label: string; status: string }>;
    context: {
      slug: string;
      source: string;
      previewTitle: string;
      headings: string[];
      actions: string[];
      suggestedFiles: string[];
      repairAttempts: number;
      repairCap: number;
    };
  },
  locale?: string,
): string {
  const failCount = payload.checks.filter((check) => check.status === 'fail').length;
  const warnCount = payload.checks.filter((check) => check.status === 'warn').length;
  const issueLabels = payload.checks
    .filter((check) => check.status === 'fail' || check.status === 'warn')
    .slice(0, 3)
    .map((check) => check.label);
  const issues = issueLabels.length > 0 ? issueLabels.join(', ') : 'no named blockers';
  const files =
    payload.context.suggestedFiles.length > 0
      ? payload.context.suggestedFiles.slice(0, 4).join(', ')
      : 'no generated files available';
  const headingText =
    payload.context.headings.length > 0
      ? payload.context.headings.slice(0, 3).join(' / ')
      : payload.context.previewTitle;
  const actionText =
    payload.context.actions.length > 0
      ? payload.context.actions.slice(0, 3).join(' / ')
      : 'no CTA text detected';
  const readiness =
    failCount > 0
      ? `not ready to distribute; ${failCount} checks fail`
      : warnCount > 0
        ? `close, but ${warnCount} warnings remain`
        : 'ready for final human review';

  if (locale?.toLowerCase().startsWith('zh')) {
    const zhReadiness =
      failCount > 0
        ? `还不能发布；${failCount} 项检查失败`
        : warnCount > 0
          ? `接近可用，但还有 ${warnCount} 个警告`
          : '可以进入最后人工复核';
    return [
      `解读：${zhReadiness}。${payload.passCount}/${payload.totalChecks} 项通过，当前 kit 为 ${payload.context.slug}。`,
      `终端用户影响：访客可能还不能完全信任或理解这个页面，因为 ${issues} 会让页面看起来像松散的静态稿，而不是可用的产品界面。`,
      `屏幕位置：Preview 正在判断 "${payload.context.previewTitle}"。请对照 ${payload.context.source} 检查 "${headingText}" 和操作 "${actionText}" 是否清楚匹配。`,
      `Agent 可能编辑的文件：${files}。`,
      `下一步修复：让 agent 先修最高影响的可见区域，确保第一次访问的人能理解页面目的和主要操作。后台修复已使用 ${payload.context.repairAttempts}/${payload.context.repairCap} 次。`,
      `置信度：中等；运行状态为 ${payload.runStatus}，确定性状态为 ${String(payload.status ?? 'unknown')}。`,
    ].join('\n');
  }

  return [
    `Readout: ${readiness}. ${payload.passCount}/${payload.totalChecks} pass for ${payload.context.slug}.`,
    `End-user impact: visitors may not trust or understand this screen yet because ${issues} can make the page feel like a loose mockup instead of a usable product surface.`,
    `Where it shows up: Preview is judging "${payload.context.previewTitle}". Check whether "${headingText}" and the actions "${actionText}" clearly match ${payload.context.source}.`,
    `Files the agent may edit: ${files}.`,
    `Fix next: ask the agent to repair the highest-impact visible section first so a first-time visitor understands the page purpose and primary action. Ambient repair has used ${payload.context.repairAttempts}/${payload.context.repairCap} attempts.`,
    `Confidence: medium; run status is ${payload.runStatus} and deterministic status is ${String(payload.status ?? 'unknown')}.`,
  ].join('\n');
}

export const explainParity = action({
  args: { runId: v.id('runs'), locale: v.optional(v.string()) },
  handler: async (
    ctx,
    { runId, locale },
  ): Promise<{ text: string; modelUsed: string; provider: string; costMicroUsd: number }> => {
    const report = await ctx.runQuery(internal.parityReports.getLatestInternal, { runId });
    const run = await ctx.runQuery(internal.runs.getInternal, { runId });
    const uiKit = await ctx.runQuery(internal.uiKits.getLatestInternal, { runId });
    const artifact = await ctx.runQuery(internal.artifacts.getLatestInternal, { runId });
    if (report === null) {
      if (locale?.toLowerCase().startsWith('zh')) {
        return {
          text: '解读：还没有匹配报告。\n终端用户影响：Parity Studio 需要先生成或导入 UI kit，才能判断用户是否会信任、理解并点击这个界面。\n下一步修复：先运行生成/拆解，再重新验证。\n置信度：正在等待第一份报告。',
          modelUsed: 'rule-based',
          provider: 'local',
          costMicroUsd: 0,
        };
      }
      return {
        text: 'Readout: No parity report exists yet.\nWhy it matters: Parity Studio needs a generated or imported UI kit before it can explain quality.\nFix next: Run generate/decompose, then verify again.\nConfidence: Waiting for the first report.',
        modelUsed: 'rule-based',
        provider: 'local',
        costMicroUsd: 0,
      };
    }

    const checks = Array.isArray(report.checks)
      ? report.checks.slice(0, 16).map((check: Record<string, unknown>) => ({
          label: String(check['label'] ?? check['id'] ?? 'check'),
          status: String(check['status'] ?? 'unavailable'),
          evidence: Array.isArray(check['evidence'])
            ? check['evidence'].slice(0, 2).map(String)
            : [],
        }))
      : [];
    const gaps = Array.isArray(report.gaps)
      ? report.gaps.slice(0, 8).map((gap: Record<string, unknown>) => ({
          kind: String(gap['kind'] ?? 'gap'),
          severity: String(gap['severity'] ?? 'medium'),
          message: String(gap['message'] ?? ''),
        }))
      : [];
    const files = ((uiKit?.files as Record<string, string> | undefined) ?? {}) as Record<
      string,
      string
    >;
    const slug = String(uiKit?.slug ?? 'current-kit');
    const html = String(artifact?.html ?? files[`ui_kits/${slug}/index.html`] ?? '');
    const previewTitle =
      extractTagText(html, 'title', 1)[0] ?? extractTagText(html, 'h1', 1)[0] ?? slug;
    const headings = [
      ...extractTagText(html, 'h1', 4),
      ...extractTagText(html, 'h2', 4),
      ...extractTagText(html, 'h3', 3),
    ].filter((text, index, all) => text.length > 0 && all.indexOf(text) === index);
    const actions = [...extractTagText(html, 'button', 4), ...extractTagText(html, 'a', 4)]
      .filter((text, index, all) => text.length > 0 && all.indexOf(text) === index)
      .slice(0, 4);
    const sourceParts = [];
    if (run?.sourceImageBase64) sourceParts.push('the stored source image');
    if (run?.prompt) sourceParts.push(`the prompt "${String(run.prompt).slice(0, 120)}"`);
    const context = {
      slug,
      fileCount: Number(uiKit?.fileCount ?? Object.keys(files).length),
      source: sourceParts.length > 0 ? sourceParts.join(' and ') : 'the current run source context',
      previewTitle,
      headings: headings.slice(0, 6),
      actions,
      suggestedFiles: chooseExplainFiles(files, slug, checks),
      repairAttempts: Number(run?.iterationsCompleted ?? 0),
      repairCap: QUALITY_GATE_MAX_REPAIRS,
      componentFiles: Object.keys(files)
        .filter((path) => path.startsWith(`ui_kits/${slug}/components/`) && path.endsWith('.tsx'))
        .slice(0, 8),
      contractFiles: Object.keys(files)
        .filter((path) =>
          /parity\.contract\.json|performance\.budget\.json|api-wiring\.plan\.md|qa\.plan\.md$/.test(
            path,
          ),
        )
        .slice(0, 8),
    };
    const payload = {
      locale: locale ?? 'en',
      runStatus: run?.status ?? 'unknown',
      status: report.status,
      passCount: report.passCount,
      totalChecks: report.totalChecks,
      summary: report.summary,
      checks,
      gaps,
      context,
    };

    const routed = resolvePhaseModel({
      runId,
      run,
      phase: 'advise',
      fallbackProvider: ENHANCE_PROVIDER,
      fallbackModel: ENHANCE_MODEL,
      providerEnvKey: 'PARITY_EXPLAIN_PROVIDER',
      modelEnvKey: 'PARITY_EXPLAIN_MODEL',
    });
    try {
      // biome-ignore lint/suspicious/noExplicitAny: pi-ai's getModel surface
      const model = (getModel as any)(routed.provider, routed.modelId);
      const result = await withTimeout(
        piComplete(
          model,
          {
            systemPrompt: `${PARITY_EXPLAIN_SYSTEM}\n\nRespond in ${locale?.toLowerCase().startsWith('zh') ? 'Simplified Chinese' : 'English'}. Keep the same labeled-line structure.`,
            messages: [
              {
                role: 'user',
                content: JSON.stringify(payload).slice(0, 16_000),
                timestamp: Date.now(),
              },
            ],
          },
          { maxOutputTokens: 700 },
        ),
        25_000,
        'parity explanation',
      );
      const textBlocks = result.content.filter(
        (block): block is TextContent => block.type === 'text',
      );
      const text = cleanParityExplanation(textBlocks.map((block) => block.text).join(''));
      if (text.length === 0) throw new Error('parity explanation produced empty text');
      return {
        text,
        modelUsed: result.model,
        provider: result.provider,
        costMicroUsd: usdToMicroUsd(result.usage?.cost?.total ?? 0),
      };
    } catch {
      return {
        text: buildExplainFallback(payload, locale),
        modelUsed: 'rule-based',
        provider: 'local',
        costMicroUsd: 0,
      };
    }
  },
});

const SYSTEM_PROMPT = `You are the Parity Studio chat agent. The user is iterating on a UI kit they generated or imported into parity-studio. The kit lives as a flat map of file paths under one ui_kit row in Convex; you have direct atomic edit access to every path in the canonical NodeBench skill-pack shape:

- README.md, SKILL.md, colors_and_type.css (top-level docs)
- AGENTS.md, .claude/skills/<slug>/SKILL.md, .cursor/rules/<slug>-parity-studio.mdc (agent rules exported with the kit)
- ui_kits/<slug>/index.html, components/*.tsx, tokens.css, manifest.json, README.md, HANDOFF.md (the active product)
- ui_kits/<slug>/parity.contract.json, performance.budget.json, api-wiring.plan.md, qa.plan.md (operating contract: intent, appearance, organization, performance, API, QA, privacy/BYOK)
- ui_kits/<slug>/tweak-schema.json (drives the live Tweaks panel — declare per-token UI hints: { kind: 'color' | 'number' | 'enum' | 'boolean' | 'string', label?, min?, max?, step?, unit?, options?, placeholder? })
- assets/logo-mark.svg, assets/og-<slug>.svg, assets/README.md (brand artifacts)
- preview/_shell.css, preview/index.html, preview/component-*.html, preview/tokens-*.html (specimen pages)
- explorations/iter-N.html, explorations/README.md (iteration history)
- screenshots/README.md, scraps/README.md (hook points; binaries injected at zip time)

Tools at your disposal:
- list_files() — every path in the kit
- read_file({ path }) — content (capped at 30 KB inline for context)
- read_design_system() — structured tokens grouped by type (color/spacing/radius/typography/etc.) parsed from tokens.css. Use this BEFORE upsert_file when you need to know what tokens are available; cheaper than read_file on tokens.css.
- upsert_file({ path, content }) — atomic write; creates if new, replaces if existing. Cap: 200 KB.
- set_todos({ items }) — publish a checklist of in-progress steps; renders as a visible checklist in the chat. items: [{ text, checked: boolean }]. Use for multi-step plans; replaces the previous todo list.
- done({ paths? }) — runs static lint over the kit (or specified paths). Use AFTER making edits to confirm no syntax errors / a11y regressions / dangling debug statements. Returns { status: 'ok' | 'has_warnings' | 'has_errors', findings: [...] }. If status='has_errors', fix and call again.
- iterate_now() — guidance only; user-driven via the right-rail Iterate now button

Conventions:
- Speak in the user's language. Be concise — 1–3 short sentences before/between tool calls.
- Before any meaningful edit, read ui_kits/<slug>/parity.contract.json and classify impact as one or more of: appearance, performance, organization, api, accessibility, privacy.
- Before editing, always read_file the target so you operate on the latest content.
- If the edit changes assumptions about intent, performance, API wiring, QA, or privacy/BYOK, update the relevant contract/plan file in the same batch. If not, say "no contract change" in the close.
- After a batch of edits, summarize what changed and offer the next move.
- Never invent file paths — if unsure, list_files first.
- The 16-row deterministic parity rubric (right rail) doesn't auto-rerun on edits; mention this when changes are non-trivial so the user can hit Iterate now.

ADVISOR-EXECUTOR PROTOCOL (when the user message starts with "Auto-fix triggered:"):
You are running in two phases — be methodical, NOT chatty.
  Phase 1 ADVISE: in the SAME turn, output one short sentence ("I'll plan and execute…") then call set_todos with 3–5 concrete, ordered, actionable items. Each item names a file or a check. No follow-up prose between set_todos and the first executor tool call.
  Phase 2 EXECUTE: walk the plan top-to-bottom. For each item: read_file the target, upsert_file the change, mark the item checked by emitting set_todos again with the updated state. Don't over-edit — only touch files the comment references or that the comment naturally implicates.
  Phase 3 VERIFY: call done({ paths: [<every path you upsert_file'd>] }). If status='has_errors', fix and call done again. If status='has_warnings', mention them in the close.
  Phase 4 CLOSE: 1–2 sentence summary — "Updated X and Y; <key observation>. Run Iterate now if you want the parity score re-checked."

When NOT triggered by Auto-fix (regular conversational chat), behave as usual — no forced protocol.`;

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
    description:
      'Atomic write across the full canonical shape (ui_kits/, preview/, assets/, explorations/, top-level docs, READMEs).',
    parameters: Type.Object({
      path: Type.String({ description: 'Path inside the kit. 1..200 chars.' }),
      content: Type.String({ description: 'New file content. Capped at 200 KB.' }),
    }),
  },
  {
    name: 'read_design_system',
    description:
      "Returns a compact structured view of the kit's design tokens — colors, spacing, radii, typography, motion, semantic — parsed from tokens.css. Use BEFORE upsert_file when picking values that should match existing tokens.",
    parameters: Type.Object({}),
  },
  {
    name: 'set_todos',
    description:
      'Publish a checklist for the user to watch progress on a multi-step task. Replaces the prior list. Each item has { text: string, checked: boolean }. Aim for 3–7 items.',
    parameters: Type.Object({
      items: Type.Array(
        Type.Object({
          text: Type.String(),
          checked: Type.Boolean(),
        }),
      ),
    }),
  },
  {
    name: 'done',
    description:
      'Run static lint across the kit (HTML/JSX structural balance, duplicate ids, img missing alt, button accessible name, a without href, brace balance, leftover console/debugger, JSON.parse). Returns status + findings. Call AFTER editing to self-verify. If status="has_errors", fix the listed issues and call again before declaring complete.',
    parameters: Type.Object({
      paths: Type.Optional(
        Type.Array(Type.String(), {
          description: 'Optional subset of paths. Empty = lint every file in the kit.',
        }),
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
  args: {
    runId: v.id('runs'),
    autoContinueDepth: v.optional(v.number()),
  },
  handler: async (ctx, { runId, autoContinueDepth = 0 }): Promise<void> => {
    const uiKit = await ctx.runQuery(internal.uiKits.getLatestInternal, { runId });
    if (uiKit === null) {
      await ctx.runMutation(internal.chat.insertTurn, {
        runId,
        role: 'assistant',
        content:
          'No ui_kit yet — drop an image, kit zip, or prompt into the composer first, then ping me.',
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
    if (autoContinueDepth > 0) {
      messages.push({
        role: 'user',
        content:
          'System auto-continue: keep working from the previous tool results. Finish the requested change end-to-end, call done({ paths }) after edits, self-heal errors, and close with a concise completion summary. Do not ask the user to type continue unless the remaining work is blocked by missing information or approval.',
        timestamp: Date.now(),
      });
    }

    // Detect advisor-executor mode by inspecting the most recent user
    // turn. If it begins with "Auto-fix triggered:", route hop 0 (the
    // planning turn that emits set_todos) to ADVISOR and hops 1+ to
    // EXECUTOR. Otherwise both stay on CHAT_MODEL.
    const adviseMode = (() => {
      for (let i = history.length - 1; i >= 0; i -= 1) {
        const m = history[i];
        if (m && m.role === 'user') return m.content.startsWith('Auto-fix triggered:');
      }
      return false;
    })();

    // Resolve run model from explicit custom override or curated router.
    const runRow = await ctx.runQuery(internal.runs.getInternal, { runId });

    // Source-sync and parity-repair passes usually need plan -> read -> edit -> contract -> verify.
    // Eight hops was too tight in dogfood: the agent patched files but stopped before done().
    const MAX_HOPS = 12;
    const mutatedPaths = new Set<string>();
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      const useAdvisor = adviseMode && hop === 0 && autoContinueDepth === 0;
      // Tier-aware resolution. The autoRouter lives in convex/lib/autoRouter.ts
      // and curates which underlying model serves each (tier, phase) cell.
      // Direct env overrides (CHAT_ADVISOR_MODEL / CHAT_EXECUTOR_MODEL) win
      // over tier defaults, preserving the v1 dual-model knob.
      const phase = useAdvisor ? 'advise' : 'execute';
      const baseResolved = resolveRunModel(runRow, phase, String(runId));
      const provider = useAdvisor
        ? (process.env['CHAT_ADVISOR_PROVIDER'] ?? baseResolved.provider)
        : (process.env['CHAT_EXECUTOR_PROVIDER'] ?? baseResolved.provider);
      const modelId = useAdvisor
        ? (process.env['CHAT_ADVISOR_MODEL'] ?? baseResolved.modelId)
        : (process.env['CHAT_EXECUTOR_MODEL'] ?? baseResolved.modelId);
      // biome-ignore lint/suspicious/noExplicitAny: pi-ai's getModel surface
      const model = (getModel as any)(provider, modelId);
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
      const text = textBlocks
        .map((b) => b.text)
        .join('')
        .trim();

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

      if (toolCalls.length === 0) {
        await reverifyLatestAfterAgentEdits(ctx, runId, mutatedPaths);
        return;
      }

      for (const tc of toolCalls) {
        let payload: string;
        let isError = false;
        try {
          payload = await executeTool(ctx, runId, tc.name, tc.arguments ?? {});
          if (tc.name === 'upsert_file') {
            const path = String(
              (tc.arguments as Record<string, unknown> | undefined)?.['path'] ?? '',
            );
            if (path.length > 0) mutatedPaths.add(path);
          }
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

    const canAutoContinue = autoContinueDepth < CHAT_AUTO_CONTINUE_MAX;
    await ctx.runMutation(internal.chat.insertTurn, {
      runId,
      role: 'assistant',
      content: canAutoContinue
        ? `(agent reached its step budget before finishing - continuing automatically ${autoContinueDepth + 1}/${CHAT_AUTO_CONTINUE_MAX})`
        : '(agent reached its auto-continue safety cap before finishing - review the latest changes, then send a more specific follow-up if more work is needed)',
      turn: await ctx.runQuery(internal.chat.nextTurnNumber, { runId }),
    });
    await reverifyLatestAfterAgentEdits(ctx, runId, mutatedPaths);
    if (canAutoContinue) {
      await ctx.scheduler.runAfter(0, internal.chatLoop.runAgentLoop, {
        runId,
        autoContinueDepth: autoContinueDepth + 1,
      });
    }
  },
});

async function reverifyLatestAfterAgentEdits(
  // biome-ignore lint/suspicious/noExplicitAny: action ctx
  ctx: any,
  runId: Id<'runs'>,
  mutatedPaths: Set<string>,
): Promise<void> {
  if (mutatedPaths.size === 0) return;
  try {
    await ctx.runAction(internal.parityReports.reverifyLatestInternal, {
      runId,
      reason: `agent-edit:${Array.from(mutatedPaths).slice(0, 6).join(',')}`,
    });
  } catch {
    // Ambient verification should never turn a completed edit into a chat error.
    // The right rail keeps the previous honest report if this background pass fails.
  }
}

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
    case 'read_design_system': {
      // Find the active slug's tokens.css and group declarations by type.
      const slug = uiKit.slug;
      const tokensCss = files[`ui_kits/${slug}/tokens.css`] ?? '';
      if (tokensCss.length === 0) return 'no tokens.css in kit';
      const decl = /--([a-z][a-z0-9-]*)\s*:\s*([^;]+);/gi;
      const groups: Record<string, Array<{ name: string; value: string }>> = {
        color: [],
        spacing: [],
        radius: [],
        typography: [],
        motion: [],
        shadow: [],
        semantic: [],
        other: [],
      };
      for (const m of tokensCss.matchAll(decl)) {
        const name = `--${m[1]}`;
        const value = (m[2] ?? '').trim();
        let bucket = 'other';
        if (
          /(color|accent|brand|surface|border|background|text|fill)/i.test(name) ||
          /^(#|oklch|rgb|hsl)/i.test(value)
        )
          bucket = 'color';
        else if (/^(space|gap|size)/i.test(name.replace(/^--/, ''))) bucket = 'spacing';
        else if (/^radius/i.test(name.replace(/^--/, ''))) bucket = 'radius';
        else if (/^(font|text|leading|tracking)/i.test(name.replace(/^--/, '')))
          bucket = 'typography';
        else if (/^(duration|ease|motion)/i.test(name.replace(/^--/, ''))) bucket = 'motion';
        else if (/^shadow/i.test(name.replace(/^--/, ''))) bucket = 'shadow';
        else if (/^(success|warning|error|info|mcp|toast)/i.test(name.replace(/^--/, '')))
          bucket = 'semantic';
        const arr = groups[bucket];
        if (arr) arr.push({ name, value });
      }
      const lines = [`design system for ${slug}:`];
      for (const [g, list] of Object.entries(groups)) {
        if (list.length === 0) continue;
        lines.push(`\n## ${g} (${list.length})`);
        for (const t of list) lines.push(`  ${t.name}: ${t.value}`);
      }
      return lines.join('\n');
    }
    case 'set_todos': {
      const itemsRaw = args['items'];
      if (!Array.isArray(itemsRaw)) return 'error: set_todos requires items: [{text, checked}]';
      const items = itemsRaw
        .filter((it): it is { text: string; checked: boolean } => {
          if (typeof it !== 'object' || it === null) return false;
          const o = it as { text?: unknown; checked?: unknown };
          return typeof o.text === 'string' && typeof o.checked === 'boolean';
        })
        .slice(0, 12);
      // Tool result is JSON so the ChatPanel can render it as a checklist.
      // Format prefix `__todos__:` lets the renderer detect this shape.
      return `__todos__:${JSON.stringify(items)}`;
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
      const more =
        report.findings.length > 50
          ? `\n…+${report.findings.length - 50} more findings (call done with narrower paths to drill in)`
          : '';
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
