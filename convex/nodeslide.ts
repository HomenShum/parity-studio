import { v } from 'convex/values';
import {
  type CandidateValidationReceipt,
  type CommentAnchor,
  type DeckComment,
  type DeckPatch,
  type DeckSnapshot,
  NODESLIDE_AGENT_READ_CONTEXT_LIMITS,
  NODESLIDE_DESIGN_BEHAVIORS,
  NODESLIDE_DESIGN_BEHAVIOR_POLICY_VERSION,
  NODESLIDE_EDITOR_CAPABILITY_VERSION,
  NODESLIDE_LAYER_OPERATION_VERSION,
  NODESLIDE_PATCH_OPERATION_LIMIT,
  NODESLIDE_REFERENCE_USE_POLICIES,
  type NodeSlideAgentToolActivity,
  type NodeSlideEvidenceBox,
  type PatchOperation,
  type PatchScope,
  type PatchSource,
  type SourceRecord,
  type ValidationResult,
  clampNormalized,
} from '../shared/nodeslide';
import type {
  NodeSlideDecisionProvenance,
  NodeSlideDelegationClientKind,
} from '../shared/nodeslideDelegation';
import { nodeSlideDelegationCandidateViolations } from '../shared/nodeslideDelegation';
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
import { buildNodeSlideClaimEvidenceReceipt } from './lib/nodeslideClaimEvidenceReceipt';
import {
  nodeSlideCreationAuthorizationLine,
  nodeSlideCreationRunStartedAt,
  nodeSlideCreationTraceId,
} from './lib/nodeslideCreationTelemetry';
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
import { deleteNodeSlideDeckRows } from './lib/nodeslideDeckDeletion';
import { forkNodeSlideSnapshot } from './lib/nodeslideDeckFork';
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
import { nodeSlideJobExecutionDigest, nodeSlideJobOwnerDigest } from './lib/nodeslideJobState';
import {
  type NodeSlidePatchInput,
  clocksForNodeSlideOperations,
  evaluateNodeSlideCas,
  validateNodeSlidePatch,
} from './lib/nodeslidePatches';
import { planNodeSlidePropagation } from './lib/nodeslidePropagation';
import { decideNodeSlidePublishApproval } from './lib/nodeslidePublishApprovalPolicy';
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
import {
  buildNodeSlideSourceLineage,
  nodeSlideOperationSourceIds,
} from './lib/nodeslideSourceLineage';
import { buildNodeSlideSourceRevision } from './lib/nodeslideSourceRevision';
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
const NODESLIDE_EVIDENCE_CAPTURE_LIMIT_PER_RUN = 20;
const NODESLIDE_EVIDENCE_STEP_LIMIT_PER_CAPTURE = 20;
const NODESLIDE_EVIDENCE_CAPTURE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

const nodeslideEvidenceBoxValidator = v.object({
  x: v.number(),
  y: v.number(),
  w: v.number(),
  h: v.number(),
  page: v.optional(v.number()),
  pageCount: v.optional(v.number()),
});

const nodeslideEvidenceViewportValidator = v.object({
  width: v.number(),
  height: v.number(),
});

function nodeSlideEvidenceOwnerDigest(ownerAccessKey: string): string {
  return `actor_${nodeslideContentDigest(ownerAccessKey)}`;
}

function sourceRecordForRevision(
  source: Pick<
    Doc<'nodeslide_sources'>,
    | 'id'
    | 'deckId'
    | 'title'
    | 'url'
    | 'sourceType'
    | 'retrievedAt'
    | 'citation'
    | 'license'
    | 'format'
    | 'contentDigest'
    | 'byteSize'
    | 'rowCount'
    | 'columns'
    | 'provider'
    | 'retention'
    | 'status'
    | 'lastRefreshedAt'
  >,
  contentDigest: string,
): SourceRecord {
  return {
    id: source.id,
    deckId: source.deckId,
    title: source.title,
    ...(source.url ? { url: source.url } : {}),
    sourceType: source.sourceType,
    retrievedAt: source.retrievedAt,
    citation: source.citation,
    ...(source.license ? { license: source.license } : {}),
    ...(source.format ? { format: source.format } : {}),
    contentDigest,
    ...(source.byteSize !== undefined ? { byteSize: source.byteSize } : {}),
    ...(source.rowCount !== undefined ? { rowCount: source.rowCount } : {}),
    ...(source.columns ? { columns: source.columns } : {}),
    ...(source.provider ? { provider: source.provider } : {}),
    ...(source.retention ? { retention: source.retention } : {}),
    ...(source.status ? { status: source.status } : {}),
    ...(source.lastRefreshedAt !== undefined ? { lastRefreshedAt: source.lastRefreshedAt } : {}),
  };
}

async function ensureNodeSlideSourceRevision(
  ctx: Pick<MutationCtx, 'db'>,
  args: {
    source: Doc<'nodeslide_sources'> | Omit<Doc<'nodeslide_sources'>, '_id' | '_creationTime'>;
    ownerAccessKey: string;
    contentDigest?: string;
    createdAt?: number;
  },
): Promise<{
  id: string;
  revisionDigest: string;
  ownerDigest: string;
  deckId: string;
  sourceId: string;
  contentDigest: string;
  title: string;
}> {
  const contentDigest =
    args.contentDigest ?? args.source.contentDigest ?? nodeslideContentDigest(args.source.citation);
  const ownerDigest = nodeSlideEvidenceOwnerDigest(args.ownerAccessKey);
  const matches = await ctx.db
    .query('nodeslide_source_revisions')
    .withIndex('by_source_content_digest', (query) =>
      query.eq('sourceId', args.source.id).eq('contentDigest', contentDigest),
    )
    .take(2);
  if (matches.length > 1) {
    throw new Error('Immutable source revision identity is ambiguous.');
  }
  const existing = matches[0];
  if (existing) {
    if (existing.deckId !== args.source.deckId || existing.ownerDigest !== ownerDigest) {
      throw new Error('Immutable source revision crossed its owner or deck boundary.');
    }
    return existing;
  }

  const predecessor = await ctx.db
    .query('nodeslide_source_revisions')
    .withIndex('by_source_created', (query) => query.eq('sourceId', args.source.id))
    .order('desc')
    .first();
  if (predecessor && predecessor.deckId !== args.source.deckId) {
    throw new Error('Immutable source revision predecessor crossed its deck boundary.');
  }
  const revision = buildNodeSlideSourceRevision({
    source: sourceRecordForRevision(args.source, contentDigest),
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
    createdAt: args.createdAt ?? Date.now(),
  });
  return {
    id: revision.revisionId,
    revisionDigest: revision.revisionDigest,
    ownerDigest,
    deckId: revision.deckId,
    sourceId: revision.sourceId,
    contentDigest: revision.contentDigest,
    title: revision.title,
  };
}

