'use node';

import { ConvexError, v } from 'convex/values';
import type { DeckSnapshot, NodeSlideWorkspace, PatchOperation } from '../shared/nodeslide';
import { internal } from './_generated/api';
import { action } from './_generated/server';
import { createOwnerAccessKey, isOwnerAccessKey } from './lib/nodeslideAccess';
import {
  authorizeNodeSlideAgenticOperation,
  resolveNodeSlideAgenticControls,
} from './lib/nodeslideAgenticControls';
import { authorizeBeforeConsumingQuota, nodeSlideActorQuotaKey } from './lib/nodeslideAuthority';
import {
  nodeSlideDeckReplDefaultBudget,
  nodeSlideDeckReplInputBytes,
  nodeSlideDeckReplShadowReceipt,
  nodeSlideOperationDigest,
  nodeSlideSnapshotDigest,
  runNodeSlideDeckRepl,
} from './lib/nodeslideDeckRepl';
import {
  NODESLIDE_BASELINE_EDIT_ADAPTER_ID,
  NODESLIDE_BASELINE_EDIT_ADAPTER_VERSION,
  type NodeSlideEditPlannerReceipt,
  type NodeSlideEditPlanningRequest,
  planNodeSlideEdit,
} from './lib/nodeslideEditPlanner';
import {
  NODESLIDE_EDIT_SHADOW_ADAPTER_ID,
  NODESLIDE_EDIT_SHADOW_ADAPTER_VERSION,
  planNodeSlideEditShadow,
} from './lib/nodeslideEditShadowPlanner';
import { executionTraceFromDeckRepl } from './lib/nodeslideExecutionTrace';
import { nodeslideContentDigest, nodeslideEventId, nodeslideStableId } from './lib/nodeslideIds';
import {
  NODESLIDE_EDIT_MODEL,
  NODESLIDE_EDIT_PROVIDER,
  callNodeSlideFreeJson,
} from './lib/nodeslideProvider';
import {
  NodeSlideProviderConsentError,
  validateNodeSlideProviderChoice,
} from './lib/nodeslideProviderConsent';
import { resolveNodeSlideReadContext } from './lib/nodeslideReadContext';
import { deterministicBriefSpec } from './lib/nodeslideSeed';
import {
  type NodeSlideShadowComparison,
  type NodeSlideShadowComparisonLane,
  createNodeSlideShadowComparison,
  nodeSlideEditTurnInputDigest,
} from './lib/nodeslideShadowComparison';
import {
  invokeNodeSlideBriefProvider,
  nodeslideAgentReadReferenceValidator,
  nodeslideBriefValidator,
  nodeslideCreatePublicError,
  nodeslideDeckReplCommandValidator,
  nodeslideDesignBehaviorValidator,
  nodeslideEditorCommandIdValidator,
  nodeslidePatchScopeValidator,
  nodeslideProviderModeValidator,
  nodeslideReferenceUseValidator,
  nodeslideVersionClockValidator,
  validateNodeSlideBriefProviderChoice,
  validateNodeSlideCreateDeckFields,
  validateNodeSlidePreviewAdmission,
} from './lib/nodeslideValidators';

// Convex's generated API creates a TypeScript self-reference when this action module invokes
// functions whose declarations also include this module. Runtime arguments still cross explicit
// validators; keep the escape hatch confined to this generated function-reference proxy.
// biome-ignore lint/suspicious/noExplicitAny: generated Convex self-reference described above
const nodeslideInternal: any = (internal as any).nodeslide;

const NODESLIDE_PREVIEW_ACCESS_CODE_ENV = 'NODESLIDE_PREVIEW_ACCESS_CODE';
const NODESLIDE_PREVIEW_ADMISSION_SUBJECT_ENV = 'NODESLIDE_PREVIEW_ADMISSION_SUBJECT';

