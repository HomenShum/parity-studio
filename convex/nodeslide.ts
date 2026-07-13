import { v } from 'convex/values';
import {
  type CandidateValidationReceipt,
  type CommentAnchor,
  type DeckComment,
  type DeckPatch,
  type DeckSnapshot,
  NODESLIDE_DESIGN_BEHAVIORS,
  NODESLIDE_DESIGN_BEHAVIOR_POLICY_VERSION,
  NODESLIDE_EDITOR_CAPABILITY_VERSION,
  NODESLIDE_LAYER_OPERATION_VERSION,
  NODESLIDE_PATCH_OPERATION_LIMIT,
  NODESLIDE_REFERENCE_USE_POLICIES,
  type PatchOperation,
  type PatchScope,
  type PatchSource,
  type ValidationResult,
  clampNormalized,
} from '../shared/nodeslide';
import { applyDeckPatch } from '../shared/nodeslidePatch';
import type { SlideVariation } from '../shared/nodeslideVariation';
import { internal } from './_generated/api';
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
import { summarizeNodeSlideExecutionTraces } from './lib/nodeslideAgenticTelemetry';
import {
  candidateValidationBindingMatches,
  candidateValidationReceipt,
  materializeNodeSlideCandidate,
  nodeSlideCandidateDigest,
  nodeSlideCandidateValidationId,
  validationFromCandidateReceipt,
} from './lib/nodeslideCandidate';
import {
  NODESLIDE_WORKSPACE_LIMITS,
  commentFromRow,
  deckFromRow,
  findCommentRow,
  findCurrentValidationRow,
  findDeckRow,
  findLatestPublicationByShareSlug,
  findLatestPublicationForDeck,
  findPatchRow,
  findVersionRow,
  insertNodeSlideSnapshot,
  loadNodeSlideSnapshot,
  loadNodeSlideWorkspace,
  patchFromRow,
  presenceFromRow,
  publicationFromRow,
  publishedNodeSlideFromRow,
  sanitizeNodeSlideSnapshot,
  writeNodeSlideSnapshot,
} from './lib/nodeslideData';
import {
  NODESLIDE_DATA_ATTACHMENT_MAX_BYTES,
  nodeSlideDataAttachmentShape,
  normalizeNodeSlideDataAttachment,
} from './lib/nodeslideDataAttachment';
import {
  NODESLIDE_EXECUTION_TRACE_LIMIT_PER_DECK,
  type NodeSlideExecutionTrace,
  assertExecutionTraceBounds,
  executionTraceRetentionPlan,
} from './lib/nodeslideExecutionTrace';
import { nodeslideExecutionTraceValidator } from './lib/nodeslideExecutionTraceValidator';
import {
  nodeslideContentDigest,
  nodeslideEventId,
  nodeslideHash,
  nodeslideIdDigest,
  nodeslideStableId,
} from './lib/nodeslideIds';
import {
  type NodeSlidePatchInput,
  clocksForNodeSlideOperations,
  evaluateNodeSlideCas,
  validateNodeSlidePatch,
} from './lib/nodeslidePatches';
import { planNodeSlidePropagation } from './lib/nodeslidePropagation';
import { NodeSlidePreviewQuotaError, consumePreviewQuotaBuckets } from './lib/nodeslideQuota';
import {
  buildBriefNodeSlide,
  buildGoldenNodeSlide,
  repairLegacyGoldenSnapshot,
} from './lib/nodeslideSeed';
import {
  NODESLIDE_SHADOW_COMPARISON_LIMIT_PER_DECK,
  type NodeSlideShadowComparison,
  assertNodeSlideShadowComparisonBaselineBinding,
  assertNodeSlideShadowComparisonBounds,
  nodeSlideShadowComparisonExpected,
  nodeSlideShadowComparisonRetentionPlan,
} from './lib/nodeslideShadowComparison';
import { nodeslideShadowComparisonValidator } from './lib/nodeslideShadowComparisonValidator';
import {
  requireDeckSignatureProfile,
  requireSignatureProfile,
} from './lib/nodeslideSignatureProfiles';
import { isNormalizedBoundingBox, validateNodeSlideSnapshot } from './lib/nodeslideValidation';
import {
  nodeslideBriefAttachmentValidator,
  nodeslideBriefValidator,
  nodeslideCommentAnchorValidator,
  nodeslideCursorValidator,
  nodeslidePatchOperationValidator,
  nodeslidePatchScopeValidator,
  nodeslideReasoningEffortValidator,
  nodeslideVersionClockValidator,
} from './lib/nodeslideValidators';
import {
  NODESLIDE_VARIATION_DECISION_LIMIT,
  NODESLIDE_VARIATION_REASON_LIMIT,
  NodeSlideVariationError,
  type VariationDecisionTrace,
  planVariationAcceptance,
  planVariationRejection,
  summarizeVariationOperations,
} from './lib/nodeslideVariationHarness';

const PRESENCE_TTL_MS = 45_000;
const MAX_PATCH_OPERATIONS = NODESLIDE_PATCH_OPERATION_LIMIT;
const MAX_PRESENCE_ELEMENTS = 64;
const MAX_LISTED_DECKS = 32;
const patchCoreArgs = {
  id: v.optional(v.string()),
  deckId: v.string(),
  ownerAccessKey: v.string(),
  baseDeckVersion: v.number(),
  baseSlideVersions: nodeslideVersionClockValidator,
  baseElementVersions: nodeslideVersionClockValidator,
  scope: nodeslidePatchScopeValidator,
  operations: v.array(nodeslidePatchOperationValidator),
  summary: v.optional(v.string()),
  linkedCommentId: v.optional(v.string()),
  profileId: v.optional(v.string()),
  profileDigest: v.optional(v.string()),
};
const publicPatchArgs = patchCoreArgs;
const internalAgentPatchArgs = {
  ...patchCoreArgs,
  id: v.string(),
  traceId: v.string(),
  // Kept temporarily for the existing internal action caller; the handler
  // ignores it and always records agent provenance.
  source: v.optional(v.literal('agent')),
};

type HumanPatchMutationArgs = {
  id?: string;
  deckId: string;
  ownerAccessKey: string;
  baseDeckVersion: number;
  baseSlideVersions: Record<string, number>;
  baseElementVersions: Record<string, number>;
  scope: PatchScope;
  operations: PatchOperation[];
  summary?: string;
  linkedCommentId?: string;
  profileId?: string;
  profileDigest?: string;
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
  proposalKind?: 'edit' | 'propagation';
  parentPatchId?: string;
  affectedSlideIds?: string[];
  affectedSlideDigest?: string;
  candidateDigest?: string;
  candidateValidation?: CandidateValidationReceipt;
  profileId?: string;
  profileDigest?: string;
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

/**
 * Stores a bounded user-uploaded data file as an owner-gated source record.
 * The agent may read it only when the client explicitly includes the returned
 * source reference in readContext.
 */
export const attachDataSource = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    title: v.string(),
    format: v.union(v.literal('csv'), v.literal('json'), v.literal('txt')),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const title = requiredText(args.title, 'data file name', 180);
    const content = normalizeNodeSlideDataAttachment(
      args.content,
      args.format,
      NODESLIDE_DATA_ATTACHMENT_MAX_BYTES,
    );
    const sourceType =
      args.format === 'csv' ? 'spreadsheet' : args.format === 'json' ? 'document' : 'note';
    const id = nodeslideStableId(
      'source',
      args.deckId,
      sourceType,
      title,
      nodeslideContentDigest(content),
    );
    const existing = await ctx.db
      .query('nodeslide_sources')
      .withIndex('by_stable_id', (query) => query.eq('id', id))
      .unique();
    const source = {
      id,
      deckId: args.deckId,
      title,
      sourceType,
      retrievedAt: existing?.retrievedAt ?? Date.now(),
      citation: `Uploaded file: ${title}\n${content}`,
      license: 'User supplied',
      format: args.format,
      contentDigest: nodeslideContentDigest(content),
      byteSize: new TextEncoder().encode(content).byteLength,
      ...nodeSlideDataAttachmentShape(content, args.format),
      retention: 'until_deleted' as const,
      status: 'ready' as const,
      lastRefreshedAt: Date.now(),
    } as const;
    if (existing) await ctx.db.patch(existing._id, source);
    else {
      const sourceCount = (
        await ctx.db
          .query('nodeslide_sources')
          .withIndex('by_deck', (query) => query.eq('deckId', args.deckId))
          .collect()
      ).length;
      if (sourceCount >= 64) throw new Error('This deck has reached its source attachment limit.');
      await ctx.db.insert('nodeslide_sources', source);
    }
    return { id, kind: 'source' as const, label: `Source: ${title}` };
  },
});

/** Owner-controlled deletion for private uploaded evidence. Linked data fails closed. */
export const deleteDataSource = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string(), sourceId: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const source = await ctx.db
      .query('nodeslide_sources')
      .withIndex('by_stable_id', (query) => query.eq('id', args.sourceId))
      .unique();
    if (!source || source.deckId !== args.deckId) return false;
    if (source.sourceType === 'url' || source.license !== 'User supplied') {
      throw new Error('Only private user-uploaded sources can be deleted from this control.');
    }
    const elements = await ctx.db
      .query('nodeslide_elements')
      .withIndex('by_deck', (query) => query.eq('deckId', args.deckId))
      .collect();
    if (elements.some((element) => element.sourceIds.includes(args.sourceId))) {
      throw new Error('This source is still bound to slide content. Remove those bindings first.');
    }
    await ctx.db.delete(source._id);
    return true;
  },
});

export const listAgentRuns = query({
  args: { deckId: v.string(), ownerAccessKey: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 40)));
    const rows = await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_deck_created', (query) => query.eq('deckId', args.deckId))
      .order('desc')
      .take(limit);
    return rows.map(({ _id, _creationTime, ownerDigest: _ownerDigest, ...run }) => run);
  },
});

export const listAgentMessages = query({
  args: { deckId: v.string(), ownerAccessKey: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const limit = Math.max(1, Math.min(200, Math.floor(args.limit ?? 80)));
    const rows = await ctx.db
      .query('nodeslide_agent_messages')
      .withIndex('by_deck_created', (query) => query.eq('deckId', args.deckId))
      .order('desc')
      .take(limit);
    return rows.reverse().map(({ _id, _creationTime, ...message }) => message);
  },
});

export const listAgentTelemetryPage = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    runId: v.string(),
    beforeSequence: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const run = await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_stable_id', (query) => query.eq('id', args.runId))
      .unique();
    if (!run || run.deckId !== args.deckId) throw new Error('Agent run not found.');
    const limit = Math.max(1, Math.min(200, Math.floor(args.limit ?? 60)));
    const before = Math.max(1, Math.floor(args.beforeSequence ?? Number.MAX_SAFE_INTEGER));
    const spans = await ctx.db
      .query('nodeslide_agent_spans')
      .withIndex('by_run_sequence', (query) => query.eq('runId', args.runId).lt('sequence', before))
      .order('desc')
      .take(limit + 1);
    const events = await ctx.db
      .query('nodeslide_agent_events')
      .withIndex('by_run_sequence', (query) => query.eq('runId', args.runId).lt('sequence', before))
      .order('desc')
      .take(limit + 1);
    const page = [
      ...spans.map((row) => ({ kind: 'span' as const, row })),
      ...events.map((row) => ({ kind: 'event' as const, row })),
    ]
      .sort((left, right) => right.row.sequence - left.row.sequence)
      .slice(0, limit);
    const nextBeforeSequence = page.at(-1)?.row.sequence;
    return {
      spans: page
        .filter((item) => item.kind === 'span')
        .map(({ row: { _id, _creationTime, ...span } }) => span),
      events: page
        .filter((item) => item.kind === 'event')
        .map(({ row: { _id, _creationTime, ...event } }) => event),
      hasMore: page.length === limit && nextBeforeSequence !== undefined && nextBeforeSequence > 1,
      ...(nextBeforeSequence !== undefined ? { nextBeforeSequence } : {}),
      totalRecorded: Math.max(0, (run.nextTelemetrySequence ?? 1) - 1),
    };
  },
});

