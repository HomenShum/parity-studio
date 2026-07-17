import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import {
  type MutationCtx,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';
import { nodeSlideCandidateDigest } from './lib/nodeslideCandidate';
import { loadNodeSlideSnapshot, sourceFromRow } from './lib/nodeslideData';
import { evaluateNodeSlideDeckCi } from './lib/nodeslideDeckCi';
import { captureNodeSlideWebEvidence } from './lib/nodeslideEvidenceCapture';
import { nodeslideContentDigest, nodeslideStableId } from './lib/nodeslideIds';
import { planNodeSlideSourceRefresh } from './lib/nodeslideSourceRefresh';
import { buildNodeSlideSourceRevision } from './lib/nodeslideSourceRevision';

const MIN_INTERVAL_MINUTES = 15;
const MAX_INTERVAL_MINUTES = 7 * 24 * 60;
const DUE_BATCH = 20;
const LEASE_MS = 2 * 60_000;
const MAX_FAILURES = 8;
const MAX_CHECKS_PER_DAY = 24;
const CHECK_WINDOW_MS = 24 * 60 * 60_000;
const MAX_PROPOSALS_PER_SOURCE = 40;

// biome-ignore lint/suspicious/noExplicitAny: generated self-reference for scheduled action cycle
const refreshInternal: any = (internal as any).nodeslideSourceRefresh;

export const configure = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    sourceId: v.string(),
    enabled: v.boolean(),
    intervalMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const intervalMinutes = boundedInterval(args.intervalMinutes);
    const source = await ctx.db
      .query('nodeslide_sources')
      .withIndex('by_stable_id', (index) => index.eq('id', args.sourceId))
      .unique();
    if (!source || source.deckId !== args.deckId || source.sourceType !== 'url' || !source.url) {
      throw new Error('Only an owner-authorized web source can be monitored.');
    }
    requireMonitorableUrl(source.url);
    const id = nodeslideStableId('source_refresh_schedule', args.deckId, args.sourceId);
    const existing = await ctx.db
      .query('nodeslide_source_refresh_schedules')
      .withIndex('by_stable_id', (index) => index.eq('id', id))
      .unique();
    const now = Date.now();
    const row = {
      id,
      deckId: args.deckId,
      sourceId: args.sourceId,
      ownerDigest: evidenceOwnerDigest(args.ownerAccessKey),
      enabled: args.enabled,
      intervalMinutes,
      nextRunAt: args.enabled ? now : now + intervalMinutes * 60_000,
      status: args.enabled ? ('ready' as const) : ('disabled' as const),
      lastSemanticDigest:
        existing?.lastSemanticDigest ?? source.contentDigest ?? semanticDigest(source.citation),
      failureCount: existing?.failureCount ?? 0,
      checksInWindow: existing?.checksInWindow ?? 0,
      windowStartedAt: existing?.windowStartedAt ?? now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...row,
        leaseId: undefined,
        leaseExpiresAt: undefined,
        lastError: undefined,
      });
    } else await ctx.db.insert('nodeslide_source_refresh_schedules', row);
    return publicSchedule(row);
  },
});

export const list = query({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const ownerDigest = evidenceOwnerDigest(args.ownerAccessKey);
    const [schedules, proposals] = await Promise.all([
      ctx.db
        .query('nodeslide_source_refresh_schedules')
        .withIndex('by_deck_updated', (index) => index.eq('deckId', args.deckId))
        .order('desc')
        .take(64),
      ctx.db
        .query('nodeslide_source_refresh_proposals')
        .withIndex('by_deck_status_created', (index) => index.eq('deckId', args.deckId))
        .order('desc')
        .take(64),
    ]);
    return {
      schedules: schedules.filter((row) => row.ownerDigest === ownerDigest).map(publicSchedule),
      proposals: proposals.filter((row) => row.ownerDigest === ownerDigest).map(publicProposal),
    };
  },
});

export const dismiss = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string(), proposalId: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const proposal = await ctx.db
      .query('nodeslide_source_refresh_proposals')
      .withIndex('by_stable_id', (index) => index.eq('id', args.proposalId))
      .unique();
    if (
      !proposal ||
      proposal.deckId !== args.deckId ||
      proposal.ownerDigest !== evidenceOwnerDigest(args.ownerAccessKey)
    ) {
      throw new Error('Source refresh proposal is unavailable.');
    }
    if (proposal.status === 'ready' || proposal.status === 'prepared') {
      await ctx.db.patch(proposal._id, { status: 'dismissed', updatedAt: Date.now() });
    }
    return { ...publicProposal(proposal), status: 'dismissed' as const };
  },
});

