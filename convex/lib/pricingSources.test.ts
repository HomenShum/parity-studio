// @vitest-environment node
/**
 * Pricing-source inventory and agreement test (model-defaults SPEC A.0 rule 6, A.2.7 pre-PR).
 *
 * Every place this repo holds a per-million-token price is listed below with a `pricingAsOf` date, loaded, and
 * compared per (id, transport). SPEC rule: equal `{inPerM, outPerM}` per (id, transport). The one place the
 * sources legitimately differ is named in KNOWN_DIVERGENCE with both numbers pinned, so a change on either side
 * fails loudly instead of drifting.
 *
 * Sources (all USD per million tokens unless noted):
 *   1. pi-ai installed catalog          getModel(provider, id).cost                       pricingAsOf = pi-ai 1.1.0 install
 *   2. NODESLIDE_MODEL_PRICING          shared/nodeslideRunBudget.ts (micro-USD per M)    pricingAsOf = row.verifiedAt
 *   3. NODESLIDE_NEBIUS_GLM.cost        convex/lib/nodeslideProvider.ts (hand-built Model, not exported)  pricingAsOf = SOURCE_READ_AS_OF
 *   4. NATIVE_NEBIUS_METADATA.pricing   convex/lib/nodeslideRoutingPolicy.ts (not exported)               pricingAsOf = SOURCE_READ_AS_OF
 * Sources 3 and 4 are not exported and live in NodeSlide-domain files that this repo only mirrors (drift-only),
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
import { getModel } from '@earendil-works/pi-ai/compat';
import { describe, expect, it } from 'vitest';
import { NODESLIDE_MODEL_PRICING } from '../../shared/nodeslideRunBudget';

const CATALOG_PRICING_AS_OF = '2026-10-14'; // measured against the installed @earendil-works/pi-ai 1.1.0
const SOURCE_READ_AS_OF = '2026-10-14'; // sources 3 and 4 carry no date in their frozen files

/** A.0.6: every pricing source in the repo, each with a date. */
const PRICING_SOURCES = [
  { source: 'pi-ai catalog', pricingAsOf: CATALOG_PRICING_AS_OF },
  { source: 'NODESLIDE_MODEL_PRICING', pricingAsOf: '2026-07-16T01:22:40Z' }, // row.verifiedAt, asserted below
  { source: 'NODESLIDE_NEBIUS_GLM.cost', pricingAsOf: SOURCE_READ_AS_OF },
  { source: 'NATIVE_NEBIUS_METADATA.pricing', pricingAsOf: SOURCE_READ_AS_OF },
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
  it('lists all four pricing sources, each with a pricingAsOf date', () => {
    expect(PRICING_SOURCES).toHaveLength(4);
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

  it('(google/gemini-3.5-flash, openrouter): run-budget table equals the pi-ai catalog', () => {
    const { verifiedAt, ...runBudget } = budgetRate('google/gemini-3.5-flash');
    expect(verifiedAt).toBe('2026-07-16T23:55:00Z');
    expect(runBudget).toEqual(catalogRate('openrouter', 'google/gemini-3.5-flash'));
  });

  // KNOWN_DIVERGENCE. NODESLIDE_MODEL_PRICING['z-ai/glm-5.2'] is `openrouter_request_price_ceiling` (a cap sent to
  // OpenRouter as a max price), not a catalog price, and has never equalled the catalog. pi-ai 0.80.6 -> 1.1.0
  // moved the catalog side from 0.532 / 1.672 to 0.171 / 7.2, so the output ceiling (4.4) is now BELOW the catalog
  // output price (7.2). Both sides are NodeSlide-domain and frozen here; the pin makes the divergence visible and
  // is the hand-off to HomenShum/NodeSlide, which owns the ceiling.
  it('(z-ai/glm-5.2, openrouter): the request-price ceiling and the catalog price diverge, pinned on both sides', () => {
    const { verifiedAt, ...ceiling } = budgetRate('z-ai/glm-5.2');
    expect(verifiedAt).toBe('2026-07-16T20:30:00Z');
    expect(ceiling).toEqual({ inPerM: 1.4, outPerM: 4.4 });
    expect(catalogRate('openrouter', 'z-ai/glm-5.2')).toEqual({ inPerM: 0.171, outPerM: 7.2 });
    expect(CATALOG_PRICING_AS_OF).toBe('2026-10-14');
  });
});
