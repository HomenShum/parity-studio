import { v } from 'convex/values';
import {
  NODESLIDE_DELEGATION_CAPABILITY,
  NODESLIDE_DELEGATION_GRANT_VERSION,
  NODESLIDE_DELEGATION_MAX_OPERATIONS,
  NODESLIDE_DELEGATION_MAX_TTL_MS,
  NODESLIDE_DELEGATION_MAX_USES,
  NODESLIDE_DELEGATION_POLICY_VERSION,
  NODESLIDE_DELEGATION_PROPOSAL_KIND,
  NODESLIDE_DELEGATION_PROPOSAL_SOURCE,
  type NodeSlideDelegationAcceptanceReceipt,
  type NodeSlideDelegationGrant,
  type NodeSlideDelegationIssueReceipt,
  type NodeSlideDelegationPolicy,
  evaluateNodeSlideDelegationAutoCommit,
  nodeSlideDelegationCandidateViolations,
  nodeSlideDelegationGrantStatus,
  nodeSlideDelegationPolicyDigestInput,
  nodeSlideDelegationProposalViolations,
} from '../shared/nodeslideDelegation';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';
import {
  materializeNodeSlideCandidate,
  validationFromCandidateReceipt,
} from './lib/nodeslideCandidate';
import {
  findDeckRow,
  findPatchRow,
  loadNodeSlideSnapshot,
  patchFromRow,
} from './lib/nodeslideData';
import {
  type NodeSlideDeckCiResult,
  evaluateNodeSlideDeckCi,
  nodeSlideDeckCiAllowsAutoCommit,
} from './lib/nodeslideDeckCi';
import { nodeslideContentDigest, nodeslideEventId, nodeslideStableId } from './lib/nodeslideIds';
import { evaluateNodeSlideCas } from './lib/nodeslidePatches';
import { commitDelegatedNodeSlideProposal } from './nodeslide';

const NODESLIDE_DELEGATION_TOKEN_BYTES = 32;
const NODESLIDE_DELEGATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const NODESLIDE_DELEGATION_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const NODESLIDE_DELEGATION_LIST_LIMIT = 64;
const clientKindValidator = v.union(v.literal('browser'), v.literal('codex'), v.literal('claude'));

export const issueGrant = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    clientKind: clientKindValidator,
    maxOperations: v.number(),
    maxUses: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args): Promise<NodeSlideDelegationIssueReceipt> => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const now = Date.now();
    assertIssueBounds(args, now);

    const token = await createUniqueGrantToken(ctx);
    const tokenDigest = nodeslideContentDigest(token);
    const id = nodeslideEventId('delegation_grant', now, args.deckId, args.clientKind, tokenDigest);
    const policy: NodeSlideDelegationPolicy = {
      policyVersion: NODESLIDE_DELEGATION_POLICY_VERSION,
      deckId: args.deckId,
      clientKind: args.clientKind,
      capability: NODESLIDE_DELEGATION_CAPABILITY,
      proposalSource: NODESLIDE_DELEGATION_PROPOSAL_SOURCE,
      proposalKind: NODESLIDE_DELEGATION_PROPOSAL_KIND,
      maxOperations: args.maxOperations,
      maxUses: args.maxUses,
      createdAt: now,
      expiresAt: args.expiresAt,
    };
    const row = {
      schemaVersion: NODESLIDE_DELEGATION_GRANT_VERSION,
      id,
      tokenDigest,
      ...policy,
      useCount: 0,
      policyDigest: nodeslideContentDigest(nodeSlideDelegationPolicyDigestInput(policy)),
    };
    await ctx.db.insert('nodeslide_delegation_grants', row);
    return { grant: grantFromRow(row, now), token };
  },
});

export const revokeGrant = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string(), grantId: v.string() },
  handler: async (ctx, args): Promise<NodeSlideDelegationGrant> => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const grant = await findGrantById(ctx, args.grantId);
    if (!grant || grant.deckId !== args.deckId) throw new Error('Delegation grant not found.');
    assertStoredGrantPolicy(grant);
    const now = Date.now();
    if (grant.revokedAt === undefined) {
      await ctx.db.patch(grant._id, { revokedAt: now });
      return grantFromRow({ ...grant, revokedAt: now }, now);
    }
    return grantFromRow(grant, now);
  },
});

export const listGrants = query({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args): Promise<NodeSlideDelegationGrant[]> => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const now = Date.now();
    const rows = await ctx.db
      .query('nodeslide_delegation_grants')
      .withIndex('by_deck_created', (index) => index.eq('deckId', args.deckId))
      .order('desc')
      .take(NODESLIDE_DELEGATION_LIST_LIMIT);
    return rows.map((row) => {
      assertStoredGrantPolicy(row);
      return grantFromRow(row, now);
    });
  },
});

