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

/**
 * User-triggered iterate using open comments as gap feedback. Fires from the
 * "Iterate now" button after the user reviews a finished run and drops
 * comments on regions they want changed. One iteration per click — no
 * implicit loop here, the user re-clicks if they want another pass.
 */
export const iterateWithCommentsWorkflow = workflow.define({
  args: { runId: v.id('runs') },
  handler: async (step, { runId }): Promise<void> => {
    // Hydrate state needed for iterate
    const artifact = await step.runQuery(
      internal.artifacts.getLatestInternal,
      { runId },
      { inline: true },
    );
    const previousUiKit = await step.runQuery(
      internal.uiKits.getLatestInternal,
      { runId },
      { inline: true },
    );
    const openComments = await step.runQuery(
      internal.comments.listOpenInternal,
      { runId },
      { inline: true },
    );
    const previousReport = await step.runQuery(
      internal.parityReports.getLatestInternal,
      { runId },
      { inline: true },
    );

    if (artifact === null || previousUiKit === null) {
      await step.runMutation(
        internal.runs.updateStatus,
        {
          runId,
          status: 'failed',
          errorMessage: 'iterateWithComments: missing artifact or previous ui_kit',
        },
        { inline: true },
      );
      return;
    }

    // Fold comments into the gap feedback list. Each comment becomes a
    // high-severity 'comment' kind so the iterate prompt prioritizes them
    // alongside any verifier-flagged gaps from the previous parity report.
    const commentGaps = openComments.map((c, i) => ({
      kind: 'comment',
      severity: 'high',
      message: `[user comment ${i + 1}${
        c.bbox
          ? ` @ bbox(${c.bbox.x.toFixed(2)},${c.bbox.y.toFixed(2)} ${c.bbox.w.toFixed(2)}x${c.bbox.h.toFixed(2)})`
          : ''
      }] ${c.text}`,
    }));
    const verifierGaps = (previousReport?.gaps as Array<{ kind?: string; severity?: string; message?: string }>) ?? [];
    const allGaps = [...commentGaps, ...verifierGaps];

    const iterationNumber = (previousReport?.iterationNumber ?? 0) + 1;

    await step.runAction(
      internal.generation.iterate,
      {
        runId,
        iterationNumber,
        sourceHtml: artifact.html,
        previousUiKitFiles: previousUiKit.files,
        failedGaps: allGaps,
      },
      { retry: { maxAttempts: 2, initialBackoffMs: 2_000, base: 2 } },
    );

    // Pick up the new ui_kit + verify
    const nextUiKit = await step.runQuery(
      internal.uiKits.getLatestInternal,
      { runId },
      { inline: true },
    );
    if (nextUiKit !== null) {
      await step.runAction(
        internal.generation.verifyDeterministic,
        {
          runId,
          uiKitId: nextUiKit._id,
          iterationNumber,
          sourceHtml: artifact.html,
        },
        { retry: { maxAttempts: 2, initialBackoffMs: 500, base: 2 } },
      );
    }

    // Mark the comments addressed (only if the iterate didn't crash)
    await step.runMutation(
      internal.comments.markAddressedInternal,
      { runId },
      { inline: true },
    );

    await step.runMutation(
      internal.runs.updateStatus,
      { runId, status: 'done', iterationsCompleted: iterationNumber },
      { inline: true },
    );
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

    // Stage 3: deterministic verify -> iterate loop. Bounded by MAX_ITERATIONS
    // so we never infinite-loop. Each iterate adds ~1 LLM call cost; the
    // workflow journals every step so a mid-loop crash resumes cleanly.
    const MAX_ITERATIONS = 2;
    let iterationNumber = 0;
    let currentUiKitId = uiKit._id;
    let currentUiKitFiles = uiKit.files as Record<string, string>;

    while (true) {
      // Verify the current ui_kit deterministically (no LLM cost)
      await step.runAction(
        internal.generation.verifyDeterministic,
        {
          runId: args.runId,
          uiKitId: currentUiKitId,
          iterationNumber,
          sourceHtml: artifact.html,
        },
        { retry: { maxAttempts: 2, initialBackoffMs: 500, base: 2 } },
      );

      // Read back the parity report this iteration produced
      const report = await step.runQuery(
        internal.parityReports.getLatestInternal,
        { runId: args.runId },
        { inline: true },
      );

      const status = report?.status ?? 'unavailable';
      const shouldIterate =
        status === 'needs_iteration' && iterationNumber < MAX_ITERATIONS;

      if (!shouldIterate) {
        // Either parity is good enough, OR we've hit the iteration cap.
        // Either way, finalize the run honestly with the iteration count
        // that was actually completed.
        await step.runMutation(
          internal.runs.updateStatus,
          {
            runId: args.runId,
            status: status === 'failed' ? 'failed' : 'done',
            iterationsCompleted: iterationNumber,
          },
          { inline: true },
        );
        return;
      }

      // Iterate: re-decompose the same artifact with the failed gaps as
      // explicit feedback. Produces a new ui_kit row (next artifactVersion)
      // so the next loop reads it as the latest.
      iterationNumber += 1;
      await step.runAction(
        internal.generation.iterate,
        {
          runId: args.runId,
          iterationNumber,
          sourceHtml: artifact.html,
          previousUiKitFiles: currentUiKitFiles,
          failedGaps: report?.gaps ?? [],
        },
        { retry: { maxAttempts: 2, initialBackoffMs: 2_000, base: 2 } },
      );

      // Pick up the new ui_kit for the next verify pass
      const nextUiKit = await step.runQuery(
        internal.uiKits.getLatestInternal,
        { runId: args.runId },
        { inline: true },
      );
      if (nextUiKit === null) {
        // iterate should have written one — treat as terminal failure
        await step.runMutation(
          internal.runs.updateStatus,
          {
            runId: args.runId,
            status: 'failed',
            errorMessage: 'iterate produced no ui_kit',
            iterationsCompleted: iterationNumber - 1,
          },
          { inline: true },
        );
        return;
      }
      currentUiKitId = nextUiKit._id;
      currentUiKitFiles = nextUiKit.files as Record<string, string>;
    }
  },
});
