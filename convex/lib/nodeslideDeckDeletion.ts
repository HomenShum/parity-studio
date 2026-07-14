import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export const NODESLIDE_DECK_ERASURE_TABLES = [
  'nodeslide_slides',
  'nodeslide_elements',
  'nodeslide_patches',
  'nodeslide_variation_batches',
  'nodeslide_variations',
  'nodeslide_variation_decisions',
  'nodeslide_comments',
  'nodeslide_versions',
  'nodeslide_sources',
  'nodeslide_agent_runs',
  'nodeslide_agent_messages',
  'nodeslide_agent_memories',
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

type DeleteDeckCtx = Pick<MutationCtx, 'db'>;

/**
 * Deletes a NodeSlide deck and every row whose schema binds it to that deck.
 * All relationship checks and reads happen before the first write so an
 * ambiguous project link fails closed. Convex then commits the writes atomically.
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
    .collect();
  if (linkedDecks.length !== 1 || linkedDecks[0]?._id !== deck._id) {
    throw new Error('NodeSlide deck deletion failed closed: project binding is ambiguous.');
  }

  const tenantDecks = await ctx.db
    .query('nodeslide_decks')
    .withIndex('by_project_id', (query) => query.eq('projectId', deck.projectId))
    .collect();
  if (tenantDecks.length !== 1 || tenantDecks[0]?._id !== deck._id) {
    throw new Error('NodeSlide deck deletion failed closed: data tenant binding is ambiguous.');
  }

  const linkedRuns = await ctx.db
    .query('runs')
    .withIndex('by_project', (query) => query.eq('projectId', deck.projectRowId))
    .collect();
  if (linkedRuns.length > 0) {
    throw new Error('NodeSlide deck deletion failed closed: the project has linked runs.');
  }

  const childGroups = await Promise.all([
    ctx.db
      .query('nodeslide_slides')
      .withIndex('by_deck', (query) => query.eq('deckId', deck.id))
      .collect(),
    ctx.db
      .query('nodeslide_elements')
      .withIndex('by_deck', (query) => query.eq('deckId', deck.id))
      .collect(),
    ctx.db
      .query('nodeslide_patches')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .collect(),
    ctx.db
      .query('nodeslide_variation_batches')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .collect(),
    ctx.db
      .query('nodeslide_variations')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .collect(),
    ctx.db
      .query('nodeslide_variation_decisions')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .collect(),
    ctx.db
      .query('nodeslide_comments')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .collect(),
    ctx.db
      .query('nodeslide_versions')
      .withIndex('by_deck_version', (query) => query.eq('deckId', deck.id))
      .collect(),
    ctx.db
      .query('nodeslide_sources')
      .withIndex('by_deck', (query) => query.eq('deckId', deck.id))
      .collect(),
    ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .collect(),
    ctx.db
      .query('nodeslide_agent_messages')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .collect(),
    ctx.db
      .query('nodeslide_agent_memories')
      .withIndex('by_deck_updated', (query) => query.eq('deckId', deck.id))
      .collect(),
    ctx.db
      .query('nodeslide_agent_spans')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .collect(),
    ctx.db
      .query('nodeslide_agent_events')
      .withIndex('by_deck_timestamp', (query) => query.eq('deckId', deck.id))
      .collect(),
    ctx.db
      .query('nodeslide_validations')
      .withIndex('by_deck_checked', (query) => query.eq('deckId', deck.id))
      .collect(),
    ctx.db
      .query('nodeslide_traces')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .collect(),
    ctx.db
      .query('nodeslide_execution_traces')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .collect(),
    ctx.db
      .query('nodeslide_shadow_comparisons')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .collect(),
    ctx.db
      .query('nodeslide_exports')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deck.id))
      .collect(),
    ctx.db
      .query('nodeslide_publications')
      .withIndex('by_deck_revision', (query) => query.eq('deckId', deck.id))
      .collect(),
    ctx.db
      .query('nodeslide_preference_events')
      .withIndex('by_deck_recorded', (query) => query.eq('deckId', deck.id))
      .collect(),
    ctx.db
      .query('nodeslide_signature_profiles')
      .withIndex('by_tenant_updated', (query) => query.eq('tenantId', deck.projectId))
      .collect(),
    ctx.db
      .query('nodeslide_taste_profiles')
      .withIndex('by_tenant', (query) => query.eq('tenantId', deck.projectId))
      .collect(),
    ctx.db
      .query('nodeslide_presence')
      .withIndex('by_deck_session', (query) => query.eq('deckId', deck.id))
      .collect(),
  ]);

  let deletedRecords = 0;
  for (const rows of childGroups) {
    for (const row of rows) {
      await ctx.db.delete(row._id);
      deletedRecords += 1;
    }
  }
  await ctx.db.delete(deck._id);
  await ctx.db.delete(project._id);

  return { deleted: true, deckId: deck.id, deletedRecords: deletedRecords + 2 };
}