export const acceptValidatedProposalWithGrant = mutation({
  args: {
    deckId: v.string(),
    token: v.string(),
    patchId: v.string(),
    expectedCandidateDigest: v.string(),
  },
  handler: async (ctx, args): Promise<NodeSlideDelegationAcceptanceReceipt> => {
    const now = Date.now();
    const token = requireGrantToken(args.token);
    const grant = await findGrantByTokenDigest(ctx, nodeslideContentDigest(token));
    if (!grant || grant.deckId !== args.deckId) throw new Error('NodeSlide delegation denied.');
    assertStoredGrantPolicy(grant);
    // Lifecycle denial must happen before touching either use or proposal rows.
    assertGrantNotRevokedOrExpired(grant, now);
    if (!NODESLIDE_DELEGATION_DIGEST_PATTERN.test(args.expectedCandidateDigest)) {
      throw new Error('Expected candidate digest is invalid.');
    }

    const existingUse = await findGrantUse(ctx, grant.id, args.patchId);
    // An exhausted grant may retrieve only its exact durable receipt. A new
    // patch is denied before proposal lookup, avoiding an existence oracle.
    assertGrantCapacityOrExactReplay(grant, existingUse, {
      deckId: args.deckId,
      patchId: args.patchId,
      candidateDigest: args.expectedCandidateDigest,
    });

    const proposal = await findPatchRow(ctx, args.patchId);
    if (!proposal || proposal.deckId !== args.deckId) {
      throw new Error('Delegated proposal is unavailable.');
    }
    assertProposalBinding(grant, proposal, args.expectedCandidateDigest);
    const candidateValidation = proposal.candidateValidation;
    if (!candidateValidation) {
      throw new Error('Validated proposal candidate receipt is unavailable.');
    }
    if (proposal.createdAt < grant.createdAt) {
      throw new Error('Delegated acceptance rejects proposals created before the grant.');
    }

    if (existingUse) {
      assertReplayBinding(existingUse, grant, proposal, args.expectedCandidateDigest);
      return await replayReceipt(ctx, grant, proposal, existingUse);
    }

    if (proposal.status === 'accepted') {
      throw new Error('The proposal was accepted without this delegation grant.');
    }
    if (proposal.status === 'rejected') throw new Error('The proposal was rejected.');
    if (proposal.status === 'stale') {
      return {
        patch: patchFromRow(proposal),
        workspace: null,
        rebased: false,
        staleReasons: ['The validated proposal is already stale.'],
        delegation: delegationUseReceipt(grant, false),
      };
    }

    const deckRow = await findDeckRow(ctx, args.deckId);
    if (!deckRow) throw new Error('Delegated proposal deck is unavailable.');
    const snapshot = await loadNodeSlideSnapshot(ctx, args.deckId);
    if (!snapshot) throw new Error('Delegated proposal deck is unavailable.');
    const cas = evaluateNodeSlideCas(snapshot, proposal);
    if (!cas.canCommit) {
      const stale = await commitDelegatedNodeSlideProposal(ctx, proposal, {
        deckRow,
        grantId: grant.id,
        clientKind: grant.clientKind,
        policyDigest: grant.policyDigest,
      });
      return {
        ...stale,
        workspace: null,
        rebased: false,
        delegation: delegationUseReceipt(grant, false),
      };
    }
    const candidate = materializeNodeSlideCandidate(snapshot, proposal, now);
    const candidateViolations = nodeSlideDelegationCandidateViolations({
      baseline: snapshot,
      candidate,
      operations: proposal.operations,
    });
    if (candidateViolations.length > 0) throw new Error(candidateViolations.join(' '));
    const deckCi = evaluateNodeSlideDeckCi(candidate, {
      referenceTime: now,
      validation: validationFromCandidateReceipt(candidateValidation),
    });
    const autoCommitDecision = evaluateNodeSlideDelegationAutoCommit({
      grant,
      proposal,
      evaluatedAt: now,
      candidateValidationPassed: candidateValidation.ok,
      deckCiPassed: nodeSlideDeckCiAllowsAutoCommit(deckCi),
    });
    if (autoCommitDecision.outcome !== 'commit') {
      await persistAutoCommitReviewReceipt(ctx, proposal, deckCi, now);
      return {
        patch: patchFromRow({ ...proposal, status: 'ready', updatedAt: now }),
        workspace: null,
        validation: validationFromCandidateReceipt(candidateValidation),
        rebased: false,
        staleReasons: [deckCiReviewMessage(deckCi)],
        delegation: delegationUseReceipt(grant, false),
        autoCommit: {
          outcome: autoCommitDecision.outcome,
          reason: autoCommitDecision.reason,
          deckCiStatus: deckCi.status,
          deckCiDigest: deckCi.digest,
          deckCiBlockerCount: deckCi.blockerCount,
        },
      };
    }
    const committed = await commitDelegatedNodeSlideProposal(ctx, proposal, {
      deckRow,
      grantId: grant.id,
      clientKind: grant.clientKind,
      policyDigest: grant.policyDigest,
    });
    if (committed.patch.status !== 'accepted') {
      return {
        ...committed,
        workspace: null,
        rebased: committed.rebased,
        delegation: delegationUseReceipt(grant, false),
      };
    }
    if (committed.patch.resultingDeckVersion === undefined) {
      throw new Error('Delegated commit did not produce a version receipt.');
    }

    const use = {
      id: nodeslideStableId('delegation_use', grant.id, proposal.id),
      grantId: grant.id,
      deckId: grant.deckId,
      patchId: proposal.id,
      candidateDigest: args.expectedCandidateDigest,
      resultingDeckVersion: committed.patch.resultingDeckVersion,
      rebased: committed.rebased,
      usedAt: now,
    };
    await ctx.db.insert('nodeslide_delegation_uses', use);
    const updatedGrant = {
      ...grant,
      useCount: grant.useCount + 1,
      lastUsedAt: now,
    };
    await ctx.db.patch(grant._id, {
      useCount: updatedGrant.useCount,
      lastUsedAt: updatedGrant.lastUsedAt,
    });
    return {
      ...committed,
      workspace: null,
      rebased: committed.rebased,
      delegation: delegationUseReceipt(updatedGrant, false),
    };
  },
});

