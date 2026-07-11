import { v } from 'convex/values';

export const nodeslideBoundingBoxValidator = v.object({
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
});

export const nodeslideBriefValidator = v.object({
  prompt: v.string(),
  audience: v.string(),
  purpose: v.string(),
  successCriteria: v.array(v.string()),
});

export const nodeslideThemeValidator = v.object({
  id: v.string(),
  name: v.string(),
  mode: v.union(v.literal('light'), v.literal('dark')),
  colors: v.object({
    canvas: v.string(),
    ink: v.string(),
    muted: v.string(),
    accent: v.string(),
    accentSoft: v.string(),
    insight: v.string(),
    insightInk: v.string(),
    trace: v.string(),
    border: v.string(),
  }),
  typography: v.object({
    display: v.string(),
    body: v.string(),
    data: v.string(),
  }),
  defaultRadius: v.number(),
  spacingUnit: v.number(),
});

export const nodeslideElementStyleValidator = v.object({
  fill: v.optional(v.string()),
  stroke: v.optional(v.string()),
  strokeWidth: v.optional(v.number()),
  color: v.optional(v.string()),
  fontFamily: v.optional(v.string()),
  fontSize: v.optional(v.number()),
  fontWeight: v.optional(v.number()),
  lineHeight: v.optional(v.number()),
  letterSpacing: v.optional(v.number()),
  textAlign: v.optional(v.union(v.literal('left'), v.literal('center'), v.literal('right'))),
  verticalAlign: v.optional(v.union(v.literal('top'), v.literal('middle'), v.literal('bottom'))),
  radius: v.optional(v.number()),
  opacity: v.optional(v.number()),
  padding: v.optional(v.number()),
  shadow: v.optional(v.string()),
});

export const nodeslideChartDataValidator = v.object({
  chartType: v.union(v.literal('bar'), v.literal('line'), v.literal('area'), v.literal('donut')),
  labels: v.array(v.string()),
  series: v.array(
    v.object({
      name: v.string(),
      values: v.array(v.number()),
      color: v.optional(v.string()),
    }),
  ),
  unit: v.optional(v.string()),
  sourceId: v.optional(v.string()),
});

export const nodeslideExportCapabilityValidator = v.union(
  v.literal('web_native'),
  v.literal('pptx_editable'),
  v.literal('pptx_static_fallback'),
  v.literal('google_importable'),
  v.literal('web_only'),
);

export const nodeslideElementValidator = v.object({
  id: v.string(),
  slideId: v.string(),
  name: v.string(),
  kind: v.union(
    v.literal('text'),
    v.literal('shape'),
    v.literal('image'),
    v.literal('chart'),
    v.literal('connector'),
  ),
  role: v.optional(v.string()),
  bbox: nodeslideBoundingBoxValidator,
  rotation: v.number(),
  content: v.optional(v.string()),
  style: nodeslideElementStyleValidator,
  chart: v.optional(nodeslideChartDataValidator),
  imageUrl: v.optional(v.string()),
  altText: v.optional(v.string()),
  sourceIds: v.array(v.string()),
  locked: v.boolean(),
  exportCapabilities: v.array(nodeslideExportCapabilityValidator),
  version: v.number(),
});

export const nodeslideSlideValidator = v.object({
  id: v.string(),
  deckId: v.string(),
  title: v.string(),
  section: v.optional(v.string()),
  notes: v.optional(v.string()),
  background: v.string(),
  elementOrder: v.array(v.string()),
  version: v.number(),
});