export const cancelAgentRun = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string(), runId: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const row = await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_stable_id', (query) => query.eq('id', args.runId))
      .unique();
    if (!row || row.deckId !== args.deckId) return null;
    if (['completed', 'failed', 'cancelled', 'awaiting_review'].includes(row.status)) {
      const { _id, _creationTime, ownerDigest: _ownerDigest, ...run } = row;
      return run;
    }
    const now = Date.now();
    await ctx.db.patch(row._id, { status: 'cancelled', updatedAt: now, completedAt: now });
    const updated = await ctx.db.get(row._id);
    if (!updated) return null;
    const { _id, _creationTime, ownerDigest: _ownerDigest, ...run } = updated;
    return run;
  },
});

/** Versioned, owner-gated registry consumed by the editor command and policy menus. */
export const getEditorCapabilities = query({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, { deckId, ownerAccessKey }) => {
    await requireOwnerAccess(ctx, deckId, ownerAccessKey);
    return {
      version: NODESLIDE_EDITOR_CAPABILITY_VERSION,
      designBehaviorPolicyVersion: NODESLIDE_DESIGN_BEHAVIOR_POLICY_VERSION,
      designBehaviors: NODESLIDE_DESIGN_BEHAVIORS,
      referenceUsePolicies: NODESLIDE_REFERENCE_USE_POLICIES,
      commands: [
        {
          id: 'edit' as const,
          authority: 'nodeslideAgent.proposeEdit' as const,
          proposalKind: 'edit' as const,
        },
        {
          id: 'variations' as const,
          authority: 'nodeslideVariations.generate' as const,
          proposalKind: 'edit' as const,
        },
        {
          id: 'propagate' as const,
          authority: 'nodeslide.proposePropagation' as const,
          proposalKind: 'propagation' as const,
        },
      ],
      layerOperationVersion: NODESLIDE_LAYER_OPERATION_VERSION,
      layerOperations: [
        'set_visibility_v1',
        'group_elements_v1',
        'ungroup_elements_v1',
        'reorder_element_v1',
      ] as const,
    };
  },
});

export const getPresenterSnapshot = query({
  args: { shareSlug: v.string() },
  handler: async (ctx, { shareSlug }) => {
    const slug = requireShareSlug(shareSlug);
    const publication = await findLatestPublicationByShareSlug(ctx, slug);
    if (
      !publication ||
      publication.shareSlug !== slug ||
      publication.status !== 'active' ||
      publication.snapshot.deck.id !== publication.deckId ||
      publication.snapshot.deck.version !== publication.deckVersion
    ) {
      return null;
    }
    return publishedNodeSlideFromRow(publication);
  },
});

export const publishDeck = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, { deckId, ownerAccessKey }) => {
    const deckRow = await requireOwnerAccess(ctx, deckId, ownerAccessKey);
    const snapshot = await requireSnapshot(ctx, deckId);
    const validation = await findCurrentValidationRow(ctx, deckId, snapshot.deck.version);
    if (!validationAllowsPublication(snapshot, validation)) {
      throw new Error('The current deck version must pass publish validation before sharing.');
    }

    const now = Date.now();
    const previous = await findLatestPublicationForDeck(ctx, deckId);
    const shareSlug =
      previous?.status === 'active' && isSecureShareSlug(previous.shareSlug)
        ? previous.shareSlug
        : previous?.status === 'revoked' &&
            isSecureShareSlug(deckRow.shareSlug) &&
            deckRow.shareSlug !== previous.shareSlug
          ? deckRow.shareSlug
          : createShareSlug();
    const revision = (previous?.revision ?? 0) + 1;
    const id = nodeslideStableId('publication', deckId, String(revision));
    if (previous?.status === 'active') {
      await ctx.db.patch(previous._id, {
        status: 'superseded',
        supersededAt: now,
        supersededById: id,
      });
    }
    const publishedSnapshot = sanitizeNodeSlideSnapshot(snapshot);
    await ctx.db.insert('nodeslide_publications', {
      id,
      deckId,
      shareSlug,
      revision,
      deckVersion: snapshot.deck.version,
      validationId: validation.id,
      status: 'active',
      snapshot: publishedSnapshot,
      publishedAt: now,
    });
    await ctx.db.patch(deckRow._id, {
      shareSlug,
      status: 'published',
      updatedAt: now,
    });
    await prunePublicationHistory(ctx, deckId);
    return {
      publication: {
        id,
        deckId,
        shareSlug,
        revision,
        deckVersion: snapshot.deck.version,
        validationId: validation.id,
        status: 'active' as const,
        publishedAt: now,
      },
      snapshot: publishedSnapshot,
    };
  },
});

export const revokePublication = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, { deckId, ownerAccessKey }) => {
    const deckRow = await requireOwnerAccess(ctx, deckId, ownerAccessKey);
    const publication = await findLatestPublicationForDeck(ctx, deckId);
    if (!publication) return null;
    if (publication.status !== 'active') return publicationFromRow(publication);
    const now = Date.now();
    await ctx.db.patch(publication._id, { status: 'revoked', revokedAt: now });
    // A revoked capability is never reactivated by a later publish.
    await ctx.db.patch(deckRow._id, {
      shareSlug: createShareSlug(),
      status: 'ready',
      updatedAt: now,
    });
    return {
      ...publicationFromRow(publication),
      status: 'revoked' as const,
      revokedAt: now,
    };
  },
});

export const applyPatch = mutation({
  args: publicPatchArgs,
  handler: async (ctx, args) => await commitPatch(ctx, normalizeHumanPatchArgs(args), null),
});

export const proposePatch = mutation({
  args: publicPatchArgs,
  handler: async (ctx, args) => await persistProposal(ctx, normalizeHumanPatchArgs(args)),
});

export const proposePropagation = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    parentPatchId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const parent = await findPatchRow(ctx, args.parentPatchId);
    if (!parent || parent.deckId !== args.deckId) throw new Error('Parent patch is unavailable.');
    const snapshot = await requireSnapshot(ctx, args.deckId);
    const plan = planNodeSlidePropagation(snapshot, patchFromRow(parent));
    const now = Date.now();
    const id = nodeslideEventId(
      'patch_propagation',
      now,
      args.deckId,
      args.parentPatchId,
      plan.affectedSlideDigest,
    );
    return await persistProposal(ctx, {
      id,
      deckId: args.deckId,
      ownerAccessKey: args.ownerAccessKey,
      baseDeckVersion: plan.baseDeckVersion,
      baseSlideVersions: plan.baseSlideVersions,
      baseElementVersions: plan.baseElementVersions,
      scope: plan.scope,
      operations: plan.operations,
      source: 'system',
      summary: `Propagate accepted design behavior to ${plan.affectedSlideIds.length} matching slide${plan.affectedSlideIds.length === 1 ? '' : 's'}.`,
      proposalKind: 'propagation',
      parentPatchId: plan.parentPatchId,
      affectedSlideIds: plan.affectedSlideIds,
      affectedSlideDigest: plan.affectedSlideDigest,
    });
  },
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

/**
 * W3 acceptance is one transaction: the normal patch commit/CAS path and the
 * selected/sibling decision records either all commit or all roll back.
 */
