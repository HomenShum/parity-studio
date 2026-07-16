import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeckPatch, DeckSnapshot, PatchOperation } from '../shared/nodeslide';
import type {
  NodeSlideDelegationAcceptanceReceipt,
  NodeSlideDelegationGrant,
  NodeSlideDelegationIssueReceipt,
} from '../shared/nodeslideDelegation';
import type { MutationCtx } from './_generated/server';
import { loadNodeSlideSnapshot } from './lib/nodeslideData';
import { nodeslideContentDigest } from './lib/nodeslideIds';
import { clocksForNodeSlideOperations } from './lib/nodeslidePatches';
import { buildGoldenNodeSlide } from './lib/nodeslideSeed';
import { validateNodeSlideSnapshot } from './lib/nodeslideValidation';
import { acceptPatch, applyPatch, proposeAgentPatchInternal } from './nodeslide';
import {
  acceptValidatedProposalWithGrant,
  issueGrant,
  listGrants,
  revokeGrant,
} from './nodeslideDelegation';

const OWNER_ACCESS_KEY = 'a'.repeat(43);
const SECOND_OWNER_ACCESS_KEY = 'b'.repeat(43);
const START_TIME = 10_000;

type StoredRow = Record<string, unknown> & {
  _id: string;
  _creationTime: number;
};

type Filter = {
  field: string;
  operation: 'eq' | 'gt';
  value: unknown;
};

class MemoryIndex {
  readonly filters: Filter[] = [];

  eq(field: string, value: unknown): this {
    this.filters.push({ field, operation: 'eq', value });
    return this;
  }

  gt(field: string, value: unknown): this {
    this.filters.push({ field, operation: 'gt', value });
    return this;
  }
}

class MemoryQuery {
  private filters: readonly Filter[] = [];
  private indexName = '';
  private direction: 'asc' | 'desc' = 'asc';

  constructor(
    private readonly database: MemoryDatabase,
    private readonly tableName: string,
  ) {}

  withIndex(indexName: string, configure: (index: MemoryIndex) => unknown): this {
    const index = new MemoryIndex();
    configure(index);
    this.filters = index.filters;
    this.indexName = indexName;
    return this;
  }

  order(direction: 'asc' | 'desc'): this {
    this.direction = direction;
    return this;
  }

  async collect(): Promise<StoredRow[]> {
    return this.evaluate();
  }

  async first(): Promise<StoredRow | null> {
    return this.evaluate()[0] ?? null;
  }

  async unique(): Promise<StoredRow | null> {
    const rows = this.evaluate();
    if (rows.length > 1) throw new Error('Memory query was not unique.');
    return rows[0] ?? null;
  }

  async take(limit: number): Promise<StoredRow[]> {
    return this.evaluate().slice(0, limit);
  }

  private evaluate(): StoredRow[] {
    const rows = this.database
      .rows(this.tableName)
      .filter((row) => this.filters.every((filter) => matchesFilter(row[filter.field], filter)));
    const orderField = orderFieldForIndex(this.indexName);
    rows.sort(
      (left, right) =>
        compareValues(left[orderField], right[orderField]) ||
        compareValues(left._creationTime, right._creationTime),
    );
    if (this.direction === 'desc') rows.reverse();
    return rows;
  }
}

class MemoryDatabase {
  private readonly tables = new Map<string, StoredRow[]>();
  private sequence = 0;
  readonly queryCalls: string[] = [];

  query(tableName: string): MemoryQuery {
    this.queryCalls.push(tableName);
    return new MemoryQuery(this, tableName);
  }

  async insert(tableName: string, value: object): Promise<string> {
    return this.seed(tableName, value)._id;
  }

  async patch(rowId: string, fields: object): Promise<void> {
    const row = this.findRow(rowId).row;
    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined) delete row[field];
      else row[field] = structuredClone(value);
    }
  }

  async replace(rowId: string, value: object): Promise<void> {
    const located = this.findRow(rowId);
    located.rows[located.index] = {
      ...structuredClone(value),
      _id: located.row._id,
      _creationTime: located.row._creationTime,
    } as StoredRow;
  }

  async delete(rowId: string): Promise<void> {
    const located = this.findRow(rowId);
    located.rows.splice(located.index, 1);
  }

  seed(tableName: string, value: object): StoredRow {
    this.sequence += 1;
    const row = {
      ...structuredClone(value),
      _id: `${tableName}:${this.sequence}`,
      _creationTime: this.sequence,
    } as StoredRow;
    const rows = this.tables.get(tableName) ?? [];
    rows.push(row);
    this.tables.set(tableName, rows);
    return row;
  }

  rows(tableName: string): StoredRow[] {
    return [...(this.tables.get(tableName) ?? [])];
  }

  resetQueryCalls(): void {
    this.queryCalls.length = 0;
  }

  only(tableName: string, field: string, value: unknown): StoredRow {
    const rows = this.rows(tableName).filter((row) => row[field] === value);
    if (rows.length !== 1 || !rows[0]) {
      throw new Error(`Expected one ${tableName} row with ${field}=${String(value)}.`);
    }
    return rows[0];
  }

  private findRow(rowId: string): {
    tableName: string;
    rows: StoredRow[];
    row: StoredRow;
    index: number;
  } {
    for (const [tableName, rows] of this.tables) {
      const index = rows.findIndex((candidate) => candidate._id === rowId);
      const row = rows[index];
      if (row) return { tableName, rows, row, index };
    }
    throw new Error(`Memory row ${rowId} was not found.`);
  }
}

