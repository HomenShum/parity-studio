import { v } from 'convex/values';
import type { PatchOperation, PatchScope } from '../shared/nodeslide';
import {
  NODESLIDE_PREFERENCE_BOUNDS,
  NODESLIDE_PREFERENCE_SCHEMA_VERSION,
  type PreferenceEvent,
  type PreferenceEventType,
  type PreferenceScope,
  type PreferenceSignal,
  type TasteProfile,
} from '../shared/nodeslidePreference';
import type { Doc } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx, mutation, query } from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';
import { nodeslideStableId } from './lib/nodeslideIds';
import {
  type PreferenceArtifactReference,
  type PreferencePatchArtifact,
  type PreferenceProvenanceArtifact,
  type PreferenceProvenanceResolver,
  type PreferenceStyleChange,
  extractPreferenceSignals,
  nodeslidePreferenceEventId,
  nodeslideTasteProfileId,
  normalizePreferenceColor,
  normalizePreferenceFont,
  stablePreferenceStringify,
} from './lib/nodeslidePreferenceEtl';
import {
  NODESLIDE_PREFERENCE_RETENTION_SCAN_LIMIT,
  NODESLIDE_PREFERENCE_RETENTION_WRITE_BURST_LIMIT,
  type PreferenceRetentionReceipt,
  planPreferenceEventRetention,
} from './lib/nodeslidePreferenceRetention';

const SYNC_LIMIT = NODESLIDE_PREFERENCE_RETENTION_WRITE_BURST_LIMIT;
const RESOLVER_ROW_LIMIT = 300;
type ReadCtx = Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>;

export const syncVariationDecisions = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const limit = boundedLimit(args.limit, 50, SYNC_LIMIT);
    const actorId = await preferenceActorId(deck.projectId, args.ownerAccessKey);
    const decisions = await ctx.db
      .query('nodeslide_variation_decisions')
      .withIndex('by_deck_created', (index) => index.eq('deckId', deck.id))
      .order('desc')
      .take(limit);
    let inserted = 0;
    let existing = 0;
    for (const decision of [...decisions].reverse()) {
      await verifyVariationDecision(ctx, deck, decision);
      const event = variationDecisionEvent(deck, actorId, decision, Date.now());
      if (await insertPreferenceEvent(ctx, event)) inserted += 1;
      else existing += 1;
    }
    const { receipt: retention } = await prunePreferenceEvents(ctx, deck.projectId, actorId);
    return { scanned: decisions.length, inserted, existing, retention };
  },
});

export const recordPatchDecision = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    patchId: v.string(),
    sourceEventId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const actorId = await preferenceActorId(deck.projectId, args.ownerAccessKey);
    const patch = await findPatch(ctx, args.patchId);
    if (!patch || patch.deckId !== deck.id) throw new Error('Preference artifact unavailable.');
    const type: PreferenceEventType = args.sourceEventId
      ? 'patch_modified'
      : patch.status === 'accepted'
        ? 'patch_accepted'
        : patch.status === 'rejected'
          ? 'patch_declined'
          : (() => {
              throw new Error(
                'Only accepted, modified, or declined patches produce preference events.',
              );
            })();
    if (type === 'patch_modified' && patch.status !== 'accepted') {
      throw new Error('Only an accepted patch can be recorded as modified.');
    }
    if (type === 'patch_accepted' && patch.source === 'agent' && !patch.traceId) {
      throw new Error('Preference artifact unavailable.');
    }
    if (type === 'patch_modified') {
      const source = await findPreferenceEvent(ctx, args.sourceEventId ?? '');
      if (
        !source ||
        source.tenantId !== deck.projectId ||
        source.actorId !== actorId ||
        source.provenance.patchId !== patch.id ||
        (source.type !== 'patch_accepted' && source.type !== 'variation_selected')
      ) {
        throw new Error('Preference artifact unavailable.');
      }
    }
    const deckVersion = patch.resultingDeckVersion ?? deck.version;
    const provenance = {
      deckVersion,
      patchId: patch.id,
      ...(patch.traceId ? { traceId: patch.traceId } : {}),
      ...(patch.profileId ? { profileId: patch.profileId } : {}),
      ...(args.sourceEventId ? { sourceEventId: args.sourceEventId } : {}),
    };
    const recordedAt = Date.now();
    const event: PreferenceEvent = {
      schemaVersion: NODESLIDE_PREFERENCE_SCHEMA_VERSION,
      id: nodeslidePreferenceEventId({
        tenantId: deck.projectId,
        actorId,
        type,
        sourceArtifactId: patch.id,
        idempotencyKey: args.sourceEventId ?? patch.status,
      }),
      tenantId: deck.projectId,
      actorId,
      type,
      scope: preferenceScopeFromPatch(patch.scope),
      provenance,
      attributes: {},
      occurredAt: patch.updatedAt,
      recordedAt: Math.max(recordedAt, patch.updatedAt),
    };
    const inserted = await insertPreferenceEvent(ctx, event);
    const { receipt: retention } = await prunePreferenceEvents(ctx, deck.projectId, actorId);
    return { event, inserted, retention };
  },
});

