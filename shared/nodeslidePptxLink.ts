import type { DeckSnapshot } from './nodeslide';
import { nodeSlideDurableDigest } from './nodeslideDurableSession';

export const NODESLIDE_PPTX_LINK_VERSION = 'nodeslide.pptx-link/v1' as const;
export const NODESLIDE_PPTX_SEMANTIC_IDENTITY_VERSION =
  'nodeslide.pptx-semantic-identity/v1' as const;

export const NODESLIDE_PPTX_LINK_LIMITS = {
  entities: 4_096,
  unsupportedConstructs: 256,
  propertiesPerEntity: 32,
  documentBytes: 4 * 1_024 * 1_024,
  valueDepth: 8,
  identifierCharacters: 256,
  stringCharacters: 4_096,
} as const;

export type NodeSlidePptxSide = 'local' | 'remote';
export type NodeSlidePptxSyncDirection = 'inbound' | 'outbound';
export type NodeSlidePptxEntityKind = 'deck' | 'slide' | 'element';

export type NodeSlidePptxUnsupportedConstructKind =
  | 'animation'
  | 'transition'
  | 'smartart'
  | 'ole'
  | 'macro'
  | 'embedded_media'
  | 'embedded_font'
  | 'grouped_transform'
  | 'custom_xml'
  | 'digital_signature'
  | 'unknown';

export type NodeSlidePptxUnsupportedHandling =
  | 'block'
  | 'preserve_remote_only'
  | 'manual_confirmation';

export type NodeSlidePptxSyncProperty =
  | 'title'
  | 'notes'
  | 'background'
  | 'order'
  | 'kind'
  | 'role'
  | 'content'
  | 'bbox'
  | 'rotation'
  | 'style'
  | 'chart'
  | 'image'
  | 'altText'
  | 'visibility'
  | 'group';

export type NodeSlidePptxValue =
  | null
  | boolean
  | number
  | string
  | readonly NodeSlidePptxValue[]
  | { readonly [key: string]: NodeSlidePptxValue };

export interface NodeSlidePptxSemanticIdentity {
  schemaVersion: typeof NODESLIDE_PPTX_SEMANTIC_IDENTITY_VERSION;
  fingerprint: string;
  basis: 'source_object_name' | 'named_role' | 'named_object' | 'structural_fallback';
  confidence: 'strong' | 'moderate' | 'weak';
}

export interface NodeSlidePptxSemanticIdentityInput {
  entityKind: NodeSlidePptxEntityKind;
  parentSemanticFingerprint?: string;
  sourceObjectName?: string;
  name?: string;
  semanticRole?: string;
  elementKind?: string;
  text?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  ordinal?: number;
}

export interface NodeSlidePptxSyncEntity {
  kind: NodeSlidePptxEntityKind;
  objectId: string;
  parentObjectId?: string;
  parentSemanticFingerprint?: string;
  identity: NodeSlidePptxSemanticIdentity;
  properties: Partial<Record<NodeSlidePptxSyncProperty, NodeSlidePptxValue>>;
}

export interface NodeSlidePptxUnsupportedConstruct {
  id: string;
  kind: NodeSlidePptxUnsupportedConstructKind;
  handling: NodeSlidePptxUnsupportedHandling;
  blockedDirections: NodeSlidePptxSyncDirection[];
  scope: NodeSlidePptxEntityKind;
  scopeSemanticFingerprint?: string;
  reason: string;
}

export interface NodeSlidePptxSyncDocument {
  side: NodeSlidePptxSide;
  documentId: string;
  revision:
    | { kind: 'nodeslide_deck_version'; value: string }
    | { kind: 'pptx_package_digest'; value: string };
  entities: NodeSlidePptxSyncEntity[];
  unsupportedConstructs: NodeSlidePptxUnsupportedConstruct[];
}

/**
 * Canonical semantic projection shared by the browser importer and Convex runtime. Remote PPTX
 * revisions reuse the re-keyed NodeSlide object identities while binding the exact package digest.
 */
