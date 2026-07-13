import type {
  AgentTrace,
  ChartData,
  Deck,
  DeckComment,
  DeckPatch,
  DeckSnapshot,
  DeckVersion,
  ExportArtifact,
  ImageData,
  MathData,
  NodeSlidePublication,
  NodeSlideWorkspace,
  Presence,
  PublishedDeckSnapshot,
  PublishedNodeSlide,
  PublishedSourceRecord,
  Slide,
  SlideElement,
  SourceRecord,
  ValidationResult,
} from '../../shared/nodeslide';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

type ReadCtx = Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>;

/**
 * Workspace history is a preview, not an archive. Direct indexed lookups keep
 * restore and patch actions available for records outside these response caps.
 */
export const NODESLIDE_WORKSPACE_LIMITS = {
  comments: 192,
  patches: 96,
  versions: 24,
  traces: 64,
  validations: 32,
  exports: 32,
  presence: 64,
  publications: 8,
} as const;

export function deckFromRow(row: Doc<'nodeslide_decks'>): Deck {
  return {
    schemaVersion: row.schemaVersion,
    toolchainVersion: row.toolchainVersion,
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    brief: row.brief,
    theme: row.theme,
    slideOrder: row.slideOrder,
    version: row.version,
    status: row.status,
    ...(row.activeSignatureProfileId !== undefined
      ? { activeSignatureProfileId: row.activeSignatureProfileId }
      : {}),
    ...(row.activeSignatureProfileDigest !== undefined
      ? { activeSignatureProfileDigest: row.activeSignatureProfileDigest }
      : {}),
    ...(row.shareSlug !== undefined ? { shareSlug: row.shareSlug } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function slideFromRow(row: Doc<'nodeslide_slides'>): Slide {
  return {
    id: row.id,
    deckId: row.deckId,
    title: row.title,
    ...(row.section !== undefined ? { section: row.section } : {}),
    ...(row.notes !== undefined ? { notes: row.notes } : {}),
    background: row.background,
    elementOrder: row.elementOrder,
    version: row.version,
  };
}

export function elementFromRow(row: Doc<'nodeslide_elements'>): SlideElement {
  return {
    id: row.id,
    slideId: row.slideId,
    name: row.name,
    kind: row.kind,
    ...(row.role !== undefined ? { role: row.role } : {}),
    bbox: row.bbox,
    rotation: row.rotation,
    ...(row.content !== undefined ? { content: row.content } : {}),
    style: row.style,
    ...(row.chart !== undefined ? { chart: row.chart } : {}),
    ...(row.math !== undefined ? { math: row.math } : {}),
    ...(row.video !== undefined ? { video: row.video } : {}),
    ...(row.image !== undefined ? { image: row.image } : {}),
    ...(row.imageUrl !== undefined ? { imageUrl: row.imageUrl } : {}),
    ...(row.altText !== undefined ? { altText: row.altText } : {}),
    sourceIds: row.sourceIds,
    locked: row.locked,
    visible: row.visible ?? true,
    ...(row.groupId !== undefined ? { groupId: row.groupId } : {}),
    exportCapabilities: row.exportCapabilities,
    version: row.version,
  };
}

export function sourceFromRow(row: Doc<'nodeslide_sources'>): SourceRecord {
  return {
    id: row.id,
    deckId: row.deckId,
    title: row.title,
    ...(row.url !== undefined ? { url: row.url } : {}),
    sourceType: row.sourceType,
    retrievedAt: row.retrievedAt,
    citation: row.citation,
    ...(row.license !== undefined ? { license: row.license } : {}),
  };
}

export function patchFromRow(row: Doc<'nodeslide_patches'>): DeckPatch {
  return {
    id: row.id,
    deckId: row.deckId,
    baseDeckVersion: row.baseDeckVersion,
    baseSlideVersions: row.baseSlideVersions,
    baseElementVersions: row.baseElementVersions,
    ...(row.resultingDeckVersion !== undefined
      ? { resultingDeckVersion: row.resultingDeckVersion }
      : {}),
    scope: row.scope,
    operations: row.operations,
    source: row.source,
    status: row.status,
    summary: row.summary,
    ...(row.linkedCommentId !== undefined ? { linkedCommentId: row.linkedCommentId } : {}),
    ...(row.traceId !== undefined ? { traceId: row.traceId } : {}),
    ...(row.proposalKind !== undefined ? { proposalKind: row.proposalKind } : {}),
    ...(row.parentPatchId !== undefined ? { parentPatchId: row.parentPatchId } : {}),
    ...(row.affectedSlideIds !== undefined ? { affectedSlideIds: row.affectedSlideIds } : {}),
    ...(row.affectedSlideDigest !== undefined
      ? { affectedSlideDigest: row.affectedSlideDigest }
      : {}),
    ...(row.candidateDigest !== undefined ? { candidateDigest: row.candidateDigest } : {}),
    ...(row.candidateValidation !== undefined
      ? { candidateValidation: row.candidateValidation }
      : {}),
    ...(row.profileId !== undefined ? { profileId: row.profileId } : {}),
    ...(row.profileDigest !== undefined ? { profileDigest: row.profileDigest } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function commentFromRow(row: Doc<'nodeslide_comments'>): DeckComment {
  return {
    id: row.id,
    deckId: row.deckId,
    ...(row.parentId !== undefined ? { parentId: row.parentId } : {}),
    anchor: row.anchor,
    authorId: row.authorId,
    authorName: row.authorName,
    text: row.text,
    status: row.status,
    ...(row.linkedPatchId !== undefined ? { linkedPatchId: row.linkedPatchId } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function validationFromRow(row: Doc<'nodeslide_validations'>): ValidationResult {
  return {
    id: row.id,
    deckId: row.deckId,
    deckVersion: row.deckVersion,
    ok: row.ok,
    publishOk: row.publishOk,
    cleanOk: row.cleanOk,
    issues: row.issues,
    checkedAt: row.checkedAt,
    toolchainVersion: row.toolchainVersion,
  };
}

export function traceFromRow(row: Doc<'nodeslide_traces'>): AgentTrace {
  return {
    id: row.id,
    deckId: row.deckId,
    ...(row.patchId !== undefined ? { patchId: row.patchId } : {}),
    status: row.status,
    summary: row.summary,
    plan: row.plan,
    context: row.context,
    toolCalls: row.toolCalls,
    guardrails: row.guardrails,
    ...(row.planningInputDigest !== undefined
      ? { planningInputDigest: row.planningInputDigest }
      : {}),
    ...(row.planningSnapshotDigest !== undefined
      ? { planningSnapshotDigest: row.planningSnapshotDigest }
      : {}),
    ...(row.shadowComparisonExpected !== undefined
      ? { shadowComparisonExpected: row.shadowComparisonExpected }
      : {}),
    ...(row.shadowControlsDigest !== undefined
      ? { shadowControlsDigest: row.shadowControlsDigest }
      : {}),
    ...(row.validation !== undefined ? { validation: row.validation } : {}),
    ...(row.candidateDigest !== undefined ? { candidateDigest: row.candidateDigest } : {}),
    ...(row.provider !== undefined ? { provider: row.provider } : {}),
    ...(row.model !== undefined ? { model: row.model } : {}),
    ...(row.reasoningEffort !== undefined ? { reasoningEffort: row.reasoningEffort } : {}),
    ...(row.costMicroUsd !== undefined ? { costMicroUsd: row.costMicroUsd } : {}),
    ...(row.inputTokens !== undefined ? { inputTokens: row.inputTokens } : {}),
    ...(row.outputTokens !== undefined ? { outputTokens: row.outputTokens } : {}),
    createdAt: row.createdAt,
    ...(row.completedAt !== undefined ? { completedAt: row.completedAt } : {}),
  };
}

export function versionFromRow(row: Doc<'nodeslide_versions'>): DeckVersion {
  return {
    id: row.id,
    deckId: row.deckId,
    version: row.version,
    label: row.label,
    source: row.source,
    ...(row.patchId !== undefined ? { patchId: row.patchId } : {}),
    snapshot: row.snapshot,
    createdAt: row.createdAt,
  };
}

export function exportFromRow(row: Doc<'nodeslide_exports'>): ExportArtifact {
  return {
    id: row.id,
    deckId: row.deckId,
    deckVersion: row.deckVersion,
    kind: row.kind,
    status: row.status,
    capabilityWarnings: row.capabilityWarnings,
    ...(row.fileName !== undefined ? { fileName: row.fileName } : {}),
    ...(row.url !== undefined ? { url: row.url } : {}),
    createdAt: row.createdAt,
  };
}

export function presenceFromRow(row: Doc<'nodeslide_presence'>): Presence {
  return {
    id: row.id,
    deckId: row.deckId,
    sessionId: row.sessionId,
    displayName: row.displayName,
    color: row.color,
    ...(row.slideId !== undefined ? { slideId: row.slideId } : {}),
    elementIds: row.elementIds,
    ...(row.cursor !== undefined ? { cursor: row.cursor } : {}),
    lastSeenAt: row.lastSeenAt,
  };
}

export function publicationFromRow(row: Doc<'nodeslide_publications'>): NodeSlidePublication {
  return {
    id: row.id,
    deckId: row.deckId,
    shareSlug: row.shareSlug,
    revision: row.revision,
    deckVersion: row.deckVersion,
    validationId: row.validationId,
    status: row.status,
    publishedAt: row.publishedAt,
    ...(row.supersededAt !== undefined ? { supersededAt: row.supersededAt } : {}),
    ...(row.supersededById !== undefined ? { supersededById: row.supersededById } : {}),
    ...(row.revokedAt !== undefined ? { revokedAt: row.revokedAt } : {}),
  };
}

export function publishedNodeSlideFromRow(row: Doc<'nodeslide_publications'>): PublishedNodeSlide {
  return {
    publication: publicationFromRow(row),
    snapshot: structuredClone(row.snapshot),
  };
}

/**
 * Creates a detached public snapshot. Notes, creation brief/project context,
 * signature configuration, the mutable share capability, and non-public source
 * records are intentionally omitted.
 */
export function sanitizeNodeSlideSnapshot(snapshot: DeckSnapshot): PublishedDeckSnapshot {
  const sources = snapshot.sources.flatMap((source): PublishedSourceRecord[] => {
    if (source.sourceType !== 'url') return [];
    return [
      {
        id: source.id,
        deckId: source.deckId,
        title: source.title,
        ...(source.url !== undefined ? { url: source.url } : {}),
        sourceType: 'url',
        retrievedAt: source.retrievedAt,
        citation: source.citation,
        ...(source.license !== undefined ? { license: source.license } : {}),
      },
    ];
  });
  const publicSourceIds = new Set(sources.map((source) => source.id));
  return {
    deck: {
      schemaVersion: snapshot.deck.schemaVersion,
      toolchainVersion: snapshot.deck.toolchainVersion,
      id: snapshot.deck.id,
      title: snapshot.deck.title,
      theme: structuredClone(snapshot.deck.theme),
      slideOrder: [...snapshot.deck.slideOrder],
      version: snapshot.deck.version,
      status: 'published',
      createdAt: snapshot.deck.createdAt,
      updatedAt: snapshot.deck.updatedAt,
    },
    slides: snapshot.slides.map((slide) => ({
      id: slide.id,
      deckId: slide.deckId,
      title: slide.title,
      ...(slide.section !== undefined ? { section: slide.section } : {}),
      background: slide.background,
      elementOrder: [...slide.elementOrder],
      version: slide.version,
    })),
    elements: snapshot.elements.map((element) => ({
      ...structuredClone(element),
      sourceIds: element.sourceIds.filter((sourceId) => publicSourceIds.has(sourceId)),
      ...(element.chart ? { chart: sanitizePublishedChart(element.chart, publicSourceIds) } : {}),
      ...(element.math ? { math: sanitizePublishedMath(element.math, publicSourceIds) } : {}),
      ...(element.image ? { image: sanitizePublishedImage(element.image, publicSourceIds) } : {}),
    })),
    sources,
  };
}

function sanitizePublishedMath(math: MathData, publicSourceIds: ReadonlySet<string>): MathData {
  return {
    expression: math.expression,
    ...(math.syntax !== undefined ? { syntax: math.syntax } : {}),
    ...(math.displayMode !== undefined ? { displayMode: math.displayMode } : {}),
    ...(math.description !== undefined ? { description: math.description } : {}),
    ...(math.display !== undefined ? { display: math.display } : {}),
    ...(math.variables !== undefined
      ? { variables: math.variables.map((variable) => ({ ...variable })) }
      : {}),
    ...(math.sourceId !== undefined && publicSourceIds.has(math.sourceId)
      ? { sourceId: math.sourceId }
      : {}),
  };
}

function sanitizePublishedImage(image: ImageData, publicSourceIds: ReadonlySet<string>): ImageData {
  return {
    placeholder: image.placeholder,
    ...(image.credit !== undefined ? { credit: image.credit } : {}),
    ...(image.sourceId !== undefined && publicSourceIds.has(image.sourceId)
      ? { sourceId: image.sourceId }
      : {}),
  };
}

function sanitizePublishedChart(chart: ChartData, publicSourceIds: ReadonlySet<string>): ChartData {
  return {
    chartType: chart.chartType,
    labels: [...chart.labels],
    series: chart.series.map((series) => ({
      name: series.name,
      values: [...series.values],
      ...(series.color !== undefined ? { color: series.color } : {}),
    })),
    ...(chart.unit !== undefined ? { unit: chart.unit } : {}),
    ...(chart.sourceId !== undefined && publicSourceIds.has(chart.sourceId)
      ? { sourceId: chart.sourceId }
      : {}),
  };
}

export async function findDeckRow(
  ctx: ReadCtx,
  deckId: string,
): Promise<Doc<'nodeslide_decks'> | null> {
  return await ctx.db
    .query('nodeslide_decks')
    .withIndex('by_stable_id', (query) => query.eq('id', deckId))
    .first();
}

export async function findLatestPublicationForDeck(
  ctx: ReadCtx,
  deckId: string,
): Promise<Doc<'nodeslide_publications'> | null> {
  return await ctx.db
    .query('nodeslide_publications')
    .withIndex('by_deck_revision', (query) => query.eq('deckId', deckId))
    .order('desc')
    .first();
}

export async function findLatestPublicationByShareSlug(
  ctx: ReadCtx,
  shareSlug: string,
): Promise<Doc<'nodeslide_publications'> | null> {
  return await ctx.db
    .query('nodeslide_publications')
    .withIndex('by_share_slug_revision', (query) => query.eq('shareSlug', shareSlug))
    .order('desc')
    .first();
}

export async function findCurrentValidationRow(
  ctx: ReadCtx,
  deckId: string,
  deckVersion: number,
): Promise<Doc<'nodeslide_validations'> | null> {
  return await ctx.db
    .query('nodeslide_validations')
    .withIndex('by_deck_version_checked', (query) =>
      query.eq('deckId', deckId).eq('deckVersion', deckVersion),
    )
    .order('desc')
    .first();
}

export async function findPatchRow(
  ctx: ReadCtx,
  patchId: string,
): Promise<Doc<'nodeslide_patches'> | null> {
  return await ctx.db
    .query('nodeslide_patches')
    .withIndex('by_stable_id', (query) => query.eq('id', patchId))
    .first();
}

export async function findCommentRow(
  ctx: ReadCtx,
  commentId: string,
): Promise<Doc<'nodeslide_comments'> | null> {
  return await ctx.db
    .query('nodeslide_comments')
    .withIndex('by_stable_id', (query) => query.eq('id', commentId))
    .first();
}

export async function findVersionRow(
  ctx: ReadCtx,
  args: { deckId: string; versionId?: string; version?: number },
): Promise<Doc<'nodeslide_versions'> | null> {
  if (args.versionId !== undefined) {
    const row = await ctx.db
      .query('nodeslide_versions')
      .withIndex('by_stable_id', (query) => query.eq('id', args.versionId as string))
      .first();
    return row?.deckId === args.deckId ? row : null;
  }
  if (args.version !== undefined) {
    return await ctx.db
      .query('nodeslide_versions')
      .withIndex('by_deck_version', (query) =>
        query.eq('deckId', args.deckId).eq('version', args.version as number),
      )
      .first();
  }
  return null;
}

export async function loadNodeSlideSnapshot(
  ctx: ReadCtx,
  deckId: string,
): Promise<DeckSnapshot | null> {
  const deckRow = await findDeckRow(ctx, deckId);
  if (!deckRow) return null;
  const [slideRows, elementRows, sourceRows] = await Promise.all([
    ctx.db
      .query('nodeslide_slides')
      .withIndex('by_deck', (query) => query.eq('deckId', deckId))
      .collect(),
    ctx.db
      .query('nodeslide_elements')
      .withIndex('by_deck', (query) => query.eq('deckId', deckId))
      .collect(),
    ctx.db
      .query('nodeslide_sources')
      .withIndex('by_deck', (query) => query.eq('deckId', deckId))
      .collect(),
  ]);
  const deck = deckFromRow(deckRow);
  const slideRank = new Map(deck.slideOrder.map((id, index) => [id, index]));
  const slides = slideRows
    .map(slideFromRow)
    .sort((left, right) => rank(slideRank, left.id) - rank(slideRank, right.id));
  const slideById = new Map(slides.map((slide) => [slide.id, slide]));
  const elements = elementRows.map(elementFromRow).sort((left, right) => {
    const slideDifference = rank(slideRank, left.slideId) - rank(slideRank, right.slideId);
    if (slideDifference !== 0) return slideDifference;
    const leftSlide = slideById.get(left.slideId);
    const rightSlide = slideById.get(right.slideId);
    const leftRank = leftSlide?.elementOrder.indexOf(left.id) ?? -1;
    const rightRank = rightSlide?.elementOrder.indexOf(right.id) ?? -1;
    return normalizedRank(leftRank) - normalizedRank(rightRank);
  });
  const sources = sourceRows
    .map(sourceFromRow)
    .sort((left, right) => left.id.localeCompare(right.id));
  return { deck, slides, elements, sources };
}

export async function loadNodeSlideWorkspace(
  ctx: ReadCtx,
  deckId: string,
  now: number,
): Promise<NodeSlideWorkspace | null> {
  const snapshot = await loadNodeSlideSnapshot(ctx, deckId);
  if (!snapshot) return null;
  const activeTraceLimit = Math.ceil(NODESLIDE_WORKSPACE_LIMITS.traces / 4);
  const activeExportLimit = Math.ceil(NODESLIDE_WORKSPACE_LIMITS.exports / 2);
  const [
    recentCommentRows,
    openCommentRows,
    recentPatchRows,
    readyPatchRows,
    versionRows,
    recentTraceRows,
    planningTraceRows,
    workingTraceRows,
    reviewTraceRows,
    validationRows,
    recentExportRows,
    queuedExportRows,
    renderingExportRows,
    presenceRows,
    publicationRow,
  ] = await Promise.all([
    ctx.db
      .query('nodeslide_comments')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deckId))
      .order('desc')
      .take(NODESLIDE_WORKSPACE_LIMITS.comments),
    ctx.db
      .query('nodeslide_comments')
      .withIndex('by_deck_status_created', (query) =>
        query.eq('deckId', deckId).eq('status', 'open'),
      )
      .order('desc')
      .take(Math.ceil(NODESLIDE_WORKSPACE_LIMITS.comments / 2)),
    ctx.db
      .query('nodeslide_patches')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deckId))
      .order('desc')
      .take(NODESLIDE_WORKSPACE_LIMITS.patches),
    ctx.db
      .query('nodeslide_patches')
      .withIndex('by_deck_status_created', (query) =>
        query.eq('deckId', deckId).eq('status', 'ready'),
      )
      .order('desc')
      .take(Math.ceil(NODESLIDE_WORKSPACE_LIMITS.patches / 2)),
    ctx.db
      .query('nodeslide_versions')
      .withIndex('by_deck_version', (query) => query.eq('deckId', deckId))
      .order('desc')
      .take(NODESLIDE_WORKSPACE_LIMITS.versions),
    ctx.db
      .query('nodeslide_traces')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deckId))
      .order('desc')
      .take(NODESLIDE_WORKSPACE_LIMITS.traces),
    ctx.db
      .query('nodeslide_traces')
      .withIndex('by_deck_status_created', (query) =>
        query.eq('deckId', deckId).eq('status', 'planning'),
      )
      .order('desc')
      .take(activeTraceLimit),
    ctx.db
      .query('nodeslide_traces')
      .withIndex('by_deck_status_created', (query) =>
        query.eq('deckId', deckId).eq('status', 'working'),
      )
      .order('desc')
      .take(activeTraceLimit),
    ctx.db
      .query('nodeslide_traces')
      .withIndex('by_deck_status_created', (query) =>
        query.eq('deckId', deckId).eq('status', 'awaiting_review'),
      )
      .order('desc')
      .take(activeTraceLimit),
    ctx.db
      .query('nodeslide_validations')
      .withIndex('by_deck_checked', (query) => query.eq('deckId', deckId))
      .order('desc')
      .take(NODESLIDE_WORKSPACE_LIMITS.validations),
    ctx.db
      .query('nodeslide_exports')
      .withIndex('by_deck_created', (query) => query.eq('deckId', deckId))
      .order('desc')
      .take(NODESLIDE_WORKSPACE_LIMITS.exports),
    ctx.db
      .query('nodeslide_exports')
      .withIndex('by_deck_status_created', (query) =>
        query.eq('deckId', deckId).eq('status', 'queued'),
      )
      .order('desc')
      .take(activeExportLimit),
    ctx.db
      .query('nodeslide_exports')
      .withIndex('by_deck_status_created', (query) =>
        query.eq('deckId', deckId).eq('status', 'rendering'),
      )
      .order('desc')
      .take(activeExportLimit),
    ctx.db
      .query('nodeslide_presence')
      .withIndex('by_deck_expiry', (query) => query.eq('deckId', deckId).gt('expiresAt', now))
      .order('desc')
      .take(NODESLIDE_WORKSPACE_LIMITS.presence),
    findLatestPublicationForDeck(ctx, deckId),
  ]);
  const commentRows = selectNeededAndLatestRows(
    openCommentRows,
    recentCommentRows,
    NODESLIDE_WORKSPACE_LIMITS.comments,
  ).sort((left, right) => compareAscending(left.createdAt, right.createdAt, left.id, right.id));
  const patchRows = selectNeededAndLatestRows(
    readyPatchRows,
    recentPatchRows,
    NODESLIDE_WORKSPACE_LIMITS.patches,
  ).sort((left, right) => compareDescending(left.createdAt, right.createdAt, left.id, right.id));
  const traceRows = selectNeededAndLatestRows(
    interleaveRows([planningTraceRows, workingTraceRows, reviewTraceRows]),
    recentTraceRows,
    NODESLIDE_WORKSPACE_LIMITS.traces,
  ).sort((left, right) => compareDescending(left.createdAt, right.createdAt, left.id, right.id));
  const exportRows = selectNeededAndLatestRows(
    interleaveRows([queuedExportRows, renderingExportRows]),
    recentExportRows,
    NODESLIDE_WORKSPACE_LIMITS.exports,
  ).sort((left, right) => compareDescending(left.createdAt, right.createdAt, left.id, right.id));
  return {
    ...snapshot,
    comments: commentRows.map(commentFromRow),
    patches: patchRows.map(patchFromRow),
    versions: versionRows
      .map(versionFromRow)
      .sort((left, right) => compareDescending(left.version, right.version, left.id, right.id)),
    traces: traceRows.map(traceFromRow),
    validations: validationRows
      .map(validationFromRow)
      .sort((left, right) => compareDescending(left.checkedAt, right.checkedAt, left.id, right.id)),
    exports: exportRows.map(exportFromRow),
    presence: presenceRows
      .map(presenceFromRow)
      .sort((left, right) =>
        compareDescending(left.lastSeenAt, right.lastSeenAt, left.id, right.id),
      ),
    publication: publicationRow ? publicationFromRow(publicationRow) : null,
  };
}

export async function insertNodeSlideSnapshot(
  ctx: MutationCtx,
  args: {
    snapshot: DeckSnapshot;
    projectRowId: Id<'projects'>;
    clientSessionId: string;
    ownerAccessKey: string;
    plan: string[];
    spec: unknown;
  },
) {
  const { deck, slides, elements, sources } = args.snapshot;
  await ctx.db.insert('nodeslide_decks', {
    id: deck.id,
    projectId: deck.projectId,
    projectRowId: args.projectRowId,
    clientSessionId: args.clientSessionId,
    ownerAccessKey: args.ownerAccessKey,
    schemaVersion: deck.schemaVersion,
    toolchainVersion: deck.toolchainVersion,
    title: deck.title,
    brief: deck.brief,
    theme: deck.theme,
    slideOrder: deck.slideOrder,
    version: deck.version,
    status: deck.status,
    ...(deck.activeSignatureProfileId !== undefined
      ? { activeSignatureProfileId: deck.activeSignatureProfileId }
      : {}),
    ...(deck.activeSignatureProfileDigest !== undefined
      ? { activeSignatureProfileDigest: deck.activeSignatureProfileDigest }
      : {}),
    ...(deck.shareSlug !== undefined ? { shareSlug: deck.shareSlug } : {}),
    plan: args.plan,
    spec: args.spec,
    createdAt: deck.createdAt,
    updatedAt: deck.updatedAt,
  });
  for (const slide of slides) {
    await ctx.db.insert('nodeslide_slides', slideFields(slide, deck.createdAt));
  }
  for (const element of elements) {
    await ctx.db.insert('nodeslide_elements', elementFields(deck.id, element, deck.createdAt));
  }
  for (const source of sources) await ctx.db.insert('nodeslide_sources', source);
}

export async function writeNodeSlideSnapshot(
  ctx: MutationCtx,
  before: DeckSnapshot,
  after: DeckSnapshot,
  now: number,
) {
  const deckRow = await findDeckRow(ctx, before.deck.id);
  if (!deckRow) throw new Error(`Deck ${before.deck.id} disappeared during commit.`);
  await ctx.db.patch(deckRow._id, {
    schemaVersion: after.deck.schemaVersion,
    toolchainVersion: after.deck.toolchainVersion,
    title: after.deck.title,
    brief: after.deck.brief,
    theme: after.deck.theme,
    slideOrder: after.deck.slideOrder,
    version: after.deck.version,
    status: after.deck.status,
    activeSignatureProfileId: after.deck.activeSignatureProfileId,
    activeSignatureProfileDigest: after.deck.activeSignatureProfileDigest,
    ...(after.deck.shareSlug !== undefined ? { shareSlug: after.deck.shareSlug } : {}),
    updatedAt: now,
  });

  const currentSlides = await ctx.db
    .query('nodeslide_slides')
    .withIndex('by_deck', (query) => query.eq('deckId', before.deck.id))
    .collect();
  const currentSlidesById = new Map(currentSlides.map((row) => [row.id, row]));
  const nextSlideIds = new Set(after.slides.map((slide) => slide.id));
  for (const row of currentSlides) {
    if (!nextSlideIds.has(row.id)) await ctx.db.delete(row._id);
  }
  for (const slide of after.slides) {
    const row = currentSlidesById.get(slide.id);
    if (row) await ctx.db.replace(row._id, slideFields(slide, row.createdAt, now));
    else await ctx.db.insert('nodeslide_slides', slideFields(slide, now));
  }

  const currentElements = await ctx.db
    .query('nodeslide_elements')
    .withIndex('by_deck', (query) => query.eq('deckId', before.deck.id))
    .collect();
  const currentElementsById = new Map(currentElements.map((row) => [row.id, row]));
  const nextElementIds = new Set(after.elements.map((element) => element.id));
  for (const row of currentElements) {
    if (!nextElementIds.has(row.id)) await ctx.db.delete(row._id);
  }
  for (const element of after.elements) {
    const row = currentElementsById.get(element.id);
    if (row)
      await ctx.db.replace(row._id, elementFields(after.deck.id, element, row.createdAt, now));
    else await ctx.db.insert('nodeslide_elements', elementFields(after.deck.id, element, now));
  }

  const currentSources = await ctx.db
    .query('nodeslide_sources')
    .withIndex('by_deck', (query) => query.eq('deckId', before.deck.id))
    .collect();
  const currentSourcesById = new Map(currentSources.map((row) => [row.id, row]));
  const nextSourceIds = new Set(after.sources.map((source) => source.id));
  for (const row of currentSources) {
    if (!nextSourceIds.has(row.id)) await ctx.db.delete(row._id);
  }
  for (const source of after.sources) {
    const row = currentSourcesById.get(source.id);
    if (row) await ctx.db.replace(row._id, source);
    else await ctx.db.insert('nodeslide_sources', source);
  }
  await ctx.db.patch(deckRow.projectRowId, {
    title: after.deck.title,
    brief: after.deck.brief,
    updatedAt: now,
  });
}

function slideFields(slide: Slide, createdAt: number, updatedAt = createdAt) {
  return {
    id: slide.id,
    deckId: slide.deckId,
    title: slide.title,
    ...(slide.section !== undefined ? { section: slide.section } : {}),
    ...(slide.notes !== undefined ? { notes: slide.notes } : {}),
    background: slide.background,
    elementOrder: slide.elementOrder,
    version: slide.version,
    createdAt,
    updatedAt,
  };
}

function elementFields(
  deckId: string,
  element: SlideElement,
  createdAt: number,
  updatedAt = createdAt,
) {
  return {
    id: element.id,
    deckId,
    slideId: element.slideId,
    name: element.name,
    kind: element.kind,
    ...(element.role !== undefined ? { role: element.role } : {}),
    bbox: element.bbox,
    rotation: element.rotation,
    ...(element.content !== undefined ? { content: element.content } : {}),
    style: element.style,
    ...(element.chart !== undefined ? { chart: element.chart } : {}),
    ...(element.math !== undefined ? { math: element.math } : {}),
    ...(element.video !== undefined ? { video: element.video } : {}),
    ...(element.image !== undefined ? { image: element.image } : {}),
    ...(element.imageUrl !== undefined ? { imageUrl: element.imageUrl } : {}),
    ...(element.altText !== undefined ? { altText: element.altText } : {}),
    sourceIds: element.sourceIds,
    locked: element.locked,
    visible: element.visible ?? true,
    ...(element.groupId !== undefined ? { groupId: element.groupId } : {}),
    exportCapabilities: element.exportCapabilities,
    version: element.version,
    createdAt,
    updatedAt,
  };
}

/** Keeps a deterministic mix of the latest rows and older actionable rows. */
export function selectNeededAndLatestRows<T extends { _id: unknown }>(
  neededRows: readonly T[],
  latestRows: readonly T[],
  limit: number,
): T[] {
  const selected: T[] = [];
  const seen = new Set<string>();
  const append = (row: T) => {
    if (selected.length >= limit) return;
    const key = String(row._id);
    if (seen.has(key)) return;
    seen.add(key);
    selected.push(row);
  };
  const latestFloor = Math.ceil(limit / 2);
  for (const row of latestRows.slice(0, latestFloor)) append(row);
  for (const row of neededRows) append(row);
  for (const row of latestRows) append(row);
  return selected;
}

function interleaveRows<T>(groups: readonly (readonly T[])[]): T[] {
  const rows: T[] = [];
  const longest = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < longest; index += 1) {
    for (const group of groups) {
      const row = group[index];
      if (row !== undefined) rows.push(row);
    }
  }
  return rows;
}

function compareAscending(
  leftValue: number,
  rightValue: number,
  leftId: string,
  rightId: string,
): number {
  return leftValue - rightValue || leftId.localeCompare(rightId);
}

function compareDescending(
  leftValue: number,
  rightValue: number,
  leftId: string,
  rightId: string,
): number {
  return rightValue - leftValue || rightId.localeCompare(leftId);
}

function rank(rankById: ReadonlyMap<string, number>, id: string): number {
  return rankById.get(id) ?? Number.MAX_SAFE_INTEGER;
}

function normalizedRank(value: number): number {
  return value < 0 ? Number.MAX_SAFE_INTEGER : value;
}