export const acceptVariationPatch = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    variationId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const selectedRow = await requireAtomicVariationRow(ctx, args.deckId, args.variationId);
    const batch = await requireAtomicVariationBatch(ctx, args.deckId, selectedRow.batchId);
    const siblingRows = await ctx.db
      .query('nodeslide_variations')
      .withIndex('by_batch', (index) => index.eq('batchId', selectedRow.batchId))
      .take(4);
    if (
      siblingRows.length !== 3 ||
      siblingRows.some((variation) => variation.deckId !== args.deckId)
    ) {
      throw new NodeSlideVariationError(
        'generation_failed',
        'The variation batch cannot be reconciled safely.',
      );
    }

    const linkedPatches = await Promise.all(
      siblingRows.map(async (variation) => ({
        variation,
        patch: await findAtomicVariationPatch(ctx, variation),
      })),
    );
    if (
      linkedPatches.some(
        ({ variation, patch }) => patch && !atomicVariationPatchMatches(patch, variation),
      )
    ) {
      throw new NodeSlideVariationError(
        'generation_failed',
        'A linked patch belongs to a different variation operation set.',
      );
    }
    const committed = linkedPatches.filter(({ patch }) => patch?.status === 'accepted');
    if (committed.length > 1) {
      throw new NodeSlideVariationError(
        'generation_failed',
        'Multiple accepted patches exist for one variation batch.',
      );
    }
    const committedWinner = committed[0];
    if (committedWinner?.patch) {
      const wasReady = selectedRow.status === 'ready';
      await finalizeAtomicVariationSelection(
        ctx,
        batch,
        siblingRows,
        linkedPatches,
        committedWinner.variation,
        committedWinner.patch.id,
      );
      const updated = await requireAtomicVariationRow(ctx, args.deckId, args.variationId);
      return {
        variation: atomicVariationFromRow(updated),
        patch:
          wasReady && committedWinner.variation.id === selectedRow.id
            ? patchFromRow(committedWinner.patch)
            : null,
        workspace: await loadNodeSlideWorkspace(ctx, args.deckId, Date.now()),
        rebased: false,
        staleReasons: [],
      };
    }

    if (batch.acceptedVariationId) {
      throw new NodeSlideVariationError(
        'generation_failed',
        'The accepted variation decision has no verifiable accepted patch.',
      );
    }

    if (selectedRow.status !== 'ready') {
      if (batch.acceptingVariationId) {
        await ctx.db.patch(batch._id, { acceptingVariationId: undefined });
      }
      return {
        variation: atomicVariationFromRow(selectedRow),
        patch: null,
        workspace: await loadNodeSlideWorkspace(ctx, args.deckId, Date.now()),
        rebased: false,
        staleReasons: [],
      };
    }

    const selectedLink = linkedPatches.find(({ variation }) => variation.id === selectedRow.id);
    const existingPatch = selectedLink?.patch ?? null;
    if (existingPatch && !atomicVariationPatchMatches(existingPatch, selectedRow)) {
      throw new NodeSlideVariationError(
        'generation_failed',
        'The linked patch ID belongs to a different operation set.',
      );
    }
    if (existingPatch?.status === 'rejected') {
      await rejectAtomicVariation(ctx, batch, selectedRow, 'patch_rejected');
      const updated = await requireAtomicVariationRow(ctx, args.deckId, args.variationId);
      return {
        variation: atomicVariationFromRow(updated),
        patch: null,
        workspace: await loadNodeSlideWorkspace(ctx, args.deckId, Date.now()),
        rebased: false,
        staleReasons: [],
      };
    }
    if (existingPatch?.status === 'stale') {
      await markAtomicVariationStale(ctx, batch, selectedRow);
      const updated = await requireAtomicVariationRow(ctx, args.deckId, args.variationId);
      return {
        variation: atomicVariationFromRow(updated),
        patch: patchFromRow(existingPatch),
        workspace: await loadNodeSlideWorkspace(ctx, args.deckId, Date.now()),
        rebased: false,
        staleReasons: ['The linked variation patch was already stale.'],
      };
    }

    const patchId = await allocateAtomicVariationPatchId(ctx, selectedRow);
    const patchArgs = atomicVariationPatchArgs(selectedRow, args.ownerAccessKey, patchId);
    const snapshot = await requireSnapshot(ctx, args.deckId);
    const cas = evaluateNodeSlideCas(snapshot, patchInput(patchArgs));
    if (!cas.canCommit) {
      const now = Date.now();
      const stale = patchRow(patchArgs, now, 'stale', existingPatch?.createdAt);
      if (existingPatch) {
        await ctx.db.patch(existingPatch._id, { status: 'stale', updatedAt: now });
      } else {
        await ctx.db.insert('nodeslide_patches', stale);
      }
      await markAtomicVariationStale(ctx, batch, selectedRow, now);
      const updated = await requireAtomicVariationRow(ctx, args.deckId, args.variationId);
      return {
        variation: atomicVariationFromRow(updated),
        patch: stale,
        workspace: await loadNodeSlideWorkspace(ctx, args.deckId, now),
        rebased: false,
        staleReasons: cas.reasons,
      };
    }

    if (snapshot.deck.activeSignatureProfileId) {
      const checkedAt = Date.now();
      let activeSignatureValidation: ValidationResult;
      try {
        const preview = applyDeckPatch(
          structuredClone(snapshot),
          {
            baseDeckVersion: snapshot.deck.version,
            scope: patchArgs.scope,
            operations: patchArgs.operations,
          },
          checkedAt,
        ).snapshot;
        activeSignatureValidation = await validateWithActiveSignature(ctx, preview, checkedAt);
      } catch {
        throw new NodeSlideVariationError(
          'generation_failed',
          'The direction could not be checked against the active signature profile.',
        );
      }
      if (!activeSignatureValidation.publishOk) {
        throw new NodeSlideVariationError(
          'generation_failed',
          'This direction conflicts with the active signature profile. Generate new directions and review again.',
        );
      }
    }

    let receipt: Awaited<ReturnType<typeof commitPatch>>;
    try {
      receipt = await commitPatch(ctx, patchArgs, existingPatch);
    } catch {
      throw new NodeSlideVariationError(
        'generation_failed',
        'The variation could not be committed through the patch validator.',
      );
    }
    if (receipt.patch.status !== 'accepted') {
      throw new NodeSlideVariationError(
        'generation_failed',
        'The atomic variation patch returned an unexpected state.',
      );
    }
    await finalizeAtomicVariationSelection(
      ctx,
      batch,
      siblingRows,
      linkedPatches,
      selectedRow,
      receipt.patch.id,
    );
    const updated = await requireAtomicVariationRow(ctx, args.deckId, args.variationId);
    return {
      variation: atomicVariationFromRow(updated),
      patch: receipt.patch,
      workspace: receipt.workspace,
      rebased: receipt.rebased,
      staleReasons: [],
    };
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
      await finishPatchTrace(ctx, row, now, 'cancelled');
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
    const validation = await validateWithActiveSignature(ctx, restored, now);
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
    if (existing) {
      if (existing.deckId !== args.deckId) throw new Error('Comment id is unavailable.');
      return commentFromRow(existing);
    }
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
    if (existing) {
      if (existing.deckId !== args.deckId) throw new Error('Comment id is unavailable.');
      return commentFromRow(existing);
    }
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
      .order('desc')
      .take(NODESLIDE_WORKSPACE_LIMITS.presence);
    return active
      .map(presenceFromRow)
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt || right.id.localeCompare(left.id));
  },
});

export const validateAndRecord = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, { deckId, ownerAccessKey }) => {
    await requireOwnerAccess(ctx, deckId, ownerAccessKey);
    const snapshot = await requireSnapshot(ctx, deckId);
    const now = Date.now();
    const result = await validateWithActiveSignature(ctx, snapshot, now);
    await ctx.db.insert('nodeslide_validations', result);
    return result;
  },
});

export const listExecutionTraces = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const requestedLimit = args.limit ?? 20;
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 50) {
      throw new Error('Execution trace list limit must be an integer from 1 to 50.');
    }
    const now = Date.now();
    const rows = await ctx.db
      .query('nodeslide_execution_traces')
      .withIndex('by_deck_expiry', (index) => index.eq('deckId', args.deckId).gt('expiresAt', now))
      .take(NODESLIDE_EXECUTION_TRACE_LIMIT_PER_DECK);
    return rows
      .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
      .slice(0, requestedLimit)
      .map(({ _id, _creationTime, actorDigest: _actorDigest, ...trace }) => trace);
  },
});

export const listShadowComparisons = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const requestedLimit = args.limit ?? 20;
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 50) {
      throw new Error('Shadow comparison list limit must be an integer from 1 to 50.');
    }
    const now = Date.now();
    const rows = await ctx.db
      .query('nodeslide_shadow_comparisons')
      .withIndex('by_deck_expiry', (index) => index.eq('deckId', args.deckId).gt('expiresAt', now))
      .take(NODESLIDE_SHADOW_COMPARISON_LIMIT_PER_DECK);
    return rows
      .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
      .slice(0, requestedLimit)
      .map(({ _id, _creationTime, actorDigest: _actorDigest, ...comparison }) => comparison);
  },
});

export const getExecutionTelemetrySummary = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const now = Date.now();
    const rows = await ctx.db
      .query('nodeslide_execution_traces')
      .withIndex('by_deck_expiry', (index) => index.eq('deckId', args.deckId).gt('expiresAt', now))
      .take(NODESLIDE_EXECUTION_TRACE_LIMIT_PER_DECK);
    return summarizeNodeSlideExecutionTraces(rows.map(({ _id, _creationTime, ...trace }) => trace));
  },
});

export const persistExecutionTraceInternal = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    trace: nodeslideExecutionTraceValidator,
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const trace = structuredClone(args.trace) as NodeSlideExecutionTrace;
    assertExecutionTraceBounds(trace);
    if (trace.deckId !== args.deckId) throw new Error('Execution trace deck binding mismatch.');
    if (trace.actorDigest !== `actor_${nodeslideContentDigest(args.ownerAccessKey)}`) {
      throw new Error('Execution trace actor binding mismatch.');
    }
    const collisions = await ctx.db
      .query('nodeslide_execution_traces')
      .withIndex('by_stable_id', (index) => index.eq('id', trace.id))
      .take(2);
    if (collisions.length > 0) {
      const existing = collisions.find(
        (candidate) =>
          candidate.deckId === trace.deckId && candidate.traceDigest === trace.traceDigest,
      );
      if (existing) return existing;
      throw new Error('Execution trace ID collision.');
    }
    await ctx.db.insert('nodeslide_execution_traces', trace);

    const now = Date.now();
    const [expired, recent] = await Promise.all([
      ctx.db
        .query('nodeslide_execution_traces')
        .withIndex('by_deck_expiry', (index) =>
          index.eq('deckId', args.deckId).lte('expiresAt', now),
        )
        .take(NODESLIDE_EXECUTION_TRACE_LIMIT_PER_DECK),
      ctx.db
        .query('nodeslide_execution_traces')
        .withIndex('by_deck_created', (index) => index.eq('deckId', args.deckId))
        .order('desc')
        .take(NODESLIDE_EXECUTION_TRACE_LIMIT_PER_DECK + 1),
    ]);
    const deleteIds = new Set(executionTraceRetentionPlan([...expired, ...recent], now));
    for (const row of [...expired, ...recent]) {
      if (deleteIds.has(row.id)) await ctx.db.delete(row._id);
    }
    return trace;
  },
});

const EXECUTION_TRACE_PRUNE_BATCH_SIZE = 250;

export const pruneExpiredExecutionTracesInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query('nodeslide_execution_traces')
      .withIndex('by_expiry', (index) => index.lte('expiresAt', now))
      .take(EXECUTION_TRACE_PRUNE_BATCH_SIZE);
    for (const row of expired) await ctx.db.delete(row._id);
    if (expired.length === EXECUTION_TRACE_PRUNE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.nodeslide.pruneExpiredExecutionTracesInternal, {});
    }
    return { deleted: expired.length, cutoff: now };
  },
});

export const persistShadowComparisonInternal = internalMutation({
  args: {
    deckId: v.string(),
    comparison: nodeslideShadowComparisonValidator,
  },
  handler: async (ctx, args) => {
    const deck = await findDeckRow(ctx, args.deckId);
    if (!deck?.ownerAccessKey) throw new Error('Shadow comparison deck binding mismatch.');
    const comparison = structuredClone(args.comparison) as NodeSlideShadowComparison;
    assertNodeSlideShadowComparisonBounds(comparison);
    if (comparison.deckId !== args.deckId) {
      throw new Error('Shadow comparison deck binding mismatch.');
    }
    if (comparison.actorDigest !== `actor_${nodeslideContentDigest(deck.ownerAccessKey)}`) {
      throw new Error('Shadow comparison actor binding mismatch.');
    }
    const baselinePatch = await findPatchRow(ctx, comparison.baselinePatchId);
    const baselineTrace = await ctx.db
      .query('nodeslide_traces')
      .withIndex('by_stable_deck_patch', (index) =>
        index
          .eq('id', comparison.baselineTraceId)
          .eq('deckId', args.deckId)
          .eq('patchId', comparison.baselinePatchId),
      )
      .first();
    if (!baselinePatch || !baselineTrace) {
      throw new Error('Shadow comparison baseline binding mismatch.');
    }
    assertNodeSlideShadowComparisonBaselineBinding({
      comparison,
      baselinePatch,
      baselineTrace,
    });
    const collisions = await ctx.db
      .query('nodeslide_shadow_comparisons')
      .withIndex('by_stable_id', (index) => index.eq('id', comparison.id))
      .take(2);
    if (collisions.length > 0) {
      const existing = collisions.find(
        (candidate) =>
          candidate.deckId === comparison.deckId &&
          candidate.comparisonDigest === comparison.comparisonDigest,
      );
      if (existing) return existing;
      throw new Error('Shadow comparison ID collision.');
    }
    await ctx.db.insert('nodeslide_shadow_comparisons', comparison);

    const now = Date.now();
    const [expired, recent] = await Promise.all([
      ctx.db
        .query('nodeslide_shadow_comparisons')
        .withIndex('by_deck_expiry', (index) =>
          index.eq('deckId', args.deckId).lte('expiresAt', now),
        )
        .take(NODESLIDE_SHADOW_COMPARISON_LIMIT_PER_DECK),
      ctx.db
        .query('nodeslide_shadow_comparisons')
        .withIndex('by_deck_created', (index) => index.eq('deckId', args.deckId))
        .order('desc')
        .take(NODESLIDE_SHADOW_COMPARISON_LIMIT_PER_DECK + 1),
    ]);
    const deleteIds = new Set(nodeSlideShadowComparisonRetentionPlan([...expired, ...recent], now));
    for (const row of [...expired, ...recent]) {
      if (deleteIds.has(row.id)) await ctx.db.delete(row._id);
    }
    return comparison;
  },
});