export function nodeSlideSnapshotToPptxSyncDocument(
  snapshot: DeckSnapshot,
  remote?: { documentId: string; packageDigest: string },
): NodeSlidePptxSyncDocument {
  const deckIdentity = nodeSlidePptxSemanticIdentity({
    entityKind: 'deck',
    sourceObjectName: snapshot.deck.id,
  });
  const slideIdentityById = new Map(
    snapshot.slides.map((slide) => [
      slide.id,
      nodeSlidePptxSemanticIdentity({
        entityKind: 'slide',
        parentSemanticFingerprint: deckIdentity.fingerprint,
        sourceObjectName: slide.id,
      }),
    ]),
  );
  const elementIdentityById = new Map(
    snapshot.elements.map((element) => {
      const parent = requiredPptxMapValue(slideIdentityById, element.slideId);
      return [
        element.id,
        nodeSlidePptxSemanticIdentity({
          entityKind: 'element',
          parentSemanticFingerprint: parent.fingerprint,
          sourceObjectName: element.id,
          elementKind: element.kind,
        }),
      ];
    }),
  );
  const entities: NodeSlidePptxSyncEntity[] = [
    {
      kind: 'deck',
      objectId: snapshot.deck.id,
      identity: deckIdentity,
      properties: {
        title: snapshot.deck.title,
        order: snapshot.deck.slideOrder.map(
          (id) => requiredPptxMapValue(slideIdentityById, id).fingerprint,
        ),
      },
    },
    ...snapshot.slides.map((slide): NodeSlidePptxSyncEntity => {
      const identity = requiredPptxMapValue(slideIdentityById, slide.id);
      return {
        kind: 'slide',
        objectId: slide.id,
        parentObjectId: snapshot.deck.id,
        parentSemanticFingerprint: deckIdentity.fingerprint,
        identity,
        properties: compactPptxProperties({
          title: slide.title,
          notes: slide.notes,
          background: pptxJsonValue(slide.background),
          order: slide.elementOrder.map(
            (id) => requiredPptxMapValue(elementIdentityById, id).fingerprint,
          ),
        }),
      };
    }),
    ...snapshot.elements.map((element): NodeSlidePptxSyncEntity => {
      const parentIdentity = requiredPptxMapValue(slideIdentityById, element.slideId);
      return {
        kind: 'element',
        objectId: element.id,
        parentObjectId: element.slideId,
        parentSemanticFingerprint: parentIdentity.fingerprint,
        identity: requiredPptxMapValue(elementIdentityById, element.id),
        properties: compactPptxProperties({
          kind: element.kind,
          role: element.role,
          content: element.content,
          bbox: pptxJsonValue(element.bbox),
          rotation: element.rotation,
          style: pptxJsonValue(element.style),
          chart: element.chart ? pptxJsonValue(element.chart) : undefined,
          image: element.image
            ? pptxJsonValue(element.image)
            : element.imageUrl
              ? element.imageUrl
              : undefined,
          altText: element.altText,
          visibility: element.visible,
          group: element.groupId,
        }),
      };
    }),
  ];
  const side = remote ? 'remote' : 'local';
  return normalizeNodeSlidePptxSyncDocument(
    {
      side,
      documentId: remote?.documentId ?? snapshot.deck.id,
      revision: remote
        ? { kind: 'pptx_package_digest', value: remote.packageDigest }
        : { kind: 'nodeslide_deck_version', value: String(snapshot.deck.version) },
      entities,
      unsupportedConstructs: [],
    },
    side,
  );
}

function compactPptxProperties(
  values: Partial<Record<NodeSlidePptxSyncProperty, NodeSlidePptxValue | undefined>>,
): Partial<Record<NodeSlidePptxSyncProperty, NodeSlidePptxValue>> {
  return Object.fromEntries(
    Object.entries(values).filter(
      (entry): entry is [string, NodeSlidePptxValue] => entry[1] !== undefined,
    ),
  );
}

