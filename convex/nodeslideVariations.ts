import { ConvexError, v } from 'convex/values';
import type { DeckSnapshot } from '../shared/nodeslide';
import type { SignatureProfile } from '../shared/nodeslideSignature';
import type { SlideVariation, VariationBatch } from '../shared/nodeslideVariation';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';
import {
  deckFromRow,
  elementFromRow,
  findPatchRow,
  slideFromRow,
  sourceFromRow,
} from './lib/nodeslideData';
import { nodeslideEventId, nodeslideHash, nodeslideStableId } from './lib/nodeslideIds';
import {
  NodeSlideProviderConsentError,
  validateNodeSlideProviderChoice,
} from './lib/nodeslideProviderConsent';
import { NodeSlidePreviewQuotaError, consumePreviewQuotaBuckets } from './lib/nodeslideQuota';
import {
  findSignatureProfile,
  parseSignatureProfileFromStorage,
} from './lib/nodeslideSignatureProfiles';
import {
  nodeslideAgentModelValidator,
  nodeslideProviderModeValidator,
  nodeslideReasoningEffortValidator,
  nodeslideVariationValidator,
} from './lib/nodeslideValidators';
import {
  NODESLIDE_VARIATION_BATCH_LIMIT,
  NODESLIDE_VARIATION_CANDIDATE_BYTE_LIMIT,
  NODESLIDE_VARIATION_DECISION_LIMIT,
  NODESLIDE_VARIATION_DIAGNOSTIC_LIMIT,
  NODESLIDE_VARIATION_ELEMENT_LIMIT,
  NODESLIDE_VARIATION_REASON_LIMIT,
  NODESLIDE_VARIATION_RECORD_LIMIT,
  NodeSlideVariationError,
  type VariationDecisionTrace,
  type VariationFailureCode,
  type VariationProviderOutcome,
  boundVariationListByBytes,
  boundedVariationListLimit,
  buildSlideVariations,
  cleanDiagnostic,
  planVariationGeneration,
  planVariationRejection,
  runIndependentVariationProviderBranches,
  variationJudgeComparisonDigest,
  variationMaterializedFingerprint,
  variationOperationFingerprint,
  variationPreviewQuotaBuckets,
  variationRetentionPlan,
} from './lib/nodeslideVariationHarness';

// Generated API declarations are intentionally not regenerated in this shared lane. Convex resolves
// these module proxies dynamically at runtime; the casts bridge the checked-in declaration only.
// biome-ignore lint/suspicious/noExplicitAny: see comment above
const nodeslideInternal: any = (internal as any).nodeslide;
// biome-ignore lint/suspicious/noExplicitAny: see comment above
const variationInternal: any = (internal as any).nodeslideVariations;
// biome-ignore lint/suspicious/noExplicitAny: see comment above
const variationProviderInternal: any = (internal as any).nodeslideVariationProvider;
interface VariationGenerationReceipt {
  batch: VariationBatch;
  variations: SlideVariation[];
}

interface VariationGenerationContext {
  snapshot: DeckSnapshot;
  signatureProfileJson?: string;
}

type VariationGenerationStart =
  | { ok: true; batch: VariationBatch }
  | { ok: false; reason: 'quota_exceeded' };

