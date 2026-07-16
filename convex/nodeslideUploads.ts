import { v } from 'convex/values';
import {
  type NodeSlideStoredAttachmentMetadata,
  nodeSlideDataAttachmentShape,
} from '../shared/nodeslideAttachments';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { action, internalQuery, mutation, query } from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';
import { nodeslideContentDigest, nodeslideStableId } from './lib/nodeslideIds';
import {
  NODESLIDE_UPLOAD_LIMITS,
  assertNodeSlideStoredFileMatches,
  assertNodeSlideUploadModelAccessible,
  isNodeSlideUploadModelAccessible,
  nodeSlideUploadRequestFingerprint,
  validateNodeSlideUploadRequest,
} from './lib/nodeslideUploadPolicy';

type UploadReadCtx = Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>;

export type PreparedNodeSlideUpload = {
  upload: NodeSlideStoredAttachmentMetadata;
  uploadUrl?: string;
  replayed: boolean;
};

export const prepareUpload = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    clientSessionId: v.string(),
    fileName: v.string(),
    contentType: v.string(),
    byteSize: v.number(),
    contentDigest: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args): Promise<PreparedNodeSlideUpload> => {
    const deck = await requireOwnerSession(
      ctx,
      args.deckId,
      args.ownerAccessKey,
      args.clientSessionId,
    );
    const request = validateNodeSlideUploadRequest(args);
    const requestFingerprint = nodeSlideUploadRequestFingerprint(deck.id, request);
    const existing = await ctx.db
      .query('nodeslide_uploads')
      .withIndex('by_deck_idempotency', (index) =>
        index.eq('deckId', deck.id).eq('idempotencyKey', request.idempotencyKey),
      )
      .unique();

    if (existing) {
      if (
        existing.clientSessionId !== request.clientSessionId ||
        existing.requestFingerprint !== requestFingerprint
      ) {
        throw new Error('NodeSlide upload idempotency key was reused for a different request.');
      }
      if (existing.lifecycleStatus === 'registered') {
        return { upload: publicUploadMetadata(existing), replayed: true };
      }
      return {
        upload: publicUploadMetadata(existing),
        uploadUrl: await ctx.storage.generateUploadUrl(),
        replayed: true,
      };
    }

    const now = Date.now();
    const row = {
      id: nodeslideStableId('upload', deck.id, request.idempotencyKey),
      deckId: deck.id,
      clientSessionId: request.clientSessionId,
      fileName: request.fileName,
      format: request.format,
      contentType: request.contentType,
      byteSize: request.byteSize,
      contentDigest: request.contentDigest,
      idempotencyKey: request.idempotencyKey,
      requestFingerprint,
      lifecycleStatus: 'awaiting_upload' as const,
      securityStatus: 'pending' as const,
      quarantineStatus: 'quarantined' as const,
      createdAt: now,
      updatedAt: now,
    };
    await ctx.db.insert('nodeslide_uploads', row);
    return {
      upload: publicUploadMetadata(row),
      uploadUrl: await ctx.storage.generateUploadUrl(),
      replayed: false,
    };
  },
});

export const registerUpload = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    clientSessionId: v.string(),
    uploadId: v.string(),
    storageId: v.id('_storage'),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args): Promise<NodeSlideStoredAttachmentMetadata> => {
    await requireOwnerSession(ctx, args.deckId, args.ownerAccessKey, args.clientSessionId);
    const upload = await requireOwnedUpload(ctx, args.deckId, args.clientSessionId, args.uploadId);
    if (upload.idempotencyKey !== requireBoundedKey(args.idempotencyKey)) {
      throw new Error('NodeSlide upload registration is not bound to the prepared request.');
    }

    const storedFile = await ctx.db.system.get('_storage', args.storageId);
    assertNodeSlideStoredFileMatches(upload, storedFile);

    if (upload.lifecycleStatus === 'registered') {
      if (upload.storageId !== args.storageId) {
        await ctx.storage.delete(args.storageId);
      }
      return publicUploadMetadata(upload);
    }

    const claimed = await ctx.db
      .query('nodeslide_uploads')
      .withIndex('by_storage', (index) => index.eq('storageId', args.storageId))
      .unique();
    if (claimed && claimed._id !== upload._id) {
      throw new Error('NodeSlide stored file is already registered to another upload.');
    }

    const now = Date.now();
    const registered = {
      ...upload,
      storageId: args.storageId,
      lifecycleStatus: 'registered' as const,
      securityStatus: 'pending' as const,
      quarantineStatus: 'quarantined' as const,
      registeredAt: now,
      updatedAt: now,
    };
    await ctx.db.patch(upload._id, {
      storageId: args.storageId,
      lifecycleStatus: registered.lifecycleStatus,
      securityStatus: registered.securityStatus,
      quarantineStatus: registered.quarantineStatus,
      registeredAt: now,
      updatedAt: now,
    });
    return publicUploadMetadata(registered);
  },
});

