import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import {
  NODESLIDE_AGENT_MODELS,
  type NodeSlideAgentModelId,
  type NodeSlideExternalProvider,
  type NodeSlideReasoningEffort,
  isNodeSlideAgentModelId,
  isNodeSlideReasoningEffort,
} from '../../shared/nodeslide';

export const NODESLIDE_ROUTING_POLICY_VERSION = 'nodeslide.auto-routing/v1' as const;
export const NODESLIDE_LONG_CONTEXT_MIN_TOKENS = 200_000;
export const NODESLIDE_DETERMINISTIC_ROUTE = {
  provider: 'nodeslide',
  catalogModelId: null,
  modelId: 'bounded-edit-v1',
} as const;

const MAX_TASK_LENGTH = 128;
const MAX_ROUTE_INPUTS = NODESLIDE_AGENT_MODELS.length;
const MICRO_USD_PER_USD = 1_000_000;

export type NodeSlideRoutingCapability = 'web' | 'long-context' | 'image' | 'reasoning';

export interface NodeSlideRoutingCapabilities {
  web: boolean;
  longContext: boolean;
  image: boolean;
  reasoning: boolean;
}

/** References use the curated catalog id, not a vendor id inferred from its prefix. */
export interface NodeSlideRouteReference {
  provider: NodeSlideExternalProvider;
  catalogModelId: NodeSlideAgentModelId;
}

export interface NodeSlideRoutingConsent {
  providers: readonly NodeSlideExternalProvider[];
  models: readonly NodeSlideAgentModelId[];
}

export interface NodeSlideRouteAvailability extends NodeSlideRouteReference {
  /** Only literal true authorizes routing. Missing records and false both fail closed. */
  available: boolean;
}

export type NodeSlideFallbackPolicy =
  | { mode: 'none' }
  | { mode: 'ordered'; routes: readonly NodeSlideRouteReference[] };

export interface NodeSlideRoutingPolicyInput {
  /** Bounded caller-owned task label used in the decision receipt. */
  task: string;
  capabilities: NodeSlideRoutingCapabilities;
  privacy: 'deterministic_only' | 'external_if_consented';
  /** Exact provider-native value; null deliberately requests no effort option. */
  requestedReasoningEffort: NodeSlideReasoningEffort | null;
  /** Local execution also requires an explicit live availability signal. */
  deterministicAvailable: boolean;
  consent: NodeSlideRoutingConsent;
  availability: readonly NodeSlideRouteAvailability[];
  expectedInputTokens: number;
  expectedOutputTokens: number;
  maxUsd: number;
  fallbackPolicy: NodeSlideFallbackPolicy;
}

/** Exact provider-native route. `modelId` is the id sent to that provider. */
export interface NodeSlideExternalSelectedRoute {
  provider: NodeSlideExternalProvider;
  catalogModelId: NodeSlideAgentModelId;
  modelId: string;
}

export interface NodeSlideDeterministicSelectedRoute {
  provider: typeof NODESLIDE_DETERMINISTIC_ROUTE.provider;
  catalogModelId: null;
  modelId: typeof NODESLIDE_DETERMINISTIC_ROUTE.modelId;
}

export type NodeSlideSelectedRoute =
  | NodeSlideExternalSelectedRoute
  | NodeSlideDeterministicSelectedRoute;

export interface NodeSlideEstimatedCost {
  status: 'estimated';
  route: NodeSlideSelectedRoute;
  expectedInputTokens: number;
  expectedOutputTokens: number;
  inputMicroUsd: number;
  outputMicroUsd: number;
  totalMicroUsd: number;
  totalUsd: number;
  capMicroUsd: number;
  capUsd: number;
  withinCap: boolean;
  pricing: {
    source:
      | 'pi-ai-openrouter-catalog'
      | 'nodeslide-nebius-native-catalog'
      | 'nodeslide-deterministic';
    inputUsdPerMillionTokens: number;
    outputUsdPerMillionTokens: number;
    inputTokensAbove: number | null;
  };
}

export interface NodeSlideUnavailableCostEstimate {
  status: 'unavailable';
  reason: string;
}

export type NodeSlideRoutingCostEstimate =
  | NodeSlideEstimatedCost
  | NodeSlideUnavailableCostEstimate;

export type NodeSlideRouteEvaluationOutcome =
  | 'selected'
  | 'not_consented'
  | 'capability_mismatch'
  | 'context_window_exceeded'
  | 'pricing_unavailable'
  | 'availability_unconfirmed'
  | 'cost_cap_exceeded'
  | 'reasoning_effort_unsupported'
  | 'duplicate_primary';