export const generate = action({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    slideId: v.string(),
    providerMode: v.optional(nodeslideProviderModeValidator),
    providerModel: v.optional(nodeslideAgentModelValidator),
    providerEffort: v.optional(nodeslideReasoningEffortValidator),
    providerConsent: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<VariationGenerationReceipt> => {
    let providerChoice: ReturnType<typeof validateNodeSlideProviderChoice>;
    try {
      providerChoice = validateNodeSlideProviderChoice(
        'variations',
        args.providerMode,
        args.providerConsent,
        args.providerModel,
        args.providerEffort,
      );
    } catch (error) {
      if (error instanceof NodeSlideProviderConsentError) {
        throw publicVariationError('invalid_request', error.message);
      }
      throw error;
    }
    const startedAt = Date.now();
    const generationContext = (await ctx.runQuery(variationInternal.getGenerationContext, {
      deckId: args.deckId,
      ownerAccessKey: args.ownerAccessKey,
      slideId: args.slideId,
    })) as VariationGenerationContext | null;
    if (!generationContext) throw publicVariationError('invalid_request', 'Slide is unavailable.');
    const snapshot = generationContext.snapshot;
    const signatureProfile: SignatureProfile | undefined = generationContext.signatureProfileJson
      ? parseSignatureProfileFromStorage(generationContext.signatureProfileJson)
      : undefined;
    const batchIdSeed = nodeslideEventId(
      'variation_batch',
      startedAt,
      args.deckId,
      args.slideId,
      String(snapshot.deck.version),
      nodeslideHash(
        JSON.stringify(snapshot.elements.map((element) => [element.id, element.version])),
      ),
      variationRequestNonce(),
    );
    let startedBatch: VariationBatch;
    try {
      const start = await runWithContentionRetry(
        async () =>
          (await ctx.runMutation(variationInternal.beginGeneration, {
            deckId: args.deckId,
            ownerAccessKey: args.ownerAccessKey,
            slideId: args.slideId,
            batchId: batchIdSeed,
            createdAt: startedAt,
            providerMode: providerChoice.providerMode,
          })) as VariationGenerationStart,
      );
      if (!start.ok) {
        throw publicVariationError(
          'quota_exceeded',
          'The variation preview quota is exhausted for the current window.',
        );
      }
      startedBatch = start.batch;
    } catch (error) {
      if (error instanceof ConvexError) throw error;
      throw publicVariationError(
        'generation_failed',
        'The variation request could not be started safely.',
      );
    }
    const batchId = startedBatch.id;

    try {
      let provider: VariationProviderOutcome;
      if (providerChoice.providerMode === 'deterministic') {
        provider = { ok: false, reason: 'provider_not_requested' };
      } else {
        const branches = await runIndependentVariationProviderBranches({
          snapshot,
          slideId: args.slideId,
          ...(signatureProfile ? { signatureProfile } : {}),
          invoke: async (_axes, prompt) =>
            (await ctx.runAction(variationProviderInternal.generateStrictJson, {
              ...prompt,
              model: providerChoice.providerModel,
              reasoningEffort: providerChoice.providerEffort,
            })) as { ok: true; value: unknown } | { ok: false; reason: string },
        });
        provider = { ok: true, branches };
      }
      const built = buildSlideVariations({
        snapshot,
        slideId: args.slideId,
        batchId,
        createdAt: startedAt,
        provider,
        ...(signatureProfile ? { signatureProfile } : {}),
      });
      return await runWithContentionRetry(
        async () =>
          (await ctx.runMutation(variationInternal.finishGeneration, {
            deckId: args.deckId,
            ownerAccessKey: args.ownerAccessKey,
            slideId: args.slideId,
            batchId,
            origin: built.origin,
            ...(built.fallbackReason ? { fallbackReason: built.fallbackReason } : {}),
            variations: built.variations,
            elapsedMs: Date.now() - startedAt,
          })) as VariationGenerationReceipt,
      );
    } catch (error) {
      try {
        await runWithContentionRetry(async () => {
          await ctx.runMutation(variationInternal.failGeneration, {
            deckId: args.deckId,
            ownerAccessKey: args.ownerAccessKey,
            slideId: args.slideId,
            batchId,
            reason: safeGenerationFailure(error),
            elapsedMs: Date.now() - startedAt,
          });
        });
      } catch {
        // A stale generating batch is recovered and pruned by the next bounded generation.
      }
      if (error instanceof NodeSlideVariationError)
        throw publicVariationError(error.code, error.message);
      throw publicVariationError(
        'generation_failed',
        'The variation set could not be generated safely.',
      );
    }
  },
});

export const list = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    slideId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SlideVariation[]> => {
    try {
      await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
      const limit = boundedVariationListLimit(args.limit);
      const rows = await ctx.db
        .query('nodeslide_variations')
        .withIndex('by_deck_slide_created', (index) =>
          index.eq('deckId', args.deckId).eq('slideId', args.slideId),
        )
        .order('desc')
        .take(limit);
      const sorted = rows
        .map(variationFromRow)
        .sort(
          (left, right) =>
            right.createdAt - left.createdAt ||
            right.batchId.localeCompare(left.batchId) ||
            (left.judge?.rank ?? Number.MAX_SAFE_INTEGER) -
              (right.judge?.rank ?? Number.MAX_SAFE_INTEGER) ||
            variationAxisRank(left) - variationAxisRank(right),
        );
      return boundVariationListByBytes(sorted, limit);
    } catch (error) {
      rethrowPublicVariationError(error);
    }
  },
});