const SHADOW_COMPARISON_PRUNE_BATCH_SIZE = 250;

export const pruneExpiredShadowComparisonsInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query('nodeslide_shadow_comparisons')
      .withIndex('by_expiry', (index) => index.lte('expiresAt', now))
      .take(SHADOW_COMPARISON_PRUNE_BATCH_SIZE);
    for (const row of expired) await ctx.db.delete(row._id);
    if (expired.length === SHADOW_COMPARISON_PRUNE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.nodeslide.pruneExpiredShadowComparisonsInternal, {});
    }
    return { deleted: expired.length, cutoff: now };
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

export const consumePreviewQuotaResult = internalMutation({
  args: {
    buckets: v.array(v.object({ key: v.string(), limit: v.number(), windowMs: v.number() })),
  },
  handler: async (ctx, { buckets }) => {
    try {
      await consumePreviewQuotaBuckets(ctx, buckets);
      return { ok: true as const };
    } catch (error) {
      if (error instanceof NodeSlidePreviewQuotaError) {
        return { ok: false as const, reason: 'quota_exceeded' as const };
      }
      throw error;
    }
  },
});

const NODESLIDE_AGENT_TELEMETRY_VERSION = 'nodeslide-otel/v1';
const NODESLIDE_AGENT_LEASE_MS = 5 * 60 * 1000;

function agentTraceId(deckId: string, runId: string): string {
  return nodeslideIdDigest(`nodeslide-agent-trace\u001f${deckId}\u001f${runId}`);
}

function agentSpanId(traceId: string, label: string, sequence: number): string {
  return nodeslideIdDigest(`${traceId}\u001f${label}\u001f${sequence}`).slice(0, 16);
}

function agentOperation(
  status: Doc<'nodeslide_agent_runs'>['status'],
  activity?: 'memory_retrieval',
): {
  name: string;
  operationName: string;
  toolName?: string;
} {
  if (activity === 'memory_retrieval') {
    return {
      name: 'Retrieve relevant deck memory',
      operationName: 'execute_tool',
      toolName: 'memory_retrieval',
    };
  }
  switch (status) {
    case 'queued':
      return { name: 'Queue and authorize', operationName: 'agent.queue' };
    case 'researching':
      return {
        name: 'Search external references',
        operationName: 'execute_tool',
        toolName: 'web_search',
      };
    case 'planning':
      return { name: 'Plan bounded slide edit', operationName: 'chat' };
    case 'validating':
      return {
        name: 'Validate candidate',
        operationName: 'execute_tool',
        toolName: 'candidate_validation',
      };
    case 'awaiting_review':
      return { name: 'Await human approval', operationName: 'agent.await_approval' };
    default:
      return { name: 'Finalize agent run', operationName: 'agent.finalize' };
  }
}

export const beginAgentRunInternal = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    idempotencyKey: v.string(),
    instruction: v.string(),
    provider: v.string(),
    model: v.string(),
    webResearch: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const idempotencyKey = requiredText(args.idempotencyKey, 'idempotency key', 160);
    const instruction = requiredText(args.instruction, 'instruction', 4000);
    const existing = await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_deck_idempotency', (query) =>
        query.eq('deckId', args.deckId).eq('idempotencyKey', idempotencyKey),
      )
      .first();
    if (existing) {
      if (existing.status === 'failed' && !existing.patchId && existing.attempt < 3) {
        const now = Date.now();
        const traceId = existing.otelTraceId ?? agentTraceId(args.deckId, existing.id);
        const sequence = existing.nextTelemetrySequence ?? 3;
        const attempt = existing.attempt + 1;
        const rootSpanId = agentSpanId(traceId, `invoke_agent_retry_${attempt}`, sequence);
        await ctx.db.insert('nodeslide_agent_spans', {
          id: nodeslideStableId('agent_span', existing.id, rootSpanId),
          deckId: args.deckId,
          runId: existing.id,
          traceId,
          spanId: rootSpanId,
          name: `Invoke NodeSlide agent (attempt ${attempt})`,
          operationName: 'invoke_agent',
          kind: 'internal',
          status: 'unset',
          startTime: now,
          provider: existing.provider,
          model: existing.model,
          attributes: [
            { key: 'gen_ai.operation.name', value: 'invoke_agent' },
            { key: 'nodeslide.run.attempt', value: attempt },
            { key: 'nodeslide.retry.reason', value: 'prior_attempt_failed' },
          ],
          sequence,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert('nodeslide_agent_events', {
          id: nodeslideStableId('agent_event', existing.id, 'retry', String(attempt)),
          deckId: args.deckId,
          runId: existing.id,
          traceId,
          spanId: rootSpanId,
          name: 'agent.retry.started',
          severity: 'warn',
          timestamp: now,
          body: `Retry attempt ${attempt} started from the durable request boundary.`,
          attributes: [{ key: 'nodeslide.run.attempt', value: attempt }],
          sequence: sequence + 1,
        });
        await ctx.db.patch(existing._id, {
          status: 'queued',
          attempt,
          rootSpanId,
          checkpoint: 'queued',
          error: undefined,
          completedAt: undefined,
          updatedAt: now,
          lastHeartbeatAt: now,
          leaseExpiresAt: now + NODESLIDE_AGENT_LEASE_MS,
          nextTelemetrySequence: sequence + 2,
          otelExportStatus: 'pending',
          otelExportedAt: undefined,
          otelExportError: undefined,
        });
        await ctx.db.insert('nodeslide_agent_messages', {
          id: nodeslideStableId('agent_message', existing.id, 'retry', String(attempt)),
          deckId: args.deckId,
          runId: existing.id,
          role: 'system',
          content: `Retrying the same idempotent request (attempt ${attempt} of 3).`,
          createdAt: now,
        });
        const retried = await ctx.db.get(existing._id);
        if (!retried) throw new Error('Agent run retry could not be loaded.');
        const { _id, _creationTime, ownerDigest: _ownerDigest, ...run } = retried;
        return { created: true, run };
      }
      const { _id, _creationTime, ownerDigest: _ownerDigest, ...run } = existing;
      return { created: false, run };
    }
    const now = Date.now();
    const id = nodeslideStableId('agent_run', args.deckId, idempotencyKey);
    const otelTraceId = agentTraceId(args.deckId, id);
    const rootSpanId = agentSpanId(otelTraceId, 'invoke_agent', 1);
    const run = {
      id,
      deckId: args.deckId,
      ownerDigest: `actor_${nodeslideContentDigest(args.ownerAccessKey)}`,
      idempotencyKey,
      instruction,
      status: 'queued' as const,
      provider: requiredText(args.provider, 'provider', 80),
      model: requiredText(args.model, 'model', 180),
      webResearch: args.webResearch,
      attempt: 1,
      otelTraceId,
      rootSpanId,
      checkpoint: 'queued',
      lastHeartbeatAt: now,
      leaseExpiresAt: now + NODESLIDE_AGENT_LEASE_MS,
      nextTelemetrySequence: 3,
      telemetryVersion: NODESLIDE_AGENT_TELEMETRY_VERSION,
      otelExportStatus: 'pending' as const,
      createdAt: now,
      updatedAt: now,
    };
    await ctx.db.insert('nodeslide_agent_runs', run);
    await ctx.db.insert('nodeslide_agent_spans', {
      id: nodeslideStableId('agent_span', id, rootSpanId),
      deckId: args.deckId,
      runId: id,
      traceId: otelTraceId,
      spanId: rootSpanId,
      name: 'Invoke NodeSlide agent',
      operationName: 'invoke_agent',
      kind: 'internal',
      status: 'unset',
      startTime: now,
      provider: run.provider,
      model: run.model,
      attributes: [
        { key: 'gen_ai.operation.name', value: 'invoke_agent' },
        { key: 'gen_ai.provider.name', value: run.provider },
        { key: 'gen_ai.request.model', value: run.model },
        { key: 'nodeslide.web_research', value: run.webResearch },
        { key: 'nodeslide.run.attempt', value: 1 },
      ],
      sequence: 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert('nodeslide_agent_events', {
      id: nodeslideStableId('agent_event', id, 'request_accepted'),
      deckId: args.deckId,
      runId: id,
      traceId: otelTraceId,
      spanId: rootSpanId,
      name: 'agent.request.accepted',
      severity: 'info',
      timestamp: now,
      body: 'Agent request accepted and durably queued.',
      attributes: [{ key: 'nodeslide.checkpoint', value: 'queued' }],
      sequence: 2,
    });
    await ctx.db.insert('nodeslide_agent_messages', {
      id: nodeslideStableId('agent_message', id, 'user'),
      deckId: args.deckId,
      runId: id,
      role: 'user',
      content: instruction,
      createdAt: now,
    });
    const { ownerDigest: _ownerDigest, ...publicRun } = run;
    return { created: true, run: publicRun };
  },
});

export const getAgentRunInternal = internalQuery({
  args: { deckId: v.string(), ownerAccessKey: v.string(), runId: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const row = await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_stable_id', (query) => query.eq('id', args.runId))
      .unique();
    if (!row || row.deckId !== args.deckId) return null;
    const { _id, _creationTime, ownerDigest: _ownerDigest, ...run } = row;
    return run;
  },
});

export const getAgentTelemetryForExportInternal = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_stable_id', (query) => query.eq('id', args.runId))
      .unique();
    if (!row) return null;
    const spans = await ctx.db
      .query('nodeslide_agent_spans')
      .withIndex('by_run_sequence', (query) => query.eq('runId', args.runId))
      .collect();
    const events = await ctx.db
      .query('nodeslide_agent_events')
      .withIndex('by_run_sequence', (query) => query.eq('runId', args.runId))
      .collect();
    const { _id, _creationTime, ownerDigest: _ownerDigest, ...run } = row;
    return {
      run,
      spans: spans.map(({ _id, _creationTime, ...span }) => span),
      events: events.map(({ _id, _creationTime, ...event }) => event),
    };
  },
});

export const markAgentTelemetryExportInternal = internalMutation({
  args: {
    runId: v.string(),
    status: v.union(v.literal('exported'), v.literal('skipped'), v.literal('failed')),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_stable_id', (query) => query.eq('id', args.runId))
      .unique();
    if (!row) return false;
    await ctx.db.patch(row._id, {
      otelExportStatus: args.status,
      otelExportedAt: Date.now(),
      ...(args.error
        ? { otelExportError: requiredText(args.error, 'OTLP export error', 300) }
        : {}),
    });
    return true;
  },
});