type RegisteredHandler<Args, Result> = (ctx: MutationCtx, args: Args) => Promise<Result>;

function registeredHandler<Args, Result>(value: unknown): RegisteredHandler<Args, Result> {
  const handler = (value as { _handler?: unknown })._handler;
  if (typeof handler !== 'function') throw new Error('Registered Convex handler is unavailable.');
  return handler as RegisteredHandler<Args, Result>;
}

type IssueArgs = {
  deckId: string;
  ownerAccessKey: string;
  clientKind: 'browser' | 'codex' | 'claude';
  maxOperations: number;
  maxUses: number;
  expiresAt: number;
};

type AgentProposalArgs = {
  id: string;
  deckId: string;
  ownerAccessKey: string;
  baseDeckVersion: number;
  baseSlideVersions: Record<string, number>;
  baseElementVersions: Record<string, number>;
  scope: DeckPatch['scope'];
  operations: PatchOperation[];
  summary: string;
  traceId: string;
  instruction: string;
  shadowComparisonRequested: boolean;
  traceSummary: string;
  traceContext: string[];
  toolCalls: string[];
};

type PatchRequest = {
  id?: string;
  deckId: string;
  ownerAccessKey: string;
  baseDeckVersion: number;
  baseSlideVersions: Record<string, number>;
  baseElementVersions: Record<string, number>;
  scope: DeckPatch['scope'];
  operations: PatchOperation[];
  summary?: string;
};

const issueGrantHandler = registeredHandler<IssueArgs, NodeSlideDelegationIssueReceipt>(issueGrant);
const revokeGrantHandler = registeredHandler<
  { deckId: string; ownerAccessKey: string; grantId: string },
  NodeSlideDelegationGrant
>(revokeGrant);
const listGrantsHandler = registeredHandler<
  { deckId: string; ownerAccessKey: string },
  NodeSlideDelegationGrant[]
>(listGrants);
const delegatedAcceptHandler = registeredHandler<
  { deckId: string; token: string; patchId: string; expectedCandidateDigest: string },
  NodeSlideDelegationAcceptanceReceipt
>(acceptValidatedProposalWithGrant);
const proposeAgentHandler = registeredHandler<AgentProposalArgs, { patch: DeckPatch }>(
  proposeAgentPatchInternal,
);
const applyPatchHandler = registeredHandler<PatchRequest, { patch: DeckPatch }>(applyPatch);
const acceptPatchHandler = registeredHandler<
  { deckId: string; ownerAccessKey: string; patchId: string },
  { patch: DeckPatch }
