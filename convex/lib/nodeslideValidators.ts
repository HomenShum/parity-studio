import { ConvexError, v } from 'convex/values';

export const NODESLIDE_CREATE_DECK_LIMITS = {
  title: { maxCharacters: 80, maxBytes: 240 },
  prompt: { maxCharacters: 4_000, maxBytes: 8_192 },
  audience: { maxCharacters: 240, maxBytes: 720 },
  purpose: { maxCharacters: 240, maxBytes: 720 },
  successCriteria: {
    maxItems: 12,
    maxCharactersPerItem: 400,
    maxBytesPerItem: 1_024,
    maxTotalCharacters: 2_400,
    maxTotalBytes: 6_144,
  },
} as const;

export const NODESLIDE_OPENROUTER_BRIEF_CONSENT = 'openrouter_full_brief_v1' as const;

export type NodeSlideBriefProviderMode = 'deterministic' | 'openrouter_free';

export type ValidatedNodeSlideBriefProviderChoice =
  | { providerMode: 'deterministic' }
  | {
      providerMode: 'openrouter_free';
      providerConsent: typeof NODESLIDE_OPENROUTER_BRIEF_CONSENT;
    };

export interface NodeSlideCreateDeckFields {
  title: string;
  brief: {
    prompt: string;
    audience: string;
    purpose: string;
    successCriteria: string[];
  };
}

export type NodeSlideCreateErrorCode =
  | 'admission_denied'
  | 'invalid_request'
  | 'preview_not_configured'
  | 'provider_consent_required'
  | 'provider_consent_mismatch'
  | 'quota_exceeded';

const ADMISSION_CODE_MAX_CHARACTERS = 256;
const ADMISSION_CODE_MAX_BYTES = 256;
const ADMISSION_SUBJECT_MAX_BYTES = 256;
const ADMISSION_DIGEST_DOMAIN = 'nodeslide-private-preview-admission-v1';

export function validateNodeSlideCreateDeckFields(
  input: NodeSlideCreateDeckFields,
): NodeSlideCreateDeckFields {
  const title = boundedCreateText(input.title, 'title', NODESLIDE_CREATE_DECK_LIMITS.title);
  const prompt = boundedCreateText(
    input.brief.prompt,
    'prompt',
    NODESLIDE_CREATE_DECK_LIMITS.prompt,
  );
  const audience = boundedCreateText(
    input.brief.audience,
    'audience',
    NODESLIDE_CREATE_DECK_LIMITS.audience,
  );
  const purpose = boundedCreateText(
    input.brief.purpose,
    'purpose',
    NODESLIDE_CREATE_DECK_LIMITS.purpose,
  );
  const criteriaLimits = NODESLIDE_CREATE_DECK_LIMITS.successCriteria;
  if (input.brief.successCriteria.length > criteriaLimits.maxItems) {
    throw nodeslideCreatePublicError(
      'invalid_request',
      `successCriteria supports at most ${criteriaLimits.maxItems} entries.`,
    );
  }

  let totalCharacters = 0;
  let totalBytes = 0;
  const successCriteria = input.brief.successCriteria.map((criterion, index) => {
    const clean = boundedCreateText(criterion, `successCriteria[${index}]`, {
      maxCharacters: criteriaLimits.maxCharactersPerItem,
      maxBytes: criteriaLimits.maxBytesPerItem,
    });
    totalCharacters += countCodePoints(criterion);
    totalBytes += utf8ByteLength(criterion);
    return clean;
  });
  if (
    totalCharacters > criteriaLimits.maxTotalCharacters ||
    totalBytes > criteriaLimits.maxTotalBytes
  ) {
    throw nodeslideCreatePublicError(
      'invalid_request',
      'successCriteria exceeds the private-preview total size limit.',
    );
  }

  return {
    title,
    brief: { prompt, audience, purpose, successCriteria },
  };
}

export function validateNodeSlideBriefProviderChoice(
  providerMode: unknown,
  providerConsent: unknown,
): ValidatedNodeSlideBriefProviderChoice {
  if (providerMode === 'deterministic') {
    if (providerConsent !== undefined) {
      throw nodeslideCreatePublicError(
        'provider_consent_mismatch',
        'OpenRouter consent must only accompany an OpenRouter request.',
      );
    }
    return { providerMode };
  }
  if (providerMode === 'openrouter_free') {
    if (providerConsent !== NODESLIDE_OPENROUTER_BRIEF_CONSENT) {
      throw nodeslideCreatePublicError(
        'provider_consent_required',
        'Explicit consent is required before sending the full brief to OpenRouter.',
      );
    }
    return { providerMode, providerConsent };
  }
  throw nodeslideCreatePublicError('invalid_request', 'Choose a supported brief provider mode.');
}

