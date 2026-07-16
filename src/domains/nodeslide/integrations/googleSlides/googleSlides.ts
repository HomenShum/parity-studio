import type { DeckSnapshot } from '../../../../../shared/nodeslide';
import { nodeSlideDurableDigest } from '../../../../../shared/nodeslideDurableSession';
import {
  type ExternalChangeSetV1,
  type ExternalPostWriteVerificationIntentV1,
  assertExternalChangeSetBaselineBinding,
  assertExternalChangeSetDigest,
  assertExternalChangeSetOutboundExecutable,
  normalizeExternalChangeSetV1,
} from '../externalChangeSet';
import type {
  CandidatePatchPlan,
  NormalizedPresentationState,
  PresentationSyncBaseline,
  StagedSyncObjectLink,
  SyncConflict,
  SyncObjectLink,
  SyncObjectMapping,
} from '../syncContracts';
import {
  type GoogleSlidesThreeWaySyncInput,
  type GoogleSlidesThreeWaySyncPlan,
  planGoogleSlidesThreeWaySync,
} from './planning';
import type { GoogleSlidesBatchUpdatePlan } from './types';

export const GOOGLE_SLIDES_EXTERNAL_PLAN_V1_SCHEMA =
  'nodeslide.google-slides-external-plan/v1' as const;
export const GOOGLE_SLIDES_POST_ACCEPTANCE_RECEIPT_V1_SCHEMA =
  'nodeslide.google-slides-post-acceptance-receipt/v1' as const;

export interface GoogleSlidesExternalPlanBindingV1 {
  baselineDigest: string;
  localSnapshotDigest: string;
  remoteSnapshotDigest: string;
}

export interface GoogleSlidesInboundPatchProposalV1 extends CandidatePatchPlan {
  externalChangeSetDigest: string;
  remoteBaselineId: string;
  remoteVersionId: string;
}

export interface GoogleSlidesInboundExternalPlanV1 {
  schemaVersion: typeof GOOGLE_SLIDES_EXTERNAL_PLAN_V1_SCHEMA;
  kind: 'google_slides_inbound_external_plan';
  provider: 'google_slides';
  direction: 'inbound';
  binding: GoogleSlidesExternalPlanBindingV1;
  changeSet: ExternalChangeSetV1 & { direction: 'inbound' };
  proposal: GoogleSlidesInboundPatchProposalV1;
  stagedMappingLinks: StagedSyncObjectLink[];
  digest: string;
}

export interface GoogleSlidesOutboundExternalPlanV1 {
  schemaVersion: typeof GOOGLE_SLIDES_EXTERNAL_PLAN_V1_SCHEMA;
  kind: 'google_slides_outbound_external_plan';
  provider: 'google_slides';
  direction: 'outbound';
  binding: GoogleSlidesExternalPlanBindingV1;
  changeSet: ExternalChangeSetV1 & {
    direction: 'outbound';
    postWriteVerification: ExternalPostWriteVerificationIntentV1;
  };
  batchUpdate: GoogleSlidesBatchUpdatePlan;
  batchUpdateDigest: string;
  stagedMappingLinks: StagedSyncObjectLink[];
  digest: string;
}

export type GoogleSlidesExternalPlanV1 =
  | GoogleSlidesInboundExternalPlanV1
  | GoogleSlidesOutboundExternalPlanV1;

export interface GoogleSlidesInboundAcceptanceV1 {
  kind: 'nodeslide_patch_accepted';
  externalChangeSetDigest: string;
  acceptedLocalSnapshotDigest: string;
}

export interface GoogleSlidesOutboundAcceptanceV1 {
  kind: 'google_slides_write_verified';
  strategy: 'read_after_write';
  externalChangeSetDigest: string;
  acceptedLocalSnapshotDigest: string;
  preWriteVersionId: string;
  verifiedRemoteVersionId: string;
  verifiedRemoteSnapshotDigest: string;
}

export type GoogleSlidesAcceptanceV1 =
  | GoogleSlidesInboundAcceptanceV1
  | GoogleSlidesOutboundAcceptanceV1;