async function persistNodeSlideClaimEvidenceReceipts(
  ctx: Pick<MutationCtx, 'db'>,
  args: {
    deckId: string;
    ownerAccessKey: string;
    patchId: string;
    traceId?: string;
    runId?: string;
    operations: readonly PatchOperation[];
    createdAt: number;
  },
): Promise<number> {
  if (!args.runId) return 0;
  const runId = args.runId;
  const sourceIds = nodeSlideOperationSourceIds(args.operations);
  if (sourceIds.length === 0) return 0;
  const lineage = buildNodeSlideSourceLineage({
    operations: args.operations,
    authorizedSourceIds: sourceIds,
    policy: 'not_applicable',
  });
  if (lineage.claimSourceBindings.length === 0) return 0;

  const captures = await ctx.db
    .query('nodeslide_evidence_captures')
    .withIndex('by_run_created', (query) => query.eq('runId', runId))
    .order('desc')
    .take(NODESLIDE_EVIDENCE_CAPTURE_LIMIT_PER_RUN + 1);
  if (captures.length > NODESLIDE_EVIDENCE_CAPTURE_LIMIT_PER_RUN) {
    throw new Error('Claim evidence receipt capture lookup exceeded its bounded run limit.');
  }
  const latestCaptureBySource = new Map<string, Doc<'nodeslide_evidence_captures'>>();
  for (const capture of captures) {
    if (
      capture.deckId === args.deckId &&
      capture.status === 'ready' &&
      capture.sourceRevisionId &&
      capture.sourceRevisionDigest &&
      capture.captureDigest &&
      !latestCaptureBySource.has(capture.sourceId)
    ) {
      latestCaptureBySource.set(capture.sourceId, capture);
    }
  }

  const ownerDigest = nodeSlideEvidenceOwnerDigest(args.ownerAccessKey);
  let inserted = 0;
  for (const binding of lineage.claimSourceBindings) {
    for (const sourceId of binding.sourceIds) {
      const capture = latestCaptureBySource.get(sourceId);
      if (!capture?.sourceRevisionId || !capture.sourceRevisionDigest || !capture.captureDigest) {
        continue;
      }
      const sourceRevisionId = capture.sourceRevisionId;
      const revision = await ctx.db
        .query('nodeslide_source_revisions')
        .withIndex('by_stable_id', (query) => query.eq('id', sourceRevisionId))
        .unique();
      if (
        !revision ||
        revision.deckId !== args.deckId ||
        revision.sourceId !== sourceId ||
        revision.ownerDigest !== ownerDigest ||
        revision.revisionDigest !== capture.sourceRevisionDigest
      ) {
        throw new Error('Claim evidence source revision binding is invalid.');
      }
      const steps = await ctx.db
        .query('nodeslide_evidence_steps')
        .withIndex('by_capture_sequence', (query) => query.eq('captureId', capture.id))
        .order('desc')
        .take(NODESLIDE_EVIDENCE_STEP_LIMIT_PER_CAPTURE + 1);
      if (steps.length > NODESLIDE_EVIDENCE_STEP_LIMIT_PER_CAPTURE) {
        throw new Error('Claim evidence step lookup exceeded its bounded capture limit.');
      }
      const step = steps.find((candidate) => {
        if (
          !candidate.attachmentKind ||
          !candidate.box ||
          candidate.regionScope !== 'claim' ||
          !candidate.attachmentDigest ||
          !candidate.evidenceStepDigest
        ) {
          return false;
        }
        if (candidate.attachmentKind === 'screenshot') {
          return candidate.box.page === undefined && candidate.box.pageCount === undefined;
        }
        return (
          Number.isInteger(candidate.box.page) &&
          Number.isInteger(candidate.box.pageCount) &&
          Number(candidate.box.page) > 0 &&
          Number(candidate.box.pageCount) >= Number(candidate.box.page)
        );
      });
      if (
        !step?.attachmentKind ||
        !step.box ||
        !step.attachmentDigest ||
        !step.evidenceStepDigest
      ) {
        continue;
      }
      const receipt = buildNodeSlideClaimEvidenceReceipt({
        deckId: args.deckId,
        slideId: binding.slideId,
        elementId: binding.elementId,
        claimDigest: binding.claimDigest,
        sourceRevisionId: revision.id,
        sourceRevisionDigest: revision.revisionDigest,
        captureId: capture.id,
        captureDigest: capture.captureDigest,
        evidenceStepId: step.id,
        evidenceStepDigest: step.evidenceStepDigest,
        attachmentKind: step.attachmentKind,
        attachmentDigest: step.attachmentDigest,
        region: {
          x: step.box.x,
          y: step.box.y,
          w: step.box.w,
          h: step.box.h,
          ...(step.attachmentKind === 'pdf'
            ? { page: step.box.page, pageCount: step.box.pageCount }
            : {}),
        },
      });
      const id = nodeslideStableId('claim_evidence_receipt', args.patchId, receipt.receiptId);
      const existing = await ctx.db
        .query('nodeslide_claim_evidence_receipts')
        .withIndex('by_stable_id', (query) => query.eq('id', id))
        .unique();
      if (existing) {
        if (
          existing.deckId !== args.deckId ||
          existing.patchId !== args.patchId ||
          existing.receiptDigest !== receipt.receiptDigest
        ) {
          throw new Error('Claim evidence receipt idempotency binding is invalid.');
        }
        continue;
      }
      await ctx.db.insert('nodeslide_claim_evidence_receipts', {
        id,
        receiptId: receipt.receiptId,
        schema: receipt.schema,
        receiptDigest: receipt.receiptDigest,
        ownerDigest,
        deckId: receipt.deckId,
        patchId: args.patchId,
        ...(args.traceId ? { traceId: args.traceId } : {}),
        slideId: receipt.slideId,
        elementId: receipt.elementId,
        claimDigest: receipt.claimDigest,
        sourceRevisionId: receipt.sourceRevisionId,
        sourceRevisionDigest: receipt.sourceRevisionDigest,
        captureId: receipt.captureId,
        captureDigest: receipt.captureDigest,
        evidenceStepId: receipt.evidenceStepId,
        evidenceStepDigest: receipt.evidenceStepDigest,
        attachmentKind: receipt.attachmentKind,
        attachmentDigest: receipt.attachmentDigest,
        region: receipt.region,
        createdAt: args.createdAt,
      });
      inserted += 1;
    }
  }
  return inserted;
}
// biome-ignore lint/suspicious/noExplicitAny: generated mutation cycle for atomic review finalization
const nodeslideJobsInternal: any = (internal as any).nodeslideJobs;
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
  jobId: v.optional(v.string()),
  executionAccessKey: v.optional(v.string()),
  durableRequestDigest: v.optional(v.string()),
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
  jobId?: string;
  proposalKind?: 'edit' | 'propagation';
  parentPatchId?: string;
  affectedSlideIds?: string[];
  affectedSlideDigest?: string;
  candidateDigest?: string;
  candidateValidation?: CandidateValidationReceipt;
  profileId?: string;
  profileDigest?: string;
};

export interface NodeSlideDelegatedCommitAuthority {
  deckRow: Doc<'nodeslide_decks'>;
  grantId: string;
  clientKind: NodeSlideDelegationClientKind;
  policyDigest: string;
}

/**
 * Narrow backend bridge for the token-authenticated delegation module. It
 * deliberately exposes only proposal acceptance, never direct patch apply or
 * release capabilities.
 */
export async function commitDelegatedNodeSlideProposal(
  ctx: MutationCtx,
  proposal: Doc<'nodeslide_patches'>,
  authority: NodeSlideDelegatedCommitAuthority,
) {
  if (authority.deckRow.id !== proposal.deckId) {
    throw new Error('Delegated commit authority does not match the proposal deck.');
  }
  return await commitPatch(ctx, { ...proposal, ownerAccessKey: '' }, proposal, authority);
}

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
    await ensureNodeSlideSourceRevision(ctx, {
      source,
      ownerAccessKey: args.ownerAccessKey,
      contentDigest: source.contentDigest,
      createdAt: source.lastRefreshedAt,
    });
    return { id, kind: 'source' as const, label: `Source: ${title}` };
  },
});

/** Server-only sink for approved storage-backed text uploads. */
export const attachStoredDataSourceInternal = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    title: v.string(),
    format: v.union(
      v.literal('csv'),
      v.literal('json'),
      v.literal('txt'),
      v.literal('md'),
      v.literal('pdf'),
    ),
    preview: v.string(),
    previewTruncated: v.boolean(),
    contentDigest: v.string(),
    byteSize: v.number(),
    rowCount: v.optional(v.number()),
    columns: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const title = requiredText(args.title, 'data file name', 180);
    const preview = args.preview
      .replace(/^\uFEFF/u, '')
      .replace(/\r\n?/g, '\n')
      .trim();
    if (!preview || preview.length > 7_200 || preview.includes('\u0000')) {
      throw new Error('Stored data preview is invalid.');
    }
    if (!Number.isSafeInteger(args.byteSize) || args.byteSize <= 0) {
      throw new Error('Stored data byte size is invalid.');
    }
    if (
      args.rowCount !== undefined &&
      (!Number.isSafeInteger(args.rowCount) || args.rowCount < 0)
    ) {
      throw new Error('Stored data row count is invalid.');
    }
    const columns = args.columns?.map((column) => requiredText(column, 'column', 240)).slice(0, 64);
    const sourceType =
      args.format === 'csv'
        ? 'spreadsheet'
        : args.format === 'txt' || args.format === 'md'
          ? 'note'
          : 'document';
    const id = nodeslideStableId('source', args.deckId, sourceType, title, args.contentDigest);
    const existing = await ctx.db
      .query('nodeslide_sources')
      .withIndex('by_stable_id', (query) => query.eq('id', id))
      .unique();
    const now = Date.now();
    const previewLabel = args.previewTruncated
      ? 'Bounded model preview; exact full-file digest retained'
      : 'Complete model-readable content';
    const source = {
      id,
      deckId: args.deckId,
      title,
      sourceType,
      retrievedAt: existing?.retrievedAt ?? now,
      citation: `Uploaded file: ${title}\n${previewLabel}\n${preview}`,
      license: 'User supplied',
      format: args.format,
      contentDigest: args.contentDigest,
      byteSize: args.byteSize,
      ...(args.rowCount !== undefined ? { rowCount: args.rowCount } : {}),
      ...(columns?.length ? { columns } : {}),
      retention: 'until_deleted' as const,
      status: 'ready' as const,
      lastRefreshedAt: now,
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
    await ensureNodeSlideSourceRevision(ctx, {
      source,
      ownerAccessKey: args.ownerAccessKey,
      contentDigest: source.contentDigest,
      createdAt: source.lastRefreshedAt,
    });
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

/** Owner-only, fail-closed erasure of a deck, its private data, and its project shell. */
export const deleteDeck = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, { deckId, ownerAccessKey }) => {
    const deck = await requireOwnerAccess(ctx, deckId, ownerAccessKey);
    return await deleteNodeSlideDeckRows(ctx, deck);
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
    const [sourceRows, runRows, spanRows] = await Promise.all([
      ctx.db
        .query('nodeslide_sources')
        .withIndex('by_deck', (query) => query.eq('deckId', args.deckId))
        .collect(),
      ctx.db
        .query('nodeslide_agent_runs')
        .withIndex('by_deck_created', (query) => query.eq('deckId', args.deckId))
        .order('desc')
        .take(limit),
      ctx.db
        .query('nodeslide_agent_spans')
        .withIndex('by_deck_created', (query) => query.eq('deckId', args.deckId))
        .order('desc')
        .take(Math.min(1_600, limit * 8)),
    ]);
    const sourcesById = new Map(
      sourceRows.flatMap((source) => {
        const resolved = resolvedAgentMessageSource(source);
        return resolved ? [[source.id, resolved] as const] : [];
      }),
    );
    const runsById = new Map(runRows.map((run) => [run.id, run] as const));
    const toolSpansByStart = new Map(
      spanRows.flatMap((span) =>
        span.toolName
          ? [[agentMessageToolSpanKey(span.runId, span.toolName, span.startTime), span] as const]
          : [],
      ),
    );

    return rows.reverse().map(({ _id, _creationTime, ...message }) => {
      const resolvedSources = [...new Set(message.sourceIds ?? [])].flatMap((sourceId) => {
        const source = sourcesById.get(sourceId);
        return source ? [source] : [];
      });
      const toolActivity = projectAgentMessageToolActivity(
        message,
        runsById.get(message.runId),
        message.toolName
          ? toolSpansByStart.get(
              agentMessageToolSpanKey(message.runId, message.toolName, message.createdAt),
            )
          : undefined,
      );
      return {
        ...message,
        ...(resolvedSources.length ? { resolvedSources } : {}),
        ...(toolActivity ? { toolActivity } : {}),
      };
    });
  },
});

