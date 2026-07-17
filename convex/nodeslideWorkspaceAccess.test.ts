import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeNodeSlideAccessPolicy } from '../shared/nodeslideAccessPolicy';
import type { MutationCtx } from './_generated/server';
import type { NodeSlideWorkspaceAccessPolicy } from './lib/nodeslideScopeAccess';
import {
  attachDeck,
  createProject,
  createWorkspace,
  getAttachedDeck,
  getProject,
  getWorkspace,
  issueGrant,
  listGrants,
  revokeGrant,
} from './nodeslideWorkspaceAccess';

const NOW = 100_000;
const OWNER_ACCESS_KEY = 'a'.repeat(43);
const OTHER_OWNER_ACCESS_KEY = 'b'.repeat(43);

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
  private direction: 'asc' | 'desc' = 'asc';

  constructor(
    private readonly database: MemoryDatabase,
    private readonly tableName: string,
  ) {}

  withIndex(_name: string, configure: (index: MemoryIndex) => unknown): this {
    const index = new MemoryIndex();
    configure(index);
    this.filters = index.filters;
    return this;
  }

  order(direction: 'asc' | 'desc'): this {
    this.direction = direction;
    return this;
  }

  async unique(): Promise<StoredRow | null> {
    const rows = this.evaluate();
    if (rows.length > 1) throw new Error('Memory query was not unique.');
    return rows[0] ?? null;
  }

  async first(): Promise<StoredRow | null> {
    return this.evaluate()[0] ?? null;
  }

  async take(limit: number): Promise<StoredRow[]> {
    return this.evaluate().slice(0, limit);
  }

  private evaluate(): StoredRow[] {
    const rows = this.database
      .rows(this.tableName)
      .filter((row) => this.filters.every((filter) => row[filter.field] === filter.value))
      .sort((left, right) => left._creationTime - right._creationTime);
    if (this.direction === 'desc') rows.reverse();
    return rows;
  }
}

class MemoryDatabase {
  private readonly tables = new Map<string, StoredRow[]>();
  private sequence = 0;

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
    return this.seed(tableName, value)._id;
  }

  async patch(rowId: string, value: Record<string, unknown>): Promise<void> {
    const row = this.find(rowId);
    Object.assign(row, structuredClone(value));
  }

  rows(tableName: string): StoredRow[] {
    return [...(this.tables.get(tableName) ?? [])];
  }

  private find(rowId: string): StoredRow {
    for (const rows of this.tables.values()) {
      const row = rows.find((candidate) => candidate._id === rowId);
      if (row) return row;
    }
    throw new Error(`Memory row ${rowId} was not found.`);
  }
}

type Handler<Args, Result> = (ctx: MutationCtx, args: Args) => Promise<Result>;

function handler<Args, Result>(registered: unknown): Handler<Args, Result> {
  const value = (registered as { _handler?: unknown })._handler;
  if (typeof value !== 'function') throw new Error('Registered Convex handler is unavailable.');
  return value as Handler<Args, Result>;
}

const createWorkspaceHandler = handler<
  { name: string; expiresAt: number; agentPolicy: unknown },
  WorkspaceReceipt
>(createWorkspace);
const createProjectHandler = handler<
  { workspaceId: string; token: string; name: string },
  ProjectSummary
>(createProject);
const attachDeckHandler = handler<AttachArgs, DeckSummary>(attachDeck);
const issueGrantHandler = handler<IssueArgs, GrantReceipt>(issueGrant);
const revokeGrantHandler = handler<
  { workspaceId: string; token: string; grantId: string },
  GrantSummary
>(revokeGrant);
const getWorkspaceHandler = handler<
  { workspaceId: string; token: string },
  Record<string, unknown>
>(getWorkspace);
const getProjectHandler = handler<
  { workspaceId: string; projectId: string; token: string },
  ProjectSummary