export const recordExportCompleted = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    kind: v.union(v.literal('html'), v.literal('pptx'), v.literal('pdf'), v.literal('png')),
    fileName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const actorId = await preferenceActorId(deck.projectId, args.ownerAccessKey);
    const exportId = nodeslideStableId('export', deck.id, String(deck.version), args.kind);
    const existingExport = await findExport(ctx, exportId);
    const now = Date.now();
    if (existingExport) {
      if (
        existingExport.deckId !== deck.id ||
        existingExport.deckVersion !== deck.version ||
        existingExport.kind !== args.kind ||
        existingExport.status !== 'ready'
      ) {
        throw new Error('Preference artifact unavailable.');
      }
    } else {
      await ctx.db.insert('nodeslide_exports', {
        id: exportId,
        deckId: deck.id,
        deckVersion: deck.version,
        kind: args.kind,
        status: 'ready',
        capabilityWarnings: [],
        ...(args.fileName?.trim() ? { fileName: args.fileName.trim().slice(0, 240) } : {}),
        createdAt: now,
      });
    }
    const event: PreferenceEvent = {
      schemaVersion: NODESLIDE_PREFERENCE_SCHEMA_VERSION,
      id: nodeslidePreferenceEventId({
        tenantId: deck.projectId,
        actorId,
        type: 'export_completed',
        sourceArtifactId: exportId,
        idempotencyKey: `${args.kind}:v${deck.version}`,
      }),
      tenantId: deck.projectId,
      actorId,
      type: 'export_completed',
      scope: { kind: 'deck', deckId: deck.id },
      provenance: { deckVersion: deck.version, exportId },
      attributes: { exportFormat: args.kind },
      occurredAt: existingExport?.createdAt ?? now,
      recordedAt: now,
    };
    const inserted = await insertPreferenceEvent(ctx, event);
    const { receipt: retention } = await prunePreferenceEvents(ctx, deck.projectId, actorId);
    return { exportId, event, inserted, retention };
  },
});