export async function invokeNodeSlideBriefProvider<Result>(
  choice: ValidatedNodeSlideBriefProviderChoice,
  invokeProvider: () => Promise<Result>,
): Promise<Result | null> {
  if (choice.providerMode === 'deterministic') return null;
  return await invokeProvider();
}

export async function validateNodeSlidePreviewAdmission(args: {
  providedAccessCode: string | undefined;
  expectedAccessCode: string | undefined;
  admissionSubject: string | undefined;
}): Promise<string> {
  const expectedAccessCode = args.expectedAccessCode;
  const admissionSubject = args.admissionSubject;
  if (
    !expectedAccessCode ||
    !admissionSubject ||
    !expectedAccessCode.trim() ||
    !admissionSubject.trim() ||
    utf8ByteLength(expectedAccessCode) > ADMISSION_CODE_MAX_BYTES ||
    utf8ByteLength(admissionSubject) > ADMISSION_SUBJECT_MAX_BYTES
  ) {
    throw nodeslideCreatePublicError(
      'preview_not_configured',
      'NodeSlide private-preview admission is not configured.',
    );
  }

  const providedAccessCode = args.providedAccessCode ?? '';
  const providedIsBounded =
    countCodePoints(providedAccessCode) <= ADMISSION_CODE_MAX_CHARACTERS &&
    utf8ByteLength(providedAccessCode) <= ADMISSION_CODE_MAX_BYTES;
  const comparisonValue = providedIsBounded ? providedAccessCode : '\u0000oversized';
  const [providedDigest, expectedDigest] = await Promise.all([
    sha256(comparisonValue),
    sha256(expectedAccessCode),
  ]);
  const codesMatch = constantTimeishEqual(providedDigest, expectedDigest);
  if (!providedAccessCode || !providedIsBounded || !codesMatch) {
    throw nodeslideCreatePublicError(
      'admission_denied',
      'A valid private-preview access code is required.',
    );
  }

  return bytesToHex(
    await sha256(`${ADMISSION_DIGEST_DOMAIN}\u0000${admissionSubject}\u0000${expectedAccessCode}`),
  );
}

export function nodeslideCreatePublicError(code: NodeSlideCreateErrorCode, message: string) {
  return new ConvexError({
    kind: 'nodeslide_create' as const,
    code,
    message: message.replace(/\s+/g, ' ').trim().slice(0, 360),
  });
}

function boundedCreateText(
  value: string,
  label: string,
  limits: { maxCharacters: number; maxBytes: number },
): string {
  if (countCodePoints(value) > limits.maxCharacters || utf8ByteLength(value) > limits.maxBytes) {
    throw nodeslideCreatePublicError(
      'invalid_request',
      `${label} exceeds the private-preview size limit.`,
    );
  }
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) {
    throw nodeslideCreatePublicError('invalid_request', `${label} is required.`);
  }
  return clean;
}

function countCodePoints(value: string): number {
  let count = 0;
  for (const _character of value) count += 1;
  return count;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

function constantTimeishEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.byteLength ^ right.byteLength;
  const length = Math.max(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

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

export const nodeslideDeckReplCommandValidator = v.union(
  v.object({
    id: v.string(),
    type: v.literal('inspect_deck'),
  }),
  v.object({
    id: v.string(),
    type: v.literal('inspect_slide'),
    slideId: v.string(),
  }),
  v.object({
    id: v.string(),
    type: v.literal('find_elements'),
    slideId: v.optional(v.string()),
    kind: v.optional(
      v.union(
        v.literal('text'),
        v.literal('shape'),
        v.literal('image'),
        v.literal('chart'),
        v.literal('connector'),
      ),
    ),
    role: v.optional(v.string()),
    text: v.optional(v.string()),
    limit: v.optional(v.number()),
  }),
  v.object({
    id: v.string(),
    type: v.literal('measure_slide'),
    slideId: v.string(),
  }),
  v.object({
    id: v.string(),
    type: v.literal('propose_patch'),
    baseDeckVersion: v.number(),
    baseSlideVersions: nodeslideVersionClockValidator,
    baseElementVersions: nodeslideVersionClockValidator,
    scope: nodeslidePatchScopeValidator,
    operations: v.array(nodeslidePatchOperationValidator),
  }),
);

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