function assertIssueBounds(
  args: { maxOperations: number; maxUses: number; expiresAt: number },
  now: number,
): void {
  if (
    !Number.isSafeInteger(args.maxOperations) ||
    args.maxOperations < 1 ||
    args.maxOperations > NODESLIDE_DELEGATION_MAX_OPERATIONS
  ) {
    throw new Error(
      `Delegation grants permit 1-${NODESLIDE_DELEGATION_MAX_OPERATIONS} operations per proposal.`,
    );
  }
  if (
    !Number.isSafeInteger(args.maxUses) ||
    args.maxUses < 1 ||
    args.maxUses > NODESLIDE_DELEGATION_MAX_USES
  ) {
    throw new Error(`Delegation grants permit 1-${NODESLIDE_DELEGATION_MAX_USES} uses.`);
  }
  if (
    !Number.isSafeInteger(args.expiresAt) ||
    args.expiresAt <= now ||
    args.expiresAt - now > NODESLIDE_DELEGATION_MAX_TTL_MS
  ) {
    throw new Error('Delegation expiry must be in the future and no more than seven days away.');
  }
}

function assertStoredGrantPolicy(grant: Doc<'nodeslide_delegation_grants'>): void {
  if (
    grant.schemaVersion !== NODESLIDE_DELEGATION_GRANT_VERSION ||
    grant.policyVersion !== NODESLIDE_DELEGATION_POLICY_VERSION ||
    grant.capability !== NODESLIDE_DELEGATION_CAPABILITY ||
    grant.proposalSource !== NODESLIDE_DELEGATION_PROPOSAL_SOURCE ||
    grant.proposalKind !== NODESLIDE_DELEGATION_PROPOSAL_KIND ||
    !Number.isSafeInteger(grant.maxOperations) ||
    grant.maxOperations < 1 ||
    grant.maxOperations > NODESLIDE_DELEGATION_MAX_OPERATIONS ||
    !Number.isSafeInteger(grant.maxUses) ||
    grant.maxUses < 1 ||
    grant.maxUses > NODESLIDE_DELEGATION_MAX_USES ||
    !Number.isSafeInteger(grant.useCount) ||
    grant.useCount < 0 ||
    grant.useCount > grant.maxUses ||
    !Number.isSafeInteger(grant.createdAt) ||
    !Number.isSafeInteger(grant.expiresAt) ||
    grant.expiresAt <= grant.createdAt ||
    grant.expiresAt - grant.createdAt > NODESLIDE_DELEGATION_MAX_TTL_MS ||
    (grant.revokedAt !== undefined &&
      (!Number.isSafeInteger(grant.revokedAt) || grant.revokedAt < grant.createdAt)) ||
    (grant.lastUsedAt !== undefined &&
      (!Number.isSafeInteger(grant.lastUsedAt) || grant.lastUsedAt < grant.createdAt)) ||
    !NODESLIDE_DELEGATION_DIGEST_PATTERN.test(grant.tokenDigest) ||
    !NODESLIDE_DELEGATION_DIGEST_PATTERN.test(grant.policyDigest)
  ) {
    throw new Error('Delegation grant policy is invalid.');
  }
  const expectedPolicyDigest = nodeslideContentDigest(
    nodeSlideDelegationPolicyDigestInput(policyFromRow(grant)),
  );
  if (grant.policyDigest !== expectedPolicyDigest) {
    throw new Error('Delegation grant policy digest mismatch.');
  }
}