export const runEtl = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args) => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const actorId = await preferenceActorId(deck.projectId, args.ownerAccessKey);
    const eventRows = await ctx.db
      .query('nodeslide_preference_events')
      .withIndex('by_tenant_actor_recorded', (index) =>
        index.eq('tenantId', deck.projectId).eq('actorId', actorId),
      )
      .order('desc')
      .take(NODESLIDE_PREFERENCE_BOUNDS.maxEventsPerExtraction);
    const events = eventRows.map(preferenceEventFromRow);
    const resolver = await buildPreferenceResolver(ctx, deck, events);
    const extraction = extractPreferenceSignals(events, { resolver });
    const profileId = nodeslideTasteProfileId(deck.projectId, actorId);
    const current = await findTasteProfile(ctx, profileId);
    const mergedSignals = mergeSignals(
      tasteProfileFromRow(current)?.signals ?? [],
      extraction.signals,
      extraction.evaluations,
    );
    const now = Date.now();
    const profile: TasteProfile = {
      schemaVersion: NODESLIDE_PREFERENCE_SCHEMA_VERSION,
      id: profileId,
      tenantId: deck.projectId,
      actorId,
      signals: mergedSignals,
      updatedAt: now,
    };
    if (current) await ctx.db.patch(current._id, { signals: mergedSignals, updatedAt: now });
    else await ctx.db.insert('nodeslide_taste_profiles', profile);
    for (const row of eventRows) await ctx.db.patch(row._id, { processedAt: now });
    const retentionResult = await prunePreferenceEvents(ctx, deck.projectId, actorId, profile);
    return {
      profile: retentionResult.profile ?? profile,
      retention: retentionResult.receipt,
      diagnostics: extraction.diagnostics,
      evaluations: extraction.evaluations.map(({ proposal, evaluator, sourceEventType }) => ({
        signalId: proposal.id,
        sourceEventType,
        evaluator,
      })),
      inputRejections: extraction.inputRejections,
    };
  },
});

export const listEvents = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const actorId = await preferenceActorId(deck.projectId, args.ownerAccessKey);
    const limit = boundedLimit(
      args.limit,
      NODESLIDE_PREFERENCE_BOUNDS.defaultListLimit,
      NODESLIDE_PREFERENCE_BOUNDS.maxListLimit,
    );
    const rows = await ctx.db
      .query('nodeslide_preference_events')
      .withIndex('by_tenant_actor_recorded', (index) =>
        index.eq('tenantId', deck.projectId).eq('actorId', actorId),
      )
      .order('desc')
      .take(limit);
    return rows.map(preferenceEventFromRow);
  },
});

export const getTasteProfile = query({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args) => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const actorId = await preferenceActorId(deck.projectId, args.ownerAccessKey);
    return tasteProfileFromRow(
      await findTasteProfile(ctx, nodeslideTasteProfileId(deck.projectId, actorId)),
    );
  },
});

export const evictSignal = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string(), signalId: v.string() },
  handler: async (ctx, args) => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const actorId = await preferenceActorId(deck.projectId, args.ownerAccessKey);
    const row = await findTasteProfile(ctx, nodeslideTasteProfileId(deck.projectId, actorId));
    if (!row) return null;
    const profile = tasteProfileFromRow(row);
    if (!profile) return null;
    const signals = profile.signals.filter((signal) => signal.id !== args.signalId);
    if (signals.length === profile.signals.length) return profile;
    const updatedAt = Date.now();
    await ctx.db.patch(row._id, { signals, updatedAt });
    return { ...profile, signals, updatedAt };
  },
});

async function verifyVariationDecision(
  ctx: MutationCtx,
  deck: Doc<'nodeslide_decks'>,
  decision: Doc<'nodeslide_variation_decisions'>,
): Promise<void> {
  const [variation, batch] = await Promise.all([
    findVariation(ctx, decision.variationId),
    findVariationBatch(ctx, decision.batchId),
  ]);
  if (
    decision.deckId !== deck.id ||
    !variation ||
    variation.deckId !== deck.id ||
    variation.slideId !== decision.slideId ||
    variation.batchId !== decision.batchId ||
    !batch ||
    batch.deckId !== deck.id ||
    batch.slideId !== decision.slideId ||
    !batch.variationIds.includes(decision.variationId) ||
    JSON.stringify(variation.axes) !== JSON.stringify(decision.axes)
  ) {
    throw new Error('Preference artifact unavailable.');
  }
  if (decision.eventName === 'variation_selected') {
    const patch = decision.selectedPatchId ? await findPatch(ctx, decision.selectedPatchId) : null;
    if (
      !patch ||
      patch.deckId !== deck.id ||
      patch.status !== 'accepted' ||
      variation.status !== 'accepted' ||
      variation.selectedPatchId !== patch.id
    ) {
      throw new Error('Preference artifact unavailable.');
    }
  } else if (
    decision.eventName === 'variation_rejected' &&
    variation.status !== 'rejected' &&
    variation.status !== 'stale'
  ) {
    throw new Error('Preference artifact unavailable.');
  }
}