export const approveUpload = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    clientSessionId: v.string(),
    uploadId: v.string(),
    contentDigest: v.string(),
  },
  handler: async (ctx, args): Promise<NodeSlideStoredAttachmentMetadata> => {
    await requireOwnerSession(ctx, args.deckId, args.ownerAccessKey, args.clientSessionId);
    const upload = await requireOwnedUpload(ctx, args.deckId, args.clientSessionId, args.uploadId);
    if (upload.contentDigest !== args.contentDigest.trim()) {
      throw new Error('NodeSlide upload approval digest does not match the registered file.');
    }
    if (upload.lifecycleStatus !== 'registered' || !upload.storageId) {
      throw new Error('NodeSlide upload must be registered before approval.');
    }
    if (upload.securityStatus === 'rejected') {
      throw new Error('NodeSlide rejected upload cannot be approved.');
    }
    if (isNodeSlideUploadModelAccessible(upload)) return publicUploadMetadata(upload);

    const now = Date.now();
    const approved = {
      ...upload,
      securityStatus: 'approved' as const,
      quarantineStatus: 'released' as const,
      approvedAt: now,
      updatedAt: now,
    };
    await ctx.db.patch(upload._id, {
      securityStatus: approved.securityStatus,
      quarantineStatus: approved.quarantineStatus,
      approvedAt: now,
      updatedAt: now,
    });
    return publicUploadMetadata(approved);
  },
});

export const rejectUpload = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    clientSessionId: v.string(),
    uploadId: v.string(),
  },
  handler: async (ctx, args): Promise<NodeSlideStoredAttachmentMetadata> => {
    await requireOwnerSession(ctx, args.deckId, args.ownerAccessKey, args.clientSessionId);
    const upload = await requireOwnedUpload(ctx, args.deckId, args.clientSessionId, args.uploadId);
    if (upload.securityStatus === 'approved') {
      throw new Error(
        'NodeSlide approved upload must be deleted rather than retroactively rejected.',
      );
    }
    if (upload.securityStatus === 'rejected') return publicUploadMetadata(upload);

    const now = Date.now();
    const rejected = {
      ...upload,
      securityStatus: 'rejected' as const,
      quarantineStatus: 'quarantined' as const,
      rejectedAt: now,
      updatedAt: now,
    };
    await ctx.db.patch(upload._id, {
      securityStatus: rejected.securityStatus,
      quarantineStatus: rejected.quarantineStatus,
      rejectedAt: now,
      updatedAt: now,
    });
    return publicUploadMetadata(rejected);
  },
});

export const deleteUpload = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    clientSessionId: v.string(),
    uploadId: v.string(),
  },
  handler: async (ctx, args): Promise<{ deleted: true; uploadId: string }> => {
    await requireOwnerSession(ctx, args.deckId, args.ownerAccessKey, args.clientSessionId);
    const upload = await findUpload(ctx, args.uploadId);
    if (!upload) return { deleted: true, uploadId: args.uploadId };
    assertUploadScope(upload, args.deckId, args.clientSessionId);
    if (upload.storageId) await ctx.storage.delete(upload.storageId);
    await ctx.db.delete(upload._id);
    return { deleted: true, uploadId: upload.id };
  },
});

export const getUploadMetadata = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    clientSessionId: v.string(),
    uploadId: v.string(),
  },
  handler: async (ctx, args): Promise<NodeSlideStoredAttachmentMetadata | null> => {
    await requireOwnerSession(ctx, args.deckId, args.ownerAccessKey, args.clientSessionId);
    const upload = await findUpload(ctx, args.uploadId);
    if (!upload) return null;
    assertUploadScope(upload, args.deckId, args.clientSessionId);
    return publicUploadMetadata(upload);
  },
});

