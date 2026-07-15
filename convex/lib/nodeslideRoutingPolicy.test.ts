import { describe, expect, it } from 'vitest';
import type { NodeSlideAgentModelId, NodeSlideExternalProvider } from '../../shared/nodeslide';
import {
  type NodeSlideRouteAvailability,
  type NodeSlideRouteReference,
  type NodeSlideRoutingCapabilities,
  type NodeSlideRoutingDecision,
  type NodeSlideRoutingPolicyInput,
  decideNodeSlideAutoRoute,
} from './nodeslideRoutingPolicy';

const OPENROUTER_GLM = {
  provider: 'openrouter',
  catalogModelId: 'z-ai/glm-5.2',
} as const satisfies NodeSlideRouteReference;
const NATIVE_NEBIUS_GLM = {
  provider: 'nebius',
  catalogModelId: 'nebius/zai-org/GLM-5.2',
} as const satisfies NodeSlideRouteReference;
const CLAUDE_SONNET = {
  provider: 'openrouter',
  catalogModelId: 'anthropic/claude-sonnet-5',
} as const satisfies NodeSlideRouteReference;
const GPT_LUNA = {
  provider: 'openrouter',
  catalogModelId: 'openai/gpt-5.6-luna',
} as const satisfies NodeSlideRouteReference;

const TEXT_CAPABILITIES: NodeSlideRoutingCapabilities = {
  web: false,
  longContext: false,
  image: false,
  reasoning: false,
};

function input(overrides: Partial<NodeSlideRoutingPolicyInput> = {}): NodeSlideRoutingPolicyInput {
  return {
    task: 'compose-deck',
    capabilities: TEXT_CAPABILITIES,
    consent: consentFor(OPENROUTER_GLM),
    availability: [availability(OPENROUTER_GLM)],
    expectedInputTokens: 1_000,
    expectedOutputTokens: 1_000,
    maxUsd: 1,
    fallbackPolicy: { mode: 'none' },
    ...overrides,
  };
}

function consentFor(...routes: readonly NodeSlideRouteReference[]): {
  providers: NodeSlideExternalProvider[];
  models: NodeSlideAgentModelId[];
} {
  return {
    providers: [...new Set(routes.map((route) => route.provider))],
    models: [...new Set(routes.map((route) => route.catalogModelId))],
  };
}

function availability(
  route: NodeSlideRouteReference,
  available = true,
): NodeSlideRouteAvailability {
  return { ...route, available };
}

function selected(decision: NodeSlideRoutingDecision) {
  expect(decision.kind).toBe('selected');
  if (decision.kind !== 'selected') {
    throw new Error(`Expected selected route, received ${decision.refusal.code}`);
  }
  return decision;
}

function refused(decision: NodeSlideRoutingDecision) {
  expect(decision.kind).toBe('refused');
  if (decision.kind !== 'refused') throw new Error('Expected typed routing refusal.');
  return decision;
}

