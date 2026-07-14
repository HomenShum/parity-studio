import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';
import { nodeslideContentDigest, nodeslideStableId } from './lib/nodeslideIds';

export const NODESLIDE_SYNC_LIMITS = {
  remotePresentationIdCharacters: 256,
  remoteRevisionBytes: 1_024,
  idempotencyKeyCharacters: 160,
  mappingLinks: 2_048,
  mappingBytes: 512 * 1_024,
  objectIdCharacters: 256,
  semanticFingerprintCharacters: 128,
} as const;

const syncObjectLinkValidator = v.object({
  kind: v.union(v.literal('deck'), v.literal('slide'), v.literal('element')),
  localId: v.string(),
  remoteId: v.string(),
  semanticFingerprint: v.string(),
  localSlideId: v.optional(v.string()),
  remoteSlideId: v.optional(v.string()),
});

const syncSucceededValidator = v.object({
  kind: v.literal('sync_succeeded'),
  remoteRevision: v.string(),
  lastSyncedDeckVersion: v.number(),
  objectMapping: v.array(syncObjectLinkValidator),
});

const syncStatusValidator = v.object({
  kind: v.literal('set_status'),
  status: v.union(v.literal('syncing'), v.literal('conflict'), v.literal('error')),
});

type SyncObjectLink = {
  kind: 'deck' | 'slide' | 'element';
  localId: string;
  remoteId: string;
  semanticFingerprint: string;
  localSlideId?: string;
  remoteSlideId?: string;
};

type SyncConnection = {
  id: string;
  deckId: string;
  provider: 'google_slides';
  remotePresentationId: string;
  remoteRevision: string;
  lastSyncedDeckVersion: number;
  objectMapping: SyncObjectLink[];
  status: 'active' | 'syncing' | 'conflict' | 'error' | 'disconnected';
  connectionVersion: number;
  createdAt: number;
  updatedAt: number;
  lastSyncedAt: number;
  disconnectedAt?: number;
};

type ReadCtx = Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>;

export const createConnection = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    provider: v.literal('google_slides'),
    remotePresentationId: v.string(),
    remoteRevision: v.string(),
    lastSyncedDeckVersion: v.number(),
    objectMapping: v.array(syncObjectLinkValidator),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args): Promise<SyncConnection> => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const remotePresentationId = requiredIdentifier(
      args.remotePresentationId,
      'Remote presentation ID',
      NODESLIDE_SYNC_LIMITS.remotePresentationIdCharacters,
    );
    const remoteRevision = requiredOpaqueRevision(args.remoteRevision);
    const lastSyncedDeckVersion = requireDeckVersion(args.lastSyncedDeckVersion, deck.version);
    const objectMapping = normalizeObjectMapping(args.objectMapping, deck.id, remotePresentationId);
    const idempotencyKey = requiredIdentifier(
      args.idempotencyKey,
      'Idempotency key',
      NODESLIDE_SYNC_LIMITS.idempotencyKeyCharacters,
    );
    const mutationFingerprint = operationFingerprint({
      kind: 'create',
      provider: args.provider,
      remotePresentationId,
      remoteRevision,
      lastSyncedDeckVersion,
      objectMapping,
    });
    const existing = await findConnection(ctx, deck.id, args.provider);
    if (existing && isIdempotentReplay(existing, idempotencyKey, mutationFingerprint)) {
      return connectionFromRow(existing);
    }
    if (existing && existing.status !== 'disconnected') {
      throw new Error('NodeSlide sync connection already exists.');
    }
    await requireRemotePresentationAvailable(
      ctx,
      args.provider,
      remotePresentationId,
      existing?._id,
    );

    const now = Date.now();
    if (existing) {
      const nextConnectionVersion = existing.connectionVersion + 1;
      await ctx.db.patch(existing._id, {
        remotePresentationId,
        remoteRevision,
        lastSyncedDeckVersion,
        objectMapping,
        status: 'active',
        connectionVersion: nextConnectionVersion,
        lastMutationKey: idempotencyKey,
        lastMutationFingerprint: mutationFingerprint,
        updatedAt: now,
        lastSyncedAt: now,
        disconnectedAt: undefined,
      });
      const { disconnectedAt: _disconnectedAt, ...activeExisting } = existing;
      return connectionFromRow({
        ...activeExisting,
        remotePresentationId,
        remoteRevision,
        lastSyncedDeckVersion,
        objectMapping,
        status: 'active',
        connectionVersion: nextConnectionVersion,
        lastMutationKey: idempotencyKey,
        lastMutationFingerprint: mutationFingerprint,
        updatedAt: now,
        lastSyncedAt: now,
      });
    }

    const row = {
      id: nodeslideStableId('sync_connection', deck.id, args.provider),
      deckId: deck.id,
      provider: args.provider,
      remotePresentationId,
      remoteRevision,
      lastSyncedDeckVersion,
      objectMapping,
      status: 'active' as const,
      connectionVersion: 1,
      lastMutationKey: idempotencyKey,
      lastMutationFingerprint: mutationFingerprint,
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: now,
    };
    await ctx.db.insert('nodeslide_sync_connections', row);
    return publicConnection(row);
  },
});

