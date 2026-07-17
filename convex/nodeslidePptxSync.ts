import { v } from 'convex/values';
import type { DeckSnapshot } from '../shared/nodeslide';
import { nodeSlideDurableDigest } from '../shared/nodeslideDurableSession';
import {
  type NodeSlidePptxLinkedBaseline,
  type NodeSlidePptxSyncDocument,
  type NodeSlidePptxSyncEntity,
  type NodeSlidePptxSyncProperty,
  type NodeSlidePptxValue,
  assertNodeSlidePptxLinkedBaseline,
  createNodeSlidePptxLinkedBaseline,
  nodeSlidePptxDocumentDigest,
  nodeSlidePptxEntityStateDigest,
  nodeSlidePptxSemanticIdentity,
  normalizeNodeSlidePptxSyncDocument,
} from '../shared/nodeslidePptxLink';
import {
  type NodeSlidePptxSyncPlan,
  planNodeSlidePptxLinkedSync,
} from '../shared/nodeslidePptxLinkPlanner';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';
import { loadNodeSlideSnapshot } from './lib/nodeslideData';
import { nodeslideStableId } from './lib/nodeslideIds';

export const NODESLIDE_PPTX_RUNTIME_LIMITS = {
  documentBytes: 240 * 1024,
  baselineBytes: 280 * 1024,
  planBytes: 192 * 1024,
  rowPayloadBytes: 900 * 1024,
} as const;

type LinkStatus = Doc<'nodeslide_pptx_sync_links'>['status'];

interface PublicPptxLinkState {
  linkId: string;
  deckId: string;
  remoteArtifactId: string;
  status: LinkStatus;
  stateVersion: number;
  baselineDigest: string;
  baselineLocalDeckVersion: number;
  baselineRemotePackageDigest: string;
  pendingPlan?: NodeSlidePptxSyncPlan;
  pendingPlanDigest?: string;
  verifiedRemoteDigest?: string;
  verifiedRemotePackageDigest?: string;
  lastFinalizationDigest?: string;
  createdAt: number;
  updatedAt: number;
}

interface PendingPlanInput {
  baseline: NodeSlidePptxLinkedBaseline;
  local: NodeSlidePptxSyncDocument;
  remote: NodeSlidePptxSyncDocument;
  plan: NodeSlidePptxSyncPlan;
}

/** Returns metadata and the reviewable plan, never the persisted baseline payload. */
export const getLink = query({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args): Promise<PublicPptxLinkState | null> => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const link = await ctx.db
      .query('nodeslide_pptx_sync_links')
      .withIndex('by_deck', (index) => index.eq('deckId', deck.id))
      .unique();
    return link ? publicLinkState(link) : null;
  },
});

/**
 * Creates a link only from an already-synchronized PPTX import. The local side
 * is always rebuilt from the owner-authorized authoritative deck rows.
 */
export const attachImportedBaseline = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    importedSnapshot: v.any(),
  },
  handler: async (ctx, args): Promise<PublicPptxLinkState> => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const local = await authoritativeLocalDocument(ctx, deck.id);
    const remote = importedDocument(args.importedSnapshot);
    const existing = await ctx.db
      .query('nodeslide_pptx_sync_links')
      .withIndex('by_deck', (index) => index.eq('deckId', deck.id))
      .unique();
    const claimedRemote = await ctx.db
      .query('nodeslide_pptx_sync_links')
      .withIndex('by_remote_artifact', (index) => index.eq('remoteArtifactId', remote.documentId))
      .unique();
    if (claimedRemote && claimedRemote.deckId !== deck.id) {
      throw new Error('This PPTX artifact is already linked to another NodeSlide deck.');
    }

    const now = Date.now();
    const baseline = createNodeSlidePptxLinkedBaseline({
      linkId: existing?.id ?? nodeslideStableId('pptx_link', deck.id, remote.documentId),
      local,
      remote,
      createdAt: now,
    });
    const baselineJson = encodeRuntimePayload(
      baseline,
      'PPTX linked baseline',
      NODESLIDE_PPTX_RUNTIME_LIMITS.baselineBytes,
    );
    assertRuntimeRowPayload(baselineJson);

    if (existing) {
      if (existing.remoteArtifactId !== remote.documentId) {
        throw new Error('This deck is already linked to a different PPTX artifact.');
      }
      if (existing.baselineDigest !== baseline.baselineDigest) {
        throw new Error('The existing PPTX link must be finalized before its baseline can change.');
      }
      return publicLinkState(existing);
    }

    const row = {
      id: baseline.linkId,
      deckId: deck.id,
      remoteArtifactId: remote.documentId,
      status: 'active' as const,
      stateVersion: 1,
      baselineJson,
      baselineDigest: baseline.baselineDigest,
      baselineLocalDeckVersion: baseline.localDeckVersion,
      baselineRemotePackageDigest: baseline.remotePackageDigest,
      createdAt: now,
      updatedAt: now,
    };
    const rowId = await ctx.db.insert('nodeslide_pptx_sync_links', row);
    const inserted = await ctx.db.get(rowId);
    if (!inserted) throw new Error('The linked PPTX state could not be persisted.');
    return publicLinkState(inserted);
  },
});

