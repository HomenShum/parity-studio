import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_ARENA_CONTRACTS,
  arenaSchemaIds,
  crossAxisComparisonRepresentable,
} from './nodeslideArenaContracts';
import {
  ATLAS_ARTIFACT_KINDS,
  ATLAS_ARTIFACT_PORTABILITY,
  ATLAS_CAPABILITY_LEVELS,
  ATLAS_USAGE_INTENTS,
  type AtlasArtifactRecipe,
  type AtlasShowcaseReceipt,
  type AtlasSourcePolicy,
  NODESLIDE_ATLAS_RECEIPT_VERSION,
  NODESLIDE_ATLAS_SCHEMA_VERSION,
  earnedAtlasMaturity,
  evaluateAtlasUsage,
  rendererScopedCapability,
  resolveRequirementVerdict,
} from './nodeslideAtlas';
import {
  MAX_ATLAS_QUERY_RESULTS,
  NODESLIDE_ATLAS_ARCHETYPES,
  NODESLIDE_ATLAS_SOURCE_POLICIES,
  findAtlasSourcePolicy,
  searchAtlasArchetypes,
} from './nodeslideAtlasRegistry';
import {
  atlasTopologyViolations,
  validateAtlasArtifactRecipe,
  validateAtlasMaturityClaim,
  validateAtlasShowcaseReceipt,
  validateAtlasSourcePolicy,
} from './nodeslideAtlasValidation';

const DIGEST = `sha256:${'a'.repeat(64)}`;

function architectureRecipe(overrides: Partial<AtlasArtifactRecipe> = {}): AtlasArtifactRecipe {
  return {
    schemaVersion: NODESLIDE_ATLAS_SCHEMA_VERSION,
    id: 'systems.architecture-flow',
    version: '4.0.0',
    archetypeId: 'systems.architecture',
    artifactKinds: ['diagram'],
    title: 'Architecture flow',
    description: 'Editable nodes and connectors with one highlighted trust boundary.',
    narrativeJobs: ['explain technical architecture'],
    sourceId: 'nodeslide-owned',
    reuseMode: 'copy',
    contentHash: DIGEST,
    inputContract: [
      {
        key: 'nodes',
        kind: 'node',
        required: true,
        description: 'Services',
        minimum: 2,
        maximum: 7,
      },
      { key: 'edges', kind: 'edge', required: true, description: 'Relationships' },
    ],
    capability: { web: 'native', pptx: 'editable' },
    density: 'balanced',
    requiredTokens: ['color-structural', 'font-family-interface'],
    positivePatterns: ['one-dominant-reading-direction', 'isolated-trust-boundary'],
    forbiddenPatterns: ['prose-as-architecture', 'ascii-arrows', 'logo-collage'],
    evidenceRequirements: ['one source citation'],
    maturity: 'extracted',
    receiptIds: [],
    knownLimitations: ['Loses connector routing when more than seven nodes are supplied.'],
    ...overrides,
  };
}

function receipt(overrides: Partial<AtlasShowcaseReceipt> = {}): AtlasShowcaseReceipt {
  return {
    schemaVersion: NODESLIDE_ATLAS_RECEIPT_VERSION,
    id: 'receipt-1',
    recipeId: 'systems.architecture-flow',
    recipeVersion: '4.0.0',
    archetypeId: 'systems.architecture',
    model: { id: 'kimi-k3', role: 'executor' },
    candidateKind: 'model',
    harnessVersion: 'harness/v5',
    sourceIds: ['nodeslide-owned'],
    referenceIds: [],
    editability: { web: 'native', pptx: 'editable' },
    evaluation: {
      briefAdherence: true,
      visualPassed: true,
      evidencePassed: true,
      exportPassed: true,
      repairCount: 1,
    },
    outputs: {
      browserRenderRef: 'runs/arena/1/browser.png',
      pptxRenderRef: 'runs/arena/1/pptx.png',
      pptxFileRef: 'runs/arena/1/deck.pptx',
    },
    costUsd: 0.42,
    latencyMs: 18_000,
    humanPreferred: null,
    producedAt: 1_784_000_000_000,
    ...overrides,
  };
}

