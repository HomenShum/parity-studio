export const NODESLIDE_ATLAS_SCHEMA_VERSION = 'nodeslide.atlas/v1' as const;
export const NODESLIDE_ATLAS_SOURCE_POLICY_VERSION = 'nodeslide.atlas-source-policy/v1' as const;
export const NODESLIDE_ATLAS_RECEIPT_VERSION = 'nodeslide.atlas-showcase-receipt/v1' as const;

/**
 * Artifact families are the eight buckets the Atlas catalogues. They classify what a slide is
 * *for*, not what it looks like, so a recipe stays comparable across design systems.
 */
export type AtlasArtifactFamily =
  | 'narrative'
  | 'data'
  | 'systems'
  | 'progression'
  | 'product-evidence'
  | 'technical'
  | 'media'
  | 'decision';

export const ATLAS_ARTIFACT_FAMILIES: readonly AtlasArtifactFamily[] = Object.freeze([
  'narrative',
  'data',
  'systems',
  'progression',
  'product-evidence',
  'technical',
  'media',
  'decision',
]);

/**
 * The concrete thing that must exist on the slide. `text` is deliberately separate from every
 * other kind: an archetype whose required kind is `diagram` is not satisfied by prose describing
 * a diagram, which is the failure the Atlas exists to stop.
 */
export type AtlasArtifactKind =
  | 'text'
  | 'chart'
  | 'table'
  | 'diagram'
  | 'timeline'
  | 'screenshot'
  | 'equation'
  | 'code'
  | 'evidence'
  | 'media'
  | 'scrollytelling';

export const ATLAS_ARTIFACT_KINDS: readonly AtlasArtifactKind[] = Object.freeze([
  'text',
  'chart',
  'table',
  'diagram',
  'timeline',
  'screenshot',
  'equation',
  'code',
  'evidence',
  'media',
  'scrollytelling',
]);

export interface AtlasArchetype {
  id: string;
  family: AtlasArtifactFamily;
  title: string;
  narrativeJob: string;
  /** At least one of these must be materialised for the archetype to be satisfied. */
  requiredArtifactKinds: readonly AtlasArtifactKind[];
  /** Named substitutions that look complete but are not. Checked by the topology gate. */
  forbiddenSubstitutes: readonly string[];
}

/** How NodeSlide is permitted to obtain and hold a source's assets. */
export type AtlasAccessMode =
  | 'mirror'
  | 'remote-api'
  | 'remote-mcp'
  | 'private-import'
  | 'reference-link-only';

export const ATLAS_ACCESS_MODES: readonly AtlasAccessMode[] = Object.freeze([
  'mirror',
  'remote-api',
  'remote-mcp',
  'private-import',
  'reference-link-only',
]);

/** How a recipe derived from a source may be used downstream. */
export type AtlasReuseMode = 'reference' | 'copy' | 'wrap' | 'adapt' | 'reimplement' | 'benchmark';

export const ATLAS_REUSE_MODES: readonly AtlasReuseMode[] = Object.freeze([
  'reference',
  'copy',
  'wrap',
  'adapt',
  'reimplement',
  'benchmark',
]);

/**
 * Every permission is asked separately because "free to use" answers none of them on its own.
 * A source may permit interactive display and forbid caching, redistribution and training.
 */
export type AtlasUsageIntent =
  | 'download'
  | 'cache'
  | 'display-thumbnail'
  | 'redistribute-original'
  | 'redistribute-modified'
  | 'commercial-output'
  | 'rag-index'
  | 'embedding-index'
  | 'model-training'
  | 'fine-tuning';

export const ATLAS_USAGE_INTENTS: readonly AtlasUsageIntent[] = Object.freeze([
  'download',
  'cache',
  'display-thumbnail',
  'redistribute-original',
  'redistribute-modified',
  'commercial-output',
  'rag-index',
  'embedding-index',
  'model-training',
  'fine-tuning',
]);