export const proposeEdit = action({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    instruction: v.string(),
    baseDeckVersion: v.number(),
    baseSlideVersions: nodeslideVersionClockValidator,
    baseElementVersions: nodeslideVersionClockValidator,
    scope: nodeslidePatchScopeValidator,
    readContext: v.optional(v.array(nodeslideAgentReadReferenceValidator)),
    designBehavior: v.optional(nodeslideDesignBehaviorValidator),
    referenceUse: v.optional(nodeslideReferenceUseValidator),
    commandId: v.optional(nodeslideEditorCommandIdValidator),
    providerMode: v.optional(nodeslideProviderModeValidator),
    providerConsent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const instruction = args.instruction.replace(/\s+/g, ' ').trim();
    if (!instruction) throw new Error('NodeSlide edit instruction is required.');
    if (instruction.length > 4000)
      throw new Error('NodeSlide edit instruction exceeds 4000 characters.');
    if ((args.commandId ?? 'edit') !== 'edit') {
      throw publicAgentError(
        'invalid_request',
        args.commandId === 'variations'
          ? 'The variations command is served by the existing NodeSlide variation authority.'
          : 'The propagation command requires an accepted parent patch.',
      );
    }
    let providerChoice: ReturnType<typeof validateNodeSlideProviderChoice>;
    try {
      providerChoice = validateNodeSlideProviderChoice(
        'propose_edit',
        args.providerMode,
        args.providerConsent,
      );
    } catch (error) {
      if (error instanceof NodeSlideProviderConsentError) {
        throw publicAgentError('invalid_request', error.message);
      }
      throw error;
    }
    const workspace = await authorizeBeforeConsumingQuota({
      authorize: async () =>
        (await ctx.runQuery(nodeslideInternal.getAgentContextInternal, {
          deckId: args.deckId,
          ownerAccessKey: args.ownerAccessKey,
        })) as NodeSlideWorkspace | null,
      consume: async () => {
        await ctx.runMutation(nodeslideInternal.consumePreviewQuota, {
          buckets: [
            {
              key: nodeSlideActorQuotaKey('edit', args.ownerAccessKey),
              limit: 60,
              windowMs: 86_400_000,
            },
            { key: 'edit:global', limit: 500, windowMs: 3_600_000 },
          ],
        });
      },
    });
    if (!workspace) throw new Error(`Deck ${args.deckId} not found.`);
    if (args.scope.deckId !== args.deckId) throw new Error('Patch scope deckId mismatch.');
    const scopedCommentId = args.scope.kind === 'comment' ? args.scope.commentId : undefined;
    const snapshot = snapshotOf(workspace);
    const readContext = resolveNodeSlideReadContext({
      workspace,
      writeScope: args.scope,
      ...(args.readContext ? { requested: args.readContext } : {}),
    });

    const request = {
      deckId: args.deckId,
      instruction,
      baseDeckVersion: args.baseDeckVersion,
      baseSlideVersions: args.baseSlideVersions,
      baseElementVersions: args.baseElementVersions,
      scope: args.scope,
      designBehavior: args.designBehavior ?? 'preserve',
      referenceUse: args.referenceUse ?? 'context_only',
      providerMode: providerChoice.providerMode,
    };
    const planningStartedAt = Date.now();
    const baseline = await planNodeSlideEdit({
      snapshot,
      scopedComment:
        scopedCommentId === undefined
          ? null
          : (workspace.comments.find((candidate) => candidate.id === scopedCommentId) ?? null),
      readContext,
      request,
    });

    const baselineElapsedMs = boundedLaneElapsed(Date.now() - planningStartedAt);
    if (!baseline.ok) throw publicAgentError(baseline.code, baseline.message);
    const finalOperations = baseline.operations;
    const summary = baseline.summary;
    const providerRequested = providerChoice.providerMode === 'openrouter_free';
    const usedFallback = providerRequested && baseline.receipt.origin === 'deterministic_fallback';
    const telemetry = baseline.receipt.providerTelemetry;
    const traceAttribution = telemetry
      ? {
          provider: telemetry.provider,
          model: usedFallback
            ? `${NODESLIDE_EDIT_MODEL} (deterministic fallback)`
            : telemetry.model,
          costMicroUsd: telemetry.costMicroUsd,
          inputTokens: telemetry.inputTokens,
          outputTokens: telemetry.outputTokens,
        }
      : providerRequested
        ? {
            provider: NODESLIDE_EDIT_PROVIDER,
            model: `${NODESLIDE_EDIT_MODEL} (deterministic fallback)`,
          }
        : { provider: 'deterministic', model: 'bounded-edit-planner/v1' };
    const shadowAuthorization = authorizeNodeSlideAgenticOperation(
      resolveNodeSlideAgenticControls(process.env),
      { operation: 'deck_repl_shadow' },
    );
    const shadowBinding = shadowAuthorization.allowed
      ? {
          planningInputDigest: nodeSlideEditTurnInputDigest(request),
          planningSnapshotDigest: nodeSlideSnapshotDigest(snapshot),
        }
      : null;
    const now = Date.now();
    const patchId = nodeslideEventId('patch_agent', now, args.deckId, instruction);
    const traceId = nodeslideStableId('trace', patchId);
    const shadowComparison = shadowBinding
      ? buildEditShadowComparisonBestEffort({
          deckId: args.deckId,
          ownerAccessKey: args.ownerAccessKey,
          patchId,
          traceId,
          turnId: nodeslideStableId('turn', patchId),
          snapshot,
          request,
          planningInputDigest: shadowBinding.planningInputDigest,
          planningSnapshotDigest: shadowBinding.planningSnapshotDigest,
          controlsDigest: shadowAuthorization.controlsDigest,
          baselineOperations: finalOperations,
          baselineReceipt: baseline.receipt,
          baselineElapsedMs,
          createdAt: planningStartedAt,
        })
      : null;
    const proposal = await ctx.runMutation(nodeslideInternal.proposeAgentPatchInternal, {
      id: patchId,
      traceId,
      deckId: args.deckId,
      ownerAccessKey: args.ownerAccessKey,
      baseDeckVersion: args.baseDeckVersion,
      baseSlideVersions: args.baseSlideVersions,
      baseElementVersions: args.baseElementVersions,
      scope: args.scope,
      operations: finalOperations,
      source: 'agent',
      summary,
      ...(scopedCommentId !== undefined ? { linkedCommentId: scopedCommentId } : {}),
      instruction,
      shadowComparisonRequested: shadowAuthorization.allowed,
      ...(shadowBinding
        ? {
            ...shadowBinding,
            shadowControlsDigest: shadowAuthorization.controlsDigest,
          }
        : {}),
      ...(shadowComparison ? { shadowComparison } : {}),
      traceSummary: usedFallback
        ? `Deterministic fallback proposed ${finalOperations.length} scoped operation${finalOperations.length === 1 ? '' : 's'} because ${baseline.receipt.fallbackReason ?? 'the GLM 5.2 response was invalid'}`
        : providerRequested
          ? `OpenRouter GLM 5.2 proposed ${finalOperations.length} scoped operation${finalOperations.length === 1 ? '' : 's'} for review.`
          : `Deterministic local planning proposed ${finalOperations.length} scoped operation${finalOperations.length === 1 ? '' : 's'} without provider egress.`,
      toolCalls: [
        `Loaded deck ${args.deckId} at v${workspace.deck.version}`,
        providerRequested
          ? 'Called GLM 5.2 through the maintained pi-ai OpenRouter provider after exact edit consent'
          : 'Kept review context on the deterministic local route',
        providerRequested
          ? usedFallback
            ? 'Used deterministic bounded edit fallback'
            : 'Parsed and validated GLM 5.2 JSON'
          : 'Produced deterministic bounded edit operations',
        'Persisted proposal and human-readable trace atomically',
      ],
      ...traceAttribution,
    });
    return proposal;
  },
});

