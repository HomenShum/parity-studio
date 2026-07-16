import type {
  DeckInspection,
  InspectDeckInput,
  NodeSlideScope,
  NodeSlideWorkspace,
  OperationMode,
  ProposalReceipt,
  ProposeEditInput,
  ReviewProposalInput,
  ReviewReceipt,
} from './contracts.js';

const HOSTED_REVIEW_CONSENT = 'openrouter_nodeslide_review_context_v1';

export type ConvexCall = (
  kind: 'query' | 'mutation' | 'action',
  path: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export interface NodeSlideAgentClientOptions {
  convexUrl: string;
  ownerAccessKey: string;
  fetch?: typeof fetch;
}

export function createConvexCall(convexUrl: string, fetchImpl: typeof fetch = fetch): ConvexCall {
  const baseUrl = validateConvexUrl(convexUrl);
  return async (kind, path, args) => {
    const response = await fetchImpl(`${baseUrl}/api/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, args, format: 'json' }),
    });
    if (!response.ok) {
      throw new Error(`convex ${kind} ${path} -> HTTP ${response.status} ${response.statusText}`);
    }
    const body = (await response.json()) as {
      status?: string;
      value?: unknown;
      errorMessage?: string;
    };
    if (body.status === 'error') {
      throw new Error(`convex ${kind} ${path} -> ${body.errorMessage ?? 'unknown error'}`);
    }
    return body.value;
  };
}

export class NodeSlideAgentClient {
  readonly call: ConvexCall;
  private readonly ownerAccessKey: string;

  constructor(options: NodeSlideAgentClientOptions) {
    if (!options.ownerAccessKey.trim()) {
      throw new Error('NODESLIDE_OWNER_ACCESS_KEY is required.');
    }
    this.ownerAccessKey = options.ownerAccessKey;
    this.call = createConvexCall(options.convexUrl, options.fetch);
  }

  async getWorkspace(deckId: string): Promise<NodeSlideWorkspace> {
    const workspace = (await this.call('query', 'nodeslide:getWorkspace', {
      deckId,
      ownerAccessKey: this.ownerAccessKey,
    })) as NodeSlideWorkspace | null;
    if (!workspace) {
      throw new Error('NodeSlide deck was not found or the owner capability is invalid.');
    }
    return workspace;
  }

  async inspectDeck(input: InspectDeckInput): Promise<DeckInspection> {
    const workspace = await this.getWorkspace(input.deckId);
    const selectedSlides = workspace.deck.slideOrder
      .map((id, index) => {
        const slide = workspace.slides.find((candidate) => candidate.id === id);
        if (!slide || (input.slideId && slide.id !== input.slideId)) return null;
        return {
          ...slide,
          index: index + 1,
          elements: workspace.elements
            .filter((element) => element.slideId === slide.id)
            .map((element) => ({
              ...element,
              content: element.content?.slice(0, 2_000),
            })),
        };
      })
      .filter((slide): slide is NonNullable<typeof slide> => slide !== null);
    if (input.slideId && selectedSlides.length === 0) {
      throw new Error(`Slide ${input.slideId} was not found in deck ${input.deckId}.`);
    }
    return {
      deck: workspace.deck,
      slides: selectedSlides,
      sources: workspace.sources,
      pendingProposalCount: workspace.patches.filter((patch) => patch.status === 'ready').length,
      validation: workspace.validations.at(-1) ?? null,
      receipt: {
        operation: 'inspect_deck',
        deckId: workspace.deck.id,
        deckVersion: workspace.deck.version,
        readOnly: true,
        recordedAt: new Date().toISOString(),
      },
    };
  }

  async proposeEdit(input: ProposeEditInput): Promise<ProposalReceipt> {
    if (input.execution === 'hosted' && !input.consent) {
      throw new Error('Explicit consent is required before hosted model egress.');
    }
    const workspace = await this.getWorkspace(input.deckId);
    const scope = resolveScope(workspace, input);
    const clocks = clocksForScope(workspace, scope);
    const beforeVersion = workspace.deck.version;
    const result = await this.call('action', 'nodeslideAgent:proposeEdit', {
      deckId: input.deckId,
      ownerAccessKey: this.ownerAccessKey,
      instruction: input.instruction,
      baseDeckVersion: beforeVersion,
      ...clocks,
      scope,
      providerMode: input.execution === 'hosted' ? 'openrouter_free' : 'deterministic',
      ...(input.execution === 'hosted'
        ? {
            providerModel: input.model ?? 'z-ai/glm-5.2',
            providerConsent: HOSTED_REVIEW_CONSENT,
          }
        : {}),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    });
    return unappliedProposalReceipt(result, beforeVersion);
  }

  async acceptProposal(input: ReviewProposalInput): Promise<ReviewReceipt> {
    const { workspace, patch } = await this.bindReviewedProposal(input);
    const result = (await this.call('mutation', 'nodeslide:acceptPatch', {
      deckId: input.deckId,
      ownerAccessKey: this.ownerAccessKey,
      patchId: input.patchId,
    })) as { patch?: NodeSlideWorkspace['patches'][number]; workspace?: NodeSlideWorkspace };
    if (!result.patch || !result.workspace || result.patch.status !== 'accepted') {
      throw new Error('NodeSlide did not return a verifiable accepted proposal receipt.');
    }
    if (result.workspace.deck.version !== workspace.deck.version + 1) {
      throw new Error(
        'Governance violation: acceptance did not create exactly one new deck version.',
      );
    }
    return {
      decision: 'accepted',
      patch: result.patch,
      deckId: input.deckId,
      deckVersionBefore: workspace.deck.version,
      deckVersionAfter: result.workspace.deck.version,
      candidateDigest: patch.candidateDigest as string,
      reviewSummary: input.reviewSummary,
    };
  }

  async rejectProposal(input: ReviewProposalInput): Promise<ReviewReceipt> {
    const { workspace, patch } = await this.bindReviewedProposal(input);
    const result = (await this.call('mutation', 'nodeslide:rejectPatch', {
      deckId: input.deckId,
      ownerAccessKey: this.ownerAccessKey,
      patchId: input.patchId,
    })) as NodeSlideWorkspace['patches'][number] | null;
    const afterWorkspace = await this.getWorkspace(input.deckId);
    if (!result || result.status !== 'rejected') {
      throw new Error('NodeSlide did not return a verifiable rejected proposal receipt.');
    }
    if (afterWorkspace.deck.version !== workspace.deck.version) {
      throw new Error('Governance violation: rejecting a proposal changed the deck version.');
    }
    return {
      decision: 'rejected',
      patch: result,
      deckId: input.deckId,
      deckVersionBefore: workspace.deck.version,
      deckVersionAfter: afterWorkspace.deck.version,
      candidateDigest: patch.candidateDigest as string,
      reviewSummary: input.reviewSummary,
    };
  }

  private async bindReviewedProposal(input: ReviewProposalInput) {
    const workspace = await this.getWorkspace(input.deckId);
    const patch = workspace.patches.find((candidate) => candidate.id === input.patchId);
    if (!patch || patch.status !== 'ready') {
      throw new Error(`Proposal ${input.patchId} is not ready for review.`);
    }
    if (patch.candidateDigest !== input.expectedCandidateDigest) {
      throw new Error('The reviewed candidate digest no longer matches the stored proposal.');
    }
    if (patch.baseDeckVersion !== input.expectedBaseDeckVersion) {
      throw new Error('The reviewed base deck version no longer matches the stored proposal.');
    }
    if (workspace.deck.version !== input.expectedBaseDeckVersion) {
      throw new Error(
        'The deck changed after this proposal was created. Inspect and propose again.',
      );
    }
    return { workspace, patch };
  }
}

export function resolveScope(
  workspace: NodeSlideWorkspace,
  input: {
    scope: 'deck' | 'slide' | 'elements';
    slideId?: string;
    elementIds?: string[];
    operationMode: OperationMode;
  },
): NodeSlideScope {
  if (input.scope === 'deck') {
    return { kind: 'deck', deckId: workspace.deck.id, operationMode: input.operationMode };
  }
  const slideId = input.slideId ?? workspace.deck.slideOrder[0];
  if (!slideId || !workspace.slides.some((slide) => slide.id === slideId)) {
    throw new Error('A valid slideId is required for slide or element scope.');
  }
  if (input.scope === 'slide') {
    return {
      kind: 'slide',
      deckId: workspace.deck.id,
      slideIds: [slideId],
      operationMode: input.operationMode,
    };
  }
  const elementIds = input.elementIds ?? [];
  if (elementIds.length === 0) throw new Error('elementIds are required for element scope.');
  if (
    elementIds.some(
      (id) =>
        !workspace.elements.some((element) => element.id === id && element.slideId === slideId),
    )
  ) {
    throw new Error('Every elementId must belong to the authorized slide.');
  }
  return {
    kind: 'elements',
    deckId: workspace.deck.id,
    slideIds: [slideId],
    elementIds,
    operationMode: input.operationMode,
  };
}

export function clocksForScope(workspace: NodeSlideWorkspace, scope: NodeSlideScope) {
  const slideIds = new Set(scope.kind === 'deck' ? workspace.deck.slideOrder : scope.slideIds);
  const elementIds = scope.kind === 'elements' ? new Set(scope.elementIds) : null;
  return {
    baseSlideVersions: Object.fromEntries(
      workspace.slides
        .filter((slide) => slideIds.has(slide.id))
        .map((slide) => [slide.id, slide.version]),
    ),
    baseElementVersions: Object.fromEntries(
      workspace.elements
        .filter(
          (element) => slideIds.has(element.slideId) && (!elementIds || elementIds.has(element.id)),
        )
        .map((element) => [element.id, element.version]),
    ),
  };
}

export function unappliedProposalReceipt(result: unknown, beforeVersion: number): ProposalReceipt {
  const value = result as {
    patch?: NodeSlideWorkspace['patches'][number];
    workspace?: NodeSlideWorkspace;
  };
  const afterVersion = value.workspace?.deck.version;
  if (
    !value.patch ||
    afterVersion === undefined ||
    afterVersion !== beforeVersion ||
    value.patch.status === 'accepted'
  ) {
    throw new Error('Governance violation: proposal was not returned as verifiably unapplied.');
  }
  return {
    proposal: value.patch,
    candidateReceipt: value.patch.candidateValidation ?? null,
    applied: false,
    deckVersionBefore: beforeVersion,
    deckVersionAfter: afterVersion,
  };
}

function validateConvexUrl(value: string): string {
  const url = new URL(value);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('PARITY_CONVEX_URL must use HTTPS, except for localhost development.');
  }
  return url.toString().replace(/\/$/, '');
}
