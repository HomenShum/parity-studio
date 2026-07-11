'use node';

import { ConvexError, v } from 'convex/values';
import type {
  DeckSnapshot,
  ElementStyle,
  NodeSlideWorkspace,
  PatchOperation,
  PatchScope,
} from '../shared/nodeslide';
import { internal } from './_generated/api';
import { action } from './_generated/server';
import { createOwnerAccessKey } from './lib/nodeslideAccess';
import { nodeslideEventId, nodeslideHash, nodeslideStableId } from './lib/nodeslideIds';
import {
  deterministicAgentOperations,
  summarizePatchOperations,
  validateNodeSlidePatch,
} from './lib/nodeslidePatches';
import { callNodeSlideFreeJson } from './lib/nodeslideProvider';
import { deterministicBriefSpec } from './lib/nodeslideSeed';
import {
  nodeslideBriefValidator,
  nodeslidePatchScopeValidator,
  nodeslideVersionClockValidator,
} from './lib/nodeslideValidators';

// Generated API files are intentionally not regenerated in this lane. Convex resolves this proxy
// dynamically at runtime; the cast only bridges the pre-existing generated declaration.
// biome-ignore lint/suspicious/noExplicitAny: see comment above
const nodeslideInternal: any = (internal as any).nodeslide;

export const proposeEdit = action({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    instruction: v.string(),
    baseDeckVersion: v.number(),
    baseSlideVersions: nodeslideVersionClockValidator,
    baseElementVersions: nodeslideVersionClockValidator,
    scope: nodeslidePatchScopeValidator,
  },
  handler: async (ctx, args) => {
    const instruction = args.instruction.replace(/\s+/g, ' ').trim();
    if (!instruction) throw new Error('NodeSlide edit instruction is required.');
    if (instruction.length > 4000)
      throw new Error('NodeSlide edit instruction exceeds 4000 characters.');
    await ctx.runMutation(nodeslideInternal.consumePreviewQuota, {
      buckets: [
        {
          key: `edit:${nodeslideHash(args.ownerAccessKey)}`,
          limit: 60,
          windowMs: 86_400_000,
        },
        { key: 'edit:global', limit: 500, windowMs: 3_600_000 },
      ],
    });
    const workspace = (await ctx.runQuery(nodeslideInternal.getAgentContextInternal, {
      deckId: args.deckId,
      ownerAccessKey: args.ownerAccessKey,
    })) as NodeSlideWorkspace | null;
    if (!workspace) throw new Error(`Deck ${args.deckId} not found.`);
    if (args.scope.deckId !== args.deckId) throw new Error('Patch scope deckId mismatch.');
    const scopedCommentId = args.scope.kind === 'comment' ? args.scope.commentId : undefined;
    const scopedSlideIds =
      args.scope.kind === 'deck'
        ? new Set(workspace.deck.slideOrder)
        : new Set(args.scope.slideIds);
    const scopedElementIds = 'elementIds' in args.scope ? new Set(args.scope.elementIds) : null;
    const scopedSlides = workspace.slides.filter((slide) => scopedSlideIds.has(slide.id));
    const scopedElements = workspace.elements.filter(
      (element) =>
        scopedSlideIds.has(element.slideId) &&
        (!scopedElementIds || scopedElementIds.has(element.id)),
    );

    const provider = await callNodeSlideFreeJson({
      systemPrompt:
        'You are NodeSlide’s bounded edit planner. Return JSON only: {"summary":string,"operations":PatchOperation[]}. Never target IDs outside the supplied scope. Never edit locked elements. Use normalized 0..1 geometry and at most 8 operations. Do not add or remove elements.',
      userText: JSON.stringify({
        instruction,
        baseDeckVersion: args.baseDeckVersion,
        scope: args.scope,
        deck: {
          id: workspace.deck.id,
          title: workspace.deck.title,
          version: workspace.deck.version,
        },
        slides: scopedSlides.map((slide) => ({
          id: slide.id,
          title: slide.title,
          version: slide.version,
        })),
        elements: scopedElements.map((element) => ({
          id: element.id,
          slideId: element.slideId,
          kind: element.kind,
          role: element.role,
          content: element.content,
          bbox: element.bbox,
          style: element.style,
          locked: element.locked,
          version: element.version,
        })),
      }),
      maxTokens: 3000,
    });

    let operations: PatchOperation[] | null = null;
    if (provider.ok) {
      operations = parseOperations(provider.value);
      if (operations) {
        const comment =
          scopedCommentId !== undefined
            ? workspace.comments.find((candidate) => candidate.id === scopedCommentId)
            : null;
        const errors = validateNodeSlidePatch(
          workspace,
          {
            deckId: args.deckId,
            baseDeckVersion: args.baseDeckVersion,
            baseSlideVersions: args.baseSlideVersions,
            baseElementVersions: args.baseElementVersions,
            scope: args.scope,
            operations,
          },
          comment,
        );
        if (errors.length > 0) operations = null;
      }
    }
    const usedFallback = operations === null;
    let finalOperations: PatchOperation[];
    try {
      finalOperations =
        operations ?? deterministicAgentOperations(workspace, instruction, args.scope);
    } catch (error) {
      const message =
        error instanceof Error && error.message.startsWith('The free route returned')
          ? error.message
          : 'The free route could not produce a safe scoped proposal. Retry with a smaller request or exact replacement copy in quotation marks.';
      throw publicAgentError('fallback_unavailable', message);
    }
    const fallbackErrors = validateNodeSlidePatch(
      workspace,
      {
        deckId: args.deckId,
        baseDeckVersion: args.baseDeckVersion,
        baseSlideVersions: args.baseSlideVersions,
        baseElementVersions: args.baseElementVersions,
        scope: args.scope,
        operations: finalOperations,
      },
      scopedCommentId !== undefined
        ? workspace.comments.find((candidate) => candidate.id === scopedCommentId)
        : null,
    );
    if (fallbackErrors.length > 0) {
      throw publicAgentError(
        'proposal_invalid',
        `The proposed edit did not pass NodeSlide’s safety checks: ${fallbackErrors[0]}`,
      );
    }

    const now = Date.now();
    const patchId = nodeslideEventId('patch_agent', now, args.deckId, instruction);
    const traceId = nodeslideStableId('trace', patchId);
    // Derive the proposal label from the validated diff. Provider-authored prose can diverge
    // from its operations, so it is never used as the authoritative description of a patch.
    const summary = summarizePatchOperations(finalOperations, workspace);
    const telemetry = provider.telemetry;
    return await ctx.runMutation(nodeslideInternal.proposeAgentPatchInternal, {
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
      traceSummary: usedFallback
        ? `Deterministic fallback proposed ${finalOperations.length} scoped operation${finalOperations.length === 1 ? '' : 's'} because ${provider.ok ? 'the free response was invalid' : provider.reason}`
        : `OpenRouter free route proposed ${finalOperations.length} scoped operation${finalOperations.length === 1 ? '' : 's'} for review.`,
      toolCalls: [
        `Loaded deck ${args.deckId} at v${workspace.deck.version}`,
        'Called piAi through openrouter/openrouter/free',
        usedFallback
          ? 'Used deterministic bounded edit fallback'
          : 'Parsed and validated free-route JSON',
        'Persisted proposal and human-readable trace atomically',
      ],
      ...(telemetry
        ? {
            provider: telemetry.provider,
            model: telemetry.model,
            costMicroUsd: telemetry.costMicroUsd,
            inputTokens: telemetry.inputTokens,
            outputTokens: telemetry.outputTokens,
          }
        : { provider: 'deterministic', model: 'bounded-edit-fallback/v1' }),
    });
  },
});

