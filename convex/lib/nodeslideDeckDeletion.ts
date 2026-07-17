import { getConvexSize } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export const NODESLIDE_DECK_ERASURE_TABLES = [
  'nodeslide_slides',
  'nodeslide_elements',
  'nodeslide_patches',
  'nodeslide_delegation_grants',
  'nodeslide_delegation_uses',
  'nodeslide_variation_batches',
  'nodeslide_variations',
  'nodeslide_variation_decisions',
  'nodeslide_comments',
  'nodeslide_versions',
  'nodeslide_sources',
  'nodeslide_claim_evidence_receipts',
  'nodeslide_source_revisions',
  'nodeslide_uploads',
  'nodeslide_evidence_steps',
  'nodeslide_evidence_captures',
  'nodeslide_sync_connections',
  'nodeslide_pptx_sync_links',
  'nodeslide_google_sync_states',
  'nodeslide_oauth_sessions',
  'nodeslide_oauth_credentials',
  'nodeslide_agent_runs',
  'nodeslide_agent_messages',
  'nodeslide_role_stages',
  'nodeslide_source_refresh_schedules',
  'nodeslide_source_refresh_proposals',
  'nodeslide_agent_memories',
  'nodeslide_scoped_memories',
  'nodeslide_agent_spans',
  'nodeslide_agent_events',
  'nodeslide_validations',
  'nodeslide_traces',
  'nodeslide_execution_traces',
  'nodeslide_shadow_comparisons',
  'nodeslide_exports',
  'nodeslide_publications',
  'nodeslide_preference_events',
  'nodeslide_signature_profiles',
  'nodeslide_taste_profiles',
  'nodeslide_presence',
] as const;

// Convex currently permits larger transactions, but deletion deliberately
// reserves substantial headroom for reads, index ranges, and platform changes.
// Decks beyond either bound are not partially erased.
export const NODESLIDE_DECK_ERASURE_MAX_RECORDS = 4_000;
export const NODESLIDE_DECK_ERASURE_MAX_BYTES = 4 * 1024 * 1024;

type DeleteDeckCtx = Pick<MutationCtx, 'db' | 'storage'>;
type ErasureTable = (typeof NODESLIDE_DECK_ERASURE_TABLES)[number];
type ErasureRow = Doc<ErasureTable>;
const NODESLIDE_SCOPED_MEMORY_VERSION = 'nodeslide.scoped-memory/v1';

function nodeSlideDeckScopedMemoryKey(deck: Doc<'nodeslide_decks'>): string {
  return [
    NODESLIDE_SCOPED_MEMORY_VERSION,
    'workspace',
    deck.workspaceId ?? deck.clientSessionId,
    'project',
    deck.workspaceProjectId ?? deck.projectId,
    'deck',
    deck.id,
  ]
    .map(encodeURIComponent)
    .join('/');
}

/**
 * Atomically erases a deck only when its complete deletion set fits the
 * conservative record and byte envelope above. Every read is bounded and all
 * checks finish before the first write. Arbitrarily large decks require a
 * future durable tombstone/batch workflow and are intentionally rejected.
 */