export const accept = action({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    variationId: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      return await ctx.runMutation(nodeslideInternal.acceptVariationPatch, args);
    } catch (error) {
      rethrowPublicVariationError(error);
    }
  },
});

export const reject = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    variationId: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SlideVariation> => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const row = await requireVariationRow(ctx, args.deckId, args.variationId);
    if (row.status !== 'ready') return variationFromRow(row);
    const batch = await requireBatchRow(ctx, args.deckId, row.batchId);
    const linkedPatch = await findLinkedVariationPatch(ctx, row);
    if (linkedPatch?.status === 'accepted') {
      throw new NodeSlideVariationError(
        'selection_in_progress',
        'This direction was committed and must be reconciled by retrying Accept.',
      );
    }
    if (linkedPatch?.status === 'stale') {
      const decidedAt = Date.now();
      await ctx.db.patch(row._id, { status: 'stale', decidedAt });
      if (batch.acceptingVariationId) {
        await ctx.db.patch(batch._id, { acceptingVariationId: undefined });
      }
      return variationFromRow(await requireVariationRow(ctx, args.deckId, args.variationId));
    }
    if (linkedPatch?.status === 'ready') {
      await ctx.db.patch(linkedPatch._id, { status: 'rejected', updatedAt: Date.now() });
    }
    if (batch.acceptingVariationId) {
      await ctx.db.patch(batch._id, { acceptingVariationId: undefined });
    }
    const decision = planVariationRejection(variationFromRow(row), args.reason, Date.now());
    if (decision.update && decision.trace) {
      await ctx.db.patch(row._id, {
        status: 'rejected',
        decidedAt: decision.update.decidedAt,
      });
      await insertDecisionTrace(ctx, decision.trace);
      await pruneDecisionTraces(ctx, args.deckId);
    }
    const updated = await requireVariationRow(ctx, args.deckId, args.variationId);
    return variationFromRow(updated);
  },
});

export const getGenerationContext = internalQuery({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    slideId: v.string(),
  },
  handler: async (ctx, args): Promise<VariationGenerationContext> => {
    const deckRow = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const slideRow = await ctx.db
      .query('nodeslide_slides')
      .withIndex('by_deck_id', (index) => index.eq('deckId', args.deckId).eq('id', args.slideId))
      .first();
    if (!slideRow) throw new NodeSlideVariationError('invalid_request', 'Slide is unavailable.');
    const elementRows = await ctx.db
      .query('nodeslide_elements')
      .withIndex('by_slide', (index) => index.eq('slideId', args.slideId))
      .filter((filter) => filter.eq(filter.field('deckId'), args.deckId))
      .take(NODESLIDE_VARIATION_ELEMENT_LIMIT + 1);
    if (elementRows.length === 0 || elementRows.length > NODESLIDE_VARIATION_ELEMENT_LIMIT) {
      throw new NodeSlideVariationError('source_bounds', 'The selected slide exceeds read bounds.');
    }
    const elements = elementRows.map(elementFromRow);
    const referencedSourceIds = [
      ...new Set(
        elements.flatMap((element) => [
          ...element.sourceIds,
          ...(element.chart?.sourceId ? [element.chart.sourceId] : []),
        ]),
      ),
    ];
    if (referencedSourceIds.length > NODESLIDE_VARIATION_ELEMENT_LIMIT) {
      throw new NodeSlideVariationError(
        'source_bounds',
        'The selected slide exceeds source bounds.',
      );
    }
    const sourceRows = await Promise.all(
      referencedSourceIds.map((sourceId) =>
        ctx.db
          .query('nodeslide_sources')
          .withIndex('by_stable_id', (index) => index.eq('id', sourceId))
          .first(),
      ),
    );
    const deck = deckFromRow(deckRow);
    const snapshot: DeckSnapshot = {
      deck: { ...deck, slideOrder: [args.slideId] },
      slides: [slideFromRow(slideRow)],
      elements,
      sources: sourceRows.flatMap((row) =>
        row && row.deckId === args.deckId ? [sourceFromRow(row)] : [],
      ),
    };
    if (!deck.activeSignatureProfileId && !deck.activeSignatureProfileDigest) return { snapshot };
    if (!deck.activeSignatureProfileId || !deck.activeSignatureProfileDigest) {
      throw new NodeSlideVariationError(
        'generation_failed',
        'The active signature profile identity is incomplete.',
      );
    }
    const profileRow = await findSignatureProfile(
      ctx,
      deck.projectId,
      deck.activeSignatureProfileId,
      deck.activeSignatureProfileDigest,
    );
    if (
      !profileRow ||
      profileRow.sourceDigest !== deck.activeSignatureProfileDigest ||
      parseSignatureProfileFromStorage(profileRow.profileJson).source.digest !==
        deck.activeSignatureProfileDigest
    ) {
      throw new NodeSlideVariationError(
        'generation_failed',
        'The active signature profile is unavailable or inconsistent.',
      );
    }
    return { snapshot, signatureProfileJson: profileRow.profileJson };
  },
});