export interface NodeSlideRouteEvaluation {
  source: 'primary' | 'fallback';
  /** Zero for the primary; zero-based position in the explicit chain for a fallback. */
  index: number;
  route: NodeSlideSelectedRoute;
  outcome: NodeSlideRouteEvaluationOutcome;
  providerNativeEffort: NodeSlideReasoningEffort | null;
  costEstimate: NodeSlideRoutingCostEstimate;
  reasons: readonly string[];
}

export interface NodeSlideFallbackReceipt {
  policy: 'none' | 'ordered' | 'invalid';
  primaryRoute: NodeSlideSelectedRoute | null;
  attempted: boolean;
  used: boolean;
  /** Zero-based position in the caller's ordered fallback chain. */
  selectedFallbackIndex: number | null;
  evaluations: readonly NodeSlideRouteEvaluation[];
}

export type NodeSlideRoutingRefusalCode =
  | 'invalid_input'
  | 'consent_required'
  | 'capability_unavailable'
  | 'context_window_exceeded'
  | 'pricing_unavailable'
  | 'route_unavailable'
  | 'cost_cap_exceeded'
  | 'reasoning_effort_unsupported'
  | 'fallback_exhausted';

export interface NodeSlideRoutingRefusal {
  code: NodeSlideRoutingRefusalCode;
  message: string;
}

interface NodeSlideRoutingDecisionBase {
  policyVersion: typeof NODESLIDE_ROUTING_POLICY_VERSION;
  providerNativeEffort: NodeSlideReasoningEffort | null;
  reasons: readonly string[];
  fallbackReceipt: NodeSlideFallbackReceipt;
}

export type NodeSlideRoutingDecision =
  | (NodeSlideRoutingDecisionBase & {
      kind: 'selected';
      route: NodeSlideSelectedRoute;
      costEstimate: NodeSlideEstimatedCost;
    })
  | (NodeSlideRoutingDecisionBase & {
      kind: 'refused';
      refusal: NodeSlideRoutingRefusal;
      costEstimate: NodeSlideRoutingCostEstimate;
    });

interface PricingTier {
  inputTokensAbove: number;
  input: number;
  output: number;
}

interface RoutingModelMetadata {
  input: readonly ('text' | 'image')[];
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  pricingSource: NodeSlideEstimatedCost['pricing']['source'];
  pricing: {
    input: number;
    output: number;
    tiers: readonly PricingTier[];
  };
}

type NodeSlideCatalogModel = (typeof NODESLIDE_AGENT_MODELS)[number];

interface CatalogRoute {
  catalog: NodeSlideCatalogModel;
  metadata: RoutingModelMetadata | null;
}

const OPENROUTER_MODELS = new Map(
  openrouterProvider()
    .getModels()
    .map((model) => [model.id, model] as const),
);

// Mirrors the provider-native model declared in nodeslideProvider.ts. OpenRouter
// routes below read the installed pi-ai catalog directly instead of duplicating prices.
const NATIVE_NEBIUS_METADATA: RoutingModelMetadata = {
  input: ['text'],
  reasoning: true,
  contextWindow: 1_048_576,
  maxTokens: 131_072,
  pricingSource: 'nodeslide-nebius-native-catalog',
  pricing: {
    input: 1.4,
    output: 4.4,
    tiers: [],
  },
};

const CATALOG_ROUTES: readonly CatalogRoute[] = NODESLIDE_AGENT_MODELS.map((catalog) => ({
  catalog,
  metadata: providerNativeMetadata(catalog),
}));

/**
 * Pure, bounded policy decision. It performs no provider calls and never
 * invents a provider route, price, capability, availability signal, or consent.
 */
