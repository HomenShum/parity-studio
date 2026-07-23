import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { earnedAtlasMaturity } from './nodeslideAtlas';
import {
  NODESLIDE_ATLAS_RECEIPT_PROJECTION,
  atlasHighestEarnedMaturity,
  atlasProjectedReceipts,
  atlasRecipeStandings,
} from './nodeslideAtlasReceipts';

/**
 * The scenario: someone asks "what has the Atlas actually proven?" and the answer has to come from
 * receipts rather than from a field somebody typed. Before this projection existed the maturity
 * ladder had never graded anything, so every one of these assertions was unanswerable.
 */

describe('the projection carries the real run, not a summary of it', () => {
  it('holds all 84 receipts from the 2026-07-22 arena run', () => {
    const { totals } = NODESLIDE_ATLAS_RECEIPT_PROJECTION;
    expect(totals.receipts).toBe(84);
    expect(totals.modelReceipts).toBe(72);
    expect(totals.baselineReceipts).toBe(12);
    expect(totals.modelReceipts + totals.baselineReceipts).toBe(totals.receipts);
  });

  it('grades every artifactType — an unmapped one would be silently ungraded', () => {
    expect(NODESLIDE_ATLAS_RECEIPT_PROJECTION.totals.unmappedArtifactTypes).toEqual([]);
  });

  it('binds itself to a source commit and a content hash', () => {
    const { meta } = NODESLIDE_ATLAS_RECEIPT_PROJECTION;
    expect(meta.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(meta.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(NODESLIDE_ATLAS_RECEIPT_PROJECTION.sourceRepository).toBe('nodeslide');
  });

  /**
   * The digest is only worth carrying if it can catch a hand-edit. This recomputes it the way the
   * emitter does — sorted keys, `meta` excluded entirely — so a receipt quietly flipped to passing
   * in this repo, without regenerating upstream, fails here rather than silently raising a
   * recipe's maturity.
   */
  it('the content digest still matches the data it claims to cover', () => {
    const stable = (value: unknown): string => {
      if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
      if (value && typeof value === 'object') {
        return `{${Object.keys(value as object)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
          .join(',')}}`;
      }
      return JSON.stringify(value ?? null);
    };
    const { meta, ...body } = NODESLIDE_ATLAS_RECEIPT_PROJECTION;
    const recomputed = `sha256:${createHash('sha256').update(stable(body)).digest('hex')}`;
    expect(recomputed).toBe(meta.sha256);
  });

  it('points at the commit that introduced the receipts, not at whatever HEAD was', () => {
    // A HEAD-derived commit makes the projection non-reproducible: it changes on every unrelated
    // commit, so `--check` fails as a drift gate and two copies disagree by timing alone.
    expect(NODESLIDE_ATLAS_RECEIPT_PROJECTION.meta.sourceCommit).toBe(
      'd53f1dca0df0a39ca9c2fbf8e4f9d145225e2bcd',
    );
  });

  it('ships no maturity field — the claim must not travel beside its own evidence', () => {
    for (const recipe of NODESLIDE_ATLAS_RECEIPT_PROJECTION.recipes) {
      expect(recipe, recipe.id).not.toHaveProperty('maturity');
    }
  });

  it('labels every receipt as model or deterministic-baseline', () => {
    for (const receipt of atlasProjectedReceipts()) {
      expect(['model', 'deterministic-baseline'], receipt.id).toContain(receipt.candidateKind);
    }
  });

  it('carries paid telemetry a deterministic path could not fake', () => {
    const models = atlasProjectedReceipts().filter((r) => r.candidateKind === 'model');
    const spend = models.reduce((total, r) => total + r.costUsd, 0);
    expect(spend).toBeGreaterThan(0);
    expect(models.every((r) => r.latencyMs > 0)).toBe(true);
    // Baselines are the mirror image: no model call, so no cost and no generation latency.
    const baselines = atlasProjectedReceipts().filter(
      (r) => r.candidateKind === 'deterministic-baseline',
    );
    expect(baselines.every((r) => r.costUsd === 0 && r.latencyMs === 0)).toBe(true);
  });
});

describe('what the receipts actually earn', () => {
  it('grades every recipe, and every grade is on the ladder', () => {
    const standings = atlasRecipeStandings();
    expect(standings).toHaveLength(12);
    for (const standing of standings) {
      expect(
        ['discovered', 'extracted', 'vetted', 'proven', 'certified'],
        standing.recipeId,
      ).toContain(standing.earned);
    }
  });

  it('reaches proven on model receipts, and stops there', () => {
    // `certified` needs a human blind review that has not happened. Nothing in this pipeline can
    // reach the top rung without a person, and the projection must not pretend otherwise.
    expect(atlasHighestEarnedMaturity()).toBe('proven');
    expect(atlasProjectedReceipts().every((r) => r.humanPreferred === null)).toBe(true);
  });

  it('never lets a recipe backed only by baselines exceed vetted', () => {
    for (const standing of atlasRecipeStandings()) {
      if (standing.modelReceiptCount > 0) continue;
      expect(standing.earned, standing.recipeId).toBe('vetted');
    }
  });

  it('drops to vetted when the model receipts are removed — the grade tracks the evidence', () => {
    const baselinesOnly = atlasProjectedReceipts().filter(
      (r) => r.candidateKind === 'deterministic-baseline',
    );
    for (const recipe of NODESLIDE_ATLAS_RECEIPT_PROJECTION.recipes) {
      const earned = earnedAtlasMaturity(
        { maturity: 'discovered', receiptIds: recipe.receiptIds },
        baselinesOnly,
      );
      expect(earned, recipe.id).toBe('vetted');
    }
  });

  it('explains each standing rather than only ranking it', () => {
    for (const standing of atlasRecipeStandings()) {
      expect(standing.reason.length, standing.recipeId).toBeGreaterThan(20);
      if (standing.modelReceiptCount === 0) {
        expect(standing.reason).toMatch(/replaying its own fixture/);
      }
    }
  });
});