/** Public witness helper for acceptance systems that persist exact snapshot digests. */
export function googleSlidesExternalSnapshotDigest(
  kind: 'local' | 'remote',
  snapshot: DeckSnapshot | NormalizedPresentationState,
): string {
  return snapshotDigest(kind, snapshot);
}

export interface GoogleSlidesPostAcceptanceReceiptV1 {
  schemaVersion: typeof GOOGLE_SLIDES_POST_ACCEPTANCE_RECEIPT_V1_SCHEMA;
  kind: 'google_slides_post_acceptance_receipt';
  provider: 'google_slides';
  direction: 'inbound' | 'outbound';
  externalChangeSetDigest: string;
  planDigest: string;
  acceptance: GoogleSlidesAcceptanceV1;
  previousBaselineDigest: string;
  advancedBaseline: PresentationSyncBaseline;
  advancedBaselineDigest: string;
  digest: string;
}

/** Converts the existing planner's inbound lane into the canonical reviewed PatchOperation input. */
export function createGoogleSlidesInboundExternalPlan(
  input: GoogleSlidesThreeWaySyncInput,
): GoogleSlidesInboundExternalPlanV1 {
  const syncPlan = planGoogleSlidesThreeWaySync(input);
  const binding = createBinding(input);
  const changeSet = normalizeExternalChangeSetV1({
    sourceSystem: 'google_slides',
    direction: 'inbound',
    remote: remoteBinding(input, binding),
    localBase: {
      deckId: syncPlan.inbound.deckId,
      deckVersion: syncPlan.inbound.baseDeckVersion,
      slideVersions: syncPlan.inbound.baseSlideVersions,
      elementVersions: syncPlan.inbound.baseElementVersions,
    },
    mapping: input.baseline.mapping.links.map(toExternalMapping),
    scope: syncPlan.inbound.scope,
    operations: syncPlan.inbound.operations,
    conflicts: syncPlan.conflicts.map(toExternalConflict),
  }) as ExternalChangeSetV1 & { direction: 'inbound' };
  const proposal: GoogleSlidesInboundPatchProposalV1 = {
    ...clone(syncPlan.inbound),
    externalChangeSetDigest: changeSet.digest,
    remoteBaselineId: changeSet.remote.baselineId,
    remoteVersionId: changeSet.remote.versionId,
  };
  const canonical = {
    schemaVersion: GOOGLE_SLIDES_EXTERNAL_PLAN_V1_SCHEMA,
    kind: 'google_slides_inbound_external_plan' as const,
    provider: 'google_slides' as const,
    direction: 'inbound' as const,
    binding,
    changeSet,
    proposal,
    stagedMappingLinks: clone(syncPlan.stagedMappingLinks),
  };
  return { ...canonical, digest: nodeSlideDurableDigest(canonical) };
}

/**
 * Converts a conflict-free planner result into a guarded batchUpdate intent. The Google request
 * list is bound separately because ExternalChangeSetV1 deliberately carries PatchOperation only.
 */
export function createGoogleSlidesOutboundExternalPlan(
  input: GoogleSlidesThreeWaySyncInput,
  postWriteVerification?: ExternalPostWriteVerificationIntentV1,
): GoogleSlidesOutboundExternalPlanV1 {
  const syncPlan = planGoogleSlidesThreeWaySync(input);
  assertConflictFree(syncPlan);
  if (syncPlan.outbound.blocked) {
    throw new Error(
      `Google Slides outbound plan is blocked: ${syncPlan.outbound.blockedReasons.join(' ')}`,
    );
  }
  if (!postWriteVerification) {
    throw new Error('Google Slides outbound plan requires post-write verification intent.');
  }

  const binding = createBinding(input);
  const changeSet = normalizeExternalChangeSetV1({
    sourceSystem: 'google_slides',
    direction: 'outbound',
    remote: remoteBinding(input, binding),
    localBase: fullLocalBase(input.local),
    mapping: input.baseline.mapping.links.map(toExternalMapping),
    operations: [],
    conflicts: [],
    postWriteVerification,
  });
  assertExternalChangeSetOutboundExecutable(changeSet);
  const executableChangeSet = changeSet as ExternalChangeSetV1 & {
    direction: 'outbound';
    postWriteVerification: ExternalPostWriteVerificationIntentV1;
  };
  const batchUpdate = clone(syncPlan.outbound);
  const batchUpdateDigest = nodeSlideDurableDigest(batchUpdate);
  const canonical = {
    schemaVersion: GOOGLE_SLIDES_EXTERNAL_PLAN_V1_SCHEMA,
    kind: 'google_slides_outbound_external_plan' as const,
    provider: 'google_slides' as const,
    direction: 'outbound' as const,
    binding,
    changeSet: executableChangeSet,
    batchUpdate,
    batchUpdateDigest,
    stagedMappingLinks: clone(syncPlan.stagedMappingLinks),
  };
  return { ...canonical, digest: nodeSlideDurableDigest(canonical) };
}