export function decideNodeSlideAutoRoute(
  input: NodeSlideRoutingPolicyInput,
): NodeSlideRoutingDecision {
  const validationIssue = validateInput(input);
  if (validationIssue) {
    return refusedDecision(
      'invalid_input',
      validationIssue,
      unavailableCost('A cost estimate cannot be produced from invalid routing inputs.'),
      emptyFallbackReceipt(fallbackModeFromUnknown(input)),
      [validationIssue],
    );
  }

  if (input.privacy === 'deterministic_only') {
    return decideDeterministicOnly(input);
  }

  const availability = availabilityMap(input.availability);
  const consentedRoutes = CATALOG_ROUTES.filter((route) => isConsented(route, input.consent));
  if (consentedRoutes.length === 0) {
    const message =
      'No catalog route has both exact provider consent and exact model consent for this request.';
    return refusedDecision(
      'consent_required',
      message,
      unavailableCost('No consented route is available to estimate.'),
      emptyFallbackReceipt(input.fallbackPolicy.mode),
      [message],
    );
  }

  const pricedRoutes = consentedRoutes.filter((route) => route.metadata !== null);
  if (pricedRoutes.length === 0) {
    const message =
      'Provider-native pricing and capability metadata is unavailable for every consented route.';
    return refusedDecision(
      'pricing_unavailable',
      message,
      unavailableCost(message),
      emptyFallbackReceipt(input.fallbackPolicy.mode),
      [message],
    );
  }

  const capableRoutes = pricedRoutes.filter((route) => supportsRequiredCapabilities(route, input));
  if (capableRoutes.length === 0) {
    const capabilities = requiredCapabilities(input.capabilities);
    const message = `No consented route has attested provider-native support for ${capabilityLabel(capabilities)}.`;
    return refusedDecision(
      'capability_unavailable',
      message,
      unavailableCost('No capability-compatible route is available to estimate.'),
      emptyFallbackReceipt(input.fallbackPolicy.mode),
      [message],
    );
  }

  const contextCompatibleRoutes = capableRoutes.filter((route) => fitsExpectedTokens(route, input));
  if (contextCompatibleRoutes.length === 0) {
    const message = `No consented capability-compatible route can hold ${input.expectedInputTokens} input and ${input.expectedOutputTokens} output tokens.`;
    return refusedDecision(
      'context_window_exceeded',
      message,
      unavailableCost('No context-compatible route is available to estimate.'),
      emptyFallbackReceipt(input.fallbackPolicy.mode),
      [message],
    );
  }

  // Shared catalog order is the stable priority. Availability and price cap do
  // not silently reshuffle it; moving away from this route requires fallback consent.
  const primary = contextCompatibleRoutes[0];
  if (!primary) {
    const message = 'The bounded NodeSlide routing catalog produced no primary route.';
    return refusedDecision(
      'pricing_unavailable',
      message,
      unavailableCost(message),
      emptyFallbackReceipt(input.fallbackPolicy.mode),
      [message],
    );
  }

  const primaryEvaluation = evaluateRoute(primary, 'primary', 0, input, availability);
  if (primaryEvaluation.outcome === 'selected') {
    const receipt: NodeSlideFallbackReceipt = {
      policy: input.fallbackPolicy.mode,
      primaryRoute: primaryEvaluation.route,
      attempted: false,
      used: false,
      selectedFallbackIndex: null,
      evaluations: [primaryEvaluation],
    };
    return selectedDecision(
      primaryEvaluation,
      receipt,
      selectionReasons(input, primaryEvaluation, null),
    );
  }

  if (input.fallbackPolicy.mode === 'none') {
    const refusal = refusalForPrimary(primaryEvaluation);
    const receipt: NodeSlideFallbackReceipt = {
      policy: 'none',
      primaryRoute: primaryEvaluation.route,
      attempted: false,
      used: false,
      selectedFallbackIndex: null,
      evaluations: [primaryEvaluation],
    };
    return refusedDecision(refusal.code, refusal.message, primaryEvaluation.costEstimate, receipt, [
      refusal.message,
      ...primaryEvaluation.reasons,
    ]);
  }

  const evaluations: NodeSlideRouteEvaluation[] = [primaryEvaluation];
  for (const [index, reference] of input.fallbackPolicy.routes.entries()) {
    const fallback = catalogRoute(reference.catalogModelId);
    if (!fallback) continue;

    const evaluation = sameRoute(fallback, primary)
      ? duplicatePrimaryEvaluation(fallback, index, input)
      : evaluateRoute(fallback, 'fallback', index, input, availability);
    evaluations.push(evaluation);

    if (evaluation.outcome === 'selected') {
      const receipt: NodeSlideFallbackReceipt = {
        policy: 'ordered',
        primaryRoute: primaryEvaluation.route,
        attempted: true,
        used: true,
        selectedFallbackIndex: index,
        evaluations,
      };
      return selectedDecision(
        evaluation,
        receipt,
        selectionReasons(input, evaluation, primaryEvaluation),
      );
    }
  }

  const message = 'The explicit ordered fallback policy was exhausted without an eligible route.';
  const receipt: NodeSlideFallbackReceipt = {
    policy: 'ordered',
    primaryRoute: primaryEvaluation.route,
    attempted: true,
    used: false,
    selectedFallbackIndex: null,
    evaluations,
  };
  return refusedDecision('fallback_exhausted', message, primaryEvaluation.costEstimate, receipt, [
    message,
    ...evaluations.map(
      (evaluation) => `${routeLabel(evaluation.route)} was rejected: ${evaluation.outcome}.`,
    ),
  ]);
}

