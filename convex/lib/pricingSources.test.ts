// @vitest-environment node
/**
 * Pricing-source inventory and agreement test (model-defaults SPEC A.0 rule 6, A.2.7 pre-PR).
 *
 * Every place this repo holds a per-million-token price is listed below with a `pricingAsOf` date, loaded, and
 * compared per (id, transport). SPEC rule: equal `{inPerM, outPerM}` per (id, transport), no exception. One pair
 * does not satisfy it (z-ai/glm-5.2 on openrouter: request-price ceiling vs catalog): its equality assertion is an
 * `it.fails` (known-unmet, open question for Homen) and both numbers are pinned so neither side drifts unnoticed;
 * see the block at the end of the file.
 *
 * Sources (all USD per million tokens unless noted):
 *   1. pi-ai installed catalog          getModel(provider, id).cost                       pricingAsOf = pi-ai 1.1.0 install
 *   2. NODESLIDE_MODEL_PRICING          shared/nodeslideRunBudget.ts (micro-USD per M)    pricingAsOf = row.verifiedAt
 *   3. NODESLIDE_NEBIUS_GLM.cost        convex/lib/nodeslideProvider.ts (hand-built Model, not exported)  pricingAsOf = SOURCE_READ_AS_OF
 *   4. NATIVE_NEBIUS_METADATA.pricing   convex/lib/nodeslideRoutingPolicy.ts (not exported)               pricingAsOf = SOURCE_READ_AS_OF
 *   5. GPT_IMAGE_2_PRICING_PER_MTOK     convex/generation.ts (not exported; text-in / image-in / image-out)  pricingAsOf = GPT_IMAGE_2_READ_AS_OF
 * Source 5 is the image-generation cost telemetry (frozen class, not edited by this PR) and carries no date of its
 * own; it is read from source text like 3 and 4. No other source prices gpt-image-2 (asserted below), so there is
 * nothing for it to disagree with. Sources 3 and 4 are not exported and live in NodeSlide-domain files that this repo only mirrors (drift-only),
 * and neither carries a date of its own; this repo may not edit them, so the date recorded for them is the day this
 * test read their values (SOURCE_READ_AS_OF). They are read from source text; the regex fails the test if the shape
 * moves.
 *
 * HAND-OFF to HomenShum/NodeSlide (the owner of sources 2-4, not touched by this PR): the z-ai/glm-5.2 request-price
 * ceiling (1.4 / 4.4) now sits BELOW the catalog output price (7.2) after the pi-ai 1.1.0 catalog move, and sources
 * 3 and 4 should carry their own pricingAsOf. Until NodeSlide fixes either, the divergence is pinned on both sides.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, getModels } from '@earendil-works/pi-ai/compat';
import { describe, expect, it } from 'vitest';
import { NODESLIDE_MODEL_PRICING } from '../../shared/nodeslideRunBudget';

const CATALOG_PRICING_AS_OF = '2026-10-14'; // measured against the installed @earendil-works/pi-ai 1.1.0
const SOURCE_READ_AS_OF = '2026-10-14'; // sources 3 and 4 carry no date in their frozen files
const GPT_IMAGE_2_READ_AS_OF = '2026-10-15'; // source 5 carries no date; the day this test first read its values

/** A.0.6: every pricing source in the repo, each with a date. */
const PRICING_SOURCES = [
  { source: 'pi-ai catalog', pricingAsOf: CATALOG_PRICING_AS_OF },
  { source: 'NODESLIDE_MODEL_PRICING', pricingAsOf: '2026-07-16T01:22:40Z' }, // row.verifiedAt, asserted below
  { source: 'NODESLIDE_NEBIUS_GLM.cost', pricingAsOf: SOURCE_READ_AS_OF },
  { source: 'NATIVE_NEBIUS_METADATA.pricing', pricingAsOf: SOURCE_READ_AS_OF },
  { source: 'GPT_IMAGE_2_PRICING_PER_MTOK', pricingAsOf: GPT_IMAGE_2_READ_AS_OF },
];

interface Rate {
  inPerM: number;
  outPerM: number;
}

