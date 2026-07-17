import {
  NODESLIDE_OWNER_DATA_EXPORT_MEDIA_TYPE,
  NODESLIDE_OWNER_DATA_EXPORT_REDACTION_VERSION,
  NODESLIDE_OWNER_DATA_EXPORT_SCHEMA_VERSION,
  type NodeSlideDataExportCollectionManifest,
  type NodeSlideDataExportRecord,
  type NodeSlideDataExportValue,
  type NodeSlideOwnerDataExport,
} from '../../shared/nodeslideDataExport';
import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { nodeslideContentDigest, nodeslideStableId } from './nodeslideIds';
import { nodeSlideJobOwnerDigest } from './nodeslideJobState';

export const NODESLIDE_DATA_EXPORT_MAX_ROWS_PER_COLLECTION = 1_000;
export const NODESLIDE_DATA_EXPORT_MAX_RECORDS = 8_000;
export const NODESLIDE_DATA_EXPORT_MAX_BYTES = 8 * 1024 * 1024;

const REDACTED = '[REDACTED]';
const OMITTED_BINARY_DATA = '[OMITTED_BINARY_DATA]';
const EXCLUDED_COLLECTIONS = [
  {
    name: 'nodeslide_oauth_sessions',
    reason: 'authentication_material' as const,
    detail: 'OAuth state and PKCE material are never included.',
  },
  {
    name: 'nodeslide_oauth_credentials',
    reason: 'authentication_material' as const,
    detail: 'Provider access and refresh credentials are never included.',
  },
  {
    name: 'nodeslide_presence',
    reason: 'ephemeral_runtime_state' as const,
    detail: 'Live cursor and presence rows are transient collaboration state.',
  },
  {
    name: 'nodeslide_rate_limits',
    reason: 'infrastructure_state' as const,
    detail: 'Shared anti-abuse counters are infrastructure state, not deck content.',
  },
  {
    name: 'nodeslide_durable_model_result_replays.payloadJson',
    reason: 'provider_replay_payload' as const,
    detail: 'Provider replay bodies are omitted; journal digests and accounting metadata remain.',
  },
  {
    name: '_storage and evidence attachment storage ids',
    reason: 'binary_blob_contents' as const,
    detail:
      'Screenshot, PDF, image, and export blob bytes or storage capabilities are not included.',
  },
  {
    name: 'nodeslide_signature_profiles',
    reason: 'cross_deck_profile' as const,
    detail:
      'Tenant-level signature profiles can span decks and are not owner-scoped by this deck capability.',
  },
  {
    name: 'nodeslide_taste_profiles',
    reason: 'cross_deck_profile' as const,
    detail: 'Actor taste profiles can span decks and are not owner-scoped by this deck capability.',
  },
  {
    name: 'nodeslide_deck_ci',
    reason: 'computed_not_persisted' as const,
    detail:
      'Deck CI is evaluated from exported state; no standalone Deck CI collection currently exists.',
  },
];

type ExportCtx = Pick<QueryCtx, 'db'>;
type ScopedRow = { deckId: string };
type StoredRow = { _id: unknown; _creationTime: number; id?: string };

interface RedactionState {
  removedFieldCount: number;
  redactedValueCount: number;
  sensitiveValues: string[];
}

const NODESLIDE_SCOPED_MEMORY_VERSION = 'nodeslide.scoped-memory/v1';

function nodeSlideDeckScopedMemoryKey(
  deck: Pick<Doc<'nodeslide_decks'>, 'id' | 'projectId' | 'clientSessionId'> & {
    workspaceId?: string;
    workspaceProjectId?: string;
  },
): string {
  const workspaceId = deck.workspaceId ?? deck.clientSessionId;
  const projectId = deck.workspaceProjectId ?? deck.projectId;
  return [
    NODESLIDE_SCOPED_MEMORY_VERSION,
    'workspace',
    workspaceId,
    'project',
    projectId,
    'deck',
    deck.id,
  ]
    .map(encodeURIComponent)
    .join('/');
}

/**
 * Reads one complete, deck-bound owner export. Every collection is bounded and
 * the function rejects instead of returning a partial bundle.
 */
