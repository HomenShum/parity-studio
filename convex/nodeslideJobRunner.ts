'use node';

import { v } from 'convex/values';
import { api, internal } from './_generated/api';
import { internalAction } from './_generated/server';
import { nodeslideStableId } from './lib/nodeslideIds';
import { nodeslideCreateJobRequestValidator } from './lib/nodeslideJobValidators';

// Generated Convex references form a deliberate action -> mutation/action
// boundary. All values still cross explicit validators.
// biome-ignore lint/suspicious/noExplicitAny: generated Convex self-reference boundary
const jobsInternal: any = (internal as any).nodeslideJobs;
// biome-ignore lint/suspicious/noExplicitAny: generated Convex action reference boundary
const nodeslideAgentPublic: any = (api as any).nodeslideAgent;
// biome-ignore lint/suspicious/noExplicitAny: generated Convex action reference boundary
const nodeslideInternal: any = (internal as any).nodeslide;

export const executeCreateDeckInternal = internalAction({
  args: {
    jobId: v.string(),
    ownerAccessKey: v.string(),
    executionAccessKey: v.string(),
    request: nodeslideCreateJobRequestValidator,
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ deckId: string; conversationRunId: string; memoryIds: string[] }> => {
    const claimed = (await ctx.runMutation(jobsInternal.claimAttemptInternal, {
      jobId: args.jobId,
    })) as {
      status: string;
      progress: number;
      resultDeckId?: string;
    };
    if (claimed.status === 'cancelled') throw new Error('NodeSlide job was cancelled.');
    await ctx.runMutation(jobsInternal.checkpointInternal, {
      jobId: args.jobId,
      status: 'running',
      phase: 'generating',
      progress: Math.max(claimed.progress, 35),
    });
    const deckId = nodeslideStableId('deck_job', args.jobId);
    const projectId = nodeslideStableId('project_nodeslide_job', args.jobId);
    let resultDeckId = claimed.resultDeckId;
    if (!resultDeckId) {
      const result = (await ctx.runAction(nodeslideAgentPublic.createDeckFromBrief, {
        ...args.request,
        durableJob: {
          jobId: args.jobId,
          deckId,
          projectId,
          ownerAccessKey: args.ownerAccessKey,
          executionAccessKey: args.executionAccessKey,
        },
      })) as { deck: { id: string } };
      resultDeckId = result.deck.id;
    }
    if (resultDeckId !== deckId) {
      throw new Error('NodeSlide job recovered an invalid deck output binding.');
    }

    await ctx.runMutation(jobsInternal.checkpointInternal, {
      jobId: args.jobId,
      status: 'running',
      phase: 'persisting',
      progress: 90,
      resultDeckId,
    });

    const runStart = (await ctx.runMutation(nodeslideInternal.beginAgentRunInternal, {
      deckId: resultDeckId,
      ownerAccessKey: args.ownerAccessKey,
      idempotencyKey: `job:${args.jobId}`,
      instruction: args.request.brief.prompt,
      provider: args.request.providerMode ?? 'deterministic',
      model: args.request.providerModel ?? 'brief-to-deck/v1',
      webResearch: false,
    })) as {
      created: boolean;
      run: { id: string; status: string; memoryIds?: string[] };
    };
    if (
      runStart.created ||
      (runStart.run.status !== 'completed' && runStart.run.status !== 'cancelled')
    ) {
      await ctx.runMutation(nodeslideInternal.advanceAgentRunInternal, {
        deckId: resultDeckId,
        ownerAccessKey: args.ownerAccessKey,
        runId: runStart.run.id,
        status: 'completed',
        role: 'assistant',
        message: 'Created and validated the editable deck. No mutation bypassed review authority.',
      });
    }
    const memoryIds = Array.isArray(runStart.run.memoryIds)
      ? runStart.run.memoryIds.slice(0, 6)
      : [];
    await ctx.runMutation(jobsInternal.checkpointInternal, {
      jobId: args.jobId,
      status: 'running',
      phase: 'validating',
      progress: 95,
      resultDeckId,
      conversationRunId: runStart.run.id,
      memoryIds,
    });
    return {
      deckId: resultDeckId,
      conversationRunId: runStart.run.id,
      memoryIds,
    };
  },
});