function selectedDecision(
  evaluation: NodeSlideRouteEvaluation,
  fallbackReceipt: NodeSlideFallbackReceipt,
  reasons: readonly string[],
): NodeSlideRoutingDecision {
  if (evaluation.outcome !== 'selected' || evaluation.costEstimate.status !== 'estimated') {
    const message = 'The selected route is missing a complete provider-native cost estimate.';
    return refusedDecision(
      'pricing_unavailable',
      message,
      evaluation.costEstimate,
      fallbackReceipt,
      [message, ...reasons],
    );
  }
  return {
    kind: 'selected',
    policyVersion: NODESLIDE_ROUTING_POLICY_VERSION,
    route: evaluation.route,
    costEstimate: evaluation.costEstimate,
    providerNativeEffort: evaluation.providerNativeEffort,
    reasons,
    fallbackReceipt,
  };
}

function refusedDecision(
  code: NodeSlideRoutingRefusalCode,
  message: string,
  costEstimate: NodeSlideRoutingCostEstimate,
  fallbackReceipt: NodeSlideFallbackReceipt,
  reasons: readonly string[],
): NodeSlideRoutingDecision {
  return {
    kind: 'refused',
    policyVersion: NODESLIDE_ROUTING_POLICY_VERSION,
    refusal: { code, message },
    costEstimate,
    providerNativeEffort: null,
    reasons,
    fallbackReceipt,
  };
}

function decideDeterministicOnly(input: NodeSlideRoutingPolicyInput): NodeSlideRoutingDecision {
  const route: NodeSlideDeterministicSelectedRoute = NODESLIDE_DETERMINISTIC_ROUTE;
  const costEstimate = deterministicCostEstimate(input);
  let outcome: NodeSlideRouteEvaluationOutcome = 'selected';
  let message =
    'Deterministic-only privacy selected NodeSlide bounded local editing with no external egress.';

  if (requiredCapabilities(input.capabilities).length > 0) {
    outcome = 'capability_mismatch';
    message =
      'The deterministic route cannot attest the requested external model capabilities, and privacy forbids external fallback.';
  } else if (input.requestedReasoningEffort !== null) {
    outcome = 'reasoning_effort_unsupported';
    message =
      'The deterministic route has no provider-native reasoning effort, and the requested effort will not be downgraded or ignored.';
  } else if (!input.deterministicAvailable) {
    outcome = 'availability_unconfirmed';
    message =
      'The deterministic route is not explicitly available, and privacy forbids external fallback.';
  }

  const routeEvaluation = evaluation('primary', 0, route, outcome, costEstimate, [message], null);
  const receipt: NodeSlideFallbackReceipt = {
    policy: input.fallbackPolicy.mode,
    primaryRoute: route,
    attempted: false,
    used: false,
    selectedFallbackIndex: null,
    evaluations: [routeEvaluation],
  };

  if (outcome === 'selected') {
    return selectedDecision(routeEvaluation, receipt, [
      `Task "${input.task.trim()}" is constrained to deterministic-only privacy.`,
      message,
      'Estimated external-provider cost is exactly $0.',
    ]);
  }
  const refusalCode: NodeSlideRoutingRefusalCode =
    outcome === 'capability_mismatch'
      ? 'capability_unavailable'
      : outcome === 'reasoning_effort_unsupported'
        ? 'reasoning_effort_unsupported'
        : 'route_unavailable';
  return refusedDecision(refusalCode, message, costEstimate, receipt, [message]);
}

