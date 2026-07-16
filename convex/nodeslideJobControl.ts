import type { WorkflowId } from '@convex-dev/workflow';
import { v } from 'convex/values';
import type { NodeSlideDurableJobStatus } from '../shared/nodeslideDurableSession';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalMutation, mutation, query } from './_generated/server';
import { isOwnerAccessKey } from './lib/nodeslideAccess';
import { nodeslideStableId } from './lib/nodeslideIds';
import {
  type NodeSlideJobRecord,
  classifyNodeSlideJobFreshness,
  heartbeatNodeSlideJob,
  nodeSlideJobOwnerDigest,
  pauseNodeSlideJob,
  publicNodeSlideJob,
  resumeNodeSlideJob,
} from './lib/nodeslideJobState';
import { workflow } from './workflows';

// Generated references form a deliberate job-control -> durable-session cycle.
// Runtime inputs remain validator checked at every public/internal boundary.
// biome-ignore lint/suspicious/noExplicitAny: generated Convex self-reference boundary
const sessionsInternal: any = (internal as any).nodeslideSessions;

const SESSION_LEASE_MS = 3_900_000;

type ReadCtx = Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>;
type DurableSessionProjection = {
  sessionId: string;
  requestBinding: {
    schemaVersion: 'nodeslide.request-binding/v2';
    requestDigest: string;
    capabilityDigest: string;
  };
  stateVersion: number;
  egressEpoch: number;
  jobs: Array<{ jobId: string; status: NodeSlideDurableJobStatus; attempt: number }>;
};

/** Owner-authorized cooperative pause. In-flight work is fenced at its next durable boundary. */
export const pause = mutation({
  args: { jobId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args) => {
    const row = await findAuthorizedJob(ctx, args.jobId, args.ownerAccessKey);
    if (!row) return null;
    const current = jobFromRow(row);
    const next = pauseNodeSlideJob(current, Date.now());
    if (next === current) return publicNodeSlideJob(current);

    await pauseDurableSession(ctx, current);
    await patchJobControlState(ctx, row, next);
    return publicNodeSlideJob(next);
  },
});

/** Owner-authorized resume that keeps the same job id, request binding, and attempt fence. */
export const resume = mutation({
  args: { jobId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args) => {
    const row = await findAuthorizedJob(ctx, args.jobId, args.ownerAccessKey);
    if (!row) return null;
    if (row.status !== 'paused') return publicNodeSlideJob(jobFromRow(row));
    if (!row.workflowId) throw new Error('NodeSlide job has no durable workflow to resume.');

    const durable = await readDurableSession(ctx, row.id);
    const durableJob = durable?.jobs.find((candidate) => candidate.jobId === row.id);
    const resumeTo =
      durableJob?.status === 'retrying'
        ? 'retrying'
        : durableJob?.status === 'paused'
          ? 'running'
          : 'queued';
    const next = resumeNodeSlideJob(jobFromRow(row), Date.now(), resumeTo);

    if (durable && durableJob?.status === 'paused') {
      await resumeDurableSession(ctx, durable, durableJob);
    }
    await patchJobControlState(ctx, row, next);
    await workflow.restart(ctx, row.workflowId as WorkflowId, {
      from: row.kind === 'create_deck' ? 'execute-create-deck' : 'execute-edit-proposal',
      startAsync: true,
    });
    return publicNodeSlideJob(next);
  },
});

/** Owner-gated freshness projection. A stale heartbeat never changes the terminal outcome. */
export const getFreshness = query({
  args: { jobId: v.string(), ownerAccessKey: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const row = await findAuthorizedJob(ctx, args.jobId, args.ownerAccessKey);
    return row ? classifyNodeSlideJobFreshness(jobFromRow(row), args.now ?? Date.now()) : null;
  },
});

/**
 * Workflow-safe heartbeat and execution gate. A paused or terminal receipt
 * returns shouldRun=false, allowing the workflow to stop without claiming a
 * fabricated failure or completion.
 */