export const advanceAgentRunInternal = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    runId: v.string(),
    status: v.union(
      v.literal('researching'),
      v.literal('planning'),
      v.literal('validating'),
      v.literal('awaiting_review'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
    patchId: v.optional(v.string()),
    traceId: v.optional(v.string()),
    error: v.optional(v.string()),
    message: v.optional(v.string()),
    role: v.optional(v.union(v.literal('assistant'), v.literal('tool'), v.literal('system'))),
    toolName: v.optional(v.string()),
    sourceIds: v.optional(v.array(v.string())),
    memoryIds: v.optional(v.array(v.string())),
    memoryDigests: v.optional(v.array(v.string())),
    activity: v.optional(v.literal('memory_retrieval')),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const row = await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_stable_id', (query) => query.eq('id', args.runId))
      .unique();
    if (!row || row.deckId !== args.deckId) throw new Error('Agent run not found.');
    if (row.status === 'cancelled' && args.status !== 'cancelled') return null;
    const now = Date.now();
    const terminal = ['completed', 'failed', 'cancelled'].includes(args.status);
    const sequence = row.nextTelemetrySequence ?? 3;
    const traceId = row.otelTraceId ?? agentTraceId(args.deckId, args.runId);
    const rootSpanId = row.rootSpanId ?? agentSpanId(traceId, 'invoke_agent', 1);
    const phase = agentOperation(row.status, args.activity);
    const phaseSpanId = agentSpanId(traceId, phase.operationName, sequence);
    const phaseStatus = args.status === 'failed' ? 'error' : 'ok';
    await ctx.db.insert('nodeslide_agent_spans', {
      id: nodeslideStableId('agent_span', args.runId, phaseSpanId),
      deckId: args.deckId,
      runId: args.runId,
      traceId,
      spanId: phaseSpanId,
      parentSpanId: rootSpanId,
      name: phase.name,
      operationName: phase.operationName,
      kind: phase.operationName === 'chat' ? 'client' : 'internal',
      status: phaseStatus,
      startTime: row.updatedAt,
      endTime: now,
      durationMs: Math.max(0, now - row.updatedAt),
      provider: row.provider,
      model: row.model,
      ...(phase.toolName ? { toolName: phase.toolName } : {}),
      ...(args.sourceIds ? { sourceIds: args.sourceIds.slice(0, 32) } : {}),
      attributes: [
        { key: 'gen_ai.operation.name', value: phase.operationName },
        { key: 'gen_ai.provider.name', value: row.provider },
        { key: 'gen_ai.request.model', value: row.model },
        { key: 'nodeslide.run.status.from', value: row.status },
        { key: 'nodeslide.run.status.to', value: args.status },
        { key: 'nodeslide.checkpoint', value: args.status },
        ...(args.sourceIds?.length
          ? [{ key: 'nodeslide.source.ids', value: args.sourceIds.slice(0, 32).join(',') }]
          : []),
        ...(args.memoryIds?.length
          ? [
              { key: 'nodeslide.memory.count', value: Math.min(6, args.memoryIds.length) },
              { key: 'nodeslide.memory.ids', value: args.memoryIds.slice(0, 6).join(',') },
            ]
          : []),
        ...(args.memoryDigests?.length
          ? [
              {
                key: 'nodeslide.memory.digests',
                value: args.memoryDigests.slice(0, 6).join(','),
              },
            ]
          : []),
      ],
      sequence,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert('nodeslide_agent_events', {
      id: nodeslideStableId('agent_event', args.runId, String(sequence + 1), args.status),
      deckId: args.deckId,
      runId: args.runId,
      traceId,
      spanId: phaseSpanId,
      name: `agent.status.${args.status}`,
      severity: args.status === 'failed' ? 'error' : 'info',
      timestamp: now,
      body:
        args.status === 'failed'
          ? 'Agent run failed without applying deck changes.'
          : `Durable checkpoint advanced to ${args.status}.`,
      attributes: [
        { key: 'nodeslide.checkpoint', value: args.status },
        { key: 'nodeslide.run.attempt', value: row.attempt },
        ...(args.memoryIds?.length
          ? [{ key: 'nodeslide.memory.count', value: Math.min(6, args.memoryIds.length) }]
          : []),
      ],
      sequence: sequence + 1,
    });
    await ctx.db.patch(row._id, {
      status: args.status,
      updatedAt: now,
      checkpoint: args.status,
      lastHeartbeatAt: now,
      leaseExpiresAt: terminal ? now : now + NODESLIDE_AGENT_LEASE_MS,
      nextTelemetrySequence: sequence + 2,
      telemetryVersion: NODESLIDE_AGENT_TELEMETRY_VERSION,
      otelTraceId: traceId,
      rootSpanId,
      ...(terminal ? { completedAt: now } : {}),
      ...(args.patchId ? { patchId: args.patchId } : {}),
      ...(args.traceId ? { traceId: args.traceId } : {}),
      ...(args.error ? { error: requiredText(args.error, 'run error', 600) } : {}),
    });
    if (terminal) {
      const root = await ctx.db
        .query('nodeslide_agent_spans')
        .withIndex('by_stable_id', (query) =>
          query.eq('id', nodeslideStableId('agent_span', args.runId, rootSpanId)),
        )
        .unique();
      if (root) {
        await ctx.db.patch(root._id, {
          status: args.status === 'failed' ? 'error' : 'ok',
          endTime: now,
          durationMs: Math.max(0, now - root.startTime),
          updatedAt: now,
        });
      }
      await ctx.scheduler.runAfter(0, internal.nodeslideTelemetry.exportRunOtlpInternal, {
        runId: args.runId,
      });
    }
    if (args.message) {
      const message = requiredText(args.message, 'run message', 4000);
      const role = args.role ?? 'system';
      await ctx.db.insert('nodeslide_agent_messages', {
        id: nodeslideStableId('agent_message', args.runId, role, String(now), message),
        deckId: args.deckId,
        runId: args.runId,
        role,
        content: message,
        ...(args.toolName ? { toolName: requiredText(args.toolName, 'tool name', 120) } : {}),
        ...(args.sourceIds ? { sourceIds: args.sourceIds.slice(0, 32) } : {}),
        createdAt: now,
      });
    }
    return args.runId;
  },
});

/** Fails abandoned active runs honestly so a crashed action never spins forever in the UI. */
export const recoverStaleAgentRunsInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stale = await ctx.db
      .query('nodeslide_agent_runs')
      .filter((query) =>
        query.and(
          query.lt(query.field('leaseExpiresAt'), now),
          query.or(
            query.eq(query.field('status'), 'queued'),
            query.eq(query.field('status'), 'researching'),
            query.eq(query.field('status'), 'planning'),
            query.eq(query.field('status'), 'validating'),
          ),
        ),
      )
      .take(100);
    for (const run of stale) {
      const sequence = run.nextTelemetrySequence ?? 3;
      const traceId = run.otelTraceId ?? agentTraceId(run.deckId, run.id);
      const rootSpanId = run.rootSpanId ?? agentSpanId(traceId, 'invoke_agent', 1);
      const recoverySpanId = agentSpanId(traceId, 'stale_recovery', sequence);
      await ctx.db.insert('nodeslide_agent_spans', {
        id: nodeslideStableId('agent_span', run.id, recoverySpanId),
        deckId: run.deckId,
        runId: run.id,
        traceId,
        spanId: recoverySpanId,
        parentSpanId: rootSpanId,
        name: 'Recover expired worker lease',
        operationName: 'agent.recover',
        kind: 'internal',
        status: 'error',
        startTime: run.leaseExpiresAt ?? run.updatedAt,
        endTime: now,
        durationMs: Math.max(0, now - (run.leaseExpiresAt ?? run.updatedAt)),
        provider: run.provider,
        model: run.model,
        attributes: [
          { key: 'nodeslide.recovery.reason', value: 'worker_lease_expired' },
          { key: 'nodeslide.last_checkpoint', value: run.checkpoint ?? run.status },
        ],
        sequence,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert('nodeslide_agent_events', {
        id: nodeslideStableId('agent_event', run.id, 'worker_lease_expired'),
        deckId: run.deckId,
        runId: run.id,
        traceId,
        spanId: recoverySpanId,
        name: 'agent.worker_lease_expired',
        severity: 'error',
        timestamp: now,
        body: 'The worker lease expired. The run was failed without applying deck changes.',
        attributes: [{ key: 'nodeslide.last_checkpoint', value: run.checkpoint ?? run.status }],
        sequence: sequence + 1,
      });
      await ctx.db.patch(run._id, {
        status: 'failed',
        checkpoint: 'failed',
        error: 'Worker lease expired before the run reached a safe checkpoint.',
        updatedAt: now,
        completedAt: now,
        lastHeartbeatAt: now,
        leaseExpiresAt: now,
        nextTelemetrySequence: sequence + 2,
      });
      const root = await ctx.db
        .query('nodeslide_agent_spans')
        .withIndex('by_stable_id', (query) =>
          query.eq('id', nodeslideStableId('agent_span', run.id, rootSpanId)),
        )
        .unique();
      if (root) {
        await ctx.db.patch(root._id, {
          status: 'error',
          endTime: now,
          durationMs: Math.max(0, now - root.startTime),
          updatedAt: now,
        });
      }
      await ctx.scheduler.runAfter(0, internal.nodeslideTelemetry.exportRunOtlpInternal, {
        runId: run.id,
      });
      await ctx.db.insert('nodeslide_agent_messages', {
        id: nodeslideStableId('agent_message', run.id, 'worker_lease_expired'),
        deckId: run.deckId,
        runId: run.id,
        role: 'system',
        content: 'The worker stopped responding. No deck changes were applied; retry the request.',
        createdAt: now,
      });
    }
    return stale.length;
  },
});

