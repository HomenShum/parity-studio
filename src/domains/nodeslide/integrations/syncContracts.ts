import type {
  BoundingBox,
  DeckSnapshot,
  ElementStyle,
  PatchOperation,
  PatchScope,
} from '../../../../shared/nodeslide';
import { operationElementIds } from '../../../../shared/nodeslide';

export type PresentationSyncProviderId = 'google_slides';
export type SyncCapabilitySupport = 'supported' | 'conditional' | 'unsupported';

export interface PresentationSyncCapabilities {
  provider: PresentationSyncProviderId;
  readPresentation: SyncCapabilitySupport;
  inboundPatchPlanning: SyncCapabilitySupport;
  outboundWritePlanning: SyncCapabilitySupport;
  revisionGuardedWrites: SyncCapabilitySupport;
  structuralSlides: SyncCapabilitySupport;
  structuralElements: SyncCapabilitySupport;
  text: SyncCapabilitySupport;
  geometry: SyncCapabilitySupport;
  styling: SyncCapabilitySupport;
  images: SyncCapabilitySupport;
  charts: SyncCapabilitySupport;
  groups: SyncCapabilitySupport;
  comments: SyncCapabilitySupport;
  limitations: readonly string[];
}

export type SyncObjectKind = 'deck' | 'slide' | 'element';

export interface SyncObjectLink {
  kind: SyncObjectKind;
  localId: string;
  remoteId: string;
  /** Versioned semantic identity used to recover when a provider rewrites object IDs. */
  semanticFingerprint: string;
  /** Required for elements so mappings remain unambiguous after slide deletion. */
  localSlideId?: string;
  remoteSlideId?: string;
}

export interface SyncObjectMapping {
  provider: PresentationSyncProviderId;
  localDeckId: string;
  remotePresentationId: string;
  links: readonly SyncObjectLink[];
}

export interface SyncObjectMappingIndex {
  localToRemote: ReadonlyMap<string, SyncObjectLink>;
  remoteToLocal: ReadonlyMap<string, SyncObjectLink>;
}

export type SyncDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface SyncDiagnostic {
  code: string;
  severity: SyncDiagnosticSeverity;
  message: string;
  localId?: string;
  remoteId?: string;
  path?: string;
}

export interface SyncConflict {
  code: 'concurrent_change' | 'delete_vs_edit' | 'unsupported_change' | 'mapping_collision';
  path: string;
  message: string;
  resolution: 'manual';
  localId?: string;
  remoteId?: string;
  baseValue?: unknown;
  localValue?: unknown;
  remoteValue?: unknown;
}

export interface StagedSyncObjectLink extends SyncObjectLink {
  /** The link must only be persisted after this side of the plan succeeds. */
  commitAfter: 'verified_read' | 'inbound_patch' | 'outbound_batch_update';
}

export interface NormalizedPresentationElement {
  remoteId: string;
  remoteSlideId: string;
  kind: 'text' | 'shape' | 'image' | 'chart' | 'video' | 'connector' | 'unsupported';
  name: string;
  bbox: BoundingBox;
  rotation: number;
  /** Provider-neutral geometry basis retained so an adapter can plan an absolute transform. */
  intrinsicWidthEmu?: number;
  intrinsicHeightEmu?: number;
  content?: string;
  style: ElementStyle;
  imageUrl?: string;
  altText?: string;
  rawKind: string;
  writable: boolean;
  lossy: boolean;
}

export interface NormalizedPresentationSlide {
  remoteId: string;
  title: string;
  notes?: string;
  background: string;
  elements: readonly NormalizedPresentationElement[];
}

export interface NormalizedPresentationState {
  provider: PresentationSyncProviderId;
  remotePresentationId: string;
  /** Opaque provider revision. Absence means outbound planning must be blocked. */
  revisionId?: string;
  title: string;
  pageWidthEmu: number;
  pageHeightEmu: number;
  slides: readonly NormalizedPresentationSlide[];
}

export interface PresentationSyncBaseline {
  local: DeckSnapshot;
  remote: NormalizedPresentationState;
  mapping: SyncObjectMapping;
}

export interface CandidatePatchPlan {
  kind: 'candidate_patch';
  provider: PresentationSyncProviderId;
  deckId: string;
  remotePresentationId: string;
  baseDeckVersion: number;
  baseSlideVersions: Record<string, number>;
  baseElementVersions: Record<string, number>;
  scope: PatchScope;
  operations: PatchOperation[];
  conflicts: SyncConflict[];
  diagnostics: SyncDiagnostic[];
  stagedMappingLinks: StagedSyncObjectLink[];
  /** This plan is data only. A caller must persist it as an unapplied review proposal. */
  commit: {
    authority: 'nodeslide.proposePatch';
    usesCompareAndSwap: true;
    requiresHumanAcceptance: true;
  };
}