function pptxJsonValue(value: unknown): NodeSlidePptxValue {
  return JSON.parse(JSON.stringify(value)) as NodeSlidePptxValue;
}

function requiredPptxMapValue<T>(map: Map<string, T>, key: string): T {
  const value = map.get(key);
  if (!value) throw new Error(`NodeSlide PPTX semantic identity is missing for ${key}.`);
  return value;
}

export interface NodeSlidePptxBaselineEntity {
  kind: NodeSlidePptxEntityKind;
  semanticIdentity: NodeSlidePptxSemanticIdentity;
  localObjectId: string;
  remoteObjectId: string;
  localParentObjectId?: string;
  remoteParentObjectId?: string;
  parentSemanticFingerprint?: string;
  /** Canonical NodeSlide-side baseline. */
  properties: Partial<Record<NodeSlidePptxSyncProperty, NodeSlidePptxValue>>;
  stateDigest: string;
  /** Format-normalized PowerPoint-side baseline. It may differ without representing a user edit. */
  remoteProperties?: Partial<Record<NodeSlidePptxSyncProperty, NodeSlidePptxValue>>;
  remoteStateDigest?: string;
}

export interface NodeSlidePptxLinkedBaseline {
  schemaVersion: typeof NODESLIDE_PPTX_LINK_VERSION;
  linkId: string;
  localDeckId: string;
  remoteArtifactId: string;
  localDeckVersion: number;
  localSnapshotDigest: string;
  remotePackageDigest: string;
  remoteSnapshotDigest: string;
  entities: NodeSlidePptxBaselineEntity[];
  unsupportedConstructs: NodeSlidePptxUnsupportedConstruct[];
  createdAt: number;
  baselineDigest: string;
}

export function nodeSlidePptxSemanticIdentity(
  input: NodeSlidePptxSemanticIdentityInput,
): NodeSlidePptxSemanticIdentity {
  const parent = input.parentSemanticFingerprint
    ? requireSemanticFingerprint(input.parentSemanticFingerprint)
    : null;
  if (input.entityKind !== 'deck' && !parent) {
    throw new Error('PPTX semantic identity requires a parent for slides and elements.');
  }

  const sourceObjectName = optionalIdentityText(input.sourceObjectName);
  const name = optionalIdentityText(input.name);
  const semanticRole = optionalIdentityText(input.semanticRole);
  const elementKind = optionalIdentityText(input.elementKind);
  let basis: NodeSlidePptxSemanticIdentity['basis'];
  let confidence: NodeSlidePptxSemanticIdentity['confidence'];
  let key: unknown;

  if (sourceObjectName) {
    basis = 'source_object_name';
    confidence = 'strong';
    key = { entityKind: input.entityKind, parent, sourceObjectName };
  } else if (name && semanticRole) {
    basis = 'named_role';
    confidence = 'moderate';
    key = { entityKind: input.entityKind, parent, name, semanticRole, elementKind };
  } else if (name) {
    basis = 'named_object';
    confidence = 'moderate';
    key = { entityKind: input.entityKind, parent, name, elementKind };
  } else {
    const ordinal = requireOrdinal(input.ordinal);
    const text = optionalIdentityText(input.text)?.slice(0, 96) ?? null;
    if (input.entityKind === 'element' && !elementKind) {
      throw new Error('Fallback PPTX element identity requires an element kind.');
    }
    basis = 'structural_fallback';
    confidence = 'weak';
    key = {
      entityKind: input.entityKind,
      parent,
      elementKind,
      ordinal,
      text,
      bbox: input.bbox ? coarseBoundingBox(input.bbox) : null,
    };
  }

  return {
    schemaVersion: NODESLIDE_PPTX_SEMANTIC_IDENTITY_VERSION,
    fingerprint: semanticFingerprint({ basis, key }),
    basis,
    confidence,
  };
}

