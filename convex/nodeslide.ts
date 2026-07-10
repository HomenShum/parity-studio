import { v } from 'convex/values';
import {
  type CommentAnchor,
  type DeckComment,
  type DeckPatch,
  type DeckSnapshot,
  type PatchOperation,
  type PatchScope,
  type PatchSource,
  type ValidationResult,
  clampNormalized,
} from '../shared/nodeslide';
import { applyDeckPatch } from '../shared/nodeslidePatch';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import {
  createOwnerAccessKey,
  createShareSlug,
  isOwnerAccessKey,
  requireOwnerAccess,
  requireShareSlug,
} from './lib/nodeslideAccess';
import {
  commentFromRow,
  deckFromRow,
  findCommentRow,
  findDeckRow,
  findDeckRowByShareSlug,
  findPatchRow,
  findVersionRow,
  insertNodeSlideSnapshot,
  loadNodeSlideSnapshot,
  loadNodeSlideWorkspace,
  patchFromRow,
  presenceFromRow,
  writeNodeSlideSnapshot,
} from './lib/nodeslideData';
import { nodeslideEventId, nodeslideHash, nodeslideStableId } from './lib/nodeslideIds';
import {
  type NodeSlidePatchInput,
  clocksForNodeSlideOperations,
  evaluateNodeSlideCas,
  validateNodeSlidePatch,
} from './lib/nodeslidePatches';
import {
  buildBriefNodeSlide,
  buildGoldenNodeSlide,
  repairLegacyGoldenSnapshot,
} from './lib/nodeslideSeed';
import { isNormalizedBoundingBox, validateNodeSlideSnapshot } from './lib/nodeslideValidation';
import {
  nodeslideBriefValidator,
  nodeslideCommentAnchorValidator,
  nodeslideCursorValidator,
  nodeslidePatchOperationValidator,
  nodeslidePatchScopeValidator,
  nodeslidePatchSourceValidator,
  nodeslideVersionClockValidator,
} from './lib/nodeslideValidators';

const PRESENCE_TTL_MS = 45_000;
const MAX_PATCH_OPERATIONS = 32;
const MAX_PRESENCE_ELEMENTS = 64;
const MAX_LISTED_DECKS = 32;
const patchArgs = {
  id: v.optional(v.string()),
  deckId: v.string(),
  ownerAccessKey: v.string(),
  baseDeckVersion: v.number(),
  baseSlideVersions: nodeslideVersionClockValidator,
  baseElementVersions: nodeslideVersionClockValidator,
  scope: nodeslidePatchScopeValidator,
  operations: v.array(nodeslidePatchOperationValidator),
  source: v.optional(nodeslidePatchSourceValidator),
  summary: v.optional(v.string()),
  linkedCommentId: v.optional(v.string()),
  traceId: v.optional(v.string()),
};

type PatchMutationArgs = {
  id?: string;
  deckId: string;
  ownerAccessKey: string;
  baseDeckVersion: number;
  baseSlideVersions: Record<string, number>;
  baseElementVersions: Record<string, number>;
  scope: PatchScope;
  operations: PatchOperation[];
  source?: PatchSource;
  summary?: string;
  linkedCommentId?: string;
  traceId?: string;
};

export const ensureWorkspace = mutation({
  args: { clientSessionId: v.string(), ownerAccessKey: v.optional(v.string()) },
  handler: async (ctx, { clientSessionId, ownerAccessKey: providedOwnerAccessKey }) => {
    const session = requiredText(clientSessionId, 'clientSessionId', 256);
    await consumePreviewQuotaBuckets(ctx, [
      { key: `workspace:${nodeslideHash(session)}`, limit: 100, windowMs: 86_400_000 },
      { key: 'workspace:global', limit: 1_000, windowMs: 3_600_000 },
    ]);
    const built = buildGoldenNodeSlide(session, Date.now());
    const existing = await findDeckRow(ctx, built.snapshot.deck.id);
    if (existing) {
      if (existing.clientSessionId !== session) throw new Error('NodeSlide stable-id collision.');
      // Existing anonymous-session rows predate owner capabilities. The stored
      // session is the only migration proof accepted for claiming those rows.
      if (!existing.ownerAccessKey) {
        const ownerAccessKey = createOwnerAccessKey();
        const now = Date.now();
        await ctx.db.patch(existing._id, { ownerAccessKey, updatedAt: now });
        if (!isSecureShareSlug(existing.shareSlug)) {
          await ctx.db.patch(existing._id, { shareSlug: createShareSlug(), updatedAt: now });
        }
        await migrateLegacyGoldenWorkspace(ctx, existing.id, built.snapshot, now);
        return await ownerWorkspaceResponse(ctx, existing.id, ownerAccessKey, now);
      }
      if (!providedOwnerAccessKey) throw new Error('NodeSlide owner access key is required.');
      await requireOwnerAccess(ctx, existing.id, providedOwnerAccessKey);
      const now = Date.now();
      if (!isSecureShareSlug(existing.shareSlug)) {
        await ctx.db.patch(existing._id, { shareSlug: createShareSlug(), updatedAt: now });
      }
      await migrateLegacyGoldenWorkspace(ctx, existing.id, built.snapshot, now);
      return await ownerWorkspaceResponse(ctx, existing.id, providedOwnerAccessKey, now);
    }
    const ownerAccessKey = createOwnerAccessKey();
    await createWorkspaceRows(ctx, {
      clientSessionId: session,
      ownerAccessKey,
      built,
      trace: {
        summary: 'Created the polished seven-slide NodeSlide golden workspace.',
        context: ['Anonymous session seed', 'Deterministic golden deck specification'],
        toolCalls: ['Built normalized deck snapshot', 'Ran structural and geometry validation'],
        provider: 'deterministic',
        model: 'golden-seed/v1',
      },
    });
    return await ownerWorkspaceResponse(ctx, built.snapshot.deck.id, ownerAccessKey, Date.now());
  },
});

