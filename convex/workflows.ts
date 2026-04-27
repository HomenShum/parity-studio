import { WorkflowManager } from '@convex-dev/workflow';
import { v } from 'convex/values';
import { components, internal } from './_generated/api';

/**
 * Durable orchestration for the parity-studio in-app pipeline:
 *   generateInitial -> decompose -> verifyDeterministic -> done
 *
 * Why @convex-dev/workflow (not the Agent component): Agent locks to
 * Vercel AI SDK; we want pi-ai. Workflow is independent and gives us
 * exactly the durable-multi-step + retry + replay shape we need.
 *
 * The visual verifier is intentionally NOT in this workflow — it needs
 * Playwright headless rendering which doesn't run in Convex's edge
 * runtime. Visual verification lives in the MCP path (which has Playwright)
 * and a future Vercel function the in-app pipeline will call out to.
 *
 * Workflow handlers must be deterministic. All side effects go through
 * `step.runAction` so they get journaled and replayed.
 */
export const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    maxParallelism: 8,
    defaultRetryBehavior: {
      maxAttempts: 3,
      initialBackoffMs: 1_000,
      base: 2,
    },
  },
});

export const parityStudioWorkflow = workflow.define({
  args: {
    runId: v.id('runs'),
    prompt: v.optional(v.string()),
    sourceImageBase64: v.optional(v.string()),
    sourceImageMimeType: v.optional(
      v.union(v.literal('image/png'), v.literal('image/jpeg'), v.literal('image/webp')),
    ),
  },
  handler: async (step, args): Promise<void> => {
    // Stage 1: generate initial HTML from prompt + optional image
    const generateResult = await step.runAction(
      internal.generation.generateInitial,
      {
        runId: args.runId,
        ...(args.prompt !== undefined ? { prompt: args.prompt } : {}),
        ...(args.sourceImageBase64 !== undefined
          ? { sourceImageBase64: args.sourceImageBase64 }
          : {}),
        ...(args.sourceImageMimeType !== undefined
          ? { sourceImageMimeType: args.sourceImageMimeType }
          : {}),
      },
      { retry: { maxAttempts: 3, initialBackoffMs: 2_000, base: 2 } },
    );

    // Read back the artifact HTML for the decompose step (kept in artifacts table)
    const artifact = await step.runQuery(
      internal.artifacts.getLatestInternal,
      { runId: args.runId },
      { inline: true },
    );
    if (artifact === null) {
      // generateInitial should have appended; treat as terminal failure
      await step.runMutation(
        internal.runs.updateStatus,
        {
          runId: args.runId,
          status: 'failed',
          errorMessage: 'no artifact produced after generate stage',
        },
        { inline: true },
      );
      return;
    }

    // Stage 2: decompose the artifact into a ui_kit/<slug>/ bundle
    await step.runAction(
      internal.generation.decompose,
      {
        runId: args.runId,
        artifactVersion: generateResult.version,
        artifactHtml: artifact.html,
      },
      { retry: { maxAttempts: 3, initialBackoffMs: 2_000, base: 2 } },
    );

    // Read back the freshly-saved ui_kit so we can hand its id to the verifier
    const uiKit = await step.runQuery(
      internal.uiKits.getLatestInternal,
      { runId: args.runId },
      { inline: true },
    );
    if (uiKit === null) {
      await step.runMutation(
        internal.runs.updateStatus,
        {
          runId: args.runId,
          status: 'failed',
          errorMessage: 'decompose produced no ui_kit',
        },
        { inline: true },
      );
      return;
    }

    // Stage 3: deterministic verifier (no LLM, no cost). Visual verifier is
    // out of scope for the workflow because Playwright doesn't run in Convex
    // actions — it's available via the MCP server's runVisualJudge instead.
    await step.runAction(
      internal.generation.verifyDeterministic,
      {
        runId: args.runId,
        uiKitId: uiKit._id,
        iterationNumber: 0,
        sourceHtml: artifact.html,
      },
      { retry: { maxAttempts: 2, initialBackoffMs: 500, base: 2 } },
    );

    // Stage 4: mark done
    await step.runMutation(
      internal.runs.updateStatus,
      {
        runId: args.runId,
        status: 'done',
        iterationsCompleted: 0,
      },
      { inline: true },
    );
  },
});