describe('NodeSlide fail-closed auto routing policy', () => {
  describe('live availability', () => {
    it.each([
      {
        name: 'explicit unavailable signal',
        availability: [availability(OPENROUTER_GLM, false)],
        reason: 'explicitly reports this route unavailable',
      },
      {
        name: 'missing exact availability signal',
        availability: [],
        reason: 'No exact live availability record',
      },
    ])('refuses the stable primary for a $name', ({ availability: live, reason }) => {
      const decision = refused(decideNodeSlideAutoRoute(input({ availability: live })));

      expect(decision.refusal.code).toBe('route_unavailable');
      expect(decision.fallbackReceipt).toMatchObject({
        policy: 'none',
        attempted: false,
        used: false,
        selectedFallbackIndex: null,
      });
      expect(decision.fallbackReceipt.evaluations).toHaveLength(1);
      expect(decision.fallbackReceipt.evaluations[0]).toMatchObject({
        route: {
          provider: 'openrouter',
          catalogModelId: 'z-ai/glm-5.2',
          modelId: 'z-ai/glm-5.2',
        },
        outcome: 'availability_unconfirmed',
      });
      expect(decision.fallbackReceipt.evaluations[0]?.reasons.join(' ')).toContain(reason);
    });
  });

  describe('exact consent boundaries', () => {
    it.each([
      {
        name: 'provider consent is absent',
        consent: { providers: [], models: [OPENROUTER_GLM.catalogModelId] },
      },
      {
        name: 'model consent is absent',
        consent: { providers: ['openrouter' as const], models: [] },
      },
      {
        name: 'provider and model consent refer to different native routes',
        consent: {
          providers: ['openrouter' as const],
          models: [NATIVE_NEBIUS_GLM.catalogModelId],
        },
      },
    ])('refuses when $name', ({ consent }) => {
      const decision = refused(decideNodeSlideAutoRoute(input({ consent })));

      expect(decision.refusal.code).toBe('consent_required');
      expect(decision.fallbackReceipt.primaryRoute).toBeNull();
      expect(decision.fallbackReceipt.evaluations).toEqual([]);
    });

    it.each([
      {
        name: 'fallback provider is not consented',
        consent: {
          providers: ['openrouter' as const],
          models: [OPENROUTER_GLM.catalogModelId, NATIVE_NEBIUS_GLM.catalogModelId],
        },
      },
      {
        name: 'fallback model is not consented',
        consent: {
          providers: ['openrouter' as const, 'nebius' as const],
          models: [OPENROUTER_GLM.catalogModelId],
        },
      },
    ])('never crosses consent when the $name', ({ consent }) => {
      const decision = refused(
        decideNodeSlideAutoRoute(
          input({
            consent,
            availability: [availability(OPENROUTER_GLM, false), availability(NATIVE_NEBIUS_GLM)],
            fallbackPolicy: { mode: 'ordered', routes: [NATIVE_NEBIUS_GLM] },
          }),
        ),
      );

      expect(decision.refusal.code).toBe('fallback_exhausted');
      expect(decision.fallbackReceipt.used).toBe(false);
      expect(decision.fallbackReceipt.evaluations.map(({ outcome }) => outcome)).toEqual([
        'availability_unconfirmed',
        'not_consented',
      ]);
    });
  });

  describe('per-request cost cap', () => {
    it.each([
      { name: 'one micro-dollar below estimate', cap: 0.002203, kind: 'refused' },
      { name: 'exactly equal to estimate', cap: 0.002204, kind: 'selected' },
      { name: 'well above estimate', cap: 1, kind: 'selected' },
    ] as const)('$name is $kind', ({ cap, kind }) => {
      const decision = decideNodeSlideAutoRoute(input({ maxUsd: cap }));

      expect(decision.kind).toBe(kind);
      expect(decision.costEstimate).toMatchObject({
        status: 'estimated',
        totalMicroUsd: 2_204,
        totalUsd: 0.002204,
        pricing: {
          source: 'pi-ai-openrouter-catalog',
          inputUsdPerMillionTokens: 0.532,
          outputUsdPerMillionTokens: 1.672,
        },
      });
      if (kind === 'refused') {
        expect(refused(decision).refusal.code).toBe('cost_cap_exceeded');
      } else {
        expect(selected(decision).costEstimate).toMatchObject({ withinCap: true });
      }
    });
  });

  describe('explicit fallback policy', () => {
    it.each([
      {
        name: 'normal consent order',
        consent: consentFor(OPENROUTER_GLM, GPT_LUNA),
        live: [availability(OPENROUTER_GLM, false), availability(GPT_LUNA)],
      },
      {
        name: 'reversed consent and availability order',
        consent: {
          providers: ['openrouter' as const],
          models: [GPT_LUNA.catalogModelId, OPENROUTER_GLM.catalogModelId],
        },
        live: [availability(GPT_LUNA), availability(OPENROUTER_GLM, false)],
      },
    ])(
      'does not silently use an available alternate with no fallback: $name',
      ({ consent, live }) => {
        const decision = refused(
          decideNodeSlideAutoRoute(
            input({ consent, availability: live, fallbackPolicy: { mode: 'none' } }),
          ),
        );

        expect(decision.refusal.code).toBe('route_unavailable');
        expect(decision.fallbackReceipt.evaluations).toHaveLength(1);
        expect(decision.fallbackReceipt.evaluations[0]?.route.catalogModelId).toBe(
          OPENROUTER_GLM.catalogModelId,
        );
      },
    );

    it.each([
      {
        name: 'first eligible explicit fallback',
        routes: [GPT_LUNA, CLAUDE_SONNET],
        live: [
          availability(OPENROUTER_GLM, false),
          availability(GPT_LUNA),
          availability(CLAUDE_SONNET),
        ],
        expectedModel: GPT_LUNA.catalogModelId,
        expectedIndex: 0,
        expectedOutcomes: ['availability_unconfirmed', 'selected'],
      },
      {
        name: 'later fallback after an unavailable entry',
        routes: [CLAUDE_SONNET, GPT_LUNA],
        live: [
          availability(OPENROUTER_GLM, false),
          availability(CLAUDE_SONNET, false),
          availability(GPT_LUNA),
        ],
        expectedModel: GPT_LUNA.catalogModelId,
        expectedIndex: 1,
        expectedOutcomes: ['availability_unconfirmed', 'availability_unconfirmed', 'selected'],
      },
    ] as const)(
      'uses a deterministic ordered chain for the $name',
      ({ routes, live, expectedModel, expectedIndex, expectedOutcomes }) => {
        const decision = selected(
          decideNodeSlideAutoRoute(
            input({
              consent: consentFor(OPENROUTER_GLM, CLAUDE_SONNET, GPT_LUNA),
              availability: live,
              fallbackPolicy: { mode: 'ordered', routes },
            }),
          ),
        );

        expect(decision.route.catalogModelId).toBe(expectedModel);
        expect(decision.fallbackReceipt).toMatchObject({
          policy: 'ordered',
          attempted: true,
          used: true,
          selectedFallbackIndex: expectedIndex,
        });
        expect(decision.fallbackReceipt.evaluations.map(({ outcome }) => outcome)).toEqual(
          expectedOutcomes,
        );
      },
    );
  });

  describe('stable capability-aware selection', () => {
    it.each([
      {
        name: 'text task',
        capabilities: TEXT_CAPABILITIES,
        expectedModel: OPENROUTER_GLM.catalogModelId,
      },
      {
        name: 'image and reasoning task',
        capabilities: { ...TEXT_CAPABILITIES, image: true, reasoning: true },
        expectedModel: CLAUDE_SONNET.catalogModelId,
      },
    ])('is independent of input set ordering for a $name', ({ capabilities, expectedModel }) => {
      const routes = [OPENROUTER_GLM, CLAUDE_SONNET, GPT_LUNA] as const;
      const baseline = decideNodeSlideAutoRoute(
        input({
          capabilities,
          consent: consentFor(...routes),
          availability: routes.map((route) => availability(route)),
        }),
      );
      const reordered = decideNodeSlideAutoRoute(
        input({
          capabilities,
          consent: {
            providers: ['openrouter'],
            models: routes.map((route) => route.catalogModelId).reverse(),
          },
          availability: routes.map((route) => availability(route)).reverse(),
        }),
      );

      expect(selected(baseline).route.catalogModelId).toBe(expectedModel);
      expect(reordered).toEqual(baseline);
    });

    it.each([
      {
        name: 'web capability without attested native web metadata',
        capabilities: { ...TEXT_CAPABILITIES, web: true },
        code: 'capability_unavailable',
      },
      {
        name: 'token estimate beyond every consented context window',
        capabilities: { ...TEXT_CAPABILITIES, longContext: true },
        expectedInputTokens: 1_048_576,
        expectedOutputTokens: 1,
        code: 'context_window_exceeded',
      },
    ] as const)('fails closed for $name', (testCase) => {
      const decision = refused(
        decideNodeSlideAutoRoute(
          input({
            capabilities: testCase.capabilities,
            expectedInputTokens: testCase.expectedInputTokens ?? 1_000,
            expectedOutputTokens: testCase.expectedOutputTokens ?? 1_000,
          }),
        ),
      );

      expect(decision.refusal.code).toBe(testCase.code);
    });
  });

  describe('provider-native route identity', () => {
    it.each([
      {
        name: 'OpenRouter catalog route',
        route: OPENROUTER_GLM,
        expectedModelId: 'z-ai/glm-5.2',
        expectedPricingSource: 'pi-ai-openrouter-catalog',
      },
      {
        name: 'direct Nebius catalog route',
        route: NATIVE_NEBIUS_GLM,
        expectedModelId: 'zai-org/GLM-5.2',
        expectedPricingSource: 'nodeslide-nebius-native-catalog',
      },
    ] as const)(
      'preserves exact provider and upstream model for the $name',
      ({ route, expectedModelId, expectedPricingSource }) => {
        const decision = selected(
          decideNodeSlideAutoRoute(
            input({ consent: consentFor(route), availability: [availability(route)] }),
          ),
        );

        expect(decision.route).toEqual({
          provider: route.provider,
          catalogModelId: route.catalogModelId,
          modelId: expectedModelId,
        });
        expect(decision.costEstimate).toMatchObject({
          status: 'estimated',
          pricing: { source: expectedPricingSource },
        });
      },
    );
  });
});