function assertGrantNotRevokedOrExpired(
  grant: Doc<'nodeslide_delegation_grants'>,
  now: number,
): void {
  const status = nodeSlideDelegationGrantStatus(grant, now);
  if (status === 'revoked') throw new Error('Delegation grant was revoked.');
  if (status === 'expired') throw new Error('Delegation grant expired.');
}

function assertGrantCapacityOrExactReplay(
  grant: Doc<'nodeslide_delegation_grants'>,
  existingUse: Doc<'nodeslide_delegation_uses'> | null,
  request: { deckId: string; patchId: string; candidateDigest: string },
): void {
  const exactReplay =
    existingUse?.grantId === grant.id &&
    existingUse.deckId === request.deckId &&
    existingUse.patchId === request.patchId &&
    existingUse.candidateDigest === request.candidateDigest;
  if (!exactReplay && grant.useCount >= grant.maxUses) {
    throw new Error('Delegation grant is exhausted.');
  }
}

function assertProposalBinding(
  grant: Doc<'nodeslide_delegation_grants'>,
  proposal: Doc<'nodeslide_patches'>,
  expectedCandidateDigest: string,
): void {
  const violations = nodeSlideDelegationProposalViolations({ grant, proposal });
  if (violations.length > 0) throw new Error(violations.join(' '));
  const receipt = proposal.candidateValidation;
  if (
    proposal.candidateDigest !== expectedCandidateDigest ||
    !receipt ||
    receipt.patchId !== proposal.id ||
    receipt.deckId !== proposal.deckId ||
    receipt.candidateDigest !== expectedCandidateDigest ||
    !receipt.ok
  ) {
    throw new Error('Validated proposal candidate digest mismatch.');
  }
}

function assertReplayBinding(
  use: Doc<'nodeslide_delegation_uses'>,
  grant: Doc<'nodeslide_delegation_grants'>,
  proposal: Doc<'nodeslide_patches'>,
  expectedCandidateDigest: string,
): void {
  if (
    use.grantId !== grant.id ||
    use.deckId !== grant.deckId ||
    use.patchId !== proposal.id ||
    use.candidateDigest !== expectedCandidateDigest ||
    proposal.status !== 'accepted' ||
    proposal.resultingDeckVersion !== use.resultingDeckVersion ||
    grant.useCount < 1
  ) {
    throw new Error('Delegation use replay binding is invalid.');
  }
}

async function replayReceipt(
  _ctx: MutationCtx,
  grant: Doc<'nodeslide_delegation_grants'>,
  proposal: Doc<'nodeslide_patches'>,
  use: Doc<'nodeslide_delegation_uses'>,
): Promise<NodeSlideDelegationAcceptanceReceipt> {
  return {
    patch: patchFromRow(proposal),
    // A bearer replay returns the immutable acceptance receipt only. Loading
    // the current workspace here would turn an old grant into an ongoing read
    // capability for changes made after the authorized commit.
    workspace: null,
    ...(proposal.candidateValidation
      ? { validation: validationFromCandidateReceipt(proposal.candidateValidation) }
      : {}),
    rebased: use.rebased,
    delegation: delegationUseReceipt(grant, true),
  };
}