export const listDecks = query({
  args: {
    access: v.array(v.object({ deckId: v.string(), ownerAccessKey: v.string() })),
  },
  handler: async (ctx, { access }) => {
    if (access.length > MAX_LISTED_DECKS) throw new Error('Too many NodeSlide decks requested.');
    const rows = await Promise.all(
      access.map(async ({ deckId, ownerAccessKey }) => {
        try {
          return deckFromRow(await requireOwnerAccess(ctx, deckId, ownerAccessKey));
        } catch {
          return null;
        }
      }),
    );
    return rows
      .filter((row) => row !== null)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  },
});

export const getWorkspace = query({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, { deckId, ownerAccessKey }) => {
    try {
      await requireOwnerAccess(ctx, deckId, ownerAccessKey);
    } catch {
      return null;
    }
    return await loadNodeSlideWorkspace(ctx, deckId, Date.now());
  },
});

export const getPresenterSnapshot = query({
  args: { shareSlug: v.string() },
  handler: async (ctx, { shareSlug }) => {
    const slug = requireShareSlug(shareSlug);
    const row = await findDeckRowByShareSlug(ctx, slug);
    if (!row || row.shareSlug !== slug) return null;
    return await loadNodeSlideSnapshot(ctx, row.id);
  },
});

export const applyPatch = mutation({
  args: patchArgs,
  handler: async (ctx, args) => await commitPatch(ctx, normalizePatchArgs(args), null),
});

export const proposePatch = mutation({
  args: patchArgs,
  handler: async (ctx, args) => await persistProposal(ctx, normalizePatchArgs(args)),
});

export const acceptPatch = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string(), patchId: v.string() },
  handler: async (ctx, { deckId, ownerAccessKey, patchId }) => {
    await requireOwnerAccess(ctx, deckId, ownerAccessKey);
    const row = await findPatchRow(ctx, patchId);
    if (!row || row.deckId !== deckId) throw new Error(`Patch ${patchId} not found.`);
    if (row.status === 'accepted' || row.status === 'stale') {
      return {
        patch: patchFromRow(row),
        workspace: await loadNodeSlideWorkspace(ctx, row.deckId, Date.now()),
      };
    }
    if (row.status === 'rejected') throw new Error(`Patch ${patchId} was rejected.`);
    return await commitPatch(ctx, { ...row, ownerAccessKey }, row);
  },
});

export const rejectPatch = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string(), patchId: v.string() },
  handler: async (ctx, { deckId, ownerAccessKey, patchId }) => {
    await requireOwnerAccess(ctx, deckId, ownerAccessKey);
    const row = await findPatchRow(ctx, patchId);
    if (!row || row.deckId !== deckId) throw new Error(`Patch ${patchId} not found.`);
    if (row.status === 'accepted') throw new Error('Accepted patches cannot be rejected.');
    if (row.status !== 'rejected') {
      const now = Date.now();
      await ctx.db.patch(row._id, { status: 'rejected', updatedAt: now });
      if (row.traceId) {
        const trace = await ctx.db
          .query('nodeslide_traces')
          .withIndex('by_stable_id', (index) => index.eq('id', row.traceId as string))
          .first();
        if (trace) await ctx.db.patch(trace._id, { status: 'cancelled', completedAt: now });
      }
    }
    const updated = await findPatchRow(ctx, patchId);
    return updated ? patchFromRow(updated) : null;
  },
});