>(acceptPatch);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START_TIME);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NodeSlide delegated acceptance', () => {
  it('issues, lists, and idempotently revokes an owner-gated digest-only grant', async () => {
    const harness = workspaceHarness('grant-lifecycle');
    const issueArgs = grantArgs(harness.snapshot.deck.id, {
      clientKind: 'codex',
      maxOperations: 8,
      maxUses: 3,
    });

    await expect(
      issueGrantHandler(harness.context, {
        ...issueArgs,
        ownerAccessKey: SECOND_OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow(/owner access denied/i);
    await expect(
      issueGrantHandler(harness.context, { ...issueArgs, maxOperations: 9 }),
    ).rejects.toThrow(/1-8 operations/i);

    const issued = await issueGrantHandler(harness.context, issueArgs);
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.grant).toMatchObject({
      deckId: harness.snapshot.deck.id,
      clientKind: 'codex',
      capability: 'accept_validated',
      proposalSource: 'agent',
      proposalKind: 'edit',
      maxOperations: 8,
      maxUses: 3,
      useCount: 0,
      status: 'active',
      policyDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect('tokenDigest' in issued.grant).toBe(false);
    const stored = harness.database.only('nodeslide_delegation_grants', 'id', issued.grant.id);
    expect(stored['tokenDigest']).toBe(nodeslideContentDigest(issued.token));
    expect(stored['tokenDigest']).not.toBe(issued.token);
    expect(JSON.stringify(stored)).not.toContain(issued.token);

    const listed = await listGrantsHandler(harness.context, {
      deckId: harness.snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    expect(listed).toEqual([issued.grant]);
    expect(JSON.stringify(listed)).not.toContain(issued.token);
    expect(JSON.stringify(listed)).not.toContain(String(stored['tokenDigest']));

    const revoked = await revokeGrantHandler(harness.context, {
      deckId: harness.snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      grantId: issued.grant.id,
    });
    const revokeRetry = await revokeGrantHandler(harness.context, {
      deckId: harness.snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      grantId: issued.grant.id,
    });
    expect(revoked).toMatchObject({ status: 'revoked', revokedAt: START_TIME });
    expect(revokeRetry).toEqual(revoked);
    expect(JSON.stringify(revoked)).not.toContain(issued.token);
  });

  it('rejects a wrong token, wrong deck, and expected candidate digest mismatch without use', async () => {
    const harness = workspaceHarness('wrong-bindings');
    const second = seedWorkspace(
      harness.database,
      'wrong-bindings-second',
      SECOND_OWNER_ACCESS_KEY,
    );
    const issued = await issueGrantHandler(harness.context, grantArgs(harness.snapshot.deck.id));
    setNow(START_TIME + 1);
    const proposal = await proposeTextEdit(harness, 'binding-proposal', 'Bound proposal');
    const expectedCandidateDigest = requiredCandidateDigest(proposal.patch);

    await expect(
      delegatedAcceptHandler(harness.context, {
        deckId: harness.snapshot.deck.id,
        token: 'z'.repeat(43),
        patchId: proposal.patch.id,
        expectedCandidateDigest,
      }),
    ).rejects.toThrow(/delegation denied/i);
    await expect(
      delegatedAcceptHandler(harness.context, {
        deckId: second.deck.id,
        token: issued.token,
        patchId: proposal.patch.id,
        expectedCandidateDigest,
      }),
    ).rejects.toThrow(/delegation denied/i);
    await expect(
      delegatedAcceptHandler(harness.context, {
        deckId: harness.snapshot.deck.id,
        token: issued.token,
        patchId: proposal.patch.id,
        expectedCandidateDigest: `sha256:${'0'.repeat(64)}`,
      }),
    ).rejects.toThrow(/candidate digest mismatch/i);
    expect(grantRow(harness.database, issued.grant.id)['useCount']).toBe(0);
    expect(harness.database.rows('nodeslide_delegation_uses')).toEqual([]);
    expect(patchRow(harness.database, proposal.patch.id)['status']).toBe('ready');
  });

  it('rejects proposals that predate a grant', async () => {
    const harness = workspaceHarness('predating');
    const proposal = await proposeTextEdit(harness, 'predating-proposal', 'Too early');
    setNow(START_TIME + 1);
    const issued = await issueGrantHandler(harness.context, grantArgs(harness.snapshot.deck.id));

    await expect(
      delegatedAcceptHandler(harness.context, acceptArgs(issued, proposal.patch)),
    ).rejects.toThrow(/before the grant/i);
    expect(grantRow(harness.database, issued.grant.id)['useCount']).toBe(0);
  });

  it('rejects expired and revoked grants before proposal or use lookup', async () => {
    const expiredHarness = workspaceHarness('expired');
    const expiredIssue = await issueGrantHandler(expiredHarness.context, {
      ...grantArgs(expiredHarness.snapshot.deck.id),
      expiresAt: START_TIME + 5,
    });
    setNow(START_TIME + 1);
    const expiredProposal = await proposeTextEdit(
      expiredHarness,
      'expired-proposal',
      'Expires soon',
    );
    setNow(START_TIME + 5);
    expiredHarness.database.resetQueryCalls();
    await expect(
      delegatedAcceptHandler(
        expiredHarness.context,
        acceptArgs(expiredIssue, expiredProposal.patch),
      ),
    ).rejects.toThrow(/expired/i);
    expect(expiredHarness.database.queryCalls).toEqual(['nodeslide_delegation_grants']);

    setNow(START_TIME);
    const revokedHarness = workspaceHarness('revoked');
    const revokedIssue = await issueGrantHandler(
      revokedHarness.context,
      grantArgs(revokedHarness.snapshot.deck.id),
    );
    setNow(START_TIME + 1);
    const revokedProposal = await proposeTextEdit(
      revokedHarness,
      'revoked-proposal',
      'Revoked proposal',
    );
    await revokeGrantHandler(revokedHarness.context, {
      deckId: revokedHarness.snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      grantId: revokedIssue.grant.id,
    });
    revokedHarness.database.resetQueryCalls();
    await expect(
      delegatedAcceptHandler(
        revokedHarness.context,
        acceptArgs(revokedIssue, revokedProposal.patch),
      ),
    ).rejects.toThrow(/revoked/i);
    expect(revokedHarness.database.queryCalls).toEqual(['nodeslide_delegation_grants']);
    expect(revokedHarness.database.rows('nodeslide_delegation_uses')).toEqual([]);
  });

  it('binds stored policy, proposal source/kind/scope, and operation limits', async () => {
    const harness = workspaceHarness('policy-violations');
    const issued = await issueGrantHandler(harness.context, {
      ...grantArgs(harness.snapshot.deck.id),
      maxOperations: 1,
    });
    setNow(START_TIME + 1);
    const proposal = await proposeTextEdit(harness, 'policy-proposal', 'Policy proposal');
    const args = acceptArgs(issued, proposal.patch);
    const storedProposal = patchRow(harness.database, proposal.patch.id);
    const originalProposal = structuredClone(storedProposal);

    storedProposal['source'] = 'human';
    await expect(delegatedAcceptHandler(harness.context, args)).rejects.toThrow(/agent proposal/i);
    restoreRow(storedProposal, originalProposal);
    storedProposal['proposalKind'] = 'propagation';
    await expect(delegatedAcceptHandler(harness.context, args)).rejects.toThrow(/edit proposals/i);
    restoreRow(storedProposal, originalProposal);
    storedProposal['scope'] = {
      ...(storedProposal['scope'] as DeckPatch['scope']),
      deckId: 'another-deck',
    };
    await expect(delegatedAcceptHandler(harness.context, args)).rejects.toThrow(/deck scope/i);
    restoreRow(storedProposal, originalProposal);
    storedProposal['operations'] = [
      ...(storedProposal['operations'] as PatchOperation[]),
      ...(storedProposal['operations'] as PatchOperation[]),
    ];
    await expect(delegatedAcceptHandler(harness.context, args)).rejects.toThrow(
      /operation policy/i,
    );
    restoreRow(storedProposal, originalProposal);

    const storedGrant = grantRow(harness.database, issued.grant.id);
    storedGrant['policyDigest'] = `sha256:${'f'.repeat(64)}`;
    await expect(delegatedAcceptHandler(harness.context, args)).rejects.toThrow(
      /policy digest mismatch/i,
    );
    expect(harness.database.rows('nodeslide_delegation_uses')).toEqual([]);
  });

  it('requires explicit review for destructive and content-erasing operations', async () => {
    const harness = workspaceHarness('destructive-policy');
    const issued = await issueGrantHandler(harness.context, grantArgs(harness.snapshot.deck.id));
    setNow(START_TIME + 1);
    const snapshot = await requiredSnapshot(harness.context, harness.snapshot.deck.id);
    const element = snapshot.elements.find(
      (candidate) => candidate.kind === 'text' && !candidate.locked,
    );
    if (!element) throw new Error('Destructive policy fixture needs an unlocked element.');

    for (const [suffix, operation] of [
      ['remove', { op: 'remove_element', slideId: element.slideId, elementId: element.id }],
      [
        'hide',
        {
          op: 'set_visibility_v1',
          slideId: element.slideId,
          elementId: element.id,
          visible: false,
        },
      ],
      [
        'blank-copy',
        { op: 'replace_text', slideId: element.slideId, elementId: element.id, text: '   ' },
      ],
      [
        'zero-width-copy',
        {
          op: 'replace_text',
          slideId: element.slideId,
          elementId: element.id,
          text: '\u200B\u200D',
        },
      ],
      [
        'zero-opacity',
        {
          op: 'update_style',
          slideId: element.slideId,
          elementId: element.id,
          properties: { opacity: 0 },
        },
      ],
      [
        'unreadable-font',
        {
          op: 'update_style',
          slideId: element.slideId,
          elementId: element.id,
          properties: { fontSize: 0 },
        },
      ],
      [
        'transparent-text',
        {
          op: 'update_style',
          slideId: element.slideId,
          elementId: element.id,
          properties: { color: 'transparent' },
        },
      ],
      [
        'short-hex-alpha',
        {
          op: 'update_style',
          slideId: element.slideId,
          elementId: element.id,
          properties: { fill: '#0000' },
        },
      ],
      [
        'modern-rgb-alpha',
        {
          op: 'update_style',
          slideId: element.slideId,
          elementId: element.id,
          properties: { color: 'rgb(0 0 0 / 0)' },
        },
      ],
      [
        'same-color-and-fill',
        {
          op: 'update_style',
          slideId: element.slideId,
          elementId: element.id,
          properties: { color: '#fff', fill: '#ffffff' },
        },
      ],
    ] satisfies Array<[string, PatchOperation]>) {
      const clocks = clocksForNodeSlideOperations(snapshot, [operation]);
      const proposal = await proposeAgentHandler(harness.context, {
        id: `destructive-${suffix}`,
        deckId: snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        baseDeckVersion: snapshot.deck.version,
        ...clocks,
        scope: {
          kind: 'elements',
          deckId: snapshot.deck.id,
          slideIds: [element.slideId],
          elementIds: [element.id],
          operationMode: 'unrestricted',
        },
        operations: [operation],
        summary: `Destructive ${suffix}`,
        traceId: `destructive-${suffix}-trace`,
        instruction: `Destructive ${suffix}`,
        shadowComparisonRequested: false,
        traceSummary: `Destructive ${suffix}`,
        traceContext: [],
        toolCalls: [],
      });

      await expect(
        delegatedAcceptHandler(harness.context, acceptArgs(issued, proposal.patch)),
      ).rejects.toThrow(/destructive operations require explicit review/i);
      expect(patchRow(harness.database, proposal.patch.id)['status']).toBe('ready');
    }

    const baselineSensitiveElement = snapshot.elements.find(
      (candidate) =>
        !candidate.locked &&
        candidate.style.fill !== undefined &&
        candidate.style.color !== undefined,
    );
    if (!baselineSensitiveElement?.style.fill) {
      throw new Error('Destructive policy fixture needs an element with foreground and fill.');
    }
    const baselineSensitiveOperation: PatchOperation = {
      op: 'update_style',
      slideId: baselineSensitiveElement.slideId,
      elementId: baselineSensitiveElement.id,
      properties: { color: baselineSensitiveElement.style.fill },
    };
    const baselineClocks = clocksForNodeSlideOperations(snapshot, [baselineSensitiveOperation]);
    const baselineProposal = await proposeAgentHandler(harness.context, {
      id: 'destructive-baseline-paint',
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: snapshot.deck.version,
      ...baselineClocks,
      scope: {
        kind: 'elements',
        deckId: snapshot.deck.id,
        slideIds: [baselineSensitiveElement.slideId],
        elementIds: [baselineSensitiveElement.id],
        operationMode: 'unrestricted',
      },
      operations: [baselineSensitiveOperation],
      summary: 'Baseline-sensitive paint erase',
      traceId: 'destructive-baseline-paint-trace',
      instruction: 'Match the foreground to the existing fill.',
      shadowComparisonRequested: false,
      traceSummary: 'Baseline-sensitive paint erase',
      traceContext: [],
      toolCalls: [],
    });
    await expect(
      delegatedAcceptHandler(harness.context, acceptArgs(issued, baselineProposal.patch)),
    ).rejects.toThrow(/composed candidate makes content unreadable/i);
    expect(patchRow(harness.database, baselineProposal.patch.id)['status']).toBe('ready');
    expect(grantRow(harness.database, issued.grant.id)['useCount']).toBe(0);
    expect(harness.database.rows('nodeslide_delegation_uses')).toEqual([]);
  });

  it('accounts a successful use once, replays idempotently, and enforces exhaustion', async () => {
    const harness = workspaceHarness('use-accounting');
    const issued = await issueGrantHandler(harness.context, {
      ...grantArgs(harness.snapshot.deck.id),
      maxUses: 1,
    });
    setNow(START_TIME + 1);
    const proposal = await proposeTextEdit(harness, 'first-use', 'First delegated use');
    const args = acceptArgs(issued, proposal.patch);

    const accepted = await delegatedAcceptHandler(harness.context, args);
    expect(accepted.patch.status).toBe('accepted');
    expect(accepted.delegation).toEqual({
      grantId: issued.grant.id,
      useCount: 1,
      maxUses: 1,
      replayed: false,
    });
    expect(accepted.workspace).toBeNull();
    const acceptedVersionCount = harness.database.rows('nodeslide_versions').length;
    const acceptedSnapshot = await requiredSnapshot(harness.context, harness.snapshot.deck.id);
    harness.database.resetQueryCalls();
    const replay = await delegatedAcceptHandler(harness.context, args);
    expect(replay.patch).toEqual(accepted.patch);
    expect(replay.workspace).toBeNull();
    expect(replay.delegation).toMatchObject({ useCount: 1, replayed: true });
    expect(harness.database.queryCalls.slice(0, 3)).toEqual([
      'nodeslide_delegation_grants',
      'nodeslide_delegation_uses',
      'nodeslide_patches',
    ]);
    expect(harness.database.rows('nodeslide_delegation_uses')).toHaveLength(1);
    expect(grantRow(harness.database, issued.grant.id)['useCount']).toBe(1);
    expect(harness.database.rows('nodeslide_versions')).toHaveLength(acceptedVersionCount);
    expect(await requiredSnapshot(harness.context, harness.snapshot.deck.id)).toEqual(
      acceptedSnapshot,
    );

    setNow(START_TIME + 2);
    const secondProposal = await proposeTextEdit(harness, 'exhausted-use', 'Second delegated use');
    harness.database.resetQueryCalls();
    await expect(
      delegatedAcceptHandler(harness.context, acceptArgs(issued, secondProposal.patch)),
    ).rejects.toThrow(/exhausted/i);
    expect(harness.database.queryCalls).toEqual([
      'nodeslide_delegation_grants',
      'nodeslide_delegation_uses',
    ]);
    expect(patchRow(harness.database, secondProposal.patch.id)['status']).toBe('ready');
    expect(harness.database.rows('nodeslide_delegation_uses')).toHaveLength(1);

    await revokeGrantHandler(harness.context, {
      deckId: harness.snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      grantId: issued.grant.id,
    });
    harness.database.resetQueryCalls();
    await expect(delegatedAcceptHandler(harness.context, args)).rejects.toThrow(/revoked/i);
    expect(harness.database.queryCalls).toEqual(['nodeslide_delegation_grants']);
  });

  it('persists a Deck CI failure for review without mutation or grant consumption', async () => {
    const harness = workspaceHarness('deck-ci-review');
    const issued = await issueGrantHandler(harness.context, grantArgs(harness.snapshot.deck.id));
    setNow(START_TIME + 1);
    const proposal = await proposeTextEdit(
      harness,
      'deck-ci-review-proposal',
      'A bounded edit while evidence refresh is still in progress.',
    );
    const storedProposal = patchRow(harness.database, proposal.patch.id);
    const candidateValidation = storedProposal['candidateValidation'];
    if (!candidateValidation || typeof candidateValidation !== 'object') {
      throw new Error('Deck CI candidate receipt fixture is missing.');
    }
    storedProposal['candidateValidation'] = {
      ...(candidateValidation as NonNullable<DeckPatch['candidateValidation']>),
      publishOk: false,
      cleanOk: false,
      issues: [
        {
          id: 'deck-ci-review-warning',
          severity: 'warning',
          code: 'overflow',
          message: 'Rendered copy requires review before publication.',
        },
      ],
    };
    const before = await requiredSnapshot(harness.context, harness.snapshot.deck.id);
    seedAgentRun(harness.database, harness.snapshot.deck.id, proposal.patch);

    const receipt = await delegatedAcceptHandler(
      harness.context,
      acceptArgs(issued, proposal.patch),
    );

    expect(receipt.patch.status).toBe('ready');
    expect(receipt.autoCommit).toMatchObject({
      outcome: 'awaiting_review',
      reason: 'deck_ci_pass_required',
    });
    expect(receipt.autoCommit?.deckCiStatus).not.toBe('pass');
    expect(receipt.autoCommit?.deckCiDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(receipt.staleReasons?.[0]).toMatch(/did not mutate.*deck ci/i);
    expect(await requiredSnapshot(harness.context, harness.snapshot.deck.id)).toEqual(before);
    expect(grantRow(harness.database, issued.grant.id)['useCount']).toBe(0);
    expect(harness.database.rows('nodeslide_delegation_uses')).toEqual([]);
    expect(
      harness.database.only('nodeslide_agent_runs', 'id', `${proposal.patch.id}-run`),
    ).toMatchObject({
      status: 'awaiting_review',
      checkpoint: `deck-ci:${receipt.autoCommit?.deckCiDigest}`,
      error: expect.stringMatching(/deck ci returned/i),
    });
    expect(harness.database.only('nodeslide_traces', 'patchId', proposal.patch.id)).toMatchObject({
      status: 'awaiting_review',
      summary: expect.stringMatching(/deck ci returned/i),
    });

    expect(patchRow(harness.database, proposal.patch.id)['status']).toBe('ready');
  });

  it('accounts 24 sequential uses exactly and denies use 25 before proposal lookup', async () => {
    const harness = workspaceHarness('sequential-use-accounting');
    const issued = await issueGrantHandler(harness.context, {
      ...grantArgs(harness.snapshot.deck.id),
      maxUses: 24,
    });
    let lastArgs: ReturnType<typeof acceptArgs> | undefined;

    for (let useCount = 1; useCount <= 24; useCount += 1) {
      setNow(START_TIME + useCount);
      const proposal = await proposeTextEdit(
        harness,
        `sequential-use-${useCount}`,
        `Sequential delegated use ${useCount}`,
      );
      const args = acceptArgs(issued, proposal.patch);
      const accepted = await delegatedAcceptHandler(harness.context, args);
      expect(accepted.patch.status).toBe('accepted');
      expect(accepted.delegation).toEqual({
        grantId: issued.grant.id,
        useCount,
        maxUses: 24,
        replayed: false,
      });
      lastArgs = args;
    }

    expect(harness.database.rows('nodeslide_delegation_uses')).toHaveLength(24);
    expect(
      new Set(
        harness.database.rows('nodeslide_delegation_uses').map((row) => String(row['patchId'])),
      ).size,
    ).toBe(24);
    expect(grantRow(harness.database, issued.grant.id)).toMatchObject({
      useCount: 24,
      lastUsedAt: START_TIME + 24,
    });

    if (!lastArgs) throw new Error('Sequential replay fixture is missing.');
    harness.database.resetQueryCalls();
    await expect(
      delegatedAcceptHandler(harness.context, {
        ...lastArgs,
        expectedCandidateDigest: `sha256:${'0'.repeat(64)}`,
      }),
    ).rejects.toThrow(/exhausted/i);
    expect(harness.database.queryCalls).toEqual([
      'nodeslide_delegation_grants',
      'nodeslide_delegation_uses',
    ]);

    harness.database.resetQueryCalls();
    const replay = await delegatedAcceptHandler(harness.context, lastArgs);
    expect(replay.delegation).toMatchObject({ useCount: 24, replayed: true });
    expect(replay.workspace).toBeNull();
    expect(harness.database.rows('nodeslide_delegation_uses')).toHaveLength(24);
    expect(harness.database.queryCalls.slice(0, 3)).toEqual([
      'nodeslide_delegation_grants',
      'nodeslide_delegation_uses',
      'nodeslide_patches',
    ]);

    setNow(START_TIME + 25);
    const deniedProposal = await proposeTextEdit(
      harness,
      'sequential-use-25',
      'Sequential delegated use 25',
    );
    harness.database.resetQueryCalls();
    await expect(
      delegatedAcceptHandler(harness.context, acceptArgs(issued, deniedProposal.patch)),
    ).rejects.toThrow(/exhausted/i);
    expect(harness.database.queryCalls).toEqual([
      'nodeslide_delegation_grants',
      'nodeslide_delegation_uses',
    ]);
    expect(patchRow(harness.database, deniedProposal.patch.id)['status']).toBe('ready');
    expect(grantRow(harness.database, issued.grant.id)['useCount']).toBe(24);
  });

  it('does not consume a use when the normal CAS path marks the proposal stale', async () => {
    const harness = workspaceHarness('stale-cas');
    const issued = await issueGrantHandler(harness.context, grantArgs(harness.snapshot.deck.id));
    setNow(START_TIME + 1);
    const proposal = await proposeTextEdit(harness, 'stale-proposal', 'Delegated candidate');
    const beforeHuman = await requiredSnapshot(harness.context, harness.snapshot.deck.id);
    const operation = proposal.patch.operations[0];
    if (!operation || operation.op !== 'replace_text') throw new Error('Text edit is missing.');
    const humanOperation = { ...operation, text: 'Concurrent human edit' };
    setNow(START_TIME + 2);
    await applyPatchHandler(harness.context, {
      deckId: beforeHuman.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: beforeHuman.deck.version,
      ...clocksForNodeSlideOperations(beforeHuman, [humanOperation]),
      scope: proposal.patch.scope,
      operations: [humanOperation],
      summary: 'Concurrent human edit',
    });

    setNow(START_TIME + 3);
    const stale = await delegatedAcceptHandler(harness.context, acceptArgs(issued, proposal.patch));
    expect(stale.patch.status).toBe('stale');
    expect(stale.workspace).toBeNull();
    expect(stale.staleReasons).toEqual(expect.arrayContaining([expect.any(String)]));
    expect(stale.delegation.useCount).toBe(0);
    expect(grantRow(harness.database, issued.grant.id)['useCount']).toBe(0);
    expect(harness.database.rows('nodeslide_delegation_uses')).toEqual([]);
  });

  it('attributes delegated and owner-capability trace decisions without fabricating human identity', async () => {
    const delegatedHarness = workspaceHarness('delegated-trace');
    const issued = await issueGrantHandler(
      delegatedHarness.context,
      grantArgs(delegatedHarness.snapshot.deck.id, { clientKind: 'claude' }),
    );
    setNow(START_TIME + 1);
    const delegatedProposal = await proposeTextEdit(
      delegatedHarness,
      'delegated-trace-proposal',
      'Delegated trace',
    );
    seedAgentRun(
      delegatedHarness.database,
      delegatedHarness.snapshot.deck.id,
      delegatedProposal.patch,
    );
    await delegatedAcceptHandler(
      delegatedHarness.context,
      acceptArgs(issued, delegatedProposal.patch),
    );

    const delegatedTrace = delegatedHarness.database.only(
      'nodeslide_traces',
      'patchId',
      delegatedProposal.patch.id,
    );
    expect(delegatedTrace['decisionProvenance']).toEqual({
      authority: 'delegated',
      capability: 'accept_validated',
      grantId: issued.grant.id,
      clientKind: 'claude',
      policyDigest: issued.grant.policyDigest,
      decidedAt: START_TIME + 1,
    });
    const delegatedTelemetry = [
      ...delegatedHarness.database.rows('nodeslide_agent_spans'),
      ...delegatedHarness.database.rows('nodeslide_agent_events'),
      ...delegatedHarness.database.rows('nodeslide_agent_messages'),
    ];
    expect(delegatedTelemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operationName: 'agent.delegated_decision' }),
        expect.objectContaining({ body: 'Validated proposal accepted under delegated authority.' }),
      ]),
    );
    expect(JSON.stringify(delegatedTelemetry).toLowerCase()).not.toContain('human');
    expect(delegatedHarness.scheduler.runAfter).toHaveBeenCalledOnce();

    setNow(START_TIME);
    const ownerHarness = workspaceHarness('owner-trace');
    const ownerProposal = await proposeTextEdit(
      ownerHarness,
      'owner-trace-proposal',
      'Owner capability trace',
    );
    seedAgentRun(ownerHarness.database, ownerHarness.snapshot.deck.id, ownerProposal.patch);
    await acceptPatchHandler(ownerHarness.context, {
      deckId: ownerHarness.snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patchId: ownerProposal.patch.id,
    });
    const ownerTrace = ownerHarness.database.only(
      'nodeslide_traces',
      'patchId',
      ownerProposal.patch.id,
    );
    expect(ownerTrace['decisionProvenance']).toEqual({
      authority: 'owner_capability',
      decidedAt: START_TIME,
    });
    expect(ownerHarness.database.rows('nodeslide_agent_events')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: 'The owner capability committed the validated edit.',
        }),
      ]),
    );
  });
});