export const heartbeatInternal = internalMutation({
  args: { jobId: v.string() },
  handler: async (ctx, args) => {
    const row = await findJob(ctx, args.jobId);
    if (!row) throw new Error('NodeSlide job not found.');
    const current = jobFromRow(row);
    const next = heartbeatNodeSlideJob(current, Date.now());
    if (next !== current) await patchJobControlState(ctx, row, next);
    return {
      status: next.status,
      shouldRun:
        next.status === 'queued' || next.status === 'running' || next.status === 'retrying',
      ...classifyNodeSlideJobFreshness(next),
    };
  },
});

function jobFromRow(row: Doc<'nodeslide_agent_jobs'>): NodeSlideJobRecord {
  const { _id: _rowId, _creationTime, ...job } = row;
  return job;
}

async function findJob(ctx: ReadCtx, jobId: string) {
  return await ctx.db
    .query('nodeslide_agent_jobs')
    .withIndex('by_stable_id', (queryBuilder) => queryBuilder.eq('id', requiredJobId(jobId)))
    .unique();
}

async function findAuthorizedJob(ctx: ReadCtx, jobId: string, ownerAccessKey: string) {
  if (!isOwnerAccessKey(ownerAccessKey)) throw new Error('Invalid NodeSlide job owner capability.');
  const row = await findJob(ctx, jobId);
  return row && row.ownerDigest === nodeSlideJobOwnerDigest(ownerAccessKey) ? row : null;
}

async function patchJobControlState(
  ctx: Pick<MutationCtx, 'db'>,
  row: Doc<'nodeslide_agent_jobs'>,
  next: NodeSlideJobRecord,
) {
  await ctx.db.patch(row._id, {
    status: next.status,
    phase: next.phase,
    progress: next.progress,
    attempt: next.attempt,
    updatedAt: next.updatedAt,
    ...(next.error ? { error: next.error } : { error: undefined }),
    ...(next.completedAt ? { completedAt: next.completedAt } : { completedAt: undefined }),
  });
}

async function readDurableSession(
  ctx: Pick<MutationCtx, 'runQuery'>,
  jobId: string,
): Promise<DurableSessionProjection | null> {
  return (await ctx.runQuery(sessionsInternal.get, {
    sessionId: nodeslideStableId('nsession', jobId),
  })) as DurableSessionProjection | null;
}

async function pauseDurableSession(
  ctx: Pick<MutationCtx, 'runMutation' | 'runQuery'>,
  job: NodeSlideJobRecord,
): Promise<void> {
  const session = await readDurableSession(ctx, job.id);
  const durableJob = session?.jobs.find((candidate) => candidate.jobId === job.id);
  if (!session || !durableJob || durableJob.status === 'paused') return;
  // The durable reducer intentionally permits pausing only claimed work. Queued
  // and retrying rows remain fenced by the public paused state until resume.
  if (durableJob.status !== 'running') return;
  await ctx.runMutation(sessionsInternal.applyCommand, {
    sessionId: session.sessionId,
    commandId: `pause:${job.id}:${durableJob.attempt}`,
    command: {
      type: 'transition',
      expectedStateVersion: session.stateVersion,
      requestBinding: session.requestBinding,
      jobId: job.id,
      toStatus: 'paused',
      leaseId: nodeslideStableId('session_lease', job.id, String(durableJob.attempt)),
      reason: 'Paused by the owner at a durable workflow boundary.',
    },
  });
}

async function resumeDurableSession(
  ctx: Pick<MutationCtx, 'runMutation'>,
  session: DurableSessionProjection,
  job: DurableSessionProjection['jobs'][number],
): Promise<void> {
  const issuedAt = Date.now();
  await ctx.runMutation(sessionsInternal.applyCommand, {
    sessionId: session.sessionId,
    commandId: `resume:${job.jobId}:${job.attempt}`,
    command: {
      type: 'resume',
      expectedStateVersion: session.stateVersion,
      requestBinding: session.requestBinding,
      jobId: job.jobId,
      lease: {
        leaseId: nodeslideStableId('session_lease', job.jobId, String(job.attempt)),
        workerId: nodeslideStableId('session_worker', job.jobId),
        issuedAt,
        expiresAt: issuedAt + SESSION_LEASE_MS,
      },
    },
  });
}

function requiredJobId(value: string): string {
  const clean = value.trim();
  if (!clean || clean.length > 256) throw new Error('Invalid NodeSlide job id.');
  return clean;
}
