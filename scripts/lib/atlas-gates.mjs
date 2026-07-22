/**
 * Portable Atlas gates.
 *
 * Dependency-free ESM so any repo can run the gates without building parity-studio's TypeScript.
 * The taxonomy is NOT redeclared here — it is read from the generated `atlas.json` projection,
 * which `node scripts/nodeslide-atlas.mjs export` writes from shared/nodeslideAtlasRegistry.ts.
 *
 * This file duplicates the gate *logic* that shared/nodeslideAtlasValidation.ts implements in
 * TypeScript. That duplication is deliberate and bounded: it is pure set arithmetic, and
 * shared/nodeslideAtlas.test.ts asserts both implementations agree on every archetype and every
 * source-policy/intent pair. If they ever diverge, that test fails.
 */

export function createAtlasGates(atlas) {
  if (!atlas || !Array.isArray(atlas.archetypes) || !Array.isArray(atlas.sourcePolicies)) {
    throw new TypeError('Atlas projection is missing archetypes or sourcePolicies.');
  }

  const archetypesById = new Map(atlas.archetypes.map((entry) => [entry.id, entry]));
  const policiesById = new Map(atlas.sourcePolicies.map((entry) => [entry.id, entry]));
  const permissionByIntent = atlas.permissionByIntent ?? {};
  const accessModeCeiling = atlas.accessModeCeiling ?? {};

  /**
   * The topology gate. Answers whether a produced slide actually contains the artifact its
   * archetype requires, from the artifact kinds the renderer observed — never from what the
   * generating model said it made.
   */
  function topologyViolations({ archetypeId, producedArtifactKinds, detectedSubstitutes }) {
    const archetype = archetypesById.get(archetypeId);
    if (!archetype) return [`Unknown archetype ${archetypeId}.`];

    const produced = new Set(producedArtifactKinds ?? []);
    const violations = [];
    if (!archetype.requiredArtifactKinds.some((kind) => produced.has(kind))) {
      const observed =
        producedArtifactKinds && producedArtifactKinds.length > 0
          ? producedArtifactKinds.join(', ')
          : 'nothing';
      violations.push(
        `${archetype.id} requires one of ${archetype.requiredArtifactKinds.join(', ')} but the slide produced ${observed}.`,
      );
    }
    for (const substitute of detectedSubstitutes ?? []) {
      if (archetype.forbiddenSubstitutes.includes(substitute)) {
        violations.push(`${archetype.id} forbids the substitute ${substitute}.`);
      }
    }
    return violations;
  }

  /** Fail-closed licence gate. Mirrors evaluateAtlasUsage in shared/nodeslideAtlas.ts. */
  function evaluateUsage(sourceId, intents) {
    const policy = policiesById.get(sourceId);
    if (!policy) {
      return {
        allowed: false,
        reasons: ['No source policy is registered; unreviewed sources are denied.'],
        attributionRequired: true,
      };
    }
    const reasons = [];
    if (policy.status !== 'approved') {
      reasons.push(`Source ${policy.id} is ${policy.status}, not approved.`);
    }
    if (!Array.isArray(intents) || intents.length === 0) {
      reasons.push('At least one usage intent must be declared.');
    }
    for (const intent of intents ?? []) {
      const permission = permissionByIntent[intent];
      if (!permission) {
        reasons.push(`Unknown usage intent ${intent} is denied.`);
        continue;
      }
      const ceiling = accessModeCeiling[policy.accessMode] ?? [];
      if (!ceiling.includes(permission)) {
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

  function listArchetypes() {
    return atlas.archetypes;
  }

  function findArchetype(id) {
    return archetypesById.get(id);
  }

  return { topologyViolations, evaluateUsage, listArchetypes, findArchetype };
}

const SATISFYING_REPRESENTATIONS = ['native-semantic', 'structured-semantic'];

/**
 * Resolve an observation into a verdict. Mirrors resolveRequirementVerdict in
 * shared/nodeslideAtlas.ts; shared/nodeslideAtlas.test.ts asserts the two agree.
 *
 * Representation and verdict are orthogonal. A degraded representation is a violation unless the
 * recipe declared it as a fallback in advance, in which case it is an honest degradation — still
 * not a pass on the native requirement.
 */
export function resolveRequirementVerdict({
  requiredArtifactKind,
  observedRepresentation,
  declaredFallback,
}) {
  if (observedRepresentation === 'indeterminate') {
    return {
      verdict: 'indeterminate',
      reason: `This inspection cannot observe whether a ${requiredArtifactKind} is present.`,
    };
  }
  if (SATISFYING_REPRESENTATIONS.includes(observedRepresentation)) {
    return { verdict: 'pass', reason: `A semantic ${requiredArtifactKind} object is present.` };
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

/**
 * Resolve a foreign vocabulary onto Atlas archetype ids.
 *
 * The Atlas v1/v2 decks use their own `artifactType` names. Rather than rename their fixtures,
 * map them. An unmapped type resolves to `null`, which the runner reports as ungated rather than
 * silently passing — an unknown type is the one case where "no violations" would be a lie.
 */
export function resolveArchetypeId(artifactType, mapping) {
  if (typeof artifactType !== 'string' || artifactType.length === 0) return null;
  const direct = mapping[artifactType];
  if (direct) return direct;
  const normalized = artifactType
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  return mapping[normalized] ?? null;
}