export const restoreVersion = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    versionId: v.optional(v.string()),
    version: v.optional(v.number()),
    baseDeckVersion: v.number(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const current = await requireSnapshot(ctx, args.deckId);
    const target = await findVersionRow(ctx, args);
    if (!target) throw new Error('Restore target version not found.');
    const now = Date.now();
    const patchId = nodeslideEventId('patch_restore', now, args.deckId, target.id);
    const clocks = clocksForNodeSlideOperations(current, []);
    const receipt = {
      id: patchId,
      deckId: args.deckId,
      baseDeckVersion: args.baseDeckVersion,
      ...clocks,
      scope: { kind: 'deck', deckId: args.deckId, operationMode: 'unrestricted' } as const,
      operations: [] as PatchOperation[],
      source: 'system' as const,
      summary: `Restore version ${target.version} as a new write.`,
      createdAt: now,
      updatedAt: now,
    };
    if (args.baseDeckVersion !== current.deck.version) {
      await ctx.db.insert('nodeslide_patches', { ...receipt, status: 'stale' });
      return {
        patch: { ...receipt, status: 'stale' as const },
        workspace: await loadNodeSlideWorkspace(ctx, args.deckId, now),
      };
    }
    const restored = restoredSnapshot(current, target.snapshot, now);
    const validation = validateNodeSlideSnapshot(
      restored,
      now,
      nodeslideEventId('validation', now, args.deckId, 'restore'),
    );
    await writeNodeSlideSnapshot(ctx, current, restored, now);
    await ctx.db.insert('nodeslide_patches', {
      ...receipt,
      status: 'accepted',
      resultingDeckVersion: restored.deck.version,
    });
    await insertVersion(ctx, restored, `Restored v${target.version}`, 'system', patchId, now);
    await ctx.db.insert('nodeslide_validations', validation);
    return {
      patch: {
        ...receipt,
        status: 'accepted' as const,
        resultingDeckVersion: restored.deck.version,
      },
      snapshot: restored,
      validation,
      workspace: await loadNodeSlideWorkspace(ctx, args.deckId, now),
      rebased: false,
    };
  },
});

export const addComment = mutation({
  args: {
    id: v.optional(v.string()),
    deckId: v.string(),
    ownerAccessKey: v.string(),
    anchor: nodeslideCommentAnchorValidator,
    authorId: v.string(),
    authorName: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const snapshot = await requireSnapshot(ctx, args.deckId);
    validateAnchor(snapshot, args.anchor);
    const now = Date.now();
    const id = args.id ?? nodeslideEventId('comment', now, args.deckId, args.authorId, args.text);
    const existing = await findCommentRow(ctx, id);
    if (existing) return commentFromRow(existing);
    const comment = {
      id,
      deckId: args.deckId,
      anchor: args.anchor,
      authorId: requiredText(args.authorId, 'authorId', 256),
      authorName: requiredText(args.authorName, 'authorName', 80),
      text: requiredText(args.text, 'comment', 4000),
      status: 'open' as const,
      createdAt: now,
      updatedAt: now,
    };
    await ctx.db.insert('nodeslide_comments', comment);
    return comment;
  },
});

export const replyComment = mutation({
  args: {
    id: v.optional(v.string()),
    deckId: v.string(),
    ownerAccessKey: v.string(),
    parentId: v.string(),
    authorId: v.string(),
    authorName: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const parent = await findCommentRow(ctx, args.parentId);
    if (!parent || parent.deckId !== args.deckId)
      throw new Error(`Comment ${args.parentId} not found.`);
    const now = Date.now();
    const id =
      args.id ?? nodeslideEventId('comment_reply', now, args.parentId, args.authorId, args.text);
    const existing = await findCommentRow(ctx, id);
    if (existing) return commentFromRow(existing);
    const comment = {
      id,
      deckId: parent.deckId,
      parentId: parent.id,
      anchor: parent.anchor,
      authorId: requiredText(args.authorId, 'authorId', 256),
      authorName: requiredText(args.authorName, 'authorName', 80),
      text: requiredText(args.text, 'reply', 4000),
      status: 'open' as const,
      createdAt: now,
      updatedAt: now,
    };
    await ctx.db.insert('nodeslide_comments', comment);
    return comment;
  },
});

export const resolveComment = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    commentId: v.string(),
    linkedPatchId: v.optional(v.string()),
  },
  handler: async (ctx, { deckId, ownerAccessKey, commentId, linkedPatchId }) => {
    await requireOwnerAccess(ctx, deckId, ownerAccessKey);
    const comment = await findCommentRow(ctx, commentId);
    if (!comment || comment.deckId !== deckId) throw new Error(`Comment ${commentId} not found.`);
    if (linkedPatchId) {
      const patch = await findPatchRow(ctx, linkedPatchId);
      if (!patch || patch.deckId !== comment.deckId || patch.status !== 'accepted') {
        throw new Error('A comment can only link an accepted patch from the same deck.');
      }
    }
    await ctx.db.patch(comment._id, {
      status: 'resolved',
      ...(linkedPatchId ? { linkedPatchId } : {}),
      updatedAt: Date.now(),
    });
    const updated = await findCommentRow(ctx, commentId);
    return updated ? commentFromRow(updated) : null;
  },
});

