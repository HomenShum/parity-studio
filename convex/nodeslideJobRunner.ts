'use node';

import { v } from 'convex/values';
import type { DeckSnapshot } from '../shared/nodeslide';
import { api, internal } from './_generated/api';
import { internalAction } from './_generated/server';
import { nodeSlideCreationTraceId } from './lib/nodeslideCreationTelemetry';
import { nodeslideStableId } from './lib/nodeslideIds';
import {
  nodeslideCreateJobRequestValidator,
  nodeslideEditProposalJobRequestValidator,
} from './lib/nodeslideJobValidators';
import { runNodeSlideLiveRenderRepair } from './lib/nodeslideLiveRenderRepair';

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
  ): Promise<{
    deckId: string;
    conversationRunId: string;
    memoryIds: string[];
    memoryDigests: string[];
  }> => {
    const claimed = (await ctx.runMutation(jobsInternal.claimAttemptInternal, {
      jobId: args.jobId,
    })) as {
      status: string;
      progress: number;
      createdAt: number;
      resultDeckId?: string;
    };
    if (claimed.status === 'cancelled') throw new Error('NodeSlide job was cancelled.');
    await ctx.runMutation(jobsInternal.checkpointInternal, {
      jobId: args.jobId,
      status: 'running',
      phase: 'generating',
      progress: Math.max(claimed.progress, 35),
    });
    // D7 enforcement happens at ADMISSION (startCreateDeck): args.request is
    // already the enforced request and the routing receipt on the job records it.
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

    const workspace = (await ctx.runQuery(nodeslideInternal.getAgentContextInternal, {
      deckId: resultDeckId,
      ownerAccessKey: args.ownerAccessKey,
    })) as (DeckSnapshot & { sources?: Array<{ id: string }> }) | null;
    const sourceIds = (workspace?.sources ?? []).map((source) => source.id).slice(0, 32);

    // D1 live render-repair pass: deterministic render -> observe -> repair loop
    // over the just-created deck. Its receipts are evidence on the job; a repair
    // failure degrades honestly and never fails the create itself.
    if (workspace?.deck && workspace.slides && workspace.elements) {
      try {
        const repair = runNodeSlideLiveRenderRepair({
          deck: workspace.deck,
          slides: workspace.slides,
          elements: workspace.elements,
          sources: (workspace.sources ?? []) as DeckSnapshot['sources'],
        });
        await ctx.runMutation(jobsInternal.recordRenderRepairInternal, {
          jobId: args.jobId,
          renderRepair: repair.summary,
          traceId: nodeSlideCreationTraceId(resultDeckId),
        });
      } catch {
        // The create result stands; absence of a renderRepair receipt is the
        // honest signal that the repair pass did not complete.
      }
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
      startedAt: claimed.createdAt,
    })) as {
      created: boolean;
      run: { id: string; status: string; memoryIds?: string[]; memoryDigests?: string[] };
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
        traceId: nodeSlideCreationTraceId(resultDeckId),
        role: 'assistant',
        message: 'Created and validated the editable deck. No mutation bypassed review authority.',
        ...(sourceIds.length > 0 ? { sourceIds } : {}),
      });
    }
    const memoryIds = Array.isArray(runStart.run.memoryIds)
      ? runStart.run.memoryIds.slice(0, 6)
      : [];
    const memoryDigests = Array.isArray(runStart.run.memoryDigests)
      ? runStart.run.memoryDigests.slice(0, 6)
      : [];
    await ctx.runMutation(jobsInternal.checkpointInternal, {
      jobId: args.jobId,
      status: 'running',
      phase: 'validating',
      progress: 95,
      resultDeckId,
      conversationRunId: runStart.run.id,
      memoryIds,
      memoryDigests,
    });
    return {
      deckId: resultDeckId,
      conversationRunId: runStart.run.id,
      memoryIds,
      memoryDigests,
    };
  },
});

export const executeEditProposalInternal = internalAction({
  args: {
    jobId: v.string(),
    ownerAccessKey: v.string(),
    executionAccessKey: v.string(),
    request: nodeslideEditProposalJobRequestValidator,
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    deckId: string;
    patchId: string;
    candidateDigest: string;
    conversationRunId: string;
    memoryIds: string[];
    memoryDigests: string[];
  }> => {
    const claimed = (await ctx.runMutation(jobsInternal.claimAttemptInternal, {
      jobId: args.jobId,
    })) as {
      status: string;
      progress: number;
      resultDeckId?: string;
      resultPatchId?: string;
      resultCandidateDigest?: string;
      conversationRunId?: string;
      memoryIds?: string[];
      memoryDigests?: string[];
    };
    if (claimed.status === 'cancelled') throw new Error('NodeSlide job was cancelled.');
    if (
      claimed.status === 'awaiting_review' &&
      claimed.resultDeckId === args.request.deckId &&
      claimed.resultPatchId &&
      claimed.resultCandidateDigest &&
      claimed.conversationRunId
    ) {
      return {
        deckId: claimed.resultDeckId,
        patchId: claimed.resultPatchId,
        candidateDigest: claimed.resultCandidateDigest,
        conversationRunId: claimed.conversationRunId,
        memoryIds: claimed.memoryIds ?? [],
        memoryDigests: claimed.memoryDigests ?? [],
      };
    }
    await ctx.runMutation(jobsInternal.checkpointInternal, {
      jobId: args.jobId,
      status: 'running',
      phase: 'generating',
      progress: Math.max(claimed.progress, 35),
    });
    const result = (await ctx.runAction(nodeslideAgentPublic.proposeEdit, {
      ...args.request,
      ownerAccessKey: args.ownerAccessKey,
      idempotencyKey: `job:${args.jobId}`,
      durableJob: {
        jobId: args.jobId,
        ownerAccessKey: args.ownerAccessKey,
        executionAccessKey: args.executionAccessKey,
      },
    })) as {
      patch: { id: string; deckId: string; status: string; candidateDigest?: string };
      conversationRunId: string;
      memoryIds?: string[];
      memoryDigests?: string[];
    };
    if (
      result.patch.deckId !== args.request.deckId ||
      result.patch.status !== 'ready' ||
      !result.patch.candidateDigest
    ) {
      throw new Error(
        'NodeSlide job produced no reviewable candidate bound to the requested deck.',
      );
    }
    await ctx.runMutation(jobsInternal.checkpointInternal, {
      jobId: args.jobId,
      // Publish the review receipt at the same durable boundary that binds the
      // validated patch. Workflow bookkeeping may finish afterward, but it must
      // never strand an already-persisted proposal behind a `running` receipt.
      status: 'awaiting_review',
      phase: 'awaiting_review',
      progress: 100,
      resultDeckId: result.patch.deckId,
      resultPatchId: result.patch.id,
      resultCandidateDigest: result.patch.candidateDigest,
      conversationRunId: result.conversationRunId,
      ...(result.memoryIds ? { memoryIds: result.memoryIds } : {}),
      ...(result.memoryDigests ? { memoryDigests: result.memoryDigests } : {}),
    });
    return {
      deckId: result.patch.deckId,
      patchId: result.patch.id,
      candidateDigest: result.patch.candidateDigest,
      conversationRunId: result.conversationRunId,
      memoryIds: result.memoryIds ?? [],
      memoryDigests: result.memoryDigests ?? [],
    };
  },
});
