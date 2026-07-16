import { PersistentTextStreaming, type StreamId } from '@convex-dev/persistent-text-streaming';
import type { WorkflowId } from '@convex-dev/workflow';
import { v } from 'convex/values';
import { NODESLIDE_WEB_RESEARCH_CONSENT } from '../shared/nodeslide';
import {
  type NodeSlideCapabilityMaterial,
  type NodeSlideDurableJobStatus,
  createNodeSlideCapabilityDigestMetadata,
} from '../shared/nodeslideDurableSession';
import { components, internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { createOwnerAccessKey, isOwnerAccessKey } from './lib/nodeslideAccess';
import { nodeSlideActorQuotaKey } from './lib/nodeslideAuthority';
import { nodeslideContentDigest, nodeslideStableId } from './lib/nodeslideIds';
import {
  NODESLIDE_JOB_MAX_ATTEMPTS,
  NODESLIDE_JOB_PHASES,
  NODESLIDE_JOB_STATUSES,
  type NodeSlideJobRecord,
  advanceNodeSlideJob,
  assertNodeSlideJobCheckpointKind,
  assertNodeSlideJobCompletionKind,
  assertNodeSlideJobIdempotency,
  cancelNodeSlideJob,
  claimNodeSlideJobAttempt,
  failNodeSlideJob,
  nodeSlideJobExecutionDigest,
  nodeSlideJobOwnerDigest,
  nodeSlideJobProgressLine,
  nodeSlideJobRequestDigest,
  publicNodeSlideJob,
  resolveNodeSlideReviewJob,
  retryNodeSlideJob,
} from './lib/nodeslideJobState';
import {
  type NodeSlideEditProposalJobRequest,
  nodeSlideCreateJobRequestFromArgs,
  nodeSlideEditProposalJobRequestFromArgs,
  nodeslideCreateJobRequestFields,
  nodeslideEditProposalJobRequestFields,
} from './lib/nodeslideJobValidators';
import {
  NodeSlideProviderConsentError,
  validateNodeSlideProviderChoice,
} from './lib/nodeslideProviderConsent';
import { NodeSlidePreviewQuotaError, consumePreviewQuotaBuckets } from './lib/nodeslideQuota';
import {
  nodeslideCreatePublicError,
  validateNodeSlideBriefAttachments,
  validateNodeSlideBriefProviderChoice,
  validateNodeSlideCreateDeckFields,
  validateNodeSlidePreviewAdmission,
} from './lib/nodeslideValidators';
import { workflow } from './workflows';

const streaming = new PersistentTextStreaming(components.persistentTextStreaming);
const jobStatusValidator = v.union(...NODESLIDE_JOB_STATUSES.map((status) => v.literal(status)));
const jobPhaseValidator = v.union(...NODESLIDE_JOB_PHASES.map((phase) => v.literal(phase)));
const workflowResultValidator = v.union(
  v.object({ kind: v.literal('success'), returnValue: v.any() }),
  v.object({ kind: v.literal('failed'), error: v.string() }),
  v.object({ kind: v.literal('canceled') }),
);

// The job module starts its workflow and the worker calls back into this module.
// Keep generated-reference escape hatches local to that cycle.
// biome-ignore lint/suspicious/noExplicitAny: generated Convex self-reference boundary
const jobsInternal: any = (internal as any).nodeslideJobs;
// biome-ignore lint/suspicious/noExplicitAny: generated NodeSlide authorization boundary
const nodeslideInternal: any = (internal as any).nodeslide;
// biome-ignore lint/suspicious/noExplicitAny: generated Convex workflow reference boundary
const jobWorkflowInternal: any = (internal as any).nodeslideJobWorkflow;
// biome-ignore lint/suspicious/noExplicitAny: generated durable-session mutation cycle
const nodeslideSessionsInternal: any = (internal as any).nodeslideSessions;
// biome-ignore lint/suspicious/noExplicitAny: generated durable-budget mutation cycle
const nodeslideBudgetsInternal: any = (internal as any).nodeslideBudgets;
const NODESLIDE_PREVIEW_ACCESS_CODE_ENV = 'NODESLIDE_PREVIEW_ACCESS_CODE';
const NODESLIDE_PREVIEW_ADMISSION_SUBJECT_ENV = 'NODESLIDE_PREVIEW_ADMISSION_SUBJECT';
const NODESLIDE_PUBLIC_CREATION_ENV = 'NODESLIDE_PUBLIC_CREATION';
const NODESLIDE_DURABLE_SESSION_LEASE_MS = 3_900_000;

export const startCreateDeck = mutation({
  args: {
    ...nodeslideCreateJobRequestFields,
    ownerAccessKey: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerAccessKey = requiredOwnerAccessKey(args.ownerAccessKey);
    const clientSessionId = requiredText(args.clientSessionId, 'clientSessionId', 256);
    const idempotencyKey = requiredText(args.idempotencyKey, 'idempotencyKey', 160);
    const request = nodeSlideCreateJobRequestFromArgs(args);
    const requestDigest = nodeSlideJobRequestDigest(request);
    const ownerDigest = nodeSlideJobOwnerDigest(ownerAccessKey);
    const existing = await ctx.db
      .query('nodeslide_agent_jobs')
      .withIndex('by_session_idempotency', (queryBuilder) =>
        queryBuilder.eq('clientSessionId', clientSessionId).eq('idempotencyKey', idempotencyKey),
      )
      .unique();
    if (existing) {
      assertNodeSlideJobIdempotency(jobFromRow(existing), requestDigest, ownerDigest);
      return publicNodeSlideJob(jobFromRow(existing));
    }

    if (args.route !== 'free') {
      throw nodeslideCreatePublicError(
        'invalid_request',
        'Only the free private-preview route is available in this release.',
      );
    }
    validateNodeSlideBriefProviderChoice(
      args.providerMode,
      args.providerConsent,
      args.providerModel,
      args.providerEffort,
    );
    validateNodeSlideCreateDeckFields({ title: args.title, brief: args.brief });
    validateNodeSlideBriefAttachments(args.attachments);
    validateCreateThemeId(args.themeId);

    const publicCreationEnabled =
      process.env[NODESLIDE_PUBLIC_CREATION_ENV]?.trim().toLowerCase() === 'true';
    const admissionQuotaSubject = publicCreationEnabled
      ? 'public-launch-v1'
      : await validateNodeSlidePreviewAdmission({
          providedAccessCode: args.accessCode,
          expectedAccessCode: process.env[NODESLIDE_PREVIEW_ACCESS_CODE_ENV],
          admissionSubject: process.env[NODESLIDE_PREVIEW_ADMISSION_SUBJECT_ENV],
        });
    const previewSessionQuotaSubject = nodeslideContentDigest(
      `${admissionQuotaSubject}:${clientSessionId}`,
    ).slice('sha256:'.length);
    try {
      await consumePreviewQuotaBuckets(ctx, [
        {
          key: `create:${previewSessionQuotaSubject}`,
          limit: 10,
          windowMs: 86_400_000,
        },
        { key: 'create:global', limit: 120, windowMs: 3_600_000 },
      ]);
    } catch (error) {
      if (error instanceof NodeSlidePreviewQuotaError) {
        throw nodeslideCreatePublicError(
          'quota_exceeded',
          'NodeSlide creation quota reached. Try again after the current window.',
        );
      }
      throw error;
    }

    const now = Date.now();
    const executionAccessKey = createOwnerAccessKey();
    const jobId = nodeslideStableId(
      'nodeslide_job',
      'create_deck',
      clientSessionId,
      idempotencyKey,
    );
    const budgetId = nodeslideStableId('nsbudget', jobId);
    await enqueueNodeSlideDurableSession(ctx, {
      jobId,
      request,
      capability: {
        provider: request.providerMode ?? 'deterministic',
        ...(request.providerModel ? { model: request.providerModel } : {}),
        scopes: ['create_deck'],
        egress: request.providerMode && request.providerMode !== 'deterministic' ? 'model' : 'none',
        secret: `${ownerAccessKey}\u001f${executionAccessKey}`,
        ...(request.providerConsent
          ? { consent: { providerConsent: request.providerConsent } }
          : {}),
        ...(request.attachments?.length ? { attachments: request.attachments } : {}),
      },
    });
    const streamId = await streaming.createStream(ctx);
    const rowId = await ctx.db.insert('nodeslide_agent_jobs', {
      id: jobId,
      kind: 'create_deck',
      clientSessionId,
      admissionQuotaSubject,
      ownerDigest,
      executionDigest: nodeSlideJobExecutionDigest(executionAccessKey),
      idempotencyKey,
      requestDigest,
      status: 'queued',
      phase: 'queued',
      progress: 0,
      attempt: 0,
      maxAttempts: NODESLIDE_JOB_MAX_ATTEMPTS,
      streamId,
      memoryIds: [],
      ...(request.providerMode && request.providerMode !== 'deterministic' ? { budgetId } : {}),
      createdAt: now,
      updatedAt: now,
    });
    const workflowId = await workflow.start(
      ctx,
      jobWorkflowInternal.createDeckJobWorkflow,
      { jobId, ownerAccessKey, executionAccessKey, request },
      {
        onComplete: jobsInternal.onWorkflowComplete,
        context: { jobId },
        startAsync: true,
      },
    );
    await ctx.db.patch(rowId, { workflowId: workflowId.toString() });
    const created = await ctx.db.get(rowId);
    if (!created) throw new Error('NodeSlide job was not persisted.');
    await appendProgress(ctx, jobFromRow(created), false);
    return publicNodeSlideJob(jobFromRow(created));
  },
});

export const startEditProposal = mutation({
  args: {
    ...nodeslideEditProposalJobRequestFields,
    ownerAccessKey: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerAccessKey = requiredOwnerAccessKey(args.ownerAccessKey);
    const clientSessionId = requiredText(args.clientSessionId, 'clientSessionId', 256);
    const idempotencyKey = requiredText(args.idempotencyKey, 'idempotencyKey', 160);
    const request = nodeSlideEditProposalJobRequestFromArgs(args);
    validateEditProposalRequest(request);
    const requestDigest = nodeSlideJobRequestDigest(request);
    const ownerDigest = nodeSlideJobOwnerDigest(ownerAccessKey);
    const existing = await ctx.db
      .query('nodeslide_agent_jobs')
      .withIndex('by_session_idempotency', (queryBuilder) =>
        queryBuilder.eq('clientSessionId', clientSessionId).eq('idempotencyKey', idempotencyKey),
      )
      .unique();
    if (existing) {
      assertNodeSlideJobIdempotency(jobFromRow(existing), requestDigest, ownerDigest);
      return publicNodeSlideJob(jobFromRow(existing));
    }

    const workspace = await ctx.runQuery(nodeslideInternal.getAgentContextInternal, {
      deckId: request.deckId,
      ownerAccessKey,
    });
    if (!workspace) throw new Error(`Deck ${request.deckId} not found.`);

    try {
      await consumePreviewQuotaBuckets(ctx, [
        {
          key: nodeSlideActorQuotaKey('edit', ownerAccessKey),
          limit: 60,
          windowMs: 86_400_000,
        },
        { key: 'edit:global', limit: 500, windowMs: 3_600_000 },
      ]);
    } catch (error) {
      if (error instanceof NodeSlidePreviewQuotaError) {
        throw new Error('NodeSlide edit quota reached. Try again after the current window.');
      }
      throw error;
    }

    const now = Date.now();
    const executionAccessKey = createOwnerAccessKey();
    const jobId = nodeslideStableId(
      'nodeslide_job',
      'edit_proposal',
      clientSessionId,
      idempotencyKey,
    );
    const budgetId = nodeslideStableId('nsbudget', jobId);
    await enqueueNodeSlideDurableSession(ctx, {
      jobId,
      request,
      capability: {
        provider: request.providerMode ?? 'deterministic',
        ...(request.providerModel ? { model: request.providerModel } : {}),
        scopes: ['edit_proposal', `write:${nodeSlideJobRequestDigest(request.scope)}`],
        egress: nodeSlideJobEgress(request),
        secret: `${ownerAccessKey}\u001f${executionAccessKey}`,
        ...(request.providerConsent || request.webResearchConsent
          ? {
              consent: {
                ...(request.providerConsent ? { providerConsent: request.providerConsent } : {}),
                ...(request.webResearchConsent
                  ? { webResearchConsent: request.webResearchConsent }
                  : {}),
              },
            }
          : {}),
      },
    });
    const streamId = await streaming.createStream(ctx);
    const rowId = await ctx.db.insert('nodeslide_agent_jobs', {
      id: jobId,
      kind: 'edit_proposal',
      clientSessionId,
      admissionQuotaSubject: nodeSlideActorQuotaKey('edit', ownerAccessKey),
      ownerDigest,
      executionDigest: nodeSlideJobExecutionDigest(executionAccessKey),
      idempotencyKey,
      requestDigest,
      status: 'queued',
      phase: 'queued',
      progress: 0,
      attempt: 0,
      maxAttempts: NODESLIDE_JOB_MAX_ATTEMPTS,
      streamId,
      memoryIds: [],
      ...(request.providerMode && request.providerMode !== 'deterministic' ? { budgetId } : {}),
      createdAt: now,
      updatedAt: now,
    });
    const workflowId = await workflow.start(
      ctx,
      jobWorkflowInternal.editProposalJobWorkflow,
      { jobId, ownerAccessKey, executionAccessKey, request },
      {
        onComplete: jobsInternal.onWorkflowComplete,
        context: { jobId },
        startAsync: true,
      },
    );
    await ctx.db.patch(rowId, { workflowId: workflowId.toString() });
    const created = await ctx.db.get(rowId);
    if (!created) throw new Error('NodeSlide job was not persisted.');
    await appendProgress(ctx, jobFromRow(created), false);
    return publicNodeSlideJob(jobFromRow(created));
  },
});

export const get = query({
  args: { jobId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args) => {
    const row = await findAuthorizedJob(ctx, args.jobId, args.ownerAccessKey);
    return row ? publicNodeSlideJob(jobFromRow(row)) : null;
  },
});

/** Owner-authorized, secret-free accounting proof for hard-budget QA and trace hydration. */
export const getBudgetReceipt = query({
  args: { jobId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args) => {
    const job = await findAuthorizedJob(ctx, args.jobId, args.ownerAccessKey);
    if (!job?.budgetId) return null;
    const budget = await ctx.db
      .query('nodeslide_run_budgets')
      .withIndex('by_stable_id', (queryBuilder) => queryBuilder.eq('id', job.budgetId as string))
      .unique();
    if (!budget) return null;
    const [calls, events] = await Promise.all([
      ctx.db
        .query('nodeslide_billable_calls')
        .withIndex('by_budget_status', (queryBuilder) => queryBuilder.eq('budgetId', budget.id))
        .take(64),
      ctx.db
        .query('nodeslide_budget_events')
        .withIndex('by_budget_sequence', (queryBuilder) => queryBuilder.eq('budgetId', budget.id))
        .order('asc')
        .take(128),
    ]);
    return {
      budgetId: budget.id,
      status: budget.status,
      enforcement: budget.budget.enforcement,
      cap: {
        maxCostMicroUsd: budget.budget.maxCostMicroUsd,
        maxInputTokens: budget.budget.maxInputTokens,
        maxOutputTokens: budget.budget.maxOutputTokens,
        maxDurationMs: budget.budget.maxDurationMs,
        maxIterations: budget.budget.maxIterations,
        maxToolCalls: budget.budget.maxToolCalls,
      },
      spend: {
        actualMicroUsd: budget.actualMicroUsd,
        reservedMicroUsd: budget.reservedMicroUsd,
        unreconciledMicroUsd: budget.unreconciledMicroUsd,
      },
      accumulated: budget.accumulated,
      revision: budget.revision,
      stateDigest: budget.stateDigest,
      calls: calls.map((call) => ({
        callId: call.callId,
        status: call.status,
        model: call.model,
        quoteMicroUsd: call.quoteMicroUsd,
        ...(call.actualMicroUsd !== undefined ? { actualMicroUsd: call.actualMicroUsd } : {}),
        ...(call.inputTokens !== undefined ? { inputTokens: call.inputTokens } : {}),
        ...(call.outputTokens !== undefined ? { outputTokens: call.outputTokens } : {}),
        providerSafeOutputTokenCeiling: call.providerSafeOutputTokenCeiling,
        providerTimeoutMs: call.providerTimeoutMs,
      })),
      events: events.map((event) => ({
        sequence: event.sequence,
        kind: event.kind,
        status: event.status,
        actualMicroUsd: event.actualMicroUsd,
        reservedMicroUsd: event.reservedMicroUsd,
        unreconciledMicroUsd: event.unreconciledMicroUsd,
        capMicroUsd: event.capMicroUsd,
        eventDigest: event.eventDigest,
        createdAt: event.createdAt,
      })),
    };
  },
});

export const getStream = query({
  args: { jobId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args) => {
    const row = await findAuthorizedJob(ctx, args.jobId, args.ownerAccessKey);
    if (!row) return null;
    return await streaming.getStreamBody(ctx, row.streamId as StreamId);
  },
});

export const authorizeExecutionInternal = internalQuery({
  args: {
    jobId: v.string(),
    kind: v.union(v.literal('create_deck'), v.literal('edit_proposal')),
    ownerAccessKey: v.string(),
    executionAccessKey: v.string(),
    requestDigest: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await findAuthorizedJob(ctx, args.jobId, args.ownerAccessKey);
    if (
      !row ||
      row.kind !== args.kind ||
      (row.status !== 'queued' && row.status !== 'running') ||
      row.executionDigest !== nodeSlideJobExecutionDigest(args.executionAccessKey) ||
      row.requestDigest !== args.requestDigest
    ) {
      throw new Error('Durable NodeSlide job execution is not authorized.');
    }
    return { admissionQuotaSubject: row.admissionQuotaSubject };
  },
});

export const cancel = mutation({
  args: { jobId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args) => {
    const row = await findAuthorizedJob(ctx, args.jobId, args.ownerAccessKey);
    if (!row) return null;
    // Once the deck transaction has committed, cancellation cannot honestly
    // claim that creation was prevented. Let workflow finalization win.
    if (row.kind === 'create_deck' && row.resultDeckId) return publicNodeSlideJob(jobFromRow(row));
    const current = jobFromRow(row);
    const next = cancelNodeSlideJob(current, Date.now());
    if (next === current) return publicNodeSlideJob(current);
    await transitionNodeSlideDurableSession(ctx, {
      jobId: current.id,
      toStatus: 'cancelled',
      reason: 'Cancelled by the user before canonical mutation.',
    });
    await finalizeNodeSlideJobBudgetBestEffort(ctx, current.budgetId);
    if (row.workflowId) {
      await workflow.cancel(ctx, row.workflowId as WorkflowId);
    }
    await patchJob(ctx, row, next);
    await appendProgress(ctx, next, true);
    return publicNodeSlideJob(next);
  },
});

export const retry = mutation({
  args: { jobId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args) => {
    const row = await findAuthorizedJob(ctx, args.jobId, args.ownerAccessKey);
    if (!row) return null;
    if (!row.workflowId) throw new Error('NodeSlide job has no durable workflow to resume.');
    const streamId = await streaming.createStream(ctx);
    const next = { ...retryNodeSlideJob(jobFromRow(row), Date.now()), streamId };
    await retryNodeSlideDurableSession(ctx, next.id);
    await patchJob(ctx, row, next);
    await appendProgress(ctx, next, false);
    await workflow.restart(ctx, row.workflowId as WorkflowId, {
      from: row.kind === 'create_deck' ? 'execute-create-deck' : 'execute-edit-proposal',
      startAsync: true,
    });
    return publicNodeSlideJob(next);
  },
});

export const claimAttemptInternal = internalMutation({
  args: { jobId: v.string() },
  handler: async (ctx, args) => {
    const row = await findJob(ctx, args.jobId);
    if (!row) throw new Error('NodeSlide job not found.');
    const current = jobFromRow(row);
    const next = claimNodeSlideJobAttempt(current, Date.now());
    if (next === current) return publicNodeSlideJob(current);
    await claimNodeSlideDurableSession(ctx, next.id, next.attempt);
    await patchJob(ctx, row, next);
    await appendProgress(ctx, next, false);
    return publicNodeSlideJob(next);
  },
});

export const checkpointInternal = internalMutation({
  args: {
    jobId: v.string(),
    status: v.optional(jobStatusValidator),
    phase: jobPhaseValidator,
    progress: v.number(),
    resultDeckId: v.optional(v.string()),
    resultPatchId: v.optional(v.string()),
    resultCandidateDigest: v.optional(v.string()),
    conversationRunId: v.optional(v.string()),
    memoryIds: v.optional(v.array(v.string())),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await findJob(ctx, args.jobId);
    if (!row) throw new Error('NodeSlide job not found.');
    const current = jobFromRow(row);
    assertNodeSlideJobCheckpointKind(current, args);
    const next = advanceNodeSlideJob(
      current,
      {
        ...(args.status ? { status: args.status } : {}),
        phase: args.phase,
        progress: Math.max(row.progress, args.progress),
        ...(args.resultDeckId ? { resultDeckId: args.resultDeckId } : {}),
        ...(args.resultPatchId ? { resultPatchId: args.resultPatchId } : {}),
        ...(args.resultCandidateDigest
          ? { resultCandidateDigest: args.resultCandidateDigest }
          : {}),
        ...(args.conversationRunId ? { conversationRunId: args.conversationRunId } : {}),
        ...(args.memoryIds ? { memoryIds: args.memoryIds } : {}),
        ...(args.error ? { error: args.error } : {}),
      },
      Date.now(),
    );
    if (next === current) return publicNodeSlideJob(current);
    await patchJob(ctx, row, next);
    await appendProgress(ctx, next, false);
    return publicNodeSlideJob(next);
  },
});

export const completeCreateDeckInternal = internalMutation({
  args: {
    jobId: v.string(),
    resultDeckId: v.string(),
    conversationRunId: v.string(),
    memoryIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const row = await findJob(ctx, args.jobId);
    if (!row) throw new Error('NodeSlide job not found.');
    const current = jobFromRow(row);
    assertNodeSlideJobCompletionKind(current, 'create_deck');
    const next = advanceNodeSlideJob(
      current,
      {
        status: 'succeeded',
        phase: 'complete',
        progress: 100,
        resultDeckId: args.resultDeckId,
        conversationRunId: args.conversationRunId,
        ...(args.memoryIds ? { memoryIds: args.memoryIds } : {}),
      },
      Date.now(),
    );
    if (next === current) return publicNodeSlideJob(current);
    await finalizeNodeSlideJobBudget(ctx, next.budgetId);
    await transitionNodeSlideDurableSession(ctx, {
      jobId: next.id,
      toStatus: 'succeeded',
    });
    await patchJob(ctx, row, next);
    await appendProgress(ctx, next, true);
    return publicNodeSlideJob(next);
  },
});

export const completeEditProposalInternal = internalMutation({
  args: {
    jobId: v.string(),
    resultDeckId: v.string(),
    resultPatchId: v.string(),
    resultCandidateDigest: v.string(),
    conversationRunId: v.string(),
    memoryIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const row = await findJob(ctx, args.jobId);
    if (!row) throw new Error('NodeSlide job not found.');
    const current = jobFromRow(row);
    assertNodeSlideJobCompletionKind(current, 'edit_proposal');
    const next = advanceNodeSlideJob(
      current,
      {
        status: 'awaiting_review',
        phase: 'awaiting_review',
        progress: 100,
        resultDeckId: args.resultDeckId,
        resultPatchId: args.resultPatchId,
        resultCandidateDigest: args.resultCandidateDigest,
        conversationRunId: args.conversationRunId,
        ...(args.memoryIds ? { memoryIds: args.memoryIds } : {}),
      },
      Date.now(),
    );
    if (next === current) return publicNodeSlideJob(current);
    await finalizeNodeSlideJobBudget(ctx, next.budgetId);
    await transitionNodeSlideDurableSession(ctx, {
      jobId: next.id,
      toStatus: 'awaiting_review',
    });
    await patchJob(ctx, row, next);
    await appendProgress(ctx, next, true);
    return publicNodeSlideJob(next);
  },
});

export const resolveReviewInternal = internalMutation({
  args: {
    jobId: v.string(),
    deckId: v.string(),
    patchId: v.string(),
    outcome: v.union(v.literal('accepted'), v.literal('rejected'), v.literal('stale')),
  },
  handler: async (ctx, args) => {
    const row = await findJob(ctx, args.jobId);
    if (!row) throw new Error('Durable NodeSlide review job not found.');
    const current = jobFromRow(row);
    if (
      current.kind !== 'edit_proposal' ||
      current.resultDeckId !== args.deckId ||
      current.resultPatchId !== args.patchId
    ) {
      throw new Error('Durable NodeSlide review bindings do not match this patch.');
    }
    if (
      (current.status === 'succeeded' && args.outcome !== 'accepted') ||
      (current.status === 'rejected' && args.outcome !== 'rejected') ||
      (current.status === 'stale' && args.outcome !== 'stale') ||
      current.status === 'failed' ||
      current.status === 'cancelled'
    ) {
      throw new Error('Durable NodeSlide review outcome conflicts with its terminal job state.');
    }
    const next = resolveNodeSlideReviewJob(current, args.outcome, Date.now());
    if (next === current) return publicNodeSlideJob(current);
    await finalizeNodeSlideJobBudget(ctx, next.budgetId);
    await transitionNodeSlideDurableSession(ctx, {
      jobId: next.id,
      toStatus:
        args.outcome === 'accepted'
          ? 'succeeded'
          : args.outcome === 'rejected'
            ? 'rejected'
            : 'stale',
      ...(next.error ? { reason: next.error } : {}),
    });
    await patchJob(ctx, row, next);
    await appendProgress(ctx, next, true);
    return publicNodeSlideJob(next);
  },
});

export const onWorkflowComplete = internalMutation({
  args: {
    workflowId: v.string(),
    result: workflowResultValidator,
    context: v.object({ jobId: v.string() }),
  },
  handler: async (ctx, args) => {
    const row = await findJob(ctx, args.context.jobId);
    if (!row) return;
    const current = jobFromRow(row);
    if (
      current.status === 'succeeded' ||
      current.status === 'cancelled' ||
      current.status === 'rejected' ||
      current.status === 'stale' ||
      current.status === 'awaiting_review'
    )
      return;
    if (args.result.kind === 'success') return;
    const now = Date.now();
    const next =
      args.result.kind === 'canceled'
        ? cancelNodeSlideJob(current, now)
        : failNodeSlideJob(current, args.result.error, now);
    if (
      args.result.kind === 'canceled' ||
      (args.result.kind === 'failed' && next.attempt >= next.maxAttempts)
    ) {
      await finalizeNodeSlideJobBudgetBestEffort(ctx, next.budgetId);
    }
    await transitionNodeSlideDurableSession(ctx, {
      jobId: next.id,
      toStatus: args.result.kind === 'canceled' ? 'cancelled' : 'failed',
      ...(args.result.kind === 'failed' ? { reason: args.result.error } : {}),
    });
    await patchJob(ctx, row, next);
    await appendProgress(ctx, next, true);
  },
});

function jobFromRow(row: Doc<'nodeslide_agent_jobs'>): NodeSlideJobRecord {
  const { _id: _rowId, _creationTime, ...job } = row;
  return job;
}

async function finalizeNodeSlideJobBudget(
  ctx: Pick<MutationCtx, 'runMutation'>,
  budgetId?: string,
): Promise<void> {
  if (!budgetId) return;
  await ctx.runMutation(nodeslideBudgetsInternal.finalizeForJob, { budgetId });
}

async function finalizeNodeSlideJobBudgetBestEffort(
  ctx: Pick<MutationCtx, 'runMutation'>,
  budgetId?: string,
): Promise<void> {
  if (!budgetId) return;
  try {
    await finalizeNodeSlideJobBudget(ctx, budgetId);
  } catch {
    // Cancellation still fences the worker/session. The unresolved ledger remains
    // explicitly open for reconciliation instead of claiming a fabricated close.
  }
}

async function findJob(ctx: ReadCtx, jobId: string) {
  return await ctx.db
    .query('nodeslide_agent_jobs')
    .withIndex('by_stable_id', (queryBuilder) =>
      queryBuilder.eq('id', requiredText(jobId, 'jobId', 256)),
    )
    .unique();
}

async function findAuthorizedJob(ctx: ReadCtx, jobId: string, ownerAccessKey: string) {
  const ownerKey = requiredOwnerAccessKey(ownerAccessKey);
  const row = await ctx.db
    .query('nodeslide_agent_jobs')
    .withIndex('by_stable_id', (queryBuilder) =>
      queryBuilder.eq('id', requiredText(jobId, 'jobId', 256)),
    )
    .unique();
  if (!row || row.ownerDigest !== nodeSlideJobOwnerDigest(ownerKey)) return null;
  return row;
}

async function patchJob(
  ctx: Pick<MutationCtx, 'db'>,
  row: Doc<'nodeslide_agent_jobs'>,
  next: NodeSlideJobRecord,
) {
  await ctx.db.patch(row._id, {
    status: next.status,
    phase: next.phase,
    progress: next.progress,
    attempt: next.attempt,
    maxAttempts: next.maxAttempts,
    streamId: next.streamId,
    ...(next.workflowId ? { workflowId: next.workflowId } : {}),
    ...(next.resultDeckId ? { resultDeckId: next.resultDeckId } : {}),
    ...(next.resultPatchId ? { resultPatchId: next.resultPatchId } : {}),
    ...(next.resultCandidateDigest ? { resultCandidateDigest: next.resultCandidateDigest } : {}),
    ...(next.conversationRunId ? { conversationRunId: next.conversationRunId } : {}),
    ...(next.budgetId ? { budgetId: next.budgetId } : {}),
    memoryIds: [...next.memoryIds],
    ...(next.error ? { error: next.error } : { error: undefined }),
    updatedAt: next.updatedAt,
    ...(next.completedAt ? { completedAt: next.completedAt } : { completedAt: undefined }),
  });
}

type DurableSessionProjection = {
  sessionId: string;
  requestBinding: {
    schemaVersion: 'nodeslide.request-binding/v2';
    requestDigest: string;
    capabilityDigest: string;
  };
  stateVersion: number;
  egressEpoch: number;
  jobs: Array<{
    jobId: string;
    status: NodeSlideDurableJobStatus;
    attempt: number;
  }>;
};

function nodeSlideDurableSessionId(jobId: string): string {
  return nodeslideStableId('nsession', jobId);
}

function nodeSlideDurableLeaseId(jobId: string, attempt: number): string {
  return nodeslideStableId('session_lease', jobId, String(attempt));
}

async function enqueueNodeSlideDurableSession(
  ctx: Pick<MutationCtx, 'runMutation'>,
  args: {
    jobId: string;
    request: unknown;
    capability: NodeSlideCapabilityMaterial;
  },
): Promise<void> {
  const sessionId = nodeSlideDurableSessionId(args.jobId);
  const capability = createNodeSlideCapabilityDigestMetadata(args.capability);
  const created = (await ctx.runMutation(nodeslideSessionsInternal.create, {
    sessionId,
    request: args.request,
    capability,
  })) as { session: DurableSessionProjection };
  if (created.session.jobs.some((job) => job.jobId === args.jobId)) return;
  await ctx.runMutation(nodeslideSessionsInternal.applyCommand, {
    sessionId,
    commandId: `enqueue:${args.jobId}`,
    command: {
      type: 'enqueue',
      expectedStateVersion: created.session.stateVersion,
      requestBinding: created.session.requestBinding,
      jobId: args.jobId,
      maxAttempts: NODESLIDE_JOB_MAX_ATTEMPTS,
    },
  });
}

async function readNodeSlideDurableSession(
  ctx: Pick<MutationCtx, 'runQuery'>,
  jobId: string,
): Promise<DurableSessionProjection | null> {
  return (await ctx.runQuery(nodeslideSessionsInternal.get, {
    sessionId: nodeSlideDurableSessionId(jobId),
  })) as DurableSessionProjection | null;
}

async function claimNodeSlideDurableSession(
  ctx: Pick<MutationCtx, 'runMutation' | 'runQuery'>,
  jobId: string,
  attempt: number,
): Promise<void> {
  const session = await readNodeSlideDurableSession(ctx, jobId);
  if (!session) return;
  const job = session.jobs.find((candidate) => candidate.jobId === jobId);
  if (job?.status === 'running' && job.attempt === attempt) return;
  if (!job || (job.status !== 'queued' && job.status !== 'retrying')) {
    throw new Error('Durable NodeSlide session cannot claim this job attempt.');
  }
  const issuedAt = Date.now();
  await ctx.runMutation(nodeslideSessionsInternal.applyCommand, {
    sessionId: session.sessionId,
    commandId: `claim:${jobId}:${attempt}`,
    command: {
      type: 'claim',
      expectedStateVersion: session.stateVersion,
      requestBinding: session.requestBinding,
      jobId,
      lease: {
        leaseId: nodeSlideDurableLeaseId(jobId, attempt),
        workerId: nodeslideStableId('session_worker', jobId),
        issuedAt,
        expiresAt: issuedAt + NODESLIDE_DURABLE_SESSION_LEASE_MS,
      },
    },
  });
}

async function retryNodeSlideDurableSession(
  ctx: Pick<MutationCtx, 'runMutation' | 'runQuery'>,
  jobId: string,
): Promise<void> {
  const session = await readNodeSlideDurableSession(ctx, jobId);
  if (!session) return;
  const job = session.jobs.find((candidate) => candidate.jobId === jobId);
  if (job?.status === 'retrying') return;
  if (!job || job.status !== 'failed') {
    throw new Error('Durable NodeSlide session cannot retry this job.');
  }
  await ctx.runMutation(nodeslideSessionsInternal.applyCommand, {
    sessionId: session.sessionId,
    commandId: `retry:${jobId}:${job.attempt}`,
    command: {
      type: 'retry',
      expectedStateVersion: session.stateVersion,
      requestBinding: session.requestBinding,
      jobId,
    },
  });
}

async function transitionNodeSlideDurableSession(
  ctx: Pick<MutationCtx, 'runMutation' | 'runQuery'>,
  args: {
    jobId: string;
    toStatus: NodeSlideDurableJobStatus;
    reason?: string;
  },
): Promise<void> {
  const session = await readNodeSlideDurableSession(ctx, args.jobId);
  if (!session) return;
  const job = session.jobs.find((candidate) => candidate.jobId === args.jobId);
  if (!job || job.status === args.toStatus) return;
  await ctx.runMutation(nodeslideSessionsInternal.applyCommand, {
    sessionId: session.sessionId,
    commandId: `transition:${args.jobId}:${job.status}:${args.toStatus}:${job.attempt}`,
    command: {
      type: 'transition',
      expectedStateVersion: session.stateVersion,
      requestBinding: session.requestBinding,
      jobId: args.jobId,
      toStatus: args.toStatus,
      ...(job.status === 'running'
        ? { leaseId: nodeSlideDurableLeaseId(args.jobId, job.attempt) }
        : {}),
      ...(args.reason ? { reason: args.reason } : {}),
    },
  });
}

function nodeSlideJobEgress(request: NodeSlideEditProposalJobRequest) {
  const model = request.providerMode && request.providerMode !== 'deterministic';
  const web = request.webResearch === true;
  return model && web ? 'model_and_web' : model ? 'model' : web ? 'web' : 'none';
}

function validateEditProposalRequest(request: NodeSlideEditProposalJobRequest): void {
  const instruction = requiredText(request.instruction, 'instruction', 4_000);
  if (request.scope.deckId !== request.deckId) throw new Error('Patch scope deckId mismatch.');
  if ((request.commandId ?? 'edit') !== 'edit') {
    throw new Error('The durable edit workflow only supports proposal-only edit commands.');
  }
  if (!Number.isFinite(request.baseDeckVersion) || request.baseDeckVersion < 0) {
    throw new Error('baseDeckVersion must be a non-negative finite number.');
  }
  if (instruction.length === 0) throw new Error('NodeSlide edit instruction is required.');
  try {
    validateNodeSlideProviderChoice(
      'propose_edit',
      request.providerMode,
      request.providerConsent,
      request.providerModel,
      request.providerEffort,
    );
  } catch (error) {
    if (error instanceof NodeSlideProviderConsentError) throw new Error(error.message);
    throw error;
  }
  if (request.webResearch) {
    if (request.webResearchConsent !== NODESLIDE_WEB_RESEARCH_CONSENT) {
      throw new Error(
        'Explicit web research consent is required before sending this query to search providers.',
      );
    }
  } else if (request.webResearchConsent !== undefined) {
    throw new Error('Web research consent must only accompany a web research request.');
  }
}

async function appendProgress(
  ctx: Pick<MutationCtx, 'runMutation'>,
  job: NodeSlideJobRecord,
  final: boolean,
) {
  await ctx.runMutation(components.persistentTextStreaming.lib.addChunk, {
    streamId: job.streamId,
    text: nodeSlideJobProgressLine(job),
    final,
  });
}

function requiredOwnerAccessKey(value: string): string {
  if (!isOwnerAccessKey(value)) throw new Error('Invalid NodeSlide job owner capability.');
  return value;
}

function requiredText(value: string, label: string, max: number): string {
  const clean = value.replace(/\s+/gu, ' ').trim();
  if (!clean) throw new Error(`${label} is required.`);
  if (clean.length > max) throw new Error(`${label} exceeds ${max} characters.`);
  return clean;
}

function validateCreateThemeId(value: string): void {
  const clean = value.replace(/\s+/gu, ' ').trim();
  if (!clean) throw nodeslideCreatePublicError('invalid_request', 'themeId is required.');
  if (Array.from(value).length > 128 || new TextEncoder().encode(value).byteLength > 256) {
    throw nodeslideCreatePublicError(
      'invalid_request',
      'themeId exceeds the private-preview size limit.',
    );
  }
}

type ReadCtx = Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>;