export const beginGeneration = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    slideId: v.string(),
    batchId: v.string(),
    createdAt: v.number(),
    providerMode: v.optional(nodeslideProviderModeValidator),
  },
  handler: async (ctx, args): Promise<VariationGenerationStart> => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const existing = await findBatchRow(ctx, args.batchId);
    if (existing) {
      if (
        existing.deckId === args.deckId &&
        existing.slideId === args.slideId &&
        existing.createdAt === args.createdAt
      ) {
        return { ok: true, batch: batchFromRow(existing) };
      }
      throw new NodeSlideVariationError(
        'generation_failed',
        'A unique bounded variation batch ID could not be allocated.',
      );
    }
    try {
      await consumePreviewQuotaBuckets(ctx, variationPreviewQuotaBuckets(args.ownerAccessKey));
    } catch (error) {
      if (error instanceof NodeSlidePreviewQuotaError) {
        return { ok: false, reason: 'quota_exceeded' };
      }
      throw error;
    }
    await pruneVariationState(ctx, args.deckId, 1);
    const row = {
      id: args.batchId,
      deckId: args.deckId,
      slideId: args.slideId,
      requestedCount: 3 as const,
      status: 'generating' as const,
      origin:
        args.providerMode !== undefined && args.providerMode !== 'deterministic'
          ? ('free_route' as const)
          : ('deterministic_fallback' as const),
      variationIds: [],
      elapsedMs: 0,
      createdAt: args.createdAt,
    };
    await ctx.db.insert('nodeslide_variation_batches', row);
    return { ok: true, batch: row };
  },
});

export const finishGeneration = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    slideId: v.string(),
    batchId: v.string(),
    origin: v.union(v.literal('free_route'), v.literal('deterministic_fallback')),
    fallbackReason: v.optional(v.string()),
    variations: v.array(nodeslideVariationValidator),
    elapsedMs: v.number(),
  },
  handler: async (ctx, args): Promise<VariationGenerationReceipt> => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const batch = await requireBatchRow(ctx, args.deckId, args.batchId);
    if (batch.status === 'ready') {
      const existing = await ctx.db
        .query('nodeslide_variations')
        .withIndex('by_batch', (index) => index.eq('batchId', batch.id))
        .collect();
      return { batch: batchFromRow(batch), variations: existing.map(variationFromRow) };
    }
    if (batch.status !== 'generating') {
      throw new NodeSlideVariationError('generation_failed', 'Generation is already closed.');
    }
    assertPersistableVariationSet(args);
    for (const variation of args.variations) {
      await ctx.db.insert('nodeslide_variations', variation);
    }
    for (const trace of planVariationGeneration(args.variations)) {
      await insertDecisionTrace(ctx, trace);
    }
    const completedAt = Date.now();
    await ctx.db.patch(batch._id, {
      status: 'ready',
      origin: args.origin,
      ...(args.fallbackReason ? { fallbackReason: cleanDiagnostic(args.fallbackReason) } : {}),
      variationIds: args.variations.map((variation) => variation.id),
      elapsedMs: Math.max(0, args.elapsedMs),
      completedAt,
    });
    await pruneVariationState(ctx, args.deckId);
    const updatedBatch = await requireBatchRow(ctx, args.deckId, args.batchId);
    return {
      batch: batchFromRow(updatedBatch),
      variations: args.variations,
    };
  },
});

