import type { Deck, PatchOperation, Slide, SlideElement } from '../../../../shared/nodeslide';

export const NODESLIDE_OPENUI_ACTION = 'nodeslide.visual-material.propose' as const;
export const NODESLIDE_OPENUI_PROGRAM_VERSION = 'nodeslide.openui-program/v1' as const;
export const NODESLIDE_VISUAL_MATERIAL_VERSION = 'nodeslide.visual-material/v1' as const;

export interface VisualMaterialClaim {
  label: string;
  value: string;
  unit: string;
  context: string;
}

export interface VisualMaterialSpec {
  schemaVersion: typeof NODESLIDE_VISUAL_MATERIAL_VERSION;
  id: string;
  kind: 'transformation_ladder' | 'chart';
  eyebrow: string;
  title: string;
  subtitle: string;
  claims: readonly VisualMaterialClaim[];
  provenanceLabel: string;
  verification: 'unverified_scenario' | 'source_bound';
}

export interface VisualMaterialValidation {
  ok: boolean;
  issues: string[];
  distinctUnits: string[];
}

export const AI2027_TRANSFORMATION_LADDER: VisualMaterialSpec = {
  schemaVersion: NODESLIDE_VISUAL_MATERIAL_VERSION,
  id: 'ai2027-transformation-ladder-v1',
  kind: 'transformation_ladder',
  eyebrow: 'AI 2027 · scenario fixture',
  title: 'One transformation ladder, four different units',
  subtitle:
    'Keep each claim in its own unit. Sequence implies transformation—not a shared quantitative axis.',
  claims: [
    {
      label: 'Replication',
      value: '200K copies',
      unit: 'copies',
      context: 'Parallel instances in the scenario brief',
    },
    {
      label: 'Equivalent capacity',
      value: '50K coder equivalents',
      unit: 'coder equivalents',
      context: 'A separate capacity claim',
    },
    {
      label: 'Individual acceleration',
      value: '30× speed',
      unit: 'individual speed multiplier',
      context: 'Per-agent performance claim',
    },
    {
      label: 'System outcome',
      value: '4× research progress',
      unit: 'overall progress multiplier',
      context: 'Aggregate outcome claim',
    },
  ],
  provenanceLabel: 'User-provided scenario brief · unverified',
  verification: 'unverified_scenario',
};

export const AI2027_OPENUI_PROGRAM = `root = TransformationLadder(${[
  AI2027_TRANSFORMATION_LADDER.eyebrow,
  AI2027_TRANSFORMATION_LADDER.title,
  AI2027_TRANSFORMATION_LADDER.subtitle,
  AI2027_TRANSFORMATION_LADDER.claims[0]?.label,
  AI2027_TRANSFORMATION_LADDER.claims[0]?.value,
  AI2027_TRANSFORMATION_LADDER.claims[0]?.unit,
  AI2027_TRANSFORMATION_LADDER.claims[1]?.label,
  AI2027_TRANSFORMATION_LADDER.claims[1]?.value,
  AI2027_TRANSFORMATION_LADDER.claims[1]?.unit,
  AI2027_TRANSFORMATION_LADDER.claims[2]?.label,
  AI2027_TRANSFORMATION_LADDER.claims[2]?.value,
  AI2027_TRANSFORMATION_LADDER.claims[2]?.unit,
  AI2027_TRANSFORMATION_LADDER.claims[3]?.label,
  AI2027_TRANSFORMATION_LADDER.claims[3]?.value,
  AI2027_TRANSFORMATION_LADDER.claims[3]?.unit,
  AI2027_TRANSFORMATION_LADDER.provenanceLabel,
]
  .map((value) => JSON.stringify(value ?? ''))
  .join(', ')})`;

export function validateVisualMaterialSpec(spec: VisualMaterialSpec): VisualMaterialValidation {
  const issues: string[] = [];
  const distinctUnits = [...new Set(spec.claims.map((claim) => claim.unit.trim()).filter(Boolean))];
  if (spec.claims.length < 2 || spec.claims.length > 6) {
    issues.push('A visual material must contain between two and six bounded claims.');
  }
  if (
    spec.claims.some((claim) => !claim.label.trim() || !claim.value.trim() || !claim.unit.trim())
  ) {
    issues.push('Every visual claim needs a label, value, and explicit unit.');
  }
  if (spec.kind === 'chart' && distinctUnits.length > 1) {
    issues.push('Mixed-unit claims cannot share one quantitative chart axis.');
  }
  if (spec.verification === 'unverified_scenario' && !/unverified/i.test(spec.provenanceLabel)) {
    issues.push('Unverified scenario material must carry an explicit unverified label.');
  }
  return { ok: issues.length === 0, issues, distinctUnits };
}

