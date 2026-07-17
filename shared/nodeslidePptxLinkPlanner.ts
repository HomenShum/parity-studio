import { nodeSlideDurableDigest } from './nodeslideDurableSession';
import {
  NODESLIDE_PPTX_LINK_LIMITS,
  type NodeSlidePptxBaselineEntity,
  type NodeSlidePptxEntityKind,
  type NodeSlidePptxLinkedBaseline,
  type NodeSlidePptxSyncDirection,
  type NodeSlidePptxSyncDocument,
  type NodeSlidePptxSyncEntity,
  type NodeSlidePptxUnsupportedConstruct,
  assertNodeSlidePptxLinkedBaseline,
  nodeSlidePptxChangedProperties,
  nodeSlidePptxDocumentDigest,
  nodeSlidePptxEntityStateDigest,
  normalizeNodeSlidePptxSyncDocument,
  remoteBaselineDigest,
} from './nodeslidePptxLink';

export const NODESLIDE_PPTX_SYNC_PLAN_VERSION = 'nodeslide.pptx-sync-plan/v1' as const;

export type NodeSlidePptxSideDelta = 'unchanged' | 'added' | 'updated' | 'deleted';
export type NodeSlidePptxSyncOperation = 'add' | 'update' | 'delete';

export interface NodeSlidePptxSyncAction {
  id: string;
  direction: NodeSlidePptxSyncDirection;
  operation: NodeSlidePptxSyncOperation;
  entityKind: NodeSlidePptxEntityKind;
  semanticFingerprint: string;
  parentSemanticFingerprint?: string;
  sourceObjectId?: string;
  targetObjectId?: string;
  baselineStateDigest?: string;
  sourceStateDigest?: string;
  changedProperties: string[];
}

export interface NodeSlidePptxEntityConflict {
  id: string;
  kind: 'concurrent_update' | 'concurrent_add' | 'delete_vs_modify' | 'identity_ambiguous';
  semanticFingerprint: string;
  entityKind: NodeSlidePptxEntityKind;
  localDelta: NodeSlidePptxSideDelta;
  remoteDelta: NodeSlidePptxSideDelta;
  localObjectIds: string[];
  remoteObjectIds: string[];
  changedProperties: string[];
  message: string;
}

export interface NodeSlidePptxUnsupportedConflict {
  id: string;
  kind: 'unsupported_construct';
  constructId: string;
  constructKind: NodeSlidePptxUnsupportedConstruct['kind'];
  blockedDirections: NodeSlidePptxSyncDirection[];
  blockedActionIds: string[];
  message: string;
}

export type NodeSlidePptxSyncConflict =
  | NodeSlidePptxEntityConflict
  | NodeSlidePptxUnsupportedConflict;

export interface NodeSlidePptxSyncPlan {
  schemaVersion: typeof NODESLIDE_PPTX_SYNC_PLAN_VERSION;
  linkId: string;
  baselineDigest: string;
  localRevision: string;
  remotePackageDigest: string;
  status: 'clean' | 'ready' | 'blocked';
  inbound: NodeSlidePptxSyncAction[];
  outbound: NodeSlidePptxSyncAction[];
  conflicts: NodeSlidePptxSyncConflict[];
  unsupportedConstructs: NodeSlidePptxUnsupportedConstruct[];
  convergedSemanticFingerprints: string[];
  planDigest: string;
}

