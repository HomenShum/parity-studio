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
import { createOwnerAccessKey, isOwnerAccessKey, requireOwnerAccess } from './lib/nodeslideAccess';
import { nodeSlideActorQuotaKey } from './lib/nodeslideAuthority';
import {
  findCurrentValidationRow,
  findPatchRow,
  findVersionRow,
  patchFromRow,
} from './lib/nodeslideData';
import { nodeSlideSnapshotDigest } from './lib/nodeslideDeckRepl';
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
  isNodeSlideJobTerminal,
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
      userRequestDigest: nodeslideContentDigest(request.brief.prompt),
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
    await appendProgress(ctx, jobFromRow(created));
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
      userRequestDigest: nodeslideContentDigest(request.instruction),
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
    await appendProgress(ctx, jobFromRow(created));
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
    return job ? await loadPublicBudgetReceipt(ctx, job) : null;
  },
});

/**
 * Owner-authorized machine receipt for reproducible UXBench capture.
 *
 * The projection intentionally excludes request text, owner/execution keys,
 * leases, provider replay payloads, source bodies, cookies, and consent tokens.
 * It exposes only persisted state transitions, safe digests, bounded patch
 * operations, telemetry metadata, and the hard-budget accounting receipt.
 */
export const getRunReceipt = query({
  args: { jobId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args) => {
    const job = await findAuthorizedJob(ctx, args.jobId, args.ownerAccessKey);
    if (!job) return null;

    const sessionId = nodeSlideDurableSessionId(job.id);
    const session = await ctx.db
      .query('nodeslide_durable_sessions')
      .withIndex('by_stable_id', (queryBuilder) => queryBuilder.eq('id', sessionId))
      .unique();
    if (session && session.requestDigest !== job.requestDigest) {
      throw new Error('Durable session request binding does not match its job.');
    }
    const sessionJob = session?.jobs[job.id];
    const [sessionEvents, journalEntries, budget, patch, snapshot, telemetry] = await Promise.all([
      session
        ? ctx.db
            .query('nodeslide_durable_session_events')
            .withIndex('by_session_job', (queryBuilder) =>
              queryBuilder.eq('sessionId', session.id).eq('jobId', job.id),
            )
            .order('asc')
            .take(256)
        : Promise.resolve([]),
      session && sessionJob
        ? ctx.db
            .query('nodeslide_durable_job_journal_entries')
            .withIndex('by_binding_sequence', (queryBuilder) =>
              queryBuilder.eq('sessionId', session.id).eq('jobId', job.id),
            )
            .order('asc')
            .take(256)
        : Promise.resolve([]),
      loadPublicBudgetReceipt(ctx, job),
      loadBoundPatchReceipt(ctx, job),
      loadBoundSnapshotReceipt(ctx, job, args.ownerAccessKey),
      loadBoundTelemetryReceipt(ctx, job),
    ]);

    return {
      schemaVersion: 'nodeslide.run-receipt/v1' as const,
      job: publicBenchmarkJob(job),
      requestBinding: session
        ? {
            schemaVersion: session.requestBinding.schemaVersion,
            requestDigest: session.requestDigest,
            capabilityDigest: session.capabilityDigest,
            userRequestDigest: job.userRequestDigest ?? null,
          }
        : null,
      capability: session
        ? {
            provider: session.capability.provider,
            model: session.capability.model,
            scopes: session.capability.scopes,
            egress: session.capability.egress,
            hasConsent: session.capability.hasConsent,
            attachmentCount: session.capability.attachmentCount,
          }
        : null,
      session: session
        ? {
            sessionId: session.id,
            stateVersion: session.stateVersion,
            egressEpoch: session.egressEpoch,
            stateDigest: session.stateDigest,
            job: sessionJob
              ? {
                  status: sessionJob.status,
                  attempt: sessionJob.attempt,
                  retryCount: sessionJob.retryCount,
                  resumeCount: sessionJob.resumeCount,
                  maxAttempts: sessionJob.maxAttempts,
                  createdAt: sessionJob.createdAt,
                  updatedAt: sessionJob.updatedAt,
                  ...(sessionJob.completedAt ? { completedAt: sessionJob.completedAt } : {}),
                  ...(sessionJob.reason
                    ? { reasonCode: `nodeslide_session_${sessionJob.status}` }
                    : {}),
                }
              : null,
          }
        : null,
      transitions: sessionEvents.map((row) => ({
        sequence: row.transitionSequence,
        commandKind: row.commandKind,
        stateVersion: row.stateVersion,
        egressEpoch: row.egressEpoch,
        occurredAt: row.occurredAt,
        transitionDigest: row.transitionDigest,
        ...(row.event
          ? {
              event: {
                sequence: row.event.sequence,
                kind: row.event.kind,
                fromStatus: row.event.fromStatus,
                toStatus: row.event.toStatus,
                attempt: row.event.attempt,
                occurredAt: row.event.occurredAt,
                eventDigest: row.event.eventDigest,
              },
            }
          : {}),
      })),
      journal: journalEntries.map((row) => ({
        sequence: row.sequence,
        kind: row.kind,
        provider: row.provider,
        ...(row.model ? { model: row.model } : {}),
        operation: row.operation,
        ...(row.inputDigest ? { inputDigest: row.inputDigest } : {}),
        ...(row.outputDigest ? { outputDigest: row.outputDigest } : {}),
        ...(row.inputTokens !== undefined ? { inputTokens: row.inputTokens } : {}),
        ...(row.outputTokens !== undefined ? { outputTokens: row.outputTokens } : {}),
        ...(row.queryDigest ? { queryDigest: row.queryDigest } : {}),
        ...(row.urlDigest ? { urlDigest: row.urlDigest } : {}),
        ...(row.resultDigest ? { resultDigest: row.resultDigest } : {}),
        ...(row.resultCount !== undefined ? { resultCount: row.resultCount } : {}),
        entryDigest: row.entryDigest,
        journalDigest: row.journalDigest,
        createdAt: row.createdAt,
      })),
      budget,
      patch,
      snapshot,
      telemetry,
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
    await appendProgress(ctx, next);
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
    await appendProgress(ctx, next);
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
    await appendProgress(ctx, next);
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
    if (current.kind === 'edit_proposal' && next.status === 'awaiting_review') {
      await transitionNodeSlideDurableSessionBestEffort(ctx, {
        jobId: next.id,
        toStatus: 'awaiting_review',
      });
    }
    await patchJob(ctx, row, next);
    await appendProgress(ctx, next);
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
    await appendProgress(ctx, next);
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
    await transitionNodeSlideDurableSessionBestEffort(ctx, {
      jobId: next.id,
      toStatus: 'awaiting_review',
    });
    await patchJob(ctx, row, next);
    await appendProgress(ctx, next);
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
    await transitionNodeSlideDurableSessionBestEffort(ctx, {
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
    await appendProgress(ctx, next);
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
    await transitionNodeSlideDurableSessionBestEffort(ctx, {
      jobId: next.id,
      toStatus: args.result.kind === 'canceled' ? 'cancelled' : 'failed',
      ...(args.result.kind === 'failed' ? { reason: args.result.error } : {}),
    });
    await patchJob(ctx, row, next);
    await appendProgress(ctx, next);
  },
});

function jobFromRow(row: Doc<'nodeslide_agent_jobs'>): NodeSlideJobRecord {
  const { _id: _rowId, _creationTime, ...job } = row;
  return job;
}

function publicBenchmarkJob(job: Doc<'nodeslide_agent_jobs'>) {
  return {
    jobId: job.id,
    kind: job.kind,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    ...(job.resultDeckId ? { resultDeckId: job.resultDeckId } : {}),
    ...(job.resultPatchId ? { resultPatchId: job.resultPatchId } : {}),
    ...(job.resultCandidateDigest ? { resultCandidateDigest: job.resultCandidateDigest } : {}),
    ...(job.conversationRunId ? { conversationRunId: job.conversationRunId } : {}),
    ...(job.budgetId ? { budgetId: job.budgetId } : {}),
    ...(job.error ? { errorCode: benchmarkErrorCode(job.status, job.phase) } : {}),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.completedAt ? { completedAt: job.completedAt } : {}),
  };
}

function benchmarkErrorCode(
  status: Doc<'nodeslide_agent_jobs'>['status'],
  phase: Doc<'nodeslide_agent_jobs'>['phase'],
): string {
  return `nodeslide_job_${status}_${phase}`;
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

async function loadPublicBudgetReceipt(ctx: ReadCtx, job: Doc<'nodeslide_agent_jobs'>) {
  if (!job.budgetId) return null;
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
}

async function loadBoundPatchReceipt(ctx: ReadCtx, job: Doc<'nodeslide_agent_jobs'>) {
  if (!job.resultPatchId) return null;
  const row = await findPatchRow(ctx, job.resultPatchId);
  if (!row) return null;
  if (row.jobId !== job.id || row.deckId !== job.resultDeckId) {
    throw new Error('Durable patch receipt does not match its job binding.');
  }
  const patch = patchFromRow(row);
  return {
    id: patch.id,
    deckId: patch.deckId,
    baseDeckVersion: patch.baseDeckVersion,
    baseSlideVersions: patch.baseSlideVersions,
    baseElementVersions: patch.baseElementVersions,
    ...(patch.resultingDeckVersion !== undefined
      ? { resultingDeckVersion: patch.resultingDeckVersion }
      : {}),
    scope: patch.scope,
    operations: patch.operations,
    status: patch.status,
    source: patch.source,
    ...(patch.candidateDigest ? { candidateDigest: patch.candidateDigest } : {}),
    candidateValidation: patch.candidateValidation
      ? {
          id: patch.candidateValidation.id,
          patchId: patch.candidateValidation.patchId,
          candidateDigest: patch.candidateValidation.candidateDigest,
          deckId: patch.candidateValidation.deckId,
          deckVersion: patch.candidateValidation.deckVersion,
          ok: patch.candidateValidation.ok,
          publishOk: patch.candidateValidation.publishOk,
          cleanOk: patch.candidateValidation.cleanOk,
          issueCount: patch.candidateValidation.issues.length,
          issues: patch.candidateValidation.issues.map((issue) => ({
            severity: issue.severity,
            code: issue.code,
            ...(issue.slideId ? { slideId: issue.slideId } : {}),
            ...(issue.elementId ? { elementId: issue.elementId } : {}),
          })),
          checkedAt: patch.candidateValidation.checkedAt,
          toolchainVersion: patch.candidateValidation.toolchainVersion,
        }
      : null,
    createdAt: patch.createdAt,
    updatedAt: patch.updatedAt,
  };
}

async function loadBoundSnapshotReceipt(
  ctx: ReadCtx,
  job: Doc<'nodeslide_agent_jobs'>,
  ownerAccessKey: string,
) {
  if (!job.resultDeckId) return null;
  await requireOwnerAccess(ctx, job.resultDeckId, ownerAccessKey);
  const patch = job.resultPatchId ? await findPatchRow(ctx, job.resultPatchId) : null;
  if (patch && (patch.deckId !== job.resultDeckId || patch.jobId !== job.id)) {
    throw new Error('Durable snapshot version does not match its patch binding.');
  }
  const expectedVersion = job.kind === 'create_deck' ? 1 : patch?.baseDeckVersion;
  if (expectedVersion === undefined) return null;
  const version = await findVersionRow(ctx, {
    deckId: job.resultDeckId,
    version: expectedVersion,
  });
  if (!version || version.snapshot.deck.version !== expectedVersion) {
    throw new Error('Immutable durable snapshot version is unavailable.');
  }
  const snapshot = version.snapshot;
  const validation = await findCurrentValidationRow(ctx, job.resultDeckId, expectedVersion);
  return {
    snapshotVersionId: version.id,
    snapshotDigest: nodeSlideSnapshotDigest(snapshot),
    deck: {
      id: snapshot.deck.id,
      title: snapshot.deck.title,
      version: snapshot.deck.version,
      status: snapshot.deck.status,
      slideOrder: snapshot.deck.slideOrder,
      createdAt: snapshot.deck.createdAt,
      updatedAt: snapshot.deck.updatedAt,
    },
    slides: snapshot.slides.map((slide) => ({
      id: slide.id,
      deckId: slide.deckId,
      title: slide.title,
      section: slide.section,
      elementOrder: slide.elementOrder,
      version: slide.version,
    })),
    elements: snapshot.elements.map((element) => ({
      id: element.id,
      slideId: element.slideId,
      name: element.name,
      kind: element.kind,
      role: element.role,
      bbox: element.bbox,
      rotation: element.rotation,
      ...(element.content !== undefined ? { content: element.content } : {}),
      style: element.style,
      sourceIds: element.sourceIds,
      locked: element.locked,
      version: element.version,
    })),
    sources: snapshot.sources.map((source) => ({
      id: source.id,
      deckId: source.deckId,
      sourceType: source.sourceType,
      retrievedAt: source.retrievedAt,
      ...(source.contentDigest ? { contentDigest: source.contentDigest } : {}),
      ...(source.format ? { format: source.format } : {}),
      ...(source.license ? { license: source.license } : {}),
    })),
    validation: validation
      ? {
          id: validation.id,
          deckVersion: validation.deckVersion,
          ok: validation.ok,
          publishOk: validation.publishOk,
          cleanOk: validation.cleanOk,
          issueCount: validation.issues.length,
          checkedAt: validation.checkedAt,
          toolchainVersion: validation.toolchainVersion,
        }
      : null,
  };
}

async function loadBoundTelemetryReceipt(ctx: ReadCtx, job: Doc<'nodeslide_agent_jobs'>) {
  if (!job.conversationRunId || !job.resultDeckId) return null;
  const run = await ctx.db
    .query('nodeslide_agent_runs')
    .withIndex('by_stable_id', (queryBuilder) =>
      queryBuilder.eq('id', job.conversationRunId as string),
    )
    .unique();
  if (!run) return null;
  if (run.deckId !== job.resultDeckId || run.ownerDigest !== job.ownerDigest) {
    throw new Error('Agent telemetry receipt does not match its durable job binding.');
  }
  const [spans, events] = await Promise.all([
    ctx.db
      .query('nodeslide_agent_spans')
      .withIndex('by_run_sequence', (queryBuilder) => queryBuilder.eq('runId', run.id))
      .order('asc')
      .take(512),
    ctx.db
      .query('nodeslide_agent_events')
      .withIndex('by_run_sequence', (queryBuilder) => queryBuilder.eq('runId', run.id))
      .order('asc')
      .take(512),
  ]);
  return {
    run: {
      id: run.id,
      deckId: run.deckId,
      status: run.status,
      provider: run.provider,
      model: run.model,
      webResearch: run.webResearch,
      attempt: run.attempt,
      ...(run.budgetId ? { budgetId: run.budgetId } : {}),
      ...(run.otelTraceId ? { otelTraceId: run.otelTraceId } : {}),
      ...(run.rootSpanId ? { rootSpanId: run.rootSpanId } : {}),
      ...(run.patchId ? { patchId: run.patchId } : {}),
      ...(run.traceId ? { traceId: run.traceId } : {}),
      ...(run.error ? { errorCode: `nodeslide_run_${run.status}` } : {}),
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    },
    spans: spans.map((span) => ({
      id: span.id,
      traceId: span.traceId,
      spanId: span.spanId,
      ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
      name: span.name,
      operationName: span.operationName,
      kind: span.kind,
      status: span.status,
      startTime: span.startTime,
      ...(span.endTime !== undefined ? { endTime: span.endTime } : {}),
      ...(span.durationMs !== undefined ? { durationMs: span.durationMs } : {}),
      ...(span.provider ? { provider: span.provider } : {}),
      ...(span.model ? { model: span.model } : {}),
      ...(span.toolName ? { toolName: span.toolName } : {}),
      ...(span.inputTokens !== undefined ? { inputTokens: span.inputTokens } : {}),
      ...(span.outputTokens !== undefined ? { outputTokens: span.outputTokens } : {}),
      ...(span.costMicroUsd !== undefined ? { costMicroUsd: span.costMicroUsd } : {}),
      sourceIds: span.sourceIds ?? [],
      sequence: span.sequence,
    })),
    events: events.map((event) => ({
      id: event.id,
      traceId: event.traceId,
      spanId: event.spanId,
      name: event.name,
      severity: event.severity,
      timestamp: event.timestamp,
      sequence: event.sequence,
    })),
  };
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

async function transitionNodeSlideDurableSessionBestEffort(
  ctx: Pick<MutationCtx, 'runMutation' | 'runQuery'>,
  args: {
    jobId: string;
    toStatus: NodeSlideDurableJobStatus;
    reason?: string;
  },
): Promise<void> {
  try {
    await transitionNodeSlideDurableSession(ctx, args);
  } catch {
    // The owner-authorized job row is the review authority. A projection-side
    // conflict must not hide a persisted candidate or strand its public receipt
    // in `running`; later completion or review resolution reconciles the session.
  }
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

async function appendProgress(ctx: Pick<MutationCtx, 'runMutation'>, job: NodeSlideJobRecord) {
  await ctx.runMutation(components.persistentTextStreaming.lib.addChunk, {
    streamId: job.streamId,
    text: nodeSlideJobProgressLine(job),
    // `awaiting_review` is intentionally nonterminal: the human decision is
    // still part of this durable run, so only a real terminal state closes the
    // stream. This prevents Accept/Reject from attempting a second final write.
    final: isNodeSlideJobTerminal(job.status),
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