export function createSyncObjectMappingIndex(mapping: SyncObjectMapping): SyncObjectMappingIndex {
  const localToRemote = new Map<string, SyncObjectLink>();
  const remoteToLocal = new Map<string, SyncObjectLink>();
  for (const link of mapping.links) {
    const localKey = mappingKey(link.kind, link.localId);
    const remoteKey = mappingKey(link.kind, link.remoteId);
    if (localToRemote.has(localKey)) {
      throw new Error(`Duplicate ${link.kind} mapping for local object ${link.localId}.`);
    }
    if (remoteToLocal.has(remoteKey)) {
      throw new Error(`Duplicate ${link.kind} mapping for remote object ${link.remoteId}.`);
    }
    localToRemote.set(localKey, link);
    remoteToLocal.set(remoteKey, link);
  }
  return { localToRemote, remoteToLocal };
}

/** Deterministic, versioned, non-cryptographic fingerprint for mapping recovery (not security). */
export function syncSemanticFingerprint(value: unknown): string {
  const serialized = stableSerialize(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `sync-semantic/v1:${(hash >>> 0).toString(36)}`;
}

export function syncSemanticEqual(left: unknown, right: unknown): boolean {
  return stableSerialize(left) === stableSerialize(right);
}

export function mappedRemoteId(
  index: SyncObjectMappingIndex,
  kind: SyncObjectKind,
  localId: string,
): string | undefined {
  return index.localToRemote.get(mappingKey(kind, localId))?.remoteId;
}

export function mappedLocalId(
  index: SyncObjectMappingIndex,
  kind: SyncObjectKind,
  remoteId: string,
): string | undefined {
  return index.remoteToLocal.get(mappingKey(kind, remoteId))?.localId;
}

export function createCandidatePatchPlan(input: {
  provider: PresentationSyncProviderId;
  snapshot: DeckSnapshot;
  remotePresentationId: string;
  operations: readonly PatchOperation[];
  conflicts?: readonly SyncConflict[];
  diagnostics?: readonly SyncDiagnostic[];
  stagedMappingLinks?: readonly StagedSyncObjectLink[];
}): CandidatePatchPlan {
  const operations = [...input.operations];
  const touchedSlideIds = new Set<string>();
  const touchedElementIds = new Set<string>();
  const existingElementIds = new Set(input.snapshot.elements.map((element) => element.id));

  for (const operation of operations) {
    if (operation.op !== 'update_deck' && operation.op !== 'add_slide') {
      touchedSlideIds.add(operation.slideId);
    }
    if (operation.op === 'remove_slide') {
      for (const element of input.snapshot.elements) {
        if (element.slideId === operation.slideId) touchedElementIds.add(element.id);
      }
      continue;
    }
    for (const elementId of operationElementIds(operation)) {
      if (existingElementIds.has(elementId)) touchedElementIds.add(elementId);
    }
  }

  const scope: PatchScope = {
    kind: 'deck',
    deckId: input.snapshot.deck.id,
    operationMode: 'unrestricted',
  };

  return {
    kind: 'candidate_patch',
    provider: input.provider,
    deckId: input.snapshot.deck.id,
    remotePresentationId: input.remotePresentationId,
    baseDeckVersion: input.snapshot.deck.version,
    baseSlideVersions: Object.fromEntries(
      input.snapshot.slides
        .filter((slide) => touchedSlideIds.has(slide.id))
        .map((slide) => [slide.id, slide.version]),
    ),
    baseElementVersions: Object.fromEntries(
      input.snapshot.elements
        .filter((element) => touchedElementIds.has(element.id))
        .map((element) => [element.id, element.version]),
    ),
    scope,
    operations,
    conflicts: [...(input.conflicts ?? [])],
    diagnostics: [...(input.diagnostics ?? [])],
    stagedMappingLinks: [...(input.stagedMappingLinks ?? [])],
    commit: {
      authority: 'nodeslide.proposePatch',
      usesCompareAndSwap: true,
      requiresHumanAcceptance: true,
    },
  };
}

function mappingKey(kind: SyncObjectKind, id: string): string {
  return `${kind}:${id}`;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(',')}}`;
}
