import {
  ATLAS_ACCESS_MODES,
  ATLAS_ACCESS_MODE_CEILING,
  ATLAS_ARTIFACT_KINDS,
  ATLAS_CAPABILITY_LEVELS,
  ATLAS_MATURITY_ORDER,
  ATLAS_REUSE_MODES,
  type AtlasArchetype,
  type AtlasArtifactRecipe,
  type AtlasMaturity,
  type AtlasReuseMode,
  type AtlasShowcaseReceipt,
  type AtlasSourcePermissions,
  NODESLIDE_ATLAS_RECEIPT_VERSION,
  NODESLIDE_ATLAS_SCHEMA_VERSION,
  NODESLIDE_ATLAS_SOURCE_POLICY_VERSION,
  atlasMaturityRank,
  earnedAtlasMaturity,
} from './nodeslideAtlas';
import { findAtlasArchetype, findAtlasSourcePolicy } from './nodeslideAtlasRegistry';

export interface AtlasValidationResult {
  ok: boolean;
  errors: string[];
}

const ID_PATTERN = /^[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const PERMISSION_KEYS: readonly (keyof AtlasSourcePermissions)[] = Object.freeze([
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
]);

/**
 * What each reuse mode demands of the source. `reimplement` demands no permission because writing
 * original code from an observation is not a use of the asset — but it is the exact act a
 * competitive-use restriction targets, so it is checked separately below.
 */
const REUSE_MODE_REQUIREMENTS: Readonly<
  Record<AtlasReuseMode, readonly (keyof AtlasSourcePermissions)[]>
> = Object.freeze({
  reference: Object.freeze(['displayThumbnail'] as const),
  benchmark: Object.freeze(['displayThumbnail'] as const),
  copy: Object.freeze(['download', 'cache', 'redistributeOriginal'] as const),
  wrap: Object.freeze(['download', 'cache', 'redistributeModified'] as const),
  adapt: Object.freeze(['download', 'cache', 'redistributeModified'] as const),
  reimplement: Object.freeze([] as const),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => isNonEmptyString(entry));
}

export function validateAtlasSourcePolicy(value: unknown): AtlasValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['Source policy must be an object.'] };

  if (value['schemaVersion'] !== NODESLIDE_ATLAS_SOURCE_POLICY_VERSION) {
    errors.push(`schemaVersion must be ${NODESLIDE_ATLAS_SOURCE_POLICY_VERSION}.`);
  }
  const id = value['id'];
  if (!isNonEmptyString(id) || !ID_PATTERN.test(id)) errors.push('id must be a safe slug.');
  if (!isNonEmptyString(value['name'])) errors.push('name is required.');
  if (!isNonEmptyString(value['reviewedBy'])) errors.push('reviewedBy is required.');

  const canonicalUrl = value['canonicalUrl'];
  if (!isNonEmptyString(canonicalUrl) || !canonicalUrl.startsWith('https://')) {
    errors.push('canonicalUrl must be an HTTPS URL.');
  }
  const termsUrl = value['termsUrl'];
  if (termsUrl !== undefined && (!isNonEmptyString(termsUrl) || !termsUrl.startsWith('https://'))) {
    errors.push('termsUrl must be an HTTPS URL when present.');
  }

  const reviewedAt = value['reviewedAt'];
  if (!isNonEmptyString(reviewedAt) || !ISO_DATE_PATTERN.test(reviewedAt)) {
    errors.push('reviewedAt must be an ISO-8601 calendar date.');
  } else if (Number.isNaN(Date.parse(reviewedAt))) {
    errors.push('reviewedAt is not a real date.');
  }

  const status = value['status'];
  if (!['approved', 'restricted', 'pending-review', 'blocked'].includes(String(status))) {
    errors.push('status must be approved, restricted, pending-review or blocked.');
  }
  if (typeof value['attributionRequired'] !== 'boolean') {
    errors.push('attributionRequired must be an explicit boolean.');
  }
  if (typeof value['competitiveUseRestricted'] !== 'boolean') {
    errors.push('competitiveUseRestricted must be an explicit boolean.');
  }

  const accessMode = value['accessMode'];
  const accessModeValid = ATLAS_ACCESS_MODES.includes(accessMode as never);
  if (!accessModeValid) errors.push('accessMode is not a known lane.');

  const permissions = value['permissions'];
  if (!isRecord(permissions)) {
    errors.push('permissions must be an object.');
    return { ok: errors.length === 0, errors };
  }
  for (const key of PERMISSION_KEYS) {
    if (typeof permissions[key] !== 'boolean') {
      errors.push(`permissions.${key} must be an explicit boolean.`);
    }
  }
  for (const key of Object.keys(permissions)) {
    if (!PERMISSION_KEYS.includes(key as keyof AtlasSourcePermissions)) {
      errors.push(`permissions.${key} is not a known permission.`);
    }
  }

  if (accessModeValid) {
    const ceiling = ATLAS_ACCESS_MODE_CEILING[accessMode as keyof typeof ATLAS_ACCESS_MODE_CEILING];
    for (const key of PERMISSION_KEYS) {
      if (permissions[key] === true && !ceiling.includes(key)) {
        errors.push(`permissions.${key} exceeds what access mode ${String(accessMode)} allows.`);
      }
    }
  }

  if (status === 'blocked' && PERMISSION_KEYS.some((key) => permissions[key] === true)) {
    errors.push('A blocked source must not grant any permission.');
  }

  return { ok: errors.length === 0, errors };
}

