import type { PatchOperation, PatchScope } from '../../../../shared/nodeslide';
import { nodeSlideDurableDigest } from '../../../../shared/nodeslideDurableSession';

export const EXTERNAL_CHANGE_SET_V1_SCHEMA = 'nodeslide.external-change-set/v1' as const;

export const EXTERNAL_CHANGE_SET_V1_SOURCE_SYSTEMS = [
  'pptx',
  'google_slides',
  'json',
  'mcp',
] as const;

export type ExternalChangeSourceSystemV1 = (typeof EXTERNAL_CHANGE_SET_V1_SOURCE_SYSTEMS)[number];
export type ExternalChangeDirectionV1 = 'inbound' | 'outbound';
export type ExternalChangeObjectKindV1 = 'deck' | 'slide' | 'element';
export type ExternalChangeConflictStatusV1 = 'unresolved' | 'resolved';

export interface ExternalRemoteBindingV1 {
  /** Provider/file/tool object being reconciled. */
  objectId: string;
  /** Exact remote revision, file digest, or MCP result version observed for this change set. */
  versionId: string;
  /** Exact three-way-sync/import baseline from which the operations were derived. */
  baselineId: string;
}

export interface ExternalLocalBaseV1 {
  deckId: string;
  deckVersion: number;
  slideVersions: Readonly<Record<string, number>>;
  elementVersions: Readonly<Record<string, number>>;
}

export interface ExternalObjectMappingV1 {
  kind: ExternalChangeObjectKindV1;
  localId: string;
  remoteId: string;
  semanticFingerprint?: string;
  localParentId?: string;
  remoteParentId?: string;
}

export interface ExternalChangeConflictV1 {
  code: string;
  path: string;
  message: string;
  status: ExternalChangeConflictStatusV1;
  resolution?: string;
  localId?: string;
  remoteId?: string;
  baseValue?: unknown;
  localValue?: unknown;
  remoteValue?: unknown;
}

export interface ExternalChangeConflictInputV1 extends Omit<ExternalChangeConflictV1, 'status'> {
  /** Existing integration conflicts omit status and therefore fail closed as unresolved. */
  status?: ExternalChangeConflictStatusV1;
}

export interface ExternalPostWriteVerificationIntentV1 {
  strategy: 'read_after_write';
  /** Must identify the same object as `remote.objectId`. */
  remoteObjectId: string;
  /** Must identify the pre-write version in `remote.versionId`. */
  compareAgainstVersionId: string;
}

export interface ExternalChangeSetV1Input {
  sourceSystem: ExternalChangeSourceSystemV1;
  direction: ExternalChangeDirectionV1;
  remote: ExternalRemoteBindingV1;
  localBase: ExternalLocalBaseV1;
  mapping?: readonly ExternalObjectMappingV1[];
  scope?: PatchScope;
  operations: readonly PatchOperation[];
  conflicts?: readonly ExternalChangeConflictInputV1[];
  postWriteVerification?: ExternalPostWriteVerificationIntentV1;
}

export interface ExternalChangeSetV1 {
  schemaVersion: typeof EXTERNAL_CHANGE_SET_V1_SCHEMA;
  sourceSystem: ExternalChangeSourceSystemV1;
  direction: ExternalChangeDirectionV1;
  remote: ExternalRemoteBindingV1;
  localBase: {
    deckId: string;
    deckVersion: number;
    slideVersions: Record<string, number>;
    elementVersions: Record<string, number>;
  };
  mapping: ExternalObjectMappingV1[];
  scope: PatchScope;
  operations: PatchOperation[];
  conflicts: ExternalChangeConflictV1[];
  postWriteVerification: ExternalPostWriteVerificationIntentV1 | null;
  /** SHA-256 over every canonical field above; the digest field itself is excluded. */
  digest: string;
}

export interface ExternalChangeSetPatchProposalV1 {
  kind: 'candidate_patch';
  authority: 'nodeslide.proposePatch';
  usesCompareAndSwap: true;
  requiresHumanAcceptance: true;
  deckId: string;
  baseDeckVersion: number;
  baseSlideVersions: Record<string, number>;
  baseElementVersions: Record<string, number>;
  scope: PatchScope;
  operations: PatchOperation[];
  externalChangeSetDigest: string;
}

export interface ExternalChangeSetBaselineBindingV1 {
  remote: ExternalRemoteBindingV1;
  localBase: ExternalLocalBaseV1;
}

const PATCH_OPERATION_KINDS = new Set<PatchOperation['op']>([
  'move',
  'resize',
  'replace_text',
  'update_style',
  'update_chart',
  'update_image',
  'add_element',
  'remove_element',
  'set_visibility_v1',
  'group_elements_v1',
  'ungroup_elements_v1',
  'reorder_element_v1',
  'add_slide',
  'remove_slide',
  'reorder_slide',
  'update_slide',
  'update_deck',
]);