export const failGeneration = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    slideId: v.string(),
    batchId: v.string(),
    reason: v.string(),
    elapsedMs: v.number(),
  },
  handler: async (ctx, args): Promise<VariationBatch> => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const batch = await requireBatchRow(ctx, args.deckId, args.batchId);
    if (batch.status === 'generating') {
      await ctx.db.patch(batch._id, {
        status: 'failed',
        origin: 'deterministic_fallback',
        fallbackReason: cleanDiagnostic(args.reason),
        elapsedMs: Math.max(0, args.elapsedMs),
        completedAt: Date.now(),
      });
    }
    await pruneVariationState(ctx, args.deckId);
    return batchFromRow(await requireBatchRow(ctx, args.deckId, args.batchId));
  },
});

function assertPersistableVariationSet(args: {
  deckId: string;
  slideId: string;
  batchId: string;
  origin: 'free_route' | 'deterministic_fallback';
  fallbackReason?: string;
  variations: SlideVariation[];
}): void {
  if (args.variations.length !== 3) {
    throw new NodeSlideVariationError('generation_failed', 'Exactly three variants are required.');
  }
  if (
    args.fallbackReason !== undefined &&
    args.fallbackReason.length > NODESLIDE_VARIATION_DIAGNOSTIC_LIMIT
  ) {
    throw new NodeSlideVariationError('generation_failed', 'Fallback diagnostic exceeds bounds.');
  }
  const axes = new Set<string>();
  const fingerprints = new Set<string>();
  const candidateFingerprints = new Set<string>();
  const judgeRanks = new Set<number>();
  const comparisonDigests = new Set<string>();
  const expectedComparisonDigest = variationJudgeComparisonDigest(args.variations);
  const expectedOrigin = args.variations.every((variation) => variation.origin === 'free_route')
    ? 'free_route'
    : 'deterministic_fallback';
  if (
    args.origin !== expectedOrigin ||
    (expectedOrigin === 'deterministic_fallback' && !args.fallbackReason)
  ) {
    throw new NodeSlideVariationError('generation_failed', 'Batch origin is not honest.');
  }
  for (const variation of args.variations) {
    const candidateElementIds = new Set(variation.candidate.elements.map((element) => element.id));
    const baseElementIds = Object.keys(variation.baseElementVersions);
    if (
      variation.deckId !== args.deckId ||
      variation.slideId !== args.slideId ||
      variation.batchId !== args.batchId ||
      variation.status !== 'ready' ||
      variation.operations.length < 1 ||
      variation.operations.length > 8 ||
      !variation.validation.ok ||
      variation.validation.issues.some((issue) => issue.severity === 'error') ||
      new TextEncoder().encode(JSON.stringify(variation.candidate)).byteLength >
        NODESLIDE_VARIATION_CANDIDATE_BYTE_LIMIT ||
      variation.candidate.elements.length > NODESLIDE_VARIATION_ELEMENT_LIMIT ||
      variation.candidate.elements.length !== baseElementIds.length ||
      candidateElementIds.size !== variation.candidate.elements.length ||
      baseElementIds.some((elementId) => !candidateElementIds.has(elementId)) ||
      variation.candidate.elements.some((element) => element.slideId !== args.slideId) ||
      (variation.fallbackReason?.length ?? 0) > NODESLIDE_VARIATION_DIAGNOSTIC_LIMIT ||
      (variation.origin === 'deterministic_fallback' && !variation.fallbackReason) ||
      !validVariationJudgeReceipt(variation, expectedComparisonDigest)
    ) {
      throw new NodeSlideVariationError(
        'generation_failed',
        'A variant exceeded persistence bounds.',
      );
    }
    axes.add(
      `${variation.axes.contentAngle}:${variation.axes.density}:${variation.axes.layoutArchetype}`,
    );
    fingerprints.add(variationOperationFingerprint(variation.operations));
    candidateFingerprints.add(variationMaterializedFingerprint(variation.candidate));
    if (variation.judge) {
      judgeRanks.add(variation.judge.rank);
      comparisonDigests.add(variation.judge.comparisonDigest);
    }
  }
  if (
    axes.size !== 3 ||
    fingerprints.size !== 3 ||
    candidateFingerprints.size !== 3 ||
    judgeRanks.size !== 3 ||
    comparisonDigests.size !== 1
  ) {
    throw new NodeSlideVariationError('generation_failed', 'Variation diversity is not distinct.');
  }
}