export const getConnection = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    provider: v.literal('google_slides'),
  },
  handler: async (ctx, args): Promise<SyncConnection | null> => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    return connectionFromRow(await findConnection(ctx, deck.id, args.provider));
  },
});

export const updateConnection = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    provider: v.literal('google_slides'),
    expectedConnectionVersion: v.number(),
    idempotencyKey: v.string(),
    update: v.union(syncSucceededValidator, syncStatusValidator),
  },
  handler: async (ctx, args): Promise<SyncConnection> => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const expectedConnectionVersion = requireConnectionVersion(args.expectedConnectionVersion);
    const idempotencyKey = requiredIdentifier(
      args.idempotencyKey,
      'Idempotency key',
      NODESLIDE_SYNC_LIMITS.idempotencyKeyCharacters,
    );
    const normalizedUpdate =
      args.update.kind === 'sync_succeeded'
        ? {
            kind: args.update.kind,
            remoteRevision: requiredOpaqueRevision(args.update.remoteRevision),
            lastSyncedDeckVersion: requireDeckVersion(
              args.update.lastSyncedDeckVersion,
              deck.version,
            ),
            objectMapping: args.update.objectMapping,
          }
        : args.update;
    const existing = await requireConnection(ctx, deck.id, args.provider);
    const update =
      normalizedUpdate.kind === 'sync_succeeded'
        ? {
            ...normalizedUpdate,
            objectMapping: normalizeObjectMapping(
              normalizedUpdate.objectMapping,
              deck.id,
              existing.remotePresentationId,
            ),
          }
        : normalizedUpdate;
    const mutationFingerprint = operationFingerprint({
      kind: 'update',
      expectedConnectionVersion,
      update,
    });
    if (isIdempotentReplay(existing, idempotencyKey, mutationFingerprint)) {
      return connectionFromRow(existing);
    }
    requireMutableConnection(existing, expectedConnectionVersion);
    if (
      update.kind === 'sync_succeeded' &&
      update.lastSyncedDeckVersion < existing.lastSyncedDeckVersion
    ) {
      throw new Error('Last synced deck version cannot move backwards.');
    }

    const now = Date.now();
    const common = {
      connectionVersion: existing.connectionVersion + 1,
      lastMutationKey: idempotencyKey,
      lastMutationFingerprint: mutationFingerprint,
      updatedAt: now,
    };
    const patch =
      update.kind === 'sync_succeeded'
        ? {
            ...common,
            remoteRevision: update.remoteRevision,
            lastSyncedDeckVersion: update.lastSyncedDeckVersion,
            objectMapping: update.objectMapping,
            status: 'active' as const,
            lastSyncedAt: now,
          }
        : { ...common, status: update.status };
    await ctx.db.patch(existing._id, patch);
    return connectionFromRow({ ...existing, ...patch });
  },
});

