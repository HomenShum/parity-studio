import {
  type NodeSlideAgentModelId,
  type NodeSlideProviderMode,
  type NodeSlideReasoningEffort,
  isNodeSlideAgentModelId,
  isNodeSlideReasoningEffort,
  nodeSlideAgentModel,
  nodeSlideDefaultModelForProviderMode,
} from '../../shared/nodeslide';
import { NODESLIDE_RUN_BUDGET_BOUNDS } from '../../shared/nodeslideRunBudget';
import {
  type NODESLIDE_ROUTING_POLICY_VERSION,
  type NodeSlideRouteAvailability,
  type NodeSlideRoutingDecision,
  decideNodeSlideAutoRoute,
} from './nodeslideRoutingPolicy';

/** Availability signals older than this never authorize a route. */
export const NODESLIDE_ROUTE_AVAILABILITY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Bounded read: at most this many recent trace outcomes feed availability. */
export const NODESLIDE_ROUTE_SIGNAL_LIMIT = 100;
const FALLBACK_TAG = ' (deterministic fallback)';
const ROUTING_REASON_LIMIT = 6;
const CREATE_OUTPUT_TOKEN_ESTIMATE = 8_192;
const CREATE_INPUT_TOKEN_OVERHEAD = 2_048;

/**
 * One provider outcome observed on the live path. `ok=false` includes runs the
 * budgeted provider tagged as deterministic fallback: the external route was
 * requested and did not deliver, which is a genuine unavailability signal.
 */
export interface NodeSlideRouteOutcomeSignal {
  provider: string;
  model: string;
  ok: boolean;
  at: number;
}

export interface NodeSlideJobRoutingReceipt {
  policyVersion: typeof NODESLIDE_ROUTING_POLICY_VERSION;
  /**
   * advisory_v1: the receipt reports the decision; dispatch was unchanged.
   * enforced_v1: the runner acted on a refusal and executed deterministically.
   * A receipt may never claim enforcement the runtime did not perform.
   */
  enforcement: 'advisory_v1' | 'enforced_v1';
  decidedAt: number;
  task: 'create_deck_from_brief';
  requested:
    | { mode: 'deterministic' }
    /** `model` is always a catalog id at construction; typed string to match persistence. */
    | { mode: Exclude<NodeSlideProviderMode, 'deterministic'>; model: string };
  decision:
    | {
        kind: 'selected';
        provider: string;
        modelId: string;
        estimatedMicroUsd: number | null;
        pricingSource: string | null;
      }
    | { kind: 'refused'; code: string; message: string };
  availabilityBasis: { windowMs: number; signalCount: number };
  reasons: string[];
}

/**
 * Fail-closed availability from observed outcomes: for each route the newest
 * in-window signal wins; routes with no signal get NO record (the routing
 * policy treats missing records as unavailable — never fabricate a probe).
 */
export function deriveNodeSlideRouteAvailability(
  signals: readonly NodeSlideRouteOutcomeSignal[],
  now: number,
  windowMs: number = NODESLIDE_ROUTE_AVAILABILITY_WINDOW_MS,
): NodeSlideRouteAvailability[] {
  const newestByRoute = new Map<string, { record: NodeSlideRouteAvailability; at: number }>();
  for (const signal of signals.slice(0, NODESLIDE_ROUTE_SIGNAL_LIMIT)) {
    if (now - signal.at > windowMs || signal.at > now) continue;
    const model = signal.model.endsWith(FALLBACK_TAG)
      ? signal.model.slice(0, -FALLBACK_TAG.length)
      : signal.model;
    if (!isNodeSlideAgentModelId(model)) continue;
    const provider = nodeSlideAgentModel(model).provider;
    if (signal.provider !== provider && signal.provider !== 'deterministic') continue;
    const available = signal.ok && !signal.model.endsWith(FALLBACK_TAG);
    const key = `${provider}::${model}`;
    const existing = newestByRoute.get(key);
    if (!existing || signal.at > existing.at) {
      newestByRoute.set(key, {
        record: { provider, catalogModelId: model, available },
        at: signal.at,
      });
    }
  }
  return [...newestByRoute.values()].map((entry) => entry.record);
}

