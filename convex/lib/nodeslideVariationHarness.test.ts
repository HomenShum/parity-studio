import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DeckSnapshot, PatchOperation, SlideElement } from '../../shared/nodeslide';
import { applyDeckPatch } from '../../shared/nodeslidePatch';
import { planSignatureApplication } from '../../shared/nodeslideSignatureApply';
import type { SlideVariation } from '../../shared/nodeslideVariation';
import { financeIbcsTastePack } from '../../src/domains/nodeslide/signature/packs/index';
import { evaluateNodeSlideCas, validateNodeSlidePatch } from './nodeslidePatches';
import { buildGoldenNodeSlide } from './nodeslideSeed';
import { validateNodeSlideSnapshot } from './nodeslideValidation';
import {
  NODESLIDE_DEFAULT_VARIATION_AXES,
  NODESLIDE_VARIATION_BATCH_LIMIT,
  NODESLIDE_VARIATION_DECISION_LIMIT,
  NODESLIDE_VARIATION_RECORD_LIMIT,
  boundVariationListByBytes,
  boundedVariationListLimit,
  buildSlideVariations,
  buildVariationProviderPrompt,
  deterministicVariationOperations,
  parseProviderVariationSet,
  planVariationAcceptance,
  planVariationGeneration,
  planVariationRejection,
  variationIntroducesTextOverflow,
  variationIntroducesUnsupportedFactualAdditions,
  variationMaterializedFingerprint,
  variationOperationFingerprint,
  variationPreviewQuotaBuckets,
  variationRetentionPlan,
} from './nodeslideVariationHarness';