describe('Atlas registry: an agent looking for the right archetype', () => {
  it('routes an architecture request to archetypes that require a real diagram', () => {
    const results = searchAtlasArchetypes({ text: 'architecture' });
    expect(results.length).toBeGreaterThan(0);
    const architecture = results.find((entry) => entry.id === 'systems.architecture');
    expect(architecture?.requiredArtifactKinds).toContain('diagram');
    expect(architecture?.forbiddenSubstitutes).toContain('prose-as-architecture');
  });

  it('returns the same ordering for the same query so two agent runs agree', () => {
    const first = searchAtlasArchetypes({ text: 'evidence', limit: 10 }).map((entry) => entry.id);
    const second = searchAtlasArchetypes({ text: 'evidence', limit: 10 }).map((entry) => entry.id);
    expect(second).toEqual(first);
  });

  it('honours the result cap rather than returning an unbounded page', () => {
    expect(searchAtlasArchetypes({ limit: 3 })).toHaveLength(3);
    expect(searchAtlasArchetypes({ limit: 10_000 }).length).toBeLessThanOrEqual(
      MAX_ATLAS_QUERY_RESULTS,
    );
  });

  it('returns the whole taxonomy on an unfiltered browse, so the cap hides nothing', () => {
    expect(MAX_ATLAS_QUERY_RESULTS).toBeGreaterThanOrEqual(NODESLIDE_ATLAS_ARCHETYPES.length);
    expect(searchAtlasArchetypes({ limit: MAX_ATLAS_QUERY_RESULTS })).toHaveLength(
      NODESLIDE_ATLAS_ARCHETYPES.length,
    );
  });

  it('keeps every archetype id unique and every required kind non-empty', () => {
    const ids = NODESLIDE_ATLAS_ARCHETYPES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const archetype of NODESLIDE_ATLAS_ARCHETYPES) {
      expect(archetype.requiredArtifactKinds.length).toBeGreaterThan(0);
      expect(archetype.narrativeJob.length).toBeGreaterThan(0);
    }
  });
});

describe('Generated MCP projection stays in step with its owner', () => {
  it('matches shared/nodeslideAtlasRegistry.ts exactly', async () => {
    // The MCP package cannot import shared/, so it reads a generated projection. If this drifts,
    // agents get a different Atlas from the app — run `pnpm atlas:export`.
    const generated = (await import('../mcp/src/generated/atlas.json')).default as {
      archetypes: { id: string }[];
      sourcePolicies: { id: string }[];
    };
    expect(generated.archetypes.map((entry) => entry.id)).toEqual(
      NODESLIDE_ATLAS_ARCHETYPES.map((entry) => entry.id),
    );
    expect(generated.sourcePolicies.map((entry) => entry.id)).toEqual(
      NODESLIDE_ATLAS_SOURCE_POLICIES.map((entry) => entry.id),
    );
  });
});

describe('Requirement verdict: representation is not a verdict', () => {
  const flattenedChart = {
    requiredArtifactKind: 'chart',
    observedRepresentation: 'vector-flattened' as const,
  };

  it('passes only on a semantic object', () => {
    for (const observedRepresentation of ['native-semantic', 'structured-semantic'] as const) {
      expect(
        resolveRequirementVerdict({ requiredArtifactKind: 'chart', observedRepresentation })
          .verdict,
      ).toBe('pass');
    }
  });

  it('calls an undeclared flattening a violation, not a softer status', () => {
    const decision = resolveRequirementVerdict(flattenedChart);
    expect(decision.verdict).toBe('violation');
    expect(decision.reason).toMatch(/no semantic chart object exists and no fallback was declared/);
  });

  it('accepts a flattening the recipe declared in advance, without calling it a pass', () => {
    const decision = resolveRequirementVerdict({
      ...flattenedChart,
      declaredFallback: {
        capability: 'vector-flattened',
        behavior: 'Render the chart as editable PowerPoint vector geometry.',
      },
    });
    expect(decision.verdict).toBe('fallback-accepted');
    expect(decision.verdict).not.toBe('pass');
    expect(decision.reason).toMatch(/native chart requirement did not pass/);
  });

  it('does not let a fallback declared at another rung excuse this degradation', () => {
    const decision = resolveRequirementVerdict({
      ...flattenedChart,
      declaredFallback: { capability: 'poster-frame', behavior: 'Export a still.' },
    });
    expect(decision.verdict).toBe('violation');
  });

  it('separates nothing-there from flattened', () => {
    expect(
      resolveRequirementVerdict({
        requiredArtifactKind: 'chart',
        observedRepresentation: 'absent',
      }).reason,
    ).toMatch(/No chart of any representation/);
  });

  it('never converts an unobservable slide into a verdict', () => {
    expect(
      resolveRequirementVerdict({
        requiredArtifactKind: 'equation',
        observedRepresentation: 'indeterminate',
      }).verdict,
    ).toBe('indeterminate');
  });

  it('ranks vector-flattened below editable and above rendered-image', () => {
    const ladder = ATLAS_CAPABILITY_LEVELS;
    expect(ladder.indexOf('vector-flattened')).toBeGreaterThan(ladder.indexOf('editable'));
    expect(ladder.indexOf('vector-flattened')).toBeLessThan(ladder.indexOf('rendered-image'));
  });
});