export function compileVisualMaterialProposal(
  spec: VisualMaterialSpec,
  deck: Deck,
  activeSlide: Slide,
): { operations: PatchOperation[]; summary: string; slideId: string } {
  const validation = validateVisualMaterialSpec(spec);
  if (!validation.ok) throw new Error(validation.issues.join(' '));

  const slideId = `${activeSlide.id}__openui_${slug(spec.id)}_v${deck.version}`;
  const elements = buildTransformationLadderElements(spec, slideId, deck);
  const slide: Slide = {
    id: slideId,
    deckId: deck.id,
    title: spec.title,
    section: 'Visual material',
    notes:
      'OpenUI Phase 0 fixture. Values came from the user-provided scenario brief and remain unverified. The claims intentionally do not share a quantitative axis.',
    background: deck.theme.colors.canvas,
    elementOrder: elements.map((element) => element.id),
    version: 1,
  };

  return {
    slideId,
    operations: [
      {
        op: 'add_slide',
        slide,
        elements,
        index: Math.max(0, deck.slideOrder.indexOf(activeSlide.id) + 1),
      },
    ],
    summary: `OpenUI visual material proposal: ${spec.title}`,
  };
}

function buildTransformationLadderElements(
  spec: VisualMaterialSpec,
  slideId: string,
  deck: Deck,
): SlideElement[] {
  const capabilities = ['web_native', 'pptx_editable', 'google_importable'] as const;
  const base = (suffix: string): Pick<SlideElement, 'id' | 'slideId' | 'version'> => ({
    id: `${slideId}__${suffix}`,
    slideId,
    version: 1,
  });
  const text = (
    suffix: string,
    name: string,
    role: string,
    content: string,
    bbox: SlideElement['bbox'],
    style: SlideElement['style'],
  ): SlideElement => ({
    ...base(suffix),
    name,
    kind: 'text',
    role,
    bbox,
    rotation: 0,
    content,
    style,
    sourceIds: [],
    locked: false,
    exportCapabilities: [...capabilities],
  });

  const elements: SlideElement[] = [
    text(
      'eyebrow',
      'Scenario status',
      'section',
      spec.eyebrow.toUpperCase(),
      box(0.07, 0.07, 0.72, 0.045),
      {
        color: deck.theme.colors.accent,
        fontFamily: deck.theme.typography.data,
        fontSize: 15,
        fontWeight: 700,
        letterSpacing: 1.2,
      },
    ),
    text('title', 'Visual material title', 'title', spec.title, box(0.07, 0.135, 0.79, 0.15), {
      color: deck.theme.colors.ink,
      fontFamily: deck.theme.typography.display,
      fontSize: 42,
      fontWeight: 650,
      lineHeight: 1.04,
      letterSpacing: -0.6,
    }),
    text('subtitle', 'Unit policy', 'body', spec.subtitle, box(0.07, 0.295, 0.75, 0.09), {
      color: deck.theme.colors.muted,
      fontFamily: deck.theme.typography.body,
      fontSize: 18,
      fontWeight: 450,
      lineHeight: 1.25,
    }),
  ];

  spec.claims.forEach((claim, index) => {
    const x = 0.07 + index * 0.225;
    elements.push(
      {
        ...base(`rung-${index + 1}-panel`),
        name: `Transformation rung ${index + 1}`,
        kind: 'shape',
        role: 'container',
        bbox: box(x, 0.46, 0.195, 0.3),
        rotation: 0,
        style: {
          fill:
            index === spec.claims.length - 1
              ? deck.theme.colors.insight
              : deck.theme.colors.accentSoft,
          stroke: deck.theme.colors.border,
          strokeWidth: 1,
          radius: deck.theme.defaultRadius,
        },
        sourceIds: [],
        locked: false,
        exportCapabilities: [...capabilities],
      },
      text(
        `rung-${index + 1}-label`,
        `${claim.label} label`,
        'label',
        `0${index + 1}  ${claim.label.toUpperCase()}`,
        box(x + 0.018, 0.49, 0.16, 0.055),
        {
          color: deck.theme.colors.muted,
          fontFamily: deck.theme.typography.data,
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: 0.7,
        },
      ),
      text(
        `rung-${index + 1}-value`,
        `${claim.label} value`,
        'metric',
        claim.value,
        box(x + 0.018, 0.57, 0.16, 0.09),
        {
          color:
            index === spec.claims.length - 1 ? deck.theme.colors.insightInk : deck.theme.colors.ink,
          fontFamily: deck.theme.typography.data,
          fontSize: 27,
          fontWeight: 760,
          lineHeight: 1.05,
        },
      ),
      text(
        `rung-${index + 1}-unit`,
        `${claim.label} unit`,
        'caption',
        claim.unit,
        box(x + 0.018, 0.68, 0.16, 0.05),
        {
          color: deck.theme.colors.muted,
          fontFamily: deck.theme.typography.body,
          fontSize: 14,
          fontWeight: 520,
        },
      ),
    );
  });

  elements.push(
    text(
      'provenance',
      'Provenance note',
      'source',
      spec.provenanceLabel,
      box(0.07, 0.84, 0.72, 0.045),
      {
        color: deck.theme.colors.muted,
        fontFamily: deck.theme.typography.data,
        fontSize: 14,
        fontWeight: 560,
      },
    ),
    text(
      'guardrail',
      'Chart guardrail',
      'caption',
      'NO SHARED AXIS · MIXED UNITS',
      box(0.74, 0.84, 0.19, 0.045),
      {
        color: deck.theme.colors.accent,
        fontFamily: deck.theme.typography.data,
        fontSize: 14,
        fontWeight: 720,
        textAlign: 'right',
      },
    ),
  );
  return elements;
}

function box(x: number, y: number, width: number, height: number) {
  return { x, y, width, height };
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);
}