export function planNodeSlidePptxLinkedSync(args: {
  baseline: NodeSlidePptxLinkedBaseline;
  local: NodeSlidePptxSyncDocument;
  remote: NodeSlidePptxSyncDocument;
}): NodeSlidePptxSyncPlan {
  const baseline = assertNodeSlidePptxLinkedBaseline(args.baseline);
  const local = normalizeNodeSlidePptxSyncDocument(args.local, 'local');
  const remote = normalizeNodeSlidePptxSyncDocument(args.remote, 'remote');
  assertDocumentBinding(baseline, local, remote);

  const baselineByIdentity = new Map(
    baseline.entities.map((entity) => [entity.semanticIdentity.fingerprint, entity]),
  );
  const localByIdentity = entityIndex(local.entities);
  const remoteByIdentity = entityIndex(remote.entities);
  const fingerprints = [
    ...new Set([
      ...baselineByIdentity.keys(),
      ...localByIdentity.keys(),
      ...remoteByIdentity.keys(),
    ]),
  ].sort();
  if (fingerprints.length > NODESLIDE_PPTX_LINK_LIMITS.entities * 2) {
    throw new Error('PPTX sync plan exceeds its bounded semantic-identity set.');
  }

  const inbound: NodeSlidePptxSyncAction[] = [];
  const outbound: NodeSlidePptxSyncAction[] = [];
  const conflicts: NodeSlidePptxSyncConflict[] = [];
  const converged = new Set<string>();

  for (const fingerprint of fingerprints) {
    const baselineEntity = baselineByIdentity.get(fingerprint);
    const localEntities = localByIdentity.get(fingerprint) ?? [];
    const remoteEntities = remoteByIdentity.get(fingerprint) ?? [];
    if (localEntities.length > 1 || remoteEntities.length > 1) {
      conflicts.push(identityConflict(fingerprint, baselineEntity, localEntities, remoteEntities));
      continue;
    }
    const localEntity = localEntities[0];
    const remoteEntity = remoteEntities[0];
    const localDelta = sideDelta(baselineEntity, localEntity, 'local');
    const remoteDelta = sideDelta(baselineEntity, remoteEntity, 'remote');

    if (localDelta === 'unchanged' && remoteDelta === 'unchanged') continue;
    if (localDelta === 'unchanged' && remoteDelta !== 'unchanged') {
      inbound.push(syncAction('inbound', remoteDelta, baselineEntity, remoteEntity, localEntity));
      continue;
    }
    if (remoteDelta === 'unchanged' && localDelta !== 'unchanged') {
      outbound.push(syncAction('outbound', localDelta, baselineEntity, localEntity, remoteEntity));
      continue;
    }
    if (sameCurrentState(localEntity, remoteEntity)) {
      converged.add(fingerprint);
      continue;
    }
    if (localDelta === 'unchanged' || remoteDelta === 'unchanged') {
      throw new Error('PPTX sync planner failed to resolve a one-sided delta.');
    }
    conflicts.push(
      entityConflict(
        fingerprint,
        baselineEntity,
        localEntity,
        remoteEntity,
        localDelta,
        remoteDelta,
      ),
    );
  }

  inbound.sort(compareActions);
  outbound.sort(compareActions);
  conflicts.push(...unsupportedConflicts(remote.unsupportedConstructs, [...inbound, ...outbound]));
  conflicts.sort(compareConflicts);
  const status: NodeSlidePptxSyncPlan['status'] =
    conflicts.length > 0 ? 'blocked' : inbound.length + outbound.length > 0 ? 'ready' : 'clean';
  const core = {
    schemaVersion: NODESLIDE_PPTX_SYNC_PLAN_VERSION,
    linkId: baseline.linkId,
    baselineDigest: baseline.baselineDigest,
    localRevision: local.revision.value,
    remotePackageDigest: remote.revision.value,
    status,
    inbound,
    outbound,
    conflicts,
    unsupportedConstructs: remote.unsupportedConstructs,
    convergedSemanticFingerprints: [...converged].sort(),
  };
  return { ...core, planDigest: nodeSlideDurableDigest(core) };
}

function assertDocumentBinding(
  baseline: NodeSlidePptxLinkedBaseline,
  local: NodeSlidePptxSyncDocument,
  remote: NodeSlidePptxSyncDocument,
): void {
  if (
    local.documentId !== baseline.localDeckId ||
    remote.documentId !== baseline.remoteArtifactId
  ) {
    throw new Error('PPTX sync documents do not match the linked baseline.');
  }
  const localVersion = Number(local.revision.value);
  if (!Number.isSafeInteger(localVersion) || localVersion < baseline.localDeckVersion) {
    throw new Error('PPTX sync local deck version moved behind its linked baseline.');
  }
  const localDigest = nodeSlidePptxDocumentDigest(local);
  if (localVersion === baseline.localDeckVersion && localDigest !== baseline.localSnapshotDigest) {
    throw new Error('PPTX sync local state changed without advancing its deck version.');
  }
  const remoteDigest = nodeSlidePptxDocumentDigest(remote);
  if (
    remote.revision.value === baseline.remotePackageDigest &&
    remoteDigest !== baseline.remoteSnapshotDigest
  ) {
    throw new Error('PPTX sync remote state changed without advancing its package digest.');
  }
}

function entityIndex(
  entities: readonly NodeSlidePptxSyncEntity[],
): Map<string, NodeSlidePptxSyncEntity[]> {
  const result = new Map<string, NodeSlidePptxSyncEntity[]>();
  for (const entity of entities) {
    const fingerprint = entity.identity.fingerprint;
    const matches = result.get(fingerprint) ?? [];
    matches.push(entity);
    result.set(fingerprint, matches);
  }
  return result;
}

function sideDelta(
  baseline: NodeSlidePptxBaselineEntity | undefined,
  current: NodeSlidePptxSyncEntity | undefined,
  side: 'local' | 'remote',
): NodeSlidePptxSideDelta {
  if (!baseline) return current ? 'added' : 'unchanged';
  if (!current) return 'deleted';
  const baselineDigest = side === 'remote' ? remoteBaselineDigest(baseline) : baseline.stateDigest;
  return nodeSlidePptxEntityStateDigest(current) === baselineDigest ? 'unchanged' : 'updated';
}