export function buildNodeSlideCreateRoutingReceipt(args: {
  providerMode: string | undefined;
  providerModel: string | undefined;
  providerEffort: string | undefined;
  briefCharacters: number;
  attachmentCharacters: number;
  signals: readonly NodeSlideRouteOutcomeSignal[];
  now: number;
}): NodeSlideJobRoutingReceipt {
  const mode: NodeSlideProviderMode =
    args.providerMode === 'openrouter_free' || args.providerMode === 'nebius'
      ? args.providerMode
      : 'deterministic';
  const availability = deriveNodeSlideRouteAvailability(args.signals, args.now);
  const requested =
    mode === 'deterministic'
      ? ({ mode: 'deterministic' } as const)
      : ({
          mode,
          model: isNodeSlideAgentModelId(args.providerModel)
            ? args.providerModel
            : nodeSlideDefaultModelForProviderMode(mode),
        } as const);
  const effort: NodeSlideReasoningEffort | null = isNodeSlideReasoningEffort(args.providerEffort)
    ? args.providerEffort
    : null;
  const decision = decideNodeSlideAutoRoute({
    task: 'create_deck_from_brief',
    // Brief-to-deck runs on any catalog route (the deterministic builder included),
    // so no external-only capability may be demanded here.
    capabilities: { web: false, longContext: false, image: false, reasoning: false },
    privacy: requested.mode === 'deterministic' ? 'deterministic_only' : 'external_if_consented',
    requestedReasoningEffort: requested.mode === 'deterministic' ? null : effort,
    deterministicAvailable: true,
    consent:
      requested.mode === 'deterministic'
        ? { providers: [], models: [] }
        : {
            providers: [nodeSlideAgentModel(requested.model as NodeSlideAgentModelId).provider],
            models: [requested.model as NodeSlideAgentModelId],
          },
    availability,
    expectedInputTokens: Math.min(
      NODESLIDE_RUN_BUDGET_BOUNDS.maxInputTokens.default,
      Math.ceil((args.briefCharacters + args.attachmentCharacters) / 4) +
        CREATE_INPUT_TOKEN_OVERHEAD,
    ),
    expectedOutputTokens: CREATE_OUTPUT_TOKEN_ESTIMATE,
    maxUsd: NODESLIDE_RUN_BUDGET_BOUNDS.maxCostUsd.default,
    fallbackPolicy: { mode: 'none' },
  });
  return {
    policyVersion: decision.policyVersion,
    enforcement: 'advisory_v1',
    decidedAt: args.now,
    task: 'create_deck_from_brief',
    requested,
    decision: routingDecisionSummary(decision),
    availabilityBasis: {
      windowMs: NODESLIDE_ROUTE_AVAILABILITY_WINDOW_MS,
      signalCount: availability.length,
    },
    reasons: decision.reasons.slice(0, ROUTING_REASON_LIMIT).map((reason) => reason.slice(0, 200)),
  };
}

/**
 * D7 enforcement: when the admission-time routing decision REFUSED the requested
 * external route (no fresh availability signal, cost cap, unsupported effort…),
 * the run executes deterministically instead of dispatching a doomed external
 * call. Deterministic requests and selected routes pass through untouched.
 */
export function resolveNodeSlideEnforcedCreateRequest<
  T extends {
    providerMode?: string;
    providerModel?: string;
    providerEffort?: string;
    providerConsent?: string;
  },
>(
  receipt: Pick<NodeSlideJobRoutingReceipt, 'requested' | 'decision'> | undefined,
  request: T,
): { request: T; enforced: boolean; reason?: string } {
  if (!receipt || receipt.requested.mode === 'deterministic') {
    return { request, enforced: false };
  }
  if (receipt.decision.kind === 'selected') return { request, enforced: false };
  const {
    providerMode: _mode,
    providerModel: _model,
    providerEffort: _effort,
    providerConsent: _consent,
    ...rest
  } = request;
  return {
    request: { ...rest, providerMode: 'deterministic' } as T,
    enforced: true,
    reason: `${receipt.decision.code}: ${receipt.decision.message}`.slice(0, 300),
  };
}

function routingDecisionSummary(
  decision: NodeSlideRoutingDecision,
): NodeSlideJobRoutingReceipt['decision'] {
  if (decision.kind === 'selected') {
    const estimate = decision.costEstimate;
    return {
      kind: 'selected',
      provider: decision.route.provider,
      modelId: decision.route.modelId,
      estimatedMicroUsd:
        estimate.status === 'estimated' ? Math.round(estimate.totalMicroUsd) : null,
      pricingSource: estimate.status === 'estimated' ? estimate.pricing.source : null,
    };
  }
  return {
    kind: 'refused',
    code: decision.refusal.code,
    message: decision.refusal.message.slice(0, 300),
  };
}