function evaluateRoute(
  route: CatalogRoute,
  source: NodeSlideRouteEvaluation['source'],
  index: number,
  input: NodeSlideRoutingPolicyInput,
  availability: ReadonlyMap<string, boolean>,
): NodeSlideRouteEvaluation {
  const exactRoute = exactRouteFor(route.catalog);
  const costEstimate = estimateCost(route, input);
  const evaluated = (
    outcome: NodeSlideRouteEvaluationOutcome,
    reasons: readonly string[],
  ): NodeSlideRouteEvaluation =>
    evaluation(
      source,
      index,
      exactRoute,
      outcome,
      costEstimate,
      reasons,
      input.requestedReasoningEffort,
    );

  if (!isConsented(route, input.consent)) {
    return evaluated('not_consented', [
      'Exact provider and model consent are both required for this route.',
    ]);
  }
  if (!route.metadata || costEstimate.status === 'unavailable') {
    return evaluated('pricing_unavailable', [
      'Provider-native pricing metadata is unavailable; the policy will not guess a cost.',
    ]);
  }
  if (!supportsRequiredCapabilities(route, input)) {
    const missing = missingCapabilities(route, input.capabilities);
    return evaluated('capability_mismatch', [
      `Provider-native metadata does not attest ${capabilityLabel(missing)}.`,
    ]);
  }
  if (!fitsExpectedTokens(route, input)) {
    return evaluated('context_window_exceeded', [
      `Expected tokens exceed the route's ${route.metadata.contextWindow}-token context window or ${route.metadata.maxTokens}-token output limit.`,
    ]);
  }
  if (!supportsRequestedReasoningEffort(route, input.requestedReasoningEffort)) {
    return evaluated('reasoning_effort_unsupported', [
      `The exact provider-native effort "${input.requestedReasoningEffort}" is not supported by ${routeLabel(exactRoute)}; the policy will not map it to another level.`,
    ]);
  }

  const liveAvailability = availability.get(routeKey(exactRoute));
  if (liveAvailability !== true) {
    return evaluated('availability_unconfirmed', [
      liveAvailability === false
        ? 'Live availability explicitly reports this route unavailable.'
        : 'No exact live availability record confirms this route.',
    ]);
  }
  if (!costEstimate.withinCap) {
    return evaluated('cost_cap_exceeded', [
      `Conservative estimated cost ${formatUsd(costEstimate.totalUsd)} exceeds the ${formatUsd(input.maxUsd)} request cap.`,
    ]);
  }

  return evaluated('selected', [
    'Exact provider and model consent are present.',
    'Required provider-native capabilities and token limits are satisfied.',
    input.requestedReasoningEffort === null
      ? 'No provider-native reasoning effort was requested.'
      : `Exact provider-native reasoning effort "${input.requestedReasoningEffort}" is preserved.`,
    'Live availability is explicitly confirmed.',
    `Conservative estimated cost ${formatUsd(costEstimate.totalUsd)} is within the ${formatUsd(input.maxUsd)} request cap.`,
  ]);
}

function duplicatePrimaryEvaluation(
  route: CatalogRoute,
  index: number,
  input: NodeSlideRoutingPolicyInput,
): NodeSlideRouteEvaluation {
  const exactRoute = exactRouteFor(route.catalog);
  return evaluation(
    'fallback',
    index,
    exactRoute,
    'duplicate_primary',
    estimateCost(route, input),
    ['The fallback entry repeats the stable primary and cannot change its eligibility.'],
    input.requestedReasoningEffort,
  );
}

function evaluation(
  source: NodeSlideRouteEvaluation['source'],
  index: number,
  route: NodeSlideSelectedRoute,
  outcome: NodeSlideRouteEvaluationOutcome,
  costEstimate: NodeSlideRoutingCostEstimate,
  reasons: readonly string[],
  providerNativeEffort: NodeSlideReasoningEffort | null = null,
): NodeSlideRouteEvaluation {
  return { source, index, route, outcome, providerNativeEffort, costEstimate, reasons };
}

function estimateCost(
  route: CatalogRoute,
  input: Pick<
    NodeSlideRoutingPolicyInput,
    'expectedInputTokens' | 'expectedOutputTokens' | 'maxUsd'
  >,
): NodeSlideRoutingCostEstimate {
  const metadata = route.metadata;
  if (!metadata) {
    return unavailableCost(
      `Provider-native pricing metadata is missing for ${route.catalog.provider}/${route.catalog.upstreamId}.`,
    );
  }

  let inputRate = metadata.pricing.input;
  let outputRate = metadata.pricing.output;
  let inputTokensAbove: number | null = null;
  for (const tier of metadata.pricing.tiers) {
    if (
      input.expectedInputTokens > tier.inputTokensAbove &&
      (inputTokensAbove === null || tier.inputTokensAbove > inputTokensAbove)
    ) {
      inputRate = tier.input;
      outputRate = tier.output;
      inputTokensAbove = tier.inputTokensAbove;
    }
  }

  // Catalog rates are USD per million tokens, numerically equal to micro-USD
  // per token. Round each component up so the cap check never underestimates.
  const inputMicroUsd = Math.ceil(input.expectedInputTokens * inputRate);
  const outputMicroUsd = Math.ceil(input.expectedOutputTokens * outputRate);
  const totalMicroUsd = inputMicroUsd + outputMicroUsd;
  const capMicroUsd = Math.floor(input.maxUsd * MICRO_USD_PER_USD);
  return {
    status: 'estimated',
    route: exactRouteFor(route.catalog),
    expectedInputTokens: input.expectedInputTokens,
    expectedOutputTokens: input.expectedOutputTokens,
    inputMicroUsd,
    outputMicroUsd,
    totalMicroUsd,
    totalUsd: totalMicroUsd / MICRO_USD_PER_USD,
    capMicroUsd,
    capUsd: input.maxUsd,
    withinCap: totalMicroUsd <= capMicroUsd,
    pricing: {
      source: metadata.pricingSource,
      inputUsdPerMillionTokens: inputRate,
      outputUsdPerMillionTokens: outputRate,
      inputTokensAbove,
    },
  };
}