/** Fails before proposal submission or write execution if any planning witness has gone stale. */
export function assertGoogleSlidesExternalPlanCurrent(
  plan: GoogleSlidesExternalPlanV1,
  current: GoogleSlidesThreeWaySyncInput,
): void {
  assertPlanDigest(plan);
  assertExternalChangeSetDigest(plan.changeSet);
  const binding = createBinding(current);
  if (
    binding.baselineDigest !== plan.binding.baselineDigest ||
    binding.localSnapshotDigest !== plan.binding.localSnapshotDigest ||
    binding.remoteSnapshotDigest !== plan.binding.remoteSnapshotDigest
  ) {
    throw new Error(
      'Google Slides external plan is stale; its exact baseline, local snapshot, or remote snapshot changed.',
    );
  }

  assertExternalChangeSetBaselineBinding(plan.changeSet, {
    remote: remoteBinding(current, binding),
    localBase: localBaseForChangeSet(current.local, plan.changeSet),
  });
  if (plan.direction === 'outbound') {
    assertExternalChangeSetOutboundExecutable(plan.changeSet);
    if (nodeSlideDurableDigest(plan.batchUpdate) !== plan.batchUpdateDigest) {
      throw new Error('Google Slides outbound batchUpdate digest mismatch.');
    }
  }
}

/**
 * The sole baseline-advancement adapter. It requires an acceptance/verification witness bound to
 * the exact plan and returns the accepted mapping only inside a post-acceptance receipt.
 */
export function createGoogleSlidesPostAcceptanceReceipt(input: {
  plan: GoogleSlidesExternalPlanV1;
  planningInput: GoogleSlidesThreeWaySyncInput;
  acceptedLocal: DeckSnapshot;
  verifiedRemote: NormalizedPresentationState;
  acceptance: GoogleSlidesAcceptanceV1;
}): GoogleSlidesPostAcceptanceReceiptV1 {
  const { plan, planningInput, acceptedLocal, verifiedRemote, acceptance } = input;
  assertGoogleSlidesExternalPlanCurrent(plan, planningInput);
  if (acceptance.externalChangeSetDigest !== plan.changeSet.digest) {
    throw new Error('Google Slides acceptance is not bound to the external change set digest.');
  }
  if (acceptedLocal.deck.id !== plan.changeSet.localBase.deckId) {
    throw new Error('Google Slides acceptance references a different local deck.');
  }
  if (verifiedRemote.remotePresentationId !== plan.changeSet.remote.objectId) {
    throw new Error('Google Slides verification references a different remote presentation.');
  }
  const acceptedLocalSnapshotDigest = snapshotDigest('local', acceptedLocal);
  if (acceptance.acceptedLocalSnapshotDigest !== acceptedLocalSnapshotDigest) {
    throw new Error('Google Slides acceptance local snapshot digest mismatch.');
  }

  if (plan.direction === 'inbound') {
    assertInboundAcceptance(plan, planningInput, acceptedLocal, verifiedRemote, acceptance);
  } else {
    assertOutboundAcceptance(plan, planningInput, verifiedRemote, acceptance);
  }

  const advancedBaseline: PresentationSyncBaseline = {
    local: clone(acceptedLocal),
    remote: clone(verifiedRemote),
    mapping: advanceMapping(
      planningInput.baseline.mapping,
      plan.stagedMappingLinks,
      plan.direction,
    ),
  };
  const advancedBaselineDigest = baselineDigest(advancedBaseline);
  const canonical = {
    schemaVersion: GOOGLE_SLIDES_POST_ACCEPTANCE_RECEIPT_V1_SCHEMA,
    kind: 'google_slides_post_acceptance_receipt' as const,
    provider: 'google_slides' as const,
    direction: plan.direction,
    externalChangeSetDigest: plan.changeSet.digest,
    planDigest: plan.digest,
    acceptance: clone(acceptance),
    previousBaselineDigest: plan.binding.baselineDigest,
    advancedBaseline,
    advancedBaselineDigest,
  };
  return { ...canonical, digest: nodeSlideDurableDigest(canonical) };
}

