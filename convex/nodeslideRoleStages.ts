import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';
import { nodeslideContentDigest, nodeslideStableId } from './lib/nodeslideIds';
import { nodeSlideJobOwnerDigest } from './lib/nodeslideJobState';

const STAGE_LEASE_MS = 90_000;
const roleValidator = v.union(
  v.literal('researcher'),
  v.literal('analyst'),
  v.literal('storyteller'),
  v.literal('designer'),
  v.literal('fact_checker'),
  v.literal('reviewer'),
);

export const beginInternal = internalMutation({
  args: {
    jobId: v.string(),
    deckId: v.string(),
    ownerAccessKey: v.string(),
    runId: v.string(),
    role: roleValidator,
    ordinal: v.number(),
    parentStageId: v.optional(v.string()),
    inputDigest: v.string(),
    provider: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const job = await ctx.db
      .query('nodeslide_agent_jobs')
      .withIndex('by_stable_id', (index) => index.eq('id', args.jobId))
      .unique();
    if (
      !job ||
      job.kind !== 'edit_proposal' ||
      job.ownerDigest !== nodeSlideJobOwnerDigest(args.ownerAccessKey) ||
      job.status !== 'running'
    ) {
      throw new Error('The durable cognitive stage no longer owns an active edit job.');
    }
    if (!Number.isSafeInteger(args.ordinal) || args.ordinal < 1 || args.ordinal > 8) {
      throw new Error('Cognitive stage ordinal is invalid.');
    }
    const id = nodeslideStableId('role_stage', args.jobId, args.role, String(args.ordinal));
    const existing = await ctx.db
      .query('nodeslide_role_stages')
      .withIndex('by_stable_id', (index) => index.eq('id', id))
      .unique();
    if (existing) {
      if (
        existing.jobId !== args.jobId ||
        existing.deckId !== args.deckId ||
        existing.runId !== args.runId ||
        existing.role !== args.role ||
        existing.ordinal !== args.ordinal ||
        existing.inputDigest !== args.inputDigest ||
        existing.provider !== args.provider ||
        existing.model !== args.model ||
        existing.parentStageId !== args.parentStageId
      ) {
        throw new Error('Cognitive stage idempotency binding conflict.');
      }
      if (existing.status === 'completed' || existing.status === 'fallback') {
        return { state: 'terminal' as const, stage: existing };
      }
      if (existing.status === 'running' && existing.leaseExpiresAt > Date.now()) {
        return { state: 'in_flight' as const, stageId: existing.id };
      }
      const now = Date.now();
      const nextAttempt = existing.attempt + 1;
      const leaseId = nodeslideStableId('role_lease', id, String(nextAttempt), String(now));
      await ctx.db.patch(existing._id, {
        status: 'running',
        attempt: nextAttempt,
        leaseId,
        leaseExpiresAt: now + STAGE_LEASE_MS,
        outputJson: undefined,
        outputDigest: undefined,
        callId: undefined,
        completedAt: undefined,
        updatedAt: now,
      });
      return {
        state: 'acquired' as const,
        stage: {
          ...existing,
          status: 'running' as const,
          attempt: nextAttempt,
          leaseId,
          leaseExpiresAt: now + STAGE_LEASE_MS,
          outputJson: undefined,
          outputDigest: undefined,
          callId: undefined,
          completedAt: undefined,
          updatedAt: now,
        },
      };
    }
    const now = Date.now();
    const leaseId = nodeslideStableId('role_lease', id, '1', String(now));
    const row = {
      id,
      schemaVersion: 'nodeslide.role-stage/v1' as const,
      jobId: args.jobId,
      deckId: args.deckId,
      runId: args.runId,
      role: args.role,
      ordinal: args.ordinal,
      ...(args.parentStageId ? { parentStageId: args.parentStageId } : {}),
      status: 'running' as const,
      attempt: 1,
      inputDigest: args.inputDigest,
      provider: clean(args.provider, 80),
      model: clean(args.model, 180),
      leaseId,
      leaseExpiresAt: now + STAGE_LEASE_MS,
      createdAt: now,
      updatedAt: now,
    };
    await ctx.db.insert('nodeslide_role_stages', row);
    return { state: 'acquired' as const, stage: row };
  },
});