function validateInputContract(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push('inputContract must be an array.');
    return;
  }
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const path = `inputContract[${index}]`;
    if (!isRecord(entry)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    const key = entry['key'];
    if (!isNonEmptyString(key) || !ID_PATTERN.test(key)) {
      errors.push(`${path}.key must be a safe slug.`);
    } else if (seen.has(key)) {
      errors.push(`${path}.key duplicates an earlier requirement.`);
    } else {
      seen.add(key);
    }
    if (
      !['series', 'category', 'node', 'edge', 'claim', 'source', 'asset', 'scalar'].includes(
        String(entry['kind']),
      )
    ) {
      errors.push(`${path}.kind is not a known input kind.`);
    }
    if (typeof entry['required'] !== 'boolean') {
      errors.push(`${path}.required must be an explicit boolean.`);
    }
    if (!isNonEmptyString(entry['description'])) errors.push(`${path}.description is required.`);
    const minimum = entry['minimum'];
    const maximum = entry['maximum'];
    for (const [label, bound] of [
      ['minimum', minimum],
      ['maximum', maximum],
    ] as const) {
      if (
        bound !== undefined &&
        (typeof bound !== 'number' || !Number.isFinite(bound) || bound < 0)
      ) {
        errors.push(`${path}.${label} must be a non-negative finite number when present.`);
      }
    }
    if (
      typeof minimum === 'number' &&
      typeof maximum === 'number' &&
      Number.isFinite(minimum) &&
      Number.isFinite(maximum) &&
      minimum > maximum
    ) {
      errors.push(`${path} has a minimum above its maximum.`);
    }
  }
}