export const disconnectConnection = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    provider: v.literal('google_slides'),
    expectedConnectionVersion: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args): Promise<SyncConnection> => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const expectedConnectionVersion = requireConnectionVersion(args.expectedConnectionVersion);
    const idempotencyKey = requiredIdentifier(
      args.idempotencyKey,
      'Idempotency key',
      NODESLIDE_SYNC_LIMITS.idempotencyKeyCharacters,
    );
    const existing = await requireConnection(ctx, deck.id, args.provider);
    const mutationFingerprint = operationFingerprint({
      kind: 'disconnect',
      expectedConnectionVersion,
    });
    if (isIdempotentReplay(existing, idempotencyKey, mutationFingerprint)) {
      return connectionFromRow(existing);
    }
    requireMutableConnection(existing, expectedConnectionVersion);

    const now = Date.now();
    const patch = {
      status: 'disconnected' as const,
      connectionVersion: existing.connectionVersion + 1,
      lastMutationKey: idempotencyKey,
      lastMutationFingerprint: mutationFingerprint,
      updatedAt: now,
      disconnectedAt: now,
    };
    await ctx.db.patch(existing._id, patch);
    return connectionFromRow({ ...existing, ...patch });
  },
});

async function findConnection(
  ctx: ReadCtx,
  deckId: string,
  provider: 'google_slides',
): Promise<Doc<'nodeslide_sync_connections'> | null> {
  return await ctx.db
    .query('nodeslide_sync_connections')
    .withIndex('by_deck_provider', (index) => index.eq('deckId', deckId).eq('provider', provider))
    .unique();
}

async function requireConnection(
  ctx: ReadCtx,
  deckId: string,
  provider: 'google_slides',
): Promise<Doc<'nodeslide_sync_connections'>> {
  const connection = await findConnection(ctx, deckId, provider);
  if (!connection) throw new Error('NodeSlide sync connection unavailable.');
  return connection;
}

async function requireRemotePresentationAvailable(
  ctx: ReadCtx,
  provider: 'google_slides',
  remotePresentationId: string,
  allowedRowId?: Id<'nodeslide_sync_connections'>,
): Promise<void> {
  const connection = await ctx.db
    .query('nodeslide_sync_connections')
    .withIndex('by_provider_remote', (index) =>
      index.eq('provider', provider).eq('remotePresentationId', remotePresentationId),
    )
    .unique();
  if (connection && connection._id !== allowedRowId) {
    throw new Error('NodeSlide sync connection unavailable.');
  }
}

function requireMutableConnection(
  connection: Doc<'nodeslide_sync_connections'>,
  expectedConnectionVersion: number,
): void {
  if (connection.status === 'disconnected') {
    throw new Error('NodeSlide sync connection is disconnected.');
  }
  if (connection.connectionVersion !== expectedConnectionVersion) {
    throw new Error(
      `Stale NodeSlide sync connection: expected version ${expectedConnectionVersion}, current version is ${connection.connectionVersion}.`,
    );
  }
}

function isIdempotentReplay(
  connection: Doc<'nodeslide_sync_connections'>,
  idempotencyKey: string,
  mutationFingerprint: string,
): boolean {
  if (connection.lastMutationKey !== idempotencyKey) return false;
  if (connection.lastMutationFingerprint !== mutationFingerprint) {
    throw new Error('Idempotency key is already bound to a different sync operation.');
  }
  return true;
}

function connectionFromRow(row: Doc<'nodeslide_sync_connections'>): SyncConnection;
function connectionFromRow(row: Doc<'nodeslide_sync_connections'> | null): SyncConnection | null;
function connectionFromRow(row: Doc<'nodeslide_sync_connections'> | null): SyncConnection | null {
  if (!row) return null;
  return publicConnection(row);
}

function publicConnection(row: SyncConnection): SyncConnection {
  return {
    id: row.id,
    deckId: row.deckId,
    provider: row.provider,
    remotePresentationId: row.remotePresentationId,
    remoteRevision: row.remoteRevision,
    lastSyncedDeckVersion: row.lastSyncedDeckVersion,
    objectMapping: row.objectMapping,
    status: row.status,
    connectionVersion: row.connectionVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastSyncedAt: row.lastSyncedAt,
    ...(row.disconnectedAt === undefined ? {} : { disconnectedAt: row.disconnectedAt }),
  };
}