/**
 * Converts an imported PPTX snapshot into durable review work. It never writes
 * deck content, accepts a patch, exports a package, or advances the baseline.
 */
export const planImportedSnapshot = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    expectedStateVersion: v.number(),
    expectedBaselineDigest: v.string(),
    importedSnapshot: v.any(),
  },
  handler: async (ctx, args): Promise<PublicPptxLinkState> => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const link = await requireLink(ctx, deck.id);
    assertNodeSlidePptxLinkCas(
      link,
      args.expectedStateVersion,
      args.expectedBaselineDigest,
      link.baselineDigest,
    );
    if (!['active', 'conflict'].includes(link.status)) {
      throw new Error('A PPTX review plan is already pending for this link.');
    }

    const baseline = decodeBaseline(link.baselineJson, link.baselineDigest);
    const local = await authoritativeLocalDocument(ctx, deck.id);
    const remote = importedDocument(args.importedSnapshot);
    const plan = planNodeSlidePptxLinkedSync({ baseline, local, remote });
    const localJson = encodeDocument(local, 'local PPTX planning snapshot');
    const remoteJson = encodeDocument(remote, 'imported PPTX planning snapshot');
    const planJson = encodeRuntimePayload(
      plan,
      'PPTX sync plan',
      NODESLIDE_PPTX_RUNTIME_LIMITS.planBytes,
    );
    assertRuntimeRowPayload(link.baselineJson, localJson, remoteJson, planJson);

    const patch = {
      status: (plan.status === 'blocked'
        ? 'conflict'
        : plan.outbound.length > 0
          ? 'awaiting_outbound_verification'
          : 'awaiting_review') as LinkStatus,
      stateVersion: link.stateVersion + 1,
      pendingPlanJson: planJson,
      pendingPlanDigest: plan.planDigest,
      pendingLocalJson: localJson,
      pendingLocalDigest: nodeSlidePptxDocumentDigest(local),
      pendingRemoteJson: remoteJson,
      pendingRemoteDigest: nodeSlidePptxDocumentDigest(remote),
      verifiedRemoteJson: undefined,
      verifiedRemoteDigest: undefined,
      verifiedRemotePackageDigest: undefined,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(link._id, patch);
    return publicLinkState(await reloadLink(ctx, link._id));
  },
});

/**
 * Records a post-export re-import only when it is the exact semantic result of
 * the reviewed outbound actions. Finalization cannot bypass this transition.
 */
export const verifyOutboundSnapshot = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    expectedStateVersion: v.number(),
    planDigest: v.string(),
    importedSnapshot: v.any(),
  },
  handler: async (ctx, args): Promise<PublicPptxLinkState> => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const link = await requireLink(ctx, deck.id);
    assertNodeSlidePptxLinkCas(
      link,
      args.expectedStateVersion,
      args.planDigest,
      link.pendingPlanDigest,
    );
    if (link.status !== 'awaiting_outbound_verification') {
      throw new Error('No reviewed outbound PPTX plan is awaiting verification.');
    }
    const pending = decodePendingPlan(link);
    if (pending.plan.status !== 'ready' || pending.plan.outbound.length < 1) {
      throw new Error('The pending PPTX plan has no conflict-free outbound work.');
    }

    const verifiedRemote = importedDocument(args.importedSnapshot);
    assertNodeSlidePptxPlanConvergence(pending, undefined, verifiedRemote);
    if (verifiedRemote.revision.value === pending.remote.revision.value) {
      throw new Error('Outbound PPTX verification requires a newly digested exported package.');
    }
    const verifiedRemoteJson = encodeDocument(verifiedRemote, 'verified outbound PPTX snapshot');
    assertRuntimeRowPayload(
      link.baselineJson,
      required(link.pendingLocalJson),
      required(link.pendingRemoteJson),
      required(link.pendingPlanJson),
      verifiedRemoteJson,
    );
    const patch = {
      status: 'ready_to_finalize' as const,
      stateVersion: link.stateVersion + 1,
      verifiedRemoteJson,
      verifiedRemoteDigest: nodeSlidePptxDocumentDigest(verifiedRemote),
      verifiedRemotePackageDigest: verifiedRemote.revision.value,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(link._id, patch);
    return publicLinkState(await reloadLink(ctx, link._id));
  },
});

