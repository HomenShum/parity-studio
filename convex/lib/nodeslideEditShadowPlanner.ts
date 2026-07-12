import type {
  DeckSnapshot,
  ElementStyle,
  PatchOperation,
  PatchScope,
  SlideElement,
} from '../../shared/nodeslide';
import type { NodeSlideDeckReplCommand } from './nodeslideDeckRepl';

export const NODESLIDE_EDIT_SHADOW_ADAPTER_ID = 'nodeslide/deterministic-edit-shadow' as const;
export const NODESLIDE_EDIT_SHADOW_ADAPTER_VERSION = '1.0.0' as const;

export type NodeSlideEditShadowSkipReason =
  | 'unsupported_scope'
  | 'unsupported_instruction'
  | 'no_eligible_target'
  | 'no_safe_change'
  | 'planner_error';

export type NodeSlideEditShadowPlan =
  | {
      outcome: 'ready';
      adapterId: typeof NODESLIDE_EDIT_SHADOW_ADAPTER_ID;
      adapterVersion: typeof NODESLIDE_EDIT_SHADOW_ADAPTER_VERSION;
      command: Extract<NodeSlideDeckReplCommand, { type: 'propose_patch' }>;
    }
  | {
      outcome: 'skipped';
      adapterId: typeof NODESLIDE_EDIT_SHADOW_ADAPTER_ID;
      adapterVersion: typeof NODESLIDE_EDIT_SHADOW_ADAPTER_VERSION;
      reason: NodeSlideEditShadowSkipReason;
    };

/**
 * Conservative planner used only for paired R1 evidence. It intentionally does
 * not import the baseline provider/fallback planner and cannot persist or
 * commit. Unsupported intent is an explicit skip rather than a guessed edit.
 */
export function planNodeSlideEditShadow(args: {
  snapshot: DeckSnapshot;
  instruction: string;
  deckId: string;
  baseDeckVersion: number;
  baseSlideVersions: Record<string, number>;
  baseElementVersions: Record<string, number>;
  scope: PatchScope;
}): NodeSlideEditShadowPlan {
  try {
    const snapshot = args.snapshot;
    const scope = structuredClone(args.scope);
    if (args.deckId !== snapshot.deck.id || scope.deckId !== args.deckId) {
      return skipped('planner_error');
    }
    if (scope.kind === 'comment') return skipped('unsupported_scope');
    const eligible = eligibleElements(snapshot, scope);
    if (eligible.length === 0) return skipped('no_eligible_target');
    const mode = resolveMode(scope.operationMode, args.instruction);
    if (!mode) return skipped('unsupported_instruction');

    const operation =
      mode === 'copy'
        ? planCopy(eligible, args.instruction)
        : mode === 'style'
          ? planStyle(snapshot, eligible)
          : planLayout(eligible, args.instruction);
    if (!operation) return skipped('no_safe_change');

    return {
      outcome: 'ready',
      adapterId: NODESLIDE_EDIT_SHADOW_ADAPTER_ID,
      adapterVersion: NODESLIDE_EDIT_SHADOW_ADAPTER_VERSION,
      command: {
        id: 'edit-shadow-proposal',
        type: 'propose_patch',
        baseDeckVersion: args.baseDeckVersion,
        baseSlideVersions: structuredClone(args.baseSlideVersions),
        baseElementVersions: structuredClone(args.baseElementVersions),
        scope,
        operations: [operation],
      },
    };
  } catch {
    return skipped('planner_error');
  }
}

function skipped(reason: NodeSlideEditShadowSkipReason): NodeSlideEditShadowPlan {
  return {
    outcome: 'skipped',
    adapterId: NODESLIDE_EDIT_SHADOW_ADAPTER_ID,
    adapterVersion: NODESLIDE_EDIT_SHADOW_ADAPTER_VERSION,
    reason,
  };
}

function eligibleElements(snapshot: DeckSnapshot, scope: PatchScope): SlideElement[] {
  const slideIds =
    scope.kind === 'deck' ? new Set(snapshot.deck.slideOrder) : new Set(scope.slideIds);
  const elementIds = 'elementIds' in scope ? new Set(scope.elementIds) : null;
  const slideRank = new Map(snapshot.deck.slideOrder.map((id, index) => [id, index]));
  const elementRank = new Map(
    snapshot.slides.flatMap((slide) =>
      slide.elementOrder.map((id, index) => [`${slide.id}:${id}`, index] as const),
    ),
  );
  return snapshot.elements
    .filter(
      (element) =>
        !element.locked &&
        slideIds.has(element.slideId) &&
        (!elementIds || elementIds.has(element.id)),
    )
    .sort(
      (left, right) =>
        (slideRank.get(left.slideId) ?? Number.MAX_SAFE_INTEGER) -
          (slideRank.get(right.slideId) ?? Number.MAX_SAFE_INTEGER) ||
        (elementRank.get(`${left.slideId}:${left.id}`) ?? Number.MAX_SAFE_INTEGER) -
          (elementRank.get(`${right.slideId}:${right.id}`) ?? Number.MAX_SAFE_INTEGER) ||
        left.id.localeCompare(right.id),
    );
}