function deterministicCostEstimate(
  input: Pick<
    NodeSlideRoutingPolicyInput,
    'expectedInputTokens' | 'expectedOutputTokens' | 'maxUsd'
  >,
): NodeSlideEstimatedCost {
  return {
    status: 'estimated',
    route: NODESLIDE_DETERMINISTIC_ROUTE,
    expectedInputTokens: input.expectedInputTokens,
    expectedOutputTokens: input.expectedOutputTokens,
    inputMicroUsd: 0,
    outputMicroUsd: 0,
    totalMicroUsd: 0,
    totalUsd: 0,
    capMicroUsd: Math.floor(input.maxUsd * MICRO_USD_PER_USD),
    capUsd: input.maxUsd,
    withinCap: true,
    pricing: {
      source: 'nodeslide-deterministic',
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
      inputTokensAbove: null,
    },
  };
}

function supportsRequiredCapabilities(
  route: CatalogRoute,
  input: Pick<NodeSlideRoutingPolicyInput, 'capabilities'>,
): boolean {
  return missingCapabilities(route, input.capabilities).length === 0;
}

function supportsRequestedReasoningEffort(
  route: CatalogRoute,
  effort: NodeSlideReasoningEffort | null,
): boolean {
  return (
    effort === null ||
    (route.catalog.supportedEfforts as readonly NodeSlideReasoningEffort[]).includes(effort)
  );
}

function missingCapabilities(
  route: CatalogRoute,
  required: NodeSlideRoutingCapabilities,
): NodeSlideRoutingCapability[] {
  const metadata = route.metadata;
  if (!metadata) return requiredCapabilities(required);

  const missing: NodeSlideRoutingCapability[] = [];
  // Neither the current provider request nor its model metadata attests native
  // web access. Guessing from a model's vendor or marketing name is forbidden.
  if (required.web) missing.push('web');
  if (required.longContext && metadata.contextWindow < NODESLIDE_LONG_CONTEXT_MIN_TOKENS) {
    missing.push('long-context');
  }
  if (required.image && !metadata.input.includes('image')) missing.push('image');
  if (required.reasoning && !metadata.reasoning) {
    missing.push('reasoning');
  }
  return missing;
}

function requiredCapabilities(
  capabilities: NodeSlideRoutingCapabilities,
): NodeSlideRoutingCapability[] {
  const required: NodeSlideRoutingCapability[] = [];
  if (capabilities.web) required.push('web');
  if (capabilities.longContext) required.push('long-context');
  if (capabilities.image) required.push('image');
  if (capabilities.reasoning) required.push('reasoning');
  return required;
}

function fitsExpectedTokens(route: CatalogRoute, input: NodeSlideRoutingPolicyInput): boolean {
  return (
    route.metadata !== null &&
    input.expectedOutputTokens <= route.metadata.maxTokens &&
    input.expectedInputTokens + input.expectedOutputTokens <= route.metadata.contextWindow
  );
}

function isConsented(route: CatalogRoute, consent: NodeSlideRoutingConsent): boolean {
  return (
    consent.providers.includes(route.catalog.provider) && consent.models.includes(route.catalog.id)
  );
}

function selectionReasons(
  input: NodeSlideRoutingPolicyInput,
  selected: NodeSlideRouteEvaluation,
  failedPrimary: NodeSlideRouteEvaluation | null,
): readonly string[] {
  const task = input.task.trim();
  const capabilities = capabilityLabel(requiredCapabilities(input.capabilities));
  if (!failedPrimary) {
    return [
      `Task "${task}" requires ${capabilities}.`,
      `${routeLabel(selected.route)} is the stable first consented route in the curated catalog that satisfies the task.`,
      ...selected.reasons,
    ];
  }
  return [
    `Task "${task}" requires ${capabilities}.`,
    `${routeLabel(failedPrimary.route)} remained the stable primary but was rejected: ${failedPrimary.outcome}.`,
    `${routeLabel(selected.route)} was selected at explicit fallback index ${selected.index}.`,
    ...selected.reasons,
  ];
}

