import type {
  DeckComment,
  DeckSnapshot,
  ElementStyle,
  PatchOperation,
  PatchScope,
} from '../../shared/nodeslide';
import {
  deterministicAgentOperations,
  summarizePatchOperations,
  validateNodeSlidePatch,
} from './nodeslidePatches';
import {
  type NodeSlideProviderResult,
  type NodeSlideProviderTelemetry,
  callNodeSlideFreeJson,
} from './nodeslideProvider';

export const NODESLIDE_BASELINE_EDIT_ADAPTER_ID = 'nodeslide/single-shot-edit-planner' as const;
export const NODESLIDE_BASELINE_EDIT_ADAPTER_VERSION = '1.0.0' as const;

export interface NodeSlideEditPlanningRequest {
  deckId: string;
  instruction: string;
  baseDeckVersion: number;
  baseSlideVersions: Record<string, number>;
  baseElementVersions: Record<string, number>;
  scope: PatchScope;
}

export interface NodeSlideEditPlannerReceipt {
  adapterId: typeof NODESLIDE_BASELINE_EDIT_ADAPTER_ID;
  adapterVersion: typeof NODESLIDE_BASELINE_EDIT_ADAPTER_VERSION;
  origin: 'free_route' | 'deterministic_fallback';
  providerOutcome: 'accepted' | 'invalid' | 'failed';
  terminalOutcome: 'completed' | 'fallback_unavailable' | 'proposal_invalid';
  fallbackReason?: string;
  providerTelemetry?: NodeSlideProviderTelemetry;
}

export type NodeSlideEditPlanningOutcome =
  | {
      ok: true;
      operations: PatchOperation[];
      summary: string;
      receipt: NodeSlideEditPlannerReceipt;
    }
  | {
      ok: false;
      code: 'fallback_unavailable' | 'proposal_invalid';
      message: string;
      receipt: NodeSlideEditPlannerReceipt;
    };

export type NodeSlideEditProvider = (args: {
  systemPrompt: string;
  userText: string;
  maxTokens: number;
}) => Promise<NodeSlideProviderResult>;

/**
 * Existing single-shot edit planning, separated from IDs and persistence so a
 * shadow lane can receive the same immutable input without gaining write
 * authority. The provider's raw envelope never leaves this function.
 */
export async function planNodeSlideEdit(
  input: {
    snapshot: DeckSnapshot;
    scopedComment: DeckComment | null;
    request: NodeSlideEditPlanningRequest;
  },
  dependencies: { callProvider?: NodeSlideEditProvider } = {},
): Promise<NodeSlideEditPlanningOutcome> {
  // The action owns this captured snapshot/request for the duration of the
  // turn. Planning is read-only; patch validation performs its own working
  // clones. Avoid copying an entire bounded deck on the baseline hot path.
  const snapshot = input.snapshot;
  const request = input.request;
  const scopedSlideIds =
    request.scope.kind === 'deck'
      ? new Set(snapshot.deck.slideOrder)
      : new Set(request.scope.slideIds);
  const scopedElementIds = 'elementIds' in request.scope ? new Set(request.scope.elementIds) : null;
  const scopedSlides = snapshot.slides.filter((slide) => scopedSlideIds.has(slide.id));
  const scopedElements = snapshot.elements.filter(
    (element) =>
      scopedSlideIds.has(element.slideId) &&
      (!scopedElementIds || scopedElementIds.has(element.id)),
  );
  const callProvider = dependencies.callProvider ?? callNodeSlideFreeJson;
  const provider = await callProvider({
    systemPrompt:
      'You are NodeSlide\u2019s bounded edit planner. Return JSON only: {"summary":string,"operations":PatchOperation[]}. Never target IDs outside the supplied scope. Never edit locked elements. Use normalized 0..1 geometry and at most 8 operations. Do not add or remove elements.',
    userText: JSON.stringify({
      instruction: request.instruction,
      baseDeckVersion: request.baseDeckVersion,
      scope: request.scope,
      deck: {
        id: snapshot.deck.id,
        title: snapshot.deck.title,
        version: snapshot.deck.version,
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
  let providerOutcome: NodeSlideEditPlannerReceipt['providerOutcome'] = provider.ok
    ? 'invalid'
    : 'failed';
  if (provider.ok) {
    operations = parseOperations(provider.value);
    if (operations) {
      const errors = validateNodeSlidePatch(
        snapshot,
        patchInput(request, operations),
        input.scopedComment,
      );
      if (errors.length > 0) operations = null;
      else providerOutcome = 'accepted';
    }
  }

  const usedFallback = operations === null;
  const receiptBase = {
    adapterId: NODESLIDE_BASELINE_EDIT_ADAPTER_ID,
    adapterVersion: NODESLIDE_BASELINE_EDIT_ADAPTER_VERSION,
    origin: usedFallback ? ('deterministic_fallback' as const) : ('free_route' as const),
    providerOutcome,
    ...(usedFallback
      ? {
          fallbackReason: provider.ok ? 'the free response was invalid' : provider.reason,
        }
      : {}),
    ...(provider.telemetry ? { providerTelemetry: provider.telemetry } : {}),
  };

  let finalOperations: PatchOperation[];
  try {
    finalOperations =
      operations ?? deterministicAgentOperations(snapshot, request.instruction, request.scope);
  } catch (error) {
    const message =
      error instanceof Error && error.message.startsWith('The free route returned')
        ? error.message
        : 'The free route could not produce a safe scoped proposal. Retry with a smaller request or exact replacement copy in quotation marks.';
    return {
      ok: false,
      code: 'fallback_unavailable',
      message,
      receipt: { ...receiptBase, terminalOutcome: 'fallback_unavailable' },
    };
  }

  const finalErrors = validateNodeSlidePatch(
    snapshot,
    patchInput(request, finalOperations),
    input.scopedComment,
  );
  if (finalErrors.length > 0) {
    return {
      ok: false,
      code: 'proposal_invalid',
      message: `The proposed edit did not pass NodeSlide\u2019s safety checks: ${finalErrors[0]}`,
      receipt: { ...receiptBase, terminalOutcome: 'proposal_invalid' },
    };
  }

  return {
    ok: true,
    operations: finalOperations,
    summary: summarizePatchOperations(finalOperations, snapshot),
    receipt: { ...receiptBase, terminalOutcome: 'completed' },
  };
}

function patchInput(request: NodeSlideEditPlanningRequest, operations: PatchOperation[]) {
  return {
    deckId: request.deckId,
    baseDeckVersion: request.baseDeckVersion,
    baseSlideVersions: request.baseSlideVersions,
    baseElementVersions: request.baseElementVersions,
    scope: request.scope,
    operations,
  };
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