function resolveMode(
  requested: PatchScope['operationMode'],
  instruction: string,
): 'copy' | 'style' | 'layout' | null {
  if (requested !== 'unrestricted') return requested;
  const lower = instruction.toLowerCase();
  if (/\b(?:replace|rewrite|copy|text|headline|title|wording|say|read)\b/.test(lower)) {
    return 'copy';
  }
  if (/\b(?:style|color|bold|weight|emphasis|accent|contrast|fill)\b/.test(lower)) {
    return 'style';
  }
  if (/\b(?:move|nudge|layout|align|position|left|right|up|down)\b/.test(lower)) {
    return 'layout';
  }
  return null;
}

function planCopy(eligible: readonly SlideElement[], instruction: string): PatchOperation | null {
  const textElements = eligible.filter((element) => element.kind === 'text');
  if (textElements.length === 0) return null;
  const quoted = quotedSegments(instruction);
  if (quoted.length === 0) return null;

  if (quoted.length >= 2) {
    const [before, after] = quoted;
    if (!before || after === undefined || before === after) return null;
    const target = textElements.find((element) => (element.content ?? '').includes(before)) ?? null;
    if (!target) return null;
    const text = (target.content ?? '').replace(before, after).slice(0, 4000);
    if (!text || text === target.content) return null;
    return { op: 'replace_text', slideId: target.slideId, elementId: target.id, text };
  }

  const replacement = quoted[0]?.slice(0, 4000) ?? '';
  const target = selectNamedTextTarget(textElements, instruction);
  if (!target) return null;
  if (!replacement || replacement === (target.content ?? '')) return null;
  return {
    op: 'replace_text',
    slideId: target.slideId,
    elementId: target.id,
    text: replacement,
  };
}

function selectNamedTextTarget(
  elements: readonly SlideElement[],
  instruction: string,
): SlideElement | null {
  const lower = instruction.toLowerCase();
  return (
    elements.find((element) => {
      const names = [element.name, element.role].filter(Boolean) as string[];
      return names.some((name) => name.length >= 3 && lower.includes(name.toLowerCase()));
    }) ??
    elements[0] ??
    null
  );
}

function planStyle(
  snapshot: DeckSnapshot,
  eligible: readonly SlideElement[],
): PatchOperation | null {
  const target = eligible.find((element) => element.kind === 'text') ?? eligible[0];
  if (!target) return null;
  const properties: Partial<ElementStyle> = {};
  if (target.kind === 'text') {
    if (target.style.color !== snapshot.deck.theme.colors.accent) {
      properties.color = snapshot.deck.theme.colors.accent;
    }
    const nextWeight = Math.min(900, Math.max(650, (target.style.fontWeight ?? 500) + 100));
    if (nextWeight !== target.style.fontWeight) properties.fontWeight = nextWeight;
  } else {
    const fill =
      target.style.fill === snapshot.deck.theme.colors.accentSoft
        ? snapshot.deck.theme.colors.accent
        : snapshot.deck.theme.colors.accentSoft;
    if (fill !== target.style.fill) properties.fill = fill;
  }
  if (Object.keys(properties).length === 0) return null;
  return {
    op: 'update_style',
    slideId: target.slideId,
    elementId: target.id,
    properties,
  };
}

function planLayout(eligible: readonly SlideElement[], instruction: string): PatchOperation | null {
  const target = eligible[0];
  if (!target) return null;
  const lower = instruction.toLowerCase();
  let deltaX = 0;
  let deltaY = 0;
  if (/\bleft\b/.test(lower)) deltaX = -0.01;
  else if (/\bright\b/.test(lower)) deltaX = 0.01;
  if (/\bup\b/.test(lower)) deltaY = -0.01;
  else if (/\bdown\b/.test(lower)) deltaY = 0.01;
  if (deltaX === 0 && deltaY === 0) {
    deltaX = target.bbox.x + target.bbox.width + 0.01 <= 1 ? 0.01 : -0.01;
  }
  const x = roundNormalized(Math.min(1 - target.bbox.width, Math.max(0, target.bbox.x + deltaX)));
  const y = roundNormalized(Math.min(1 - target.bbox.height, Math.max(0, target.bbox.y + deltaY)));
  if (x === target.bbox.x && y === target.bbox.y) return null;
  return { op: 'move', slideId: target.slideId, elementId: target.id, x, y };
}

function quotedSegments(value: string): string[] {
  const matches: string[] = [];
  for (const match of value.matchAll(/["\u201c]([^"\u201d]{1,4000})["\u201d]/g)) {
    const text = match[1]?.trim();
    if (text) matches.push(text);
    if (matches.length === 2) break;
  }
  return matches;
}

function roundNormalized(value: number): number {
  return Number(value.toFixed(6));
}