function refusalForPrimary(evaluation: NodeSlideRouteEvaluation): NodeSlideRoutingRefusal {
  if (evaluation.outcome === 'availability_unconfirmed') {
    return {
      code: 'route_unavailable',
      message: `${routeLabel(evaluation.route)} is not confirmed live and fallback is disabled.`,
    };
  }
  if (evaluation.outcome === 'cost_cap_exceeded') {
    return {
      code: 'cost_cap_exceeded',
      message: `${routeLabel(evaluation.route)} exceeds the request cost cap and fallback is disabled.`,
    };
  }
  if (evaluation.outcome === 'not_consented') {
    return {
      code: 'consent_required',
      message: `${routeLabel(evaluation.route)} lacks exact provider and model consent.`,
    };
  }
  if (evaluation.outcome === 'capability_mismatch') {
    return {
      code: 'capability_unavailable',
      message: `${routeLabel(evaluation.route)} does not satisfy the required capabilities.`,
    };
  }
  if (evaluation.outcome === 'context_window_exceeded') {
    return {
      code: 'context_window_exceeded',
      message: `${routeLabel(evaluation.route)} cannot hold the expected tokens.`,
    };
  }
  if (evaluation.outcome === 'reasoning_effort_unsupported') {
    return {
      code: 'reasoning_effort_unsupported',
      message: `${routeLabel(evaluation.route)} does not support the exact requested provider-native reasoning effort.`,
    };
  }
  return {
    code: 'pricing_unavailable',
    message: `${routeLabel(evaluation.route)} lacks provider-native pricing metadata.`,
  };
}

function providerNativeMetadata(catalog: NodeSlideCatalogModel): RoutingModelMetadata | null {
  if (catalog.provider === 'nebius') {
    return catalog.upstreamId === 'zai-org/GLM-5.2' ? NATIVE_NEBIUS_METADATA : null;
  }

  const model = OPENROUTER_MODELS.get(catalog.upstreamId);
  if (!model) return null;
  return {
    input: model.input,
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    pricingSource: 'pi-ai-openrouter-catalog',
    pricing: {
      input: model.cost.input,
      output: model.cost.output,
      tiers: (model.cost.tiers ?? []).map((tier) => ({
        inputTokensAbove: tier.inputTokensAbove,
        input: tier.input,
        output: tier.output,
      })),
    },
  };
}

function exactRouteFor(catalog: NodeSlideCatalogModel): NodeSlideExternalSelectedRoute {
  return {
    provider: catalog.provider,
    catalogModelId: catalog.id,
    modelId: catalog.upstreamId,
  };
}

function catalogRoute(modelId: NodeSlideAgentModelId): CatalogRoute | undefined {
  return CATALOG_ROUTES.find((route) => route.catalog.id === modelId);
}

function sameRoute(left: CatalogRoute, right: CatalogRoute): boolean {
  return left.catalog.provider === right.catalog.provider && left.catalog.id === right.catalog.id;
}

function routeKey(route: NodeSlideRouteReference): string {
  return `${route.provider}:${route.catalogModelId}`;
}

function routeLabel(route: NodeSlideSelectedRoute): string {
  return `${route.provider}/${route.modelId}`;
}

function availabilityMap(
  availability: readonly NodeSlideRouteAvailability[],
): ReadonlyMap<string, boolean> {
  return new Map(availability.map((entry) => [routeKey(entry), entry.available]));
}

function unavailableCost(reason: string): NodeSlideUnavailableCostEstimate {
  return { status: 'unavailable', reason };
}

function emptyFallbackReceipt(
  policy: NodeSlideFallbackReceipt['policy'],
): NodeSlideFallbackReceipt {
  return {
    policy,
    primaryRoute: null,
    attempted: false,
    used: false,
    selectedFallbackIndex: null,
    evaluations: [],
  };
}

function capabilityLabel(capabilities: readonly NodeSlideRoutingCapability[]): string {
  return capabilities.length === 0 ? 'text input' : capabilities.join(', ');
}

function formatUsd(usd: number): string {
  return `$${usd.toFixed(6)}`;
}