export interface AtlasSourcePermissions {
  download: boolean;
  cache: boolean;
  displayThumbnail: boolean;
  redistributeOriginal: boolean;
  redistributeModified: boolean;
  commercialUse: boolean;
  ragIndexing: boolean;
  embeddingIndex: boolean;
  modelTraining: boolean;
  fineTuning: boolean;
}

export const ATLAS_PERMISSION_BY_INTENT: Readonly<
  Record<AtlasUsageIntent, keyof AtlasSourcePermissions>
> = Object.freeze({
  download: 'download',
  cache: 'cache',
  'display-thumbnail': 'displayThumbnail',
  'redistribute-original': 'redistributeOriginal',
  'redistribute-modified': 'redistributeModified',
  'commercial-output': 'commercialUse',
  'rag-index': 'ragIndexing',
  'embedding-index': 'embeddingIndex',
  'model-training': 'modelTraining',
  'fine-tuning': 'fineTuning',
});

export type AtlasSourceStatus = 'approved' | 'restricted' | 'pending-review' | 'blocked';

export interface AtlasSourcePolicy {
  schemaVersion: typeof NODESLIDE_ATLAS_SOURCE_POLICY_VERSION;
  id: string;
  name: string;
  canonicalUrl: `https://${string}`;
  accessMode: AtlasAccessMode;
  licenseId?: string;
  termsUrl?: `https://${string}`;
  permissions: AtlasSourcePermissions;
  attributionRequired: boolean;
  competitiveUseRestricted: boolean;
  /** ISO-8601 date. A policy older than the review window is treated as unreviewed. */
  reviewedAt: string;
  reviewedBy: string;
  status: AtlasSourceStatus;
}

/**
 * Access mode is a hard ceiling on permissions. A `reference-link-only` source can never be
 * cached however its permission block is written, so a policy that claims otherwise is invalid
 * rather than merely permissive.
 */
export const ATLAS_ACCESS_MODE_CEILING: Readonly<
  Record<AtlasAccessMode, readonly (keyof AtlasSourcePermissions)[]>
> = Object.freeze({
  mirror: Object.freeze([
    'download',
    'cache',
    'displayThumbnail',
    'redistributeOriginal',
    'redistributeModified',
    'commercialUse',
    'ragIndexing',
    'embeddingIndex',
    'modelTraining',
    'fineTuning',
  ] as const),
  'remote-api': Object.freeze(['displayThumbnail', 'commercialUse'] as const),
  'remote-mcp': Object.freeze(['displayThumbnail', 'commercialUse'] as const),
  'private-import': Object.freeze([
    'download',
    'cache',
    'displayThumbnail',
    'commercialUse',
    'ragIndexing',
    'embeddingIndex',
  ] as const),
  'reference-link-only': Object.freeze(['displayThumbnail'] as const),
});

/**
 * Honest capability, not a boolean. `unsupported` is a legitimate, reportable answer.
 *
 * `vector-flattened` is the rung between `editable` and `rendered-image`: the artifact is rebuilt
 * from native shapes and text boxes, so it is visually faithful and not rasterised, but it carries
 * no artifact semantics — no Edit Data, no series, no axis, no round-trip from structured input.
 * It was added after Atlas v3 was measured: all 43 slides sit here while claiming `editable`.
 */
export type AtlasCapabilityLevel =
  | 'native'
  | 'editable'
  | 'vector-flattened'
  | 'rendered-image'
  | 'poster-frame'
  | 'unsupported';

export const ATLAS_CAPABILITY_LEVELS: readonly AtlasCapabilityLevel[] = Object.freeze([
  'native',
  'editable',
  'vector-flattened',
  'rendered-image',
  'poster-frame',
  'unsupported',
]);

/**
 * Whether a capability level survives being opened somewhere other than PowerPoint.
 *
 * `editable` was written as a property of the file. It is not — it is a property of the file *in a
 * given renderer*. Anything not measured is `unmeasured`, never assumed portable.
 *
 * This table has been re-measured once, and it moved: equations were recorded `powerpoint-only`
 * until the emitter wrapped its OMML in `<a14:m>`, after which they survive intact. The only
 * divergence left is the chart-to-workbook link, so "Edit Data" is PowerPoint-only while the
 * plotted values travel. Facts here follow the instrument, not the other way round.
 */