function variationDecisionEvent(
  deck: Doc<'nodeslide_decks'>,
  actorId: string,
  decision: Doc<'nodeslide_variation_decisions'>,
  recordedAt: number,
): PreferenceEvent {
  const type = decision.eventName;
  const provenance = {
    deckVersion: decision.deckVersion,
    variationId: decision.variationId,
    variationBatchId: decision.batchId,
    traceId: decision.traceId,
    ...(decision.selectedPatchId ? { patchId: decision.selectedPatchId } : {}),
  };
  return {
    schemaVersion: NODESLIDE_PREFERENCE_SCHEMA_VERSION,
    id: nodeslidePreferenceEventId({
      tenantId: deck.projectId,
      actorId,
      type,
      sourceArtifactId: decision.id,
      idempotencyKey: decision.id,
    }),
    tenantId: deck.projectId,
    actorId,
    type,
    scope: { kind: 'slide', deckId: deck.id, slideId: decision.slideId },
    provenance,
    attributes: {
      contentAngle: decision.axes.contentAngle,
      density: decision.axes.density,
      layoutArchetype: decision.axes.layoutArchetype,
      ...(type === 'variation_generated' ? { origin: decision.origin } : {}),
    },
    occurredAt: decision.createdAt,
    recordedAt: Math.max(recordedAt, decision.createdAt),
  };
}

async function insertPreferenceEvent(ctx: MutationCtx, event: PreferenceEvent): Promise<boolean> {
  const existing = await findPreferenceEvent(ctx, event.id);
  if (existing) {
    if (!samePreferenceEventIdentity(preferenceEventFromRow(existing), event)) {
      throw new Error('Conflicting preference event identity.');
    }
    return false;
  }
  await ctx.db.insert('nodeslide_preference_events', {
    ...event,
    deckId: event.scope.deckId,
  });
  return true;
}