export async function collectNodeSlideOwnerDataExport(
  ctx: ExportCtx,
  args: {
    deck: Doc<'nodeslide_decks'>;
    ownerAccessKey: string;
    generatedAt: number;
  },
): Promise<NodeSlideOwnerDataExport> {
  const { deck, ownerAccessKey, generatedAt } = args;
  const limit = NODESLIDE_DATA_EXPORT_MAX_ROWS_PER_COLLECTION + 1;
  const [
    slides,
    elements,
    patches,
    variationBatches,
    variations,
    variationDecisions,
    comments,
    versions,
    sources,
    sourceRevisions,
    jobs,
    runs,
    messages,
    memories,
    scopedMemories,
    roleStages,
    sourceRefreshSchedules,
    sourceRefreshProposals,
    spans,
    events,
    validations,
    traces,
    executionTraces,
    syncConnections,
    googleSyncStates,
    pptxSyncLinks,
    delegationGrants,
    delegationUses,
    evidenceCaptures,
    evidenceSteps,
    claimEvidenceReceipts,
    shadowComparisons,
    exports,
    publications,
    preferenceEvents,
  ] = await Promise.all([
    ctx.db
      .query('nodeslide_slides')
      .withIndex('by_deck', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_elements')
      .withIndex('by_deck', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_patches')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_variation_batches')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_variations')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_variation_decisions')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_comments')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_versions')
      .withIndex('by_deck_version', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_sources')
      .withIndex('by_deck', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_source_revisions')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_agent_jobs')
      .withIndex('by_result_deck', (query) => query.eq('resultDeckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_agent_messages')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_agent_memories')
      .withIndex('by_deck_updated', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_scoped_memories')
      .withIndex('by_scope_status_updated', (query) =>
        query.eq('scopeKey', nodeSlideDeckScopedMemoryKey(deck)),
      )
      .take(limit),
    ctx.db
      .query('nodeslide_role_stages')
      .withIndex('by_deck_ordinal', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_source_refresh_schedules')
      .withIndex('by_deck_updated', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_source_refresh_proposals')
      .withIndex('by_deck_status_created', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_agent_spans')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_agent_events')
      .withIndex('by_deck_timestamp', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_validations')
      .withIndex('by_deck_checked', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_traces')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_execution_traces')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_sync_connections')
      .withIndex('by_deck_provider', (query) =>
        query.eq('deckId', deck.id).eq('provider', 'google_slides'),
      )
      .take(limit),
    ctx.db
      .query('nodeslide_google_sync_states')
      .withIndex('by_deck', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_pptx_sync_links')
      .withIndex('by_deck', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_delegation_grants')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_delegation_uses')
      .withIndex('by_deck_used', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_evidence_captures')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_evidence_steps')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_claim_evidence_receipts')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_shadow_comparisons')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_exports')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_publications')
      .withIndex('by_deck_revision', (query) => query.eq('deckId', deck.id))
      .take(limit),
    ctx.db
      .query('nodeslide_preference_events')
      .withIndex('by_deck_recorded', (query) => query.eq('deckId', deck.id))
      .take(limit),
  ]);

  const durableSessionBindings = jobs.map((job) => ({
    job,
    sessionId: nodeslideStableId('nsession', job.id),
  }));
  const durableSessions = (
    await Promise.all(
      durableSessionBindings.map(({ sessionId }) =>
        ctx.db
          .query('nodeslide_durable_sessions')
          .withIndex('by_stable_id', (query) => query.eq('id', sessionId))
          .take(2),
      ),
    )
  ).flat();
  const durableSessionEvents = (
    await Promise.all(
      durableSessionBindings.map(({ job, sessionId }) =>
        ctx.db
          .query('nodeslide_durable_session_events')
          .withIndex('by_session_job', (query) =>
            query.eq('sessionId', sessionId).eq('jobId', job.id),
          )
          .take(limit),
      ),
    )
  ).flat();
  const durableJournalEntries = (
    await Promise.all(
      durableSessionBindings.map(({ job, sessionId }) =>
        ctx.db
          .query('nodeslide_durable_job_journal_entries')
          .withIndex('by_binding_sequence', (query) =>
            query.eq('sessionId', sessionId).eq('jobId', job.id),
          )
          .take(limit),
      ),
    )
  ).flat();

  const budgetIds = [
    ...new Set(
      [...jobs.map((job) => job.budgetId), ...runs.map((run) => run.budgetId)].filter(
        (budgetId): budgetId is string => Boolean(budgetId),
      ),
    ),
  ].sort();
  const budgetLedgers = (
    await Promise.all(
      budgetIds.map((budgetId) =>
        ctx.db
          .query('nodeslide_run_budgets')
          .withIndex('by_stable_id', (query) => query.eq('id', budgetId))
          .take(2),
      ),
    )
  ).flat();
  const billableCalls = (
    await Promise.all(
      budgetIds.map((budgetId) =>
        ctx.db
          .query('nodeslide_billable_calls')
          .withIndex('by_budget_status', (query) => query.eq('budgetId', budgetId))
          .take(limit),
      ),
    )
  ).flat();
  const budgetEvents = (
    await Promise.all(
      budgetIds.map((budgetId) =>
        ctx.db
          .query('nodeslide_budget_events')
          .withIndex('by_budget_sequence', (query) => query.eq('budgetId', budgetId))
          .take(limit),
      ),
    )
  ).flat();

  const collections = [
    ['slides', slides],
    ['elements', elements],
    ['patches', patches],
    ['variation batches', variationBatches],
    ['variations', variations],
    ['variation decisions', variationDecisions],
    ['comments', comments],
    ['versions', versions],
    ['sources', sources],
    ['source revisions', sourceRevisions],
    ['jobs', jobs],
    ['runs', runs],
    ['messages', messages],
    ['memories', memories],
    ['scoped memories', scopedMemories],
    ['role stages', roleStages],
    ['source refresh schedules', sourceRefreshSchedules],
    ['source refresh proposals', sourceRefreshProposals],
    ['spans', spans],
    ['events', events],
    ['validations', validations],
    ['traces', traces],
    ['execution traces', executionTraces],
    ['sync connections', syncConnections],
    ['Google sync states', googleSyncStates],
    ['PPTX sync links', pptxSyncLinks],
    ['delegation grants', delegationGrants],
    ['delegation uses', delegationUses],
    ['evidence captures', evidenceCaptures],
    ['evidence steps', evidenceSteps],
    ['claim evidence receipts', claimEvidenceReceipts],
    ['shadow comparisons', shadowComparisons],
    ['exports', exports],
    ['publications', publications],
    ['preference events', preferenceEvents],
    ['durable sessions', durableSessions],
    ['durable session events', durableSessionEvents],
    ['durable journal entries', durableJournalEntries],
    ['budget ledgers', budgetLedgers],
    ['billable calls', billableCalls],
    ['budget events', budgetEvents],
  ] as const;
  for (const [name, rows] of collections) assertCompleteCollection(name, rows.length);

  for (const rows of [
    slides,
    elements,
    patches,
    variationBatches,
    variations,
    variationDecisions,
    comments,
    versions,
    sources,
    sourceRevisions,
    runs,
    messages,
    memories,
    roleStages,
    sourceRefreshSchedules,
    sourceRefreshProposals,
    spans,
    events,
    validations,
    traces,
    executionTraces,
    syncConnections,
    googleSyncStates,
    pptxSyncLinks,
    delegationGrants,
    delegationUses,
    evidenceCaptures,
    evidenceSteps,
    claimEvidenceReceipts,
    shadowComparisons,
    exports,
    publications,
    preferenceEvents,
  ]) {
    assertDeckScopedRows(deck.id, rows);
  }
  assertDeckScopedMemoryRows(deck, scopedMemories);

  const expectedJobOwnerDigest = nodeSlideJobOwnerDigest(ownerAccessKey);
  const expectedRunOwnerDigest = `actor_${nodeslideContentDigest(ownerAccessKey)}`;
  for (const job of jobs) {
    if (job.resultDeckId !== deck.id || job.ownerDigest !== expectedJobOwnerDigest) {
      throw exportInvariantError('durable job ownership is inconsistent');
    }
  }
  for (const run of runs) {
    if (run.ownerDigest !== expectedRunOwnerDigest) {
      throw exportInvariantError('durable run ownership is inconsistent');
    }
  }
  for (const revision of sourceRevisions) {
    if (revision.ownerDigest !== expectedRunOwnerDigest) {
      throw exportInvariantError('source revision ownership is inconsistent');
    }
  }
  for (const receipt of claimEvidenceReceipts) {
    if (receipt.ownerDigest !== expectedRunOwnerDigest) {
      throw exportInvariantError('claim evidence receipt ownership is inconsistent');
    }
  }
  for (const schedule of sourceRefreshSchedules) {
    if (schedule.ownerDigest !== expectedRunOwnerDigest) {
      throw exportInvariantError('source refresh schedule ownership is inconsistent');
    }
  }
  for (const proposal of sourceRefreshProposals) {
    if (proposal.ownerDigest !== expectedRunOwnerDigest) {
      throw exportInvariantError('source refresh proposal ownership is inconsistent');
    }
  }
  for (const version of versions) assertVersionSnapshotScope(version, deck.id);
  for (const publication of publications) assertPublishedSnapshotScope(publication, deck.id);
  assertLinkedExportRows({
    patches,
    jobs,
    durableSessions,
    durableSessionEvents,
    durableJournalEntries,
    budgetIds,
    budgetLedgers,
    billableCalls,
    budgetEvents,
    delegationGrants,
    delegationUses,
    evidenceCaptures,
    evidenceSteps,
    sourceRevisions,
    claimEvidenceReceipts,
  });

  const redaction: RedactionState = {
    removedFieldCount: 0,
    redactedValueCount: 0,
    sensitiveValues: [
      ownerAccessKey,
      deck.shareSlug ?? '',
      expectedJobOwnerDigest,
      expectedRunOwnerDigest,
    ].filter((value) => value.length >= 8),
  };
  const data: NodeSlideOwnerDataExport['data'] = {
    deckSpec: {
      deck: redactRecord(deck, redaction),
      slides: redactRows(slides, redaction),
      elements: redactRows(elements, redaction),
    },
    versions: redactRows(versions, redaction),
    proposals: {
      patches: redactRows(patches, redaction),
      variationBatches: redactRows(variationBatches, redaction),
      variations: redactRows(variations, redaction),
      variationDecisions: redactRows(variationDecisions, redaction),
    },
    sources: redactRows(sources, redaction),
    sourceRevisions: redactRows(sourceRevisions, redaction, ['ownerDigest']),
    evidence: {
      captures: redactRows(evidenceCaptures, redaction),
      steps: redactRows(evidenceSteps, redaction, ['screenshotStorageId', 'pdfStorageId']),
      claimReceipts: redactRows(claimEvidenceReceipts, redaction, ['ownerDigest']),
    },
    memories: redactRows(memories, redaction),
    scopedMemories: redactRows(scopedMemories, redaction),
    sourceRefresh: {
      schedules: redactRows(sourceRefreshSchedules, redaction, ['ownerDigest']),
      proposals: redactRows(sourceRefreshProposals, redaction, ['ownerDigest']),
    },
    activity: {
      jobs: redactRows(jobs, redaction),
      durableSessions: redactRows(durableSessions, redaction),
      durableSessionEvents: redactRows(durableSessionEvents, redaction),
      durableJournalEntries: redactRows(durableJournalEntries, redaction),
      runs: redactRows(runs, redaction),
      messages: redactRows(messages, redaction),
      spans: redactRows(spans, redaction),
      events: redactRows(events, redaction),
      traces: redactRows(traces, redaction),
      executionTraces: redactRows(executionTraces, redaction),
      shadowComparisons: redactRows(shadowComparisons, redaction),
      validations: redactRows(validations, redaction),
      roleStages: redactRows(roleStages, redaction),
    },
    budgets: {
      ledgers: redactRows(budgetLedgers, redaction),
      billableCalls: redactRows(billableCalls, redaction),
      events: redactRows(budgetEvents, redaction),
    },
    sync: {
      connections: redactRows(syncConnections, redaction),
      googleStates: redactRows(googleSyncStates, redaction),
      pptxLinks: redactRows(pptxSyncLinks, redaction),
    },
    delegation: {
      grants: redactRows(delegationGrants, redaction, ['tokenDigest']),
      uses: redactRows(delegationUses, redaction),
    },
    outputs: {
      exports: redactRows(exports, redaction, ['url']),
      publications: redactRows(publications, redaction),
    },
    preferenceEvents: redactRows(preferenceEvents, redaction),
    comments: redactRows(comments, redaction),
  };
  const collectionManifest = dataCollectionManifest(data);
  const recordCount = collectionManifest.reduce((total, entry) => total + entry.recordCount, 0);
  if (recordCount > NODESLIDE_DATA_EXPORT_MAX_RECORDS) {
    throw new Error(
      `NodeSlide data export exceeds the complete-export limit of ${NODESLIDE_DATA_EXPORT_MAX_RECORDS} records. No partial bundle was returned.`,
    );
  }
  const bundle: NodeSlideOwnerDataExport = {
    manifest: {
      schemaVersion: NODESLIDE_OWNER_DATA_EXPORT_SCHEMA_VERSION,
      generatedAt,
      mediaType: NODESLIDE_OWNER_DATA_EXPORT_MEDIA_TYPE,
      scope: {
        kind: 'deck_owner_capability',
        deckId: deck.id,
        deckVersion: deck.version,
      },
      completeness: { status: 'complete', truncated: false, recordCount },
      collections: collectionManifest,
      redaction: {
        policyVersion: NODESLIDE_OWNER_DATA_EXPORT_REDACTION_VERSION,
        removedFieldCount: redaction.removedFieldCount,
        redactedValueCount: redaction.redactedValueCount,
        excludedCollections: EXCLUDED_COLLECTIONS,
      },
      determinism: {
        collectionOrder: 'schema_defined',
        recordOrder: 'creation_time_then_stable_id',
        objectKeyOrder: 'lexicographic',
        generatedAt: 'request_time_only_nondeterministic_field',
      },
      retention: {
        serverCopyCreated: false,
        bundlePersistence: 'client_download_only',
        sourceSnapshot: 'retained_records_at_export_time',
        expiredOrPrunedRecords: 'not_recoverable',
      },
      mutationPolicy: 'read_only_no_cas_or_proposal_state_changes',
    },
    data,
  };
  const byteLength = new TextEncoder().encode(JSON.stringify(bundle)).byteLength;
  if (byteLength > NODESLIDE_DATA_EXPORT_MAX_BYTES) {
    throw new Error(
      `NodeSlide data export exceeds the complete-export limit of ${NODESLIDE_DATA_EXPORT_MAX_BYTES} bytes. No partial bundle was returned.`,
    );
  }
  return bundle;
}

function assertCompleteCollection(name: string, rowCount: number): void {
  if (rowCount <= NODESLIDE_DATA_EXPORT_MAX_ROWS_PER_COLLECTION) return;
  throw new Error(
    `NodeSlide data export has more than ${NODESLIDE_DATA_EXPORT_MAX_ROWS_PER_COLLECTION} ${name} records. No partial bundle was returned.`,
  );
}

function assertDeckScopedRows(deckId: string, rows: readonly ScopedRow[]): void {
  if (rows.some((row) => row.deckId !== deckId)) {
    throw exportInvariantError('a persisted row crossed the authorized deck boundary');
  }
}

function assertDeckScopedMemoryRows(
  deck: Doc<'nodeslide_decks'>,
  rows: readonly Doc<'nodeslide_scoped_memories'>[],
): void {
  const scopeKey = nodeSlideDeckScopedMemoryKey(deck);
  for (const row of rows) {
    if (
      row.schemaVersion !== NODESLIDE_SCOPED_MEMORY_VERSION ||
      row.scopeKind !== 'deck' ||
      row.scopeKey !== scopeKey ||
      row.deckId !== deck.id ||
      row.workspaceId !== (deck.workspaceId ?? deck.clientSessionId) ||
      row.projectId !== (deck.workspaceProjectId ?? deck.projectId)
    ) {
      throw exportInvariantError('scoped memory ownership is inconsistent');
    }
  }
}

function assertVersionSnapshotScope(version: Doc<'nodeslide_versions'>, deckId: string): void {
  const snapshot = version.snapshot;
  const slideIds = new Set(snapshot.slides.map((slide) => slide.id));
  if (
    snapshot.deck.id !== deckId ||
    snapshot.slides.some((slide) => slide.deckId !== deckId) ||
    snapshot.sources.some((source) => source.deckId !== deckId) ||
    snapshot.elements.some((element) => !slideIds.has(element.slideId))
  ) {
    throw exportInvariantError('a version snapshot crossed the authorized deck boundary');
  }
}

function assertPublishedSnapshotScope(
  publication: Doc<'nodeslide_publications'>,
  deckId: string,
): void {
  const snapshot = publication.snapshot;
  const slideIds = new Set(snapshot.slides.map((slide) => slide.id));
  if (
    snapshot.deck.id !== deckId ||
    snapshot.slides.some((slide) => slide.deckId !== deckId) ||
    snapshot.sources.some((source) => source.deckId !== deckId) ||
    snapshot.elements.some((element) => !slideIds.has(element.slideId))
  ) {
    throw exportInvariantError('a publication snapshot crossed the authorized deck boundary');
  }
}

function assertLinkedExportRows(args: {
  patches: readonly Doc<'nodeslide_patches'>[];
  jobs: readonly Doc<'nodeslide_agent_jobs'>[];
  durableSessions: readonly Doc<'nodeslide_durable_sessions'>[];
  durableSessionEvents: readonly Doc<'nodeslide_durable_session_events'>[];
  durableJournalEntries: readonly Doc<'nodeslide_durable_job_journal_entries'>[];
  budgetIds: readonly string[];
  budgetLedgers: readonly Doc<'nodeslide_run_budgets'>[];
  billableCalls: readonly Doc<'nodeslide_billable_calls'>[];
  budgetEvents: readonly Doc<'nodeslide_budget_events'>[];
  delegationGrants: readonly Doc<'nodeslide_delegation_grants'>[];
  delegationUses: readonly Doc<'nodeslide_delegation_uses'>[];
  evidenceCaptures: readonly Doc<'nodeslide_evidence_captures'>[];
  evidenceSteps: readonly Doc<'nodeslide_evidence_steps'>[];
  sourceRevisions: readonly Doc<'nodeslide_source_revisions'>[];
  claimEvidenceReceipts: readonly Doc<'nodeslide_claim_evidence_receipts'>[];
}): void {
  const jobsById = new Map(args.jobs.map((job) => [job.id, job]));
  const sessionToJob = new Map(
    args.jobs.map((job) => [nodeslideStableId('nsession', job.id), job] as const),
  );
  if (
    new Set(args.durableSessions.map((session) => session.id)).size !== args.durableSessions.length
  ) {
    throw exportInvariantError('duplicate durable sessions were resolved');
  }
  for (const session of args.durableSessions) {
    const job = sessionToJob.get(session.id);
    if (
      !job ||
      session.requestDigest !== job.requestDigest ||
      session.jobs[job.id]?.requestBinding.requestDigest !== job.requestDigest
    ) {
      throw exportInvariantError('durable session binding is inconsistent');
    }
  }
  for (const row of [...args.durableSessionEvents, ...args.durableJournalEntries]) {
    const job = sessionToJob.get(row.sessionId);
    if (!job || row.jobId !== job.id || !jobsById.has(row.jobId)) {
      throw exportInvariantError('durable session child ownership is inconsistent');
    }
  }

  const allowedBudgetIds = new Set(args.budgetIds);
  if (
    args.budgetLedgers.length !== allowedBudgetIds.size ||
    args.budgetLedgers.some((budget) => !allowedBudgetIds.has(budget.id))
  ) {
    throw exportInvariantError('budget ledger binding is inconsistent');
  }
  for (const row of [...args.billableCalls, ...args.budgetEvents]) {
    if (!allowedBudgetIds.has(row.budgetId)) {
      throw exportInvariantError('budget child ownership is inconsistent');
    }
  }

  const grantIds = new Set(args.delegationGrants.map((grant) => grant.id));
  if (args.delegationUses.some((use) => !grantIds.has(use.grantId))) {
    throw exportInvariantError('delegation receipt ownership is inconsistent');
  }
  const captureIds = new Set(args.evidenceCaptures.map((capture) => capture.id));
  if (args.evidenceSteps.some((step) => !captureIds.has(step.captureId))) {
    throw exportInvariantError('evidence step ownership is inconsistent');
  }
  const revisionsById = new Map(args.sourceRevisions.map((revision) => [revision.id, revision]));
  for (const revision of args.sourceRevisions) {
    if (
      revision.predecessorRevisionId !== undefined &&
      (revisionsById.get(revision.predecessorRevisionId)?.revisionDigest !==
        revision.predecessorRevisionDigest ||
        revision.predecessorRevisionId === revision.id)
    ) {
      throw exportInvariantError('source revision predecessor binding is inconsistent');
    }
  }
  for (const capture of args.evidenceCaptures) {
    if (
      capture.sourceRevisionId !== undefined &&
      revisionsById.get(capture.sourceRevisionId)?.revisionDigest !== capture.sourceRevisionDigest
    ) {
      throw exportInvariantError('evidence capture source revision binding is inconsistent');
    }
  }
  const patchesById = new Set(args.patches.map((patch) => patch.id));
  const stepsById = new Map(args.evidenceSteps.map((step) => [step.id, step]));
  const capturesById = new Map(args.evidenceCaptures.map((capture) => [capture.id, capture]));
  for (const receipt of args.claimEvidenceReceipts) {
    const revision = revisionsById.get(receipt.sourceRevisionId);
    const capture = capturesById.get(receipt.captureId);
    const step = stepsById.get(receipt.evidenceStepId);
    if (
      !patchesById.has(receipt.patchId) ||
      revision?.revisionDigest !== receipt.sourceRevisionDigest ||
      capture?.captureDigest !== receipt.captureDigest ||
      capture?.sourceRevisionId !== receipt.sourceRevisionId ||
      step?.captureId !== receipt.captureId ||
      step?.evidenceStepDigest !== receipt.evidenceStepDigest ||
      step?.attachmentDigest !== receipt.attachmentDigest
    ) {
      throw exportInvariantError('claim evidence receipt custody binding is inconsistent');
    }
  }
}

function exportInvariantError(detail: string): Error {
  return new Error(`NodeSlide data export failed closed: ${detail}.`);
}

function redactRows<T extends StoredRow>(
  rows: readonly T[],
  state: RedactionState,
  omittedFields: readonly string[] = [],
): NodeSlideDataExportRecord[] {
  const omissions = new Set(omittedFields);
  return [...rows]
    .sort(
      (left, right) =>
        left._creationTime - right._creationTime ||
        String(left.id ?? left._id).localeCompare(String(right.id ?? right._id)),
    )
    .map((row) => redactRecord(row, state, omissions));
}

function redactRecord(
  value: object,
  state: RedactionState,
  omittedFields: ReadonlySet<string> = new Set(),
): NodeSlideDataExportRecord {
  const redacted = redactValue(value, state, omittedFields);
  if (!redacted || Array.isArray(redacted) || typeof redacted !== 'object') {
    throw exportInvariantError('a persisted record could not be serialized');
  }
  return redacted;
}

function redactValue(
  value: unknown,
  state: RedactionState,
  omittedFields: ReadonlySet<string>,
): NodeSlideDataExportValue | undefined {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return redactString(value, state);
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const redacted = redactValue(item, state, omittedFields);
      return redacted === undefined ? [] : [redacted];
    });
  }
  if (typeof value !== 'object' || value === undefined) return undefined;
  const record: NodeSlideDataExportRecord = {};
  for (const [key, item] of Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (key === '_id' || key === '_creationTime' || item === undefined) continue;
    if (omittedFields.has(key) || isSensitiveField(key)) {
      state.removedFieldCount += 1;
      continue;
    }
    const redacted = redactValue(item, state, omittedFields);
    if (redacted !== undefined) record[key] = redacted;
  }
  return record;
}

function isSensitiveField(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (
    [
      'owneraccesskey',
      'shareslug',
      'idempotencykey',
      'streamid',
      'workflowid',
      'ownerdigest',
      'executiondigest',
      'admissionquotasubject',
      'codeverifier',
      'codeverifierciphertext',
      'authorization',
      'cookie',
      'setcookie',
      'providerconsent',
      'clientsessionid',
      'lastmutationkey',
    ].includes(normalized)
  ) {
    return true;
  }
  if (
    normalized.includes('ciphertext') ||
    normalized.includes('password') ||
    normalized.includes('passphrase') ||
    normalized.includes('secret') ||
    normalized.includes('credential') ||
    normalized.includes('privatekey') ||
    normalized.includes('apikey') ||
    normalized.includes('accesskey') ||
    normalized.includes('capabilitykey') ||
    normalized.endsWith('capability') ||
    normalized.endsWith('capabilitytoken') ||
    normalized.endsWith('capabilityvalue')
  ) {
    return true;
  }
  if (normalized.endsWith('storageid')) return true;
  if (
    /^(?:owner|share|read|write|admin|session)?capability(?:key|token|value)?$/.test(normalized)
  ) {
    return true;
  }
  return /^(?:access|refresh|auth|authorization|bearer|oauth|provider)?token(?:ciphertext|value)?$/.test(
    normalized,
  );
}

function redactString(value: string, state: RedactionState): string {
  const structured = redactSerializedJson(value, state);
  if (structured !== undefined) return structured;
  if (/^data:(?:image\/[^;,]+|application\/pdf);base64,/i.test(value)) {
    state.redactedValueCount += 1;
    return OMITTED_BINARY_DATA;
  }
  let redacted = value;
  for (const sensitiveValue of state.sensitiveValues) {
    redacted = redacted.split(sensitiveValue).join(REDACTED);
  }
  redacted = redacted
    .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`)
    .replace(/\bshare-[a-f0-9]{36}\b/gi, REDACTED)
    .replace(/(^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?=$|[^A-Za-z0-9_-])/g, `$1${REDACTED}`)
    .replace(/\b(?:sk|rk|pk|api)[-_][A-Za-z0-9_-]{12,}\b/gi, REDACTED)
    .replace(/\b(?:ghp|github_pat|glpat)[-_][A-Za-z0-9_-]{12,}\b/gi, REDACTED)
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, REDACTED)
    .replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, REDACTED)
    .replace(
      /((?:[a-z0-9]+[_-])*(?:api[_-]?key|access[_-]?key|access[_-]?token|refresh[_-]?token|authorization|secret|password|credential|signature|capability|private[_-]?key))(\s*[:=]\s*)[^\s,;&]+/gi,
      `$1$2${REDACTED}`,
    )
    .replace(/\btoken(\s*[:=]\s*)[^\s,;&]+/gi, `token$1${REDACTED}`);
  if (redacted !== value) state.redactedValueCount += 1;
  return redacted;
}

function redactSerializedJson(value: string, state: RedactionState): string | undefined {
  const trimmed = value.trim();
  if (
    !(
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    )
  ) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const redacted = redactValue(parsed, state, new Set());
    return redacted === undefined ? undefined : JSON.stringify(redacted);
  } catch {
    return undefined;
  }
}

function dataCollectionManifest(
  data: NodeSlideOwnerDataExport['data'],
): NodeSlideDataExportCollectionManifest[] {
  return [
    { path: 'data.deckSpec.deck', recordCount: 1 },
    { path: 'data.deckSpec.slides', recordCount: data.deckSpec.slides.length },
    { path: 'data.deckSpec.elements', recordCount: data.deckSpec.elements.length },
    { path: 'data.versions', recordCount: data.versions.length },
    { path: 'data.proposals.patches', recordCount: data.proposals.patches.length },
    {
      path: 'data.proposals.variationBatches',
      recordCount: data.proposals.variationBatches.length,
    },
    { path: 'data.proposals.variations', recordCount: data.proposals.variations.length },
    {
      path: 'data.proposals.variationDecisions',
      recordCount: data.proposals.variationDecisions.length,
    },
    { path: 'data.sources', recordCount: data.sources.length },
    { path: 'data.sourceRevisions', recordCount: data.sourceRevisions?.length ?? 0 },
    { path: 'data.evidence.captures', recordCount: data.evidence.captures.length },
    { path: 'data.evidence.steps', recordCount: data.evidence.steps.length },
    {
      path: 'data.evidence.claimReceipts',
      recordCount: data.evidence.claimReceipts?.length ?? 0,
    },
    { path: 'data.memories', recordCount: data.memories.length },
    { path: 'data.scopedMemories', recordCount: data.scopedMemories.length },
    {
      path: 'data.sourceRefresh.schedules',
      recordCount: data.sourceRefresh.schedules.length,
    },
    {
      path: 'data.sourceRefresh.proposals',
      recordCount: data.sourceRefresh.proposals.length,
    },
    { path: 'data.activity.jobs', recordCount: data.activity.jobs.length },
    {
      path: 'data.activity.durableSessions',
      recordCount: data.activity.durableSessions.length,
    },
    {
      path: 'data.activity.durableSessionEvents',
      recordCount: data.activity.durableSessionEvents.length,
    },
    {
      path: 'data.activity.durableJournalEntries',
      recordCount: data.activity.durableJournalEntries.length,
    },
    { path: 'data.activity.runs', recordCount: data.activity.runs.length },
    { path: 'data.activity.messages', recordCount: data.activity.messages.length },
    { path: 'data.activity.spans', recordCount: data.activity.spans.length },
    { path: 'data.activity.events', recordCount: data.activity.events.length },
    { path: 'data.activity.traces', recordCount: data.activity.traces.length },
    {
      path: 'data.activity.executionTraces',
      recordCount: data.activity.executionTraces.length,
    },
    {
      path: 'data.activity.shadowComparisons',
      recordCount: data.activity.shadowComparisons.length,
    },
    { path: 'data.activity.validations', recordCount: data.activity.validations.length },
    { path: 'data.activity.roleStages', recordCount: data.activity.roleStages.length },
    { path: 'data.budgets.ledgers', recordCount: data.budgets.ledgers.length },
    { path: 'data.budgets.billableCalls', recordCount: data.budgets.billableCalls.length },
    { path: 'data.budgets.events', recordCount: data.budgets.events.length },
    { path: 'data.sync.connections', recordCount: data.sync.connections.length },
    { path: 'data.sync.googleStates', recordCount: data.sync.googleStates.length },
    { path: 'data.sync.pptxLinks', recordCount: data.sync.pptxLinks.length },
    { path: 'data.delegation.grants', recordCount: data.delegation.grants.length },
    { path: 'data.delegation.uses', recordCount: data.delegation.uses.length },
    { path: 'data.outputs.exports', recordCount: data.outputs.exports.length },
    { path: 'data.outputs.publications', recordCount: data.outputs.publications.length },
    { path: 'data.preferenceEvents', recordCount: data.preferenceEvents.length },
    { path: 'data.comments', recordCount: data.comments.length },
  ];
}