export type AtlasRendererPortability = 'portable' | 'powerpoint-only' | 'unmeasured';

export interface AtlasPortabilityFact {
  portability: AtlasRendererPortability;
  /** What the artifact actually degrades to once opened outside PowerPoint. */
  nonPowerPointCapability: AtlasCapabilityLevel;
  measurement: string;
}

/**
 * Measured by round-tripping the Atlas deck through LibreOffice headless — both pptx→pptx and
 * pptx→odp→pptx, which agreed, so these are document-model facts and not one filter's quirk
 * (2026-07-22).
 *
 * The headline is that the portability worry was mostly unfounded: charts stay real chart parts
 * with their series, caches and both date axes; tables, connector bindings and the whole animation
 * tree all survive. Equations do not survive at all — the OMML is deleted outright, leaving a
 * shape that still advertises an equation and shows nothing, which is worse than a rasterised
 * fallback because it is silent.
 */
export const ATLAS_ARTIFACT_PORTABILITY: Readonly<Record<AtlasArtifactKind, AtlasPortabilityFact>> =
  Object.freeze({
    chart: {
      portability: 'portable',
      nonPowerPointCapability: 'editable',
      measurement:
        '10/10 chart parts, 18/18 c:ser, 20/20 c:numCache and both c:dateAx survived; only the c:externalData workbook link was severed (10 -> 0, with all 11 embeddings dropped), so values stay editable but "Edit Data" is PowerPoint-only.',
    },
    table: {
      portability: 'portable',
      nonPowerPointCapability: 'editable',
      measurement: '5/5 a:tbl survived the round trip with their rows intact.',
    },
    diagram: {
      portability: 'portable',
      nonPowerPointCapability: 'editable',
      measurement: '38/38 connectors survived with all 38 a:stCxn and 38 a:endCxn bindings intact.',
    },
    timeline: {
      portability: 'portable',
      nonPowerPointCapability: 'editable',
      measurement: 'Both engineered c:dateAx axes survived as real date axes.',
    },
    equation: {
      // Re-measured 2026-07-23 after the emitter was fixed, and the answer flipped. Recording the
      // old result would now be the stale claim, so the fact follows the measurement.
      portability: 'portable',
      nonPowerPointCapability: 'editable',
      measurement:
        'm:oMath 1->1 with all 10 m:t runs intact, once the OMML is wrapped in <a14:m>. A BARE <m:oMath> sitting directly inside <a:p> is annihilated (1->0, every run deleted, leaving a shape that still advertises an equation and renders blank) — so this rung belongs to the wrapper, not to equations in general.',
    },
    text: {
      portability: 'portable',
      nonPowerPointCapability: 'editable',
      measurement: 'Text bodies survived; LibreOffice stamps explicit fonts but keeps the runs.',
    },
    code: {
      portability: 'portable',
      nonPowerPointCapability: 'editable',
      measurement: 'Code panels are text bodies and survived as text.',
    },
    screenshot: {
      portability: 'portable',
      nonPowerPointCapability: 'rendered-image',
      measurement: 'Every media part round-tripped sha256 bit-identical to its source.',
    },
    media: {
      portability: 'portable',
      nonPowerPointCapability: 'rendered-image',
      measurement: 'Every media part round-tripped sha256 bit-identical to its source.',
    },
    evidence: {
      portability: 'unmeasured',
      nonPowerPointCapability: 'unsupported',
      measurement: 'Hyperlink relationship survival outside PowerPoint has not been measured.',
    },
    scrollytelling: {
      portability: 'unmeasured',
      nonPowerPointCapability: 'unsupported',
      measurement: 'Has no PowerPoint-native form to carry, so nothing was measured.',
    },
  });