async function buildPreferenceResolver(
  ctx: MutationCtx,
  deck: Doc<'nodeslide_decks'>,
  events: PreferenceEvent[],
): Promise<PreferenceProvenanceResolver> {
  const sourceEventIds = unique(
    events.flatMap((event) =>
      event.provenance.sourceEventId ? [event.provenance.sourceEventId] : [],
    ),
  );
  const [variations, batches, patches, decisions, exports, versions, traces, sourceEvents] =
    await Promise.all([
      ctx.db
        .query('nodeslide_variations')
        .withIndex('by_deck_created', (index) => index.eq('deckId', deck.id))
        .order('desc')
        .take(RESOLVER_ROW_LIMIT),
      ctx.db
        .query('nodeslide_variation_batches')
        .withIndex('by_deck_created', (index) => index.eq('deckId', deck.id))
        .order('desc')
        .take(RESOLVER_ROW_LIMIT),
      ctx.db
        .query('nodeslide_patches')
        .withIndex('by_deck_created', (index) => index.eq('deckId', deck.id))
        .order('desc')
        .take(RESOLVER_ROW_LIMIT),
      ctx.db
        .query('nodeslide_variation_decisions')
        .withIndex('by_deck_created', (index) => index.eq('deckId', deck.id))
        .order('desc')
        .take(RESOLVER_ROW_LIMIT),
      ctx.db
        .query('nodeslide_exports')
        .withIndex('by_deck_created', (index) => index.eq('deckId', deck.id))
        .order('desc')
        .take(RESOLVER_ROW_LIMIT),
      ctx.db
        .query('nodeslide_versions')
        .withIndex('by_deck_version', (index) => index.eq('deckId', deck.id))
        .order('desc')
        .take(RESOLVER_ROW_LIMIT),
      Promise.all(
        unique(
          events.flatMap((event) => (event.provenance.traceId ? [event.provenance.traceId] : [])),
        ).map((traceId) => findTrace(ctx, traceId)),
      ),
      Promise.all(sourceEventIds.map((eventId) => findPreferenceEvent(ctx, eventId))),
    ]);
  const variationById = new Map(variations.map((row) => [row.id, row]));
  const batchById = new Map(batches.map((row) => [row.id, row]));
  const patchById = new Map(patches.map((row) => [row.id, row]));
  const exportById = new Map(exports.map((row) => [row.id, row]));
  const versionByNumber = new Map(versions.map((row) => [row.version, row]));
  const traceById = new Map(traces.flatMap((row) => (row ? [[row.id, row] as const] : [])));
  const decisionByTraceId = new Map(decisions.map((row) => [row.traceId, row]));
  const eventById = new Map([
    ...events.map((event) => [event.id, event] as const),
    ...sourceEvents.flatMap((row) => (row ? [[row.id, preferenceEventFromRow(row)] as const] : [])),
  ]);

  return {
    resolveArtifact(
      reference: PreferenceArtifactReference,
    ): PreferenceProvenanceArtifact | undefined {
      if (reference.kind === 'deck_version') {
        const row = versionByNumber.get(reference.deckVersion);
        if (!row || reference.deckId !== deck.id) return undefined;
        return {
          kind: 'deck_version',
          tenantId: deck.projectId,
          deckId: deck.id,
          scope: { kind: 'deck', deckId: deck.id },
          deckVersion: row.version,
          acceptedPatchIds: patches
            .filter(
              (patch) =>
                patch.status === 'accepted' &&
                patch.resultingDeckVersion !== undefined &&
                patch.resultingDeckVersion <= row.version,
            )
            .map((patch) => patch.id)
            .sort(),
        };
      }
      if (reference.kind === 'variation') {
        const row = variationById.get(reference.id);
        if (!row) return undefined;
        return {
          kind: 'variation',
          tenantId: deck.projectId,
          deckId: deck.id,
          scope: { kind: 'slide', deckId: deck.id, slideId: row.slideId },
          id: row.id,
          batchId: row.batchId,
          axes: row.axes,
          status: row.status,
        };
      }
      if (reference.kind === 'variation_batch') {
        const row = batchById.get(reference.id);
        if (!row) return undefined;
        return {
          kind: 'variation_batch',
          tenantId: deck.projectId,
          deckId: deck.id,
          scope: { kind: 'slide', deckId: deck.id, slideId: row.slideId },
          id: row.id,
          variationIds: row.variationIds,
        };
      }
      if (reference.kind === 'patch') {
        const row = patchById.get(reference.id);
        if (!row) return undefined;
        const variation = variations.find((candidate) => candidate.selectedPatchId === row.id);
        return {
          kind: 'patch',
          tenantId: deck.projectId,
          deckId: deck.id,
          scope: preferenceScopeFromPatch(row.scope),
          id: row.id,
          source: row.source,
          status: row.status,
          ...(row.traceId ? { traceId: row.traceId } : {}),
          ...(variation ? { variationId: variation.id } : {}),
          ...(row.resultingDeckVersion !== undefined
            ? { resultingDeckVersion: row.resultingDeckVersion }
            : {}),
          styleChanges: patchStyleChanges(row.operations),
        } satisfies PreferencePatchArtifact;
      }
      if (reference.kind === 'trace') {
        const decision = decisionByTraceId.get(reference.id);
        if (decision) {
          return {
            kind: 'trace',
            tenantId: deck.projectId,
            deckId: deck.id,
            scope: { kind: 'slide', deckId: deck.id, slideId: decision.slideId },
            id: decision.traceId,
            variationId: decision.variationId,
            variationBatchId: decision.batchId,
            ...(decision.selectedPatchId ? { patchId: decision.selectedPatchId } : {}),
          };
        }
        const row = traceById.get(reference.id);
        if (!row) return undefined;
        const patch = patches.find((candidate) => candidate.traceId === row.id);
        return {
          kind: 'trace',
          tenantId: deck.projectId,
          deckId: deck.id,
          scope: patch ? preferenceScopeFromPatch(patch.scope) : { kind: 'deck', deckId: deck.id },
          id: row.id,
          ...(row.patchId ? { patchId: row.patchId } : {}),
        };
      }
      const row = exportById.get(reference.id);
      if (!row) return undefined;
      return {
        kind: 'export',
        tenantId: deck.projectId,
        deckId: deck.id,
        scope: { kind: 'deck', deckId: deck.id },
        id: row.id,
        deckVersion: row.deckVersion,
        status: row.status,
        format: row.kind,
      };
    },
    resolveEvent(eventId: string) {
      return eventById.get(eventId);
    },
  };
}