describe('NodeSlide variation generation', () => {
  it('strictly parses, materializes, and validates exactly three free-route candidates', () => {
    const snapshot = isolatedGoldenSlide();
    const target = unlockedElement(snapshot);
    const before = structuredClone(snapshot);
    const result = buildSlideVariations({
      snapshot,
      slideId: target.slideId,
      batchId: 'batch-happy',
      createdAt: 1_000,
      provider: { ok: true, value: providerEnvelope(target) },
    });

    expect(result.variations).toHaveLength(3);
    expect(result.origin).toBe('free_route');
    expect(result.variations.every((variation) => variation.origin === 'free_route')).toBe(true);
    expect(result.variations.every((variation) => variation.validation.ok)).toBe(true);
    expect(
      new Set(
        result.variations.map((variation) => variationOperationFingerprint(variation.operations)),
      ).size,
    ).toBe(3);
    expect(planVariationGeneration(result.variations)).toEqual(
      result.variations.map((variation) =>
        expect.objectContaining({
          eventName: 'variation_generated',
          variationId: variation.id,
          deckVersion: variation.baseDeckVersion,
          traceId: variation.id,
        }),
      ),
    );
    expect(snapshot).toEqual(before);
  });

  it('rejects garbage, partial envelopes, and extra keys with honest deterministic fallback', () => {
    const snapshot = isolatedGoldenSlide();
    const slideId = snapshot.slides[0]?.id ?? '';
    const invalidValues = [
      'not-json',
      { variants: [] },
      { variants: [], rawResponse: 'must not be accepted' },
    ];

    for (const [index, value] of invalidValues.entries()) {
      expect(parseProviderVariationSet(value).ok).toBe(false);
      const result = buildSlideVariations({
        snapshot,
        slideId,
        batchId: `batch-garbage-${index}`,
        createdAt: 2_000 + index,
        provider: { ok: true, value },
      });
      expect(result.origin).toBe('deterministic_fallback');
      expect(result.variations).toHaveLength(3);
      expect(
        result.variations.every((variation) => variation.origin === 'deterministic_fallback'),
      ).toBe(true);
      expect(result.variations.every((variation) => variation.validation.ok)).toBe(true);
      expect(result.fallbackReason).toBeTruthy();
    }
  });

  it('honors an active signature in prompts, provider validation, and deterministic fallbacks', () => {
    const source = isolatedGoldenSlide();
    const signaturePlan = planSignatureApplication(source, financeIbcsTastePack);
    expect(signaturePlan.ok).toBe(true);
    if (!signaturePlan.ok) return;
    const applied = applyDeckPatch(source, {
      baseDeckVersion: signaturePlan.plan.baseDeckVersion,
      operations: signaturePlan.plan.operations,
      scope: signaturePlan.plan.scope,
    }).snapshot;
    const snapshot: DeckSnapshot = {
      ...applied,
      deck: {
        ...applied.deck,
        activeSignatureProfileId: financeIbcsTastePack.id,
        activeSignatureProfileDigest: financeIbcsTastePack.source.digest,
      },
    };
    const target = unlockedElement(snapshot);
    const baselineValidation = validateNodeSlideSnapshot(snapshot, 1_400, undefined, {
      signatureProfile: financeIbcsTastePack,
    });
    expect(
      baselineValidation.publishOk,
      JSON.stringify(baselineValidation.issues.map((issue) => [issue.code, issue.elementId])),
    ).toBe(true);
    for (const axes of NODESLIDE_DEFAULT_VARIATION_AXES) {
      const fallback = deterministicVariationOperations(
        snapshot,
        target.slideId,
        axes,
        financeIbcsTastePack,
      );
      const scope = {
        kind: 'slide' as const,
        deckId: snapshot.deck.id,
        slideIds: [target.slideId],
        operationMode: 'unrestricted' as const,
      };
      const patchErrors = validateNodeSlidePatch(snapshot, {
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        baseSlideVersions: { [target.slideId]: snapshot.slides[0]?.version ?? 0 },
        baseElementVersions: Object.fromEntries(
          snapshot.elements.map((element) => [element.id, element.version]),
        ),
        scope,
        operations: fallback.operations,
      });
      expect(patchErrors).toEqual([]);
      const candidate = applyDeckPatch(snapshot, {
        baseDeckVersion: snapshot.deck.version,
        scope,
        operations: fallback.operations,
      }).snapshot;
      expect(
        variationIntroducesTextOverflow(snapshot, candidate, fallback.operations),
        JSON.stringify({ axes, operations: fallback.operations }),
      ).toBe(false);
      const candidateValidation = validateNodeSlideSnapshot(candidate, 1_450, undefined, {
        signatureProfile: financeIbcsTastePack,
      });
      expect(
        candidateValidation.publishOk,
        JSON.stringify({
          axes,
          operations: fallback.operations,
          issues: candidateValidation.issues,
        }),
      ).toBe(true);
    }
    const prompt = JSON.parse(
      buildVariationProviderPrompt(snapshot, target.slideId, financeIbcsTastePack).userText,
    ) as { activeSignature?: { allowedColors?: string[] } };
    expect(prompt.activeSignature?.allowedColors).toContain('#005EA8');

    const result = buildSlideVariations({
      snapshot,
      slideId: target.slideId,
      batchId: 'batch-on-brand',
      createdAt: 1_500,
      signatureProfile: financeIbcsTastePack,
      provider: {
        ok: true,
        value: {
          variants: NODESLIDE_DEFAULT_VARIATION_AXES.map((axes, index) => ({
            axes,
            operations: [
              {
                op: 'update_style',
                slideId: target.slideId,
                elementId: target.id,
                properties: { color: '#FF00FF', opacity: 0.91 + index * 0.01 },
              },
            ],
          })),
        },
      },
    });

    expect(result.origin).toBe('deterministic_fallback');
    expect(result.variations).toHaveLength(3);
    expect(result.variations.every((variation) => variation.validation.publishOk)).toBe(true);
    expect(
      result.variations.every((variation) =>
        variation.validation.issues.every(
          (issue) => !issue.code.startsWith('on_brand_') || issue.severity === 'info',
        ),
      ),
    ).toBe(true);
    expect(
      result.variations.every(
        (variation) =>
          !variation.operations.some(
            (operation) =>
              operation.op === 'update_style' &&
              Object.values(operation.properties).includes('#FF00FF'),
          ),
      ),
    ).toBe(true);
  });

  it('replaces extra-ID, locked, and cross-slide provider operations before preview', () => {
    const snapshot = isolatedGoldenSlide();
    const target = unlockedElement(snapshot);
    const locked = snapshot.elements.find((element) => element.locked);
    const values = providerEnvelope(target);
    values.variants[0] = {
      axes: NODESLIDE_DEFAULT_VARIATION_AXES[0],
      operations: [
        {
          op: 'update_style',
          slideId: target.slideId,
          elementId: 'extra-provider-id',
          properties: { opacity: 0.5 },
        },
      ],
    };
    values.variants[1] = {
      axes: NODESLIDE_DEFAULT_VARIATION_AXES[1],
      operations: [
        {
          op: 'update_style',
          slideId: target.slideId,
          elementId: locked?.id ?? 'locked-id',
          properties: { opacity: 0.5 },
        },
      ],
    };
    values.variants[2] = {
      axes: NODESLIDE_DEFAULT_VARIATION_AXES[2],
      operations: [
        {
          op: 'update_style',
          slideId: 'another-slide',
          elementId: target.id,
          properties: { opacity: 0.5 },
        },
      ],
    };

    const result = buildSlideVariations({
      snapshot,
      slideId: target.slideId,
      batchId: 'batch-invalid-targets',
      createdAt: 3_000,
      provider: { ok: true, value: values },
    });

    expect(
      result.variations.every((variation) => variation.origin === 'deterministic_fallback'),
    ).toBe(true);
    expect(
      result.variations
        .flatMap((variation) => variation.operations)
        .every((operation) => {
          if (!('slideId' in operation)) return false;
          if (operation.op === 'update_slide') return operation.slideId === target.slideId;
          return (
            operation.slideId === target.slideId &&
            'elementId' in operation &&
            snapshot.elements.some(
              (element) => element.id === operation.elementId && !element.locked,
            )
          );
        }),
    ).toBe(true);
  });

  it('repairs overflowing provider geometry once and never displays an error-invalid candidate', () => {
    const snapshot = isolatedGoldenSlide();
    const target = unlockedElement(snapshot);
    const value = providerEnvelope(target);
    value.variants[0] = {
      axes: NODESLIDE_DEFAULT_VARIATION_AXES[0],
      operations: [
        {
          op: 'move',
          slideId: target.slideId,
          elementId: target.id,
          x: 2,
          y: -1,
        },
      ],
    };
    const result = buildSlideVariations({
      snapshot,
      slideId: target.slideId,
      batchId: 'batch-repair',
      createdAt: 4_000,
      provider: { ok: true, value },
    });
    const repaired = result.variations[0];

    expect(repaired?.origin).toBe('free_route');
    expect(repaired?.validation.ok).toBe(true);
    expect(repaired?.validation.issues.some((issue) => issue.severity === 'error')).toBe(false);
    const moved = repaired?.operations[0];
    expect(moved?.op).toBe('move');
    if (moved?.op === 'move') {
      expect(moved.x).toBeGreaterThanOrEqual(0);
      expect(moved.y).toBeGreaterThanOrEqual(0);
      expect(moved.x + target.bbox.width).toBeLessThanOrEqual(1);
      expect(moved.y + target.bbox.height).toBeLessThanOrEqual(1);
    }

    const textTarget = unlockedTextElement(snapshot);
    const textOverflow = providerEnvelope(textTarget);
    textOverflow.variants[0] = {
      axes: NODESLIDE_DEFAULT_VARIATION_AXES[0],
      operations: [
        {
          op: 'replace_text',
          slideId: textTarget.slideId,
          elementId: textTarget.id,
          text: 'unbounded '.repeat(400),
        },
      ],
    };
    const replaced = buildSlideVariations({
      snapshot,
      slideId: textTarget.slideId,
      batchId: 'batch-text-overflow',
      createdAt: 4_100,
      provider: { ok: true, value: textOverflow },
    });
    expect(replaced.variations[0]?.origin).toBe('deterministic_fallback');
    expect(replaced.variations[0]?.validation.ok).toBe(true);
  });

  it('replaces duplicate provider fingerprints and reports timeout/down fallback honestly', () => {
    const snapshot = isolatedGoldenSlide();
    const target = unlockedElement(snapshot);
    const duplicate = providerEnvelope(target);
    for (const variant of duplicate.variants) {
      variant.operations = [styleOperation(target, 0.77)];
    }
    const deduplicated = buildSlideVariations({
      snapshot,
      slideId: target.slideId,
      batchId: 'batch-duplicates',
      createdAt: 5_000,
      provider: { ok: true, value: duplicate },
    });
    expect(
      new Set(
        deduplicated.variations.map((variation) =>
          variationOperationFingerprint(variation.operations),
        ),
      ).size,
    ).toBe(3);
    expect(
      deduplicated.variations.some((variation) => variation.origin === 'deterministic_fallback'),
    ).toBe(true);

    const crossAxisDuplicate = providerEnvelope(target);
    crossAxisDuplicate.variants[0] = {
      axes: NODESLIDE_DEFAULT_VARIATION_AXES[0],
      operations: deterministicVariationOperations(
        snapshot,
        target.slideId,
        NODESLIDE_DEFAULT_VARIATION_AXES[1] as (typeof NODESLIDE_DEFAULT_VARIATION_AXES)[number],
      ).operations,
    };
    crossAxisDuplicate.variants[1] = {
      axes: NODESLIDE_DEFAULT_VARIATION_AXES[1],
      operations: [
        {
          op: 'update_style',
          slideId: target.slideId,
          elementId: 'invalid-duplicate-replacement',
          properties: { opacity: 0.5 },
        },
      ],
    };
    const crossAxisResult = buildSlideVariations({
      snapshot,
      slideId: target.slideId,
      batchId: 'batch-cross-axis-duplicate',
      createdAt: 5_050,
      provider: { ok: true, value: crossAxisDuplicate },
    });
    expect(
      new Set(
        crossAxisResult.variations.map((variation) =>
          variationOperationFingerprint(variation.operations),
        ),
      ).size,
    ).toBe(3);

    for (const reason of ['provider_timeout', 'provider_unavailable']) {
      const fallback = buildSlideVariations({
        snapshot,
        slideId: target.slideId,
        batchId: `batch-${reason}`,
        createdAt: 5_100,
        provider: { ok: false, reason },
      });
      expect(fallback.origin).toBe('deterministic_fallback');
      expect(fallback.variations.every((variation) => variation.origin === fallback.origin)).toBe(
        true,
      );
      expect(fallback.fallbackReason).toContain(reason);
    }
  });

  it('replaces semantically duplicate materialized candidates even when operation arrays differ', () => {
    const snapshot = isolatedGoldenSlide();
    const target = unlockedElement(snapshot);
    const duplicate = providerEnvelope(target);
    duplicate.variants[0] = {
      axes: NODESLIDE_DEFAULT_VARIATION_AXES[0],
      operations: [styleOperation(target, 0.77)],
    };
    duplicate.variants[1] = {
      axes: NODESLIDE_DEFAULT_VARIATION_AXES[1],
      operations: [styleOperation(target, 0.66), styleOperation(target, 0.77)],
    };
    const result = buildSlideVariations({
      snapshot,
      slideId: target.slideId,
      batchId: 'batch-materialized-duplicates',
      createdAt: 5_250,
      provider: { ok: true, value: duplicate },
    });

    expect(result.variations[0]?.origin).toBe('free_route');
    expect(result.variations[1]?.origin).toBe('deterministic_fallback');
    expect(result.variations[1]?.fallbackReason).toContain('duplicate_provider_variant');
    expect(
      new Set(
        result.variations.map((variation) => variationMaterializedFingerprint(variation.candidate)),
      ).size,
    ).toBe(3);
  });

  it('rejects provider copy that adds unsupported words or factual tokens', () => {
    const snapshot = isolatedGoldenSlide();
    const target = unlockedTextElement(snapshot);
    const unsupported: PatchOperation[] = [
      {
        op: 'replace_text',
        slideId: target.slideId,
        elementId: target.id,
        text: 'Guaranteed market leader with 900% growth in 2035.',
      },
    ];
    expect(
      variationIntroducesUnsupportedFactualAdditions(snapshot, target.slideId, unsupported),
    ).toBe(true);
    expect(
      variationIntroducesUnsupportedFactualAdditions(snapshot, target.slideId, [
        {
          op: 'replace_text',
          slideId: target.slideId,
          elementId: target.id,
          text: target.content ?? '',
        },
      ]),
    ).toBe(false);
    const value = providerEnvelope(target);
    value.variants[0] = {
      axes: NODESLIDE_DEFAULT_VARIATION_AXES[0],
      operations: unsupported,
    };
    const result = buildSlideVariations({
      snapshot,
      slideId: target.slideId,
      batchId: 'batch-unsupported-facts',
      createdAt: 5_300,
      provider: { ok: true, value },
    });

    expect(result.variations[0]?.origin).toBe('deterministic_fallback');
    expect(result.variations[0]?.fallbackReason).toContain('unsupported_factual_addition');
    expect(JSON.stringify(result.variations[0]?.candidate)).not.toContain('900%');
    expect(JSON.stringify(result.variations[0]?.candidate)).not.toContain('2035');
  });

  it('builds a bounded prompt containing only the target slide and unlocked IDs', () => {
    const snapshot = isolatedGoldenSlide();
    const unsafeImageUrl = 'https://private.example.invalid/variation-image.png';
    const unsafeStyleUrl = 'https://private.example.invalid/variation-fill.svg';
    const unsafeBackgroundUrl = 'https://private.example.invalid/variation-background.png';
    const firstElement = unlockedElement(snapshot);
    const firstSlide = snapshot.slides[0];
    if (!firstElement || !firstSlide) throw new Error('Fixture needs a slide element.');
    firstElement.imageUrl = unsafeImageUrl;
    firstElement.style.fill = `url(${unsafeStyleUrl})`;
    firstSlide.background = `url(${unsafeBackgroundUrl})`;
    const prompt = buildVariationProviderPrompt(snapshot, snapshot.slides[0]?.id ?? '');
    const payload = JSON.parse(prompt.userText) as {
      slide: { id: string };
      allowedElementIds: string[];
      elements: Array<{ id: string }>;
    };
    expect(prompt.userText.length).toBeLessThanOrEqual(96_000);
    expect(payload.slide.id).toBe(snapshot.slides[0]?.id);
    expect(payload.elements.map((element) => element.id)).toEqual(payload.allowedElementIds);
    expect(
      payload.allowedElementIds.every(
        (id) => snapshot.elements.find((element) => element.id === id)?.locked === false,
      ),
    ).toBe(true);
    expect(prompt.userText).not.toContain('imageUrl');
    expect(prompt.userText).not.toContain(unsafeImageUrl);
    expect(prompt.userText).not.toContain(unsafeStyleUrl);
    expect(prompt.userText).not.toContain(unsafeBackgroundUrl);
  });

  it('uses bounded style-only fallbacks and records insufficient source structure', () => {
    const snapshot = isolatedGoldenSlide();
    const target = unlockedTextElement(snapshot);
    const slide = snapshot.slides[0];
    if (!slide) throw new Error('Fixture needs a slide.');
    const sparse: DeckSnapshot = {
      ...structuredClone(snapshot),
      slides: [{ ...structuredClone(slide), elementOrder: [target.id] }],
      elements: [structuredClone(target)],
      sources: snapshot.sources.filter((source) => target.sourceIds.includes(source.id)),
    };
    const result = buildSlideVariations({
      snapshot: sparse,
      slideId: target.slideId,
      batchId: 'batch-sparse-source',
      createdAt: 5_500,
      provider: { ok: false, reason: 'provider_unavailable' },
    });

    expect(result.variations).toHaveLength(3);
    expect(result.variations.every((variation) => variation.validation.ok)).toBe(true);
    expect(
      result.variations.some((variation) =>
        variation.fallbackReason?.includes('insufficient_source_structure'),
      ),
    ).toBe(true);
    expect(
      result.variations
        .flatMap((variation) => variation.operations)
        .every((operation) =>
          ['replace_text', 'update_style', 'move', 'resize', 'update_slide'].includes(operation.op),
        ),
    ).toBe(true);
  });

  it('keeps fallback IDs, axes, operations, and fingerprints deterministic', () => {
    const snapshot = isolatedGoldenSlide();
    const slideId = snapshot.slides[0]?.id ?? '';
    const args = {
      snapshot,
      slideId,
      batchId: 'batch-deterministic',
      createdAt: 5_700,
      provider: { ok: false as const, reason: 'provider_unavailable' },
    };
    const first = buildSlideVariations(args);
    const second = buildSlideVariations(args);

    expect(
      first.variations.map((variation) => ({
        id: variation.id,
        axes: variation.axes,
        operations: variation.operations,
        fingerprint: variationOperationFingerprint(variation.operations),
      })),
    ).toEqual(
      second.variations.map((variation) => ({
        id: variation.id,
        axes: variation.axes,
        operations: variation.operations,
        fingerprint: variationOperationFingerprint(variation.operations),
      })),
    );
  });
});