/**
 * Capability honestly claimable for one artifact kind in one renderer.
 *
 * PowerPoint gets the declared level. Everywhere else gets the measured level, and `unmeasured`
 * degrades rather than passing through — the point of the function is that an unverified claim
 * must not read the same as a verified one.
 */
export function rendererScopedCapability(input: {
  artifactKind: AtlasArtifactKind;
  declared: AtlasCapabilityLevel;
  renderer: 'powerpoint' | 'other';
}): { capability: AtlasCapabilityLevel; downgraded: boolean; reason: string } {
  const { artifactKind, declared, renderer } = input;
  const fact = ATLAS_ARTIFACT_PORTABILITY[artifactKind];
  if (renderer === 'powerpoint' || !fact) {
    return { capability: declared, downgraded: false, reason: 'Declared capability applies.' };
  }
  // Never upgrade: a portable fact cannot lift a recipe above what it claimed for itself.
  const level =
    ATLAS_CAPABILITY_LEVELS.indexOf(fact.nonPowerPointCapability) >
    ATLAS_CAPABILITY_LEVELS.indexOf(declared)
      ? fact.nonPowerPointCapability
      : declared;
  return {
    capability: level,
    downgraded: level !== declared,
    reason:
      level === declared
        ? `${artifactKind} is ${fact.portability} outside PowerPoint. ${fact.measurement}`
        : `${artifactKind} claims ${declared} but is ${fact.portability}: ${fact.measurement}`,
  };
}

/**
 * What an inspection actually saw. This is an observation, never a compliance verdict — the two
 * are orthogonal, and collapsing them is what let a flattened deck read as passing.
 */
export type AtlasObservedRepresentation =
  | 'native-semantic'
  | 'structured-semantic'
  | 'vector-flattened'
  | 'raster-render'
  | 'poster-frame'
  | 'absent'
  | 'indeterminate';

/** Whether the observation satisfies the requirement. Derived, never observed directly. */
export type AtlasRequirementVerdict =
  | 'pass'
  | 'fallback-accepted'
  | 'violation'
  | 'indeterminate'
  | 'ungated';

const SATISFYING_REPRESENTATIONS: readonly AtlasObservedRepresentation[] = Object.freeze([
  'native-semantic',
  'structured-semantic',
]);

export interface AtlasRequirementDecision {
  verdict: AtlasRequirementVerdict;
  reason: string;
}

/**
 * Resolve an observation into a verdict.
 *
 * The rule that matters: a degraded representation is a violation *unless the recipe declared it
 * as a fallback in advance*. A declared fallback that operated is `fallback-accepted` — which is
 * still not a pass on the native requirement, only an honest degradation.
 */
export function resolveRequirementVerdict(input: {
  requiredArtifactKind: string;
  observedRepresentation: AtlasObservedRepresentation;
  declaredFallback?: { capability: AtlasCapabilityLevel; behavior: string } | null;
}): AtlasRequirementDecision {
  const { requiredArtifactKind, observedRepresentation, declaredFallback } = input;

  if (observedRepresentation === 'indeterminate') {
    return {
      verdict: 'indeterminate',
      reason: `This inspection cannot observe whether a ${requiredArtifactKind} is present.`,
    };
  }
  if (SATISFYING_REPRESENTATIONS.includes(observedRepresentation)) {
    return {
      verdict: 'pass',
      reason: `A semantic ${requiredArtifactKind} object is present.`,
    };
  }
  if (observedRepresentation === 'absent') {
    return {
      verdict: 'violation',
      reason: `No ${requiredArtifactKind} of any representation is present.`,
    };
  }
  if (declaredFallback && declaredFallback.capability === observedRepresentation) {
    return {
      verdict: 'fallback-accepted',
      reason: `Degraded to the declared ${observedRepresentation} fallback: ${declaredFallback.behavior} The native ${requiredArtifactKind} requirement did not pass.`,
    };
  }
  return {
    verdict: 'violation',
    reason: `A visual ${requiredArtifactKind} exists as ${observedRepresentation}, but no semantic ${requiredArtifactKind} object exists and no fallback was declared.`,
  };
}