function mergeSignals(
  existing: PreferenceSignal[],
  extracted: PreferenceSignal[],
  evaluations: ReturnType<typeof extractPreferenceSignals>['evaluations'],
): PreferenceSignal[] {
  const contradicted = new Set(
    evaluations.flatMap(({ proposal, evaluator }) =>
      evaluator.rejectionCodes.some((code) =>
        [
          'contradicted_by_later_event',
          'superseded_by_later_event',
          'sibling_axis_selected',
        ].includes(code),
      )
        ? [signalSemanticKey(proposal)]
        : [],
    ),
  );
  const byId = new Map(
    existing
      .filter((signal) => !contradicted.has(signalSemanticKey(signal)))
      .map((signal) => [signal.id, signal]),
  );
  for (const signal of extracted) byId.set(signal.id, signal);
  return [...byId.values()]
    .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))
    .slice(0, NODESLIDE_PREFERENCE_BOUNDS.maxProfileSignals);
}

async function prunePreferenceEvents(
  ctx: MutationCtx,
  tenantId: string,
  actorId: string,
  suppliedProfile?: TasteProfile,
): Promise<{ profile: TasteProfile | null; receipt: PreferenceRetentionReceipt }> {
  const rows = await ctx.db
    .query('nodeslide_preference_events')
    .withIndex('by_tenant_actor_recorded', (index) =>
      index.eq('tenantId', tenantId).eq('actorId', actorId),
    )
    .order('asc')
    .take(NODESLIDE_PREFERENCE_RETENTION_SCAN_LIMIT);
  const profileId = nodeslideTasteProfileId(tenantId, actorId);
  const profile = suppliedProfile ?? tasteProfileFromRow(await findTasteProfile(ctx, profileId));
  if (
    profile &&
    (profile.id !== profileId || profile.tenantId !== tenantId || profile.actorId !== actorId)
  ) {
    throw new Error('Preference retention profile scope mismatch.');
  }
  const plan = planPreferenceEventRetention(
    rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      actorId: row.actorId,
      recordedAt: row.recordedAt,
      ...(row.processedAt === undefined ? {} : { processedAt: row.processedAt }),
      ...(row.provenance.sourceEventId ? { sourceEventId: row.provenance.sourceEventId } : {}),
    })),
    (profile?.signals ?? []).map((signal) => ({
      id: signal.id,
      tenantId: signal.tenantId,
      actorId: signal.actorId,
      createdAt: signal.createdAt,
      evidenceEventIds: signal.evidenceEventIds,
      evaluatorInputEventIds: signal.evaluator.inputEventIds,
    })),
    { tenantId, actorId },
  );

  let retainedProfile = profile;
  if (profile && plan.signalIdsToEvict.length > 0) {
    const profileRow = await findTasteProfile(ctx, profileId);
    if (!profileRow) throw new Error('Preference retention profile unavailable.');
    const evictedSignalIds = new Set(plan.signalIdsToEvict);
    const signals = profile.signals.filter((signal) => !evictedSignalIds.has(signal.id));
    if (signals.length !== plan.receipt.retainedSignalCount) {
      throw new Error('Preference retention profile compaction mismatch.');
    }
    const updatedAt = Math.max(Date.now(), profile.updatedAt);
    await ctx.db.patch(profileRow._id, { signals, updatedAt });
    retainedProfile = { ...profile, signals, updatedAt };
  }

  const rowsById = new Map(rows.map((row) => [row.id, row]));
  for (const eventId of plan.eventIdsToDelete) {
    const row = rowsById.get(eventId);
    if (row) await ctx.db.delete(row._id);
  }

  const postRows = await ctx.db
    .query('nodeslide_preference_events')
    .withIndex('by_tenant_actor_recorded', (index) =>
      index.eq('tenantId', tenantId).eq('actorId', actorId),
    )
    .order('asc')
    .take(NODESLIDE_PREFERENCE_BOUNDS.maxRetainedEvents + 1);
  if (postRows.length > NODESLIDE_PREFERENCE_BOUNDS.maxRetainedEvents) {
    throw new Error('Preference retention post-count exceeds configured limit.');
  }
  if (postRows.length !== plan.receipt.postCount) {
    throw new Error('Preference retention post-count does not match its plan.');
  }
  const retainedEventIds = new Set(postRows.map((row) => row.id));
  const noDanglingProfileReferences = (retainedProfile?.signals ?? []).every(
    (signal) =>
      signal.evidenceEventIds.every((eventId) => retainedEventIds.has(eventId)) &&
      signal.evaluator.inputEventIds.every((eventId) => retainedEventIds.has(eventId)),
  );
  const noDanglingEventProvenance = postRows.every(
    (row) => !row.provenance.sourceEventId || retainedEventIds.has(row.provenance.sourceEventId),
  );
  if (!noDanglingProfileReferences || !noDanglingEventProvenance) {
    throw new Error('Preference retention left a dangling provenance reference.');
  }
  const retainedEvidenceEventIds = new Set(
    (retainedProfile?.signals ?? []).flatMap((signal) => signal.evidenceEventIds),
  );
  const receipt: PreferenceRetentionReceipt = {
    ...plan.receipt,
    deletedEventCount: plan.eventIdsToDelete.length,
    postCount: postRows.length,
    retainedSignalCount: retainedProfile?.signals.length ?? 0,
    retainedEvidenceEventCount: retainedEvidenceEventIds.size,
    postCountAtOrBelowLimit: true,
    noDanglingReferences: true,
  };
  return { profile: retainedProfile, receipt };
}