function sourceText(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

function handTypedRate(file: string, anchor: string, key: 'cost' | 'pricing'): Rate {
  const text = sourceText(file);
  const from = text.indexOf(anchor);
  expect(from, `${anchor} not found in ${file}`).toBeGreaterThanOrEqual(0);
  const m = new RegExp(`${key}:\\s*\\{\\s*input:\\s*([0-9.]+),\\s*output:\\s*([0-9.]+)`).exec(
    text.slice(from),
  );
  expect(m, `${key} literal not found after ${anchor} in ${file}`).not.toBeNull();
  return { inPerM: Number(m?.[1]), outPerM: Number(m?.[2]) };
}

function catalogRate(provider: string, id: string): Rate {
  // biome-ignore lint/suspicious/noExplicitAny: pi-ai getModel is typed against its compile-time registry
  const model = (getModel as any)(provider, id);
  expect(model, `${provider}/${id} missing from the pi-ai catalog`).toBeDefined();
  return { inPerM: model.cost.input, outPerM: model.cost.output };
}

function budgetRate(id: keyof typeof NODESLIDE_MODEL_PRICING): Rate & { verifiedAt: string } {
  const row = NODESLIDE_MODEL_PRICING[id];
  if (row.kind !== 'priced') throw new Error(`${id} is not a priced row`);
  return {
    inPerM: row.inputMicroUsdPerMillionTokens / 1_000_000,
    outPerM: row.outputMicroUsdPerMillionTokens / 1_000_000,
    verifiedAt: row.verifiedAt,
  };
}

describe('pricing sources agree per (id, transport)', () => {
  it('lists all five pricing sources, each with a pricingAsOf date', () => {
    expect(PRICING_SOURCES).toHaveLength(5);
    for (const { source, pricingAsOf } of PRICING_SOURCES) {
      expect(pricingAsOf, source).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });

  it('(zai-org/GLM-5.2, nebius): provider Model, routing policy mirror and run-budget table are equal', () => {
    const providerModel = handTypedRate(
      './nodeslideProvider.ts',
      'const NODESLIDE_NEBIUS_GLM',
      'cost',
    );
    const routingMirror = handTypedRate(
      './nodeslideRoutingPolicy.ts',
      'const NATIVE_NEBIUS_METADATA',
      'pricing',
    );
    const { verifiedAt, ...runBudget } = budgetRate('nebius/zai-org/GLM-5.2');
    expect(verifiedAt).toBe('2026-07-16T01:22:40Z'); // pricingAsOf for source 2
    expect(providerModel).toEqual({ inPerM: 1.4, outPerM: 4.4 });
    expect(routingMirror).toEqual(providerModel);
    expect(runBudget).toEqual(providerModel);
  });

  it('(gpt-image-2, openai): the image-generation telemetry rates are pinned, and no other source prices it', () => {
    const text = sourceText('../generation.ts');
    const from = text.indexOf('const GPT_IMAGE_2_PRICING_PER_MTOK');
    expect(
      from,
      'GPT_IMAGE_2_PRICING_PER_MTOK not found in convex/generation.ts',
    ).toBeGreaterThanOrEqual(0);
    const m =
      /textInput:\s*([0-9.]+),[^\n]*\n\s*imageInput:\s*([0-9.]+),[^\n]*\n\s*imageOutput:\s*([0-9.]+)/.exec(
        text.slice(from),
      );
    expect(m, 'rate literals not found after GPT_IMAGE_2_PRICING_PER_MTOK').not.toBeNull();
    expect({
      textInput: Number(m?.[1]),
      imageInput: Number(m?.[2]),
      imageOutput: Number(m?.[3]),
    }).toEqual({
      textInput: 5,
      imageInput: 10,
      imageOutput: 40,
    });
    // If pi-ai ever catalogs gpt-image-2, the agreement rule applies and this must become a comparison.
    for (const provider of ['openai', 'openrouter'] as const) {
      const ids: string[] = getModels(provider as never).map((x: { id: string }) => x.id);
      expect(
        ids.filter((id) => /gpt-image-2/.test(id)),
        provider,
      ).toEqual([]);
    }
  });

  it('(google/gemini-3.5-flash, openrouter): run-budget table equals the pi-ai catalog', () => {
    const { verifiedAt, ...runBudget } = budgetRate('google/gemini-3.5-flash');
    expect(verifiedAt).toBe('2026-07-16T23:55:00Z');
    expect(runBudget).toEqual(catalogRate('openrouter', 'google/gemini-3.5-flash'));
  });

  // A.0.6 asks for equal {inPerM, outPerM} per (id, transport) and allows no exception. For (z-ai/glm-5.2,
  // openrouter) the sources are NOT equal: NODESLIDE_MODEL_PRICING is `openrouter_request_price_ceiling` (a cap sent
  // to OpenRouter as a max price), and pi-ai 0.80.6 -> 1.1.0 moved the catalog side from 0.532 / 1.672 to 0.171 / 7.2,
  // so the output ceiling (4.4) is now BELOW the catalog output price (7.2). Both sides are NodeSlide-domain and
  // frozen here, and raising the ceiling is NodeSlide's decision (it changes what a request may cost), so this PR
  // cannot make them equal. The rule is therefore asserted as written and marked `it.fails`: the suite is green only
  // because the requirement is known-unmet. It turns RED the moment the two sources agree (remove `.fails` then), and
  // the pinned numbers below keep either side from drifting unnoticed. OPEN: needs a Homen exception to A.0.6 or a
  // fix in HomenShum/NodeSlide; this is not an agreement.
  it.fails(
    '(z-ai/glm-5.2, openrouter): REQUIRED A.0.6 agreement - request-price ceiling equals catalog price',
    () => {
      const { verifiedAt: _verifiedAt, ...ceiling } = budgetRate('z-ai/glm-5.2');
      expect(ceiling).toEqual(catalogRate('openrouter', 'z-ai/glm-5.2'));
    },
  );

  it('(z-ai/glm-5.2, openrouter): KNOWN DIVERGENCE, not agreement - both sides pinned so neither drifts unnoticed', () => {
    const { verifiedAt, ...ceiling } = budgetRate('z-ai/glm-5.2');
    expect(verifiedAt).toBe('2026-07-16T20:30:00Z');
    expect(ceiling).toEqual({ inPerM: 1.4, outPerM: 4.4 });
    expect(catalogRate('openrouter', 'z-ai/glm-5.2')).toEqual({ inPerM: 0.171, outPerM: 7.2 });
    expect(CATALOG_PRICING_AS_OF).toBe('2026-10-14');
  });
});