function resolvedAgentMessageSource(source: Doc<'nodeslide_sources'>) {
  const title = source.title.trim();
  if (!title || !source.url) return null;
  try {
    const parsed = new URL(source.url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  } catch {
    return null;
  }
  return { id: source.id, title, url: source.url };
}

function agentMessageToolSpanKey(runId: string, toolName: string, startTime: number) {
  return `${runId}\u001f${toolName}\u001f${startTime}`;
}

function projectAgentMessageToolActivity(
  message: Pick<
    Doc<'nodeslide_agent_messages'>,
    'agentRole' | 'createdAt' | 'role' | 'runId' | 'toolName'
  >,
  run: Doc<'nodeslide_agent_runs'> | undefined,
  span: Doc<'nodeslide_agent_spans'> | undefined,
): NodeSlideAgentToolActivity | undefined {
  if (message.role !== 'tool' || !message.toolName) return undefined;
  if (span?.status === 'ok') return { state: 'output-available' };
  if (span?.status === 'error') {
    const errorText =
      run?.status === 'failed' && run.updatedAt === span.endTime ? run.error : undefined;
    return {
      state: 'output-error',
      ...(errorText ? { errorText } : {}),
    };
  }
  const activeStatus =
    message.toolName === 'web_search'
      ? 'researching'
      : message.toolName === 'candidate_validation'
        ? 'validating'
        : null;
  if (run && activeStatus && run.status === activeStatus && run.updatedAt === message.createdAt) {
    return { state: 'input-available' };
  }
  // Role handoffs are durable tool rows even when the underlying stage is one sequential model
  // turn rather than a separately instrumented tool span. Their state follows the durable run
  // clock; no parallel or independent execution is inferred here.
  if (message.agentRole) {
    return run &&
      run.updatedAt <= message.createdAt &&
      ['queued', 'researching', 'planning', 'validating'].includes(run.status)
      ? { state: 'input-available' }
      : { state: run?.status === 'failed' ? 'output-error' : 'output-available' };
  }
  return undefined;
}

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

/**
 * Owner-only capture index for one run. This intentionally returns counts and binding metadata,
 * never storage IDs or signed URLs. The selected detail query resolves one attachment at a time.
 */
export const listEvidenceCaptureSummaries = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    runId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const run = await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_stable_id', (query) => query.eq('id', args.runId))
      .unique();
    if (!run || run.deckId !== args.deckId) throw new Error('Agent run not found.');
    const limit = Math.max(
      1,
      Math.min(NODESLIDE_EVIDENCE_CAPTURE_LIMIT_PER_RUN, Math.floor(args.limit ?? 20)),
    );
    const captures = await ctx.db
      .query('nodeslide_evidence_captures')
      .withIndex('by_run_created', (query) => query.eq('runId', args.runId))
      .order('desc')
      .take(limit);
    const sources = await ctx.db
      .query('nodeslide_sources')
      .withIndex('by_deck', (query) => query.eq('deckId', args.deckId))
      .collect();
    const sourceTitles = new Map(sources.map((source) => [source.id, source.title] as const));
    const revisionTitles = new Map(
      (
        await Promise.all(
          [
            ...new Set(
              captures.flatMap((capture) =>
                capture.sourceRevisionId ? [capture.sourceRevisionId] : [],
              ),
            ),
          ].map((revisionId) =>
            ctx.db
              .query('nodeslide_source_revisions')
              .withIndex('by_stable_id', (query) => query.eq('id', revisionId))
              .unique(),
          ),
        )
      ).flatMap((revision) =>
        revision && revision.deckId === args.deckId
          ? ([[revision.id, revision.title]] as const)
          : [],
      ),
    );
    const now = Date.now();
    return captures.map(({ _id, _creationTime, ...capture }) => ({
      ...capture,
      sourceTitle:
        (capture.sourceRevisionId ? revisionTitles.get(capture.sourceRevisionId) : undefined) ??
        sourceTitles.get(capture.sourceId) ??
        'Unavailable source',
      status:
        capture.expiresAt !== undefined && capture.expiresAt <= now
          ? ('expired' as const)
          : capture.status,
    }));
  },
});

/** Resolve storage URLs only for the single capture the owner explicitly opened. */
export const getEvidenceCaptureDetail = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    captureId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const capture = await ctx.db
      .query('nodeslide_evidence_captures')
      .withIndex('by_stable_id', (query) => query.eq('id', args.captureId))
      .unique();
    if (!capture || capture.deckId !== args.deckId) return null;
    const source = await ctx.db
      .query('nodeslide_sources')
      .withIndex('by_stable_id', (query) => query.eq('id', capture.sourceId))
      .unique();
    const captureSourceRevisionId = capture.sourceRevisionId;
    const sourceRevision = captureSourceRevisionId
      ? await ctx.db
          .query('nodeslide_source_revisions')
          .withIndex('by_stable_id', (query) => query.eq('id', captureSourceRevisionId))
          .unique()
      : null;
    const validSource = source?.deckId === args.deckId ? source : null;
    const validRevision =
      sourceRevision?.deckId === args.deckId && sourceRevision.sourceId === capture.sourceId
        ? sourceRevision
        : null;
    if (!validSource && !validRevision) return null;
    const steps = await ctx.db
      .query('nodeslide_evidence_steps')
      .withIndex('by_capture_sequence', (query) => query.eq('captureId', capture.id))
      .take(NODESLIDE_EVIDENCE_STEP_LIMIT_PER_CAPTURE);
    const expired = capture.expiresAt !== undefined && capture.expiresAt <= Date.now();
    const resolvedSteps = await Promise.all(
      steps.map(async ({ _id, _creationTime, screenshotStorageId, pdfStorageId, ...step }) => {
        const attachment = expired
          ? undefined
          : screenshotStorageId
            ? {
                kind: 'screenshot' as const,
                url: await ctx.storage.getUrl(screenshotStorageId),
                ...(step.box ? { box: step.box } : {}),
              }
            : pdfStorageId
              ? {
                  kind: 'pdf' as const,
                  url: await ctx.storage.getUrl(pdfStorageId),
                  ...(step.box ? { box: step.box } : {}),
                  ...(step.box?.page !== undefined ? { page: step.box.page } : {}),
                }
              : undefined;
        return {
          ...step,
          ...(attachment?.url ? { attachment } : {}),
        };
      }),
    );
    const { _id, _creationTime, ...captureData } = capture;
    return {
      ...captureData,
      sourceTitle: validRevision?.title ?? validSource?.title ?? 'Unavailable source',
      status: expired ? ('expired' as const) : capture.status,
      steps: resolvedSteps,
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

    // D9 governance: when the approval gate is on, only an approver sign-off
    // bound to this exact version + validation receipt authorizes publish.
    const approvalRows = await ctx.db
      .query('nodeslide_publish_approvals')
      .withIndex('by_deck_version', (queryBuilder) =>
        queryBuilder.eq('deckId', deckId).eq('deckVersion', snapshot.deck.version),
      )
      .collect();
    const newestApproval =
      approvalRows.sort((first, second) => second.approvedAt - first.approvedAt)[0] ?? null;
    const approvalDecision = decideNodeSlidePublishApproval({
      required: deckRow.publishApprovalRequired === true,
      deckVersion: snapshot.deck.version,
      validationId: validation.id,
      approval: newestApproval
        ? {
            deckVersion: newestApproval.deckVersion,
            validationId: newestApproval.validationId,
            approverId: newestApproval.approverId,
            approvedAt: newestApproval.approvedAt,
          }
        : null,
    });
    if (!approvalDecision.allowed) throw new Error(approvalDecision.message);

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
      await resolveLinkedDurableReview(ctx, row, row.status);
      return {
        patch: patchFromRow(row),
        workspace: await loadNodeSlideWorkspace(ctx, row.deckId, Date.now()),
      };
    }
    if (row.status === 'rejected') throw new Error(`Patch ${patchId} was rejected.`);
    await requireLinkedDurableReviewable(ctx, row, ownerAccessKey);
    const receipt = await commitPatch(ctx, { ...row, ownerAccessKey }, row);
    await resolveLinkedDurableReview(
      ctx,
      row,
      receipt.patch.status === 'accepted' ? 'accepted' : 'stale',
    );
    return receipt;
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
      await requireLinkedDurableReviewable(ctx, row, ownerAccessKey);
      const now = Date.now();
      await ctx.db.patch(row._id, { status: 'rejected', updatedAt: now });
      await finishPatchTrace(ctx, row, now, 'cancelled');
    }
    await resolveLinkedDurableReview(ctx, row, 'rejected');
    const updated = await findPatchRow(ctx, patchId);
    return updated ? patchFromRow(updated) : null;
  },
});

async function resolveLinkedDurableReview(
  ctx: Pick<MutationCtx, 'runMutation'>,
  patch: Pick<Doc<'nodeslide_patches'>, 'id' | 'deckId' | 'jobId'>,
  outcome: 'accepted' | 'rejected' | 'stale',
): Promise<void> {
  if (!patch.jobId) return;
  await ctx.runMutation(nodeslideJobsInternal.resolveReviewInternal, {
    jobId: patch.jobId,
    deckId: patch.deckId,
    patchId: patch.id,
    outcome,
  });
}