export function createNodeSlidePptxLinkedBaseline(args: {
  linkId: string;
  local: NodeSlidePptxSyncDocument;
  remote: NodeSlidePptxSyncDocument;
  createdAt: number;
}): NodeSlidePptxLinkedBaseline {
  const linkId = requireIdentifier(args.linkId, 'PPTX link ID');
  const local = normalizeNodeSlidePptxSyncDocument(args.local, 'local');
  const remote = normalizeNodeSlidePptxSyncDocument(args.remote, 'remote');
  const localDeckVersion = requirePositiveIntegerString(
    local.revision.kind === 'nodeslide_deck_version' ? local.revision.value : '',
    'Local deck version',
  );
  const remotePackageDigest = requireSha256Digest(
    remote.revision.kind === 'pptx_package_digest' ? remote.revision.value : '',
    'Remote PPTX package digest',
  );
  if (!Number.isFinite(args.createdAt) || args.createdAt < 0) {
    throw new Error('PPTX baseline creation time must be a non-negative finite timestamp.');
  }

  const localByIdentity = uniqueEntityMap(local.entities, 'local baseline');
  const remoteByIdentity = uniqueEntityMap(remote.entities, 'remote baseline');
  const identities = [...new Set([...localByIdentity.keys(), ...remoteByIdentity.keys()])].sort();
  const entities = identities
    .map((fingerprint): NodeSlidePptxBaselineEntity => {
      const localEntity = localByIdentity.get(fingerprint);
      const remoteEntity = remoteByIdentity.get(fingerprint);
      if (!localEntity || !remoteEntity) {
        throw new Error(
          'A linked PPTX baseline must contain the same semantic entities on both sides.',
        );
      }
      const localStateDigest = nodeSlidePptxEntityStateDigest(localEntity);
      const remoteStateDigest = nodeSlidePptxEntityStateDigest(remoteEntity);
      if (localEntity.kind !== remoteEntity.kind) {
        throw new Error('A linked PPTX baseline must map the same semantic entity kinds.');
      }
      return {
        kind: localEntity.kind,
        semanticIdentity: localEntity.identity,
        localObjectId: localEntity.objectId,
        remoteObjectId: remoteEntity.objectId,
        ...(localEntity.parentObjectId ? { localParentObjectId: localEntity.parentObjectId } : {}),
        ...(remoteEntity.parentObjectId
          ? { remoteParentObjectId: remoteEntity.parentObjectId }
          : {}),
        ...(localEntity.parentSemanticFingerprint
          ? { parentSemanticFingerprint: localEntity.parentSemanticFingerprint }
          : {}),
        properties: localEntity.properties,
        stateDigest: localStateDigest,
        remoteProperties: remoteEntity.properties,
        remoteStateDigest,
      };
    })
    .sort(compareBaselineEntities);

  const core = {
    schemaVersion: NODESLIDE_PPTX_LINK_VERSION,
    linkId,
    localDeckId: local.documentId,
    remoteArtifactId: remote.documentId,
    localDeckVersion,
    localSnapshotDigest: nodeSlidePptxDocumentDigest(local),
    remotePackageDigest,
    remoteSnapshotDigest: nodeSlidePptxDocumentDigest(remote),
    entities,
    unsupportedConstructs: remote.unsupportedConstructs,
    createdAt: args.createdAt,
  };
  return { ...core, baselineDigest: nodeSlideDurableDigest(core) };
}