function buildEditShadowComparisonBestEffort(args: {
  deckId: string;
  ownerAccessKey: string;
  patchId: string;
  traceId: string;
  turnId: string;
  snapshot: DeckSnapshot;
  request: NodeSlideEditPlanningRequest;
  planningInputDigest: string;
  planningSnapshotDigest: string;
  controlsDigest: string;
  baselineOperations: PatchOperation[];
  baselineReceipt: NodeSlideEditPlannerReceipt;
  baselineElapsedMs: number;
  createdAt: number;
}): NodeSlideShadowComparison | null {
  try {
    const candidateStartedAt = Date.now();
    let candidate: NodeSlideShadowComparisonLane;
    try {
      const plan = planNodeSlideEditShadow({
        snapshot: args.snapshot,
        instruction: args.request.instruction,
        deckId: args.request.deckId,
        baseDeckVersion: args.request.baseDeckVersion,
        baseSlideVersions: args.request.baseSlideVersions,
        baseElementVersions: args.request.baseElementVersions,
        scope: args.request.scope,
      });
      if (plan.outcome === 'skipped') {
        candidate = {
          adapterId: plan.adapterId,
          adapterVersion: plan.adapterVersion,
          outcome: plan.reason === 'planner_error' ? 'failed' : 'skipped',
          terminalReason:
            plan.reason === 'planner_error' ? 'planner_error' : `skipped_${plan.reason}`,
          operationCount: 0,
          elapsedMs: boundedLaneElapsed(Date.now() - candidateStartedAt),
        };
      } else {
        const result = runNodeSlideDeckRepl({
          sessionId: nodeslideStableId('session_shadow', args.turnId),
          traceId: nodeslideStableId('trace_shadow', args.patchId),
          snapshot: args.snapshot,
          expectedSnapshotDigest: args.planningSnapshotDigest,
          commands: [plan.command],
          budget: {
            maxSteps: 1,
            maxInputBytes: 64_000,
            maxOutputBytes: 16_000,
            maxOperations: 8,
            maxWallTimeMs: 2_000,
          },
        });
        const proposal =
          result.status === 'completed' && result.proposals.length === 1
            ? result.proposals[0]
            : null;
        candidate = proposal
          ? {
              adapterId: NODESLIDE_EDIT_SHADOW_ADAPTER_ID,
              adapterVersion: NODESLIDE_EDIT_SHADOW_ADAPTER_VERSION,
              outcome: 'proposed',
              terminalReason: 'completed',
              proposalDigest: proposal.operationDigest,
              operationCount: proposal.operations.length,
              elapsedMs: boundedLaneElapsed(Date.now() - candidateStartedAt),
            }
          : {
              adapterId: NODESLIDE_EDIT_SHADOW_ADAPTER_ID,
              adapterVersion: NODESLIDE_EDIT_SHADOW_ADAPTER_VERSION,
              outcome: 'stopped',
              terminalReason:
                result.terminalReason === 'completed' ? 'no_proposal' : result.terminalReason,
              operationCount: 0,
              elapsedMs: boundedLaneElapsed(Date.now() - candidateStartedAt),
            };
      }
    } catch {
      candidate = {
        adapterId: NODESLIDE_EDIT_SHADOW_ADAPTER_ID,
        adapterVersion: NODESLIDE_EDIT_SHADOW_ADAPTER_VERSION,
        outcome: 'failed',
        terminalReason: 'executor_error',
        operationCount: 0,
        elapsedMs: boundedLaneElapsed(Date.now() - candidateStartedAt),
      };
    }

    return createNodeSlideShadowComparison({
      id: nodeslideStableId('shadow_comparison', args.patchId),
      deckId: args.deckId,
      actorSubject: args.ownerAccessKey,
      turnId: args.turnId,
      baselinePatchId: args.patchId,
      baselineTraceId: args.traceId,
      turnInputDigest: args.planningInputDigest,
      baseSnapshotDigest: args.planningSnapshotDigest,
      baseDeckVersion: args.request.baseDeckVersion,
      controlsDigest: args.controlsDigest,
      baseline: {
        adapterId: NODESLIDE_BASELINE_EDIT_ADAPTER_ID,
        adapterVersion: NODESLIDE_BASELINE_EDIT_ADAPTER_VERSION,
        origin: args.baselineReceipt.origin,
        outcome: 'proposed',
        terminalReason: 'completed',
        proposalDigest: nodeSlideOperationDigest(args.baselineOperations),
        operationCount: args.baselineOperations.length,
        elapsedMs: args.baselineElapsedMs,
      },
      candidate,
      createdAt: args.createdAt,
      completedAt: Date.now(),
    });
  } catch {
    return null;
  }
}