export function validateAtlasArtifactRecipe(value: unknown): AtlasValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['Recipe must be an object.'] };

  if (value['schemaVersion'] !== NODESLIDE_ATLAS_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${NODESLIDE_ATLAS_SCHEMA_VERSION}.`);
  }
  const id = value['id'];
  if (!isNonEmptyString(id) || !ID_PATTERN.test(id)) errors.push('id must be a safe slug.');
  const version = value['version'];
  if (!isNonEmptyString(version) || !VERSION_PATTERN.test(version)) {
    errors.push('version must be MAJOR.MINOR.PATCH.');
  }
  if (!isNonEmptyString(value['title'])) errors.push('title is required.');
  if (!isNonEmptyString(value['description'])) errors.push('description is required.');
  const contentHash = value['contentHash'];
  if (!isNonEmptyString(contentHash) || !DIGEST_PATTERN.test(contentHash)) {
    errors.push('contentHash must be a lowercase sha256 digest.');
  }
  if (!['sparse', 'balanced', 'dense'].includes(String(value['density']))) {
    errors.push('density must be sparse, balanced or dense.');
  }
  for (const key of [
    'narrativeJobs',
    'requiredTokens',
    'positivePatterns',
    'forbiddenPatterns',
    'evidenceRequirements',
    'receiptIds',
    'knownLimitations',
  ] as const) {
    if (!isStringArray(value[key])) errors.push(`${key} must be an array of non-empty strings.`);
  }
  const maturity = value['maturity'];
  if (![...ATLAS_MATURITY_ORDER, 'deprecated'].includes(String(maturity) as AtlasMaturity)) {
    errors.push('maturity is not a known level.');
  }

  const archetypeId = value['archetypeId'];
  let archetype: AtlasArchetype | undefined;
  if (!isNonEmptyString(archetypeId)) {
    errors.push('archetypeId is required.');
  } else {
    archetype = findAtlasArchetype(archetypeId);
    if (!archetype) errors.push(`archetypeId ${archetypeId} is not in the Atlas registry.`);
  }

  const artifactKinds = value['artifactKinds'];
  if (!Array.isArray(artifactKinds) || artifactKinds.length === 0) {
    errors.push('artifactKinds must list at least one kind.');
  } else {
    for (const kind of artifactKinds) {
      if (!ATLAS_ARTIFACT_KINDS.includes(kind as never)) {
        errors.push(`artifactKinds contains unknown kind ${String(kind)}.`);
      }
    }
    if (archetype) {
      const satisfies = archetype.requiredArtifactKinds.some((kind) =>
        (artifactKinds as unknown[]).includes(kind),
      );
      if (!satisfies) {
        errors.push(
          `Recipe does not produce any artifact ${archetype.id} requires (${archetype.requiredArtifactKinds.join(', ')}).`,
        );
      }
    }
  }

  if (archetype && isStringArray(value['forbiddenPatterns'])) {
    const declared = new Set(value['forbiddenPatterns']);
    for (const substitute of archetype.forbiddenSubstitutes) {
      if (!declared.has(substitute)) {
        errors.push(`forbiddenPatterns must inherit ${substitute} from ${archetype.id}.`);
      }
    }
  }

  const capability = value['capability'];
  if (!isRecord(capability)) {
    errors.push('capability must be an object.');
  } else {
    for (const target of ['web', 'pptx'] as const) {
      if (!ATLAS_CAPABILITY_LEVELS.includes(capability[target] as never)) {
        errors.push(`capability.${target} is not a known capability level.`);
      }
    }
    // vector-flattened degrades too: the artifact is visually faithful but carries no semantics,
    // so a recipe claiming it must say what the user loses.
    const degrades =
      capability['pptx'] === 'unsupported' ||
      capability['pptx'] === 'poster-frame' ||
      capability['pptx'] === 'rendered-image' ||
      capability['pptx'] === 'vector-flattened';
    if (degrades && !isNonEmptyString(capability['fallbackBehavior'])) {
      errors.push('capability.fallbackBehavior is required when PowerPoint output degrades.');
    }
  }

  validateInputContract(value['inputContract'], errors);

  const reuseMode = value['reuseMode'];
  if (!ATLAS_REUSE_MODES.includes(reuseMode as never)) {
    errors.push('reuseMode is not a known mode.');
  }
  const sourceId = value['sourceId'];
  if (!isNonEmptyString(sourceId)) {
    errors.push('sourceId is required.');
  } else {
    const policy = findAtlasSourcePolicy(sourceId);
    if (!policy) {
      errors.push(`sourceId ${sourceId} has no registered policy; unreviewed sources are denied.`);
    } else if (ATLAS_REUSE_MODES.includes(reuseMode as never)) {
      const required = REUSE_MODE_REQUIREMENTS[reuseMode as AtlasReuseMode];
      for (const permission of required) {
        if (policy.permissions[permission] !== true) {
          errors.push(
            `reuseMode ${String(reuseMode)} needs ${permission} from source ${sourceId}.`,
          );
        }
      }
      if (reuseMode === 'reimplement' && policy.competitiveUseRestricted) {
        errors.push(
          `Source ${sourceId} restricts competitive use, so reimplement is not an available reuse mode.`,
        );
      }
      if (policy.status !== 'approved') {
        errors.push(`Source ${sourceId} is ${policy.status}; recipes may not depend on it.`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateAtlasShowcaseReceipt(value: unknown): AtlasValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['Receipt must be an object.'] };

  if (value['schemaVersion'] !== NODESLIDE_ATLAS_RECEIPT_VERSION) {
    errors.push(`schemaVersion must be ${NODESLIDE_ATLAS_RECEIPT_VERSION}.`);
  }
  for (const key of ['id', 'recipeId', 'archetypeId', 'harnessVersion'] as const) {
    if (!isNonEmptyString(value[key])) errors.push(`${key} is required.`);
  }
  const recipeVersion = value['recipeVersion'];
  if (!isNonEmptyString(recipeVersion) || !VERSION_PATTERN.test(recipeVersion)) {
    errors.push('recipeVersion must be MAJOR.MINOR.PATCH.');
  }
  const model = value['model'];
  if (!isRecord(model) || !isNonEmptyString(model['id']) || !isNonEmptyString(model['role'])) {
    errors.push('model must record both an id and the role it played.');
  }
  for (const key of ['sourceIds', 'referenceIds'] as const) {
    if (!Array.isArray(value[key])) errors.push(`${key} must be an array.`);
  }

  const editability = value['editability'];
  if (!isRecord(editability)) {
    errors.push('editability must be an object.');
  } else {
    for (const target of ['web', 'pptx'] as const) {
      if (!ATLAS_CAPABILITY_LEVELS.includes(editability[target] as never)) {
        errors.push(`editability.${target} is not a known capability level.`);
      }
    }
  }

  const outputs = value['outputs'];
  const outputRefs: Record<string, unknown> = isRecord(outputs) ? outputs : {};
  if (!isRecord(outputs)) errors.push('outputs must be an object.');

  const evaluation = value['evaluation'];
  if (!isRecord(evaluation)) {
    errors.push('evaluation must be an object.');
  } else {
    for (const gate of [
      'briefAdherence',
      'visualPassed',
      'evidencePassed',
      'exportPassed',
    ] as const) {
      if (typeof evaluation[gate] !== 'boolean') {
        errors.push(`evaluation.${gate} must be an explicit boolean.`);
      }
    }
    const repairCount = evaluation['repairCount'];
    if (typeof repairCount !== 'number' || !Number.isFinite(repairCount) || repairCount < 0) {
      errors.push('evaluation.repairCount must be a non-negative finite number.');
    }
    // A pass is only a pass if the artifact it claims to have rendered is referenced.
    if (evaluation['visualPassed'] === true && !isNonEmptyString(outputRefs['browserRenderRef'])) {
      errors.push('evaluation.visualPassed requires outputs.browserRenderRef.');
    }
    if (evaluation['exportPassed'] === true) {
      if (!isNonEmptyString(outputRefs['pptxRenderRef'])) {
        errors.push('evaluation.exportPassed requires outputs.pptxRenderRef.');
      }
      if (!isNonEmptyString(outputRefs['pptxFileRef'])) {
        errors.push('evaluation.exportPassed requires outputs.pptxFileRef.');
      }
    }
    if (
      evaluation['exportPassed'] !== true &&
      isRecord(editability) &&
      (editability['pptx'] === 'editable' || editability['pptx'] === 'native')
    ) {
      errors.push(
        'editability.pptx may not claim editable output when the export gate did not pass.',
      );
    }
  }

  for (const [key, label] of [
    ['costUsd', 'costUsd'],
    ['latencyMs', 'latencyMs'],
  ] as const) {
    const numeric = value[key];
    if (typeof numeric !== 'number' || !Number.isFinite(numeric) || numeric < 0) {
      errors.push(`${label} must be a non-negative finite number.`);
    }
  }
  const producedAt = value['producedAt'];
  if (typeof producedAt !== 'number' || !Number.isFinite(producedAt) || producedAt <= 0) {
    errors.push('producedAt must be a positive epoch timestamp.');
  }
  if (!(value['humanPreferred'] === null || typeof value['humanPreferred'] === 'boolean')) {
    errors.push('humanPreferred must be true, false or null; undefined hides an unjudged result.');
  }

  return { ok: errors.length === 0, errors };
}

/**
 * A recipe may not advertise a maturity its receipts have not earned. This is the gate that stops
 * "we built it" from being displayed as "it is proven".
 */
export function validateAtlasMaturityClaim(
  recipe: Pick<AtlasArtifactRecipe, 'id' | 'maturity' | 'receiptIds'>,
  receipts: readonly AtlasShowcaseReceipt[],
): AtlasValidationResult {
  const earned = earnedAtlasMaturity(recipe, receipts);
  if (recipe.maturity === 'deprecated' || earned === 'deprecated') return { ok: true, errors: [] };
  const claimedRank = atlasMaturityRank(recipe.maturity);
  const earnedRank = atlasMaturityRank(earned);
  if (claimedRank === -1) {
    return {
      ok: false,
      errors: [`Recipe ${recipe.id} claims unknown maturity ${recipe.maturity}.`],
    };
  }
  if (claimedRank > earnedRank) {
    return {
      ok: false,
      errors: [
        `Recipe ${recipe.id} claims ${recipe.maturity} but its receipts only earn ${earned}.`,
      ],
    };
  }
  return { ok: true, errors: [] };
}

export interface AtlasTopologyCandidate {
  archetypeId: string;
  /** Artifact kinds the renderer actually found on the produced slide. */
  producedArtifactKinds: readonly string[];
  /** Named near-misses the critics detected, e.g. `prose-as-architecture`. */
  detectedSubstitutes?: readonly string[];
}

/**
 * The mechanically enforced topology gate. It answers one question: did the slide actually
 * contain the artifact its archetype requires, or did it fall back to prose that describes one?
 */
export function atlasTopologyViolations(candidate: AtlasTopologyCandidate): string[] {
  const violations: string[] = [];
  const archetype = findAtlasArchetype(candidate.archetypeId);
  if (!archetype) return [`Unknown archetype ${candidate.archetypeId}.`];

  const produced = new Set(candidate.producedArtifactKinds);
  const satisfied = archetype.requiredArtifactKinds.some((kind) => produced.has(kind));
  if (!satisfied) {
    violations.push(
      `${archetype.id} requires one of ${archetype.requiredArtifactKinds.join(', ')} but the slide produced ${
        candidate.producedArtifactKinds.length > 0
          ? candidate.producedArtifactKinds.join(', ')
          : 'nothing'
      }.`,
    );
  }
  for (const substitute of candidate.detectedSubstitutes ?? []) {
    if (archetype.forbiddenSubstitutes.includes(substitute)) {
      violations.push(`${archetype.id} forbids the substitute ${substitute}.`);
    }
  }
  return violations;
}