function sameCurrentState(
  local: NodeSlidePptxSyncEntity | undefined,
  remote: NodeSlidePptxSyncEntity | undefined,
): boolean {
  if (!local || !remote) return local === remote;
  return (
    local.kind === remote.kind &&
    nodeSlidePptxEntityStateDigest(local) === nodeSlidePptxEntityStateDigest(remote)
  );
}

function syncAction(
  direction: NodeSlidePptxSyncDirection,
  delta: Exclude<NodeSlidePptxSideDelta, 'unchanged'>,
  baseline: NodeSlidePptxBaselineEntity | undefined,
  source: NodeSlidePptxSyncEntity | undefined,
  target: NodeSlidePptxSyncEntity | undefined,
): NodeSlidePptxSyncAction {
  const identity = source?.identity ?? target?.identity ?? baseline?.semanticIdentity;
  if (!identity) throw new Error('PPTX sync action has no semantic identity.');
  const entityKind = source?.kind ?? target?.kind ?? baseline?.kind;
  if (!entityKind) throw new Error('PPTX sync action has no entity kind.');
  const operation = syncOperation(delta);
  const changedProperties = actionChangedProperties(direction, delta, baseline, source);
  const parentSemanticFingerprint =
    source?.parentSemanticFingerprint ?? baseline?.parentSemanticFingerprint;
  const core = {
    direction,
    operation,
    entityKind,
    semanticFingerprint: identity.fingerprint,
    ...(parentSemanticFingerprint ? { parentSemanticFingerprint } : {}),
    ...(source ? { sourceObjectId: source.objectId } : {}),
    ...(target ? { targetObjectId: target.objectId } : {}),
    ...(baseline
      ? {
          baselineStateDigest:
            direction === 'inbound' ? remoteBaselineDigest(baseline) : baseline.stateDigest,
        }
      : {}),
    ...(source ? { sourceStateDigest: nodeSlidePptxEntityStateDigest(source) } : {}),
    changedProperties,
  };
  return {
    id: `pptx-action:${nodeSlideDurableDigest(core).slice('sha256:'.length)}`,
    ...core,
  };
}

function syncOperation(
  delta: Exclude<NodeSlidePptxSideDelta, 'unchanged'>,
): NodeSlidePptxSyncOperation {
  if (delta === 'added') return 'add';
  if (delta === 'deleted') return 'delete';
  return 'update';
}

function actionChangedProperties(
  direction: NodeSlidePptxSyncDirection,
  delta: Exclude<NodeSlidePptxSideDelta, 'unchanged'>,
  baseline: NodeSlidePptxBaselineEntity | undefined,
  source: NodeSlidePptxSyncEntity | undefined,
): string[] {
  if (delta === 'updated' && baseline && source) {
    return nodeSlidePptxChangedProperties(baselineForSide(baseline, direction), source);
  }
  const properties = new Set<string>([
    ...Object.keys(source?.properties ?? baseline?.properties ?? {}),
  ]);
  if (source?.parentSemanticFingerprint ?? baseline?.parentSemanticFingerprint) {
    properties.add('parent');
  }
  return [...properties].sort();
}

function entityConflict(
  fingerprint: string,
  baseline: NodeSlidePptxBaselineEntity | undefined,
  local: NodeSlidePptxSyncEntity | undefined,
  remote: NodeSlidePptxSyncEntity | undefined,
  localDelta: Exclude<NodeSlidePptxSideDelta, 'unchanged'>,
  remoteDelta: Exclude<NodeSlidePptxSideDelta, 'unchanged'>,
): NodeSlidePptxEntityConflict {
  const entityKind = local?.kind ?? remote?.kind ?? baseline?.kind;
  if (!entityKind) throw new Error('PPTX sync conflict has no entity kind.');
  const kind =
    localDelta === 'added' && remoteDelta === 'added'
      ? 'concurrent_add'
      : localDelta === 'deleted' || remoteDelta === 'deleted'
        ? 'delete_vs_modify'
        : 'concurrent_update';
  const changedProperties = new Set<string>();
  if (baseline && local) {
    for (const property of nodeSlidePptxChangedProperties(
      baselineForSide(baseline, 'outbound'),
      local,
    )) {
      changedProperties.add(property);
    }
  }
  if (baseline && remote) {
    for (const property of nodeSlidePptxChangedProperties(
      baselineForSide(baseline, 'inbound'),
      remote,
    )) {
      changedProperties.add(property);
    }
  }
  if (!baseline) {
    for (const property of Object.keys(local?.properties ?? remote?.properties ?? {})) {
      changedProperties.add(property);
    }
  }
  return entityConflictRecord({
    kind,
    semanticFingerprint: fingerprint,
    entityKind,
    localDelta,
    remoteDelta,
    localObjectIds: local ? [local.objectId] : [],
    remoteObjectIds: remote ? [remote.objectId] : [],
    changedProperties: [...changedProperties].sort(),
    message:
      kind === 'delete_vs_modify'
        ? 'One side deleted this semantic entity while the other side changed it.'
        : kind === 'concurrent_add'
          ? 'Both sides added different states for the same semantic entity.'
          : 'Both sides changed this semantic entity differently from the linked baseline.',
  });
}