describe('Portable JS gates agree with the TypeScript gates', () => {
  it('returns identical verdicts across the representation and fallback matrix', async () => {
    const portable = await import('../scripts/lib/atlas-gates.mjs');
    const representations = [
      'native-semantic',
      'structured-semantic',
      'vector-flattened',
      'raster-render',
      'poster-frame',
      'absent',
      'indeterminate',
    ] as const;
    const fallbacks = [
      null,
      { capability: 'vector-flattened' as const, behavior: 'Vector geometry.' },
      { capability: 'poster-frame' as const, behavior: 'A still.' },
    ];
    for (const observedRepresentation of representations) {
      for (const declaredFallback of fallbacks) {
        const input = {
          requiredArtifactKind: 'chart',
          observedRepresentation,
          declaredFallback,
        };
        expect(portable.resolveRequirementVerdict(input)).toEqual(resolveRequirementVerdict(input));
      }
    }
  });

  it('returns identical topology verdicts for every archetype', async () => {
    const atlas = (await import('../mcp/src/generated/atlas.json')).default;
    const { createAtlasGates } = await import('../scripts/lib/atlas-gates.mjs');
    const gates = createAtlasGates(atlas);

    // Exercise satisfied, unsatisfied, empty and forbidden-substitute paths on every archetype.
    for (const archetype of NODESLIDE_ATLAS_ARCHETYPES) {
      const cases = [
        { producedArtifactKinds: [...archetype.requiredArtifactKinds] },
        { producedArtifactKinds: ['text'] },
        { producedArtifactKinds: [] },
        {
          producedArtifactKinds: [...archetype.requiredArtifactKinds],
          detectedSubstitutes: [...archetype.forbiddenSubstitutes],
        },
      ];
      for (const testCase of cases) {
        const candidate = { archetypeId: archetype.id, ...testCase };
        expect(gates.topologyViolations(candidate)).toEqual(atlasTopologyViolations(candidate));
      }
    }
  });

  it('returns identical licence verdicts for every source and intent', async () => {
    const atlas = (await import('../mcp/src/generated/atlas.json')).default;
    const { createAtlasGates } = await import('../scripts/lib/atlas-gates.mjs');
    const gates = createAtlasGates(atlas);

    for (const policy of NODESLIDE_ATLAS_SOURCE_POLICIES) {
      for (const intent of ATLAS_USAGE_INTENTS) {
        expect(gates.evaluateUsage(policy.id, [intent])).toEqual(
          evaluateAtlasUsage(policy, [intent]),
        );
      }
    }
    expect(gates.evaluateUsage('not-registered', ['download'])).toEqual(
      evaluateAtlasUsage(undefined, ['download']),
    );
  });

  it('agrees that an unknown archetype cannot be judged', async () => {
    const atlas = (await import('../mcp/src/generated/atlas.json')).default;
    const { createAtlasGates } = await import('../scripts/lib/atlas-gates.mjs');
    const gates = createAtlasGates(atlas);
    const candidate = { archetypeId: 'made.up', producedArtifactKinds: ['diagram'] };
    expect(gates.topologyViolations(candidate)).toEqual(atlasTopologyViolations(candidate));
  });

  it('refuses to build gates from a malformed projection', async () => {
    const { createAtlasGates } = await import('../scripts/lib/atlas-gates.mjs');
    expect(() => createAtlasGates(null)).toThrow(TypeError);
    expect(() => createAtlasGates({ archetypes: [] })).toThrow(TypeError);
  });

  it('resolves a foreign vocabulary and reports unmapped types as null', async () => {
    const { resolveArchetypeId } = await import('../scripts/lib/atlas-gates.mjs');
    const mapping = { 'architecture-diagram': 'systems.architecture' };
    expect(resolveArchetypeId('architecture-diagram', mapping)).toBe('systems.architecture');
    expect(resolveArchetypeId('Architecture Diagram', mapping)).toBe('systems.architecture');
    expect(resolveArchetypeId('something-new', mapping)).toBeNull();
    expect(resolveArchetypeId('', mapping)).toBeNull();
  });
});