function preferenceEventFromRow(row: Doc<'nodeslide_preference_events'>): PreferenceEvent {
  return {
    schemaVersion: row.schemaVersion,
    id: row.id,
    tenantId: row.tenantId,
    actorId: row.actorId,
    type: row.type,
    scope: row.scope,
    provenance: row.provenance,
    attributes: row.attributes as PreferenceEvent['attributes'],
    occurredAt: row.occurredAt,
    recordedAt: row.recordedAt,
  };
}

function tasteProfileFromRow(row: Doc<'nodeslide_taste_profiles'> | null): TasteProfile | null {
  if (!row) return null;
  return {
    schemaVersion: row.schemaVersion,
    id: row.id,
    tenantId: row.tenantId,
    actorId: row.actorId,
    signals: row.signals as PreferenceSignal[],
    updatedAt: row.updatedAt,
  };
}

function preferenceScopeFromPatch(scope: PatchScope): PreferenceScope {
  if (scope.kind === 'deck') return { kind: 'deck', deckId: scope.deckId };
  if (scope.kind === 'elements' && scope.slideIds.length === 1 && scope.elementIds.length === 1) {
    return {
      kind: 'element',
      deckId: scope.deckId,
      slideId: scope.slideIds[0] as string,
      elementId: scope.elementIds[0] as string,
    };
  }
  if (scope.slideIds.length === 1) {
    return { kind: 'slide', deckId: scope.deckId, slideId: scope.slideIds[0] as string };
  }
  return { kind: 'deck', deckId: scope.deckId };
}