export const attachWebSourcesInternal = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    sources: v.array(
      v.object({
        title: v.string(),
        url: v.string(),
        snippet: v.string(),
        provider: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const now = Date.now();
    const refs: Array<{ id: string; kind: 'source'; label: string }> = [];
    for (const input of args.sources.slice(0, 12)) {
      const title = requiredText(input.title, 'web source title', 180);
      const snippet = requiredText(input.snippet, 'web source excerpt', 1000);
      const provider = requiredText(input.provider, 'web source provider', 80);
      let url: string;
      try {
        const parsed = new URL(input.url);
        if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('unsupported');
        url = parsed.toString().slice(0, 900);
      } catch {
        continue;
      }
      const id = nodeslideStableId('source_web', args.deckId, url);
      const existing = await ctx.db
        .query('nodeslide_sources')
        .withIndex('by_stable_id', (query) => query.eq('id', id))
        .unique();
      const source = {
        id,
        deckId: args.deckId,
        title,
        url,
        sourceType: 'url' as const,
        retrievedAt: existing?.retrievedAt ?? now,
        citation: snippet,
        license: 'Web source; verify reuse rights',
        format: 'web' as const,
        contentDigest: nodeslideContentDigest(snippet),
        byteSize: new TextEncoder().encode(snippet).byteLength,
        provider,
        retention: 'public_snapshot' as const,
        status: 'ready' as const,
        lastRefreshedAt: now,
      };
      if (existing) await ctx.db.patch(existing._id, source);
      else await ctx.db.insert('nodeslide_sources', source);
      refs.push({ id, kind: 'source', label: `Web: ${title}` });
    }
    return refs;
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
    attachments: v.optional(v.array(nodeslideBriefAttachmentValidator)),
    themeId: v.string(),
    route: v.union(v.literal('free'), v.literal('balanced'), v.literal('frontier')),
    plan: v.array(v.string()),
    spec: v.any(),
    traceSummary: v.string(),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    reasoningEffort: v.optional(nodeslideReasoningEffortValidator),
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
      ...(args.attachments ? { attachments: args.attachments } : {}),
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
          ...(args.attachments?.length
            ? [
                `Read ${args.attachments.length} user-supplied data source${args.attachments.length === 1 ? '' : 's'}`,
              ]
            : []),
          'Persisted deterministic plan and deck specification',
        ],
        toolCalls: [
          'Planned six-to-eight slide narrative',
          'Built normalized deck',
          'Validated snapshot',
        ],
        ...(args.provider ? { provider: args.provider } : {}),
        ...(args.model ? { model: args.model } : {}),
        ...(args.reasoningEffort ? { reasoningEffort: args.reasoningEffort } : {}),
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
    ...internalAgentPatchArgs,
    instruction: v.string(),
    planningInputDigest: v.optional(v.string()),
    planningSnapshotDigest: v.optional(v.string()),
    shadowComparisonRequested: v.boolean(),
    shadowControlsDigest: v.optional(v.string()),
    shadowComparison: v.optional(nodeslideShadowComparisonValidator),
    traceSummary: v.string(),
    traceContext: v.array(v.string()),
    toolCalls: v.array(v.string()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    reasoningEffort: v.optional(nodeslideReasoningEffortValidator),
    costMicroUsd: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    if (args.toolCalls.length > 16) throw new Error('Too many agent tool calls recorded.');
    if (
      args.traceContext.length > 40 ||
      args.traceContext.some((line) => line.length === 0 || line.length > 500)
    ) {
      throw new Error('Agent trace context is invalid or exceeds bounds.');
    }
    const planningBindingsValid =
      /^turn_sha256:[0-9a-f]{64}$/.test(args.planningInputDigest ?? '') &&
      /^snap_sha256:[0-9a-f]{64}$/.test(args.planningSnapshotDigest ?? '');
    if (
      (args.shadowComparisonRequested &&
        (!planningBindingsValid ||
          !/^controls_sha256:[0-9a-f]{64}$/.test(args.shadowControlsDigest ?? ''))) ||
      (!args.shadowComparisonRequested &&
        (args.planningInputDigest !== undefined ||
          args.planningSnapshotDigest !== undefined ||
          args.shadowControlsDigest !== undefined))
    ) {
      throw new Error('Agent shadow comparison authorization binding is invalid.');
    }
    const proposal = await persistProposal(ctx, { ...args, source: 'agent' });
    const now = Date.now();
    const validation = proposal.patch.candidateValidation
      ? validationFromCandidateReceipt(proposal.patch.candidateValidation)
      : undefined;
    const shadowComparisonExpected = nodeSlideShadowComparisonExpected(
      args.shadowComparisonRequested,
      proposal.patch.status,
    );
    const trace = {
      id: args.traceId,
      deckId: args.deckId,
      patchId: args.id,
      status:
        proposal.patch.status === 'stale' ? ('failed' as const) : ('awaiting_review' as const),
      summary: args.traceSummary,
      plan: [
        'Read scoped deck context',
        'Draft bounded operations',
        'Validate clocks, scope, locks, and geometry',
        'Save proposal for review',
      ],
      context: [
        `Instruction: ${requiredText(args.instruction, 'instruction', 4000)}`,
        `Base deck version: ${args.baseDeckVersion}`,
        ...args.traceContext,
      ],
      toolCalls: args.toolCalls,
      guardrails: [
        'Explicit scope only',
        'Locked elements are immutable',
        'Fine-grained CAS before commit',
        'No provider secrets persisted',
      ],
      ...(args.planningInputDigest ? { planningInputDigest: args.planningInputDigest } : {}),
      ...(args.planningSnapshotDigest
        ? { planningSnapshotDigest: args.planningSnapshotDigest }
        : {}),
      shadowComparisonExpected,
      ...(args.shadowControlsDigest ? { shadowControlsDigest: args.shadowControlsDigest } : {}),
      ...(validation ? { validation } : {}),
      ...(proposal.patch.candidateDigest
        ? { candidateDigest: proposal.patch.candidateDigest }
        : {}),
      ...(args.provider ? { provider: args.provider } : {}),
      ...(args.model ? { model: args.model } : {}),
      ...(args.reasoningEffort ? { reasoningEffort: args.reasoningEffort } : {}),
      ...(args.costMicroUsd !== undefined ? { costMicroUsd: args.costMicroUsd } : {}),
      ...(args.inputTokens !== undefined ? { inputTokens: args.inputTokens } : {}),
      ...(args.outputTokens !== undefined ? { outputTokens: args.outputTokens } : {}),
      createdAt: now,
      ...(proposal.patch.status === 'stale' ? { completedAt: now } : {}),
    };
    await ctx.db.insert('nodeslide_traces', trace);
    if (args.shadowComparison) {
      try {
        assertNodeSlideShadowComparisonBounds(args.shadowComparison);
        assertNodeSlideShadowComparisonBaselineBinding({
          comparison: args.shadowComparison,
          baselinePatch: proposal.patch,
          baselineTrace: trace,
        });
        await ctx.scheduler.runAfter(0, internal.nodeslide.persistShadowComparisonInternal, {
          deckId: args.deckId,
          comparison: args.shadowComparison,
        });
      } catch {
        // The atomic trace marker remains as an observable missing-comparison
        // event. Shadow scheduling can never roll back the baseline proposal.
      }
    }
    return proposal;
  },
});

type AtomicVariationLink = {
  variation: Doc<'nodeslide_variations'>;
  patch: Doc<'nodeslide_patches'> | null;
};

async function requireAtomicVariationRow(
  ctx: MutationCtx,
  deckId: string,
  variationId: string,
): Promise<Doc<'nodeslide_variations'>> {
  const rows = await ctx.db
    .query('nodeslide_variations')
    .withIndex('by_stable_id', (index) => index.eq('id', variationId))
    .take(2);
  const row = rows.find((candidate) => candidate.deckId === deckId);
  if (!row) throw new NodeSlideVariationError('invalid_request', 'Variation is unavailable.');
  return row;
}

async function requireAtomicVariationBatch(
  ctx: MutationCtx,
  deckId: string,
  batchId: string,
): Promise<Doc<'nodeslide_variation_batches'>> {
  const rows = await ctx.db
    .query('nodeslide_variation_batches')
    .withIndex('by_stable_id', (index) => index.eq('id', batchId))
    .take(2);
  const row = rows.find((candidate) => candidate.deckId === deckId);
  if (!row) throw new NodeSlideVariationError('invalid_request', 'Variation batch is unavailable.');
  return row;
}

function atomicVariationPatchIds(variation: Doc<'nodeslide_variations'>): string[] {
  return [
    ...(variation.selectedPatchId ? [variation.selectedPatchId] : []),
    nodeslideStableId('patch_variation', variation.id),
    nodeslideStableId('patch_variation_scoped', variation.deckId, variation.id),
  ].filter((value, index, values) => values.indexOf(value) === index);
}

async function findAtomicVariationPatch(
  ctx: MutationCtx,
  variation: Doc<'nodeslide_variations'>,
): Promise<Doc<'nodeslide_patches'> | null> {
  for (const patchId of atomicVariationPatchIds(variation)) {
    const linked = await ctx.db
      .query('nodeslide_patches')
      .withIndex('by_stable_id', (index) => index.eq('id', patchId))
      .filter((query) =>
        query.and(
          query.eq(query.field('deckId'), variation.deckId),
          query.eq(query.field('traceId'), variation.id),
        ),
      )
      .first();
    if (linked) return linked;
  }
  return null;
}

async function allocateAtomicVariationPatchId(
  ctx: MutationCtx,
  variation: Doc<'nodeslide_variations'>,
): Promise<string> {
  const linked = await findAtomicVariationPatch(ctx, variation);
  if (linked) return linked.id;
  const candidates = [
    nodeslideStableId('patch_variation', variation.id),
    nodeslideStableId('patch_variation_scoped', variation.deckId, variation.id),
  ];
  for (const patchId of candidates) {
    const existing = await ctx.db
      .query('nodeslide_patches')
      .withIndex('by_stable_id', (index) => index.eq('id', patchId))
      .first();
    if (!existing) return patchId;
  }
  throw new NodeSlideVariationError(
    'generation_failed',
    'A tenant-scoped variation patch ID could not be allocated.',
  );
}

function atomicVariationPatchArgs(
  variation: Doc<'nodeslide_variations'>,
  ownerAccessKey: string,
  patchId: string,
): PatchMutationArgs {
  const axes = `${variation.axes.contentAngle}/${variation.axes.density}/${variation.axes.layoutArchetype}`;
  return {
    id: patchId,
    deckId: variation.deckId,
    ownerAccessKey,
    baseDeckVersion: variation.baseDeckVersion,
    baseSlideVersions: { [variation.slideId]: variation.baseSlideVersion },
    baseElementVersions: variation.baseElementVersions,
    scope: {
      kind: 'slide',
      deckId: variation.deckId,
      slideIds: [variation.slideId],
      operationMode: 'unrestricted',
    },
    operations: variation.operations,
    source: 'agent',
    summary: `Variation ${axes}: ${summarizeVariationOperations(variation.operations)}`.slice(
      0,
      500,
    ),
    traceId: variation.id,
  };
}

function atomicVariationPatchMatches(
  patch: Doc<'nodeslide_patches'>,
  variation: Doc<'nodeslide_variations'>,
): boolean {
  const expected = atomicVariationPatchArgs(variation, '', patch.id);
  return (
    patch.deckId === variation.deckId &&
    patch.traceId === variation.id &&
    patch.source === 'agent' &&
    patch.baseDeckVersion === variation.baseDeckVersion &&
    stableJson(patch.baseSlideVersions) === stableJson(expected.baseSlideVersions) &&
    stableJson(patch.baseElementVersions) === stableJson(variation.baseElementVersions) &&
    stableJson(patch.scope) === stableJson(expected.scope) &&
    stableJson(patch.operations) === stableJson(variation.operations)
  );
}

async function finalizeAtomicVariationSelection(
  ctx: MutationCtx,
  batch: Doc<'nodeslide_variation_batches'>,
  siblingRows: Doc<'nodeslide_variations'>[],
  linkedPatches: AtomicVariationLink[],
  winnerRow: Doc<'nodeslide_variations'>,
  selectedPatchId: string,
): Promise<void> {
  if (
    siblingRows.some(
      (variation) => variation.id !== winnerRow.id && variation.status === 'accepted',
    )
  ) {
    throw new NodeSlideVariationError(
      'generation_failed',
      'The variation batch contains conflicting accepted decisions.',
    );
  }
  const decidedAt = winnerRow.decidedAt ?? Date.now();
  const plannedVariations = siblingRows.map((variation) => {
    const mapped = atomicVariationFromRow(variation);
    return variation.id === winnerRow.id ? { ...mapped, status: 'ready' as const } : mapped;
  });
  const decision = planVariationAcceptance(
    plannedVariations,
    winnerRow.id,
    selectedPatchId,
    decidedAt,
  );
  for (const update of decision.updates) {
    const target = siblingRows.find((variation) => variation.id === update.id);
    if (!target) continue;
    await ctx.db.patch(target._id, {
      status: update.status,
      ...(update.selectedPatchId ? { selectedPatchId: update.selectedPatchId } : {}),
      decidedAt: update.decidedAt,
    });
  }
  for (const trace of decision.traces) await insertAtomicVariationDecision(ctx, trace);
  for (const link of linkedPatches) {
    if (link.variation.id !== winnerRow.id && link.patch?.status === 'ready') {
      await ctx.db.patch(link.patch._id, { status: 'rejected', updatedAt: decidedAt });
    }
  }
  await ctx.db.patch(batch._id, {
    acceptingVariationId: undefined,
    acceptedVariationId: winnerRow.id,
  });
  await pruneAtomicVariationDecisions(ctx, winnerRow.deckId);
}