function baselineForSide(
  baseline: NodeSlidePptxBaselineEntity,
  direction: NodeSlidePptxSyncDirection,
): Pick<NodeSlidePptxBaselineEntity, 'parentSemanticFingerprint' | 'properties'> {
  return {
    ...(baseline.parentSemanticFingerprint
      ? { parentSemanticFingerprint: baseline.parentSemanticFingerprint }
      : {}),
    properties:
      direction === 'inbound'
        ? (baseline.remoteProperties ?? baseline.properties)
        : baseline.properties,
  };
}

function identityConflict(
  fingerprint: string,
  baseline: NodeSlidePptxBaselineEntity | undefined,
  local: readonly NodeSlidePptxSyncEntity[],
  remote: readonly NodeSlidePptxSyncEntity[],
): NodeSlidePptxEntityConflict {
  const entityKind = local[0]?.kind ?? remote[0]?.kind ?? baseline?.kind;
  if (!entityKind) throw new Error('PPTX identity conflict has no entity kind.');
  return entityConflictRecord({
    kind: 'identity_ambiguous',
    semanticFingerprint: fingerprint,
    entityKind,
    localDelta: baseline ? 'updated' : 'added',
    remoteDelta: baseline ? 'updated' : 'added',
    localObjectIds: local.map((entity) => entity.objectId).sort(),
    remoteObjectIds: remote.map((entity) => entity.objectId).sort(),
    changedProperties: [],
    message: 'A semantic fingerprint resolves to multiple objects on at least one side.',
  });
}

function entityConflictRecord(
  input: Omit<NodeSlidePptxEntityConflict, 'id'>,
): NodeSlidePptxEntityConflict {
  return {
    id: `pptx-conflict:${nodeSlideDurableDigest(input).slice('sha256:'.length)}`,
    ...input,
  };
}

function unsupportedConflicts(
  constructs: readonly NodeSlidePptxUnsupportedConstruct[],
  actions: readonly NodeSlidePptxSyncAction[],
): NodeSlidePptxUnsupportedConflict[] {
  const conflicts: NodeSlidePptxUnsupportedConflict[] = [];
  for (const construct of constructs) {
    const blockedActionIds = actions
      .filter(
        (action) =>
          construct.blockedDirections.includes(action.direction) &&
          actionTouchesConstruct(action, construct),
      )
      .map((action) => action.id)
      .sort();
    if (blockedActionIds.length < 1) continue;
    const core = {
      kind: 'unsupported_construct' as const,
      constructId: construct.id,
      constructKind: construct.kind,
      blockedDirections: construct.blockedDirections,
      blockedActionIds,
      message: `${construct.kind} is explicitly unsupported for the planned ${construct.blockedDirections.join('/')} sync path: ${construct.reason}`,
    };
    conflicts.push({
      id: `pptx-conflict:${nodeSlideDurableDigest(core).slice('sha256:'.length)}`,
      ...core,
    });
  }
  return conflicts;
}

function actionTouchesConstruct(
  action: NodeSlidePptxSyncAction,
  construct: NodeSlidePptxUnsupportedConstruct,
): boolean {
  if (construct.scope === 'deck') return true;
  if (construct.scope === 'element') {
    return action.semanticFingerprint === construct.scopeSemanticFingerprint;
  }
  return (
    action.semanticFingerprint === construct.scopeSemanticFingerprint ||
    action.parentSemanticFingerprint === construct.scopeSemanticFingerprint
  );
}

function compareActions(left: NodeSlidePptxSyncAction, right: NodeSlidePptxSyncAction): number {
  const operationOrder = { delete: 0, update: 1, add: 2 } as const;
  return (
    left.semanticFingerprint.localeCompare(right.semanticFingerprint) ||
    operationOrder[left.operation] - operationOrder[right.operation] ||
    left.id.localeCompare(right.id)
  );
}

function compareConflicts(
  left: NodeSlidePptxSyncConflict,
  right: NodeSlidePptxSyncConflict,
): number {
  return left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id);
}