export type AtlasMaturity =
  | 'discovered'
  | 'extracted'
  | 'vetted'
  | 'proven'
  | 'certified'
  | 'deprecated';

export const ATLAS_MATURITY_ORDER: readonly AtlasMaturity[] = Object.freeze([
  'discovered',
  'extracted',
  'vetted',
  'proven',
  'certified',
]);

export interface AtlasInputRequirement {
  key: string;
  kind: 'series' | 'category' | 'node' | 'edge' | 'claim' | 'source' | 'asset' | 'scalar';
  required: boolean;
  description: string;
  /** Inclusive bounds. A recipe that cannot express nine nodes must say so. */
  minimum?: number;
  maximum?: number;
}

export interface AtlasArtifactRecipe {
  schemaVersion: typeof NODESLIDE_ATLAS_SCHEMA_VERSION;
  id: string;
  version: string;
  archetypeId: string;
  artifactKinds: readonly AtlasArtifactKind[];
  title: string;
  description: string;
  narrativeJobs: readonly string[];
  sourceId: string;
  reuseMode: AtlasReuseMode;
  /** sha256 of the canonical recipe body, used to detect drift from the reviewed version. */
  contentHash: string;
  inputContract: readonly AtlasInputRequirement[];
  capability: {
    web: AtlasCapabilityLevel;
    pptx: AtlasCapabilityLevel;
    fallbackBehavior?: string;
  };
  density: 'sparse' | 'balanced' | 'dense';
  requiredTokens: readonly string[];
  positivePatterns: readonly string[];
  forbiddenPatterns: readonly string[];
  evidenceRequirements: readonly string[];
  maturity: AtlasMaturity;
  receiptIds: readonly string[];
  knownLimitations: readonly string[];
}

/**
 * What actually produced a receipt.
 *
 * `deterministic-baseline` is our own compiler replaying the fixture it was written against. It
 * always passes, because the gates were authored to describe it. `model` is an outside generator
 * that had to hit the bar without being the thing the bar was measured from.
 *
 * This exists because the maturity ladder could not tell them apart: `model: {id, role}` is a free
 * string, so `nodeslide-artifact-builder-v1` scored identically to a paid model call. Absent means
 * a receipt predates this field — treated as unknown, never as `model`.
 */
export type AtlasCandidateKind = 'model' | 'deterministic-baseline';

export interface AtlasShowcaseReceipt {
  schemaVersion: typeof NODESLIDE_ATLAS_RECEIPT_VERSION;
  id: string;
  recipeId: string;
  recipeVersion: string;
  archetypeId: string;
  model: { id: string; role: string };
  /** Absent on receipts written before the distinction existed; those cannot earn `proven`. */
  candidateKind?: AtlasCandidateKind;
  harnessVersion: string;
  sourceIds: readonly string[];
  referenceIds: readonly string[];
  editability: { web: AtlasCapabilityLevel; pptx: AtlasCapabilityLevel };
  evaluation: {
    briefAdherence: boolean;
    visualPassed: boolean;
    evidencePassed: boolean;
    exportPassed: boolean;
    repairCount: number;
  };
  outputs: {
    browserRenderRef: string;
    pptxRenderRef: string;
    pptxFileRef: string;
  };
  costUsd: number;
  latencyMs: number;
  /** `null` means not yet judged. It must never be coerced to `false` to look decided. */
  humanPreferred: boolean | null;
  producedAt: number;
}

export interface AtlasUsageDecision {
  allowed: boolean;
  /** Populated whenever `allowed` is false. Never empty on a denial. */
  reasons: string[];
  attributionRequired: boolean;
}

function permissionCeilingAllows(
  accessMode: AtlasAccessMode,
  permission: keyof AtlasSourcePermissions,
): boolean {
  return (ATLAS_ACCESS_MODE_CEILING[accessMode] ?? []).includes(permission);
}