async function requireLinkedDurableReviewable(
  ctx: Pick<MutationCtx, 'db'>,
  patch: Pick<Doc<'nodeslide_patches'>, 'id' | 'deckId' | 'jobId' | 'candidateDigest' | 'status'>,
  ownerAccessKey: string,
): Promise<void> {
  if (!patch.jobId) return;
  const jobs = await ctx.db
    .query('nodeslide_agent_jobs')
    .withIndex('by_stable_id', (query) => query.eq('id', patch.jobId as string))
    .take(2);
  const job = jobs.length === 1 ? jobs[0] : null;
  if (
    !job ||
    job.kind !== 'edit_proposal' ||
    job.status !== 'awaiting_review' ||
    job.ownerDigest !== nodeSlideJobOwnerDigest(ownerAccessKey) ||
    job.resultDeckId !== patch.deckId ||
    job.resultPatchId !== patch.id ||
    !patch.candidateDigest ||
    job.resultCandidateDigest !== patch.candidateDigest
  ) {
    throw new Error(
      'This durable proposal is no longer awaiting review with the exact bound candidate.',
    );
  }
}

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
    sourceRefreshProposalId: v.optional(v.string()),
    sourceRefreshBaseSnapshotDigest: v.optional(v.string()),
    startedAt: v.optional(v.number()),
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
      if (
        existing.sourceRefreshProposalId !== args.sourceRefreshProposalId ||
        existing.sourceRefreshBaseSnapshotDigest !== args.sourceRefreshBaseSnapshotDigest
      ) {
        throw new Error('Agent run source-refresh binding changed across an idempotent replay.');
      }
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
    const startedAt = nodeSlideCreationRunStartedAt(args.startedAt, now);
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
      ...(args.sourceRefreshProposalId
        ? { sourceRefreshProposalId: args.sourceRefreshProposalId }
        : {}),
      ...(args.sourceRefreshBaseSnapshotDigest
        ? { sourceRefreshBaseSnapshotDigest: args.sourceRefreshBaseSnapshotDigest }
        : {}),
      attempt: 1,
      otelTraceId,
      rootSpanId,
      checkpoint: 'queued',
      lastHeartbeatAt: now,
      leaseExpiresAt: now + NODESLIDE_AGENT_LEASE_MS,
      nextTelemetrySequence: 3,
      telemetryVersion: NODESLIDE_AGENT_TELEMETRY_VERSION,
      otelExportStatus: 'pending' as const,
      createdAt: startedAt,
      updatedAt: startedAt,
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
      startTime: startedAt,
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
      timestamp: startedAt,
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