describe('NodeSlide variation decisions and bounds', () => {
  it('uses bounded owner and global buckets for parallel preview quota consumption', () => {
    const ownerAccessKey = 'owner-capability-must-not-appear-in-a-rate-limit-key';
    const buckets = variationPreviewQuotaBuckets(ownerAccessKey);

    expect(buckets).toEqual([
      expect.objectContaining({ limit: 60, windowMs: 86_400_000 }),
      expect.objectContaining({ key: 'variation:global', limit: 500, windowMs: 3_600_000 }),
    ]);
    expect(buckets[0]?.key).not.toContain(ownerAccessKey);
    expect(buckets.every((bucket) => bucket.limit > 0 && bucket.windowMs >= 60_000)).toBe(true);
    expect(boundedVariationListLimit(undefined)).toBe(30);
    expect(boundedVariationListLimit(250)).toBe(100);
    expect(() => boundedVariationListLimit(0)).toThrow('positive integer');
  });

  it('keeps list responses byte-bounded without splitting a three-variation batch', () => {
    const newest = fallbackVariations('list-newest');
    const older = fallbackVariations('list-older');
    const newestBytes = new TextEncoder().encode(JSON.stringify(newest)).byteLength;
    const bounded = boundVariationListByBytes([...newest, ...older], 6, newestBytes + 16);

    expect(bounded).toHaveLength(3);
    expect(new Set(bounded.map((variation) => variation.batchId))).toEqual(
      new Set([newest[0]?.batchId]),
    );
    expect(() => boundVariationListByBytes(newest, 3, 1)).toThrow('bounded list response');
  });

  it('supports all-rejected and idempotent rejection without creating a patch decision', () => {
    let variations = fallbackVariations('all-rejected');
    const traceIds = new Set<string>();
    for (const variation of variations) {
      const decision = planVariationRejection(variation, 'not this direction', 6_000);
      expect(decision.update?.status).toBe('rejected');
      expect(decision.trace?.eventName).toBe('variation_rejected');
      if (decision.trace) traceIds.add(decision.trace.id);
      variations = variations.map((candidate) =>
        candidate.id === variation.id
          ? { ...candidate, status: 'rejected', decidedAt: 6_000 }
          : candidate,
      );
    }

    expect(variations.every((variation) => variation.status === 'rejected')).toBe(true);
    expect(variations.every((variation) => variation.selectedPatchId === undefined)).toBe(true);
    expect(traceIds.size).toBe(3);
    expect(planVariationRejection(variations[0] as SlideVariation, undefined, 6_001)).toEqual({
      update: null,
      trace: null,
    });
  });

  it('accepts exactly one, rejects ready siblings, and is idempotent', () => {
    const variations = fallbackVariations('accept-one');
    const selected = variations[1] as SlideVariation;
    const decision = planVariationAcceptance(variations, selected.id, 'patch-selected', 7_000);

    expect(decision.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: selected.id,
          status: 'accepted',
          selectedPatchId: 'patch-selected',
        }),
      ]),
    );
    expect(decision.updates.filter((update) => update.status === 'rejected')).toHaveLength(2);
    expect(decision.traces.map((trace) => trace.eventName).sort()).toEqual([
      'variation_rejected',
      'variation_rejected',
      'variation_selected',
    ]);
    expect(decision.traces.every((trace) => trace.axes && trace.origin)).toBe(true);
    const decided = variations.map((variation) => {
      const update = decision.updates.find((candidate) => candidate.id === variation.id);
      return update ? { ...variation, ...update } : variation;
    });
    expect(planVariationAcceptance(decided, selected.id, 'patch-selected', 7_001)).toEqual({
      updates: [],
      traces: [],
    });
  });

  it('rebases an unrelated later slide edit and blocks an overlapping slide edit', () => {
    const full = buildGoldenNodeSlide('variation-concurrency', 8_000).snapshot;
    const firstSlide = full.slides[0];
    const secondSlide = full.slides[1];
    if (!firstSlide || !secondSlide) throw new Error('Golden deck needs two slides.');
    const isolated = isolateSlide(full, firstSlide.id);
    const variation = buildSlideVariations({
      snapshot: isolated,
      slideId: firstSlide.id,
      batchId: 'batch-concurrency',
      createdAt: 8_000,
      provider: { ok: false, reason: 'provider_unavailable' },
    }).variations[0] as SlideVariation;
    const otherTarget = full.elements.find(
      (element) => element.slideId === secondSlide.id && !element.locked,
    );
    const overlapTarget = full.elements.find(
      (element) => element.slideId === firstSlide.id && !element.locked,
    );
    if (!otherTarget || !overlapTarget) throw new Error('Golden deck needs unlocked targets.');

    const afterOtherSlide = applyDeckPatch(full, {
      baseDeckVersion: full.deck.version,
      scope: {
        kind: 'slide',
        deckId: full.deck.id,
        slideIds: [secondSlide.id],
        operationMode: 'unrestricted',
      },
      operations: [styleOperation(otherTarget, 0.81)],
    }).snapshot;
    expect(evaluateNodeSlideCas(afterOtherSlide, patchInput(variation))).toMatchObject({
      canCommit: true,
      rebased: true,
    });

    const afterOverlap = applyDeckPatch(full, {
      baseDeckVersion: full.deck.version,
      scope: {
        kind: 'slide',
        deckId: full.deck.id,
        slideIds: [firstSlide.id],
        operationMode: 'unrestricted',
      },
      operations: [styleOperation(overlapTarget, 0.82)],
    }).snapshot;
    expect(evaluateNodeSlideCas(afterOverlap, patchInput(variation))).toMatchObject({
      canCommit: false,
      rebased: false,
    });
  });

  it('keeps 50 sustained generate/decide rounds within all persistence caps', () => {
    let batches: Array<{
      id: string;
      status: 'ready';
      createdAt: number;
      prunable: boolean;
    }> = [];
    let variants: Array<{ id: string; batchId: string }> = [];
    let decisions: Array<{ id: string; createdAt: number }> = [];

    for (let round = 0; round < 50; round += 1) {
      const batchId = `batch-${round}`;
      batches.push({ id: batchId, status: 'ready', createdAt: round, prunable: true });
      variants.push(
        ...Array.from({ length: 3 }, (_, index) => ({ id: `${batchId}-v${index}`, batchId })),
      );
      decisions.push(
        ...Array.from({ length: 6 }, (_, index) => ({
          id: `${batchId}-d${index}`,
          createdAt: round * 6 + index,
        })),
      );
      const plan = variationRetentionPlan(batches, decisions);
      const deletedBatches = new Set(plan.batchIdsToDelete);
      const deletedDecisions = new Set(plan.decisionIdsToDelete);
      batches = batches.filter((batch) => !deletedBatches.has(batch.id));
      variants = variants.filter((variant) => !deletedBatches.has(variant.batchId));
      decisions = decisions.filter((decision) => !deletedDecisions.has(decision.id));
      expect(batches.length).toBeLessThanOrEqual(NODESLIDE_VARIATION_BATCH_LIMIT);
      expect(variants.length).toBeLessThanOrEqual(NODESLIDE_VARIATION_RECORD_LIMIT);
      expect(decisions.length).toBeLessThanOrEqual(NODESLIDE_VARIATION_DECISION_LIMIT);
    }

    expect(batches).toHaveLength(50);
    expect(variants).toHaveLength(150);
    expect(decisions).toHaveLength(100);
  });
});