function workspaceHarness(label: string): {
  database: MemoryDatabase;
  context: MutationCtx;
  scheduler: { runAfter: ReturnType<typeof vi.fn> };
  snapshot: DeckSnapshot;
} {
  const database = new MemoryDatabase();
  const snapshot = seedWorkspace(database, label, OWNER_ACCESS_KEY);
  const scheduler = { runAfter: vi.fn(async () => undefined) };
  const context = { db: database, scheduler } as unknown as MutationCtx;
  return { database, context, scheduler, snapshot };
}

function seedWorkspace(
  database: MemoryDatabase,
  label: string,
  ownerAccessKey: string,
): DeckSnapshot {
  const snapshot = structuredClone(buildGoldenNodeSlide(`delegation-${label}`, 1_000).snapshot);
  const project = database.seed('projects', {
    clientSessionId: label,
    title: snapshot.deck.title,
    domain: 'nodeslide',
    brief: snapshot.deck.brief,
    sourceType: 'prompt',
    starred: false,
    createdAt: 1_000,
    updatedAt: 1_000,
  });
  database.seed('nodeslide_decks', {
    ...snapshot.deck,
    projectRowId: project._id,
    clientSessionId: label,
    ownerAccessKey,
    plan: [],
    spec: {},
  });
  for (const slide of snapshot.slides) {
    database.seed('nodeslide_slides', { ...slide, createdAt: 1_000, updatedAt: 1_000 });
  }
  for (const element of snapshot.elements) {
    database.seed('nodeslide_elements', {
      ...element,
      deckId: snapshot.deck.id,
      createdAt: 1_000,
      updatedAt: 1_000,
    });
  }
  for (const source of snapshot.sources) database.seed('nodeslide_sources', source);
  database.seed('nodeslide_validations', validateNodeSlideSnapshot(snapshot, 1_000));
  database.seed('nodeslide_versions', {
    id: `initial-version-${snapshot.deck.id}`,
    deckId: snapshot.deck.id,
    version: snapshot.deck.version,
    label: 'Initial deck',
    source: 'system',
    snapshot,
    createdAt: 1_000,
  });
  return snapshot;
}