function validVariationJudgeReceipt(
  variation: SlideVariation,
  expectedComparisonDigest: string,
): boolean {
  const judge = variation.judge;
  if (!judge) return false;
  const metricValues = Object.values(judge.metrics);
  return (
    judge.version === 'nodeslide.variation-judge/v1' &&
    [1, 2, 3].includes(judge.rank) &&
    judge.maxScore === 100 &&
    judge.candidateCount === 3 &&
    judge.branchId ===
      `${variation.axes.contentAngle}:${variation.axes.density}:${variation.axes.layoutArchetype}` &&
    judge.candidateDigest === variationMaterializedFingerprint(variation.candidate) &&
    judge.comparisonDigest === expectedComparisonDigest &&
    Number.isInteger(judge.score) &&
    judge.score >= 0 &&
    judge.score <= judge.maxScore &&
    judge.score === metricValues.reduce((sum, value) => sum + value, 0) &&
    metricValues.every((value) => Number.isInteger(value) && value >= 0) &&
    judge.metrics.validation <= 40 &&
    judge.metrics.axisFit <= 30 &&
    judge.metrics.coverage <= 15 &&
    judge.metrics.restraint <= 15 &&
    judge.rationale.length > 0 &&
    judge.rationale.length <= NODESLIDE_VARIATION_REASON_LIMIT &&
    judge.judgedAt === variation.createdAt
  );
}

async function pruneVariationState(
  ctx: MutationCtx,
  deckId: string,
  reserveBatchSlots = 0,
): Promise<void> {
  const [batches, decisions, variations] = await Promise.all([
    ctx.db
      .query('nodeslide_variation_batches')
      .withIndex('by_deck_created', (index) => index.eq('deckId', deckId))
      .take(NODESLIDE_VARIATION_BATCH_LIMIT * 4 + 1),
    ctx.db
      .query('nodeslide_variation_decisions')
      .withIndex('by_deck_created', (index) => index.eq('deckId', deckId))
      .take(NODESLIDE_VARIATION_DECISION_LIMIT * 2 + 1),
    ctx.db
      .query('nodeslide_variations')
      .withIndex('by_deck_created', (index) => index.eq('deckId', deckId))
      .take(NODESLIDE_VARIATION_RECORD_LIMIT + 1),
  ]);
  const now = Date.now();
  const recoveredBatches: typeof batches = [];
  for (const batch of batches) {
    if (batch.status === 'generating' && batch.createdAt < now - 30_000) {
      const recovered = {
        ...batch,
        status: 'failed' as const,
        origin: 'deterministic_fallback' as const,
        fallbackReason: 'generation_interrupted',
        elapsedMs: Math.max(0, now - batch.createdAt),
        completedAt: now,
      };
      await ctx.db.patch(batch._id, {
        status: recovered.status,
        origin: recovered.origin,
        fallbackReason: recovered.fallbackReason,
        elapsedMs: recovered.elapsedMs,
        completedAt: recovered.completedAt,
      });
      recoveredBatches.push(recovered);
    } else {
      recoveredBatches.push(batch);
    }
  }
  const variationRowsByBatch = new Map<string, Doc<'nodeslide_variations'>[]>();
  for (const variation of variations) {
    const rows = variationRowsByBatch.get(variation.batchId) ?? [];
    rows.push(variation);
    variationRowsByBatch.set(variation.batchId, rows);
  }
  const plannedBatches = recoveredBatches.map((batch) => {
    const rows = variationRowsByBatch.get(batch.id) ?? [];
    return {
      ...batch,
      prunable:
        batch.status === 'failed' ||
        (rows.length > 0 && rows.every((variation) => variation.status !== 'ready')),
    };
  });
  const synthetic = Array.from({ length: reserveBatchSlots }, (_, index) => ({
    id: `__reserved_${index}`,
    status: 'generating' as const,
    createdAt: Number.MAX_SAFE_INTEGER - index,
  }));
  const plan = variationRetentionPlan([...plannedBatches, ...synthetic], decisions);
  if (plan.unprunableBatchCount > 0) {
    throw new NodeSlideVariationError(
      'generation_failed',
      'Too many variation generations are active for this deck.',
    );
  }
  for (const batchId of plan.batchIdsToDelete) {
    if (batchId.startsWith('__reserved_')) continue;
    await deleteVariationBatch(ctx, deckId, batchId);
  }
  for (const decisionId of plan.decisionIdsToDelete) {
    const row = await ctx.db
      .query('nodeslide_variation_decisions')
      .withIndex('by_stable_id', (index) => index.eq('id', decisionId))
      .first();
    if (row?.deckId === deckId) await ctx.db.delete(row._id);
  }
}