export const completeInternal = internalMutation({
  args: {
    stageId: v.string(),
    ownerAccessKey: v.string(),
    leaseId: v.string(),
    inputDigest: v.string(),
    status: v.union(v.literal('completed'), v.literal('fallback')),
    outputJson: v.string(),
    outputDigest: v.string(),
    callId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stage = await ctx.db
      .query('nodeslide_role_stages')
      .withIndex('by_stable_id', (index) => index.eq('id', args.stageId))
      .unique();
    if (!stage) throw new Error('Cognitive stage is unavailable.');
    await requireOwnerAccess(ctx, stage.deckId, args.ownerAccessKey);
    const job = await ctx.db
      .query('nodeslide_agent_jobs')
      .withIndex('by_stable_id', (index) => index.eq('id', stage.jobId))
      .unique();
    if (
      !job ||
      job.status !== 'running' ||
      job.ownerDigest !== nodeSlideJobOwnerDigest(args.ownerAccessKey)
    ) {
      throw new Error('Cognitive stage completion lost its durable job lease.');
    }
    if (stage.status !== 'running') {
      if (
        stage.inputDigest === args.inputDigest &&
        stage.outputDigest === args.outputDigest &&
        stage.outputJson === args.outputJson
      ) {
        return stage;
      }
      throw new Error('Cognitive stage is already terminal with different output.');
    }
    if (
      stage.leaseId !== args.leaseId ||
      stage.leaseExpiresAt <= Date.now() ||
      stage.inputDigest !== args.inputDigest
    ) {
      throw new Error('Cognitive stage lease or input binding is stale.');
    }
    if (new TextEncoder().encode(args.outputJson).byteLength > 16_000) {
      throw new Error('Cognitive stage output exceeds its durable bound.');
    }
    if (nodeslideContentDigest(args.outputJson) !== args.outputDigest) {
      throw new Error('Cognitive stage output digest mismatch.');
    }
    const now = Date.now();
    await ctx.db.patch(stage._id, {
      status: args.status,
      outputJson: args.outputJson,
      outputDigest: args.outputDigest,
      ...(args.callId ? { callId: clean(args.callId, 256) } : {}),
      updatedAt: now,
      completedAt: now,
      leaseExpiresAt: now,
    });
    return { ...stage, ...args, updatedAt: now, completedAt: now, leaseExpiresAt: now };
  },
});

export const failInternal = internalMutation({
  args: {
    stageId: v.string(),
    ownerAccessKey: v.string(),
    leaseId: v.string(),
    inputDigest: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const stage = await ctx.db
      .query('nodeslide_role_stages')
      .withIndex('by_stable_id', (index) => index.eq('id', args.stageId))
      .unique();
    if (!stage) throw new Error('Cognitive stage is unavailable.');
    await requireOwnerAccess(ctx, stage.deckId, args.ownerAccessKey);
    const job = await ctx.db
      .query('nodeslide_agent_jobs')
      .withIndex('by_stable_id', (index) => index.eq('id', stage.jobId))
      .unique();
    if (
      !job ||
      job.status !== 'running' ||
      job.ownerDigest !== nodeSlideJobOwnerDigest(args.ownerAccessKey)
    ) {
      throw new Error('Cognitive stage failure lost its durable job lease.');
    }
    if (stage.status === 'completed' || stage.status === 'fallback') return stage;

    const outputJson = JSON.stringify({ error: cleanFailure(args.error) });
    const outputDigest = nodeslideContentDigest(outputJson);
    if (stage.status === 'failed') {
      if (
        stage.leaseId === args.leaseId &&
        stage.inputDigest === args.inputDigest &&
        stage.outputJson === outputJson &&
        stage.outputDigest === outputDigest
      ) {
        return stage;
      }
      throw new Error('Cognitive stage failure is already bound to a different attempt.');
    }
    if (stage.leaseId !== args.leaseId || stage.inputDigest !== args.inputDigest) {
      throw new Error('Cognitive stage failure lease or input binding is stale.');
    }

    const now = Date.now();
    await ctx.db.patch(stage._id, {
      status: 'failed',
      outputJson,
      outputDigest,
      updatedAt: now,
      completedAt: now,
      leaseExpiresAt: now,
    });
    return {
      ...stage,
      status: 'failed' as const,
      outputJson,
      outputDigest,
      updatedAt: now,
      completedAt: now,
      leaseExpiresAt: now,
    };
  },
});

export const list = query({
  args: { jobId: v.string(), deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const job = await ctx.db
      .query('nodeslide_agent_jobs')
      .withIndex('by_stable_id', (index) => index.eq('id', args.jobId))
      .unique();
    if (!job || job.ownerDigest !== nodeSlideJobOwnerDigest(args.ownerAccessKey)) return [];
    const rows = await ctx.db
      .query('nodeslide_role_stages')
      .withIndex('by_job_ordinal', (index) => index.eq('jobId', args.jobId))
      .take(8);
    return rows.map(
      ({ _id, _creationTime, outputJson: _outputJson, leaseId: _leaseId, ...row }) => row,
    );
  },
});

function clean(value: string, max: number): string {
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > max) throw new Error('Cognitive stage text is invalid.');
  return cleaned;
}

function cleanFailure(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 1_000) || 'Cognitive stage failed safely.';
}