function grantArgs(
  deckId: string,
  overrides: Partial<Pick<IssueArgs, 'clientKind' | 'maxOperations' | 'maxUses'>> = {},
): IssueArgs {
  return {
    deckId,
    ownerAccessKey: OWNER_ACCESS_KEY,
    clientKind: overrides.clientKind ?? 'browser',
    maxOperations: overrides.maxOperations ?? 8,
    maxUses: overrides.maxUses ?? 4,
    expiresAt: Date.now() + 60_000,
  };
}

async function proposeTextEdit(
  harness: { context: MutationCtx; snapshot: DeckSnapshot },
  patchId: string,
  text: string,
): Promise<{ patch: DeckPatch }> {
  const snapshot = await requiredSnapshot(harness.context, harness.snapshot.deck.id);
  const edit = textEdit(snapshot, text);
  const clocks = clocksForNodeSlideOperations(snapshot, [edit.operation]);
  return await proposeAgentHandler(harness.context, {
    id: patchId,
    deckId: snapshot.deck.id,
    ownerAccessKey: OWNER_ACCESS_KEY,
    baseDeckVersion: snapshot.deck.version,
    ...clocks,
    scope: edit.scope,
    operations: [edit.operation],
    summary: text,
    traceId: `${patchId}-trace`,
    instruction: text,
    shadowComparisonRequested: false,
    traceSummary: text,
    traceContext: [],
    toolCalls: [],
  });
}