/** Returns a bounded handoff for the existing consented edit-proposal workflow. */
export const prepareEdit = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string(), proposalId: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const proposal = await ctx.db
      .query('nodeslide_source_refresh_proposals')
      .withIndex('by_stable_id', (index) => index.eq('id', args.proposalId))
      .unique();
    if (
      !proposal ||
      proposal.deckId !== args.deckId ||
      proposal.ownerDigest !== evidenceOwnerDigest(args.ownerAccessKey) ||
      (proposal.status !== 'ready' && proposal.status !== 'prepared')
    ) {
      throw new Error('Source refresh proposal is unavailable.');
    }
    const snapshot = await loadNodeSlideSnapshot(ctx, args.deckId);
    if (
      !snapshot ||
      snapshot.deck.version !== proposal.baseDeckVersion ||
      nodeSlideCandidateDigest(snapshot) !== proposal.baseSnapshotDigest
    ) {
      await ctx.db.patch(proposal._id, { status: 'stale', updatedAt: Date.now() });
      return { status: 'stale' as const, proposalId: proposal.id };
    }
    const source = await ctx.db
      .query('nodeslide_sources')
      .withIndex('by_stable_id', (index) => index.eq('id', proposal.sourceId))
      .unique();
    const revision = await ctx.db
      .query('nodeslide_source_revisions')
      .withIndex('by_stable_id', (index) => index.eq('id', proposal.afterRevisionId))
      .unique();
    if (!source || !revision || source.deckId !== args.deckId || revision.deckId !== args.deckId) {
      throw new Error('The reviewed source revision is unavailable.');
    }
    if (proposal.status === 'ready') {
      await ctx.db.patch(proposal._id, { status: 'prepared', updatedAt: Date.now() });
    }
    return {
      status: 'prepared' as const,
      proposalId: proposal.id,
      instruction: `Refresh only the source-bound content affected by updated source ${proposal.sourceId}. Preserve unrelated copy, layout, and styles. Re-check every changed claim and chart value against that source.`,
      readContext: [{ id: proposal.sourceId, kind: 'source' as const, label: 'Updated source' }],
      affectedSlideIds: proposal.affectedSlideIds,
      affectedElementIds: proposal.affectedElementIds,
      baseDeckVersion: proposal.baseDeckVersion,
      baseSnapshotDigest: proposal.baseSnapshotDigest,
    };
  },
});

export const validatePreparedBindingInternal = internalQuery({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    proposalId: v.string(),
    baseSnapshotDigest: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const proposal = await ctx.db
      .query('nodeslide_source_refresh_proposals')
      .withIndex('by_stable_id', (index) => index.eq('id', args.proposalId))
      .unique();
    if (
      !proposal ||
      proposal.deckId !== args.deckId ||
      proposal.ownerDigest !== evidenceOwnerDigest(args.ownerAccessKey) ||
      proposal.status !== 'prepared'
    ) {
      throw new Error('The monitored-source update is not prepared for this deck.');
    }
    const snapshot = await loadNodeSlideSnapshot(ctx, args.deckId);
    if (
      !snapshot ||
      proposal.baseSnapshotDigest !== args.baseSnapshotDigest ||
      nodeSlideCandidateDigest(snapshot) !== args.baseSnapshotDigest
    ) {
      throw new Error('The monitored-source update binding is stale.');
    }
    const source = await ctx.db
      .query('nodeslide_sources')
      .withIndex('by_stable_id', (index) => index.eq('id', proposal.sourceId))
      .unique();
    const revision = await ctx.db
      .query('nodeslide_source_revisions')
      .withIndex('by_stable_id', (index) => index.eq('id', proposal.afterRevisionId))
      .unique();
    if (!source || !revision || source.deckId !== args.deckId || revision.deckId !== args.deckId) {
      throw new Error('The prepared source revision is unavailable.');
    }
    return {
      sourceId: proposal.sourceId,
      affectedSlideIds: proposal.affectedSlideIds,
      affectedElementIds: proposal.affectedElementIds,
      baseSnapshotDigest: args.baseSnapshotDigest,
      pendingSource: {
        ...source,
        title: revision.title,
        ...(revision.url ? { url: revision.url } : {}),
        sourceType: revision.sourceType,
        retrievedAt: revision.retrievedAt,
        citation: revision.citation,
        ...(revision.license ? { license: revision.license } : {}),
        ...(revision.format ? { format: revision.format } : {}),
        contentDigest: revision.contentDigest,
        ...(revision.byteSize !== undefined ? { byteSize: revision.byteSize } : {}),
        ...(revision.rowCount !== undefined ? { rowCount: revision.rowCount } : {}),
        ...(revision.columns ? { columns: revision.columns } : {}),
        ...(revision.provider ? { provider: revision.provider } : {}),
        ...(revision.retention ? { retention: revision.retention } : {}),
        status: 'ready' as const,
      },
    };
  },
});