/**
 * Atomically advances the baseline under state-version and plan-digest CAS.
 * Outbound plans require the separately persisted post-export verification.
 */
export const finalizePlan = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    expectedStateVersion: v.number(),
    expectedBaselineDigest: v.string(),
    planDigest: v.string(),
  },
  handler: async (ctx, args): Promise<PublicPptxLinkState> => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const link = await requireLink(ctx, deck.id);
    assertNodeSlidePptxLinkCas(
      link,
      args.expectedStateVersion,
      args.expectedBaselineDigest,
      link.baselineDigest,
    );
    assertNodeSlidePptxLinkCas(
      link,
      args.expectedStateVersion,
      args.planDigest,
      link.pendingPlanDigest,
    );
    const pending = decodePendingPlan(link);
    if (pending.plan.status === 'blocked') {
      throw new Error('PPTX conflicts must be resolved and re-planned before finalization.');
    }
    const hasOutbound = pending.plan.outbound.length > 0;
    const expectedStatus = hasOutbound ? 'ready_to_finalize' : 'awaiting_review';
    if (link.status !== expectedStatus) {
      throw new Error('The PPTX plan is not ready for CAS finalization.');
    }

    const currentLocal = await authoritativeLocalDocument(ctx, deck.id);
    const finalRemote = hasOutbound ? decodeVerifiedRemote(link) : pending.remote;
    assertNodeSlidePptxPlanConvergence(pending, currentLocal, finalRemote);
    const now = Date.now();
    const baseline = createNodeSlidePptxLinkedBaseline({
      linkId: link.id,
      local: currentLocal,
      remote: finalRemote,
      createdAt: now,
    });
    const baselineJson = encodeRuntimePayload(
      baseline,
      'PPTX linked baseline',
      NODESLIDE_PPTX_RUNTIME_LIMITS.baselineBytes,
    );
    assertRuntimeRowPayload(baselineJson);
    const finalizationDigest = nodeSlideDurableDigest({
      linkId: link.id,
      previousBaselineDigest: link.baselineDigest,
      planDigest: pending.plan.planDigest,
      advancedBaselineDigest: baseline.baselineDigest,
    });
    const patch = {
      status: 'active' as const,
      stateVersion: link.stateVersion + 1,
      baselineJson,
      baselineDigest: baseline.baselineDigest,
      baselineLocalDeckVersion: baseline.localDeckVersion,
      baselineRemotePackageDigest: baseline.remotePackageDigest,
      pendingPlanJson: undefined,
      pendingPlanDigest: undefined,
      pendingLocalJson: undefined,
      pendingLocalDigest: undefined,
      pendingRemoteJson: undefined,
      pendingRemoteDigest: undefined,
      verifiedRemoteJson: undefined,
      verifiedRemoteDigest: undefined,
      verifiedRemotePackageDigest: undefined,
      lastFinalizationDigest: finalizationDigest,
      updatedAt: now,
    };
    await ctx.db.patch(link._id, patch);
    return publicLinkState(await reloadLink(ctx, link._id));
  },
});