function textEdit(
  snapshot: DeckSnapshot,
  text: string,
): {
  operation: Extract<PatchOperation, { op: 'replace_text' }>;
  scope: DeckPatch['scope'];
} {
  const element = snapshot.elements.find(
    (candidate) => candidate.kind === 'text' && !candidate.locked && candidate.content !== text,
  );
  if (!element) throw new Error('Editable text fixture is missing.');
  return {
    operation: { op: 'replace_text', slideId: element.slideId, elementId: element.id, text },
    scope: {
      kind: 'elements',
      deckId: snapshot.deck.id,
      slideIds: [element.slideId],
      elementIds: [element.id],
      operationMode: 'copy',
    },
  };
}

function acceptArgs(
  issued: NodeSlideDelegationIssueReceipt,
  patch: DeckPatch,
): {
  deckId: string;
  token: string;
  patchId: string;
  expectedCandidateDigest: string;
} {
  return {
    deckId: patch.deckId,
    token: issued.token,
    patchId: patch.id,
    expectedCandidateDigest: requiredCandidateDigest(patch),
  };
}

function requiredCandidateDigest(patch: DeckPatch): string {
  if (!patch.candidateDigest) throw new Error('Proposal candidate digest is missing.');
  return patch.candidateDigest;
}

async function requiredSnapshot(ctx: MutationCtx, deckId: string): Promise<DeckSnapshot> {
  const snapshot = await loadNodeSlideSnapshot(ctx, deckId);
  if (!snapshot) throw new Error(`Snapshot ${deckId} is missing.`);
  return snapshot;
}