export const listUploadMetadata = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    clientSessionId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<NodeSlideStoredAttachmentMetadata[]> => {
    await requireOwnerSession(ctx, args.deckId, args.ownerAccessKey, args.clientSessionId);
    const limit = boundedListLimit(args.limit);
    const uploads = await ctx.db
      .query('nodeslide_uploads')
      .withIndex('by_deck_updated', (index) => index.eq('deckId', args.deckId))
      .order('desc')
      .take(limit);
    return uploads
      .filter((upload) => upload.clientSessionId === args.clientSessionId)
      .map(publicUploadMetadata);
  },
});

/**
 * Converts an approved stored text/data upload into the same owner-gated source
 * and immutable revision used by explicit agent read context. Raw storage IDs
 * never cross the action boundary. Larger files retain their exact digest and
 * shape while exposing only a bounded, visibly labelled preview to the model.
 */
export const materializeApprovedTextUpload = action({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    clientSessionId: v.string(),
    uploadId: v.string(),
  },
  handler: async (ctx, args): Promise<{ id: string; kind: 'source'; label: string }> => {
    const upload = await ctx.runQuery(
      internal.nodeslideUploads.getApprovedUploadForMaterializationInternal,
      args,
    );
    if (!upload) throw new Error('NodeSlide approved upload is unavailable.');
    if (!isNodeSlideStoredTextFormat(upload.format)) {
      throw new Error('This stored format does not yet have a model-readable extractor.');
    }
    const blob = await ctx.storage.get(upload.storageId);
    if (!blob) throw new Error('NodeSlide approved upload storage is unavailable.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const materialized = materializeNodeSlideStoredText(bytes, upload.format);
    return ctx.runMutation(internal.nodeslide.attachStoredDataSourceInternal, {
      deckId: args.deckId,
      ownerAccessKey: args.ownerAccessKey,
      title: upload.fileName,
      format: upload.format,
      preview: materialized.preview,
      previewTruncated: materialized.truncated,
      contentDigest: nodeslideContentDigest(bytes),
      byteSize: bytes.byteLength,
      ...(materialized.rowCount !== undefined ? { rowCount: materialized.rowCount } : {}),
      ...(materialized.columns ? { columns: materialized.columns } : {}),
    });
  },
});

export const getApprovedUploadForMaterializationInternal = internalQuery({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    clientSessionId: v.string(),
    uploadId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerSession(ctx, args.deckId, args.ownerAccessKey, args.clientSessionId);
    const upload = await requireOwnedUpload(ctx, args.deckId, args.clientSessionId, args.uploadId);
    assertNodeSlideUploadModelAccessible(upload);
    if (!upload.storageId) throw new Error('NodeSlide approved upload storage is unavailable.');
    return {
      storageId: upload.storageId,
      fileName: upload.fileName,
      format: upload.format,
      contentType: upload.contentType,
      byteSize: upload.byteSize,
      contentDigest: upload.contentDigest,
    };
  },
});

const MODEL_PREVIEW_BYTES = 7_200;

function isNodeSlideStoredTextFormat(
  value: NodeSlideStoredAttachmentMetadata['format'],
): value is 'csv' | 'json' | 'txt' | 'md' {
  return value === 'csv' || value === 'json' || value === 'txt' || value === 'md';
}

export function materializeNodeSlideStoredText(
  bytes: Uint8Array,
  format: 'csv' | 'json' | 'txt' | 'md',
): {
  preview: string;
  truncated: boolean;
  rowCount?: number;
  columns?: string[];
} {
  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Stored data must be valid UTF-8 text.');
  }
  content = content
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!content) throw new Error('Stored data file is empty.');
  if (content.includes('\u0000')) throw new Error('Stored data contains invalid NUL bytes.');
  if (format === 'json') {
    try {
      JSON.parse(content);
    } catch {
      throw new Error('Stored JSON is malformed.');
    }
  }
  const shape = nodeSlideDataAttachmentShape(content, format === 'md' ? 'txt' : format);
  const preview = boundedUtf8Prefix(content, MODEL_PREVIEW_BYTES);
  return {
    preview,
    truncated: new TextEncoder().encode(content).byteLength > MODEL_PREVIEW_BYTES,
    ...(shape.rowCount !== undefined ? { rowCount: shape.rowCount } : {}),
    ...(shape.columns ? { columns: shape.columns } : {}),
  };
}

function boundedUtf8Prefix(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(value.slice(0, middle)).byteLength <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return value.slice(0, low).trimEnd();
}