function assertInboundAcceptance(
  plan: GoogleSlidesInboundExternalPlanV1,
  planningInput: GoogleSlidesThreeWaySyncInput,
  acceptedLocal: DeckSnapshot,
  verifiedRemote: NormalizedPresentationState,
  acceptance: GoogleSlidesAcceptanceV1,
): asserts acceptance is GoogleSlidesInboundAcceptanceV1 {
  if (acceptance.kind !== 'nodeslide_patch_accepted') {
    throw new Error('Inbound Google Slides plans require a NodeSlide patch acceptance receipt.');
  }
  if (snapshotDigest('remote', verifiedRemote) !== plan.binding.remoteSnapshotDigest) {
    throw new Error('Inbound Google Slides acceptance cannot advance from a changed remote state.');
  }
  if (
    plan.proposal.operations.length > 0 &&
    acceptedLocal.deck.version <= planningInput.local.deck.version
  ) {
    throw new Error('Inbound Google Slides acceptance did not advance the local deck version.');
  }
}

function assertOutboundAcceptance(
  plan: GoogleSlidesOutboundExternalPlanV1,
  planningInput: GoogleSlidesThreeWaySyncInput,
  verifiedRemote: NormalizedPresentationState,
  acceptance: GoogleSlidesAcceptanceV1,
): asserts acceptance is GoogleSlidesOutboundAcceptanceV1 {
  if (
    acceptance.kind !== 'google_slides_write_verified' ||
    acceptance.strategy !== 'read_after_write'
  ) {
    throw new Error('Outbound Google Slides plans require read-after-write verification.');
  }
  if (acceptance.preWriteVersionId !== plan.changeSet.remote.versionId) {
    throw new Error('Google Slides verification pre-write version mismatch.');
  }
  const verifiedRevision = verifiedRemote.revisionId?.trim();
  if (!verifiedRevision || acceptance.verifiedRemoteVersionId !== verifiedRevision) {
    throw new Error('Google Slides verification did not bind the observed post-write revision.');
  }
  if (acceptance.verifiedRemoteSnapshotDigest !== snapshotDigest('remote', verifiedRemote)) {
    throw new Error('Google Slides verification remote snapshot digest mismatch.');
  }
  if (
    plan.batchUpdate.requests.length > 0 &&
    verifiedRevision === plan.changeSet.remote.versionId
  ) {
    throw new Error('Google Slides verification did not observe a post-write revision advance.');
  }
  if (snapshotDigest('local', planningInput.local) !== acceptance.acceptedLocalSnapshotDigest) {
    throw new Error('Outbound Google Slides acceptance cannot advance from a changed local state.');
  }
}

function assertConflictFree(plan: GoogleSlidesThreeWaySyncPlan): void {
  if (plan.conflicts.length > 0) {
    throw new Error(
      `Google Slides outbound plan is forbidden with ${plan.conflicts.length} conflict${plan.conflicts.length === 1 ? '' : 's'}.`,
    );
  }
}

function assertPlanDigest(plan: GoogleSlidesExternalPlanV1): void {
  const { digest, ...canonical } = plan;
  if (nodeSlideDurableDigest(canonical) !== digest) {
    throw new Error('Google Slides external plan digest mismatch.');
  }
}

function createBinding(input: GoogleSlidesThreeWaySyncInput): GoogleSlidesExternalPlanBindingV1 {
  return {
    baselineDigest: baselineDigest(input.baseline),
    localSnapshotDigest: snapshotDigest('local', input.local),
    remoteSnapshotDigest: snapshotDigest('remote', input.remote),
  };
}

