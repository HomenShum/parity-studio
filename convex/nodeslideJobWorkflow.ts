import { v } from 'convex/values';
import { internal } from './_generated/api';
import { nodeslideCreateJobRequestValidator } from './lib/nodeslideJobValidators';
import { workflow } from './workflows';

// Generated Convex references form a cycle between the job start mutation,
// workflow, and workflow steps. Runtime arguments remain validator-checked.
// biome-ignore lint/suspicious/noExplicitAny: generated Convex self-reference boundary
const jobsInternal: any = (internal as any).nodeslideJobs;
// biome-ignore lint/suspicious/noExplicitAny: generated Convex self-reference boundary
const jobRunnerInternal: any = (internal as any).nodeslideJobRunner;

export const createDeckJobWorkflow = workflow.define({
  args: {
    jobId: v.string(),
    ownerAccessKey: v.string(),
    executionAccessKey: v.string(),
    request: nodeslideCreateJobRequestValidator,
  },
  handler: async (step, args): Promise<void> => {
    await step.runMutation(
      jobsInternal.checkpointInternal,
      {
        jobId: args.jobId,
        status: 'running',
        phase: 'planning',
        progress: 5,
      },
      { inline: true, name: 'checkpoint-planning' },
    );

    const result = (await step.runAction(jobRunnerInternal.executeCreateDeckInternal, args, {
      name: 'execute-create-deck',
      retry: { maxAttempts: 3, initialBackoffMs: 1_000, base: 2 },
    })) as { deckId: string; conversationRunId: string; memoryIds: string[] };

    await step.runMutation(
      jobsInternal.completeCreateDeckInternal,
      {
        jobId: args.jobId,
        resultDeckId: result.deckId,
        conversationRunId: result.conversationRunId,
        memoryIds: result.memoryIds,
      },
      { inline: true, name: 'complete-create-deck' },
    );
  },
});