export function assertNodeSlidePptxLinkedBaseline(
  baseline: NodeSlidePptxLinkedBaseline,
): NodeSlidePptxLinkedBaseline {
  if (baseline.schemaVersion !== NODESLIDE_PPTX_LINK_VERSION) {
    throw new Error('Unsupported PPTX linked baseline version.');
  }
  requireIdentifier(baseline.linkId, 'PPTX link ID');
  requireIdentifier(baseline.localDeckId, 'Local deck ID');
  requireIdentifier(baseline.remoteArtifactId, 'Remote artifact ID');
  requirePositiveInteger(baseline.localDeckVersion, 'Local deck version');
  requireSha256Digest(baseline.localSnapshotDigest, 'Local snapshot digest');
  requireSha256Digest(baseline.remotePackageDigest, 'Remote package digest');
  requireSha256Digest(baseline.remoteSnapshotDigest, 'Remote snapshot digest');
  if (baseline.entities.length > NODESLIDE_PPTX_LINK_LIMITS.entities) {
    throw new Error('PPTX linked baseline exceeds its entity limit.');
  }
  const identities = new Set<string>();
  for (const entity of baseline.entities) {
    const fingerprint = requireSemanticFingerprint(entity.semanticIdentity.fingerprint);
    if (identities.has(fingerprint)) throw new Error('PPTX linked baseline identity collision.');
    identities.add(fingerprint);
    requireIdentifier(entity.localObjectId, 'Local baseline object ID');
    requireIdentifier(entity.remoteObjectId, 'Remote baseline object ID');
    if (nodeSlidePptxBaselineEntityStateDigest(entity) !== entity.stateDigest) {
      throw new Error('PPTX linked baseline entity digest mismatch.');
    }
    if (nodeSlidePptxBaselineRemoteEntityStateDigest(entity) !== remoteBaselineDigest(entity)) {
      throw new Error('PPTX linked remote baseline entity digest mismatch.');
    }
  }
  const { baselineDigest: _baselineDigest, ...core } = baseline;
  if (nodeSlideDurableDigest(core) !== baseline.baselineDigest) {
    throw new Error('PPTX linked baseline digest mismatch.');
  }
  return baseline;
}

export function normalizeNodeSlidePptxSyncDocument(
  input: NodeSlidePptxSyncDocument,
  expectedSide?: NodeSlidePptxSide,
): NodeSlidePptxSyncDocument {
  if (expectedSide && input.side !== expectedSide) {
    throw new Error(`Expected the ${expectedSide} PPTX sync document.`);
  }
  const documentId = requireIdentifier(input.documentId, 'PPTX sync document ID');
  if (input.entities.length < 1 || input.entities.length > NODESLIDE_PPTX_LINK_LIMITS.entities) {
    throw new Error(
      `PPTX sync document must contain 1-${NODESLIDE_PPTX_LINK_LIMITS.entities} entities.`,
    );
  }
  if (input.unsupportedConstructs.length > NODESLIDE_PPTX_LINK_LIMITS.unsupportedConstructs) {
    throw new Error('PPTX sync document exceeds its unsupported-construct limit.');
  }
  const objectIds = new Set<string>();
  const entities = input.entities.map((entity) => {
    const objectId = requireIdentifier(entity.objectId, 'PPTX object ID');
    if (objectIds.has(objectId))
      throw new Error('PPTX sync document contains an object ID collision.');
    objectIds.add(objectId);
    const fingerprint = requireSemanticFingerprint(entity.identity.fingerprint);
    if (entity.identity.schemaVersion !== NODESLIDE_PPTX_SEMANTIC_IDENTITY_VERSION) {
      throw new Error('Unsupported PPTX semantic identity version.');
    }
    if (entity.kind === 'deck') {
      if (entity.parentObjectId || entity.parentSemanticFingerprint) {
        throw new Error('A PPTX deck entity cannot have a parent.');
      }
    } else if (!entity.parentObjectId || !entity.parentSemanticFingerprint) {
      throw new Error('PPTX slide and element entities require object and semantic parents.');
    }
    const properties = normalizeProperties(entity.properties);
    return {
      kind: entity.kind,
      objectId,
      ...(entity.parentObjectId
        ? { parentObjectId: requireIdentifier(entity.parentObjectId, 'PPTX parent object ID') }
        : {}),
      ...(entity.parentSemanticFingerprint
        ? {
            parentSemanticFingerprint: requireSemanticFingerprint(entity.parentSemanticFingerprint),
          }
        : {}),
      identity: { ...entity.identity, fingerprint },
      properties,
    };
  });
  assertParentLinks(entities);
  const unsupportedConstructs = input.unsupportedConstructs
    .map(normalizeUnsupportedConstruct)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(unsupportedConstructs.map((item) => item.id)).size !== unsupportedConstructs.length) {
    throw new Error('PPTX sync document contains an unsupported-construct ID collision.');
  }
  const revision = normalizeRevision(input.side, input.revision);
  const normalized = {
    side: input.side,
    documentId,
    revision,
    entities: [...entities].sort(compareEntities),
    unsupportedConstructs,
  } satisfies NodeSlidePptxSyncDocument;
  if (byteLength(JSON.stringify(normalized)) > NODESLIDE_PPTX_LINK_LIMITS.documentBytes) {
    throw new Error('PPTX sync document exceeds its byte limit.');
  }
  return normalized;
}

