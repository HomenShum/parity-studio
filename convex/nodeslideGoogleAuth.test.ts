import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MutationCtx } from './_generated/server';
import { encryptOAuthSecret } from './lib/nodeslideGoogleOAuth';
import { complete, storeCredential, storeSession } from './nodeslideGoogleAuth';

const OWNER_ACCESS_KEY = 'a'.repeat(43);
const OTHER_ACCESS_KEY = 'b'.repeat(43);

type StoredRow = Record<string, unknown> & { _id: string; _creationTime: number };
type Filter = { field: string; value: unknown };

class MemoryIndex {
  readonly filters: Filter[] = [];

  eq(field: string, value: unknown): this {
    this.filters.push({ field, value });
    return this;
  }
}

class MemoryQuery {
  private filters: readonly Filter[] = [];

  constructor(
    private readonly database: MemoryDatabase,
    private readonly tableName: string,
  ) {}

  withIndex(_indexName: string, configure: (index: MemoryIndex) => unknown): this {
    const index = new MemoryIndex();
    configure(index);
    this.filters = index.filters;
    return this;
  }

  async first(): Promise<StoredRow | null> {
    return this.evaluate()[0] ?? null;
  }

  async unique(): Promise<StoredRow | null> {
    const rows = this.evaluate();
    if (rows.length > 1) throw new Error('Memory query was not unique.');
    return rows[0] ?? null;
  }

  async collect(): Promise<StoredRow[]> {
    return this.evaluate();
  }

  private evaluate(): StoredRow[] {
    return this.database
      .rows(this.tableName)
      .filter((row) => this.filters.every((filter) => row[filter.field] === filter.value));
  }
}

class MemoryDatabase {
  private readonly tables = new Map<string, StoredRow[]>();
  private sequence = 0;
  readonly writes: Array<{ kind: string; tableName: string; rowId: string }> = [];

  query(tableName: string): MemoryQuery {
    return new MemoryQuery(this, tableName);
  }

  seed(tableName: string, value: Record<string, unknown>): StoredRow {
    this.sequence += 1;
    const row = {
      ...structuredClone(value),
      _id: `${tableName}:${this.sequence}`,
      _creationTime: this.sequence,
    };
    const rows = this.tables.get(tableName) ?? [];
    rows.push(row);
    this.tables.set(tableName, rows);
    return row;
  }

  async insert(tableName: string, value: Record<string, unknown>): Promise<string> {
    const row = this.seed(tableName, value);
    this.writes.push({ kind: 'insert', tableName, rowId: row._id });
    return row._id;
  }

  async patch(rowId: string, value: Record<string, unknown>): Promise<void> {
    const located = this.find(rowId);
    if (!located) throw new Error(`Memory row ${rowId} was not found.`);
    Object.assign(located.row, structuredClone(value));
    this.writes.push({ kind: 'patch', tableName: located.tableName, rowId });
  }

  async delete(rowId: string): Promise<void> {
    const located = this.find(rowId);
    if (!located) throw new Error(`Memory row ${rowId} was not found.`);
    located.rows.splice(located.index, 1);
    this.writes.push({ kind: 'delete', tableName: located.tableName, rowId });
  }

  rows(tableName: string): StoredRow[] {
    return [...(this.tables.get(tableName) ?? [])];
  }

  private find(
    rowId: string,
  ): { tableName: string; rows: StoredRow[]; row: StoredRow; index: number } | undefined {
    for (const [tableName, rows] of this.tables) {
      const index = rows.findIndex((row) => row._id === rowId);
      const row = rows[index];
      if (row) return { tableName, rows, row, index };
    }
    return undefined;
  }
}

type StoreSessionArgs = {
  stateDigest: string;
  deckId: string;
  ownerAccessKey: string;
  codeVerifierCiphertext: string;
  returnTo: string;
  expiresAt: number;
};

type StoreCredentialArgs = {
  stateDigest: string;
  deckId: string;
  ownerAccessKey: string;
  accessTokenCiphertext: string;
  refreshTokenCiphertext?: string;
  accessTokenExpiresAt: number;
  scopes: string[];
  tokenType: string;
};

type MutationHandler<T> = (ctx: MutationCtx, args: T) => Promise<void>;

const storeSessionHandler = (
  storeSession as unknown as { _handler: MutationHandler<StoreSessionArgs> }
)._handler;
const storeCredentialHandler = (
  storeCredential as unknown as { _handler: MutationHandler<StoreCredentialArgs> }
)._handler;
const completeHandler = (
  complete as unknown as {
    _handler: (
      ctx: { runQuery: ReturnType<typeof vi.fn>; runMutation: ReturnType<typeof vi.fn> },
      args: { state: string; code?: string; error?: string },
    ) => Promise<{ redirectTo: string }>;
  }
)._handler;

function context(database: MemoryDatabase): MutationCtx {
  return { db: database } as unknown as MutationCtx;
}

function seedDeck(database: MemoryDatabase, ownerAccessKey = OWNER_ACCESS_KEY): void {
  database.seed('nodeslide_decks', { id: 'deck:owned', ownerAccessKey });
}