async function pruneDecisionTraces(ctx: MutationCtx, deckId: string): Promise<void> {
  const rows = await ctx.db
    .query('nodeslide_variation_decisions')
    .withIndex('by_deck_created', (index) => index.eq('deckId', deckId))
    .order('asc')
    .take(NODESLIDE_VARIATION_DECISION_LIMIT * 2 + 1);
  const excess = Math.max(0, rows.length - NODESLIDE_VARIATION_DECISION_LIMIT);
  for (const row of rows.slice(0, excess)) await ctx.db.delete(row._id);
}

async function deleteVariationBatch(
  ctx: MutationCtx,
  deckId: string,
  batchId: string,
): Promise<void> {
  const batch = await findBatchRow(ctx, batchId);
  if (!batch || batch.deckId !== deckId || batch.status === 'generating') return;
  const [variations, decisions] = await Promise.all([
    ctx.db
      .query('nodeslide_variations')
      .withIndex('by_batch', (index) => index.eq('batchId', batchId))
      .collect(),
    ctx.db
      .query('nodeslide_variation_decisions')
      .withIndex('by_batch', (index) => index.eq('batchId', batchId))
      .collect(),
  ]);
  for (const variation of variations) await ctx.db.delete(variation._id);
  for (const decision of decisions) await ctx.db.delete(decision._id);
  await ctx.db.delete(batch._id);
}

async function insertDecisionTrace(ctx: MutationCtx, trace: VariationDecisionTrace): Promise<void> {
  let candidate = trace;
  const existing = await ctx.db
    .query('nodeslide_variation_decisions')
    .withIndex('by_stable_id', (index) => index.eq('id', trace.id))
    .first();
  if (existing) {
    if (
      existing.deckId === trace.deckId &&
      existing.variationId === trace.variationId &&
      existing.eventName === trace.eventName
    ) {
      return;
    }
    candidate = {
      ...trace,
      id: nodeslideStableId('variation_decision_scoped', trace.deckId, trace.id),
    };
    const scopedExisting = await ctx.db
      .query('nodeslide_variation_decisions')
      .withIndex('by_stable_id', (index) => index.eq('id', candidate.id))
      .first();
    if (scopedExisting) {
      if (
        scopedExisting.deckId === trace.deckId &&
        scopedExisting.variationId === trace.variationId &&
        scopedExisting.eventName === trace.eventName
      ) {
        return;
      }
      throw new NodeSlideVariationError('generation_failed', 'Decision trace ID collision.');
    }
  }
  if (
    candidate.reason !== undefined &&
    (candidate.reason.length === 0 || candidate.reason.length > NODESLIDE_VARIATION_REASON_LIMIT)
  ) {
    throw new NodeSlideVariationError('generation_failed', 'Decision reason exceeds bounds.');
  }
  await ctx.db.insert('nodeslide_variation_decisions', candidate);
}

async function requireVariationRow(
  ctx: Pick<MutationCtx, 'db'>,
  deckId: string,
  variationId: string,
): Promise<Doc<'nodeslide_variations'>> {
  const row = await ctx.db
    .query('nodeslide_variations')
    .withIndex('by_stable_id', (index) => index.eq('id', variationId))
    .first();
  if (!row || row.deckId !== deckId) {
    throw new NodeSlideVariationError('invalid_request', 'Variation is unavailable.');
  }
  return row;
}