function validateInput(input: unknown): string | null {
  if (!isRecord(input)) return 'Routing input must be an object.';

  const task = input['task'];
  if (typeof task !== 'string' || task.trim().length === 0 || task.length > MAX_TASK_LENGTH) {
    return `Task must be a non-empty string no longer than ${MAX_TASK_LENGTH} characters.`;
  }

  const capabilities = input['capabilities'];
  if (!isRecord(capabilities)) return 'Capabilities must be an explicit object.';
  for (const key of ['web', 'longContext', 'image', 'reasoning'] as const) {
    if (typeof capabilities[key] !== 'boolean') {
      return `Capability ${key} must be an explicit boolean.`;
    }
  }

  const privacy = input['privacy'];
  if (privacy !== 'deterministic_only' && privacy !== 'external_if_consented') {
    return 'Privacy must be deterministic_only or external_if_consented.';
  }
  const requestedReasoningEffort = input['requestedReasoningEffort'];
  if (requestedReasoningEffort !== null && !isNodeSlideReasoningEffort(requestedReasoningEffort)) {
    return 'Requested reasoning effort must be null or an exact provider-native effort.';
  }
  if (typeof input['deterministicAvailable'] !== 'boolean') {
    return 'Deterministic availability must be an explicit boolean.';
  }

  const expectedInputTokens = input['expectedInputTokens'];
  const expectedOutputTokens = input['expectedOutputTokens'];
  if (!isBoundedTokenCount(expectedInputTokens) || !isBoundedTokenCount(expectedOutputTokens)) {
    return 'Expected input and output tokens must be non-negative safe integers.';
  }
  if (!Number.isSafeInteger(expectedInputTokens + expectedOutputTokens)) {
    return 'Combined expected tokens exceed the safe integer bound.';
  }

  const maxUsd = input['maxUsd'];
  if (
    typeof maxUsd !== 'number' ||
    !Number.isFinite(maxUsd) ||
    maxUsd < 0 ||
    maxUsd * MICRO_USD_PER_USD > Number.MAX_SAFE_INTEGER
  ) {
    return 'The per-request USD cap must be a finite, non-negative micro-USD-safe number.';
  }

  const consent = input['consent'];
  if (!isRecord(consent)) return 'Consent must explicitly list providers and models.';
  const providers = consent['providers'];
  const models = consent['models'];
  if (!Array.isArray(providers) || providers.length > 2) {
    return 'Consented providers must be a bounded array.';
  }
  if (!Array.isArray(models) || models.length > MAX_ROUTE_INPUTS) {
    return 'Consented models must be a bounded array.';
  }
  if (providers.some((provider) => !isNodeSlideProvider(provider))) {
    return 'Consent contains an unknown provider.';
  }
  if (models.some((model) => !isNodeSlideAgentModelId(model))) {
    return 'Consent contains an unknown model.';
  }
  if (hasDuplicates(providers) || hasDuplicates(models)) {
    return 'Consent provider and model lists must not contain duplicates.';
  }

  const availability = input['availability'];
  if (!Array.isArray(availability) || availability.length > MAX_ROUTE_INPUTS) {
    return 'Live availability must be a bounded array.';
  }
  const availabilityKeys = new Set<string>();
  for (const value of availability) {
    const issue = validateRouteReference(value);
    if (issue) return `Invalid live availability route: ${issue}`;
    if (!isRecord(value) || typeof value['available'] !== 'boolean') {
      return 'Each live availability record must contain an explicit boolean.';
    }
    const key = routeKey(value as unknown as NodeSlideRouteAvailability);
    if (availabilityKeys.has(key)) return 'Live availability contains a duplicate route.';
    availabilityKeys.add(key);
  }

  const fallbackPolicy = input['fallbackPolicy'];
  if (!isRecord(fallbackPolicy)) return 'Fallback policy must be explicit.';
  if (fallbackPolicy['mode'] === 'none') {
    if ('routes' in fallbackPolicy) return 'A no-fallback policy must not include routes.';
    return null;
  }
  if (fallbackPolicy['mode'] !== 'ordered') {
    return 'Fallback policy mode must be none or ordered.';
  }
  const routes = fallbackPolicy['routes'];
  if (!Array.isArray(routes) || routes.length === 0 || routes.length > MAX_ROUTE_INPUTS) {
    return 'An ordered fallback policy requires a non-empty bounded route list.';
  }
  const fallbackKeys = new Set<string>();
  for (const route of routes) {
    const issue = validateRouteReference(route);
    if (issue) return `Invalid fallback route: ${issue}`;
    const key = routeKey(route as unknown as NodeSlideRouteReference);
    if (fallbackKeys.has(key)) return 'Ordered fallback routes must not contain duplicates.';
    fallbackKeys.add(key);
  }
  return null;
}

function validateRouteReference(value: unknown): string | null {
  if (!isRecord(value)) return 'route reference must be an object.';
  const provider = value['provider'];
  const modelId = value['catalogModelId'];
  if (!isNodeSlideProvider(provider)) return 'provider is unknown.';
  if (!isNodeSlideAgentModelId(modelId)) return 'catalog model is unknown.';
  const catalog = NODESLIDE_AGENT_MODELS.find((model) => model.id === modelId);
  if (!catalog || catalog.provider !== provider) {
    return 'provider does not own the catalog model.';
  }
  return null;
}

function fallbackModeFromUnknown(input: unknown): NodeSlideFallbackReceipt['policy'] {
  if (!isRecord(input)) return 'invalid';
  const fallbackPolicy = input['fallbackPolicy'];
  if (!isRecord(fallbackPolicy)) return 'invalid';
  return fallbackPolicy['mode'] === 'none' || fallbackPolicy['mode'] === 'ordered'
    ? fallbackPolicy['mode']
    : 'invalid';
}

function isBoundedTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isNodeSlideProvider(value: unknown): value is NodeSlideExternalProvider {
  return value === 'nebius' || value === 'openrouter';
}

function hasDuplicates(values: readonly unknown[]): boolean {
  return new Set(values).size !== values.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