/**
 * Fail-closed usage gate. A missing policy, an unknown intent, a non-approved status or a
 * permission above the access-mode ceiling all deny. There is no path that returns `allowed`
 * without an explicitly granted permission.
 */
export function evaluateAtlasUsage(
  policy: AtlasSourcePolicy | undefined | null,
  intents: readonly AtlasUsageIntent[],
): AtlasUsageDecision {
  const reasons: string[] = [];
  if (!policy) {
    return {
      allowed: false,
      reasons: ['No source policy is registered; unreviewed sources are denied.'],
      attributionRequired: true,
    };
  }
  if (policy.schemaVersion !== NODESLIDE_ATLAS_SOURCE_POLICY_VERSION) {
    reasons.push(`Source ${policy.id} carries an unknown policy schema version.`);
  }
  if (policy.status !== 'approved') {
    reasons.push(`Source ${policy.id} is ${policy.status}, not approved.`);
  }
  if (intents.length === 0) {
    reasons.push('At least one usage intent must be declared.');
  }
  for (const intent of intents) {
    const permission = ATLAS_PERMISSION_BY_INTENT[intent];
    if (!permission) {
      reasons.push(`Unknown usage intent ${String(intent)} is denied.`);
      continue;
    }
    if (!permissionCeilingAllows(policy.accessMode, permission)) {
      reasons.push(`${intent} is impossible under access mode ${policy.accessMode}.`);
      continue;
    }
    if (policy.permissions?.[permission] !== true) {
      reasons.push(`${intent} is not granted by source ${policy.id}.`);
    }
  }
  return {
    allowed: reasons.length === 0,
    reasons,
    attributionRequired: policy.attributionRequired !== false,
  };
}

/** Redistribution and competitive reuse are separate questions from ordinary usage. */
export function atlasCompetitiveUseBlocked(policy: AtlasSourcePolicy | undefined | null): boolean {
  if (!policy) return true;
  return policy.competitiveUseRestricted !== false;
}

/**
 * Maturity a recipe has actually earned from its receipts, independent of what it claims.
 * Claimed maturity above the earned level is a validation error, not a rounding difference.
 *
 * The ladder's top two rungs are claims about GENERATIVE reproducibility — "a model can hit this
 * bar" — so they require at least one `model` receipt. A deterministic-baseline receipt is our own
 * compiler re-emitting the fixture the gates were written against; it proves the recipe is
 * well-formed and gate-clean, which is exactly `vetted`, and nothing beyond it. Without this cap
 * a run with zero model calls scored `certified`, which was true about the pipeline and false
 * about the sentence a reader takes from the word.
 */
export function earnedAtlasMaturity(
  recipe: Pick<AtlasArtifactRecipe, 'maturity' | 'receiptIds'>,
  receipts: readonly AtlasShowcaseReceipt[],
): AtlasMaturity {
  if (recipe.maturity === 'deprecated') return 'deprecated';
  const owned = receipts.filter((receipt) => recipe.receiptIds.includes(receipt.id));
  if (owned.length === 0) {
    return recipe.maturity === 'discovered' ? 'discovered' : 'extracted';
  }
  const fullyPassing = owned.filter(
    (receipt) =>
      receipt.evaluation.briefAdherence &&
      receipt.evaluation.visualPassed &&
      receipt.evaluation.evidencePassed &&
      receipt.evaluation.exportPassed,
  );
  if (fullyPassing.length === 0) return 'vetted';
  // Fail-closed on the missing field: an unlabelled receipt is not evidence of a model.
  const passingModelReceipts = fullyPassing.filter((receipt) => receipt.candidateKind === 'model');
  if (passingModelReceipts.length === 0) return 'vetted';
  if (passingModelReceipts.some((receipt) => receipt.humanPreferred === true)) return 'certified';
  return 'proven';
}

export function atlasMaturityRank(maturity: AtlasMaturity): number {
  const index = ATLAS_MATURITY_ORDER.indexOf(maturity);
  return index === -1 ? -1 : index;
}