async function findBatchRow(
  ctx: Pick<MutationCtx, 'db'>,
  batchId: string,
): Promise<Doc<'nodeslide_variation_batches'> | null> {
  return await ctx.db
    .query('nodeslide_variation_batches')
    .withIndex('by_stable_id', (index) => index.eq('id', batchId))
    .first();
}

async function requireBatchRow(
  ctx: Pick<MutationCtx, 'db'>,
  deckId: string,
  batchId: string,
): Promise<Doc<'nodeslide_variation_batches'>> {
  const row = await findBatchRow(ctx, batchId);
  if (!row || row.deckId !== deckId) {
    throw new NodeSlideVariationError('invalid_request', 'Variation batch is unavailable.');
  }
  return row;
}

function variationFromRow(row: Doc<'nodeslide_variations'>): SlideVariation {
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
    ...(row.judge !== undefined ? { judge: row.judge } : {}),
    status: row.status,
    ...(row.selectedPatchId !== undefined ? { selectedPatchId: row.selectedPatchId } : {}),
    createdAt: row.createdAt,
    ...(row.decidedAt !== undefined ? { decidedAt: row.decidedAt } : {}),
  };
}

function batchFromRow(row: Doc<'nodeslide_variation_batches'>): VariationBatch {
  return {
    id: row.id,
    deckId: row.deckId,
    slideId: row.slideId,
    requestedCount: row.requestedCount,
    status: row.status,
    origin: row.origin,
    ...(row.fallbackReason !== undefined ? { fallbackReason: row.fallbackReason } : {}),
    variationIds: row.variationIds,
    elapsedMs: row.elapsedMs,
    createdAt: row.createdAt,
    ...(row.completedAt !== undefined ? { completedAt: row.completedAt } : {}),
  };
}

async function findLinkedVariationPatch(
  ctx: Pick<MutationCtx, 'db'>,
  variation: Doc<'nodeslide_variations'>,
): Promise<Doc<'nodeslide_patches'> | null> {
  const patchIds = [
    nodeslideStableId('patch_variation', variation.id),
    nodeslideStableId('patch_variation_scoped', variation.deckId, variation.id),
  ];
  for (const patchId of patchIds) {
    const patch = await findPatchRow(ctx, patchId);
    if (patch?.deckId === variation.deckId && patch.traceId === variation.id) return patch;
  }
  return null;
}

function variationAxisRank(variation: SlideVariation): number {
  if (variation.axes.contentAngle === 'data_led') return 0;
  if (variation.axes.contentAngle === 'narrative_led') return 1;
  return 2;
}

function safeGenerationFailure(error: unknown): string {
  if (error instanceof NodeSlideVariationError) return cleanDiagnostic(error.code);
  return cleanDiagnostic('generation_failed');
}

function publicVariationError(code: VariationFailureCode, message: string) {
  return new ConvexError({
    kind: 'nodeslide_variation' as const,
    code,
    message: message.replace(/^\[NODESLIDE_VARIATION_[A-Z_]+\]\s*/u, '').slice(0, 240),
  });
}

function variationRequestNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function runWithContentionRetry<T>(run: () => Promise<T>): Promise<T> {
  const attempts = 5;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ConvexError || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt));
    }
  }
  throw new Error('Variation mutation retry boundary exhausted.');
}

function rethrowPublicVariationError(error: unknown): never {
  if (error instanceof ConvexError) throw error;
  if (error instanceof NodeSlideVariationError) {
    throw publicVariationError(error.code, error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/owner access denied/i.test(message)) throw error;
  const match = message.match(/^\[NODESLIDE_VARIATION_([A-Z_]+)\]\s*(.+)$/u);
  if (match) {
    const code = match[1]?.toLowerCase();
    if (isVariationFailureCode(code)) {
      throw publicVariationError(code, match[2] ?? 'Variation request failed.');
    }
  }
  throw error;
}

function isVariationFailureCode(value: string | undefined): value is VariationFailureCode {
  return (
    value === 'invalid_request' ||
    value === 'source_bounds' ||
    value === 'generation_failed' ||
    value === 'quota_exceeded' ||
    value === 'selection_in_progress'
  );
}