>(getProject);
const getAttachedDeckHandler = handler<
  { workspaceId: string; projectId: string; deckId: string; token: string },
  DeckSummary
>(getAttachedDeck);
const listGrantsHandler = handler<{ workspaceId: string; token: string }, GrantSummary[]>(
  listGrants,
);

type WorkspaceReceipt = {
  workspace: { id: string };
  grant: GrantSummary;
  token: string;
};
type ProjectSummary = { id: string; workspaceId: string; name: string };
type DeckSummary = { id: string; workspaceId: string; projectId: string };
type GrantSummary = {
  id: string;
  workspaceId: string;
  projectId?: string;
  role: string;
  policy: NodeSlideWorkspaceAccessPolicy;
  status: string;
};
type GrantReceipt = { grant: GrantSummary; token: string };
type IssueArgs = {
  workspaceId: string;
  token: string;
  projectId: string;
  role: 'editor' | 'viewer';
  capabilities: string[];
  agentPolicy: unknown;
  expiresAt: number;
};
type AttachArgs = {
  workspaceId: string;
  projectId: string;
  token: string;
  deckId: string;
  ownerAccessKey: string;
};

describe('NodeSlide workspace/project capability runtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns each raw token once and persists only its digest and non-human events', async () => {
    const harness = await createHarness();
    const serialized = JSON.stringify(
      harness.database
        .rows('nodeslide_access_grants')
        .concat(harness.database.rows('nodeslide_access_grant_events')),
    );

    expect(harness.ownerToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(serialized).not.toContain(harness.ownerToken);
    expect(harness.database.rows('nodeslide_access_grants')[0]).toMatchObject({
      tokenDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      role: 'owner',
    });
    expect(harness.database.rows('nodeslide_access_grant_events')[0]).toMatchObject({
      kind: 'issued',
      grantId: harness.ownerGrantId,
    });
    expect(harness.database.rows('nodeslide_access_grant_events')[0]).not.toHaveProperty(
      'actorGrantId',
    );

    const grants = await listGrantsHandler(harness.context, {
      workspaceId: harness.workspaceId,
      token: harness.ownerToken,
    });
    expect(JSON.stringify(grants)).not.toContain(harness.ownerToken);
    expect(JSON.stringify(grants)).not.toContain('tokenDigest');
    for (const table of ['nodeslide_workspaces', 'nodeslide_access_grants'] as const) {
      const text = JSON.stringify(harness.database.rows(table));
      expect(text).not.toMatch(/userId|email|human|billing|aggregateCost/iu);
    }
  });

  it('requires both editor/owner workspace authority and the existing deck owner key', async () => {
    const harness = await createHarness();
    const projectA = await createProjectFor(harness, 'Project A');
    const projectB = await createProjectFor(harness, 'Project B');
    harness.database.seed('nodeslide_decks', deckRow('deck-a'));
    const editor = await issueFor(harness, projectA.id, 'editor');

    await expect(
      attachDeckHandler(harness.context, {
        workspaceId: harness.workspaceId,
        projectId: projectA.id,
        token: editor.token,
        deckId: 'deck-a',
        ownerAccessKey: OTHER_OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow('NodeSlide owner access denied.');
    expect(harness.database.rows('nodeslide_decks')[0]).not.toHaveProperty('workspaceId');

    await expect(
      attachDeckHandler(harness.context, {
        workspaceId: harness.workspaceId,
        projectId: projectB.id,
        token: editor.token,
        deckId: 'deck-a',
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow('NodeSlide workspace access denied.');

    const attached = await attachDeckHandler(harness.context, {
      workspaceId: harness.workspaceId,
      projectId: projectA.id,
      token: editor.token,
      deckId: 'deck-a',
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    expect(attached).toMatchObject({
      id: 'deck-a',
      workspaceId: harness.workspaceId,
      projectId: projectA.id,
    });

    await expect(
      attachDeckHandler(harness.context, {
        workspaceId: harness.workspaceId,
        projectId: projectB.id,
        token: harness.ownerToken,
        deckId: 'deck-a',
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow('already attached to another project');
  });

  it('allows viewer reads but denies every available write path', async () => {
    const harness = await createHarness();
    const project = await createProjectFor(harness, 'Read only');
    harness.database.seed('nodeslide_decks', deckRow('deck-view'));
    await attachDeckHandler(harness.context, {
      workspaceId: harness.workspaceId,
      projectId: project.id,
      token: harness.ownerToken,
      deckId: 'deck-view',
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    const viewer = await issueFor(harness, project.id, 'viewer');

    await expect(
      getWorkspaceHandler(harness.context, {
        workspaceId: harness.workspaceId,
        token: viewer.token,
      }),
    ).resolves.toMatchObject({ id: harness.workspaceId });
    await expect(
      getProjectHandler(harness.context, {
        workspaceId: harness.workspaceId,
        projectId: project.id,
        token: viewer.token,
      }),
    ).resolves.toMatchObject({ id: project.id });
    await expect(
      getAttachedDeckHandler(harness.context, {
        workspaceId: harness.workspaceId,
        projectId: project.id,
        deckId: 'deck-view',
        token: viewer.token,
      }),
    ).resolves.toMatchObject({ id: 'deck-view' });

    await expect(
      attachDeckHandler(harness.context, {
        workspaceId: harness.workspaceId,
        projectId: project.id,
        token: viewer.token,
        deckId: 'deck-view',
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow('NodeSlide workspace access denied.');
    await expect(
      createProjectHandler(harness.context, {
        workspaceId: harness.workspaceId,
        token: viewer.token,
        name: 'Denied',
      }),
    ).rejects.toThrow('NodeSlide workspace access denied.');
    await expect(
      issueGrantHandler(harness.context, issueArgs(harness, project.id, viewer.token, 'viewer')),
    ).rejects.toThrow('NodeSlide workspace access denied.');
  });

  it('fails closed after revocation, at expiry, and across workspace/project boundaries', async () => {
    const first = await createHarness();
    const projectA = await createProjectFor(first, 'A');
    const projectB = await createProjectFor(first, 'B');
    const viewer = await issueFor(first, projectA.id, 'viewer', NOW + 1_000);

    await expect(
      getProjectHandler(first.context, {
        workspaceId: first.workspaceId,
        projectId: projectB.id,
        token: viewer.token,
      }),
    ).rejects.toThrow('NodeSlide workspace access denied.');
    const second = await createHarness('Second');
    await expect(
      getWorkspaceHandler(second.context, {
        workspaceId: second.workspaceId,
        token: viewer.token,
      }),
    ).rejects.toThrow('NodeSlide workspace access denied.');

    await revokeGrantHandler(first.context, {
      workspaceId: first.workspaceId,
      token: first.ownerToken,
      grantId: viewer.grant.id,
    });
    await expect(
      getProjectHandler(first.context, {
        workspaceId: first.workspaceId,
        projectId: projectA.id,
        token: viewer.token,
      }),
    ).rejects.toThrow('NodeSlide workspace access denied.');
    expect(first.database.rows('nodeslide_access_grant_events').at(-1)).toMatchObject({
      kind: 'revoked',
      grantId: viewer.grant.id,
      actorGrantId: first.ownerGrantId,
    });

    const expiring = await issueFor(first, projectA.id, 'viewer', NOW + 2_000);
    vi.setSystemTime(NOW + 2_000);
    await expect(
      getProjectHandler(first.context, {
        workspaceId: first.workspaceId,
        projectId: projectA.id,
        token: expiring.token,
      }),
    ).rejects.toThrow('NodeSlide workspace access denied.');
  });

  it('stores only the intersection of issuer and requested agent policy', async () => {
    const harness = await createHarness();
    const project = await createProjectFor(harness, 'Narrowed');
    const requested = normalizeNodeSlideAccessPolicy({
      ...agentPolicy(),
      scopes: {
        ...agentPolicy().scopes,
        deckIds: ['deck-b', 'deck-c'],
        sourceIds: ['source-b'],
      },
      budget: {
        maxCostMicroUsd: 5_000,
        maxInputTokens: 500,
        maxOutputTokens: 2_000,
        maxDurationMs: 5_000,
        maxIterations: 5,
        maxToolCalls: 1,
      },
    });
    const issued = await issueGrantHandler(harness.context, {
      ...issueArgs(harness, project.id, harness.ownerToken, 'editor'),
      agentPolicy: requested,
    });

    expect(issued.grant.policy).toMatchObject({
      projectScope: { kind: 'project', projectId: project.id },
      agentPolicy: {
        scopes: { deckIds: ['deck-b'], sourceIds: ['source-b'] },
        budget: {
          maxCostMicroUsd: 1_000,
          maxInputTokens: 500,
          maxOutputTokens: 500,
          maxDurationMs: 5_000,
          maxIterations: 3,
          maxToolCalls: 1,
        },
      },
    });
    const stored = harness.database.rows('nodeslide_access_grants').at(-1);
    expect(stored?.['policy']).toEqual(issued.grant.policy);
    expect(stored).not.toHaveProperty('token');
  });
});

type Harness = Awaited<ReturnType<typeof createHarness>>;

async function createHarness(name = 'Workspace') {
  const database = new MemoryDatabase();
  const context = { db: database } as unknown as MutationCtx;
  const receipt = await createWorkspaceHandler(context, {
    name,
    expiresAt: NOW + 100_000,
    agentPolicy: agentPolicy(),
  });
  return {
    database,
    context,
    workspaceId: receipt.workspace.id,
    ownerGrantId: receipt.grant.id,
    ownerToken: receipt.token,
  };
}

async function createProjectFor(harness: Harness, name: string): Promise<ProjectSummary> {
  return await createProjectHandler(harness.context, {
    workspaceId: harness.workspaceId,
    token: harness.ownerToken,
    name,
  });
}

async function issueFor(
  harness: Harness,
  projectId: string,
  role: 'editor' | 'viewer',
  expiresAt = NOW + 50_000,
): Promise<GrantReceipt> {
  return await issueGrantHandler(harness.context, {
    ...issueArgs(harness, projectId, harness.ownerToken, role),
    expiresAt,
  });
}

function issueArgs(
  harness: Harness,
  projectId: string,
  token: string,
  role: 'editor' | 'viewer',
): IssueArgs {
  return {
    workspaceId: harness.workspaceId,
    token,
    projectId,
    role,
    capabilities:
      role === 'editor'
        ? ['workspace:read', 'project:read', 'deck:read', 'deck:attach']
        : ['workspace:read', 'project:read', 'deck:read'],
    agentPolicy: agentPolicy(),
    expiresAt: NOW + 50_000,
  };
}

function agentPolicy() {
  return normalizeNodeSlideAccessPolicy({
    role: 'planner',
    capabilities: ['deck:read', 'source:read', 'proposal:create'],
    scopes: {
      deckIds: ['deck-a', 'deck-b'],
      sourceIds: ['source-a', 'source-b'],
      providerIds: [],
      modelIds: [],
      toolIds: [],
      memoryScopeKeys: [],
    },
    budget: {
      maxCostMicroUsd: 1_000,
      maxInputTokens: 1_000,
      maxOutputTokens: 500,
      maxDurationMs: 10_000,
      maxIterations: 3,
      maxToolCalls: 2,
    },
  });
}

function deckRow(id: string): Record<string, unknown> {
  return {
    id,
    ownerAccessKey: OWNER_ACCESS_KEY,
    title: 'Attached deck',
    status: 'ready',
    version: 1,
  };
}