async function rejectAtomicVariation(
  ctx: MutationCtx,
  batch: Doc<'nodeslide_variation_batches'>,
  variation: Doc<'nodeslide_variations'>,
  reason: string,
): Promise<void> {
  const decision = planVariationRejection(atomicVariationFromRow(variation), reason, Date.now());
  if (decision.update && decision.trace) {
    await ctx.db.patch(variation._id, {
      status: 'rejected',
      decidedAt: decision.update.decidedAt,
    });
    await insertAtomicVariationDecision(ctx, decision.trace);
  }
  if (batch.acceptingVariationId) {
    await ctx.db.patch(batch._id, { acceptingVariationId: undefined });
  }
  await pruneAtomicVariationDecisions(ctx, variation.deckId);
}

async function markAtomicVariationStale(
  ctx: MutationCtx,
  batch: Doc<'nodeslide_variation_batches'>,
  variation: Doc<'nodeslide_variations'>,
  decidedAt = Date.now(),
): Promise<void> {
  await ctx.db.patch(variation._id, { status: 'stale', decidedAt });
  if (batch.acceptingVariationId) {
    await ctx.db.patch(batch._id, { acceptingVariationId: undefined });
  }
}

async function insertAtomicVariationDecision(
  ctx: MutationCtx,
  trace: VariationDecisionTrace,
): Promise<void> {
  let candidate = trace;
  const existingRows = await ctx.db
    .query('nodeslide_variation_decisions')
    .withIndex('by_stable_id', (index) => index.eq('id', trace.id))
    .take(2);
  const matching = existingRows.find(
    (row) =>
      row.deckId === trace.deckId &&
      row.variationId === trace.variationId &&
      row.eventName === trace.eventName,
  );
  if (matching) return;
  if (existingRows.length > 0) {
    candidate = {
      ...trace,
      id: nodeslideStableId('variation_decision_scoped', trace.deckId, trace.id),
    };
    const scopedRows = await ctx.db
      .query('nodeslide_variation_decisions')
      .withIndex('by_stable_id', (index) => index.eq('id', candidate.id))
      .take(2);
    if (
      scopedRows.some(
        (row) =>
          row.deckId !== trace.deckId ||
          row.variationId !== trace.variationId ||
          row.eventName !== trace.eventName,
      )
    ) {
      throw new NodeSlideVariationError('generation_failed', 'Decision trace ID collision.');
    }
    if (scopedRows.length > 0) return;
  }
  if (
    candidate.reason !== undefined &&
    (candidate.reason.length === 0 || candidate.reason.length > NODESLIDE_VARIATION_REASON_LIMIT)
  ) {
    throw new NodeSlideVariationError('generation_failed', 'Decision reason exceeds bounds.');
  }
  await ctx.db.insert('nodeslide_variation_decisions', candidate);
}

async function pruneAtomicVariationDecisions(ctx: MutationCtx, deckId: string): Promise<void> {
  const rows = await ctx.db
    .query('nodeslide_variation_decisions')
    .withIndex('by_deck_created', (index) => index.eq('deckId', deckId))
    .order('asc')
    .take(NODESLIDE_VARIATION_DECISION_LIMIT * 2 + 1);
  for (const row of rows.slice(0, Math.max(0, rows.length - NODESLIDE_VARIATION_DECISION_LIMIT))) {
    await ctx.db.delete(row._id);
  }
}

function atomicVariationFromRow(row: Doc<'nodeslide_variations'>): SlideVariation {
  return {
    schemaVersion: row.schemaVersion,
    id: row.id,
    batchId: row.batchId,
    deckId: row.deckId,
    slideId: row.slideId,
    baseDeckVersion: row.baseDeckVersion,
    baseSlideVersion: row.baseSlideVersion,
    baseElementVersions: row.baseElementVersions,
    axes: row.axes,
    origin: row.origin,
    ...(row.fallbackReason !== undefined ? { fallbackReason: row.fallbackReason } : {}),
    operations: row.operations,
    candidate: row.candidate,
    validation: row.validation,
    status: row.status,
    ...(row.selectedPatchId !== undefined ? { selectedPatchId: row.selectedPatchId } : {}),
    createdAt: row.createdAt,
    ...(row.decidedAt !== undefined ? { decidedAt: row.decidedAt } : {}),
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function persistProposal(ctx: MutationCtx, args: PatchMutationArgs) {
  const deckRow = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
  assertPatchOperationCount(args.operations);
  assertPatchProfileReference(args);
  assertProposalMetadata(args);
  const snapshot = await requireSnapshot(ctx, args.deckId);
  const existing = args.id ? await findPatchRow(ctx, args.id) : null;
  if (existing) {
    if (existing.deckId !== args.deckId) {
      throw new Error('Patch is unavailable.');
    }
    return {
      patch: patchFromRow(existing),
      workspace: await loadNodeSlideWorkspace(ctx, args.deckId, Date.now()),
    };
  }
  const signatureProfile = await resolvePatchSignatureProfile(
    ctx,
    deckRow.projectId,
    args,
    snapshot,
  );
  const scopedComment = await commentForScope(ctx, args.scope);
  const input = patchInput(args);
  const errors = validateNodeSlidePatch(snapshot, input, scopedComment);
  if (errors.length) throw new Error(errors.join(' '));
  const cas = evaluateNodeSlideCas(snapshot, input);
  const now = Date.now();
  const id = args.id ?? nodeslideEventId('patch', now, args.deckId, args.summary ?? 'proposal');
  let boundArgs = { ...args, id };
  if (cas.canCommit) {
    const candidate = preflightNodeSlideCandidate(snapshot, boundArgs, signatureProfile, id, now);
    if (!candidate.validation.ok) {
      throw new Error(
        `The exact proposal candidate failed full validation: ${candidate.validation.issues.find((issue) => issue.severity === 'error')?.message ?? 'candidate invalid'}`,
      );
    }
    boundArgs = {
      ...boundArgs,
      candidateDigest: candidate.digest,
      candidateValidation: candidate.receipt,
    };
  }
  const row = patchRow(boundArgs, now, cas.canCommit ? 'ready' : 'stale');
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
  const deckRow = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
  assertPatchOperationCount(args.operations);
  assertPatchProfileReference(args);
  assertProposalMetadata(args);
  const snapshot = await requireSnapshot(ctx, args.deckId);
  const signatureProfile = await resolvePatchSignatureProfile(
    ctx,
    deckRow.projectId,
    args,
    snapshot,
  );
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
    if (existing) await finishPatchTrace(ctx, existing, now, 'failed');
    return {
      patch: stale,
      workspace: await loadNodeSlideWorkspace(ctx, args.deckId, now),
      rebased: false,
      staleReasons: cas.reasons,
    };
  }
  const candidate = preflightNodeSlideCandidate(snapshot, args, signatureProfile, id, now);
  const hasPersistedBinding =
    existing?.candidateDigest !== undefined || existing?.candidateValidation !== undefined;
  const bindingMatches = candidateValidationBindingMatches({
    patchId: id,
    candidateDigest: candidate.digest,
    ...(existing?.candidateDigest !== undefined
      ? { persistedDigest: existing.candidateDigest }
      : {}),
    ...(existing?.candidateValidation !== undefined
      ? { persistedReceipt: existing.candidateValidation }
      : {}),
    validation: candidate.validation,
  });
  if (!candidate.validation.ok || (hasPersistedBinding && !bindingMatches)) {
    const stale = patchRow(
      {
        ...args,
        id,
        candidateDigest: candidate.digest,
        candidateValidation: candidate.receipt,
      },
      now,
      'stale',
      existing?.createdAt,
    );
    if (existing) await ctx.db.patch(existing._id, { status: 'stale', updatedAt: now });
    else await ctx.db.insert('nodeslide_patches', stale);
    if (existing) await finishPatchTrace(ctx, existing, now, 'failed');
    return {
      patch: stale,
      workspace: await loadNodeSlideWorkspace(ctx, args.deckId, now),
      rebased: false,
      staleReasons: [
        candidate.validation.ok
          ? 'The exact candidate no longer matches its preflight validation binding.'
          : 'The exact candidate failed full validation.',
      ],
    };
  }
  const appliedSnapshot = candidate.snapshot;
  const validation = candidate.validation;
  const persistedCandidateValidation = existing?.candidateValidation ?? candidate.receipt;
  const accepted = patchRow(
    {
      ...args,
      id,
      candidateDigest: candidate.digest,
      candidateValidation: persistedCandidateValidation,
    },
    now,
    'accepted',
    existing?.createdAt,
    appliedSnapshot.deck.version,
  );
  await writeNodeSlideSnapshot(ctx, snapshot, appliedSnapshot, now);
  if (existing) {
    await ctx.db.patch(existing._id, {
      status: 'accepted',
      resultingDeckVersion: appliedSnapshot.deck.version,
      ...(args.profileId !== undefined ? { profileId: args.profileId } : {}),
      ...(args.profileDigest !== undefined ? { profileDigest: args.profileDigest } : {}),
      candidateDigest: candidate.digest,
      candidateValidation: persistedCandidateValidation,
      updatedAt: now,
    });
  } else await ctx.db.insert('nodeslide_patches', accepted);
  await insertVersion(
    ctx,
    appliedSnapshot,
    args.summary ?? 'Applied patch',
    args.source ?? 'human',
    id,
    now,
  );
  await ctx.db.insert('nodeslide_validations', validation);
  if (args.linkedCommentId)
    await resolveLinkedComment(ctx, args.linkedCommentId, args.deckId, id, now);
  await finishPatchTrace(ctx, accepted, now, 'completed', validation);
  return {
    patch: accepted,
    workspace: await loadNodeSlideWorkspace(ctx, args.deckId, now),
    validation,
    rebased: cas.rebased,
  };
}

function normalizeHumanPatchArgs(args: HumanPatchMutationArgs): PatchMutationArgs {
  assertPatchOperationCount(args.operations);
  assertPatchProfileReference(args);
  const normalized: PatchMutationArgs = {
    ...(args.id !== undefined ? { id: args.id } : {}),
    deckId: args.deckId,
    ownerAccessKey: args.ownerAccessKey,
    baseDeckVersion: args.baseDeckVersion,
    baseSlideVersions: args.baseSlideVersions,
    baseElementVersions: args.baseElementVersions,
    scope: args.scope,
    operations: args.operations,
    source: 'human',
    summary: args.summary?.trim() || 'Applied scoped NodeSlide change.',
    ...(args.linkedCommentId !== undefined ? { linkedCommentId: args.linkedCommentId } : {}),
    ...(args.profileId !== undefined ? { profileId: args.profileId } : {}),
    ...(args.profileDigest !== undefined ? { profileDigest: args.profileDigest } : {}),
  };
  return normalized;
}

function assertPatchOperationCount(operations: readonly PatchOperation[]) {
  if (operations.length > MAX_PATCH_OPERATIONS) {
    throw new Error(`NodeSlide patches support at most ${MAX_PATCH_OPERATIONS} operations.`);
  }
}

function assertPatchProfileReference(
  args: Pick<PatchMutationArgs, 'profileId' | 'profileDigest'>,
): void {
  const hasProfileId = args.profileId !== undefined;
  const hasProfileDigest = args.profileDigest !== undefined;
  if (hasProfileId !== hasProfileDigest) {
    throw new Error('Patch signature profileId and profileDigest must appear together.');
  }
  if (!hasProfileId || !hasProfileDigest) return;
  if (!args.profileId || args.profileId.length > 240) {
    throw new Error('Patch signature profileId is invalid.');
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(args.profileDigest as string)) {
    throw new Error('Patch signature profileDigest is invalid.');
  }
}

async function resolvePatchSignatureProfile(
  ctx: { db: MutationCtx['db'] },
  tenantId: string,
  args: Pick<PatchMutationArgs, 'profileId' | 'profileDigest'>,
  snapshot: DeckSnapshot,
) {
  assertPatchProfileReference(args);
  if (args.profileId !== undefined && args.profileDigest !== undefined) {
    return await requireSignatureProfile(ctx, tenantId, args.profileId, args.profileDigest);
  }
  return await requireDeckSignatureProfile(ctx, tenantId, snapshot.deck);
}

function preflightNodeSlideCandidate(
  snapshot: DeckSnapshot,
  args: Pick<PatchMutationArgs, 'scope' | 'operations'>,
  signatureProfile: Awaited<ReturnType<typeof resolvePatchSignatureProfile>>,
  patchId: string,
  checkedAt: number,
) {
  const materialized = materializeNodeSlideCandidate(snapshot, args, checkedAt);
  const candidateSnapshot: DeckSnapshot = signatureProfile
    ? {
        ...materialized,
        deck: {
          ...materialized.deck,
          activeSignatureProfileId: signatureProfile.id,
          activeSignatureProfileDigest: signatureProfile.source.digest,
        },
      }
    : materialized;
  const digest = nodeSlideCandidateDigest(candidateSnapshot);
  const validation = validateNodeSlideSnapshot(
    candidateSnapshot,
    checkedAt,
    nodeSlideCandidateValidationId(patchId, digest),
    signatureProfile ? { signatureProfile } : {},
  );
  return {
    snapshot: candidateSnapshot,
    digest,
    validation,
    receipt: candidateValidationReceipt({ patchId, candidateDigest: digest, validation }),
  };
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
  assertPatchProfileReference(args);
  assertProposalMetadata(args);
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
    ...(args.proposalKind !== undefined ? { proposalKind: args.proposalKind } : {}),
    ...(args.parentPatchId !== undefined ? { parentPatchId: args.parentPatchId } : {}),
    ...(args.affectedSlideIds !== undefined ? { affectedSlideIds: args.affectedSlideIds } : {}),
    ...(args.affectedSlideDigest !== undefined
      ? { affectedSlideDigest: args.affectedSlideDigest }
      : {}),
    ...(args.candidateDigest !== undefined ? { candidateDigest: args.candidateDigest } : {}),
    ...(args.candidateValidation !== undefined
      ? { candidateValidation: args.candidateValidation }
      : {}),
    ...(args.profileId !== undefined ? { profileId: args.profileId } : {}),
    ...(args.profileDigest !== undefined ? { profileDigest: args.profileDigest } : {}),
    createdAt,
    updatedAt: now,
  };
}