export async function deleteNodeSlideDeckRows(
  ctx: DeleteDeckCtx,
  deck: Doc<'nodeslide_decks'>,
): Promise<{ deleted: true; deckId: string; deletedRecords: number }> {
  const project = await ctx.db.get(deck.projectRowId);
  if (
    !project ||
    project.domain !== 'nodeslide' ||
    project.clientSessionId !== deck.clientSessionId
  ) {
    throw new Error('NodeSlide deck deletion failed closed: project binding is invalid.');
  }

  const linkedDecks = await ctx.db
    .query('nodeslide_decks')
    .withIndex('by_project_row', (query) => query.eq('projectRowId', deck.projectRowId))
    .take(2);
  if (linkedDecks.length !== 1 || linkedDecks[0]?._id !== deck._id) {
    throw new Error('NodeSlide deck deletion failed closed: project binding is ambiguous.');
  }

  const tenantDecks = await ctx.db
    .query('nodeslide_decks')
    .withIndex('by_project_id', (query) => query.eq('projectId', deck.projectId))
    .take(2);
  if (tenantDecks.length !== 1 || tenantDecks[0]?._id !== deck._id) {
    throw new Error('NodeSlide deck deletion failed closed: data tenant binding is ambiguous.');
  }

  const linkedRuns = await ctx.db
    .query('runs')
    .withIndex('by_project', (query) => query.eq('projectId', deck.projectRowId))
    .take(1);
  if (linkedRuns.length > 0) {
    throw new Error('NodeSlide deck deletion failed closed: the project has linked runs.');
  }

  const childGroups: ErasureRow[][] = [];
  const attachmentStorageIds = new Set<Id<'_storage'>>();
  let deletionRecords = 2;
  let deletionBytes = getConvexSize(deck) + getConvexSize(project);

  const nextLimit = () => Math.max(1, NODESLIDE_DECK_ERASURE_MAX_RECORDS - deletionRecords + 1);
  const addGroup = (rows: ErasureRow[]) => {
    const remaining = NODESLIDE_DECK_ERASURE_MAX_RECORDS - deletionRecords;
    if (rows.length > remaining) throwAtomicRecordLimit();
    deletionRecords += rows.length;
    for (const row of rows) deletionBytes += getConvexSize(row);
    if (deletionBytes > NODESLIDE_DECK_ERASURE_MAX_BYTES) throwAtomicByteLimit();
    childGroups.push(rows);
  };

  addGroup(
    await ctx.db
      .query('nodeslide_slides')
      .withIndex('by_deck', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_elements')
      .withIndex('by_deck', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_patches')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_delegation_grants')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_delegation_uses')
      .withIndex('by_deck_used', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_variation_batches')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_variations')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_variation_decisions')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_comments')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_versions')
      .withIndex('by_deck_version', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_sources')
      .withIndex('by_deck', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_claim_evidence_receipts')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_source_revisions')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  const uploads = await ctx.db
    .query('nodeslide_uploads')
    .withIndex('by_deck_updated', (query) => query.eq('deckId', deck.id))
    .take(nextLimit());
  for (const upload of uploads) {
    if (upload.storageId) attachmentStorageIds.add(upload.storageId);
  }
  addGroup(uploads);
  const evidenceSteps = await ctx.db
    .query('nodeslide_evidence_steps')
    .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
    .take(nextLimit());
  for (const step of evidenceSteps) {
    if (step.screenshotStorageId) attachmentStorageIds.add(step.screenshotStorageId);
    if (step.pdfStorageId) attachmentStorageIds.add(step.pdfStorageId);
  }
  addGroup(evidenceSteps);
  addGroup(
    await ctx.db
      .query('nodeslide_evidence_captures')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_sync_connections')
      .withIndex('by_deck_provider', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_pptx_sync_links')
      .withIndex('by_deck', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_google_sync_states')
      .withIndex('by_deck', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_oauth_sessions')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_oauth_credentials')
      .withIndex('by_deck_provider', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_agent_messages')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_role_stages')
      .withIndex('by_deck_ordinal', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_source_refresh_schedules')
      .withIndex('by_deck_updated', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_source_refresh_proposals')
      .withIndex('by_deck_status_created', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_agent_memories')
      .withIndex('by_deck_updated', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  const scopedMemories = await ctx.db
    .query('nodeslide_scoped_memories')
    .withIndex('by_scope_status_updated', (query) =>
      query.eq('scopeKey', nodeSlideDeckScopedMemoryKey(deck)),
    )
    .take(nextLimit());
  for (const memory of scopedMemories) {
    if (
      memory.schemaVersion !== NODESLIDE_SCOPED_MEMORY_VERSION ||
      memory.scopeKind !== 'deck' ||
      memory.deckId !== deck.id ||
      memory.workspaceId !== (deck.workspaceId ?? deck.clientSessionId) ||
      memory.projectId !== (deck.workspaceProjectId ?? deck.projectId)
    ) {
      throw new Error('NodeSlide deck deletion failed closed: scoped memory binding is invalid.');
    }
  }
  addGroup(scopedMemories);
  addGroup(
    await ctx.db
      .query('nodeslide_agent_spans')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_agent_events')
      .withIndex('by_deck_timestamp', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_validations')
      .withIndex('by_deck_checked', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_traces')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_execution_traces')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_shadow_comparisons')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_exports')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_publications')
      .withIndex('by_deck_revision', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_preference_events')
      .withIndex('by_deck_recorded', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_signature_profiles')
      .withIndex('by_tenant_updated', (query) => query.eq('tenantId', deck.projectId))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_taste_profiles')
      .withIndex('by_tenant', (query) => query.eq('tenantId', deck.projectId))
      .take(nextLimit()),
  );
  addGroup(
    await ctx.db
      .query('nodeslide_presence')
      .withIndex('by_deck_session', (query) => query.eq('deckId', deck.id))
      .take(nextLimit()),
  );

  for (const storageId of attachmentStorageIds) await ctx.storage.delete(storageId);
  for (const rows of childGroups) {
    for (const row of rows) await ctx.db.delete(row._id);
  }
  await ctx.db.delete(deck._id);
  await ctx.db.delete(project._id);

  return { deleted: true, deckId: deck.id, deletedRecords: deletionRecords };
}

function throwAtomicRecordLimit(): never {
  throw new Error(
    `NodeSlide deck deletion failed closed: the complete erasure set exceeds the atomic limit of ${NODESLIDE_DECK_ERASURE_MAX_RECORDS} records; no records were deleted.`,
  );
}

function throwAtomicByteLimit(): never {
  throw new Error(
    `NodeSlide deck deletion failed closed: the complete erasure set exceeds the atomic limit of ${NODESLIDE_DECK_ERASURE_MAX_BYTES} bytes; no records were deleted.`,
  );
}