export const reopenComment = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string(), commentId: v.string() },
  handler: async (ctx, { deckId, ownerAccessKey, commentId }) => {
    await requireOwnerAccess(ctx, deckId, ownerAccessKey);
    const comment = await findCommentRow(ctx, commentId);
    if (!comment || comment.deckId !== deckId) throw new Error(`Comment ${commentId} not found.`);
    await ctx.db.patch(comment._id, { status: 'open', updatedAt: Date.now() });
    const updated = await findCommentRow(ctx, commentId);
    return updated ? commentFromRow(updated) : null;
  },
});

export const touchPresence = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    sessionId: v.string(),
    displayName: v.string(),
    color: v.string(),
    slideId: v.optional(v.string()),
    elementIds: v.array(v.string()),
    cursor: v.optional(nodeslideCursorValidator),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    if (args.elementIds.length > MAX_PRESENCE_ELEMENTS) {
      throw new Error(`Presence supports at most ${MAX_PRESENCE_ELEMENTS} elements.`);
    }
    const snapshot = await requireSnapshot(ctx, args.deckId);
    const slides = new Set(snapshot.slides.map((slide) => slide.id));
    const elements = new Set(snapshot.elements.map((element) => element.id));
    if (args.slideId && !slides.has(args.slideId)) throw new Error('Presence slide is unknown.');
    if (args.elementIds.some((id) => !elements.has(id)))
      throw new Error('Presence element is unknown.');
    const now = Date.now();
    const expired = await ctx.db
      .query('nodeslide_presence')
      .withIndex('by_deck_expiry', (index) => index.eq('deckId', args.deckId).lte('expiresAt', now))
      .take(100);
    for (const row of expired) await ctx.db.delete(row._id);
    const existing = await ctx.db
      .query('nodeslide_presence')
      .withIndex('by_deck_session', (index) =>
        index.eq('deckId', args.deckId).eq('sessionId', args.sessionId),
      )
      .first();
    const value = {
      id: existing?.id ?? nodeslideStableId('presence', args.deckId, args.sessionId),
      deckId: args.deckId,
      sessionId: requiredText(args.sessionId, 'sessionId', 256),
      displayName: requiredText(args.displayName, 'displayName', 80),
      color: requiredText(args.color, 'color', 64),
      ...(args.slideId ? { slideId: args.slideId } : {}),
      elementIds: [...new Set(args.elementIds)],
      ...(args.cursor
        ? { cursor: { x: clampNormalized(args.cursor.x), y: clampNormalized(args.cursor.y) } }
        : {}),
      lastSeenAt: now,
      expiresAt: now + PRESENCE_TTL_MS,
    };
    if (existing) await ctx.db.replace(existing._id, value);
    else await ctx.db.insert('nodeslide_presence', value);
    const active = await ctx.db
      .query('nodeslide_presence')
      .withIndex('by_deck_expiry', (index) => index.eq('deckId', args.deckId).gt('expiresAt', now))
      .collect();
    return active.map(presenceFromRow);
  },
});

export const validateAndRecord = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, { deckId, ownerAccessKey }) => {
    await requireOwnerAccess(ctx, deckId, ownerAccessKey);
    const snapshot = await requireSnapshot(ctx, deckId);
    const now = Date.now();
    const result = validateNodeSlideSnapshot(
      snapshot,
      now,
      nodeslideEventId('validation', now, deckId),
    );
    await ctx.db.insert('nodeslide_validations', result);
    return result;
  },
});

export const consumePreviewQuota = internalMutation({
  args: {
    buckets: v.array(v.object({ key: v.string(), limit: v.number(), windowMs: v.number() })),
  },
  handler: async (ctx, { buckets }) => {
    await consumePreviewQuotaBuckets(ctx, buckets);
    return true;
  },
});

export const getAgentContextInternal = internalQuery({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, { deckId, ownerAccessKey }) => {
    await requireOwnerAccess(ctx, deckId, ownerAccessKey);
    return await loadNodeSlideWorkspace(ctx, deckId, Date.now());
  },
});

export const createFromBriefInternal = internalMutation({
  args: {
    deckId: v.string(),
    projectId: v.string(),
    clientSessionId: v.string(),
    ownerAccessKey: v.string(),
    title: v.string(),
    brief: nodeslideBriefValidator,
    themeId: v.string(),
    route: v.union(v.literal('free'), v.literal('balanced'), v.literal('frontier')),
    plan: v.array(v.string()),
    spec: v.any(),
    traceSummary: v.string(),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    costMicroUsd: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!isOwnerAccessKey(args.ownerAccessKey))
      throw new Error('Invalid NodeSlide owner access key.');
    const existing = await findDeckRow(ctx, args.deckId);
    if (existing) {
      await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
      return await ownerWorkspaceResponse(ctx, args.deckId, args.ownerAccessKey, Date.now());
    }
    if (args.plan.length > 12) throw new Error('NodeSlide plans support at most 12 steps.');
    const built = buildBriefNodeSlide({
      deckId: args.deckId,
      projectId: args.projectId,
      title: args.title,
      brief: args.brief,
      themeId: args.themeId,
      rawSpec: args.spec,
      plan: args.plan,
      now: Date.now(),
    });
    await createWorkspaceRows(ctx, {
      clientSessionId: args.clientSessionId,
      ownerAccessKey: args.ownerAccessKey,
      built,
      trace: {
        summary: args.traceSummary,
        context: [
          `Requested route: ${args.route}`,
          'Persisted deterministic plan and deck specification',
        ],
        toolCalls: [
          'Planned six-to-eight slide narrative',
          'Built normalized deck',
          'Validated snapshot',
        ],
        ...(args.provider ? { provider: args.provider } : {}),
        ...(args.model ? { model: args.model } : {}),
        ...(args.costMicroUsd !== undefined ? { costMicroUsd: args.costMicroUsd } : {}),
        ...(args.inputTokens !== undefined ? { inputTokens: args.inputTokens } : {}),
        ...(args.outputTokens !== undefined ? { outputTokens: args.outputTokens } : {}),
      },
    });
    return await ownerWorkspaceResponse(ctx, args.deckId, args.ownerAccessKey, Date.now());
  },
});

