import { v } from 'convex/values';
import type { DeckSnapshot } from '../shared/nodeslide';
import { query } from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';
import { deckFromRow, elementFromRow, slideFromRow, sourceFromRow } from './lib/nodeslideData';
import {
  NODESLIDE_VARIATION_BATCH_LIMIT,
  NODESLIDE_VARIATION_CANDIDATE_BYTE_LIMIT,
  NODESLIDE_VARIATION_DECISION_LIMIT,
  NODESLIDE_VARIATION_ELEMENT_LIMIT,
  NODESLIDE_VARIATION_LIST_BYTE_LIMIT,
  NODESLIDE_VARIATION_RECORD_LIMIT,
  buildSlideVariations,
  variationMaterializedFingerprint,
  variationOperationFingerprint,
} from './lib/nodeslideVariationHarness';

/** Owner-gated bounded counts used only by the W3 dogfood receipt writer. */
export const getState = query({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const [batches, variations, decisions] = await Promise.all([
      ctx.db
        .query('nodeslide_variation_batches')
        .withIndex('by_deck_created', (index) => index.eq('deckId', args.deckId))
        .take(NODESLIDE_VARIATION_BATCH_LIMIT + 1),
      ctx.db
        .query('nodeslide_variations')
        .withIndex('by_deck_created', (index) => index.eq('deckId', args.deckId))
        .take(NODESLIDE_VARIATION_RECORD_LIMIT + 1),
      ctx.db
        .query('nodeslide_variation_decisions')
        .withIndex('by_deck_created', (index) => index.eq('deckId', args.deckId))
        .take(NODESLIDE_VARIATION_DECISION_LIMIT + 1),
    ]);
    const counts = {
      batches: batches.length,
      variants: variations.length,
      decisionTraces: decisions.length,
    };
    const eventCounts = {
      variationGenerated: decisions.filter(
        (decision) => decision.eventName === 'variation_generated',
      ).length,
      variationSelected: decisions.filter((decision) => decision.eventName === 'variation_selected')
        .length,
      variationRejected: decisions.filter((decision) => decision.eventName === 'variation_rejected')
        .length,
    };
    const variationsByBatch = new Map<string, typeof variations>();
    for (const variation of variations) {
      const rows = variationsByBatch.get(variation.batchId) ?? [];
      rows.push(variation);
      variationsByBatch.set(variation.batchId, rows);
    }
    const completeBatches = [...variationsByBatch.values()].filter((rows) => rows.length === 3);
    const maxCandidateBytes = Math.max(
      0,
      ...variations.map((variation) => serializedByteLength(variation.candidate)),
    );
    const decisionKeys = decisions.map(
      (decision) => `${decision.variationId}:${decision.eventName}`,
    );
    const acceptedBatchConsistency = completeBatches.every((rows) => {
      const accepted = rows.filter((variation) => variation.status === 'accepted');
      if (accepted.length === 0) return true;
      return (
        accepted.length === 1 &&
        Boolean(accepted[0]?.selectedPatchId) &&
        rows.every((variation) => variation.status !== 'ready')
      );
    });
    return {
      counts,
      eventCounts,
      withinBounds:
        counts.batches <= NODESLIDE_VARIATION_BATCH_LIMIT &&
        counts.variants <= NODESLIDE_VARIATION_RECORD_LIMIT &&
        counts.decisionTraces <= NODESLIDE_VARIATION_DECISION_LIMIT &&
        maxCandidateBytes <= NODESLIDE_VARIATION_CANDIDATE_BYTE_LIMIT,
      bounds: {
        batchLimit: NODESLIDE_VARIATION_BATCH_LIMIT,
        variantLimit: NODESLIDE_VARIATION_RECORD_LIMIT,
        decisionLimit: NODESLIDE_VARIATION_DECISION_LIMIT,
        candidateByteLimit: NODESLIDE_VARIATION_CANDIDATE_BYTE_LIMIT,
        listByteLimit: NODESLIDE_VARIATION_LIST_BYTE_LIMIT,
        maxCandidateBytes,
      },
      rawProviderFieldsPresent: [...batches, ...variations, ...decisions].some((row) =>
        containsRawProviderField(row),
      ),
      duplicateDecisionKeys: decisionKeys.length - new Set(decisionKeys).size,
      completeBatchDiversity: completeBatches.every(
        (rows) =>
          new Set(rows.map((variation) => variationOperationFingerprint(variation.operations)))
            .size === 3 &&
          new Set(rows.map((variation) => variationMaterializedFingerprint(variation.candidate)))
            .size === 3,
      ),
      acceptedBatchConsistency,
      activeGeneratingBatches: batches.filter((batch) => batch.status === 'generating').length,
      activeAcceptanceReservations: batches.filter((batch) => batch.acceptingVariationId).length,
      readyVariants: variations.filter((variation) => variation.status === 'ready').length,
      acceptedVariants: variations.filter((variation) => variation.status === 'accepted').length,
      rejectedVariants: variations.filter((variation) => variation.status === 'rejected').length,
      staleVariants: variations.filter((variation) => variation.status === 'stale').length,
    };
  },
});