describe('Licence gate: the ingestion worker deciding what it may do with a source', () => {
  it('lets the gallery show a Mobbin reference but refuses to cache or index it', () => {
    const mobbin = findAtlasSourcePolicy('mobbin');
    expect(evaluateAtlasUsage(mobbin, ['display-thumbnail']).allowed).toBe(true);
    const cache = evaluateAtlasUsage(mobbin, ['cache']);
    expect(cache.allowed).toBe(false);
    expect(cache.reasons.join(' ')).toMatch(/impossible under access mode remote-mcp/);
    expect(evaluateAtlasUsage(mobbin, ['rag-index']).allowed).toBe(false);
  });

  it('allows the open mirror lane to be redistributed but still refuses model training', () => {
    const uiverse = findAtlasSourcePolicy('uiverse');
    expect(
      evaluateAtlasUsage(uiverse, ['download', 'cache', 'redistribute-modified']).allowed,
    ).toBe(true);
    expect(evaluateAtlasUsage(uiverse, ['model-training']).allowed).toBe(false);
    expect(evaluateAtlasUsage(uiverse, ['display-thumbnail']).attributionRequired).toBe(true);
  });

  it('indexes private imports for the owning workspace but never redistributes them', () => {
    const privatePolicy = findAtlasSourcePolicy('workspace-private');
    expect(evaluateAtlasUsage(privatePolicy, ['rag-index']).allowed).toBe(true);
    expect(evaluateAtlasUsage(privatePolicy, ['redistribute-original']).allowed).toBe(false);
  });

  it('denies a restricted commercial library every intent including display', () => {
    const restricted = findAtlasSourcePolicy('commercial-template-library');
    for (const intent of ['display-thumbnail', 'download', 'rag-index'] as const) {
      expect(evaluateAtlasUsage(restricted, [intent]).allowed).toBe(false);
    }
  });

  it('fails closed on an unregistered source and on an empty intent list', () => {
    const missing = evaluateAtlasUsage(undefined, ['display-thumbnail']);
    expect(missing.allowed).toBe(false);
    expect(missing.reasons).not.toHaveLength(0);
    expect(missing.attributionRequired).toBe(true);

    const noIntent = evaluateAtlasUsage(findAtlasSourcePolicy('uiverse'), []);
    expect(noIntent.allowed).toBe(false);
  });

  it('denies the whole request when one intent in a batch is not granted', () => {
    const uiverse = findAtlasSourcePolicy('uiverse');
    const mixed = evaluateAtlasUsage(uiverse, ['display-thumbnail', 'fine-tuning']);
    expect(mixed.allowed).toBe(false);
    expect(mixed.reasons.join(' ')).toMatch(/fine-tuning is not granted/);
  });

  it('never reports a denial without a reason across every seeded policy and intent', () => {
    const intents = [
      'download',
      'cache',
      'display-thumbnail',
      'redistribute-original',
      'redistribute-modified',
      'commercial-output',
      'rag-index',
      'embedding-index',
      'model-training',
      'fine-tuning',
    ] as const;
    for (const id of [
      'nodeslide-owned',
      'uiverse',
      'mobbin',
      'workspace-private',
      'commercial-template-library',
    ]) {
      for (const intent of intents) {
        const decision = evaluateAtlasUsage(findAtlasSourcePolicy(id), [intent]);
        if (!decision.allowed) expect(decision.reasons.length).toBeGreaterThan(0);
        else expect(decision.reasons).toHaveLength(0);
      }
    }
  });
});

