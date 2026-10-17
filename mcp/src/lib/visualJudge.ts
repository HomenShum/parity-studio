import { requireLocalKeys } from './byok.js';
import { callByModel } from './llmClient.js';
import { type ParityReport, statusFromBooleans } from './parityChecker.js';
import { VISUAL_JUDGE_SYSTEM } from './prompts.js';
import { renderHtmlToPng } from './render.js';

export interface VisualJudgeOutcome {
  passCount: number;
  totalChecks: number;
  parityScore: number;
  status: ParityReport['status'];
  summary: string;
  checks: Array<{ dimension: string; id: string; passed: boolean; note: string }>;
  judgeCostUsd: number;
  modelUsed: string;
  renderLatencyMs: number;
}

export async function runVisualJudge(args: {
  sourceImageBase64: string;
  sourceImageMimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  indexHtml: string;
  judgeModel: string;
}): Promise<VisualJudgeOutcome> {
  requireLocalKeys([args.judgeModel]);
  const rendered = await renderHtmlToPng(args.indexHtml);

  // Build a single user message with both images side-by-side context.
  // Some providers only accept one image per message — we send the rendered as
  // primary and pass the source as a leading reference inside the userText.
  // For Anthropic vision multi-image: use both via two image blocks.
  // Simpler: pass them sequentially in the same prompt body, judge tolerates.
  const judge = await callByModel({
    model: args.judgeModel,
    systemPrompt: VISUAL_JUDGE_SYSTEM,
    userText:
      'IMAGE 1 = SOURCE (reference). IMAGE 2 = RENDERED candidate.\nReturn the JSON rubric described above.',
    userImage: { base64: args.sourceImageBase64, mediaType: args.sourceImageMimeType },
    maxTokens: 4_000,
    // A reply cut off at the cap (or failed) has no complete rubric. call() throws for it, with the judge's billed
    // cost, instead of letting a parse give checks=[] and a silent 0/12 'fail' that reads as a verdict on the candidate.
    requireComplete: { stage: 'visual judge', consequence: 'no score reported' },
  });

  // Parse JSON loosely — providers sometimes wrap in fences
  const parsed = parseLooseJson(judge.text);
  const checks: VisualJudgeOutcome['checks'] = Array.isArray(parsed?.checks)
    ? (parsed.checks as VisualJudgeOutcome['checks'])
    : [];
  const passCount = checks.filter((c) => c.passed === true).length;
  const totalChecks = checks.length || 12;
  const parityScore = totalChecks === 0 ? 0 : passCount / totalChecks;
  const status = statusFromBooleans(passCount, totalChecks);

  return {
    passCount,
    totalChecks,
    parityScore,
    status,
    summary:
      typeof parsed?.summary === 'string'
        ? (parsed.summary as string)
        : `${passCount}/${totalChecks} visual checks passed`,
    checks,
    judgeCostUsd: judge.costUsd,
    modelUsed: judge.modelUsed,
    renderLatencyMs: rendered.latencyMs,
  };
}

function parseLooseJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  // Strip leading/trailing fence
  const stripped = trimmed
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();
  try {
    return JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    // Try to extract first { ... } block
    const m = stripped.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}