export const nodeslideDeckValidator = v.object({
  schemaVersion: v.literal('nodeslide.slidelang/v1'),
  toolchainVersion: v.string(),
  id: v.string(),
  projectId: v.string(),
  title: v.string(),
  brief: nodeslideBriefValidator,
  theme: nodeslideThemeValidator,
  slideOrder: v.array(v.string()),
  version: v.number(),
  status: v.union(
    v.literal('draft'),
    v.literal('validating'),
    v.literal('ready'),
    v.literal('published'),
  ),
  activeSignatureProfileId: v.optional(v.string()),
  activeSignatureProfileDigest: v.optional(v.string()),
  shareSlug: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const nodeslideCommentAnchorValidator = v.union(
  v.object({ type: v.literal('deck'), deckId: v.string() }),
  v.object({ type: v.literal('slide'), deckId: v.string(), slideId: v.string() }),
  v.object({
    type: v.literal('element'),
    deckId: v.string(),
    slideId: v.string(),
    elementId: v.string(),
  }),
  v.object({
    type: v.literal('bounding_box'),
    deckId: v.string(),
    slideId: v.string(),
    bbox: nodeslideBoundingBoxValidator,
  }),
);

export const nodeslideOperationModeValidator = v.union(
  v.literal('copy'),
  v.literal('style'),
  v.literal('layout'),
  v.literal('unrestricted'),
);

export const nodeslidePatchScopeValidator = v.union(
  v.object({
    kind: v.literal('deck'),
    deckId: v.string(),
    operationMode: nodeslideOperationModeValidator,
  }),
  v.object({
    kind: v.literal('slide'),
    deckId: v.string(),
    slideIds: v.array(v.string()),
    operationMode: nodeslideOperationModeValidator,
  }),
  v.object({
    kind: v.literal('elements'),
    deckId: v.string(),
    slideIds: v.array(v.string()),
    elementIds: v.array(v.string()),
    operationMode: nodeslideOperationModeValidator,
  }),
  v.object({
    kind: v.literal('bounding_box'),
    deckId: v.string(),
    slideIds: v.array(v.string()),
    elementIds: v.array(v.string()),
    bbox: nodeslideBoundingBoxValidator,
    operationMode: nodeslideOperationModeValidator,
  }),
  v.object({
    kind: v.literal('comment'),
    deckId: v.string(),
    slideIds: v.array(v.string()),
    elementIds: v.array(v.string()),
    commentId: v.string(),
    operationMode: nodeslideOperationModeValidator,
  }),
);

export const nodeslidePatchOperationValidator = v.union(
  v.object({
    op: v.literal('move'),
    slideId: v.string(),
    elementId: v.string(),
    x: v.number(),
    y: v.number(),
  }),
  v.object({
    op: v.literal('resize'),
    slideId: v.string(),
    elementId: v.string(),
    width: v.number(),
    height: v.number(),
  }),
  v.object({
    op: v.literal('replace_text'),
    slideId: v.string(),
    elementId: v.string(),
    text: v.string(),
  }),
  v.object({
    op: v.literal('update_style'),
    slideId: v.string(),
    elementId: v.string(),
    properties: nodeslideElementStyleValidator,
  }),
  v.object({
    op: v.literal('add_element'),
    slideId: v.string(),
    element: nodeslideElementValidator,
  }),
  v.object({
    op: v.literal('remove_element'),
    slideId: v.string(),
    elementId: v.string(),
  }),
  v.object({
    op: v.literal('add_slide'),
    slide: nodeslideSlideValidator,
    elements: v.array(nodeslideElementValidator),
    index: v.number(),
  }),
  v.object({
    op: v.literal('remove_slide'),
    slideId: v.string(),
  }),
  v.object({
    op: v.literal('reorder_slide'),
    slideId: v.string(),
    index: v.number(),
  }),
  v.object({
    op: v.literal('update_slide'),
    slideId: v.string(),
    properties: v.object({
      title: v.optional(v.string()),
      notes: v.optional(v.string()),
      background: v.optional(v.string()),
    }),
  }),
  v.object({
    op: v.literal('update_deck'),
    properties: v.object({
      title: v.optional(v.string()),
    }),
  }),
);

export const nodeslidePatchSourceValidator = v.union(
  v.literal('human'),
  v.literal('agent'),
  v.literal('import'),
  v.literal('system'),
);

export const nodeslideVersionClockValidator = v.record(v.string(), v.number());

export const nodeslidePatchStatusValidator = v.union(
  v.literal('draft'),
  v.literal('validating'),
  v.literal('ready'),
  v.literal('accepted'),
  v.literal('rejected'),
  v.literal('stale'),
);

export const nodeslideSourceValidator = v.object({
  id: v.string(),
  deckId: v.string(),
  title: v.string(),
  url: v.optional(v.string()),
  sourceType: v.union(
    v.literal('internal'),
    v.literal('url'),
    v.literal('document'),
    v.literal('spreadsheet'),
    v.literal('note'),
  ),
  retrievedAt: v.number(),
  citation: v.string(),
  license: v.optional(v.string()),
});

export const nodeslideValidationIssueValidator = v.object({
  id: v.string(),
  severity: v.union(v.literal('error'), v.literal('warning'), v.literal('info')),
  code: v.union(
    v.literal('schema'),
    v.literal('missing_asset'),
    v.literal('overflow'),
    v.literal('collision'),
    v.literal('contrast'),
    v.literal('font_size'),
    v.literal('source'),
    v.literal('scope'),
    v.literal('export'),
    v.literal('on_brand_color'),
    v.literal('on_brand_font'),
    v.literal('on_brand_type_scale'),
    v.literal('on_brand_background'),
  ),
  message: v.string(),
  slideId: v.optional(v.string()),
  elementId: v.optional(v.string()),
});

export const nodeslideValidationResultValidator = v.object({
  id: v.string(),
  deckId: v.string(),
  deckVersion: v.number(),
  ok: v.boolean(),
  publishOk: v.boolean(),
  cleanOk: v.boolean(),
  issues: v.array(nodeslideValidationIssueValidator),
  checkedAt: v.number(),
  toolchainVersion: v.string(),
});

export const nodeslideSnapshotValidator = v.object({
  deck: nodeslideDeckValidator,
  slides: v.array(nodeslideSlideValidator),
  elements: v.array(nodeslideElementValidator),
  sources: v.array(nodeslideSourceValidator),
});

export const nodeslideCursorValidator = v.object({ x: v.number(), y: v.number() });

export const nodeslideVariationAxesValidator = v.object({
  contentAngle: v.union(v.literal('data_led'), v.literal('narrative_led'), v.literal('balanced')),
  density: v.union(v.literal('executive'), v.literal('detail'), v.literal('balanced')),
  layoutArchetype: v.union(
    v.literal('headline'),
    v.literal('split'),
    v.literal('evidence'),
    v.literal('comparison'),
  ),
});

export const nodeslideVariationOriginValidator = v.union(
  v.literal('free_route'),
  v.literal('deterministic_fallback'),
);

export const nodeslideVariationStatusValidator = v.union(
  v.literal('ready'),
  v.literal('accepted'),
  v.literal('rejected'),
  v.literal('stale'),
);

export const nodeslideVariationCandidateValidator = v.object({
  slide: nodeslideSlideValidator,
  elements: v.array(nodeslideElementValidator),
});

export const nodeslideVariationValidator = v.object({
  schemaVersion: v.literal('nodeslide.variation/v1'),
  id: v.string(),
  batchId: v.string(),
  deckId: v.string(),
  slideId: v.string(),
  baseDeckVersion: v.number(),
  baseSlideVersion: v.number(),
  baseElementVersions: nodeslideVersionClockValidator,
  axes: nodeslideVariationAxesValidator,
  origin: nodeslideVariationOriginValidator,
  fallbackReason: v.optional(v.string()),
  operations: v.array(nodeslidePatchOperationValidator),
  candidate: nodeslideVariationCandidateValidator,
  validation: nodeslideValidationResultValidator,
  status: nodeslideVariationStatusValidator,
  selectedPatchId: v.optional(v.string()),
  createdAt: v.number(),
  decidedAt: v.optional(v.number()),
});

export const nodeslideVariationBatchValidator = v.object({
  id: v.string(),
  deckId: v.string(),
  slideId: v.string(),
  requestedCount: v.literal(3),
  status: v.union(v.literal('generating'), v.literal('ready'), v.literal('failed')),
  origin: nodeslideVariationOriginValidator,
  fallbackReason: v.optional(v.string()),
  variationIds: v.array(v.string()),
  elapsedMs: v.number(),
  createdAt: v.number(),
  completedAt: v.optional(v.number()),
});

export const nodeslideVariationDecisionEventValidator = v.union(
  v.literal('variation_generated'),
  v.literal('variation_selected'),
  v.literal('variation_rejected'),
);