function normalizeObjectMapping(
  links: readonly SyncObjectLink[],
  deckId: string,
  remotePresentationId: string,
): SyncObjectLink[] {
  if (links.length < 1 || links.length > NODESLIDE_SYNC_LIMITS.mappingLinks) {
    throw new Error(
      `Sync object mapping must contain 1-${NODESLIDE_SYNC_LIMITS.mappingLinks} links.`,
    );
  }
  const localKeys = new Set<string>();
  const remoteKeys = new Set<string>();
  const normalized = links.map((input) => {
    const link: SyncObjectLink = {
      kind: input.kind,
      localId: requiredIdentifier(
        input.localId,
        'Local object ID',
        NODESLIDE_SYNC_LIMITS.objectIdCharacters,
      ),
      remoteId: requiredIdentifier(
        input.remoteId,
        'Remote object ID',
        NODESLIDE_SYNC_LIMITS.objectIdCharacters,
      ),
      semanticFingerprint: requireSemanticFingerprint(input.semanticFingerprint),
    };
    if (input.kind === 'element') {
      link.localSlideId = requiredIdentifier(
        input.localSlideId ?? '',
        'Element local slide ID',
        NODESLIDE_SYNC_LIMITS.objectIdCharacters,
      );
      link.remoteSlideId = requiredIdentifier(
        input.remoteSlideId ?? '',
        'Element remote slide ID',
        NODESLIDE_SYNC_LIMITS.objectIdCharacters,
      );
    } else if (input.localSlideId !== undefined || input.remoteSlideId !== undefined) {
      throw new Error('Only element sync mappings may include parent slide IDs.');
    }
    const localKey = `${link.kind}:${link.localId}`;
    const remoteKey = `${link.kind}:${link.remoteId}`;
    if (localKeys.has(localKey) || remoteKeys.has(remoteKey)) {
      throw new Error('Sync object mapping contains a local or remote ID collision.');
    }
    localKeys.add(localKey);
    remoteKeys.add(remoteKey);
    return link;
  });
  const deckLinks = normalized.filter((link) => link.kind === 'deck');
  if (
    deckLinks.length !== 1 ||
    deckLinks[0]?.localId !== deckId ||
    deckLinks[0]?.remoteId !== remotePresentationId
  ) {
    throw new Error('Sync object mapping must bind this deck to this remote presentation once.');
  }
  normalized.sort(compareObjectLinks);
  if (byteLength(stableSerialize(normalized)) > NODESLIDE_SYNC_LIMITS.mappingBytes) {
    throw new Error(
      `Sync object mapping exceeds ${NODESLIDE_SYNC_LIMITS.mappingBytes} UTF-8 bytes.`,
    );
  }
  return normalized;
}

function compareObjectLinks(left: SyncObjectLink, right: SyncObjectLink): number {
  const kindOrder = { deck: 0, slide: 1, element: 2 } as const;
  return (
    kindOrder[left.kind] - kindOrder[right.kind] ||
    left.localId.localeCompare(right.localId) ||
    left.remoteId.localeCompare(right.remoteId)
  );
}

function requiredIdentifier(value: string, label: string, maxCharacters: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxCharacters || hasControlCharacters(normalized)) {
    throw new Error(`${label} must contain 1-${maxCharacters} safe characters.`);
  }
  return normalized;
}

function requiredOpaqueRevision(value: string): string {
  if (
    !value.trim() ||
    byteLength(value) > NODESLIDE_SYNC_LIMITS.remoteRevisionBytes ||
    hasControlCharacters(value)
  ) {
    throw new Error(
      `Remote revision must be opaque, non-empty, and at most ${NODESLIDE_SYNC_LIMITS.remoteRevisionBytes} UTF-8 bytes.`,
    );
  }
  return value;
}

function requireSemanticFingerprint(value: string): string {
  if (
    value.length > NODESLIDE_SYNC_LIMITS.semanticFingerprintCharacters ||
    !/^sync-semantic\/v1:[a-z0-9]+$/u.test(value)
  ) {
    throw new Error('Sync semantic fingerprint must use the sync-semantic/v1 format.');
  }
  return value;
}

function requireDeckVersion(value: number, currentDeckVersion: number): number {
  if (!Number.isInteger(value) || value < 1 || value > currentDeckVersion) {
    throw new Error(
      `Last synced deck version must be an integer between 1 and ${currentDeckVersion}.`,
    );
  }
  return value;
}

function requireConnectionVersion(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('Expected connection version must be a positive integer.');
  }
  return value;
}

function operationFingerprint(value: unknown): string {
  return nodeslideContentDigest(stableSerialize(value));
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(',')}}`;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}