export const createDeckFromBrief = action({
  args: {
    clientSessionId: v.string(),
    title: v.string(),
    brief: nodeslideBriefValidator,
    themeId: v.string(),
    route: v.union(v.literal('free'), v.literal('balanced'), v.literal('frontier')),
  },
  handler: async (ctx, args) => {
    if (args.route !== 'free') {
      throw new Error('Only the free private-preview route is available in this release.');
    }
    const clientSessionId = requiredText(args.clientSessionId, 'clientSessionId', 256);
    await ctx.runMutation(nodeslideInternal.consumePreviewQuota, {
      buckets: [
        {
          key: `create:${nodeslideHash(clientSessionId)}`,
          limit: 10,
          windowMs: 86_400_000,
        },
        { key: 'create:global', limit: 120, windowMs: 3_600_000 },
      ],
    });
    const title = args.title.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!title) throw new Error('Deck title is required.');
    const fallbackSpec = deterministicBriefSpec(title, args.brief);
    const provider = await callNodeSlideFreeJson({
      systemPrompt:
        'You are NodeSlide’s presentation strategist. Return JSON only with {title,narrative:string[],plan:string[],slides:[{title,section,headline,body,bullets:string[],metric?:string,metricLabel?:string,chart?:{labels:string[],values:number[],unit?:string}}]}. Produce 6–8 concise slides. Claims must stay grounded in the supplied brief; label illustrative evidence honestly.',
      userText: JSON.stringify({ title, brief: args.brief, requestedRoute: args.route }),
      maxTokens: 5000,
    });
    const rawSpec = provider.ok ? provider.value : fallbackSpec;
    const plan = extractPlan(provider.ok ? provider.value : null, fallbackSpec);
    const now = Date.now();
    const uniqueness = `${clientSessionId}:${title}:${now}`;
    const deckId = nodeslideEventId('deck', now, uniqueness);
    const projectId = nodeslideEventId('project_nodeslide', now, uniqueness);
    const telemetry = provider.telemetry;
    return await ctx.runMutation(nodeslideInternal.createFromBriefInternal, {
      deckId,
      projectId,
      clientSessionId,
      ownerAccessKey: createOwnerAccessKey(),
      title,
      brief: args.brief,
      themeId: args.themeId,
      route: args.route,
      plan,
      spec: rawSpec,
      traceSummary: provider.ok
        ? 'OpenRouter’s zero-cost router supplied the narrative plan; NodeSlide normalized, persisted, and validated the deck deterministically.'
        : `Deterministic brief fallback created the deck because ${provider.reason}`,
      ...(telemetry
        ? {
            provider: telemetry.provider,
            model: telemetry.model,
            costMicroUsd: telemetry.costMicroUsd,
            inputTokens: telemetry.inputTokens,
            outputTokens: telemetry.outputTokens,
          }
        : { provider: 'deterministic', model: 'brief-to-deck-fallback/v1' }),
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

function parseOperations(value: unknown): PatchOperation[] | null {
  if (!isRecord(value) || !Array.isArray(value.operations)) return null;
  const operations = value.operations.map(parseOperation);
  if (
    operations.length === 0 ||
    operations.length > 8 ||
    operations.some((item) => item === null)
  ) {
    return null;
  }
  return operations as PatchOperation[];
}

function parseOperation(value: unknown): PatchOperation | null {
  if (!isRecord(value) || typeof value.op !== 'string' || typeof value.slideId !== 'string') {
    return null;
  }
  if (
    value.op === 'move' &&
    stringField(value.elementId) &&
    finiteNumber(value.x) &&
    finiteNumber(value.y)
  ) {
    return {
      op: 'move',
      slideId: value.slideId,
      elementId: value.elementId,
      x: value.x,
      y: value.y,
    };
  }
  if (
    value.op === 'resize' &&
    stringField(value.elementId) &&
    finiteNumber(value.width) &&
    finiteNumber(value.height)
  ) {
    return {
      op: 'resize',
      slideId: value.slideId,
      elementId: value.elementId,
      width: value.width,
      height: value.height,
    };
  }
  if (
    value.op === 'replace_text' &&
    stringField(value.elementId) &&
    typeof value.text === 'string'
  ) {
    return {
      op: 'replace_text',
      slideId: value.slideId,
      elementId: value.elementId,
      text: value.text.slice(0, 4000),
    };
  }
  if (value.op === 'update_style' && stringField(value.elementId) && isRecord(value.properties)) {
    const properties = parseStyle(value.properties);
    return Object.keys(properties).length
      ? { op: 'update_style', slideId: value.slideId, elementId: value.elementId, properties }
      : null;
  }
  if (value.op === 'reorder_slide' && finiteNumber(value.index)) {
    return { op: 'reorder_slide', slideId: value.slideId, index: value.index };
  }
  if (value.op === 'update_slide' && isRecord(value.properties)) {
    const properties: { title?: string; notes?: string; background?: string } = {};
    if (typeof value.properties.title === 'string')
      properties.title = value.properties.title.slice(0, 160);
    if (typeof value.properties.notes === 'string')
      properties.notes = value.properties.notes.slice(0, 4000);
    if (typeof value.properties.background === 'string')
      properties.background = value.properties.background.slice(0, 128);
    return Object.keys(properties).length
      ? { op: 'update_slide', slideId: value.slideId, properties }
      : null;
  }
  return null;
}

function parseStyle(value: NodeSlideAgentRecord): Partial<ElementStyle> {
  const out: Partial<ElementStyle> = {};
  const stringKeys = ['fill', 'stroke', 'color', 'fontFamily', 'shadow'] as const;
  const numberKeys = [
    'strokeWidth',
    'fontSize',
    'fontWeight',
    'lineHeight',
    'letterSpacing',
    'radius',
    'opacity',
    'padding',
  ] as const;
  for (const key of stringKeys)
    if (typeof value[key] === 'string') out[key] = value[key].slice(0, 256);
  for (const key of numberKeys) if (finiteNumber(value[key])) out[key] = value[key];
  if (value.textAlign === 'left' || value.textAlign === 'center' || value.textAlign === 'right') {
    out.textAlign = value.textAlign;
  }
  if (
    value.verticalAlign === 'top' ||
    value.verticalAlign === 'middle' ||
    value.verticalAlign === 'bottom'
  ) {
    out.verticalAlign = value.verticalAlign;
  }
  return out;
}

interface NodeSlideAgentRecord extends Record<string, unknown> {
  summary?: unknown;
  plan?: unknown;
  operations?: unknown;
  op?: unknown;
  slideId?: unknown;
  elementId?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  text?: unknown;
  properties?: unknown;
  index?: unknown;
  title?: unknown;
  notes?: unknown;
  background?: unknown;
  textAlign?: unknown;
  verticalAlign?: unknown;
}

function isRecord(value: unknown): value is NodeSlideAgentRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function publicAgentError(code: 'fallback_unavailable' | 'proposal_invalid', message: string) {
  return new ConvexError({
    kind: 'nodeslide_agent' as const,
    code,
    message: message.replace(/\s+/g, ' ').trim().slice(0, 360),
  });
}

function requiredText(value: string, label: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error(`${label} is required.`);
  if (clean.length > max) throw new Error(`${label} exceeds ${max} characters.`);
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

void snapshotOf;
void (null as PatchScope | null);
