import type {
  AtlasArchetype,
  AtlasCapabilityLevel,
  AtlasObservedRepresentation,
  AtlasRequirementDecision,
  AtlasUsageDecision,
} from '../../shared/nodeslideAtlas';

export interface AtlasTopologyCandidateInput {
  archetypeId: string;
  producedArtifactKinds?: readonly string[];
  detectedSubstitutes?: readonly string[];
}

export interface AtlasProjection {
  archetypes: AtlasArchetype[];
  sourcePolicies: unknown[];
  permissionByIntent?: Record<string, string>;
  accessModeCeiling?: Record<string, readonly string[]>;
}

export interface AtlasGates {
  topologyViolations(candidate: AtlasTopologyCandidateInput): string[];
  evaluateUsage(sourceId: string, intents: readonly string[]): AtlasUsageDecision;
  listArchetypes(): AtlasArchetype[];
  findArchetype(id: string): AtlasArchetype | undefined;
}

export function createAtlasGates(atlas: unknown): AtlasGates;

export function resolveRequirementVerdict(input: {
  requiredArtifactKind: string;
  observedRepresentation: AtlasObservedRepresentation;
  declaredFallback?: { capability: AtlasCapabilityLevel; behavior: string } | null;
}): AtlasRequirementDecision;

export function resolveArchetypeId(
  artifactType: string | null | undefined,
  mapping: Record<string, string>,
): string | null;
