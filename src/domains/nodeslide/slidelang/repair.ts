import type {
  DeckSnapshot,
  Slide,
  SlideElement,
  ValidationIssue,
  ValidationResult,
} from '../../../../shared/nodeslide';
import type { RepairAction, RepairActionKind, RepairPlan, SlideLangRepairResult } from './types';
import {
  MIN_READABLE_FONT_SIZE,
  boxContains,
  chooseReadableTextColor,
  cloneSnapshot,
  estimateTextFit,
  normalizeBoundingBox,
  orderedElements,
  stableHash,
} from './utils';
import { validateSnapshot } from './validation';

interface RepairDefinition {
  kind: RepairActionKind;
  description: string;
  automatic: boolean;
}

function repairDefinition(issue: ValidationIssue): RepairDefinition {
  if (issue.code === 'schema') {
    if (issue.message.includes('geometry')) {
      return {
        kind: 'normalize_geometry',
        description: 'Clamp the element to finite, positive normalized slide bounds.',
        automatic: true,
      };
    }
    return {
      kind: 'repair_schema',
      description: 'Repair IDs, references, or malformed canonical data with author review.',
      automatic: false,
    };
  }

  const definitions: Record<Exclude<ValidationIssue['code'], 'schema'>, RepairDefinition> = {
    missing_asset: {
      kind: 'attach_asset',
      description: 'Attach an embedded image asset or deliberately accept a labeled placeholder.',
      automatic: false,
    },
    overflow: {
      kind: 'fit_text',
      description: 'Reduce type size only when the content can still remain at least 14pt.',
      automatic: true,
    },
    collision: {
      kind: 'separate_elements',
      description: 'Rework the overlapping layout while preserving the author’s visual hierarchy.',
      automatic: false,
    },
    contrast: {
      kind: 'improve_contrast',
      description:
        'Choose black or white text, whichever has stronger contrast with its background.',
      automatic: true,
    },
    font_size: {
      kind: 'increase_font_size',
      description: `Increase text to at least ${MIN_READABLE_FONT_SIZE}pt when it still fits.`,
      automatic: true,
    },
    source: {
      kind: 'attach_source',
      description: 'Attach a valid canonical source record; factual provenance is not invented.',
      automatic: false,
    },
    scope: {
      kind: 'repair_scope',
      description: 'Bring the operation back inside its declared edit scope.',
      automatic: false,
    },
    export: {
      kind: 'select_export_fallback',
      description:
        'Accept the explicit fallback or replace the element with a natively editable kind.',
      automatic: false,
    },
    on_brand_color: {
      kind: 'repair_schema',
      description:
        'Review the off-brand color against the active deck signature before changing it.',
      automatic: false,
    },
    on_brand_font: {
      kind: 'repair_schema',
      description:
        'Review the off-brand font against the active deck signature before changing it.',
      automatic: false,
    },
    on_brand_type_scale: {
      kind: 'repair_schema',
      description: 'Review the type scale against the active deck signature before changing it.',
      automatic: false,
    },
    on_brand_background: {
      kind: 'repair_schema',
      description: 'Review the background against the active deck signature before changing it.',
      automatic: false,
    },
  };
  return definitions[issue.code];
}

export function getRepairPlan(validation: ValidationResult): RepairPlan {
  const actions = validation.issues.map((issue): RepairAction => {
    const definition = repairDefinition(issue);
    return {
      id: `repair:${stableHash(`${validation.id}:${issue.id}:${definition.kind}`)}`,
      issueId: issue.id,
      issueCode: issue.code,
      kind: definition.kind,
      description: definition.description,
      automatic: definition.automatic,
      ...(issue.slideId ? { slideId: issue.slideId } : {}),
      ...(issue.elementId ? { elementId: issue.elementId } : {}),
    };
  });
  const fingerprint = stableHash(actions.map((action) => action.id).join('|'));
  return {
    id: `repair-plan:${validation.deckId}:v${validation.deckVersion}:${fingerprint}`,
    validationId: validation.id,
    deckId: validation.deckId,
    deckVersion: validation.deckVersion,
    actions,
  };
}

function findElement(snapshot: DeckSnapshot, action: RepairAction): SlideElement | undefined {
  if (!action.elementId) return undefined;
  return snapshot.elements.find(
    (element) =>
      element.id === action.elementId && (!action.slideId || element.slideId === action.slideId),
  );
}