/**
 * Produces the single canonical envelope used by file importers and connected providers. Patch
 * operation order is retained because it is semantic; mappings, conflicts, and version maps are
 * canonicalized because their order is not semantic.
 */
export function normalizeExternalChangeSetV1(input: ExternalChangeSetV1Input): ExternalChangeSetV1 {
  if (!EXTERNAL_CHANGE_SET_V1_SOURCE_SYSTEMS.includes(input.sourceSystem)) {
    throw new TypeError(
      `Unsupported external change source system: ${String(input.sourceSystem)}.`,
    );
  }
  if (input.direction !== 'inbound' && input.direction !== 'outbound') {
    throw new TypeError(`Unsupported external change direction: ${String(input.direction)}.`);
  }

  const localBase = {
    deckId: cleanIdentifier(input.localBase.deckId, 'localBase.deckId'),
    deckVersion: exactVersion(input.localBase.deckVersion, 'localBase.deckVersion'),
    slideVersions: normalizeVersionMap(input.localBase.slideVersions, 'localBase.slideVersions'),
    elementVersions: normalizeVersionMap(
      input.localBase.elementVersions,
      'localBase.elementVersions',
    ),
  };
  const remote: ExternalRemoteBindingV1 = {
    objectId: cleanIdentifier(input.remote.objectId, 'remote.objectId'),
    versionId: cleanIdentifier(input.remote.versionId, 'remote.versionId'),
    baselineId: cleanIdentifier(input.remote.baselineId, 'remote.baselineId'),
  };
  const mapping = normalizeMapping(input.mapping ?? []);
  const scope = normalizeScope(input.scope, localBase.deckId);
  const operations = normalizeOperations(input.operations);
  const conflicts = normalizeConflicts(input.conflicts ?? []);
  const postWriteVerification = input.postWriteVerification
    ? normalizeVerificationIntent(input.postWriteVerification)
    : null;

  const canonical = {
    schemaVersion: EXTERNAL_CHANGE_SET_V1_SCHEMA,
    sourceSystem: input.sourceSystem,
    direction: input.direction,
    remote,
    localBase,
    mapping,
    scope,
    operations,
    conflicts,
    postWriteVerification,
  };

  return {
    ...canonical,
    digest: nodeSlideDurableDigest(canonical),
  };
}

/** Exact, lossless handoff into NodeSlide's existing reviewed PatchOperation/CAS lane. */
export function externalChangeSetToPatchProposal(
  changeSet: ExternalChangeSetV1,
): ExternalChangeSetPatchProposalV1 {
  assertExternalChangeSetDigest(changeSet);
  return {
    kind: 'candidate_patch',
    authority: 'nodeslide.proposePatch',
    usesCompareAndSwap: true,
    requiresHumanAcceptance: true,
    deckId: changeSet.localBase.deckId,
    baseDeckVersion: changeSet.localBase.deckVersion,
    baseSlideVersions: clone(changeSet.localBase.slideVersions),
    baseElementVersions: clone(changeSet.localBase.elementVersions),
    scope: clone(changeSet.scope),
    operations: clone(changeSet.operations),
    externalChangeSetDigest: changeSet.digest,
  };
}

/** Fail fast before proposal submission when the local deck no longer matches the captured base. */
export function assertExternalChangeSetBaseVersion(
  changeSet: ExternalChangeSetV1,
  current: { deckId: string; deckVersion: number },
): void {
  assertExternalChangeSetDigest(changeSet);
  if (
    current.deckId !== changeSet.localBase.deckId ||
    current.deckVersion !== changeSet.localBase.deckVersion
  ) {
    throw new Error(
      `External change set is bound to ${changeSet.localBase.deckId} at deck version ${changeSet.localBase.deckVersion}; current deck is ${current.deckId} at version ${current.deckVersion}.`,
    );
  }
}

/** Verifies the full local clock set and exact remote/baseline witness captured by an adapter. */
export function assertExternalChangeSetBaselineBinding(
  changeSet: ExternalChangeSetV1,
  current: ExternalChangeSetBaselineBindingV1,
): void {
  assertExternalChangeSetDigest(changeSet);
  const normalized = {
    remote: {
      objectId: cleanIdentifier(current.remote.objectId, 'current.remote.objectId'),
      versionId: cleanIdentifier(current.remote.versionId, 'current.remote.versionId'),
      baselineId: cleanIdentifier(current.remote.baselineId, 'current.remote.baselineId'),
    },
    localBase: {
      deckId: cleanIdentifier(current.localBase.deckId, 'current.localBase.deckId'),
      deckVersion: exactVersion(current.localBase.deckVersion, 'current.localBase.deckVersion'),
      slideVersions: normalizeVersionMap(
        current.localBase.slideVersions,
        'current.localBase.slideVersions',
      ),
      elementVersions: normalizeVersionMap(
        current.localBase.elementVersions,
        'current.localBase.elementVersions',
      ),
    },
  };
  if (
    nodeSlideDurableDigest(normalized.remote) !== nodeSlideDurableDigest(changeSet.remote) ||
    nodeSlideDurableDigest(normalized.localBase) !== nodeSlideDurableDigest(changeSet.localBase)
  ) {
    throw new Error(
      'External change set baseline is stale; the exact local clocks, remote version, or planning baseline changed.',
    );
  }
}