function boundedLaneElapsed(value: number): number {
  if (!Number.isFinite(value)) return 300_000;
  return Math.min(300_000, Math.max(0, Math.round(value)));
}

/**
 * Private-preview probe for the provider-neutral Deck REPL. Candidate operations
 * stay server-side; the caller receives only an opaque, non-committing receipt.
 */
export const runDeckReplShadow = action({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    sessionId: v.string(),
    expectedSnapshotDigest: v.optional(v.string()),
    commands: v.array(nodeslideDeckReplCommandValidator),
  },
  handler: async (ctx, args) => {
    const controls = resolveNodeSlideAgenticControls(process.env);
    const authorization = authorizeNodeSlideAgenticOperation(controls, {
      operation: 'deck_repl_shadow',
    });
    if (!authorization.allowed) {
      throw publicAgentError(
        'feature_disabled',
        'The bounded agentic shadow path is not enabled for this deployment.',
      );
    }
    const deckId = requiredShadowText(args.deckId, 'deckId', 256, 512);
    const ownerAccessKey = args.ownerAccessKey;
    if (!isOwnerAccessKey(ownerAccessKey)) {
      throw publicAgentError('invalid_request', 'Deck is unavailable.');
    }
    const sessionId = requiredShadowText(args.sessionId, 'sessionId', 160, 320);
    const expectedSnapshotDigest = args.expectedSnapshotDigest;
    if (
      expectedSnapshotDigest !== undefined &&
      !/^snap_sha256:[0-9a-f]{64}$/.test(expectedSnapshotDigest)
    ) {
      throw publicAgentError('invalid_request', 'Expected snapshot digest is invalid.');
    }
    const shadowBudget = nodeSlideDeckReplDefaultBudget();
    if (args.commands.length > shadowBudget.maxSteps) {
      throw publicAgentError(
        'invalid_request',
        `Deck REPL shadow probes support at most ${shadowBudget.maxSteps} semantic commands.`,
      );
    }
    if (nodeSlideDeckReplInputBytes(args.commands) > shadowBudget.maxInputBytes) {
      throw publicAgentError(
        'invalid_request',
        'Deck REPL shadow probe commands exceed the input-size budget.',
      );
    }
    const workspace = (await ctx.runQuery(nodeslideInternal.getAgentContextInternal, {
      deckId,
      ownerAccessKey,
    })) as NodeSlideWorkspace | null;
    if (!workspace) throw publicAgentError('invalid_request', 'Deck is unavailable.');
    await ctx.runMutation(nodeslideInternal.consumePreviewQuota, {
      buckets: [
        {
          key: `deck-repl:${nodeslideContentDigest(ownerAccessKey)}`,
          limit: 120,
          windowMs: 86_400_000,
        },
        { key: 'deck-repl:global', limit: 1_000, windowMs: 3_600_000 },
      ],
    });
    const snapshot: DeckSnapshot = {
      deck: structuredClone(workspace.deck),
      slides: structuredClone(workspace.slides),
      elements: structuredClone(workspace.elements),
      sources: structuredClone(workspace.sources),
    };
    const now = Date.now();
    const traceId = nodeslideEventId('trace_deck_repl', now, deckId, sessionId);
    const result = runNodeSlideDeckRepl({
      sessionId,
      traceId,
      snapshot,
      ...(expectedSnapshotDigest ? { expectedSnapshotDigest } : {}),
      commands: args.commands,
    });
    const trace = executionTraceFromDeckRepl({
      result,
      deckId,
      actorSubject: ownerAccessKey,
      createdAt: now,
      adapterId: 'nodeslide/deck-repl-shadow-probe',
      cohort: 'private-preview-shadow',
      controlsDigest: authorization.controlsDigest,
    });
    await ctx.runMutation(nodeslideInternal.persistExecutionTraceInternal, {
      deckId,
      ownerAccessKey,
      trace,
    });
    return nodeSlideDeckReplShadowReceipt(result);
  },
});