export const recordEvidenceCaptureInternal = internalMutation({
  args: {
    id: v.string(),
    deckId: v.string(),
    ownerAccessKey: v.string(),
    runId: v.string(),
    parentSpanId: v.string(),
    sourceId: v.string(),
    url: v.string(),
    goal: v.string(),
    provider: v.string(),
    status: v.union(v.literal('ready'), v.literal('failed')),
    error: v.optional(v.string()),
    contentDigest: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.number(),
    steps: v.array(
      v.object({
        phase: v.string(),
        label: v.string(),
        status: v.union(v.literal('ok'), v.literal('warning'), v.literal('error')),
        detail: v.optional(v.string()),
        screenshotStorageId: v.optional(v.id('_storage')),
        pdfStorageId: v.optional(v.id('_storage')),
        box: v.optional(nodeslideEvidenceBoxValidator),
        regionScope: v.union(v.literal('source'), v.literal('claim')),
        selector: v.optional(v.string()),
        quote: v.optional(v.string()),
        viewport: v.optional(nodeslideEvidenceViewportValidator),
        contentDigest: v.optional(v.string()),
        startedAt: v.number(),
        completedAt: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const run = await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_stable_id', (query) => query.eq('id', args.runId))
      .unique();
    if (!run || run.deckId !== args.deckId) throw new Error('Agent run not found.');
    const parent = await ctx.db
      .query('nodeslide_agent_spans')
      .withIndex('by_stable_id', (query) =>
        query.eq('id', nodeslideStableId('agent_span', args.runId, args.parentSpanId)),
      )
      .unique();
    if (!parent || parent.deckId !== args.deckId || parent.runId !== args.runId) {
      throw new Error('Evidence capture parent span is invalid.');
    }
    const source = await ctx.db
      .query('nodeslide_sources')
      .withIndex('by_stable_id', (query) => query.eq('id', args.sourceId))
      .unique();
    if (!source || source.deckId !== args.deckId || source.url !== args.url) {
      throw new Error('Evidence capture source binding is invalid.');
    }
    const existing = await ctx.db
      .query('nodeslide_evidence_captures')
      .withIndex('by_stable_id', (query) => query.eq('id', args.id))
      .unique();
    if (existing) {
      if (
        existing.deckId !== args.deckId ||
        existing.runId !== args.runId ||
        existing.sourceId !== args.sourceId
      ) {
        throw new Error('Evidence capture idempotency binding is invalid.');
      }
      return { created: false, captureId: existing.id, spanId: existing.spanId };
    }
    const captureCount = await ctx.db
      .query('nodeslide_evidence_captures')
      .withIndex('by_run_created', (query) => query.eq('runId', args.runId))
      .take(NODESLIDE_EVIDENCE_CAPTURE_LIMIT_PER_RUN + 1);
    if (captureCount.length >= NODESLIDE_EVIDENCE_CAPTURE_LIMIT_PER_RUN) {
      throw new Error('This run has reached its visual evidence capture limit.');
    }
    if (args.steps.length < 1 || args.steps.length > NODESLIDE_EVIDENCE_STEP_LIMIT_PER_CAPTURE) {
      throw new Error('Evidence capture step count is invalid.');
    }
    const startedAt = Math.max(0, Math.floor(args.startedAt));
    const completedAt = Math.max(startedAt, Math.floor(args.completedAt));
    const traceId = run.otelTraceId ?? agentTraceId(args.deckId, args.runId);
    if (parent.traceId !== traceId) throw new Error('Evidence capture trace binding is invalid.');
    const sourceRevision = await ensureNodeSlideSourceRevision(ctx, {
      source,
      ownerAccessKey: args.ownerAccessKey,
      ...(args.contentDigest ? { contentDigest: args.contentDigest } : {}),
      createdAt: completedAt,
    });
    let telemetrySequence = run.nextTelemetrySequence ?? 3;
    const preparedSteps = args.steps.map((step, index) => {
      if (step.screenshotStorageId && step.pdfStorageId) {
        throw new Error('An evidence step cannot contain both screenshot and PDF storage.');
      }
      if (step.box && !isNormalizedEvidenceBox(step.box)) {
        throw new Error('Evidence capture box must use normalized coordinates.');
      }
      if (
        step.viewport &&
        (!Number.isInteger(step.viewport.width) ||
          !Number.isInteger(step.viewport.height) ||
          step.viewport.width <= 0 ||
          step.viewport.height <= 0 ||
          step.viewport.width > 10_000 ||
          step.viewport.height > 10_000)
      ) {
        throw new Error('Evidence capture viewport is invalid.');
      }
      const sequence = telemetrySequence;
      telemetrySequence += 2;
      const phase = requiredText(step.phase, 'evidence phase', 80);
      const label = requiredText(step.label, 'evidence label', 300);
      const stepStartedAt = Math.max(startedAt, Math.floor(step.startedAt));
      const stepCompletedAt = Math.max(
        stepStartedAt,
        Math.floor(step.completedAt ?? stepStartedAt),
      );
      const spanId = agentSpanId(traceId, `capture_${args.id}_${index}`, sequence);
      const box =
        step.pdfStorageId &&
        args.provider === 'nodeslide-source-snapshot/v1' &&
        step.box?.page === 1 &&
        step.box.pageCount === undefined
          ? { ...step.box, pageCount: 1 }
          : step.box;
      const attachmentKind = step.screenshotStorageId
        ? ('screenshot' as const)
        : step.pdfStorageId
          ? ('pdf' as const)
          : undefined;
      const attachmentDigest =
        attachmentKind && /^sha256:[0-9a-f]{64}$/.test(step.contentDigest ?? '')
          ? step.contentDigest
          : undefined;
      const evidenceStepDigest = nodeslideContentDigest(
        stableJson({
          captureId: args.id,
          sequence: index + 1,
          phase,
          label,
          status: step.status,
          detail: step.detail,
          attachmentKind,
          attachmentDigest,
          box,
          regionScope: step.regionScope,
          selector: step.selector,
          quote: step.quote,
          viewport: step.viewport,
          contentDigest: step.contentDigest,
          startedAt: stepStartedAt,
          completedAt: stepCompletedAt,
        }),
      );
      return {
        ...step,
        phase,
        label,
        ...(box ? { box } : {}),
        ...(attachmentKind ? { attachmentKind } : {}),
        ...(attachmentDigest ? { attachmentDigest } : {}),
        evidenceStepDigest,
        sequence,
        spanId,
        startedAt: stepStartedAt,
        completedAt: stepCompletedAt,
      };
    });
    const captureSpanId = preparedSteps[0]?.spanId;
    if (!captureSpanId) throw new Error('Evidence capture did not produce a span.');
    const now = Date.now();
    for (const [index, step] of preparedSteps.entries()) {
      await ctx.db.insert('nodeslide_agent_spans', {
        id: nodeslideStableId('agent_span', args.runId, step.spanId),
        deckId: args.deckId,
        runId: args.runId,
        traceId,
        spanId: step.spanId,
        parentSpanId: args.parentSpanId,
        name: `Capture ${step.phase}`,
        operationName: `evidence.${step.phase.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
        kind: 'client',
        status: step.status === 'error' ? 'error' : 'ok',
        startTime: step.startedAt,
        endTime: step.completedAt,
        durationMs: Math.max(0, step.completedAt - step.startedAt),
        provider: args.provider,
        toolName: 'capture_source',
        sourceIds: [args.sourceId],
        attributes: [
          { key: 'nodeslide.evidence.capture_id', value: args.id },
          { key: 'nodeslide.evidence.source_id', value: args.sourceId },
          { key: 'nodeslide.evidence.step', value: index + 1 },
          { key: 'nodeslide.evidence.has_screenshot', value: Boolean(step.screenshotStorageId) },
          { key: 'nodeslide.evidence.has_pdf', value: Boolean(step.pdfStorageId) },
          ...(step.contentDigest
            ? [{ key: 'nodeslide.evidence.content_digest', value: step.contentDigest }]
            : []),
        ],
        sequence: step.sequence,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert('nodeslide_agent_events', {
        id: nodeslideStableId('agent_event', args.runId, String(step.sequence + 1), args.id),
        deckId: args.deckId,
        runId: args.runId,
        traceId,
        spanId: step.spanId,
        name: step.status === 'error' ? 'evidence.capture.failed' : 'evidence.capture.attached',
        severity: step.status === 'error' ? 'error' : step.status === 'warning' ? 'warn' : 'info',
        timestamp: step.completedAt,
        body:
          step.status === 'error'
            ? 'Visual evidence capture failed; the source citation remains available.'
            : 'Visual evidence was attached to this exact retrieval span.',
        attributes: [
          { key: 'nodeslide.evidence.capture_id', value: args.id },
          { key: 'nodeslide.evidence.source_id', value: args.sourceId },
        ],
        sequence: step.sequence + 1,
      });
      await ctx.db.insert('nodeslide_evidence_steps', {
        id: nodeslideStableId('evidence_step', args.id, String(index)),
        captureId: args.id,
        deckId: args.deckId,
        runId: args.runId,
        traceId,
        spanId: step.spanId,
        sequence: index + 1,
        phase: step.phase,
        label: step.label,
        status: step.status,
        ...(step.detail ? { detail: requiredText(step.detail, 'evidence detail', 1000) } : {}),
        ...(step.screenshotStorageId
          ? { screenshotStorageId: step.screenshotStorageId, attachmentKind: 'screenshot' as const }
          : {}),
        ...(step.pdfStorageId
          ? { pdfStorageId: step.pdfStorageId, attachmentKind: 'pdf' as const }
          : {}),
        ...(step.box ? { box: step.box } : {}),
        regionScope: step.regionScope,
        ...(step.selector
          ? { selector: requiredText(step.selector, 'evidence selector', 300) }
          : {}),
        ...(step.quote ? { quote: requiredText(step.quote, 'evidence quote', 1000) } : {}),
        ...(step.viewport ? { viewport: step.viewport } : {}),
        ...(step.contentDigest ? { contentDigest: step.contentDigest.slice(0, 180) } : {}),
        ...(step.attachmentDigest ? { attachmentDigest: step.attachmentDigest } : {}),
        evidenceStepDigest: step.evidenceStepDigest,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
        createdAt: now,
      });
    }
    const screenshotCount = preparedSteps.filter((step) => step.screenshotStorageId).length;
    const pdfCount = preparedSteps.filter((step) => step.pdfStorageId).length;
    const captureDigest = nodeslideContentDigest(
      stableJson({
        deckId: args.deckId,
        runId: args.runId,
        traceId,
        parentSpanId: args.parentSpanId,
        sourceRevisionId: sourceRevision.id,
        sourceRevisionDigest: sourceRevision.revisionDigest,
        url: source.url ?? args.url,
        goal: args.goal,
        provider: args.provider,
        status: args.status,
        error: args.error,
        contentDigest: args.contentDigest,
        steps: preparedSteps.map((step) => ({
          sequence: step.sequence,
          evidenceStepDigest: step.evidenceStepDigest,
        })),
        startedAt,
        completedAt,
      }),
    );
    await ctx.db.insert('nodeslide_evidence_captures', {
      id: args.id,
      deckId: args.deckId,
      runId: args.runId,
      traceId,
      spanId: captureSpanId,
      parentSpanId: args.parentSpanId,
      sourceId: args.sourceId,
      sourceRevisionId: sourceRevision.id,
      sourceRevisionDigest: sourceRevision.revisionDigest,
      captureDigest,
      url: source.url ?? args.url,
      goal: requiredText(args.goal, 'evidence goal', 500),
      provider: requiredText(args.provider, 'evidence provider', 80),
      status: args.status,
      ...(args.error ? { error: requiredText(args.error, 'evidence error', 500) } : {}),
      ...(args.contentDigest ? { contentDigest: args.contentDigest.slice(0, 180) } : {}),
      stepCount: preparedSteps.length,
      screenshotCount,
      pdfCount,
      createdAt: startedAt,
      completedAt,
      expiresAt: completedAt + NODESLIDE_EVIDENCE_CAPTURE_TTL_MS,
    });
    const parentEndTime = Math.max(parent.endTime ?? parent.startTime, completedAt);
    await ctx.db.patch(parent._id, {
      endTime: parentEndTime,
      durationMs: Math.max(0, parentEndTime - parent.startTime),
      updatedAt: now,
    });
    await ctx.db.patch(run._id, {
      nextTelemetrySequence: telemetrySequence,
      updatedAt: Math.max(run.updatedAt, completedAt),
      lastHeartbeatAt: Math.max(run.lastHeartbeatAt ?? 0, completedAt),
    });
    return { created: true, captureId: args.id, spanId: captureSpanId };
  },
});

/** Removes expired binary attachments while retaining their auditable trace metadata and digest. */
export const pruneExpiredEvidenceCapturesInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const captures = await ctx.db
      .query('nodeslide_evidence_captures')
      .withIndex('by_expiry', (query) => query.lte('expiresAt', now))
      .take(20);
    let deletedAttachments = 0;
    for (const capture of captures) {
      const steps = await ctx.db
        .query('nodeslide_evidence_steps')
        .withIndex('by_capture_sequence', (query) => query.eq('captureId', capture.id))
        .take(NODESLIDE_EVIDENCE_STEP_LIMIT_PER_CAPTURE + 1);
      if (steps.length > NODESLIDE_EVIDENCE_STEP_LIMIT_PER_CAPTURE) {
        throw new Error('Expired evidence capture exceeds its bounded step limit.');
      }
      for (const step of steps) {
        if (step.screenshotStorageId) {
          await ctx.storage.delete(step.screenshotStorageId);
          deletedAttachments += 1;
        }
        if (step.pdfStorageId) {
          await ctx.storage.delete(step.pdfStorageId);
          deletedAttachments += 1;
        }
        if (step.screenshotStorageId || step.pdfStorageId || step.attachmentKind) {
          await ctx.db.patch(step._id, {
            screenshotStorageId: undefined,
            pdfStorageId: undefined,
            attachmentKind: undefined,
          });
        }
      }
      await ctx.db.patch(capture._id, {
        status: 'expired',
        screenshotCount: 0,
        pdfCount: 0,
        expiresAt: undefined,
      });
    }
    return { captures: captures.length, deletedAttachments };
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
    messageId: v.optional(v.string()),
    role: v.optional(v.union(v.literal('assistant'), v.literal('tool'), v.literal('system'))),
    toolName: v.optional(v.string()),
    toolCallId: v.optional(v.string()),
    parentMessageId: v.optional(v.string()),
    agentRole: v.optional(
      v.union(
        v.literal('planner'),
        v.literal('executor'),
        v.literal('researcher'),
        v.literal('validator'),
        v.literal('analyst'),
        v.literal('storyteller'),
        v.literal('designer'),
        v.literal('fact_checker'),
        v.literal('reviewer'),
      ),
    ),
    branchId: v.optional(v.string()),
    branchLabel: v.optional(v.string()),
    parallelGroupId: v.optional(v.string()),
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
    const traceId = row.otelTraceId ?? agentTraceId(args.deckId, args.runId);
    const rootSpanId = row.rootSpanId ?? agentSpanId(traceId, 'invoke_agent', 1);
    if (args.message && args.messageId) {
      const replayMessageId = requiredText(args.messageId, 'message id', 180);
      const replayMessage = requiredText(args.message, 'run message', 4000);
      const replayRole = args.role ?? 'system';
      const existingMessage = await ctx.db
        .query('nodeslide_agent_messages')
        .withIndex('by_stable_id', (query) => query.eq('id', replayMessageId))
        .unique();
      if (existingMessage) {
        const expectedSourceIds = args.sourceIds?.slice(0, 32);
        if (
          existingMessage.deckId !== args.deckId ||
          existingMessage.runId !== args.runId ||
          existingMessage.role !== replayRole ||
          existingMessage.content !== replayMessage ||
          existingMessage.toolName !== args.toolName ||
          existingMessage.toolCallId !== args.toolCallId ||
          existingMessage.parentMessageId !== args.parentMessageId ||
          existingMessage.agentRole !== args.agentRole ||
          existingMessage.branchId !== args.branchId ||
          existingMessage.branchLabel !== args.branchLabel ||
          existingMessage.parallelGroupId !== args.parallelGroupId ||
          !sameOptionalStrings(existingMessage.sourceIds, expectedSourceIds)
        ) {
          throw new Error('Agent message idempotency binding conflict.');
        }
        return {
          runId: args.runId,
          traceId,
          spanId: rootSpanId,
          messageId: replayMessageId,
          replayed: true,
        };
      }
    }
    const now = Date.now();
    const terminal = ['completed', 'failed', 'cancelled'].includes(args.status);
    const sequence = row.nextTelemetrySequence ?? 3;
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
      ...(args.memoryIds ? { memoryIds: args.memoryIds.slice(0, 6) } : {}),
      ...(args.memoryDigests ? { memoryDigests: args.memoryDigests.slice(0, 6) } : {}),
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
    let messageId: string | undefined;
    if (args.message) {
      const message = requiredText(args.message, 'run message', 4000);
      const role = args.role ?? 'system';
      messageId = args.messageId
        ? requiredText(args.messageId, 'message id', 180)
        : nodeslideStableId('agent_message', args.runId, role, String(now), message);
      await ctx.db.insert('nodeslide_agent_messages', {
        id: messageId,
        deckId: args.deckId,
        runId: args.runId,
        role,
        content: message,
        ...(args.toolName ? { toolName: requiredText(args.toolName, 'tool name', 120) } : {}),
        ...(args.toolCallId
          ? { toolCallId: requiredText(args.toolCallId, 'tool call id', 180) }
          : {}),
        ...(args.parentMessageId
          ? { parentMessageId: requiredText(args.parentMessageId, 'parent message id', 180) }
          : {}),
        ...(args.agentRole ? { agentRole: args.agentRole } : {}),
        ...(args.branchId ? { branchId: requiredText(args.branchId, 'branch id', 120) } : {}),
        ...(args.branchLabel
          ? { branchLabel: requiredText(args.branchLabel, 'branch label', 120) }
          : {}),
        ...(args.parallelGroupId
          ? { parallelGroupId: requiredText(args.parallelGroupId, 'parallel group id', 120) }
          : {}),
        ...(args.sourceIds ? { sourceIds: args.sourceIds.slice(0, 32) } : {}),
        createdAt: now,
      });
    }
    return { runId: args.runId, traceId, spanId: phaseSpanId, messageId };
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
      await ensureNodeSlideSourceRevision(ctx, {
        source,
        ownerAccessKey: args.ownerAccessKey,
        contentDigest: source.contentDigest,
        createdAt: now,
      });
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
    externalEgressAuthorized: v.boolean(),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    reasoningEffort: v.optional(nodeslideReasoningEffortValidator),
    costMicroUsd: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    jobId: v.optional(v.string()),
    executionAccessKey: v.optional(v.string()),
    durableRequestDigest: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!isOwnerAccessKey(args.ownerAccessKey))
      throw new Error('Invalid NodeSlide owner access key.');
    const jobId = args.jobId;
    const job = jobId
      ? await ctx.db
          .query('nodeslide_agent_jobs')
          .withIndex('by_stable_id', (query) => query.eq('id', jobId))
          .unique()
      : null;
    if (jobId) {
      if (
        !job ||
        job.kind !== 'create_deck' ||
        job.ownerDigest !== nodeSlideJobOwnerDigest(args.ownerAccessKey) ||
        !args.executionAccessKey ||
        job.executionDigest !== nodeSlideJobExecutionDigest(args.executionAccessKey) ||
        !args.durableRequestDigest ||
        job.requestDigest !== args.durableRequestDigest ||
        (job.status !== 'queued' && job.status !== 'running')
      ) {
        throw new Error('Durable NodeSlide job authorization is invalid.');
      }
      if (job.resultDeckId && job.resultDeckId !== args.deckId) {
        throw new Error('Durable NodeSlide job output binding is invalid.');
      }
      if (
        args.deckId !== nodeslideStableId('deck_job', jobId) ||
        args.projectId !== nodeslideStableId('project_nodeslide_job', jobId)
      ) {
        throw new Error('Durable NodeSlide job output identity is invalid.');
      }
    } else if (args.executionAccessKey !== undefined || args.durableRequestDigest !== undefined) {
      throw new Error('Durable NodeSlide creation capability requires a job binding.');
    }
    const existing = await findDeckRow(ctx, args.deckId);
    if (existing) {
      await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
      if (job) {
        await ctx.db.patch(job._id, {
          resultDeckId: args.deckId,
          status: 'running',
          phase: 'persisting',
          progress: Math.max(job.progress, 85),
          updatedAt: Date.now(),
        });
      }
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
          nodeSlideCreationAuthorizationLine({
            externalEgressAuthorized: args.externalEgressAuthorized,
            ...(args.provider ? { provider: args.provider } : {}),
            ...(args.model ? { model: args.model } : {}),
          }),
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
    if (job) {
      await ctx.db.patch(job._id, {
        resultDeckId: args.deckId,
        status: 'running',
        phase: 'persisting',
        progress: Math.max(job.progress, 85),
        updatedAt: Date.now(),
      });
    }
    return await ownerWorkspaceResponse(ctx, args.deckId, args.ownerAccessKey, Date.now());
  },
});

/**
 * D11 retention: duplicate an owned deck into a brand-new identity under a new
 * owner capability. The fork is fully re-identified (no stable-id collisions),
 * starts at version 1, and rides the same persistence, validation, and trace
 * path as every other created deck. Findings persist visibly rather than
 * blocking — the source deck's state is the truth being copied.
 */
export const duplicateDeck = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    newOwnerAccessKey: v.string(),
    clientSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    if (!isOwnerAccessKey(args.newOwnerAccessKey)) {
      throw new Error('Invalid NodeSlide owner access key for the duplicate.');
    }
    const source = await requireSnapshot(ctx, args.deckId);
    const now = Date.now();
    const forkDigest = nodeslideContentDigest(`${args.deckId}:${now}:${args.clientSessionId}`);
    const deckId = nodeslideStableId('deck_fork', forkDigest);
    const projectId = nodeslideStableId('project_fork', forkDigest);
    const forked = forkNodeSlideSnapshot(source, { deckId, projectId, now });
    await createWorkspaceRows(ctx, {
      clientSessionId: args.clientSessionId,
      ownerAccessKey: args.newOwnerAccessKey,
      built: {
        snapshot: forked,
        plan: [
          `Duplicated from "${source.deck.title}"`,
          'Re-identified every slide, element, and source',
          'Validated the duplicate before persisting',
        ],
        spec: {
          title: forked.deck.title,
          narrative: [`Duplicated from deck ${source.deck.id} at v${source.deck.version}`],
          slides: [],
        },
      },
      layoutBlockerPolicy: 'persist_with_findings',
      trace: {
        summary: `Duplicated "${source.deck.title}" as a new editable deck.`,
        context: [
          `Source deck: ${source.deck.id} at v${source.deck.version}`,
          'Share links, publications, and signature bindings were not copied.',
        ],
        toolCalls: [
          'Forked the canonical snapshot with fresh identities',
          'Reset version clocks to v1',
          'Validated snapshot',
        ],
      },
    });
    return { deckId, title: forked.deck.title };
  },
});

/**
 * D8 create=edit parity: persists a server-imported PPTX snapshot as a brand-new
 * deck through the same createWorkspaceRows path (validation, project row,
 * initial version, creation trace) as a brief-created deck. Import-only caller:
 * nodeslidePptxCreate.importPptxAsNewDeck.
 */
export const createImportedDeckInternal = internalMutation({
  args: {
    clientSessionId: v.string(),
    ownerAccessKey: v.string(),
    snapshot: v.any(),
    fileName: v.string(),
    fidelityNotes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const snapshot = structuredClone(args.snapshot) as DeckSnapshot;
    const existing = await findDeckRow(ctx, snapshot.deck.id);
    if (existing) {
      await requireOwnerAccess(ctx, snapshot.deck.id, args.ownerAccessKey);
      return { deckId: snapshot.deck.id, reused: true };
    }
    const built = {
      snapshot,
      plan: [
        `Imported ${args.fileName}`,
        'Parsed slides, text, and native objects inside bounded import limits',
        'Validated the imported structure before persisting',
      ],
      spec: {
        title: snapshot.deck.title,
        narrative: [`Imported from PowerPoint: ${args.fileName}`],
        slides: [],
      },
    };
    await createWorkspaceRows(ctx, {
      clientSessionId: args.clientSessionId,
      ownerAccessKey: args.ownerAccessKey,
      built,
      layoutBlockerPolicy: 'persist_with_findings',
      trace: {
        summary: `Imported ${args.fileName} as a new editable deck.`,
        context: [
          `Source file: ${args.fileName}`,
          ...(args.fidelityNotes.length
            ? args.fidelityNotes.map((note) => `Fidelity: ${note}`)
            : ['Fidelity: full import, no recorded loss']),
        ],
        toolCalls: [
          'Parsed PPTX archive server-side within hostile-input bounds',
          'Imported slides and elements into the canonical snapshot',
          'Validated snapshot',
        ],
      },
    });
    return { deckId: snapshot.deck.id, reused: false };
  },
});

async function requireAgentSourceAuthorization(
  ctx: Pick<MutationCtx, 'db'>,
  deckId: string,
  sourceIds: readonly string[],
): Promise<void> {
  if (sourceIds.length > NODESLIDE_AGENT_READ_CONTEXT_LIMITS.sourceIds) {
    throw new Error('Agent source authorization exceeds the bounded read-context limit.');
  }
  const rows = await Promise.all(
    sourceIds.map((sourceId) =>
      ctx.db
        .query('nodeslide_sources')
        .withIndex('by_stable_id', (query) => query.eq('id', sourceId))
        .unique(),
    ),
  );
  if (rows.some((row) => !row || row.deckId !== deckId || row.status === 'failed')) {
    throw new Error('Agent source authorization references a source outside this deck.');
  }
}

type DurableEditProposalBindingArgs = {
  id: string;
  deckId: string;
  ownerAccessKey: string;
  jobId?: string;
  executionAccessKey?: string;
  durableRequestDigest?: string;
};

async function requireDurableEditProposalBinding(
  ctx: Pick<MutationCtx, 'db'>,
  args: DurableEditProposalBindingArgs,
): Promise<Doc<'nodeslide_agent_jobs'> | null> {
  if (!args.jobId) {
    if (args.executionAccessKey !== undefined || args.durableRequestDigest !== undefined) {
      throw new Error('Durable proposal capability material requires a job binding.');
    }
    return null;
  }
  if (!args.executionAccessKey || !args.durableRequestDigest) {
    throw new Error('Durable proposal capability material is incomplete.');
  }
  const jobId = args.jobId;
  const jobs = await ctx.db
    .query('nodeslide_agent_jobs')
    .withIndex('by_stable_id', (query) => query.eq('id', jobId))
    .take(2);
  const job = jobs.length === 1 ? jobs[0] : null;
  if (
    !job ||
    job.kind !== 'edit_proposal' ||
    job.ownerDigest !== nodeSlideJobOwnerDigest(args.ownerAccessKey) ||
    job.executionDigest !== nodeSlideJobExecutionDigest(args.executionAccessKey) ||
    job.requestDigest !== args.durableRequestDigest ||
    !['queued', 'running', 'awaiting_review'].includes(job.status)
  ) {
    throw new Error('Durable NodeSlide proposal authorization is invalid.');
  }
  if (
    (job.resultDeckId !== undefined && job.resultDeckId !== args.deckId) ||
    (job.resultPatchId !== undefined && job.resultPatchId !== args.id)
  ) {
    throw new Error('Durable NodeSlide proposal output binding is invalid.');
  }
  return job;
}

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
    sourceBindingPolicy: v.optional(
      v.union(v.literal('not_applicable'), v.literal('required_external_evidence')),
    ),
    authorizedSourceIds: v.optional(v.array(v.string())),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    reasoningEffort: v.optional(nodeslideReasoningEffortValidator),
    costMicroUsd: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const durableJob = await requireDurableEditProposalBinding(ctx, args);
    if (args.toolCalls.length > 16) throw new Error('Too many agent tool calls recorded.');
    if (
      args.traceContext.length > 40 ||
      args.traceContext.some((line) => line.length === 0 || line.length > 500)
    ) {
      throw new Error('Agent trace context is invalid or exceeds bounds.');
    }
    const sourceLineage = buildNodeSlideSourceLineage({
      operations: args.operations,
      authorizedSourceIds: args.authorizedSourceIds ?? [],
      policy: args.sourceBindingPolicy ?? 'not_applicable',
    });
    await requireAgentSourceAuthorization(ctx, args.deckId, args.authorizedSourceIds ?? []);
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
    if (proposal.patch.status === 'ready') {
      await persistNodeSlideClaimEvidenceReceipts(ctx, {
        deckId: args.deckId,
        ownerAccessKey: args.ownerAccessKey,
        patchId: proposal.patch.id,
        traceId: args.traceId,
        ...(durableJob?.conversationRunId ? { runId: durableJob.conversationRunId } : {}),
        operations: args.operations,
        createdAt: proposal.patch.createdAt,
      });
    }
    if (durableJob) {
      if (proposal.patch.status !== 'ready' || !proposal.patch.candidateDigest) {
        throw new Error('Durable NodeSlide proposal did not produce a reviewable candidate.');
      }
      if (
        durableJob.resultCandidateDigest !== undefined &&
        durableJob.resultCandidateDigest !== proposal.patch.candidateDigest
      ) {
        throw new Error('Durable NodeSlide proposal candidate binding is invalid.');
      }
      if (durableJob.status === 'awaiting_review') {
        if (
          durableJob.resultDeckId !== args.deckId ||
          durableJob.resultPatchId !== args.id ||
          durableJob.resultCandidateDigest !== proposal.patch.candidateDigest
        ) {
          throw new Error('Durable NodeSlide proposal replay binding is invalid.');
        }
      } else {
        await ctx.db.patch(durableJob._id, {
          status: 'running',
          phase: 'validating',
          progress: Math.max(durableJob.progress, 95),
          resultDeckId: args.deckId,
          resultPatchId: args.id,
          resultCandidateDigest: proposal.patch.candidateDigest,
          updatedAt: Date.now(),
        });
      }
    }
    const existingTrace = await ctx.db
      .query('nodeslide_traces')
      .withIndex('by_patch', (query) => query.eq('patchId', args.id))
      .first();
    if (existingTrace) {
      if (
        existingTrace.deckId !== args.deckId ||
        existingTrace.id !== args.traceId ||
        existingTrace.patchId !== args.id
      ) {
        throw new Error('Agent proposal trace idempotency binding is invalid.');
      }
      const hasPersistedSourceLineage =
        existingTrace.sourceBindingStatus !== undefined ||
        existingTrace.claimSourceBindings !== undefined;
      if (
        hasPersistedSourceLineage &&
        stableJson({
          sourceBindingStatus: existingTrace.sourceBindingStatus,
          claimSourceBindings: existingTrace.claimSourceBindings ?? [],
        }) !== stableJson(sourceLineage)
      ) {
        throw new Error('Agent proposal source-lineage idempotency binding is invalid.');
      }
      if (!hasPersistedSourceLineage) {
        await ctx.db.patch(existingTrace._id, sourceLineage);
      }
      return proposal;
    }
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
        sourceLineage.sourceBindingStatus === 'bound'
          ? 'Claim-level source bindings verified server-side'
          : 'No source-grounded factual operation was persisted',
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
      ...sourceLineage,
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

function proposalReplayMatches(
  existing: Doc<'nodeslide_patches'>,
  args: PatchMutationArgs,
): boolean {
  return (
    stableJson({
      deckId: existing.deckId,
      baseDeckVersion: existing.baseDeckVersion,
      baseSlideVersions: existing.baseSlideVersions,
      baseElementVersions: existing.baseElementVersions,
      scope: existing.scope,
      operations: existing.operations,
      source: existing.source,
      summary: existing.summary,
      linkedCommentId: existing.linkedCommentId,
      traceId: existing.traceId,
      jobId: existing.jobId,
      proposalKind: existing.proposalKind ?? 'edit',
      parentPatchId: existing.parentPatchId,
      affectedSlideIds: existing.affectedSlideIds,
      affectedSlideDigest: existing.affectedSlideDigest,
      profileId: existing.profileId,
      profileDigest: existing.profileDigest,
    }) ===
    stableJson({
      deckId: args.deckId,
      baseDeckVersion: args.baseDeckVersion,
      baseSlideVersions: args.baseSlideVersions,
      baseElementVersions: args.baseElementVersions,
      scope: args.scope,
      operations: args.operations,
      source: args.source ?? 'human',
      summary: args.summary?.trim() || 'Scoped NodeSlide change.',
      linkedCommentId: args.linkedCommentId,
      traceId: args.traceId,
      jobId: args.jobId,
      proposalKind: args.proposalKind ?? 'edit',
      parentPatchId: args.parentPatchId,
      affectedSlideIds: args.affectedSlideIds,
      affectedSlideDigest: args.affectedSlideDigest,
      profileId: args.profileId,
      profileDigest: args.profileDigest,
    })
  );
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
    if (!proposalReplayMatches(existing, args)) {
      throw new Error('Patch idempotency key belongs to a different proposal.');
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
  delegatedAuthority?: NodeSlideDelegatedCommitAuthority,
) {
  const deckRow = delegatedAuthority
    ? delegatedAuthority.deckRow
    : await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
  if (deckRow.id !== args.deckId) throw new Error('Patch authority does not match the deck.');
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
    if (existing) {
      await finishPatchTrace(ctx, existing, now, 'failed', undefined, delegatedAuthority);
    }
    return {
      patch: stale,
      workspace: await loadNodeSlideWorkspace(ctx, args.deckId, now),
      rebased: false,
      staleReasons: cas.reasons,
    };
  }
  const candidate = preflightNodeSlideCandidate(snapshot, args, signatureProfile, id, now);
  if (delegatedAuthority) {
    const delegationViolations = nodeSlideDelegationCandidateViolations({
      baseline: snapshot,
      candidate: candidate.snapshot,
      operations: args.operations,
    });
    if (delegationViolations.length > 0) {
      throw new Error(delegationViolations.join(' '));
    }
  }
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
    if (existing) {
      await finishPatchTrace(ctx, existing, now, 'failed', undefined, delegatedAuthority);
    }
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
  const receiptJobId = args.jobId;
  const receiptJob = receiptJobId
    ? await ctx.db
        .query('nodeslide_agent_jobs')
        .withIndex('by_stable_id', (query) => query.eq('id', receiptJobId))
        .unique()
    : null;
  if (
    receiptJob &&
    receiptJob.resultDeckId !== undefined &&
    receiptJob.resultDeckId !== args.deckId
  ) {
    throw new Error('Claim evidence receipt job crossed its deck boundary.');
  }
  if (receiptJob?.conversationRunId) {
    const boundRun = await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_stable_id', (query) => query.eq('id', receiptJob.conversationRunId as string))
      .unique();
    if (boundRun?.sourceRefreshProposalId) {
      if (!boundRun.sourceRefreshBaseSnapshotDigest) {
        throw new Error('Accepted source refresh is missing its snapshot binding.');
      }
      await commitAcceptedSourceRefresh(ctx, {
        deckId: args.deckId,
        ownerAccessKey: delegatedAuthority ? (deckRow.ownerAccessKey ?? '') : args.ownerAccessKey,
        proposalId: boundRun.sourceRefreshProposalId,
        baseSnapshotDigest: boundRun.sourceRefreshBaseSnapshotDigest,
        patch: existing ?? accepted,
        acceptedAt: now,
      });
    }
  }
  const receiptOwnerAccessKey = delegatedAuthority
    ? (deckRow.ownerAccessKey ?? '')
    : args.ownerAccessKey;
  if (receiptOwnerAccessKey) {
    await persistNodeSlideClaimEvidenceReceipts(ctx, {
      deckId: args.deckId,
      ownerAccessKey: receiptOwnerAccessKey,
      patchId: id,
      ...(args.traceId ? { traceId: args.traceId } : {}),
      ...(receiptJob?.conversationRunId ? { runId: receiptJob.conversationRunId } : {}),
      operations: args.operations,
      createdAt: now,
    });
  }
  await finishPatchTrace(ctx, accepted, now, 'completed', validation, delegatedAuthority);
  return {
    patch: accepted,
    workspace: await loadNodeSlideWorkspace(ctx, args.deckId, now),
    validation,
    rebased: cas.rebased,
  };
}

async function commitAcceptedSourceRefresh(
  ctx: MutationCtx,
  args: {
    deckId: string;
    ownerAccessKey: string;
    proposalId: string;
    baseSnapshotDigest: string;
    patch: Pick<Doc<'nodeslide_patches'>, 'scope' | 'baseDeckVersion'>;
    acceptedAt: number;
  },
): Promise<void> {
  if (!args.ownerAccessKey) {
    throw new Error('Accepted source refresh is missing its owner or snapshot binding.');
  }
  const proposal = await ctx.db
    .query('nodeslide_source_refresh_proposals')
    .withIndex('by_stable_id', (query) => query.eq('id', args.proposalId))
    .unique();
  if (
    !proposal ||
    proposal.deckId !== args.deckId ||
    proposal.ownerDigest !== `actor_${nodeslideContentDigest(args.ownerAccessKey)}` ||
    proposal.status !== 'prepared' ||
    proposal.baseSnapshotDigest !== args.baseSnapshotDigest ||
    proposal.baseDeckVersion !== args.patch.baseDeckVersion
  ) {
    throw new Error('Accepted patch no longer matches its prepared source-refresh binding.');
  }
  const exactSlideScope =
    args.patch.scope.kind === 'slide' &&
    equalStringSets(args.patch.scope.slideIds, proposal.affectedSlideIds);
  const exactElementScope =
    args.patch.scope.kind === 'elements' &&
    equalStringSets(args.patch.scope.elementIds, proposal.affectedElementIds);
  if (!exactSlideScope && !exactElementScope) {
    throw new Error('Accepted patch crossed its monitored-source impact scope.');
  }
  const source = await ctx.db
    .query('nodeslide_sources')
    .withIndex('by_stable_id', (query) => query.eq('id', proposal.sourceId))
    .unique();
  const revision = await ctx.db
    .query('nodeslide_source_revisions')
    .withIndex('by_stable_id', (query) => query.eq('id', proposal.afterRevisionId))
    .unique();
  if (!source || !revision || source.deckId !== args.deckId || revision.deckId !== args.deckId) {
    throw new Error('Accepted source revision is unavailable.');
  }
  await ctx.db.patch(source._id, {
    title: revision.title,
    url: revision.url,
    sourceType: revision.sourceType,
    retrievedAt: revision.retrievedAt,
    citation: revision.citation,
    license: revision.license,
    format: revision.format,
    contentDigest: revision.contentDigest,
    byteSize: revision.byteSize,
    rowCount: revision.rowCount,
    columns: revision.columns,
    provider: revision.provider,
    retention: revision.retention,
    status: 'ready',
    lastRefreshedAt: args.acceptedAt,
  });
  await ctx.db.patch(proposal._id, { status: 'converted', updatedAt: args.acceptedAt });
}

function equalStringSets(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((id) => right.includes(id))
  );
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
    ...(args.jobId ? { jobId: args.jobId } : {}),
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
    /**
     * 'reject' (default, brief path): layout blockers abort with no persistence.
     * 'persist_with_findings' (import path): the user's own file is the truth —
     * it lands as a draft with its validation findings visible, and publication
     * stays gated by validationAllowsPublication until they are repaired.
     */
    layoutBlockerPolicy?: 'reject' | 'persist_with_findings';
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
  const validation = validateNodeSlideSnapshot(
    snapshot,
    now,
    nodeslideStableId('validation', snapshot.deck.id, 'initial'),
  );
  const layoutBlockers = validation.issues.filter(
    (issue) =>
      issue.severity === 'error' && (issue.code === 'collision' || issue.code === 'overflow'),
  );
  if (layoutBlockers.length > 0 && (args.layoutBlockerPolicy ?? 'reject') === 'reject') {
    throw new Error(
      `NodeSlide could not compose a safe first draft (${layoutBlockers.length} layout blocker${layoutBlockers.length === 1 ? '' : 's'}). No deck was persisted; revise or retry the brief.`,
    );
  }
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
  await ctx.db.insert('nodeslide_validations', validation);
  await insertVersion(ctx, snapshot, 'Initial deck', 'system', undefined, now);
  await ctx.db.insert('nodeslide_traces', {
    id: nodeSlideCreationTraceId(snapshot.deck.id),
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
    sourceBindingStatus: 'not_applicable',
    claimSourceBindings: [],
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
  delegatedAuthority?: NodeSlideDelegatedCommitAuthority,
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
  const decisionProvenance: NodeSlideDecisionProvenance = delegatedAuthority
    ? {
        authority: 'delegated',
        capability: 'accept_validated',
        grantId: delegatedAuthority.grantId,
        clientKind: delegatedAuthority.clientKind,
        policyDigest: delegatedAuthority.policyDigest,
        decidedAt: now,
      }
    : { authority: 'owner_capability', decidedAt: now };
  await ctx.db.patch(trace._id, {
    status,
    ...(validation ? { validation } : {}),
    decisionProvenance,
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
    const delegatedDecision = decisionProvenance.authority === 'delegated';
    const decisionKind = delegatedDecision ? 'delegated_decision' : 'owner_capability_decision';
    const decisionAttributes = delegatedDecision
      ? [
          { key: 'nodeslide.decision.authority', value: 'delegated' },
          { key: 'nodeslide.delegation.capability', value: decisionProvenance.capability },
          { key: 'nodeslide.delegation.grant_id', value: decisionProvenance.grantId },
          { key: 'nodeslide.delegation.client_kind', value: decisionProvenance.clientKind },
          { key: 'nodeslide.delegation.policy_digest', value: decisionProvenance.policyDigest },
        ]
      : [
          { key: 'nodeslide.decision.authority', value: 'owner_capability' },
          { key: 'nodeslide.owner_capability_decision', value: status },
        ];
    const decisionSpanId = agentSpanId(otelTraceId, decisionKind, sequence);
    await ctx.db.insert('nodeslide_agent_spans', {
      id: nodeslideStableId('agent_span', run.id, decisionSpanId),
      deckId: run.deckId,
      runId: run.id,
      traceId: otelTraceId,
      spanId: decisionSpanId,
      parentSpanId: rootSpanId,
      name: delegatedDecision
        ? status === 'completed'
          ? 'Accept validated proposal with delegated authority'
          : 'Delegated proposal decision'
        : status === 'completed'
          ? 'Commit validated edit with owner capability'
          : 'Decline proposal with owner capability',
      operationName: delegatedDecision
        ? 'agent.delegated_decision'
        : 'agent.owner_capability_decision',
      kind: 'internal',
      status: status === 'failed' ? 'error' : 'ok',
      startTime: now,
      endTime: now,
      durationMs: 0,
      provider: run.provider,
      model: run.model,
      attributes: [...decisionAttributes, { key: 'nodeslide.patch.id', value: patch.id }],
      sequence,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert('nodeslide_agent_events', {
      id: nodeslideStableId('agent_event', run.id, decisionKind, status),
      deckId: run.deckId,
      runId: run.id,
      traceId: otelTraceId,
      spanId: decisionSpanId,
      name: `agent.${decisionKind}.${status}`,
      severity: status === 'failed' ? 'error' : 'info',
      timestamp: now,
      body: delegatedDecision
        ? status === 'completed'
          ? 'Validated proposal accepted under delegated authority.'
          : 'Delegated acceptance could not apply the validated proposal; the deck remains unchanged.'
        : status === 'completed'
          ? 'The owner capability committed the validated edit.'
          : 'The owner capability declined or could not apply the proposal; the deck remains unchanged.',
      attributes: decisionAttributes,
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
    const content = delegatedDecision
      ? status === 'completed'
        ? 'Accepted under delegated authority and applied as a new deck version.'
        : 'Delegated acceptance could not apply the proposal. The deck remains unchanged.'
      : status === 'completed'
        ? 'Validated edit applied as a new deck version. Undo is available.'
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

function isNormalizedEvidenceBox(box: NodeSlideEvidenceBox & { pageCount?: number }): boolean {
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.w) &&
    Number.isFinite(box.h) &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.w > 0 &&
    box.h > 0 &&
    box.x + box.w <= 1 &&
    box.y + box.h <= 1 &&
    (box.page === undefined ||
      (Number.isInteger(box.page) && box.page > 0 && box.page <= 10_000)) &&
    (box.pageCount === undefined ||
      (Number.isInteger(box.pageCount) &&
        box.pageCount > 0 &&
        box.pageCount <= 100_000 &&
        box.page !== undefined &&
        box.page <= box.pageCount))
  );
}

function requiredText(value: string, label: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error(`${label} is required.`);
  if (clean.length > max) throw new Error(`${label} exceeds ${max} characters.`);
  return clean;
}

function sameOptionalStrings(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (!left || !right) return left === undefined && right === undefined;
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