export function nodeSlidePptxEntityStateDigest(entity: NodeSlidePptxSyncEntity): string {
  return nodeSlideDurableDigest({
    kind: entity.kind,
    parentSemanticFingerprint: entity.parentSemanticFingerprint ?? null,
    properties: entity.properties,
  });
}

export function nodeSlidePptxBaselineEntityStateDigest(
  entity: NodeSlidePptxBaselineEntity,
): string {
  return nodeSlideDurableDigest({
    kind: entity.kind,
    parentSemanticFingerprint: entity.parentSemanticFingerprint ?? null,
    properties: entity.properties,
  });
}

export function nodeSlidePptxBaselineRemoteEntityStateDigest(
  entity: NodeSlidePptxBaselineEntity,
): string {
  return nodeSlideDurableDigest({
    kind: entity.kind,
    parentSemanticFingerprint: entity.parentSemanticFingerprint ?? null,
    properties: entity.remoteProperties ?? entity.properties,
  });
}

export function remoteBaselineDigest(entity: NodeSlidePptxBaselineEntity): string {
  return entity.remoteStateDigest ?? entity.stateDigest;
}

export function nodeSlidePptxDocumentDigest(document: NodeSlidePptxSyncDocument): string {
  return nodeSlideDurableDigest({
    documentId: document.documentId,
    entities: document.entities.map((entity) => ({
      semanticFingerprint: entity.identity.fingerprint,
      stateDigest: nodeSlidePptxEntityStateDigest(entity),
    })),
    unsupportedConstructs: document.unsupportedConstructs,
  });
}

export function nodeSlidePptxChangedProperties(
  baseline: Pick<NodeSlidePptxBaselineEntity, 'parentSemanticFingerprint' | 'properties'>,
  current: Pick<NodeSlidePptxSyncEntity, 'parentSemanticFingerprint' | 'properties'>,
): string[] {
  const changed = new Set<string>();
  if (
    (baseline.parentSemanticFingerprint ?? null) !== (current.parentSemanticFingerprint ?? null)
  ) {
    changed.add('parent');
  }
  for (const key of new Set([
    ...Object.keys(baseline.properties),
    ...Object.keys(current.properties),
  ])) {
    if (
      nodeSlideDurableDigest(baseline.properties[key as NodeSlidePptxSyncProperty]) !==
      nodeSlideDurableDigest(current.properties[key as NodeSlidePptxSyncProperty])
    ) {
      changed.add(key);
    }
  }
  return [...changed].sort();
}

function normalizeRevision(
  side: NodeSlidePptxSide,
  revision: NodeSlidePptxSyncDocument['revision'],
): NodeSlidePptxSyncDocument['revision'] {
  if (side === 'local') {
    if (revision.kind !== 'nodeslide_deck_version') {
      throw new Error('Local PPTX sync state requires a NodeSlide deck version.');
    }
    return {
      kind: revision.kind,
      value: String(requirePositiveIntegerString(revision.value, 'Deck version')),
    };
  }
  if (revision.kind !== 'pptx_package_digest') {
    throw new Error('Remote PPTX sync state requires a package digest.');
  }
  return { kind: revision.kind, value: requireSha256Digest(revision.value, 'PPTX package digest') };
}