function sessionArgs(ownerAccessKey = OWNER_ACCESS_KEY): StoreSessionArgs {
  return {
    stateDigest: 'state-digest',
    deckId: 'deck:owned',
    ownerAccessKey,
    codeVerifierCiphertext: 'encrypted-session-grant',
    returnTo: 'https://app.example.test/?deck=deck%3Aowned',
    expiresAt: Date.now() + 60_000,
  };
}

function credentialArgs(ownerAccessKey = OWNER_ACCESS_KEY): StoreCredentialArgs {
  return {
    stateDigest: 'state-digest',
    deckId: 'deck:owned',
    ownerAccessKey,
    accessTokenCiphertext: 'encrypted-access-token',
    refreshTokenCiphertext: 'encrypted-refresh-token',
    accessTokenExpiresAt: Date.now() + 60_000,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    tokenType: 'Bearer',
  };
}

describe('NodeSlide Google OAuth write races', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('atomically revalidates ownership before storing a session', async () => {
    const database = new MemoryDatabase();
    seedDeck(database);

    await expect(
      storeSessionHandler(context(database), sessionArgs(OTHER_ACCESS_KEY)),
    ).rejects.toThrow('NodeSlide owner access denied.');
    expect(database.writes).toEqual([]);
    expect(database.rows('nodeslide_oauth_sessions')).toEqual([]);

    await storeSessionHandler(context(database), sessionArgs());
    expect(database.rows('nodeslide_oauth_sessions')).toHaveLength(1);
    expect(database.rows('nodeslide_oauth_sessions')[0]).not.toHaveProperty('ownerAccessKey');
  });

  it('cannot create an orphan session after its deck was deleted', async () => {
    const database = new MemoryDatabase();

    await expect(storeSessionHandler(context(database), sessionArgs())).rejects.toThrow(
      'NodeSlide owner access denied.',
    );
    expect(database.writes).toEqual([]);
  });

  it('cannot resurrect a credential from an orphan callback session', async () => {
    const database = new MemoryDatabase();
    database.seed('nodeslide_oauth_sessions', {
      stateDigest: 'state-digest',
      deckId: 'deck:owned',
      provider: 'google_slides',
      codeVerifierCiphertext: 'encrypted-session-grant',
      returnTo: 'https://app.example.test/',
      expiresAt: Date.now() + 60_000,
      createdAt: Date.now(),
    });

    await expect(storeCredentialHandler(context(database), credentialArgs())).rejects.toThrow(
      'NodeSlide owner access denied.',
    );
    expect(database.writes).toEqual([]);
    expect(database.rows('nodeslide_oauth_credentials')).toEqual([]);
  });

  it('fails an orphan callback before token exchange and consumes its session', async () => {
    const encryptionKey = Buffer.from(Array.from({ length: 32 }, (_, index) => index)).toString(
      'base64url',
    );
    vi.stubEnv('GOOGLE_CLIENT_ID', 'google-client-id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'google-client-secret');
    vi.stubEnv('NODESLIDE_OAUTH_TOKEN_ENCRYPTION_KEY', encryptionKey);
    vi.stubEnv(
      'NODESLIDE_GOOGLE_REDIRECT_URI',
      'https://app.example.test/api/nodeslide/google/oauth/callback',
    );
    vi.stubEnv('NODESLIDE_APP_ORIGINS', 'https://app.example.test');
    const sessionGrant = await encryptOAuthSecret(
      JSON.stringify({
        version: 1,
        codeVerifier: 'c'.repeat(64),
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
      encryptionKey,
    );
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        stateDigest: 'stored-state-digest',
        deckId: 'deck:owned',
        codeVerifierCiphertext: sessionGrant,
        returnTo: 'https://app.example.test/?deck=deck%3Aowned',
        expiresAt: Date.now() + 60_000,
      })
      .mockRejectedValueOnce(new Error('NodeSlide owner access denied.'));
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      completeHandler({ runQuery, runMutation }, { state: 'opaque-state', code: 'oauth-code' }),
    ).resolves.toEqual({
      redirectTo: expect.stringContaining('nodeslideGoogle=failed'),
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({ stateDigest: expect.any(String) });
  });

  it('revalidates ownership and consumes the session in the credential transaction', async () => {
    const database = new MemoryDatabase();
    seedDeck(database);
    database.seed('nodeslide_oauth_sessions', {
      stateDigest: 'state-digest',
      deckId: 'deck:owned',
      provider: 'google_slides',
      codeVerifierCiphertext: 'encrypted-session-grant',
      returnTo: 'https://app.example.test/',
      expiresAt: Date.now() + 60_000,
      createdAt: Date.now(),
    });

    await expect(
      storeCredentialHandler(context(database), credentialArgs(OTHER_ACCESS_KEY)),
    ).rejects.toThrow('NodeSlide owner access denied.');
    expect(database.writes).toEqual([]);

    await storeCredentialHandler(context(database), credentialArgs());
    expect(database.rows('nodeslide_oauth_credentials')).toHaveLength(1);
    expect(database.rows('nodeslide_oauth_credentials')[0]).not.toHaveProperty('ownerAccessKey');
    expect(database.rows('nodeslide_oauth_sessions')[0]?.consumedAt).toEqual(expect.any(Number));
  });
});