export const createDeckFromBrief = action({
  args: {
    accessCode: v.optional(v.string()),
    clientSessionId: v.string(),
    title: v.string(),
    brief: nodeslideBriefValidator,
    themeId: v.string(),
    route: v.union(v.literal('free'), v.literal('balanced'), v.literal('frontier')),
    providerMode: v.optional(v.string()),
    providerConsent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admissionQuotaSubject = await validateNodeSlidePreviewAdmission({
      providedAccessCode: args.accessCode,
      expectedAccessCode: process.env[NODESLIDE_PREVIEW_ACCESS_CODE_ENV],
      admissionSubject: process.env[NODESLIDE_PREVIEW_ADMISSION_SUBJECT_ENV],
    });
    if (args.route !== 'free') {
      throw nodeslideCreatePublicError(
        'invalid_request',
        'Only the free private-preview route is available in this release.',
      );
    }
    const providerChoice = validateNodeSlideBriefProviderChoice(
      args.providerMode,
      args.providerConsent,
    );
    const { title, brief } = validateNodeSlideCreateDeckFields({
      title: args.title,
      brief: args.brief,
    });
    const clientSessionId = requiredCreateText(args.clientSessionId, 'clientSessionId', 256, 768);
    const themeId = requiredCreateText(args.themeId, 'themeId', 128, 256);
    const quotaResult = (await ctx.runMutation(nodeslideInternal.consumePreviewQuotaResult, {
      buckets: [
        {
          key: `create:${admissionQuotaSubject}`,
          limit: 10,
          windowMs: 86_400_000,
        },
        { key: 'create:global', limit: 120, windowMs: 3_600_000 },
      ],
    })) as { ok: boolean; reason?: 'quota_exceeded' };
    if (!quotaResult.ok) {
      throw nodeslideCreatePublicError(
        'quota_exceeded',
        'NodeSlide private-preview creation quota reached. Try again after the current window.',
      );
    }

    const fallbackSpec = deterministicBriefSpec(title, brief);
    const provider = await invokeNodeSlideBriefProvider(providerChoice, async () =>
      callNodeSlideFreeJson({
        systemPrompt:
          'You are NodeSlide’s presentation strategist. Return JSON only with {title,narrative:string[],plan:string[],slides:[{title,section,headline,body,bullets:string[],metric?:string,metricLabel?:string,chart?:{labels:string[],values:number[],unit?:string},formula?:{expression:string,display:string,syntax?:"plain"|"latex",description?:string,variables:{label:string,value:number,unit?:string}[]},image?:{url?:string,altText:string,credit?:string,caption?:string},video?:{url:string,posterUrl?:string,title?:string,captionsUrl?:string,captionsLanguage?:string,startAtSeconds?:number,endAtSeconds?:number}}]}. Produce 6–8 concise slides with at least one data-bound chart, one first-class formula, and one sourced or explicitly illustrative image. Use at most one primary chart, formula, image, or video on a slide. Emit structured primitive objects rather than merely claiming they exist in prose. Formula expression must be machine-readable and display presentation-ready. If no licensed image asset is supplied, emit image metadata without an image URL so NodeSlide creates an honest replace-image placeholder. Claims must stay grounded in the supplied brief; label illustrative evidence honestly.',
        userText: JSON.stringify({
          title,
          brief,
          requestedRoute: args.route,
          providerMode: providerChoice.providerMode,
        }),
        maxTokens: 5000,
        jsonSchema: {
          name: 'nodeslide_deck_spec',
          schema: {
            type: 'object',
            required: ['title', 'narrative', 'plan', 'slides'],
            properties: {
              title: { type: 'string' },
              narrative: { type: 'array', items: { type: 'string' } },
              plan: { type: 'array', items: { type: 'string' } },
              slides: {
                type: 'array',
                minItems: 6,
                maxItems: 8,
                items: {
                  type: 'object',
                  required: ['title', 'section', 'headline', 'body', 'bullets'],
                  properties: {
                    title: { type: 'string' },
                    section: { type: 'string' },
                    headline: { type: 'string' },
                    body: { type: 'string' },
                    bullets: { type: 'array', items: { type: 'string' }, maxItems: 3 },
                    metric: { type: 'string' },
                    metricLabel: { type: 'string' },
                    chart: {
                      type: 'object',
                      required: ['labels', 'values'],
                      properties: {
                        labels: { type: 'array', items: { type: 'string' } },
                        values: { type: 'array', items: { type: 'number' } },
                        unit: { type: 'string' },
                      },
                    },
                    formula: {
                      type: 'object',
                      required: ['expression', 'display', 'variables'],
                      properties: {
                        expression: { type: 'string' },
                        display: { type: 'string' },
                        variables: {
                          type: 'array',
                          items: {
                            type: 'object',
                            required: ['label', 'value'],
                            properties: {
                              label: { type: 'string' },
                              value: { type: 'number' },
                              unit: { type: 'string' },
                            },
                          },
                        },
                      },
                    },
                    image: {
                      type: 'object',
                      required: ['altText', 'credit'],
                      properties: {
                        altText: { type: 'string' },
                        credit: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    );
    const rawSpec = provider?.ok === true ? provider.value : fallbackSpec;
    const plan = extractPlan(provider?.ok === true ? provider.value : null, fallbackSpec);
    const now = Date.now();
    const uniqueness = `${clientSessionId}:${title}:${now}`;
    const deckId = nodeslideEventId('deck', now, uniqueness);
    const projectId = nodeslideEventId('project_nodeslide', now, uniqueness);
    const telemetry = provider?.telemetry;
    const providerSucceeded = provider?.ok === true;
    const traceSummary =
      providerChoice.providerMode === 'deterministic'
        ? 'NodeSlide created the deck with its deterministic brief generator. The brief was not sent to OpenRouter.'
        : providerSucceeded
          ? 'The user consented to send the full brief to OpenRouter. The named GLM 5.2 model supplied the narrative plan through pi-ai; NodeSlide normalized, persisted, and validated the deck deterministically.'
          : `The user consented to send the full brief to OpenRouter. NodeSlide used its deterministic fallback because ${provider?.ok === false ? provider.reason : 'the GLM 5.2 route was unavailable.'}`;
    return await ctx.runMutation(nodeslideInternal.createFromBriefInternal, {
      deckId,
      projectId,
      clientSessionId,
      ownerAccessKey: createOwnerAccessKey(),
      title,
      brief,
      themeId,
      route: args.route,
      plan,
      spec: rawSpec,
      traceSummary,
      ...(providerSucceeded && telemetry
        ? {
            provider: telemetry.provider,
            model: telemetry.model,
            costMicroUsd: telemetry.costMicroUsd,
            inputTokens: telemetry.inputTokens,
            outputTokens: telemetry.outputTokens,
          }
        : providerChoice.providerMode === 'deterministic'
          ? { provider: 'deterministic', model: 'brief-to-deck/v1' }
          : {
              provider: NODESLIDE_EDIT_PROVIDER,
              model: `${NODESLIDE_EDIT_MODEL} (deterministic fallback)`,
              ...(telemetry
                ? {
                    costMicroUsd: telemetry.costMicroUsd,
                    inputTokens: telemetry.inputTokens,
                    outputTokens: telemetry.outputTokens,
                  }
                : {}),
            }),
    });
  },
});

function extractPlan(
  value: unknown,
  fallback: ReturnType<typeof deterministicBriefSpec>,
): string[] {
  if (isRecord(value) && Array.isArray(value.plan)) {
    const plan = value.plan
      .filter((step): step is string => typeof step === 'string')
      .map((step) => step.replace(/\s+/g, ' ').trim().slice(0, 220))
      .filter(Boolean)
      .slice(0, 12);
    if (plan.length >= 3) return plan;
  }
  return fallback.slides.map((slide, index) => `${index + 1}. ${slide.section}: ${slide.headline}`);
}

interface NodeSlideAgentRecord extends Record<string, unknown> {
  plan?: unknown;
}

function isRecord(value: unknown): value is NodeSlideAgentRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function publicAgentError(
  code: 'fallback_unavailable' | 'proposal_invalid' | 'invalid_request' | 'feature_disabled',
  message: string,
) {
  return new ConvexError({
    kind: 'nodeslide_agent' as const,
    code,
    message: message.replace(/\s+/g, ' ').trim().slice(0, 360),
  });
}

function requiredCreateText(
  value: string,
  label: string,
  maxCharacters: number,
  maxBytes: number,
): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) throw nodeslideCreatePublicError('invalid_request', `${label} is required.`);
  if (
    Array.from(value).length > maxCharacters ||
    new TextEncoder().encode(value).byteLength > maxBytes
  ) {
    throw nodeslideCreatePublicError(
      'invalid_request',
      `${label} exceeds the private-preview size limit.`,
    );
  }
  return clean;
}

function requiredShadowText(
  value: string,
  label: string,
  maxCharacters: number,
  maxBytes: number,
): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (
    !clean ||
    Array.from(value).length > maxCharacters ||
    new TextEncoder().encode(value).byteLength > maxBytes
  ) {
    throw publicAgentError('invalid_request', `${label} is invalid.`);
  }
  return clean;
}

function snapshotOf(workspace: NodeSlideWorkspace): DeckSnapshot {
  return {
    deck: workspace.deck,
    slides: workspace.slides,
    elements: workspace.elements,
    sources: workspace.sources,
  };
}