/** Rejects mutation or accidental reserialization of a canonical external change set. */
export function assertExternalChangeSetDigest(changeSet: ExternalChangeSetV1): void {
  const { digest, ...canonical } = changeSet;
  const expected = nodeSlideDurableDigest(canonical);
  if (digest !== expected) {
    throw new Error(
      `External change set digest mismatch: expected ${expected}, received ${digest}.`,
    );
  }
}

/**
 * The only eligibility guard for an adapter about to perform an external write. It deliberately
 * fails closed: a reviewable outbound plan is not executable until every conflict is resolved and
 * a matching read-after-write verification is explicitly recorded.
 */
export function assertExternalChangeSetOutboundExecutable(
  changeSet: ExternalChangeSetV1,
): asserts changeSet is ExternalChangeSetV1 & {
  direction: 'outbound';
  postWriteVerification: ExternalPostWriteVerificationIntentV1;
} {
  assertExternalChangeSetDigest(changeSet);
  if (changeSet.direction !== 'outbound') {
    throw new Error('External change set is not an outbound execution plan.');
  }
  const unresolved = changeSet.conflicts.filter((conflict) => conflict.status === 'unresolved');
  if (unresolved.length > 0) {
    throw new Error(
      `Outbound execution is forbidden with ${unresolved.length} unresolved conflict${unresolved.length === 1 ? '' : 's'}.`,
    );
  }
  const verification = changeSet.postWriteVerification;
  if (!verification) {
    throw new Error('Outbound execution is forbidden without post-write verification intent.');
  }
  if (
    verification.remoteObjectId !== changeSet.remote.objectId ||
    verification.compareAgainstVersionId !== changeSet.remote.versionId
  ) {
    throw new Error(
      'Outbound execution is forbidden because post-write verification is not bound to the exact remote object and pre-write version.',
    );
  }
}

function normalizeMapping(mapping: readonly ExternalObjectMappingV1[]): ExternalObjectMappingV1[] {
  const localKeys = new Set<string>();
  const remoteKeys = new Set<string>();
  const normalized = mapping.map((entry, index) => {
    if (entry.kind !== 'deck' && entry.kind !== 'slide' && entry.kind !== 'element') {
      throw new TypeError(`mapping[${index}].kind is invalid.`);
    }
    const localId = cleanIdentifier(entry.localId, `mapping[${index}].localId`);
    const remoteId = cleanIdentifier(entry.remoteId, `mapping[${index}].remoteId`);
    const localKey = `${entry.kind}:${localId}`;
    const remoteKey = `${entry.kind}:${remoteId}`;
    if (localKeys.has(localKey)) throw new Error(`Duplicate local object mapping: ${localKey}.`);
    if (remoteKeys.has(remoteKey))
      throw new Error(`Duplicate remote object mapping: ${remoteKey}.`);
    localKeys.add(localKey);
    remoteKeys.add(remoteKey);
    return {
      kind: entry.kind,
      localId,
      remoteId,
      ...(entry.semanticFingerprint !== undefined
        ? {
            semanticFingerprint: cleanIdentifier(
              entry.semanticFingerprint,
              `mapping[${index}].semanticFingerprint`,
            ),
          }
        : {}),
      ...(entry.localParentId !== undefined
        ? { localParentId: cleanIdentifier(entry.localParentId, `mapping[${index}].localParentId`) }
        : {}),
      ...(entry.remoteParentId !== undefined
        ? {
            remoteParentId: cleanIdentifier(
              entry.remoteParentId,
              `mapping[${index}].remoteParentId`,
            ),
          }
        : {}),
    };
  });
  return normalized.sort((left, right) =>
    compareTuple(
      [left.kind, left.localId, left.remoteId],
      [right.kind, right.localId, right.remoteId],
    ),
  );
}