function assertProposalMetadata(
  args: Pick<
    PatchMutationArgs,
    'proposalKind' | 'parentPatchId' | 'affectedSlideIds' | 'affectedSlideDigest'
  >,
): void {
  const kind = args.proposalKind ?? 'edit';
  if (kind === 'edit') {
    if (
      args.parentPatchId !== undefined ||
      args.affectedSlideIds !== undefined ||
      args.affectedSlideDigest !== undefined
    ) {
      throw new Error('Only propagation proposals may carry propagation metadata.');
    }
    return;
  }
  if (
    !args.parentPatchId ||
    args.parentPatchId.length > 256 ||
    !args.affectedSlideIds ||
    args.affectedSlideIds.length === 0 ||
    args.affectedSlideIds.length > 64 ||
    new Set(args.affectedSlideIds).size !== args.affectedSlideIds.length ||
    !/^sha256:[0-9a-f]{64}$/.test(args.affectedSlideDigest ?? '')
  ) {
    throw new Error('Propagation proposal metadata is invalid or exceeds bounds.');
  }
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
      reasoningEffort?: import('../shared/nodeslide').NodeSlideReasoningEffort;
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
    ...(args.trace.reasoningEffort ? { reasoningEffort: args.trace.reasoningEffort } : {}),
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
  const validation = await validateWithActiveSignature(ctx, after, now);
  await writeNodeSlideSnapshot(ctx, before, after, now);
  await insertVersion(ctx, after, 'Repaired legacy golden seed', 'system', undefined, now);
  await ctx.db.insert('nodeslide_validations', validation);
}

async function validateWithActiveSignature(
  ctx: { db: MutationCtx['db'] },
  snapshot: DeckSnapshot,
  checkedAt: number,
): Promise<ValidationResult> {
  const profileId = snapshot.deck.activeSignatureProfileId;
  const profileDigest = snapshot.deck.activeSignatureProfileDigest;
  if (profileId === undefined && profileDigest === undefined) {
    return validateNodeSlideSnapshot(snapshot, checkedAt);
  }
  const deckRow = await findDeckRow(ctx, snapshot.deck.id);
  if (!deckRow) throw new Error(`Deck ${snapshot.deck.id} not found.`);
  const signatureProfile = await requireDeckSignatureProfile(ctx, deckRow.projectId, snapshot.deck);
  if (!signatureProfile) throw new Error('Active signature profile identity/digest is incomplete.');
  return validateNodeSlideSnapshot(snapshot, checkedAt, undefined, { signatureProfile });
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

function isSecureShareSlug(value: string | undefined): value is string {
  return value !== undefined && /^share-[a-f0-9]{36}$/.test(value);
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

async function finishPatchTrace(
  ctx: MutationCtx,
  patch: Pick<DeckPatch, 'id' | 'deckId' | 'traceId'>,
  now: number,
  status: 'completed' | 'failed' | 'cancelled',
  validation?: ValidationResult,
): Promise<boolean> {
  if (!patch.traceId) return false;
  const trace = await ctx.db
    .query('nodeslide_traces')
    .withIndex('by_stable_deck_patch', (index) =>
      index
        .eq('id', patch.traceId as string)
        .eq('deckId', patch.deckId)
        .eq('patchId', patch.id),
    )
    .first();
  if (!trace || trace.deckId !== patch.deckId || trace.patchId !== patch.id) return false;
  await ctx.db.patch(trace._id, {
    status,
    ...(validation ? { validation } : {}),
    completedAt: now,
  });
  const run = (
    await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_deck_created', (query) => query.eq('deckId', patch.deckId))
      .order('desc')
      .take(100)
  ).find((candidate) => candidate.patchId === patch.id);
  if (run) {
    const runStatus =
      status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'failed';
    const sequence = run.nextTelemetrySequence ?? 3;
    const otelTraceId = run.otelTraceId ?? agentTraceId(run.deckId, run.id);
    const rootSpanId = run.rootSpanId ?? agentSpanId(otelTraceId, 'invoke_agent', 1);
    const decisionSpanId = agentSpanId(otelTraceId, 'human_decision', sequence);
    await ctx.db.insert('nodeslide_agent_spans', {
      id: nodeslideStableId('agent_span', run.id, decisionSpanId),
      deckId: run.deckId,
      runId: run.id,
      traceId: otelTraceId,
      spanId: decisionSpanId,
      parentSpanId: rootSpanId,
      name: status === 'completed' ? 'Accept proposal' : 'Decline proposal',
      operationName: 'agent.human_decision',
      kind: 'internal',
      status: status === 'failed' ? 'error' : 'ok',
      startTime: now,
      endTime: now,
      durationMs: 0,
      provider: run.provider,
      model: run.model,
      attributes: [
        { key: 'nodeslide.human_decision', value: status },
        { key: 'nodeslide.patch.id', value: patch.id },
      ],
      sequence,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert('nodeslide_agent_events', {
      id: nodeslideStableId('agent_event', run.id, 'human_decision', status),
      deckId: run.deckId,
      runId: run.id,
      traceId: otelTraceId,
      spanId: decisionSpanId,
      name: `agent.human_decision.${status}`,
      severity: status === 'failed' ? 'error' : 'info',
      timestamp: now,
      body:
        status === 'completed'
          ? 'Human accepted the validated proposal.'
          : 'Human declined or could not apply the proposal; the deck remains unchanged.',
      attributes: [{ key: 'nodeslide.human_decision', value: status }],
      sequence: sequence + 1,
    });
    await ctx.db.patch(run._id, {
      status: runStatus,
      checkpoint: runStatus,
      updatedAt: now,
      completedAt: now,
      lastHeartbeatAt: now,
      leaseExpiresAt: now,
      nextTelemetrySequence: sequence + 2,
    });
    const root = await ctx.db
      .query('nodeslide_agent_spans')
      .withIndex('by_stable_id', (query) =>
        query.eq('id', nodeslideStableId('agent_span', run.id, rootSpanId)),
      )
      .unique();
    if (root) {
      await ctx.db.patch(root._id, {
        status: status === 'failed' ? 'error' : 'ok',
        endTime: now,
        durationMs: Math.max(0, now - root.startTime),
        updatedAt: now,
      });
    }
    await ctx.scheduler.runAfter(0, internal.nodeslideTelemetry.exportRunOtlpInternal, {
      runId: run.id,
    });
    const content =
      status === 'completed'
        ? 'Accepted and applied as a new deck version.'
        : status === 'cancelled'
          ? 'Proposal declined. The deck remains unchanged.'
          : 'Proposal could not be applied. The deck remains unchanged.';
    const messageId = nodeslideStableId('agent_message', run.id, 'decision', status);
    const existingMessage = await ctx.db
      .query('nodeslide_agent_messages')
      .withIndex('by_stable_id', (query) => query.eq('id', messageId))
      .unique();
    if (!existingMessage) {
      await ctx.db.insert('nodeslide_agent_messages', {
        id: messageId,
        deckId: patch.deckId,
        runId: run.id,
        role: 'system',
        content,
        createdAt: now,
      });
    }
  }
  return true;
}

function validationAllowsPublication(
  snapshot: DeckSnapshot,
  validation: Doc<'nodeslide_validations'> | null,
): validation is Doc<'nodeslide_validations'> {
  return Boolean(
    validation &&
      validation.deckId === snapshot.deck.id &&
      validation.deckVersion === snapshot.deck.version &&
      validation.toolchainVersion === snapshot.deck.toolchainVersion &&
      validation.publishOk,
  );
}

async function prunePublicationHistory(ctx: MutationCtx, deckId: string): Promise<void> {
  const rows = await ctx.db
    .query('nodeslide_publications')
    .withIndex('by_deck_revision', (index) => index.eq('deckId', deckId))
    .order('desc')
    .take(NODESLIDE_WORKSPACE_LIMITS.publications + 1);
  for (const row of rows.slice(NODESLIDE_WORKSPACE_LIMITS.publications)) {
    await ctx.db.delete(row._id);
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
      visible: element.visible ?? true,
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