describe('NodeSlide variation proof safety', () => {
  const proofScript = path.resolve(process.cwd(), 'scripts', 'nodeslide-variation-proof.mjs');

  it('requires disposable confirmation before any live proof work', () => {
    const result = spawnSync(process.execPath, [proofScript], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('Re-run with --disposable');
  });

  it('refuses existing deck IDs even with disposable confirmation', () => {
    const result = spawnSync(
      process.execPath,
      [proofScript, '--disposable', '--deck', 'existing-user-deck'],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('refuses existing deck IDs');
  });
});

function isolatedGoldenSlide(): DeckSnapshot {
  const full = buildGoldenNodeSlide('variation-tests', 1_000).snapshot;
  const slide = full.slides.find((candidate) =>
    full.elements.some((element) => element.slideId === candidate.id && !element.locked),
  );
  if (!slide) throw new Error('Golden deck needs an unlocked slide.');
  return isolateSlide(full, slide.id);
}

function isolateSlide(snapshot: DeckSnapshot, slideId: string): DeckSnapshot {
  const slide = snapshot.slides.find((candidate) => candidate.id === slideId);
  if (!slide) throw new Error(`Missing slide ${slideId}.`);
  const elements = snapshot.elements.filter((element) => element.slideId === slideId);
  const sourceIds = new Set(
    elements.flatMap((element) => [
      ...element.sourceIds,
      ...(element.chart?.sourceId ? [element.chart.sourceId] : []),
    ]),
  );
  return {
    deck: { ...structuredClone(snapshot.deck), slideOrder: [slideId] },
    slides: [structuredClone(slide)],
    elements: structuredClone(elements),
    sources: structuredClone(snapshot.sources.filter((source) => sourceIds.has(source.id))),
  };
}

function unlockedElement(snapshot: DeckSnapshot): SlideElement {
  const target = snapshot.elements.find((element) => !element.locked);
  if (!target) throw new Error('Fixture needs an unlocked element.');
  return target;
}

function unlockedTextElement(snapshot: DeckSnapshot): SlideElement {
  const target = snapshot.elements.find((element) => element.kind === 'text' && !element.locked);
  if (!target) throw new Error('Fixture needs an unlocked text element.');
  return target;
}

function providerEnvelope(target: SlideElement): {
  variants: Array<{
    axes: (typeof NODESLIDE_DEFAULT_VARIATION_AXES)[number];
    operations: PatchOperation[];
  }>;
} {
  return {
    variants: NODESLIDE_DEFAULT_VARIATION_AXES.map((axes, index) => ({
      axes,
      operations: [styleOperation(target, 0.91 + index * 0.01)],
    })),
  };
}

function styleOperation(target: SlideElement, opacity: number): PatchOperation {
  return {
    op: 'update_style',
    slideId: target.slideId,
    elementId: target.id,
    properties: { opacity },
  };
}

function fallbackVariations(discriminator: string): SlideVariation[] {
  const snapshot = isolatedGoldenSlide();
  const slideId = snapshot.slides[0]?.id ?? '';
  return buildSlideVariations({
    snapshot,
    slideId,
    batchId: `batch-${discriminator}`,
    createdAt: 6_000,
    provider: { ok: false, reason: 'provider_unavailable' },
  }).variations;
}

function patchInput(variation: SlideVariation) {
  return {
    deckId: variation.deckId,
    baseDeckVersion: variation.baseDeckVersion,
    baseSlideVersions: { [variation.slideId]: variation.baseSlideVersion },
    baseElementVersions: variation.baseElementVersions,
    scope: {
      kind: 'slide' as const,
      deckId: variation.deckId,
      slideIds: [variation.slideId],
      operationMode: 'unrestricted' as const,
    },
    operations: variation.operations,
  };
}