function normalizeConflicts(
  conflicts: readonly ExternalChangeConflictInputV1[],
): ExternalChangeConflictV1[] {
  const normalized = conflicts.map((conflict, index) => {
    const status = conflict.status ?? 'unresolved';
    if (status !== 'unresolved' && status !== 'resolved') {
      throw new TypeError(`conflicts[${index}].status is invalid.`);
    }
    if (status === 'resolved' && conflict.resolution === undefined) {
      throw new TypeError(`conflicts[${index}] is resolved but has no resolution.`);
    }
    return {
      code: cleanIdentifier(conflict.code, `conflicts[${index}].code`),
      path: cleanIdentifier(conflict.path, `conflicts[${index}].path`),
      message: cleanText(conflict.message, `conflicts[${index}].message`),
      status,
      ...(conflict.resolution !== undefined
        ? { resolution: cleanText(conflict.resolution, `conflicts[${index}].resolution`) }
        : {}),
      ...(conflict.localId !== undefined
        ? { localId: cleanIdentifier(conflict.localId, `conflicts[${index}].localId`) }
        : {}),
      ...(conflict.remoteId !== undefined
        ? { remoteId: cleanIdentifier(conflict.remoteId, `conflicts[${index}].remoteId`) }
        : {}),
      ...optionalClonedValue('baseValue', conflict.baseValue),
      ...optionalClonedValue('localValue', conflict.localValue),
      ...optionalClonedValue('remoteValue', conflict.remoteValue),
    };
  });
  return normalized.sort((left, right) =>
    compareTuple(
      [left.path, left.code, left.localId ?? '', left.remoteId ?? '', left.status, left.message],
      [
        right.path,
        right.code,
        right.localId ?? '',
        right.remoteId ?? '',
        right.status,
        right.message,
      ],
    ),
  );
}

function normalizeVersionMap(
  versions: Readonly<Record<string, number>>,
  field: string,
): Record<string, number> {
  if (!versions || typeof versions !== 'object' || Array.isArray(versions)) {
    throw new TypeError(`${field} must be an object.`);
  }
  const normalized: Record<string, number> = {};
  for (const rawId of Object.keys(versions).sort(compareAscii)) {
    const id = cleanIdentifier(rawId, `${field} key`);
    if (Object.hasOwn(normalized, id))
      throw new TypeError(`${field} has duplicate normalized ID ${id}.`);
    normalized[id] = exactVersion(versions[rawId], `${field}.${rawId}`);
  }
  return normalized;
}

function normalizeScope(scope: PatchScope | undefined, deckId: string): PatchScope {
  const normalized = scope
    ? clone(scope)
    : ({ kind: 'deck', deckId, operationMode: 'unrestricted' } satisfies PatchScope);
  if (normalized.deckId !== deckId) {
    throw new Error(
      `Patch scope deck ${normalized.deckId} does not match external change base deck ${deckId}.`,
    );
  }
  return normalized;
}

function normalizeOperations(operations: readonly PatchOperation[]): PatchOperation[] {
  if (!Array.isArray(operations)) throw new TypeError('operations must be an array.');
  return operations.map((operation, index) => {
    if (
      !operation ||
      typeof operation !== 'object' ||
      !PATCH_OPERATION_KINDS.has((operation as PatchOperation).op)
    ) {
      throw new TypeError(`operations[${index}] is not a recognized PatchOperation.`);
    }
    return clone(operation);
  });
}

function normalizeVerificationIntent(
  intent: ExternalPostWriteVerificationIntentV1,
): ExternalPostWriteVerificationIntentV1 {
  if (intent.strategy !== 'read_after_write') {
    throw new TypeError('postWriteVerification.strategy must be read_after_write.');
  }
  return {
    strategy: 'read_after_write',
    remoteObjectId: cleanIdentifier(intent.remoteObjectId, 'postWriteVerification.remoteObjectId'),
    compareAgainstVersionId: cleanIdentifier(
      intent.compareAgainstVersionId,
      'postWriteVerification.compareAgainstVersionId',
    ),
  };
}

function exactVersion(value: number | undefined, field: string): number {
  if (!Number.isSafeInteger(value) || (value ?? -1) < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer.`);
  }
  return value as number;
}

function cleanIdentifier(value: string, field: string): string {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string.`);
  const clean = value.trim();
  if (!clean) throw new TypeError(`${field} must not be empty.`);
  return clean;
}

function cleanText(value: string, field: string): string {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string.`);
  const clean = value.replace(/\s+/gu, ' ').trim();
  if (!clean) throw new TypeError(`${field} must not be empty.`);
  return clean;
}

function optionalClonedValue<Key extends 'baseValue' | 'localValue' | 'remoteValue'>(
  key: Key,
  value: unknown,
): { [K in Key]?: unknown } {
  return value === undefined ? {} : ({ [key]: clone(value) } as { [K in Key]?: unknown });
}

function compareTuple(left: readonly string[], right: readonly string[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const compared = compareAscii(left[index] ?? '', right[index] ?? '');
    if (compared !== 0) return compared;
  }
  return 0;
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