function baselineDigest(baseline: PresentationSyncBaseline): string {
  return nodeSlideDurableDigest({
    schemaVersion: GOOGLE_SLIDES_EXTERNAL_PLAN_V1_SCHEMA,
    witness: 'baseline',
    baseline,
  });
}

function snapshotDigest(kind: 'local' | 'remote', snapshot: unknown): string {
  return nodeSlideDurableDigest({
    schemaVersion: GOOGLE_SLIDES_EXTERNAL_PLAN_V1_SCHEMA,
    witness: `${kind}_snapshot`,
    snapshot,
  });
}

function remoteBinding(
  input: GoogleSlidesThreeWaySyncInput,
  binding: GoogleSlidesExternalPlanBindingV1,
) {
  return {
    objectId: input.remote.remotePresentationId,
    versionId: input.remote.revisionId?.trim() || binding.remoteSnapshotDigest,
    baselineId: binding.baselineDigest,
  };
}

function fullLocalBase(snapshot: DeckSnapshot) {
  return {
    deckId: snapshot.deck.id,
    deckVersion: snapshot.deck.version,
    slideVersions: Object.fromEntries(snapshot.slides.map((slide) => [slide.id, slide.version])),
    elementVersions: Object.fromEntries(
      snapshot.elements.map((element) => [element.id, element.version]),
    ),
  };
}

function localBaseForChangeSet(snapshot: DeckSnapshot, changeSet: ExternalChangeSetV1) {
  const all = fullLocalBase(snapshot);
  return {
    deckId: all.deckId,
    deckVersion: all.deckVersion,
    slideVersions: pickVersions(all.slideVersions, Object.keys(changeSet.localBase.slideVersions)),
    elementVersions: pickVersions(
      all.elementVersions,
      Object.keys(changeSet.localBase.elementVersions),
    ),
  };
}

function pickVersions(versions: Record<string, number>, ids: readonly string[]) {
  return Object.fromEntries(ids.map((id) => [id, versions[id] ?? -1]));
}

function toExternalMapping(link: SyncObjectLink) {
  return {
    kind: link.kind,
    localId: link.localId,
    remoteId: link.remoteId,
    semanticFingerprint: link.semanticFingerprint,
    ...(link.localSlideId ? { localParentId: link.localSlideId } : {}),
    ...(link.remoteSlideId ? { remoteParentId: link.remoteSlideId } : {}),
  };
}

function toExternalConflict(conflict: SyncConflict) {
  return {
    code: conflict.code,
    path: conflict.path,
    message: conflict.message,
    ...(conflict.localId ? { localId: conflict.localId } : {}),
    ...(conflict.remoteId ? { remoteId: conflict.remoteId } : {}),
    ...(conflict.baseValue !== undefined ? { baseValue: conflict.baseValue } : {}),
    ...(conflict.localValue !== undefined ? { localValue: conflict.localValue } : {}),
    ...(conflict.remoteValue !== undefined ? { remoteValue: conflict.remoteValue } : {}),
  };
}

function advanceMapping(
  baseline: SyncObjectMapping,
  staged: readonly StagedSyncObjectLink[],
  direction: 'inbound' | 'outbound',
): SyncObjectMapping {
  let links = baseline.links.map((link) => clone(link));
  const accepted = staged.filter(
    (link) =>
      link.commitAfter === 'verified_read' ||
      (direction === 'inbound' && link.commitAfter === 'inbound_patch') ||
      (direction === 'outbound' && link.commitAfter === 'outbound_batch_update'),
  );
  for (const link of accepted) {
    links = links.filter(
      (candidate) =>
        candidate.kind !== link.kind ||
        (candidate.localId !== link.localId && candidate.remoteId !== link.remoteId),
    );
    links.push(clone(link));
  }
  links.sort((left, right) =>
    compareTuple(
      [left.kind, left.localId, left.remoteId],
      [right.kind, right.localId, right.remoteId],
    ),
  );
  return { ...clone(baseline), links };
}

function compareTuple(left: readonly string[], right: readonly string[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? '';
    const b = right[index] ?? '';
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