async function persistAutoCommitReviewReceipt(
  ctx: MutationCtx,
  proposal: Doc<'nodeslide_patches'>,
  deckCi: NodeSlideDeckCiResult,
  now: number,
): Promise<void> {
  const message = deckCiReviewMessage(deckCi);
  await ctx.db.patch(proposal._id, { status: 'ready', updatedAt: now });

  const run = proposal.jobId
    ? await ctx.db
        .query('nodeslide_agent_runs')
        .withIndex('by_stable_id', (index) => index.eq('id', proposal.jobId as string))
        .first()
    : ((
        await ctx.db
          .query('nodeslide_agent_runs')
          .withIndex('by_deck_created', (index) => index.eq('deckId', proposal.deckId))
          .order('desc')
          .take(NODESLIDE_DELEGATION_LIST_LIMIT)
      ).find((candidate) => candidate.patchId === proposal.id) ?? null);
  if (run && run.status !== 'completed' && run.status !== 'cancelled') {
    await ctx.db.patch(run._id, {
      status: 'awaiting_review',
      checkpoint: `deck-ci:${deckCi.digest}`,
      error: message,
      updatedAt: now,
      completedAt: undefined,
    });
  }

  const trace = await ctx.db
    .query('nodeslide_traces')
    .withIndex('by_patch', (index) => index.eq('patchId', proposal.id))
    .first();
  if (trace && trace.status !== 'completed' && trace.status !== 'cancelled') {
    await ctx.db.patch(trace._id, {
      status: 'awaiting_review',
      summary: message,
      candidateDigest: proposal.candidateDigest,
      completedAt: undefined,
    });
  }
}

function deckCiReviewMessage(deckCi: NodeSlideDeckCiResult): string {
  const blocking = deckCi.checks.find((check) => check.blocker) ?? deckCi.checks[0];
  const detail = blocking ? ` ${blocking.message}` : '';
  return `Turbo did not mutate the deck because deterministic Deck CI returned ${deckCi.status}.${detail}`;
}

function delegationUseReceipt(
  grant: Pick<Doc<'nodeslide_delegation_grants'>, 'id' | 'useCount' | 'maxUses'>,
  replayed: boolean,
) {
  return {
    grantId: grant.id,
    useCount: grant.useCount,
    maxUses: grant.maxUses,
    replayed,
  };
}

function grantFromRow(
  row:
    | Omit<Doc<'nodeslide_delegation_grants'>, '_id' | '_creationTime'>
    | Doc<'nodeslide_delegation_grants'>,
  now: number,
): NodeSlideDelegationGrant {
  return {
    schemaVersion: row.schemaVersion,
    id: row.id,
    ...policyFromRow(row),
    useCount: row.useCount,
    policyDigest: row.policyDigest,
    status: nodeSlideDelegationGrantStatus(row, now),
    ...(row.lastUsedAt !== undefined ? { lastUsedAt: row.lastUsedAt } : {}),
    ...(row.revokedAt !== undefined ? { revokedAt: row.revokedAt } : {}),
  };
}

function policyFromRow(
  row: Pick<
    Doc<'nodeslide_delegation_grants'>,
    | 'policyVersion'
    | 'deckId'
    | 'clientKind'
    | 'capability'
    | 'proposalSource'
    | 'proposalKind'
    | 'maxOperations'
    | 'maxUses'
    | 'createdAt'
    | 'expiresAt'
  >,
): NodeSlideDelegationPolicy {
  return {
    policyVersion: row.policyVersion,
    deckId: row.deckId,
    clientKind: row.clientKind,
    capability: row.capability,
    proposalSource: row.proposalSource,
    proposalKind: row.proposalKind,
    maxOperations: row.maxOperations,
    maxUses: row.maxUses,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

async function createUniqueGrantToken(ctx: MutationCtx): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomBase64Url(NODESLIDE_DELEGATION_TOKEN_BYTES);
    const existing = await findGrantByTokenDigest(ctx, nodeslideContentDigest(token));
    if (!existing) return token;
  }
  throw new Error('Unable to allocate a unique delegation token.');
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function requireGrantToken(value: string): string {
  if (!NODESLIDE_DELEGATION_TOKEN_PATTERN.test(value)) {
    throw new Error('NodeSlide delegation denied.');
  }
  return value;
}

async function findGrantById(
  ctx: { db: MutationCtx['db'] },
  grantId: string,
): Promise<Doc<'nodeslide_delegation_grants'> | null> {
  return await ctx.db
    .query('nodeslide_delegation_grants')
    .withIndex('by_stable_id', (index) => index.eq('id', grantId))
    .first();
}

async function findGrantByTokenDigest(
  ctx: { db: MutationCtx['db'] },
  tokenDigest: string,
): Promise<Doc<'nodeslide_delegation_grants'> | null> {
  return await ctx.db
    .query('nodeslide_delegation_grants')
    .withIndex('by_token_digest', (index) => index.eq('tokenDigest', tokenDigest))
    .first();
}

async function findGrantUse(
  ctx: { db: MutationCtx['db'] },
  grantId: string,
  patchId: string,
): Promise<Doc<'nodeslide_delegation_uses'> | null> {
  return await ctx.db
    .query('nodeslide_delegation_uses')
    .withIndex('by_grant_patch', (index) => index.eq('grantId', grantId).eq('patchId', patchId))
    .first();
}