function normalizeUnsupportedConstruct(
  input: NodeSlidePptxUnsupportedConstruct,
): NodeSlidePptxUnsupportedConstruct {
  const id = requireIdentifier(input.id, 'Unsupported construct ID');
  const reason = requireBoundedText(input.reason, 'Unsupported construct reason');
  const blockedDirections = [...new Set(input.blockedDirections)].sort();
  if (input.handling !== 'preserve_remote_only' && blockedDirections.length < 1) {
    throw new Error('Blocking unsupported constructs require at least one blocked direction.');
  }
  if (input.handling === 'preserve_remote_only' && !blockedDirections.includes('outbound')) {
    throw new Error('Remote-only PPTX constructs must block outbound replacement.');
  }
  if (input.scope === 'deck' && input.scopeSemanticFingerprint) {
    throw new Error('Deck-scoped unsupported constructs cannot include a scope fingerprint.');
  }
  if (input.scope !== 'deck' && !input.scopeSemanticFingerprint) {
    throw new Error('Scoped unsupported constructs require a semantic fingerprint.');
  }
  return {
    id,
    kind: input.kind,
    handling: input.handling,
    blockedDirections,
    scope: input.scope,
    ...(input.scopeSemanticFingerprint
      ? { scopeSemanticFingerprint: requireSemanticFingerprint(input.scopeSemanticFingerprint) }
      : {}),
    reason,
  };
}

function normalizeProperties(
  properties: NodeSlidePptxSyncEntity['properties'],
): NodeSlidePptxSyncEntity['properties'] {
  const entries = Object.entries(properties).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length > NODESLIDE_PPTX_LINK_LIMITS.propertiesPerEntity) {
    throw new Error('PPTX sync entity exceeds its property limit.');
  }
  const normalized: Partial<Record<NodeSlidePptxSyncProperty, NodeSlidePptxValue>> = {};
  for (const [key, value] of entries) {
    if (!SYNC_PROPERTIES.has(key as NodeSlidePptxSyncProperty)) {
      throw new Error(`Unsupported PPTX sync property ${JSON.stringify(key)}.`);
    }
    normalized[key as NodeSlidePptxSyncProperty] = normalizeValue(value, 0);
  }
  return normalized;
}

function normalizeValue(value: unknown, depth: number): NodeSlidePptxValue {
  if (depth > NODESLIDE_PPTX_LINK_LIMITS.valueDepth) {
    throw new Error('PPTX sync property exceeds its nesting limit.');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('PPTX sync property numbers must be finite.');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > NODESLIDE_PPTX_LINK_LIMITS.stringCharacters) {
      throw new Error('PPTX sync property string exceeds its character limit.');
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item, depth + 1));
  if (typeof value !== 'object') throw new Error('PPTX sync property contains a non-JSON value.');
  const normalized: Record<string, NodeSlidePptxValue> = {};
  for (const key of Object.keys(value).sort()) {
    normalized[key] = normalizeValue((value as Record<string, unknown>)[key], depth + 1);
  }
  return normalized;
}

function uniqueEntityMap(
  entities: readonly NodeSlidePptxSyncEntity[],
  label: string,
): Map<string, NodeSlidePptxSyncEntity> {
  const result = new Map<string, NodeSlidePptxSyncEntity>();
  for (const entity of entities) {
    const fingerprint = entity.identity.fingerprint;
    if (result.has(fingerprint))
      throw new Error(`${label} contains a semantic identity collision.`);
    result.set(fingerprint, entity);
  }
  return result;
}

