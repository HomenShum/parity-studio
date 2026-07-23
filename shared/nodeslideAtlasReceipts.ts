import projection from './generated/nodeslide-atlas-receipts.json';
import {
  type AtlasMaturity,
  type AtlasShowcaseReceipt,
  atlasMaturityRank,
  earnedAtlasMaturity,
} from './nodeslideAtlas';

/**
 * Consumer of the Atlas showcase-receipt projection emitted by the live nodeslide repo.
 *
 * Until this existed, `earnedAtlasMaturity` had never scored a real receipt. The registry carried
 * archetypes and source policies but zero recipes and zero receipts, so the maturity ladder was a
 * contract with nothing to grade — and the gap was never a missing arena run. 84 receipts from the
 * 2026-07-22 run were already committed in nodeslide; nothing had ever projected them here.
 *
 * Same nodeslide -> parity flow as [nodeslideArenaContracts]: nodeslide owns the data, parity reads
 * a generated file rather than minting a second schema. Regenerate on the nodeslide side with
 * `node scripts/emit-atlas-receipts.mjs`; the sha256 in `meta` binds it to its source commit.
 *
 * The projection deliberately ships NO maturity field. Maturity is derived here, from the receipts,
 * so a claim can still be contradicted by its own evidence — which is the only reason to have a
 * ladder at all.
 */

export interface AtlasProjectedRecipe {
  schemaVersion: string;
  id: string;
  artifactType: string;
  archetypeId: string;
  narrativeJob: string;
  receiptIds: readonly string[];
  modelReceiptCount: number;
  baselineReceiptCount: number;
}

export const NODESLIDE_ATLAS_RECEIPT_PROJECTION = projection as unknown as {
  schemaVersion: string;
  sourceRepository: 'nodeslide';
  runId: string;
  totals: {
    receipts: number;
    recipes: number;
    modelReceipts: number;
    baselineReceipts: number;
    unmappedArtifactTypes: readonly string[];
  };
  recipes: readonly AtlasProjectedRecipe[];
  receipts: readonly (AtlasShowcaseReceipt & { status: string })[];
  meta: { sourceFile: string; sourceCommit: string | null; sha256: string };
};

export const atlasProjectedRecipes = (): readonly AtlasProjectedRecipe[] =>
  NODESLIDE_ATLAS_RECEIPT_PROJECTION.recipes;

export const atlasProjectedReceipts = (): readonly AtlasShowcaseReceipt[] =>
  NODESLIDE_ATLAS_RECEIPT_PROJECTION.receipts;

export interface AtlasRecipeStanding {
  recipeId: string;
  archetypeId: string;
  earned: AtlasMaturity;
  receiptCount: number;
  modelReceiptCount: number;
  baselineReceiptCount: number;
  /** Why the recipe stopped where it did — the sentence a reader needs, not just the rung. */
  reason: string;
}

/**
 * Grade every projected recipe against the receipts it owns.
 *
 * Nothing here chooses a maturity; `earnedAtlasMaturity` does, and it caps a recipe with only
 * deterministic-baseline receipts at `vetted` no matter how clean those receipts are.
 */
export function atlasRecipeStandings(): readonly AtlasRecipeStanding[] {
  const receipts = atlasProjectedReceipts();
  return atlasProjectedRecipes().map((recipe) => {
    const earned = earnedAtlasMaturity(
      { maturity: 'discovered', receiptIds: recipe.receiptIds },
      receipts,
    );
    const owned = receipts.filter((receipt) => recipe.receiptIds.includes(receipt.id));
    const reason =
      earned === 'certified'
        ? 'A model receipt passed every gate and a human preferred it.'
        : earned === 'proven'
          ? `${recipe.modelReceiptCount} model receipts passed every gate; no human blind review has run, so certified is unreachable.`
          : earned === 'vetted'
            ? recipe.modelReceiptCount === 0
              ? 'Only deterministic-baseline receipts exist — the compiler replaying its own fixture proves the recipe is well formed, not that a model can hit the bar.'
              : 'Receipts exist but no model receipt passed every gate.'
            : 'No receipts own this recipe.';
    return {
      recipeId: recipe.id,
      archetypeId: recipe.archetypeId,
      earned,
      receiptCount: owned.length,
      modelReceiptCount: recipe.modelReceiptCount,
      baselineReceiptCount: recipe.baselineReceiptCount,
      reason,
    };
  });
}

/** Highest rung any projected recipe has actually earned. */
export function atlasHighestEarnedMaturity(): AtlasMaturity {
  return atlasRecipeStandings().reduce<AtlasMaturity>(
    (best, standing) =>
      atlasMaturityRank(standing.earned) > atlasMaturityRank(best) ? standing.earned : best,
    'discovered',
  );
}