/** Read-only deterministic fallback proof on one owner-gated bounded slide. */
export const getDeterministicAudit = query({
  args: { deckId: v.string(), ownerAccessKey: v.string(), slideId: v.string() },
  handler: async (ctx, args) => {
    const deckRow = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const slideRow = await ctx.db
      .query('nodeslide_slides')
      .withIndex('by_deck_id', (index) => index.eq('deckId', args.deckId).eq('id', args.slideId))
      .first();
    if (!slideRow) throw new Error('Variation proof slide is unavailable.');
    const elementRows = await ctx.db
      .query('nodeslide_elements')
      .withIndex('by_slide', (index) => index.eq('slideId', args.slideId))
      .filter((filter) => filter.eq(filter.field('deckId'), args.deckId))
      .take(NODESLIDE_VARIATION_ELEMENT_LIMIT + 1);
    if (elementRows.length === 0 || elementRows.length > NODESLIDE_VARIATION_ELEMENT_LIMIT) {
      throw new Error('Variation proof slide exceeds bounded size.');
    }
    const elements = elementRows.map(elementFromRow);
    const sourceIds = [
      ...new Set(
        elements.flatMap((element) => [
          ...element.sourceIds,
          ...(element.chart?.sourceId ? [element.chart.sourceId] : []),
        ]),
      ),
    ].slice(0, NODESLIDE_VARIATION_ELEMENT_LIMIT);
    const sourceRows = await Promise.all(
      sourceIds.map((sourceId) =>
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
        row?.deckId === args.deckId ? [sourceFromRow(row)] : [],
      ),
    };
    const buildArgs = {
      snapshot,
      slideId: args.slideId,
      batchId: 'w3-deterministic-audit',
      createdAt: 1,
      provider: { ok: false as const, reason: 'proof_forced_fallback' },
    };
    const first = buildSlideVariations(buildArgs);
    const second = buildSlideVariations(buildArgs);
    const receipt = (variations: typeof first.variations) =>
      variations.map((variation) => ({
        id: variation.id,
        axes: variation.axes,
        operationFingerprint: variationOperationFingerprint(variation.operations),
        candidateFingerprint: variationMaterializedFingerprint(variation.candidate),
        validationOk: variation.validation.ok,
      }));
    const firstReceipt = receipt(first.variations);
    const secondReceipt = receipt(second.variations);
    return {
      deterministic: JSON.stringify(firstReceipt) === JSON.stringify(secondReceipt),
      first: firstReceipt,
      second: secondReceipt,
    };
  },
});

function containsRawProviderField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRawProviderField);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, nested]) =>
      /(?:raw.*(?:response|payload|text|json)|provider.*(?:response|payload|text|json))/i.test(
        key.replaceAll('_', ''),
      ) || containsRawProviderField(nested),
  );
}

function serializedByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