describe('Source policy validation: adversarial policies submitted for review', () => {
  it('accepts every seeded policy', () => {
    for (const id of [
      'nodeslide-owned',
      'uiverse',
      'mobbin',
      'workspace-private',
      'commercial-template-library',
    ]) {
      const result = validateAtlasSourcePolicy(findAtlasSourcePolicy(id));
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  it('rejects a remote-mcp policy that grants itself training rights', () => {
    const forged = {
      ...(findAtlasSourcePolicy('mobbin') as AtlasSourcePolicy),
      permissions: {
        ...(findAtlasSourcePolicy('mobbin') as AtlasSourcePolicy).permissions,
        modelTraining: true,
        cache: true,
      },
    };
    const result = validateAtlasSourcePolicy(forged);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/exceeds what access mode remote-mcp allows/);
  });

  it('rejects a blocked source that still grants a permission', () => {
    const contradictory = {
      ...(findAtlasSourcePolicy('uiverse') as AtlasSourcePolicy),
      status: 'blocked' as const,
    };
    const result = validateAtlasSourcePolicy(contradictory);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/blocked source must not grant/);
  });

  it('rejects a policy with an unknown permission key smuggled in', () => {
    const base = findAtlasSourcePolicy('uiverse') as AtlasSourcePolicy;
    const smuggled = {
      ...base,
      permissions: { ...base.permissions, sublicenseEverything: true },
    };
    expect(validateAtlasSourcePolicy(smuggled).ok).toBe(false);
  });

  it('rejects non-HTTPS canonical URLs and non-boolean permissions', () => {
    const base = findAtlasSourcePolicy('uiverse') as AtlasSourcePolicy;
    expect(validateAtlasSourcePolicy({ ...base, canonicalUrl: 'http://uiverse.io' }).ok).toBe(
      false,
    );
    expect(
      validateAtlasSourcePolicy({
        ...base,
        permissions: { ...base.permissions, cache: 'yes' as unknown as boolean },
      }).ok,
    ).toBe(false);
  });

  it('rejects a non-object entirely rather than throwing', () => {
    for (const input of [null, undefined, 'policy', 42, []]) {
      expect(validateAtlasSourcePolicy(input).ok).toBe(false);
    }
  });
});

describe('Recipe validation: the failure the Atlas exists to stop', () => {
  it('accepts a well-formed architecture recipe', () => {
    const result = validateAtlasArtifactRecipe(architectureRecipe());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('rejects an architecture recipe that only produces text', () => {
    const result = validateAtlasArtifactRecipe(architectureRecipe({ artifactKinds: ['text'] }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(
      /does not produce any artifact systems.architecture requires/,
    );
  });

  it('requires a recipe to inherit its archetype forbidden substitutes', () => {
    const result = validateAtlasArtifactRecipe(
      architectureRecipe({ forbiddenPatterns: ['ascii-arrows'] }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/must inherit prose-as-architecture/);
  });

  it('requires an honest fallback whenever PowerPoint output degrades', () => {
    const degraded = validateAtlasArtifactRecipe(
      architectureRecipe({ capability: { web: 'native', pptx: 'unsupported' } }),
    );
    expect(degraded.ok).toBe(false);
    expect(degraded.errors.join(' ')).toMatch(/fallbackBehavior is required/);

    const disclosed = validateAtlasArtifactRecipe(
      architectureRecipe({
        capability: {
          web: 'native',
          pptx: 'poster-frame',
          fallbackBehavior: 'Exports a poster frame plus a storyboard panel.',
        },
      }),
    );
    expect(disclosed.ok).toBe(true);
  });

  it('refuses a reuse mode the source does not permit', () => {
    const copied = validateAtlasArtifactRecipe(
      architectureRecipe({ sourceId: 'mobbin', reuseMode: 'copy' }),
    );
    expect(copied.ok).toBe(false);
    expect(copied.errors.join(' ')).toMatch(/needs download from source mobbin/);
  });

  it('refuses to reimplement from a competitively restricted source', () => {
    const result = validateAtlasArtifactRecipe(
      architectureRecipe({ sourceId: 'mobbin', reuseMode: 'reimplement' }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/restricts competitive use/);
  });

  it('refuses a recipe whose source was never reviewed', () => {
    const result = validateAtlasArtifactRecipe(architectureRecipe({ sourceId: 'some-blog' }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/unreviewed sources are denied/);
  });

  it('refuses a recipe pointing at an archetype that does not exist', () => {
    const result = validateAtlasArtifactRecipe(
      architectureRecipe({ archetypeId: 'systems.vibes' }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/not in the Atlas registry/);
  });

  it('rejects an input contract with duplicate keys or an inverted range', () => {
    const duplicate = validateAtlasArtifactRecipe(
      architectureRecipe({
        inputContract: [
          { key: 'nodes', kind: 'node', required: true, description: 'A' },
          { key: 'nodes', kind: 'node', required: false, description: 'B' },
        ],
      }),
    );
    expect(duplicate.ok).toBe(false);

    const inverted = validateAtlasArtifactRecipe(
      architectureRecipe({
        inputContract: [
          { key: 'nodes', kind: 'node', required: true, description: 'A', minimum: 9, maximum: 2 },
        ],
      }),
    );
    expect(inverted.ok).toBe(false);
    expect(inverted.errors.join(' ')).toMatch(/minimum above its maximum/);
  });
});

describe('Receipts: a pass is only a pass if the artifact is referenced', () => {
  it('accepts a fully evidenced receipt', () => {
    expect(validateAtlasShowcaseReceipt(receipt()).errors).toEqual([]);
  });

  it('rejects an export pass with no PowerPoint render or file', () => {
    const result = validateAtlasShowcaseReceipt(
      receipt({
        outputs: { browserRenderRef: 'a.png', pptxRenderRef: '', pptxFileRef: '' },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/exportPassed requires outputs.pptxRenderRef/);
  });

  it('rejects a visual pass with no browser render', () => {
    const result = validateAtlasShowcaseReceipt(
      receipt({
        outputs: { browserRenderRef: '', pptxRenderRef: 'b.png', pptxFileRef: 'c.pptx' },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/visualPassed requires outputs.browserRenderRef/);
  });

  it('rejects an editable PowerPoint claim when the export gate did not pass', () => {
    const result = validateAtlasShowcaseReceipt(
      receipt({
        evaluation: {
          briefAdherence: true,
          visualPassed: true,
          evidencePassed: true,
          exportPassed: false,
          repairCount: 0,
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/may not claim editable output/);
  });

  it('treats an omitted human judgement as invalid rather than as a rejection', () => {
    const omitted = { ...receipt() } as Record<string, unknown>;
    // biome-ignore lint/performance/noDelete: exercising the "field absent" wire shape.
    delete omitted['humanPreferred'];
    const result = validateAtlasShowcaseReceipt(omitted);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/undefined hides an unjudged result/);
    expect(validateAtlasShowcaseReceipt(receipt({ humanPreferred: null })).ok).toBe(true);
  });

  it('rejects negative repair counts, costs and latencies', () => {
    expect(validateAtlasShowcaseReceipt(receipt({ costUsd: -1 })).ok).toBe(false);
    expect(validateAtlasShowcaseReceipt(receipt({ latencyMs: -1 })).ok).toBe(false);
    expect(
      validateAtlasShowcaseReceipt(
        receipt({
          evaluation: {
            briefAdherence: true,
            visualPassed: true,
            evidencePassed: true,
            exportPassed: true,
            repairCount: -3,
          },
        }),
      ).ok,
    ).toBe(false);
  });
});

describe('Maturity: what a listing may claim about itself', () => {
  it('earns nothing above extracted without receipts', () => {
    expect(earnedAtlasMaturity(architectureRecipe({ maturity: 'proven' }), [])).toBe('extracted');
  });

  it('earns proven from a fully passing receipt and certified only from a human preference', () => {
    const passing = receipt({ id: 'r-pass' });
    const recipe = architectureRecipe({ maturity: 'proven', receiptIds: ['r-pass'] });
    expect(earnedAtlasMaturity(recipe, [passing])).toBe('proven');
    expect(earnedAtlasMaturity(recipe, [{ ...passing, humanPreferred: true }])).toBe('certified');
  });

  it('stops at vetted when the receipt exists but a gate failed', () => {
    const failing = receipt({
      id: 'r-fail',
      evaluation: {
        briefAdherence: true,
        visualPassed: true,
        evidencePassed: false,
        exportPassed: true,
        repairCount: 4,
      },
    });
    const recipe = architectureRecipe({ maturity: 'certified', receiptIds: ['r-fail'] });
    expect(earnedAtlasMaturity(recipe, [failing])).toBe('vetted');
    const claim = validateAtlasMaturityClaim(recipe, [failing]);
    expect(claim.ok).toBe(false);
    expect(claim.errors.join(' ')).toMatch(/claims certified but its receipts only earn vetted/);
  });

  /**
   * The ladder is read as a claim about models, so it has to be scored against models. Our own
   * compiler replaying the fixture the gates were authored from passes every gate by construction;
   * treating that as `proven` made a zero-model run indistinguishable from a paid one.
   */
  it('caps a deterministic-baseline receipt at vetted no matter how clean it is', () => {
    const baseline = receipt({
      id: 'r-baseline',
      model: { id: 'nodeslide-artifact-builder-v1', role: 'geometry-and-export-control' },
      candidateKind: 'deterministic-baseline',
      costUsd: 0,
      latencyMs: 0,
    });
    const recipe = architectureRecipe({ maturity: 'proven', receiptIds: ['r-baseline'] });
    expect(earnedAtlasMaturity(recipe, [baseline])).toBe('vetted');
    // Even a human preference cannot lift it: nothing generative was demonstrated.
    expect(earnedAtlasMaturity(recipe, [{ ...baseline, humanPreferred: true }])).toBe('vetted');
    expect(validateAtlasMaturityClaim(recipe, [baseline]).ok).toBe(false);
  });

  it('fails closed on a receipt written before candidateKind existed', () => {
    const legacy = receipt({ id: 'r-legacy' });
    // biome-ignore lint/performance/noDelete: modelling a receipt that predates the field.
    delete (legacy as { candidateKind?: unknown }).candidateKind;
    const recipe = architectureRecipe({ maturity: 'proven', receiptIds: ['r-legacy'] });
    expect(earnedAtlasMaturity(recipe, [legacy])).toBe('vetted');
  });

  it('lets one model receipt carry the recipe past a pile of baselines', () => {
    const baselines = [1, 2, 3].map((n) =>
      receipt({ id: `r-base-${n}`, candidateKind: 'deterministic-baseline' }),
    );
    const model = receipt({ id: 'r-model', candidateKind: 'model' });
    const recipe = architectureRecipe({
      maturity: 'proven',
      receiptIds: [...baselines.map((r) => r.id), 'r-model'],
    });
    expect(earnedAtlasMaturity(recipe, baselines)).toBe('vetted');
    expect(earnedAtlasMaturity(recipe, [...baselines, model])).toBe('proven');
  });

  it('ignores receipts belonging to a different recipe', () => {
    const foreign = receipt({ id: 'someone-elses' });
    const recipe = architectureRecipe({ maturity: 'proven', receiptIds: ['r-mine'] });
    expect(validateAtlasMaturityClaim(recipe, [foreign]).ok).toBe(false);
  });

  it('permits a claim at or below the earned level', () => {
    const passing = receipt({ id: 'r-pass' });
    const recipe = architectureRecipe({ maturity: 'vetted', receiptIds: ['r-pass'] });
    expect(validateAtlasMaturityClaim(recipe, [passing]).ok).toBe(true);
  });
});

describe('Topology gate: the slide that describes a diagram instead of drawing one', () => {
  it('flags prose standing in for an architecture diagram', () => {
    const violations = atlasTopologyViolations({
      archetypeId: 'systems.architecture',
      producedArtifactKinds: ['text'],
      detectedSubstitutes: ['prose-as-architecture'],
    });
    expect(violations).toHaveLength(2);
    expect(violations.join(' ')).toMatch(/forbids the substitute prose-as-architecture/);
  });

  it('passes a slide that produced the required diagram', () => {
    expect(
      atlasTopologyViolations({
        archetypeId: 'systems.architecture',
        producedArtifactKinds: ['diagram', 'text'],
      }),
    ).toEqual([]);
  });

  it('reports an empty slide honestly instead of silently passing', () => {
    const violations = atlasTopologyViolations({
      archetypeId: 'data.trend-line',
      producedArtifactKinds: [],
    });
    expect(violations.join(' ')).toMatch(/produced nothing/);
  });

  it('refuses to judge an unknown archetype', () => {
    expect(
      atlasTopologyViolations({ archetypeId: 'made.up', producedArtifactKinds: ['diagram'] }),
    ).toEqual(['Unknown archetype made.up.']);
  });
});

/**
 * Measured by round-tripping the real deck through LibreOffice twice (pptx->pptx and
 * pptx->odp->pptx, which agreed). The interesting result is how narrow the loss is: the tier was
 * overstated on exactly one object class, not on native artifacts generally.
 */
describe('Renderer portability: `editable` is a property of file-plus-renderer', () => {
  it('keeps the declared capability inside PowerPoint', () => {
    const scoped = rendererScopedCapability({
      artifactKind: 'equation',
      declared: 'editable',
      renderer: 'powerpoint',
    });
    expect(scoped.capability).toBe('editable');
    expect(scoped.downgraded).toBe(false);
  });

  /**
   * This assertion used to be the opposite, and the flip is the point. The first measurement found
   * the OMML annihilated; the emitter was then fixed to wrap it in <a14:m>, a re-measurement on
   * 2026-07-23 found all 10 runs intact, and the recorded fact followed the instrument rather than
   * the other way round. What survives is the wrapper's doing, and the measurement string still
   * carries the bare-oMath result so the reason is not lost.
   */
  it('no longer downgrades an equation, because the wrapped OMML now survives', () => {
    const scoped = rendererScopedCapability({
      artifactKind: 'equation',
      declared: 'editable',
      renderer: 'other',
    });
    expect(scoped.capability).toBe('editable');
    expect(scoped.downgraded).toBe(false);
    expect(ATLAS_ARTIFACT_PORTABILITY.equation.measurement).toMatch(/<a14:m>/);
    // The failure mode that made the wrapper necessary stays on the record.
    expect(ATLAS_ARTIFACT_PORTABILITY.equation.measurement).toMatch(/annihilated/);
  });

  it('does NOT downgrade charts, tables, diagrams or timelines — those genuinely travel', () => {
    for (const kind of ['chart', 'table', 'diagram', 'timeline'] as const) {
      const scoped = rendererScopedCapability({
        artifactKind: kind,
        declared: 'editable',
        renderer: 'other',
      });
      expect(scoped.capability, kind).toBe('editable');
      expect(scoped.downgraded, kind).toBe(false);
    }
  });

  it('degrades an unmeasured kind rather than letting it pass as portable', () => {
    const scoped = rendererScopedCapability({
      artifactKind: 'evidence',
      declared: 'editable',
      renderer: 'other',
    });
    expect(ATLAS_ARTIFACT_PORTABILITY.evidence.portability).toBe('unmeasured');
    expect(scoped.capability).toBe('unsupported');
  });

  it('never upgrades: a portable fact cannot lift a recipe above its own claim', () => {
    const scoped = rendererScopedCapability({
      artifactKind: 'chart',
      declared: 'rendered-image',
      renderer: 'other',
    });
    expect(scoped.capability).toBe('rendered-image');
    expect(scoped.downgraded).toBe(false);
  });

  it('records a measurement for every artifact kind, so silence is never mistaken for proof', () => {
    for (const kind of ATLAS_ARTIFACT_KINDS) {
      expect(ATLAS_ARTIFACT_PORTABILITY[kind]?.measurement, kind).toBeTruthy();
    }
  });
});

describe('Arena contracts: parity consumes the projection, never a second schema', () => {
  it('reads the canonical schema ids from the nodeslide projection', () => {
    const ids = arenaSchemaIds();
    expect(ids).toContain('nodeslide.artifact-showcase-receipt/v1');
    expect(ids).toContain('nodeslide.artifact-arena-coverage/v1');
    // The retired parity umbrella schema must not reappear.
    expect(ids).not.toContain('nodeslide.arena/v1');
  });

  it('records that cross-axis comparison is unrepresentable, not a confounded verdict', () => {
    expect(crossAxisComparisonRepresentable()).toBe(false);
    expect(NODESLIDE_ARENA_CONTRACTS.crossAxisPolicy.errorName).toBe('InvalidArenaComparisonError');
    expect(NODESLIDE_ARENA_CONTRACTS.crossAxisPolicy.codes).toContain('cross_axis_comparison');
  });

  it('binds the projection to a nodeslide source commit and a body hash', () => {
    expect(NODESLIDE_ARENA_CONTRACTS.sourceRepository).toBe('nodeslide');
    expect(NODESLIDE_ARENA_CONTRACTS.meta.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(NODESLIDE_ARENA_CONTRACTS.meta.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('exposes the gate list and honest tri-state so parity does not re-derive them', () => {
    expect(NODESLIDE_ARENA_CONTRACTS.receiptGates).toContain('exportPassed');
    expect(NODESLIDE_ARENA_CONTRACTS.gateStates).toEqual(['pass', 'fail', 'not-run']);
    expect(NODESLIDE_ARENA_CONTRACTS.arenaOmissionReasons).toContain('budget_limit');
  });
});