/**
 * The only server-side bridge from upload metadata to raw storage. Future model
 * actions must call this gate instead of reading storage IDs from database rows.
 */
export async function requireApprovedUploadStorageId(
  ctx: UploadReadCtx,
  args: {
    deckId: string;
    ownerAccessKey: string;
    clientSessionId: string;
    uploadId: string;
  },
): Promise<Id<'_storage'>> {
  await requireOwnerSession(ctx, args.deckId, args.ownerAccessKey, args.clientSessionId);
  const upload = await requireOwnedUpload(ctx, args.deckId, args.clientSessionId, args.uploadId);
  assertNodeSlideUploadModelAccessible(upload);
  if (!upload.storageId) throw new Error('NodeSlide approved upload storage is unavailable.');
  return upload.storageId;
}

async function requireOwnerSession(
  ctx: UploadReadCtx,
  deckId: string,
  ownerAccessKey: string,
  clientSessionId: string,
): Promise<Doc<'nodeslide_decks'>> {
  const normalizedSessionId = requireBoundedSession(clientSessionId);
  const deck = await requireOwnerAccess(ctx, deckId, ownerAccessKey);
  if (deck.clientSessionId !== normalizedSessionId) {
    throw new Error('NodeSlide upload session access denied.');
  }
  return deck;
}

async function requireOwnedUpload(
  ctx: UploadReadCtx,
  deckId: string,
  clientSessionId: string,
  uploadId: string,
): Promise<Doc<'nodeslide_uploads'>> {
  const upload = await findUpload(ctx, uploadId);
  if (!upload) throw new Error('NodeSlide upload was not found.');
  assertUploadScope(upload, deckId, clientSessionId);
  return upload;
}

async function findUpload(
  ctx: UploadReadCtx,
  uploadId: string,
): Promise<Doc<'nodeslide_uploads'> | null> {
  const id = requireBoundedKey(uploadId);
  return ctx.db
    .query('nodeslide_uploads')
    .withIndex('by_stable_id', (index) => index.eq('id', id))
    .unique();
}

function assertUploadScope(
  upload: Pick<Doc<'nodeslide_uploads'>, 'deckId' | 'clientSessionId'>,
  deckId: string,
  clientSessionId: string,
): void {
  if (upload.deckId !== deckId || upload.clientSessionId !== clientSessionId) {
    throw new Error('NodeSlide upload access denied.');
  }
}

function publicUploadMetadata(
  upload: Pick<
    Doc<'nodeslide_uploads'>,
    | 'id'
    | 'deckId'
    | 'clientSessionId'
    | 'fileName'
    | 'format'
    | 'contentType'
    | 'byteSize'
    | 'contentDigest'
    | 'lifecycleStatus'
    | 'securityStatus'
    | 'quarantineStatus'
    | 'createdAt'
    | 'updatedAt'
    | 'registeredAt'
    | 'approvedAt'
  >,
): NodeSlideStoredAttachmentMetadata {
  return {
    id: upload.id,
    deckId: upload.deckId,
    clientSessionId: upload.clientSessionId,
    fileName: upload.fileName,
    format: upload.format,
    contentType: upload.contentType,
    byteSize: upload.byteSize,
    contentDigest: upload.contentDigest,
    lifecycleStatus: upload.lifecycleStatus,
    securityStatus: upload.securityStatus,
    quarantineStatus: upload.quarantineStatus,
    modelAccessAllowed: isNodeSlideUploadModelAccessible(upload),
    createdAt: upload.createdAt,
    updatedAt: upload.updatedAt,
    ...(upload.registeredAt !== undefined ? { registeredAt: upload.registeredAt } : {}),
    ...(upload.approvedAt !== undefined ? { approvedAt: upload.approvedAt } : {}),
  };
}

function requireBoundedSession(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > NODESLIDE_UPLOAD_LIMITS.clientSessionIdCharacters) {
    throw new Error('NodeSlide upload session access denied.');
  }
  return normalized;
}

function requireBoundedKey(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > NODESLIDE_UPLOAD_LIMITS.idempotencyKeyCharacters) {
    throw new Error('NodeSlide upload identifier is invalid.');
  }
  return normalized;
}

function boundedListLimit(value: number | undefined): number {
  if (value === undefined) return 50;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('NodeSlide upload list limit is invalid.');
  }
  return Math.min(value, NODESLIDE_UPLOAD_LIMITS.listItems);
}
