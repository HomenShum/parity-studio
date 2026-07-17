import { v } from 'convex/values';
import { internal } from './_generated/api';
import {
  nodeslideCreateJobRequestValidator,
  nodeslideEditProposalJobRequestValidator,
} from './lib/nodeslideJobValidators';
import { workflow } from './workflows';

// Generated Convex references form a cycle between the job start mutation,
// workflow, and workflow steps. Runtime arguments remain validator-checked.
// biome-ignore lint/suspicious/noExplicitAny: generated Convex self-reference boundary
const jobsInternal: any = (internal as any).nodeslideJobs;
// biome-ignore lint/suspicious/noExplicitAny: generated Convex self-reference boundary
const jobRunnerInternal: any = (internal as any).nodeslideJobRunner;
// biome-ignore lint/suspicious/noExplicitAny: generated Convex self-reference boundary
const jobControlInternal: any = (internal as any).nodeslideJobControl;

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
        phase: 'planning',
        progress: 5,
      },
      { inline: true, name: 'checkpoint-planning' },
    );

    const beforeCreate = (await step.runMutation(
      jobControlInternal.heartbeatInternal,
      { jobId: args.jobId },
      { inline: true, name: 'gate-create-deck' },
    )) as { shouldRun: boolean };
    if (!beforeCreate.shouldRun) return;

    const result = (await step.runAction(jobRunnerInternal.executeCreateDeckInternal, args, {
      name: 'execute-create-deck',
      retry: { maxAttempts: 3, initialBackoffMs: 1_000, base: 2 },
    })) as {
      deckId: string;
      conversationRunId: string;
      memoryIds: string[];
      memoryDigests: string[];
    };

    const afterCreate = (await step.runMutation(
      jobControlInternal.heartbeatInternal,
      { jobId: args.jobId },
      { inline: true, name: 'heartbeat-create-deck-result' },
    )) as { shouldRun: boolean };
    if (!afterCreate.shouldRun) return;

    await step.runMutation(
      jobsInternal.completeCreateDeckInternal,
      {
        jobId: args.jobId,
        resultDeckId: result.deckId,
        conversationRunId: result.conversationRunId,
        memoryIds: result.memoryIds,
        memoryDigests: result.memoryDigests,
      },
      { inline: true, name: 'complete-create-deck' },
    );
  },
});

export const editProposalJobWorkflow = workflow.define({
  args: {
    jobId: v.string(),
    ownerAccessKey: v.string(),
    executionAccessKey: v.string(),
    request: nodeslideEditProposalJobRequestValidator,
  },
  handler: async (step, args): Promise<void> => {
    await step.runMutation(
      jobsInternal.checkpointInternal,
      {
        jobId: args.jobId,
        phase: 'planning',
        progress: 5,
      },
      { inline: true, name: 'checkpoint-edit-planning' },
    );

    const beforeEdit = (await step.runMutation(
      jobControlInternal.heartbeatInternal,
      { jobId: args.jobId },
      { inline: true, name: 'gate-edit-proposal' },
    )) as { shouldRun: boolean };
    if (!beforeEdit.shouldRun) return;

    const result = (await step.runAction(jobRunnerInternal.executeEditProposalInternal, args, {
      name: 'execute-edit-proposal',
      retry: { maxAttempts: 3, initialBackoffMs: 1_000, base: 2 },
    })) as {
      deckId: string;
      patchId: string;
      candidateDigest: string;
      conversationRunId: string;
      memoryIds: string[];
      memoryDigests: string[];
    };

    const afterEdit = (await step.runMutation(
      jobControlInternal.heartbeatInternal,
      { jobId: args.jobId },
      { inline: true, name: 'heartbeat-edit-proposal-result' },
    )) as { shouldRun: boolean };
    if (!afterEdit.shouldRun) return;

    await step.runMutation(
      jobsInternal.completeEditProposalInternal,
      {
        jobId: args.jobId,
        resultDeckId: result.deckId,
        resultPatchId: result.patchId,
        resultCandidateDigest: result.candidateDigest,
        conversationRunId: result.conversationRunId,
        memoryIds: result.memoryIds,
        memoryDigests: result.memoryDigests,
      },
      { inline: true, name: 'complete-edit-proposal' },
    );
  },
});