/** Builds the semantic local side from authoritative rows, never client JSON. */
export function nodeSlideSnapshotToPptxSyncDocument(
  snapshot: DeckSnapshot,
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
      const parent = slideIdentityById.get(element.slideId);
      if (!parent) throw new Error('A NodeSlide element cannot be synchronized without its slide.');
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
        order: snapshot.deck.slideOrder.map((id) => requiredIdentity(slideIdentityById, id)),
      },
    },
    ...snapshot.slides.map((slide): NodeSlidePptxSyncEntity => {
      const identity = requiredMapValue(slideIdentityById, slide.id);
      return {
        kind: 'slide',
        objectId: slide.id,
        parentObjectId: snapshot.deck.id,
        parentSemanticFingerprint: deckIdentity.fingerprint,
        identity,
        properties: compactProperties({
          title: slide.title,
          notes: slide.notes,
          background: pptxValue(slide.background),
          order: slide.elementOrder.map((id) => requiredIdentity(elementIdentityById, id)),
        }),
      };
    }),
    ...snapshot.elements.map((element): NodeSlidePptxSyncEntity => {
      const parentIdentity = requiredMapValue(slideIdentityById, element.slideId);
      return {
        kind: 'element',
        objectId: element.id,
        parentObjectId: element.slideId,
        parentSemanticFingerprint: parentIdentity.fingerprint,
        identity: requiredMapValue(elementIdentityById, element.id),
        properties: compactProperties({
          kind: element.kind,
          role: element.role,
          content: element.content,
          bbox: pptxValue(element.bbox),
          rotation: element.rotation,
          style: pptxValue(element.style),
          chart: element.chart ? pptxValue(element.chart) : undefined,
          image: element.image
            ? pptxValue(element.image)
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
  return normalizeNodeSlidePptxSyncDocument(
    {
      side: 'local',
      documentId: snapshot.deck.id,
      revision: { kind: 'nodeslide_deck_version', value: String(snapshot.deck.version) },
      entities,
      unsupportedConstructs: [],
    },
    'local',
  );
}

/** Shared CAS guard used by every state-changing review transition. */
export function assertNodeSlidePptxLinkCas(
  state: { stateVersion: number },
  expectedStateVersion: number,
  expectedDigest: string,
  currentDigest: string | undefined,
): void {
  if (
    !Number.isSafeInteger(expectedStateVersion) ||
    expectedStateVersion < 1 ||
    state.stateVersion !== expectedStateVersion ||
    currentDigest !== expectedDigest
  ) {
    throw new Error('Linked PPTX state changed; reload and re-plan before continuing.');
  }
}

/**
 * Verifies either side against the exact semantic result selected by a plan.
 * Supplying only remote is used by the mandatory outbound verification stage.
 */
export function assertNodeSlidePptxPlanConvergence(
  pending: PendingPlanInput,
  currentLocal: NodeSlidePptxSyncDocument | undefined,
  verifiedRemote: NodeSlidePptxSyncDocument,
): void {
  if (pending.plan.status === 'blocked' || pending.plan.conflicts.length > 0) {
    throw new Error('A conflicted PPTX plan cannot converge automatically.');
  }
  const expected = expectedPlanStates(pending);
  if (currentLocal) {
    const local = normalizeNodeSlidePptxSyncDocument(currentLocal, 'local');
    if (local.documentId !== pending.baseline.localDeckId) {
      throw new Error('The final local PPTX snapshot belongs to a different deck.');
    }
    assertExpectedStates(local, expected, 'local');
  }
  const remote = normalizeNodeSlidePptxSyncDocument(verifiedRemote, 'remote');
  if (remote.documentId !== pending.baseline.remoteArtifactId) {
    throw new Error('The verified PPTX snapshot belongs to a different artifact.');
  }
  assertExpectedStates(remote, expected, 'remote');
  if (
    nodeSlideDurableDigest(remote.unsupportedConstructs) !==
    nodeSlideDurableDigest(pending.remote.unsupportedConstructs)
  ) {
    throw new Error('PPTX unsupported constructs changed during review or export.');
  }
}

export function assertNodeSlidePptxRuntimePayload(...jsonPayloads: string[]): void {
  assertRuntimeRowPayload(...jsonPayloads);
}

async function authoritativeLocalDocument(
  ctx: Parameters<typeof loadNodeSlideSnapshot>[0],
  deckId: string,
): Promise<NodeSlidePptxSyncDocument> {
  const snapshot = await loadNodeSlideSnapshot(ctx, deckId);
  if (!snapshot) throw new Error('NodeSlide deck not found.');
  return nodeSlideSnapshotToPptxSyncDocument(snapshot);
}

async function requireLink(
  ctx: Parameters<typeof requireOwnerAccess>[0],
  deckId: string,
): Promise<Doc<'nodeslide_pptx_sync_links'>> {
  const link = await ctx.db
    .query('nodeslide_pptx_sync_links')
    .withIndex('by_deck', (index) => index.eq('deckId', deckId))
    .unique();
  if (!link) throw new Error('No linked PPTX baseline exists for this deck.');
  return link;
}

async function reloadLink(
  ctx: Parameters<typeof requireOwnerAccess>[0],
  id: Id<'nodeslide_pptx_sync_links'>,
): Promise<Doc<'nodeslide_pptx_sync_links'>> {
  const link = await ctx.db.get(id);
  if (!link) throw new Error('The linked PPTX state was removed during this operation.');
  return link;
}

function importedDocument(value: unknown): NodeSlidePptxSyncDocument {
  const document = normalizeNodeSlidePptxSyncDocument(value as NodeSlidePptxSyncDocument, 'remote');
  encodeDocument(document, 'imported PPTX snapshot');
  return document;
}

function encodeDocument(document: NodeSlidePptxSyncDocument, label: string): string {
  return encodeRuntimePayload(document, label, NODESLIDE_PPTX_RUNTIME_LIMITS.documentBytes);
}

function encodeRuntimePayload(value: unknown, label: string, maxBytes: number): string {
  const json = JSON.stringify(value);
  if (byteLength(json) > maxBytes) throw new Error(`${label} exceeds its runtime payload limit.`);
  return json;
}

function assertRuntimeRowPayload(...jsonPayloads: string[]): void {
  const bytes = jsonPayloads.reduce((total, payload) => total + byteLength(payload), 0);
  if (bytes > NODESLIDE_PPTX_RUNTIME_LIMITS.rowPayloadBytes) {
    throw new Error('Linked PPTX state exceeds its bounded persisted payload limit.');
  }
}

function decodeBaseline(json: string, expectedDigest: string): NodeSlidePptxLinkedBaseline {
  const baseline = assertNodeSlidePptxLinkedBaseline(
    JSON.parse(json) as NodeSlidePptxLinkedBaseline,
  );
  if (baseline.baselineDigest !== expectedDigest) {
    throw new Error('The persisted PPTX baseline digest does not match its payload.');
  }
  return baseline;
}

function decodePendingPlan(link: Doc<'nodeslide_pptx_sync_links'>): PendingPlanInput {
  const baseline = decodeBaseline(link.baselineJson, link.baselineDigest);
  const local = decodeDocument(
    required(link.pendingLocalJson),
    'local',
    required(link.pendingLocalDigest),
  );
  const remote = decodeDocument(
    required(link.pendingRemoteJson),
    'remote',
    required(link.pendingRemoteDigest),
  );
  const plan = planNodeSlidePptxLinkedSync({ baseline, local, remote });
  if (
    plan.planDigest !== link.pendingPlanDigest ||
    JSON.stringify(plan) !== required(link.pendingPlanJson)
  ) {
    throw new Error('The persisted PPTX review plan failed its digest binding.');
  }
  return { baseline, local, remote, plan };
}

function decodeDocument(
  json: string,
  side: 'local' | 'remote',
  expectedDigest: string,
): NodeSlidePptxSyncDocument {
  const document = normalizeNodeSlidePptxSyncDocument(
    JSON.parse(json) as NodeSlidePptxSyncDocument,
    side,
  );
  if (nodeSlidePptxDocumentDigest(document) !== expectedDigest) {
    throw new Error(`The persisted ${side} PPTX snapshot failed its digest binding.`);
  }
  return document;
}

function decodeVerifiedRemote(link: Doc<'nodeslide_pptx_sync_links'>): NodeSlidePptxSyncDocument {
  const remote = decodeDocument(
    required(link.verifiedRemoteJson),
    'remote',
    required(link.verifiedRemoteDigest),
  );
  if (remote.revision.value !== link.verifiedRemotePackageDigest) {
    throw new Error('The verified PPTX package digest does not match its snapshot.');
  }
  return remote;
}

function expectedPlanStates(
  pending: PendingPlanInput,
): Map<string, { kind: NodeSlidePptxSyncEntity['kind']; digest: string } | null> {
  const expected = new Map<
    string,
    { kind: NodeSlidePptxSyncEntity['kind']; digest: string } | null
  >(
    pending.baseline.entities.map((entity) => [
      entity.semanticIdentity.fingerprint,
      { kind: entity.kind, digest: entity.stateDigest },
    ]),
  );
  const local = uniqueSemanticEntities(pending.local);
  const remote = uniqueSemanticEntities(pending.remote);
  for (const action of [...pending.plan.inbound, ...pending.plan.outbound]) {
    const source = (action.direction === 'inbound' ? remote : local).get(
      action.semanticFingerprint,
    );
    if (action.operation === 'delete') {
      expected.set(action.semanticFingerprint, null);
    } else if (source) {
      expected.set(action.semanticFingerprint, {
        kind: source.kind,
        digest: nodeSlidePptxEntityStateDigest(source),
      });
    } else {
      throw new Error('A PPTX sync action lost its source semantic entity.');
    }
  }
  for (const fingerprint of pending.plan.convergedSemanticFingerprints) {
    const entity = local.get(fingerprint) ?? remote.get(fingerprint);
    expected.set(
      fingerprint,
      entity ? { kind: entity.kind, digest: nodeSlidePptxEntityStateDigest(entity) } : null,
    );
  }
  return expected;
}

function assertExpectedStates(
  document: NodeSlidePptxSyncDocument,
  expected: Map<string, { kind: NodeSlidePptxSyncEntity['kind']; digest: string } | null>,
  label: string,
): void {
  const actual = uniqueSemanticEntities(document);
  const identities = new Set([...expected.keys(), ...actual.keys()]);
  for (const fingerprint of identities) {
    const expectedState = expected.get(fingerprint) ?? null;
    const entity = actual.get(fingerprint);
    if (
      (expectedState === null && entity) ||
      (expectedState !== null &&
        (!entity ||
          entity.kind !== expectedState.kind ||
          nodeSlidePptxEntityStateDigest(entity) !== expectedState.digest))
    ) {
      throw new Error(`The ${label} PPTX snapshot does not match the reviewed plan.`);
    }
  }
}

function uniqueSemanticEntities(
  document: NodeSlidePptxSyncDocument,
): Map<string, NodeSlidePptxSyncEntity> {
  const entities = new Map<string, NodeSlidePptxSyncEntity>();
  for (const entity of document.entities) {
    const fingerprint = entity.identity.fingerprint;
    if (entities.has(fingerprint)) {
      throw new Error('A finalized PPTX snapshot contains an ambiguous semantic identity.');
    }
    entities.set(fingerprint, entity);
  }
  return entities;
}

function publicLinkState(link: Doc<'nodeslide_pptx_sync_links'>): PublicPptxLinkState {
  return {
    linkId: link.id,
    deckId: link.deckId,
    remoteArtifactId: link.remoteArtifactId,
    status: link.status,
    stateVersion: link.stateVersion,
    baselineDigest: link.baselineDigest,
    baselineLocalDeckVersion: link.baselineLocalDeckVersion,
    baselineRemotePackageDigest: link.baselineRemotePackageDigest,
    ...(link.pendingPlanJson
      ? { pendingPlan: JSON.parse(link.pendingPlanJson) as NodeSlidePptxSyncPlan }
      : {}),
    ...(link.pendingPlanDigest ? { pendingPlanDigest: link.pendingPlanDigest } : {}),
    ...(link.verifiedRemoteDigest ? { verifiedRemoteDigest: link.verifiedRemoteDigest } : {}),
    ...(link.verifiedRemotePackageDigest
      ? { verifiedRemotePackageDigest: link.verifiedRemotePackageDigest }
      : {}),
    ...(link.lastFinalizationDigest ? { lastFinalizationDigest: link.lastFinalizationDigest } : {}),
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
}

function compactProperties(
  values: Partial<Record<NodeSlidePptxSyncProperty, NodeSlidePptxValue | undefined>>,
): Partial<Record<NodeSlidePptxSyncProperty, NodeSlidePptxValue>> {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, NodeSlidePptxValue] => {
      return entry[1] !== undefined;
    }),
  );
}

function pptxValue(value: unknown): NodeSlidePptxValue {
  return JSON.parse(JSON.stringify(value)) as NodeSlidePptxValue;
}

function requiredMapValue<T>(map: Map<string, T>, key: string): T {
  const value = map.get(key);
  if (!value) throw new Error(`NodeSlide PPTX semantic identity is missing for ${key}.`);
  return value;
}

function requiredIdentity<T extends { fingerprint: string }>(map: Map<string, T>, key: string) {
  return requiredMapValue(map, key).fingerprint;
}

function required(value: string | undefined): string {
  if (!value) throw new Error('The linked PPTX runtime state is incomplete.');
  return value;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