export const proposeAgentPatchInternal = internalMutation({
  args: {
    ...patchArgs,
    id: v.string(),
    traceId: v.string(),
    instruction: v.string(),
    traceSummary: v.string(),
    toolCalls: v.array(v.string()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    costMicroUsd: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    if (args.toolCalls.length > 16) throw new Error('Too many agent tool calls recorded.');
    const proposal = await persistProposal(ctx, { ...args, source: 'agent' });
    const now = Date.now();
    const validation = proposal.workspace?.validations[0];
    await ctx.db.insert('nodeslide_traces', {
      id: args.traceId,
      deckId: args.deckId,
      patchId: args.id,
      status: proposal.patch.status === 'stale' ? 'failed' : 'awaiting_review',
      summary: args.traceSummary,
      plan: [
        'Read scoped deck context',
        'Draft bounded operations',
        'Validate clocks, scope, locks, and geometry',
        'Save proposal for review',
      ],
      context: [
        `Instruction: ${requiredText(args.instruction, 'instruction', 2000)}`,
        `Base deck version: ${args.baseDeckVersion}`,
      ],
      toolCalls: args.toolCalls,
      guardrails: [
        'Explicit scope only',
        'Locked elements are immutable',
        'Fine-grained CAS before commit',
        'No provider secrets persisted',
      ],
      ...(validation ? { validation } : {}),
      ...(args.provider ? { provider: args.provider } : {}),
      ...(args.model ? { model: args.model } : {}),
      ...(args.costMicroUsd !== undefined ? { costMicroUsd: args.costMicroUsd } : {}),
      ...(args.inputTokens !== undefined ? { inputTokens: args.inputTokens } : {}),
      ...(args.outputTokens !== undefined ? { outputTokens: args.outputTokens } : {}),
      createdAt: now,
      ...(proposal.patch.status === 'stale' ? { completedAt: now } : {}),
    });
    return proposal;
  },
});

async function persistProposal(ctx: MutationCtx, args: PatchMutationArgs) {
  await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
  assertPatchOperationCount(args.operations);
  const snapshot = await requireSnapshot(ctx, args.deckId);
  const existing = args.id ? await findPatchRow(ctx, args.id) : null;
  if (existing)
    return {
      patch: patchFromRow(existing),
      workspace: await loadNodeSlideWorkspace(ctx, args.deckId, Date.now()),
    };
  const scopedComment = await commentForScope(ctx, args.scope);
  const input = patchInput(args);
  const errors = validateNodeSlidePatch(snapshot, input, scopedComment);
  if (errors.length) throw new Error(errors.join(' '));
  const cas = evaluateNodeSlideCas(snapshot, input);
  const now = Date.now();
  const row = patchRow(args, now, cas.canCommit ? 'ready' : 'stale');
  await ctx.db.insert('nodeslide_patches', row);
  return {
    patch: row,
    workspace: await loadNodeSlideWorkspace(ctx, args.deckId, now),
    rebased: cas.rebased,
    staleReasons: cas.reasons,
  };
}

async function commitPatch(
  ctx: MutationCtx,
  args: PatchMutationArgs,
  existing: Doc<'nodeslide_patches'> | null,
) {
  await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
  assertPatchOperationCount(args.operations);
  const snapshot = await requireSnapshot(ctx, args.deckId);
  const scopedComment = await commentForScope(ctx, args.scope);
  const input = patchInput(args);
  const errors = validateNodeSlidePatch(snapshot, input, scopedComment);
  if (errors.length) throw new Error(errors.join(' '));
  const cas = evaluateNodeSlideCas(snapshot, input);
  const now = Date.now();
  const id =
    existing?.id ?? args.id ?? nodeslideEventId('patch', now, args.deckId, args.summary ?? 'apply');
  if (!cas.canCommit) {
    const stale = patchRow({ ...args, id }, now, 'stale', existing?.createdAt);
    if (existing) await ctx.db.patch(existing._id, { status: 'stale', updatedAt: now });
    else await ctx.db.insert('nodeslide_patches', stale);
    if (existing?.traceId) await finishTrace(ctx, existing.traceId, now, 'failed');
    return {
      patch: stale,
      workspace: await loadNodeSlideWorkspace(ctx, args.deckId, now),
      rebased: false,
      staleReasons: cas.reasons,
    };
  }
  const applied = applyDeckPatch(
    snapshot,
    { baseDeckVersion: snapshot.deck.version, scope: args.scope, operations: args.operations },
    now,
  );
  const validation = validateNodeSlideSnapshot(
    applied.snapshot,
    now,
    nodeslideEventId('validation', now, id),
  );
  const accepted = patchRow(
    { ...args, id },
    now,
    'accepted',
    existing?.createdAt,
    applied.snapshot.deck.version,
  );
  await writeNodeSlideSnapshot(ctx, snapshot, applied.snapshot, now);
  if (existing) {
    await ctx.db.patch(existing._id, {
      status: 'accepted',
      resultingDeckVersion: applied.snapshot.deck.version,
      updatedAt: now,
    });
  } else await ctx.db.insert('nodeslide_patches', accepted);
  await insertVersion(
    ctx,
    applied.snapshot,
    args.summary ?? 'Applied patch',
    args.source ?? 'human',
    id,
    now,
  );
  await ctx.db.insert('nodeslide_validations', validation);
  if (args.linkedCommentId)
    await resolveLinkedComment(ctx, args.linkedCommentId, args.deckId, id, now);
  if (args.traceId) await finishTrace(ctx, args.traceId, now, 'completed', validation, id);
  return { patch: accepted, snapshot: applied.snapshot, validation, rebased: cas.rebased };
}

function normalizePatchArgs<T extends PatchMutationArgs>(args: T): PatchMutationArgs {
  assertPatchOperationCount(args.operations);
  return {
    ...args,
    source: args.source ?? 'human',
    summary: args.summary?.trim() || 'Applied scoped NodeSlide change.',
  };
}

function assertPatchOperationCount(operations: readonly PatchOperation[]) {
  if (operations.length > MAX_PATCH_OPERATIONS) {
    throw new Error(`NodeSlide patches support at most ${MAX_PATCH_OPERATIONS} operations.`);
  }
}

function patchInput(args: PatchMutationArgs): NodeSlidePatchInput {
  return {
    deckId: args.deckId,
    baseDeckVersion: args.baseDeckVersion,
    baseSlideVersions: args.baseSlideVersions,
    baseElementVersions: args.baseElementVersions,
    scope: args.scope,
    operations: args.operations,
  };
}

function patchRow(
  args: PatchMutationArgs,
  now: number,
  status: 'ready' | 'accepted' | 'stale',
  createdAt = now,
  resultingDeckVersion?: number,
): DeckPatch {
  return {
    id: args.id ?? nodeslideEventId('patch', now, args.deckId, args.summary ?? 'patch'),
    deckId: args.deckId,
    baseDeckVersion: args.baseDeckVersion,
    baseSlideVersions: args.baseSlideVersions,
    baseElementVersions: args.baseElementVersions,
    ...(resultingDeckVersion !== undefined ? { resultingDeckVersion } : {}),
    scope: args.scope,
    operations: args.operations,
    source: args.source ?? 'human',
    status,
    summary: args.summary?.trim() || 'Scoped NodeSlide change.',
    ...(args.linkedCommentId ? { linkedCommentId: args.linkedCommentId } : {}),
    ...(args.traceId ? { traceId: args.traceId } : {}),
    createdAt,
    updatedAt: now,
  };
}

async function createWorkspaceRows(
  ctx: MutationCtx,
  args: {
    clientSessionId: string;
    ownerAccessKey: string;
    built: ReturnType<typeof buildGoldenNodeSlide>;
    trace: {
      summary: string;
      context: string[];
      toolCalls: string[];
      provider?: string;
      model?: string;
      costMicroUsd?: number;
      inputTokens?: number;
      outputTokens?: number;
    };
  },
) {
  if (!isOwnerAccessKey(args.ownerAccessKey))
    throw new Error('Invalid NodeSlide owner access key.');
  const { snapshot: builtSnapshot, plan, spec } = args.built;
  const snapshot: DeckSnapshot = {
    ...builtSnapshot,
    deck: { ...builtSnapshot.deck, shareSlug: createShareSlug() },
  };
  const now = snapshot.deck.createdAt;
  const projectRowId = await ctx.db.insert('projects', {
    clientSessionId: args.clientSessionId,
    title: snapshot.deck.title,
    domain: 'nodeslide',
    brief: snapshot.deck.brief,
    sourceType: 'prompt',
    starred: false,
    createdAt: now,
    updatedAt: now,
  });
  await insertNodeSlideSnapshot(ctx, {
    snapshot,
    projectRowId,
    clientSessionId: args.clientSessionId,
    ownerAccessKey: args.ownerAccessKey,
    plan,
    spec,
  });
  const validation = validateNodeSlideSnapshot(
    snapshot,
    now,
    nodeslideStableId('validation', snapshot.deck.id, 'initial'),
  );
  await ctx.db.insert('nodeslide_validations', validation);
  await insertVersion(ctx, snapshot, 'Initial deck', 'system', undefined, now);
  await ctx.db.insert('nodeslide_traces', {
    id: nodeslideStableId('trace', snapshot.deck.id, 'creation'),
    deckId: snapshot.deck.id,
    status: 'completed',
    summary: args.trace.summary,
    plan,
    context: args.trace.context,
    toolCalls: args.trace.toolCalls,
    guardrails: [
      'Normalized geometry',
      'Source-aware content',
      'Stable external IDs',
      'Deterministic validation',
    ],
    validation,
    ...(args.trace.provider ? { provider: args.trace.provider } : {}),
    ...(args.trace.model ? { model: args.trace.model } : {}),
    ...(args.trace.costMicroUsd !== undefined ? { costMicroUsd: args.trace.costMicroUsd } : {}),
    ...(args.trace.inputTokens !== undefined ? { inputTokens: args.trace.inputTokens } : {}),
    ...(args.trace.outputTokens !== undefined ? { outputTokens: args.trace.outputTokens } : {}),
    createdAt: now,
    completedAt: now,
  });
}

async function insertVersion(
  ctx: MutationCtx,
  snapshot: DeckSnapshot,
  label: string,
  source: PatchSource,
  patchId: string | undefined,
  now: number,
) {
  await ctx.db.insert('nodeslide_versions', {
    id: nodeslideStableId('version', snapshot.deck.id, String(snapshot.deck.version)),
    deckId: snapshot.deck.id,
    version: snapshot.deck.version,
    label,
    source,
    ...(patchId ? { patchId } : {}),
    snapshot,
    createdAt: now,
  });
}

async function requireSnapshot(
  ctx: { db: MutationCtx['db'] },
  deckId: string,
): Promise<DeckSnapshot> {
  const snapshot = await loadNodeSlideSnapshot(ctx, deckId);
  if (!snapshot) throw new Error(`Deck ${deckId} not found.`);
  return snapshot;
}

async function consumePreviewQuotaBuckets(
  ctx: MutationCtx,
  buckets: Array<{ key: string; limit: number; windowMs: number }>,
): Promise<void> {
  if (buckets.length === 0 || buckets.length > 4) throw new Error('Invalid preview quota request.');
  const now = Date.now();
  const pending: Array<{
    bucket: { key: string; limit: number; windowMs: number };
    windowStart: number;
    row: Doc<'nodeslide_rate_limits'> | null;
  }> = [];
  for (const bucket of buckets) {
    if (
      !bucket.key ||
      bucket.key.length > 128 ||
      !Number.isInteger(bucket.limit) ||
      bucket.limit < 1 ||
      bucket.limit > 10_000 ||
      !Number.isInteger(bucket.windowMs) ||
      bucket.windowMs < 60_000 ||
      bucket.windowMs > 86_400_000
    ) {
      throw new Error('Invalid preview quota bucket.');
    }
    const windowStart = Math.floor(now / bucket.windowMs) * bucket.windowMs;
    const row = await ctx.db
      .query('nodeslide_rate_limits')
      .withIndex('by_key_window', (query) =>
        query.eq('key', bucket.key).eq('windowStart', windowStart),
      )
      .first();
    if ((row?.count ?? 0) >= bucket.limit) {
      throw new Error('NodeSlide free-preview quota reached. Try again after the current window.');
    }
    pending.push({ bucket, windowStart, row });
  }
  for (const { bucket, windowStart, row } of pending) {
    if (row) await ctx.db.patch(row._id, { count: row.count + 1, updatedAt: now });
    else
      await ctx.db.insert('nodeslide_rate_limits', {
        key: bucket.key,
        windowStart,
        count: 1,
        updatedAt: now,
      });
  }
}

async function migrateLegacyGoldenWorkspace(
  ctx: MutationCtx,
  deckId: string,
  canonical: DeckSnapshot,
  now: number,
): Promise<void> {
  const before = await loadNodeSlideSnapshot(ctx, deckId);
  if (!before) return;
  const repair = repairLegacyGoldenSnapshot(before, canonical);
  if (!repair.changed) return;

  const changedElementIds = new Set(
    repair.snapshot.elements.flatMap((element) => {
      const previous = before.elements.find((candidate) => candidate.id === element.id);
      return previous &&
        (previous.content !== element.content ||
          JSON.stringify(previous.bbox) !== JSON.stringify(element.bbox))
        ? [element.id]
        : [];
    }),
  );
  const changedSlideIds = new Set(
    repair.snapshot.elements
      .filter((element) => changedElementIds.has(element.id))
      .map((element) => element.slideId),
  );
  const after: DeckSnapshot = {
    ...repair.snapshot,
    deck: {
      ...repair.snapshot.deck,
      toolchainVersion: canonical.deck.toolchainVersion,
      version: before.deck.version + 1,
      updatedAt: now,
    },
    slides: repair.snapshot.slides.map((slide) =>
      changedSlideIds.has(slide.id) ? { ...slide, version: slide.version + 1 } : slide,
    ),
    elements: repair.snapshot.elements.map((element) =>
      changedElementIds.has(element.id) ? { ...element, version: element.version + 1 } : element,
    ),
  };
  const validation = validateNodeSlideSnapshot(
    after,
    now,
    nodeslideEventId('validation', now, deckId, 'legacy-golden-migration'),
  );
  await writeNodeSlideSnapshot(ctx, before, after, now);
  await insertVersion(ctx, after, 'Repaired legacy golden seed', 'system', undefined, now);
  await ctx.db.insert('nodeslide_validations', validation);
}

async function ownerWorkspaceResponse(
  ctx: { db: MutationCtx['db'] },
  deckId: string,
  ownerAccessKey: string,
  now: number,
) {
  const workspace = await loadNodeSlideWorkspace(ctx, deckId, now);
  if (!workspace) throw new Error(`Deck ${deckId} not found.`);
  return {
    ...workspace,
    ownerAccessKey,
    shareSlug: workspace.deck.shareSlug ?? null,
  };
}

function isSecureShareSlug(value: string | undefined): boolean {
  return Boolean(value && /^share-[a-f0-9]{36}$/.test(value));
}

async function commentForScope(ctx: MutationCtx, scope: PatchScope): Promise<DeckComment | null> {
  if (scope.kind !== 'comment') return null;
  const row = await findCommentRow(ctx, scope.commentId);
  return row ? commentFromRow(row) : null;
}

async function resolveLinkedComment(
  ctx: MutationCtx,
  commentId: string,
  deckId: string,
  patchId: string,
  now: number,
) {
  const comment = await findCommentRow(ctx, commentId);
  if (!comment || comment.deckId !== deckId)
    throw new Error('Linked comment does not belong to this deck.');
  await ctx.db.patch(comment._id, { status: 'resolved', linkedPatchId: patchId, updatedAt: now });
}

async function finishTrace(
  ctx: MutationCtx,
  traceId: string,
  now: number,
  status: 'completed' | 'failed',
  validation?: ValidationResult,
  patchId?: string,
) {
  const trace = await ctx.db
    .query('nodeslide_traces')
    .withIndex('by_stable_id', (index) => index.eq('id', traceId))
    .first();
  if (trace) {
    await ctx.db.patch(trace._id, {
      status,
      ...(validation ? { validation } : {}),
      ...(patchId ? { patchId } : {}),
      completedAt: now,
    });
  }
}

function restoredSnapshot(current: DeckSnapshot, target: DeckSnapshot, now: number): DeckSnapshot {
  const currentSlides = new Map(current.slides.map((slide) => [slide.id, slide.version]));
  const currentElements = new Map(current.elements.map((element) => [element.id, element.version]));
  return {
    deck: {
      ...structuredClone(target.deck),
      id: current.deck.id,
      projectId: current.deck.projectId,
      createdAt: current.deck.createdAt,
      updatedAt: now,
      version: current.deck.version + 1,
      status: 'ready',
      ...(current.deck.shareSlug ? { shareSlug: current.deck.shareSlug } : {}),
    },
    slides: target.slides.map((slide) => ({
      ...structuredClone(slide),
      deckId: current.deck.id,
      version: Math.max(slide.version, currentSlides.get(slide.id) ?? 0) + 1,
    })),
    elements: target.elements.map((element) => ({
      ...structuredClone(element),
      version: Math.max(element.version, currentElements.get(element.id) ?? 0) + 1,
    })),
    sources: target.sources.map((source) => ({
      ...structuredClone(source),
      deckId: current.deck.id,
    })),
  };
}

function validateAnchor(snapshot: DeckSnapshot, anchor: CommentAnchor) {
  if (anchor.deckId !== snapshot.deck.id) throw new Error('Comment anchor deck mismatch.');
  if (anchor.type === 'deck') return;
  if (!snapshot.slides.some((slide) => slide.id === anchor.slideId))
    throw new Error('Comment anchor slide not found.');
  if (
    anchor.type === 'element' &&
    !snapshot.elements.some(
      (element) => element.id === anchor.elementId && element.slideId === anchor.slideId,
    )
  ) {
    throw new Error('Comment anchor element not found.');
  }
  if (anchor.type === 'bounding_box' && !isNormalizedBoundingBox(anchor.bbox)) {
    throw new Error('Comment bounding box must be normalized and in bounds.');
  }
}

function requiredText(value: string, label: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error(`${label} is required.`);
  if (clean.length > max) throw new Error(`${label} exceeds ${max} characters.`);
  return clean;
}