function assertParentLinks(entities: readonly NodeSlidePptxSyncEntity[]): void {
  const byObjectId = new Map(entities.map((entity) => [entity.objectId, entity]));
  for (const entity of entities) {
    if (!entity.parentObjectId) continue;
    const parent = byObjectId.get(entity.parentObjectId);
    if (!parent || parent.identity.fingerprint !== entity.parentSemanticFingerprint) {
      throw new Error('PPTX sync entity parent binding is invalid.');
    }
    if (entity.kind === 'slide' && parent.kind !== 'deck') {
      throw new Error('A PPTX slide must be parented by the deck.');
    }
    if (entity.kind === 'element' && parent.kind !== 'slide') {
      throw new Error('A PPTX element must be parented by a slide.');
    }
  }
}

function compareEntities(left: NodeSlidePptxSyncEntity, right: NodeSlidePptxSyncEntity): number {
  const order = { deck: 0, slide: 1, element: 2 } as const;
  return (
    order[left.kind] - order[right.kind] ||
    left.identity.fingerprint.localeCompare(right.identity.fingerprint) ||
    left.objectId.localeCompare(right.objectId)
  );
}

function compareBaselineEntities(
  left: NodeSlidePptxBaselineEntity,
  right: NodeSlidePptxBaselineEntity,
): number {
  const order = { deck: 0, slide: 1, element: 2 } as const;
  return (
    order[left.kind] - order[right.kind] ||
    left.semanticIdentity.fingerprint.localeCompare(right.semanticIdentity.fingerprint) ||
    left.localObjectId.localeCompare(right.localObjectId)
  );
}

function semanticFingerprint(value: unknown): string {
  return `sync-semantic/v1:${nodeSlideDurableDigest(value).slice('sha256:'.length)}`;
}

function requireSemanticFingerprint(value: string): string {
  if (!/^sync-semantic\/v1:[0-9a-f]{64}$/u.test(value)) {
    throw new Error('PPTX semantic fingerprint must use the sync-semantic/v1 format.');
  }
  return value;
}

function optionalIdentityText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
  if (!normalized) return undefined;
  if (normalized.length > NODESLIDE_PPTX_LINK_LIMITS.identifierCharacters) {
    throw new Error('PPTX semantic identity signal exceeds its character limit.');
  }
  return normalized;
}

function coarseBoundingBox(value: {
  x: number;
  y: number;
  width: number;
  height: number;
}): number[] {
  const values = [value.x, value.y, value.width, value.height];
  if (values.some((item) => !Number.isFinite(item) || item < 0 || item > 1)) {
    throw new Error('PPTX semantic identity bounding boxes must use normalized coordinates.');
  }
  return values.map((item) => Math.round(item * 20) / 20);
}

function requireOrdinal(value: number | undefined): number {
  if (
    !Number.isSafeInteger(value) ||
    (value ?? -1) < 0 ||
    (value ?? 0) > NODESLIDE_PPTX_LINK_LIMITS.entities
  ) {
    throw new Error('Fallback PPTX semantic identity requires a bounded ordinal.');
  }
  return value as number;
}

function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > NODESLIDE_PPTX_LINK_LIMITS.identifierCharacters ||
    hasControlCharacters(normalized)
  ) {
    throw new Error(`${label} must contain safe bounded text.`);
  }
  return normalized;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function requireBoundedText(value: string, label: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (!normalized || normalized.length > NODESLIDE_PPTX_LINK_LIMITS.stringCharacters) {
    throw new Error(`${label} must contain bounded text.`);
  }
  return normalized;
}

function requirePositiveIntegerString(value: string, label: string): number {
  if (!/^[1-9]\d*$/u.test(value)) throw new Error(`${label} must be a positive integer.`);
  return requirePositiveInteger(Number(value), label);
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label} must be a positive integer.`);
  return value;
}

function requireSha256Digest(value: string, label: string): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) throw new Error(`${label} must be a SHA-256 digest.`);
  return value;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

const SYNC_PROPERTIES = new Set<NodeSlidePptxSyncProperty>([
  'title',
  'notes',
  'background',
  'order',
  'kind',
  'role',
  'content',
  'bbox',
  'rotation',
  'style',
  'chart',
  'image',
  'altText',
  'visibility',
  'group',
]);