function patchStyleChanges(operations: readonly PatchOperation[]): PreferenceStyleChange[] {
  const changes: PreferenceStyleChange[] = [];
  for (const operation of operations) {
    if (operation.op === 'update_slide' && typeof operation.properties.background === 'string') {
      const color = normalizePreferenceColor(operation.properties.background);
      if (color) changes.push({ dimension: 'color', after: color });
    }
    if (operation.op !== 'update_style') continue;
    for (const key of ['color', 'fill', 'stroke'] as const) {
      const raw = operation.properties[key];
      if (typeof raw !== 'string') continue;
      const color = normalizePreferenceColor(raw);
      if (color) changes.push({ dimension: 'color', after: color });
    }
    if (typeof operation.properties.fontFamily === 'string') {
      const font = normalizePreferenceFont(operation.properties.fontFamily);
      if (font) changes.push({ dimension: 'font', after: font });
    }
  }
  const uniqueChanges = new Map(
    changes.map((change) => [`${change.dimension}:${change.after ?? ''}`, change]),
  );
  return [...uniqueChanges.values()].sort((left, right) =>
    `${left.dimension}:${left.after ?? ''}`.localeCompare(
      `${right.dimension}:${right.after ?? ''}`,
    ),
  );
}

async function preferenceActorId(tenantId: string, ownerAccessKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(
    `${NODESLIDE_PREFERENCE_SCHEMA_VERSION}\u0000${tenantId}\u0000${ownerAccessKey}`,
  );
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const value = [...digest]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `preference_actor_${value}`;
}

function samePreferenceEventIdentity(left: PreferenceEvent, right: PreferenceEvent): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.id === right.id &&
    left.tenantId === right.tenantId &&
    left.actorId === right.actorId &&
    left.type === right.type &&
    stablePreferenceStringify(left.scope) === stablePreferenceStringify(right.scope) &&
    stablePreferenceStringify(left.provenance) === stablePreferenceStringify(right.provenance) &&
    stablePreferenceStringify(left.attributes) === stablePreferenceStringify(right.attributes) &&
    left.occurredAt === right.occurredAt
  );
}

function signalSemanticKey(
  signal: Pick<PreferenceSignal, 'actorId' | 'scope' | 'dimension' | 'value'>,
): string {
  return `${signal.actorId}:${JSON.stringify(signal.scope)}:${signal.dimension}:${signal.value}`;
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`Limit must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

async function findPatch(ctx: ReadCtx, id: string) {
  return await ctx.db
    .query('nodeslide_patches')
    .withIndex('by_stable_id', (index) => index.eq('id', id))
    .unique();
}

async function findVariation(ctx: ReadCtx, id: string) {
  return await ctx.db
    .query('nodeslide_variations')
    .withIndex('by_stable_id', (index) => index.eq('id', id))
    .unique();
}

async function findVariationBatch(ctx: ReadCtx, id: string) {
  return await ctx.db
    .query('nodeslide_variation_batches')
    .withIndex('by_stable_id', (index) => index.eq('id', id))
    .unique();
}

async function findExport(ctx: ReadCtx, id: string) {
  return await ctx.db
    .query('nodeslide_exports')
    .withIndex('by_stable_id', (index) => index.eq('id', id))
    .unique();
}

async function findTrace(ctx: ReadCtx, id: string) {
  return await ctx.db
    .query('nodeslide_traces')
    .withIndex('by_stable_id', (index) => index.eq('id', id))
    .unique();
}

async function findPreferenceEvent(ctx: ReadCtx, id: string) {
  return await ctx.db
    .query('nodeslide_preference_events')
    .withIndex('by_stable_id', (index) => index.eq('id', id))
    .unique();
}

async function findTasteProfile(ctx: ReadCtx, id: string) {
  return await ctx.db
    .query('nodeslide_taste_profiles')
    .withIndex('by_stable_id', (index) => index.eq('id', id))
    .unique();
}
