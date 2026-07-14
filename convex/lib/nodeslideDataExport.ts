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
import { nodeslideContentDigest } from './nodeslideIds';
import { nodeSlideJobOwnerDigest } from './nodeslideJobState';

export const NODESLIDE_DATA_EXPORT_MAX_ROWS_PER_COLLECTION = 1_000;
export const NODESLIDE_DATA_EXPORT_MAX_RECORDS = 8_000;
export const NODESLIDE_DATA_EXPORT_MAX_BYTES = 8 * 1024 * 1024;

const REDACTED = '[REDACTED]';
const EXCLUDED_COLLECTIONS = [
  { name: 'nodeslide_oauth_sessions', reason: 'authentication_material' as const },
  { name: 'nodeslide_oauth_credentials', reason: 'authentication_material' as const },
  { name: 'nodeslide_presence', reason: 'ephemeral_runtime_state' as const },
];

type ExportCtx = Pick<QueryCtx, 'db'>;
type ScopedRow = { deckId: string };
type StoredRow = { _id: unknown; _creationTime: number; id?: string };

interface RedactionState {
  removedFieldCount: number;
  redactedValueCount: number;
  sensitiveValues: string[];
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
    jobs,
    runs,
    messages,
    memories,
    spans,
    events,
    validations,
    traces,
    executionTraces,
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
  ]);

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
    ['jobs', jobs],
    ['runs', runs],
    ['messages', messages],
    ['memories', memories],
    ['spans', spans],
    ['events', events],
    ['validations', validations],
    ['traces', traces],
    ['execution traces', executionTraces],
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
    runs,
    messages,
    memories,
    spans,
    events,
    validations,
    traces,
    executionTraces,
  ]) {
    assertDeckScopedRows(deck.id, rows);
  }

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
  for (const version of versions) assertVersionSnapshotScope(version, deck.id);

  const recordCount = 1 + collections.reduce((total, [, rows]) => total + rows.length, 0);
  if (recordCount > NODESLIDE_DATA_EXPORT_MAX_RECORDS) {
    throw new Error(
      `NodeSlide data export exceeds the complete-export limit of ${NODESLIDE_DATA_EXPORT_MAX_RECORDS} records. No partial bundle was returned.`,
    );
  }

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
    memories: redactRows(memories, redaction),
    activity: {
      jobs: redactRows(jobs, redaction),
      runs: redactRows(runs, redaction),
      messages: redactRows(messages, redaction),
      spans: redactRows(spans, redaction),
      events: redactRows(events, redaction),
      traces: redactRows(traces, redaction),
      executionTraces: redactRows(executionTraces, redaction),
      validations: redactRows(validations, redaction),
    },
    comments: redactRows(comments, redaction),
  };
  const collectionManifest = dataCollectionManifest(data);
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

function exportInvariantError(detail: string): Error {
  return new Error(`NodeSlide data export failed closed: ${detail}.`);
}

function redactRows<T extends StoredRow>(
  rows: readonly T[],
  state: RedactionState,
): NodeSlideDataExportRecord[] {
  return [...rows]
    .sort(
      (left, right) =>
        left._creationTime - right._creationTime ||
        String(left.id ?? left._id).localeCompare(String(right.id ?? right._id)),
    )
    .map((row) => redactRecord(row, state));
}

function redactRecord(value: object, state: RedactionState): NodeSlideDataExportRecord {
  const redacted = redactValue(value, state);
  if (!redacted || Array.isArray(redacted) || typeof redacted !== 'object') {
    throw exportInvariantError('a persisted record could not be serialized');
  }
  return redacted;
}

function redactValue(value: unknown, state: RedactionState): NodeSlideDataExportValue | undefined {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return redactString(value, state);
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const redacted = redactValue(item, state);
      return redacted === undefined ? [] : [redacted];
    });
  }
  if (typeof value !== 'object' || value === undefined) return undefined;
  const record: NodeSlideDataExportRecord = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === '_id' || key === '_creationTime' || item === undefined) continue;
    if (isSensitiveField(key)) {
      state.removedFieldCount += 1;
      continue;
    }
    const redacted = redactValue(item, state);
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
    ].includes(normalized)
  ) {
    return true;
  }
  if (
    normalized.includes('password') ||
    normalized.includes('passphrase') ||
    normalized.includes('secret') ||
    normalized.includes('credential') ||
    normalized.includes('privatekey') ||
    normalized.includes('apikey') ||
    normalized.includes('accesskey') ||
    normalized.includes('capabilitykey')
  ) {
    return true;
  }
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
    { path: 'data.memories', recordCount: data.memories.length },
    { path: 'data.activity.jobs', recordCount: data.activity.jobs.length },
    { path: 'data.activity.runs', recordCount: data.activity.runs.length },
    { path: 'data.activity.messages', recordCount: data.activity.messages.length },
    { path: 'data.activity.spans', recordCount: data.activity.spans.length },
    { path: 'data.activity.events', recordCount: data.activity.events.length },
    { path: 'data.activity.traces', recordCount: data.activity.traces.length },
    {
      path: 'data.activity.executionTraces',
      recordCount: data.activity.executionTraces.length,
    },
    { path: 'data.activity.validations', recordCount: data.activity.validations.length },
    { path: 'data.comments', recordCount: data.comments.length },
  ];
}