export const scanDueInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query('nodeslide_source_refresh_schedules')
      .withIndex('by_due', (index) => index.eq('enabled', true).lte('nextRunAt', now))
      .take(DUE_BATCH);
    let claimed = 0;
    for (const schedule of due) {
      if (schedule.leaseExpiresAt && schedule.leaseExpiresAt > now) continue;
      const windowStartedAt = schedule.windowStartedAt ?? now;
      const windowExpired = now - windowStartedAt >= CHECK_WINDOW_MS;
      const checksInWindow = windowExpired ? 0 : (schedule.checksInWindow ?? 0);
      if (checksInWindow >= MAX_CHECKS_PER_DAY) {
        await ctx.db.patch(schedule._id, {
          status: 'backoff',
          nextRunAt: windowStartedAt + CHECK_WINDOW_MS,
          lastError: 'Daily source-monitoring check limit reached.',
          updatedAt: now,
        });
        continue;
      }
      const leaseId = nodeslideStableId('source_refresh_lease', schedule.id, String(now));
      await ctx.db.patch(schedule._id, {
        status: 'checking',
        leaseId,
        leaseExpiresAt: now + LEASE_MS,
        checksInWindow: checksInWindow + 1,
        windowStartedAt: windowExpired ? now : windowStartedAt,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, refreshInternal.refreshOneInternal, {
        scheduleId: schedule.id,
        leaseId,
      });
      claimed += 1;
    }
    return { scanned: due.length, claimed };
  },
});

export const refreshOneInternal = internalAction({
  args: { scheduleId: v.string(), leaseId: v.string() },
  handler: async (ctx, args) => {
    const target = await ctx.runMutation(refreshInternal.readClaimInternal, args);
    if (!target) return { status: 'skipped' as const };
    const apiKey = process.env['FIRECRAWL_API_KEY']?.trim();
    if (!apiKey) {
      await ctx.runMutation(refreshInternal.recordFailureInternal, {
        ...args,
        error: 'Web source monitoring is not configured on this deployment.',
      });
      return { status: 'failed' as const };
    }
    const capture = await captureNodeSlideWebEvidence({ url: target.url, apiKey });
    if (!capture.ok || !capture.markdown.trim()) {
      await ctx.runMutation(refreshInternal.recordFailureInternal, {
        ...args,
        error: capture.ok
          ? 'The source returned no semantic text.'
          : (capture.issue?.message ?? 'The source could not be refreshed.'),
      });
      return { status: 'failed' as const };
    }
    try {
      return await ctx.runMutation(refreshInternal.commitObservationInternal, {
        ...args,
        title: capture.title,
        markdown: normalizedSemanticText(capture.markdown),
        semanticDigest: semanticDigest(capture.markdown),
        observedAt: capture.completedAt,
      });
    } catch (error) {
      await ctx.runMutation(refreshInternal.recordFailureInternal, {
        ...args,
        error: error instanceof Error ? error.message : 'Source refresh commit failed.',
      });
      return { status: 'failed' as const };
    }
  },
});

export const readClaimInternal = internalMutation({
  args: { scheduleId: v.string(), leaseId: v.string() },
  handler: async (ctx, args) => {
    const schedule = await requiredSchedule(ctx, args.scheduleId);
    if (!ownsLease(schedule, args.leaseId, Date.now())) return null;
    const source = await ctx.db
      .query('nodeslide_sources')
      .withIndex('by_stable_id', (index) => index.eq('id', schedule.sourceId))
      .unique();
    if (!source || source.deckId !== schedule.deckId || !source.url) return null;
    return { url: requireMonitorableUrl(source.url) };
  },
});