function seedAgentRun(database: MemoryDatabase, deckId: string, patch: DeckPatch): void {
  database.seed('nodeslide_agent_runs', {
    id: `${patch.id}-run`,
    deckId,
    ownerDigest: `sha256:${'1'.repeat(64)}`,
    idempotencyKey: `${patch.id}-idempotency`,
    instruction: patch.summary,
    status: 'awaiting_review',
    provider: 'test-provider',
    model: 'test-model',
    webResearch: false,
    attempt: 1,
    otelTraceId: '1'.repeat(32),
    rootSpanId: '2'.repeat(16),
    nextTelemetrySequence: 3,
    patchId: patch.id,
    traceId: patch.traceId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

function grantRow(database: MemoryDatabase, grantId: string): StoredRow {
  return database.only('nodeslide_delegation_grants', 'id', grantId);
}

function patchRow(database: MemoryDatabase, patchId: string): StoredRow {
  return database.only('nodeslide_patches', 'id', patchId);
}

function restoreRow(target: StoredRow, source: StoredRow): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, structuredClone(source));
}

function setNow(now: number): void {
  vi.setSystemTime(now);
}

function matchesFilter(actual: unknown, filter: Filter): boolean {
  if (filter.operation === 'eq') return actual === filter.value;
  return compareValues(actual, filter.value) > 0;
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left ?? '').localeCompare(String(right ?? ''));
}

function orderFieldForIndex(indexName: string): string {
  if (indexName === 'by_deck_revision' || indexName === 'by_share_slug_revision') {
    return 'revision';
  }
  if (indexName === 'by_deck_version') return 'version';
  if (indexName === 'by_deck_version_checked' || indexName === 'by_deck_checked') {
    return 'checkedAt';
  }
  if (indexName === 'by_deck_expiry') return 'expiresAt';
  if (indexName.includes('created')) return 'createdAt';
  return '_creationTime';
}