function findSlide(snapshot: DeckSnapshot, element: SlideElement): Slide | undefined {
  return snapshot.slides.find((slide) => slide.id === element.slideId);
}

function effectiveBackground(snapshot: DeckSnapshot, slide: Slide, element: SlideElement): string {
  const elements = orderedElements(snapshot, slide);
  const elementIndex = elements.findIndex((candidate) => candidate.id === element.id);
  const shape = elements
    .slice(0, Math.max(0, elementIndex))
    .reverse()
    .find(
      (candidate) =>
        candidate.kind === 'shape' &&
        candidate.style.fill &&
        boxContains(candidate.bbox, element.bbox),
    );
  return shape?.style.fill ?? slide.background;
}

function fitText(element: SlideElement): boolean {
  const originalFontSize = element.style.fontSize;
  let fontSize = Math.max(MIN_READABLE_FONT_SIZE, Math.floor(originalFontSize ?? 24));
  element.style.fontSize = fontSize;
  while (estimateTextFit(element).overflow && fontSize > MIN_READABLE_FONT_SIZE) {
    fontSize -= 1;
    element.style.fontSize = fontSize;
  }
  if (estimateTextFit(element).overflow) {
    if (originalFontSize === undefined) Reflect.deleteProperty(element.style, 'fontSize');
    else element.style.fontSize = originalFontSize;
    return false;
  }
  return element.style.fontSize !== originalFontSize;
}

function increaseFontSize(element: SlideElement): boolean {
  const originalFontSize = element.style.fontSize;
  if ((originalFontSize ?? 24) >= MIN_READABLE_FONT_SIZE) return false;
  element.style.fontSize = MIN_READABLE_FONT_SIZE;
  if (estimateTextFit(element).overflow) {
    if (originalFontSize === undefined) Reflect.deleteProperty(element.style, 'fontSize');
    else element.style.fontSize = originalFontSize;
    return false;
  }
  return true;
}

function applyAutomaticAction(snapshot: DeckSnapshot, action: RepairAction): boolean {
  const element = findElement(snapshot, action);
  if (!element) return false;

  if (action.kind === 'normalize_geometry') {
    element.bbox = normalizeBoundingBox(element.bbox);
    element.version += 1;
    return true;
  }
  if (action.kind === 'fit_text') {
    const changed = fitText(element);
    if (changed) element.version += 1;
    return changed;
  }
  if (action.kind === 'increase_font_size') {
    const changed = increaseFontSize(element);
    if (changed) element.version += 1;
    return changed;
  }
  if (action.kind === 'improve_contrast') {
    const slide = findSlide(snapshot, element);
    if (!slide) return false;
    const color = chooseReadableTextColor(effectiveBackground(snapshot, slide, element));
    if (element.style.color === color) return false;
    element.style.color = color;
    element.version += 1;
    return true;
  }
  return false;
}

export function applyRepairPlan(
  snapshot: DeckSnapshot,
  suppliedPlan?: RepairPlan,
): SlideLangRepairResult {
  const initialValidation = validateSnapshot(snapshot);
  const plan = suppliedPlan ?? getRepairPlan(initialValidation);
  if (plan.deckId !== snapshot.deck.id || plan.deckVersion !== snapshot.deck.version) {
    throw new Error(
      `Repair plan ${plan.id} targets ${plan.deckId} v${plan.deckVersion}, not ${snapshot.deck.id} v${snapshot.deck.version}.`,
    );
  }

  const repaired = cloneSnapshot(snapshot);
  const appliedActionIds: string[] = [];
  const skippedActionIds: string[] = [];
  for (const action of plan.actions) {
    if (action.automatic && applyAutomaticAction(repaired, action)) {
      appliedActionIds.push(action.id);
    } else {
      skippedActionIds.push(action.id);
    }
  }

  if (appliedActionIds.length > 0) {
    repaired.deck.version += 1;
    for (const slide of repaired.slides) {
      if (
        repaired.elements.some(
          (element) =>
            element.slideId === slide.id &&
            plan.actions.some(
              (action) => appliedActionIds.includes(action.id) && action.elementId === element.id,
            ),
        )
      ) {
        slide.version += 1;
      }
    }
  }

  return {
    snapshot: repaired,
    plan,
    appliedActionIds,
    skippedActionIds,
    validation: validateSnapshot(repaired),
  };
}