export const commitObservationInternal = internalMutation({
  args: {
    scheduleId: v.string(),
    leaseId: v.string(),
    title: v.string(),
    markdown: v.string(),
    semanticDigest: v.string(),
    observedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const schedule = await requiredSchedule(ctx, args.scheduleId);
    if (!ownsLease(schedule, args.leaseId, now)) throw new Error('Source refresh lease is stale.');
    const source = await ctx.db
      .query('nodeslide_sources')
      .withIndex('by_stable_id', (index) => index.eq('id', schedule.sourceId))
      .unique();
    const snapshot = await loadNodeSlideSnapshot(ctx, schedule.deckId);
    if (!source || source.deckId !== schedule.deckId || !snapshot) {
      throw new Error('Source refresh target is unavailable.');
    }
    const nextRunAt = now + schedule.intervalMinutes * 60_000;
    if (
      nodeSlideSourceRefreshObservationKind(schedule.lastSemanticDigest, args.semanticDigest) ===
      'unchanged'
    ) {
      await ctx.db.patch(schedule._id, {
        status: 'ready',
        nextRunAt,
        failureCount: 0,
        lastCheckedAt: now,
        lastError: undefined,
        leaseId: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
      });
      return { status: 'unchanged' as const, proposalId: null };
    }

    const before = sourceFromRow(source);
    const citation = normalizedSemanticText(args.markdown).slice(0, 7_000);
    const after = {
      ...before,
      title: cleanTitle(args.title, before.title),
      retrievedAt: Math.max(0, Math.floor(args.observedAt)),
      citation,
      contentDigest: args.semanticDigest,
      byteSize: new TextEncoder().encode(citation).byteLength,
      provider: 'firecrawl',
      status: 'ready' as const,
      lastRefreshedAt: now,
    };
    const beforeRevision = await ensureRevision(ctx, before, schedule.ownerDigest, now);
    const afterRevision = await ensureRevision(ctx, after, schedule.ownerDigest, now);
    const nextSnapshot = {
      ...snapshot,
      sources: snapshot.sources.map((candidate) => (candidate.id === after.id ? after : candidate)),
    };
    const claimReceipts = await ctx.db
      .query('nodeslide_claim_evidence_receipts')
      .withIndex('by_deck_created', (index) => index.eq('deckId', schedule.deckId))
      .order('desc')
      .take(256);
    const elementsById = new Map(snapshot.elements.map((element) => [element.id, element]));
    const claimSourceBindings = claimReceipts
      .filter((receipt) => receipt.sourceRevisionId === beforeRevision.revisionId)
      .map((receipt) => ({
        operationIndex: 0,
        operation:
          elementsById.get(receipt.elementId)?.kind === 'chart'
            ? ('update_chart' as const)
            : ('replace_text' as const),
        slideId: receipt.slideId,
        elementId: receipt.elementId,
        sourceIds: [after.id],
        claimDigest: receipt.claimDigest,
      }));
    const plan = planNodeSlideSourceRefresh({
      snapshot: nextSnapshot,
      before,
      after,
      claimSourceBindings,
    });
    const deckCi = evaluateNodeSlideDeckCi(nextSnapshot, { changedSourceIds: [after.id] });
    const planJson = JSON.stringify(plan);
    if (new TextEncoder().encode(planJson).byteLength > 120_000) {
      throw new Error('Source refresh impact plan exceeds its durable bound.');
    }
    const baseSnapshotDigest = nodeSlideCandidateDigest(snapshot);
    const proposalId = nodeslideStableId(
      'source_refresh_proposal',
      schedule.id,
      afterRevision.revisionDigest,
      baseSnapshotDigest,
    );
    const existingProposal = await ctx.db
      .query('nodeslide_source_refresh_proposals')
      .withIndex('by_stable_id', (index) => index.eq('id', proposalId))
      .unique();
    const priorProposals = await ctx.db
      .query('nodeslide_source_refresh_proposals')
      .withIndex('by_source_created', (index) => index.eq('sourceId', schedule.sourceId))
      .order('desc')
      .take(MAX_PROPOSALS_PER_SOURCE + 32);
    for (const prior of priorProposals) {
      if (prior.id === proposalId) continue;
      if (prior.status === 'ready') {
        await ctx.db.patch(prior._id, { status: 'stale', updatedAt: now });
      }
    }
    for (const expired of priorProposals.slice(MAX_PROPOSALS_PER_SOURCE - 1)) {
      if (expired.id !== proposalId && expired.status !== 'ready') await ctx.db.delete(expired._id);
    }
    if (!existingProposal) {
      await ctx.db.insert('nodeslide_source_refresh_proposals', {
        id: proposalId,
        deckId: schedule.deckId,
        sourceId: schedule.sourceId,
        ownerDigest: schedule.ownerDigest,
        scheduleId: schedule.id,
        status: 'ready',
        baseDeckVersion: snapshot.deck.version,
        baseSnapshotDigest,
        beforeRevisionId: beforeRevision.revisionId,
        afterRevisionId: afterRevision.revisionId,
        afterRevisionDigest: afterRevision.revisionDigest,
        planDigest: plan.digest,
        planJson,
        deckCiDigest: deckCi.digest,
        affectedSlideIds: plan.affectedSlides.map((slide) => slide.slideId),
        affectedElementIds: plan.affectedElements.map((element) => element.elementId),
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(schedule._id, {
      status: 'ready',
      nextRunAt,
      lastSemanticDigest: args.semanticDigest,
      failureCount: 0,
      lastCheckedAt: now,
      lastChangedAt: now,
      lastError: undefined,
      leaseId: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    return { status: 'changed' as const, proposalId };
  },
});

export const recordFailureInternal = internalMutation({
  args: { scheduleId: v.string(), leaseId: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const schedule = await requiredSchedule(ctx, args.scheduleId);
    if (!ownsLease(schedule, args.leaseId, now)) return false;
    const failureCount = Math.min(MAX_FAILURES, schedule.failureCount + 1);
    const backoffMinutes = nodeSlideSourceRefreshBackoffMinutes(
      schedule.intervalMinutes,
      failureCount,
    );
    await ctx.db.patch(schedule._id, {
      status: 'backoff',
      failureCount,
      nextRunAt: now + backoffMinutes * 60_000,
      lastCheckedAt: now,
      lastError: args.error.replace(/\s+/gu, ' ').trim().slice(0, 500),
      leaseId: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    return true;
  },
});

async function ensureRevision(
  ctx: Parameters<typeof requiredSchedule>[0],
  source: ReturnType<typeof sourceFromRow>,
  ownerDigest: string,
  createdAt: number,
) {
  const contentDigest = source.contentDigest ?? semanticDigest(source.citation);
  const existing = await ctx.db
    .query('nodeslide_source_revisions')
    .withIndex('by_source_content_digest', (index) =>
      index.eq('sourceId', source.id).eq('contentDigest', contentDigest),
    )
    .unique();
  if (existing) {
    if (existing.deckId !== source.deckId || existing.ownerDigest !== ownerDigest) {
      throw new Error('Source revision crossed its owner or deck boundary.');
    }
    return { revisionId: existing.id, revisionDigest: existing.revisionDigest };
  }
  const predecessor = await ctx.db
    .query('nodeslide_source_revisions')
    .withIndex('by_source_created', (index) => index.eq('sourceId', source.id))
    .order('desc')
    .first();
  const revision = buildNodeSlideSourceRevision({
    source: { ...source, contentDigest },
    ...(predecessor
      ? {
          predecessor: {
            revisionId: predecessor.id,
            revisionDigest: predecessor.revisionDigest,
          },
        }
      : {}),
  });
  await ctx.db.insert('nodeslide_source_revisions', {
    id: revision.revisionId,
    schema: revision.schema,
    revisionDigest: revision.revisionDigest,
    ownerDigest,
    deckId: revision.deckId,
    sourceId: revision.sourceId,
    title: revision.title,
    ...(revision.url ? { url: revision.url } : {}),
    sourceType: revision.sourceType,
    retrievedAt: revision.retrievedAt,
    citation: revision.citation,
    ...(revision.license ? { license: revision.license } : {}),
    ...(revision.format ? { format: revision.format } : {}),
    contentDigest: revision.contentDigest,
    ...(revision.byteSize !== undefined ? { byteSize: revision.byteSize } : {}),
    ...(revision.rowCount !== undefined ? { rowCount: revision.rowCount } : {}),
    ...(revision.columns ? { columns: [...revision.columns] } : {}),
    ...(revision.provider ? { provider: revision.provider } : {}),
    ...(revision.retention ? { retention: revision.retention } : {}),
    ...(revision.predecessor
      ? {
          predecessorRevisionId: revision.predecessor.revisionId,
          predecessorRevisionDigest: revision.predecessor.revisionDigest,
        }
      : {}),
    createdAt,
  });
  return { revisionId: revision.revisionId, revisionDigest: revision.revisionDigest };
}

async function requiredSchedule(
  ctx: Pick<MutationCtx, 'db'>,
  scheduleId: string,
): Promise<Doc<'nodeslide_source_refresh_schedules'>> {
  const schedule = await ctx.db
    .query('nodeslide_source_refresh_schedules')
    .withIndex('by_stable_id', (index) => index.eq('id', scheduleId))
    .unique();
  if (!schedule) throw new Error('Source refresh schedule is unavailable.');
  return schedule;
}

function ownsLease(
  schedule: { enabled: boolean; status: string; leaseId?: string; leaseExpiresAt?: number },
  leaseId: string,
  now: number,
): boolean {
  return Boolean(
    schedule.enabled &&
      schedule.status === 'checking' &&
      schedule.leaseId === leaseId &&
      schedule.leaseExpiresAt &&
      schedule.leaseExpiresAt > now,
  );
}

function publicSchedule(
  row:
    | Omit<Doc<'nodeslide_source_refresh_schedules'>, '_id' | '_creationTime'>
    | Doc<'nodeslide_source_refresh_schedules'>,
) {
  return {
    id: row.id,
    deckId: row.deckId,
    sourceId: row.sourceId,
    enabled: row.enabled,
    intervalMinutes: row.intervalMinutes,
    nextRunAt: row.nextRunAt,
    status: row.status,
    failureCount: row.failureCount,
    lastCheckedAt: row.lastCheckedAt,
    lastChangedAt: row.lastChangedAt,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
  };
}

function publicProposal(row: Doc<'nodeslide_source_refresh_proposals'>) {
  return {
    id: row.id,
    deckId: row.deckId,
    sourceId: row.sourceId,
    status: row.status,
    baseDeckVersion: row.baseDeckVersion,
    planDigest: row.planDigest,
    deckCiDigest: row.deckCiDigest,
    affectedSlideIds: row.affectedSlideIds,
    affectedElementIds: row.affectedElementIds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function boundedInterval(value: number): number {
  const interval = Math.floor(value);
  if (
    !Number.isSafeInteger(interval) ||
    interval < MIN_INTERVAL_MINUTES ||
    interval > MAX_INTERVAL_MINUTES
  ) {
    throw new Error(
      `Source refresh interval must be ${MIN_INTERVAL_MINUTES}-${MAX_INTERVAL_MINUTES} minutes.`,
    );
  }
  return interval;
}

function evidenceOwnerDigest(ownerAccessKey: string): string {
  return `actor_${nodeslideContentDigest(ownerAccessKey)}`;
}

function normalizedSemanticText(value: string): string {
  return value
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function semanticDigest(value: string): string {
  return nodeslideContentDigest(normalizedSemanticText(value));
}

export function nodeSlideSourceRefreshSemanticDigest(value: string): string {
  return semanticDigest(value);
}

export function nodeSlideSourceRefreshObservationKind(
  previousDigest: string,
  observedDigest: string,
): 'unchanged' | 'changed' {
  return previousDigest === observedDigest ? 'unchanged' : 'changed';
}

export function nodeSlideSourceRefreshBackoffMinutes(
  intervalMinutes: number,
  failureCount: number,
): number {
  return Math.min(
    MAX_INTERVAL_MINUTES,
    boundedInterval(intervalMinutes) * 2 ** Math.min(6, Math.max(0, Math.floor(failureCount))),
  );
}

function cleanTitle(value: string, fallback: string): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, 180) || fallback;
}

function requireMonitorableUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('Monitored sources must use a credential-free HTTPS URL.');
  }
  parsed.hash = '';
  return parsed.toString();
}
