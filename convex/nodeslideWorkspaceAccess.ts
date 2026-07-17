import { v } from 'convex/values';
import { nodeSlideAgentModel } from '../shared/nodeslide';
import type { NodeSlideAccessPolicy } from '../shared/nodeslideAccessPolicy';
import { api, internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { action, internalQuery, mutation, query } from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';
import { findDeckRow } from './lib/nodeslideData';
import { nodeslideContentDigest, nodeslideEventId } from './lib/nodeslideIds';
import type { PublicNodeSlideJob } from './lib/nodeslideJobState';
import { nodeslideEditProposalJobRequestFields } from './lib/nodeslideJobValidators';
import {
  type NodeSlideWorkspaceAccessPolicy,
  type NodeSlideWorkspaceCapability,
  type NodeSlideWorkspaceRole,
  evaluateNodeSlideWorkspaceAccess,
  isNodeSlideWorkspaceAccessPolicy,
  narrowNodeSlideWorkspaceAccessPolicy,
  nodeSlideWorkspaceCapabilitiesForRole,
  normalizeNodeSlideWorkspaceAccessPolicy,
} from './lib/nodeslideScopeAccess';

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MAX_GRANT_LIFETIME_MS = 365 * 24 * 60 * 60 * 1_000;
const LIST_LIMIT = 128;
const ACCESS_DENIED = 'NodeSlide workspace access denied.';

type ReadCtx = Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>;

export interface NodeSlideWorkspaceSummary {
  readonly id: string;
  readonly name: string;
  readonly status: 'active';
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface NodeSlideWorkspaceProjectSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface NodeSlideWorkspaceGrantSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId?: string;
  readonly role: NodeSlideWorkspaceRole;
  readonly policy: NodeSlideWorkspaceAccessPolicy;
  readonly parentGrantId?: string;
  readonly status: 'active' | 'expired' | 'revoked';
  readonly expiresAt: number;
  readonly createdAt: number;
  readonly revokedAt?: number;
}

export interface NodeSlideAttachedDeckSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly title: string;
  readonly status: 'draft' | 'validating' | 'ready' | 'published';
  readonly version: number;
}

export const createWorkspace = mutation({
  args: { name: v.string(), expiresAt: v.number(), agentPolicy: v.any() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const name = boundedName(args.name, 'workspace name');
    assertExpiry(args.expiresAt, now);
    const { token, tokenDigest } = await createUniqueGrantToken(ctx);
    const workspaceId = nodeslideEventId('nsworkspace', now, tokenDigest);
    const grantId = nodeslideEventId('nsaccess', now, workspaceId, tokenDigest);
    const policy = normalizeNodeSlideWorkspaceAccessPolicy({
      workspaceId,
      role: 'owner',
      projectScope: { kind: 'workspace' },
      capabilities: nodeSlideWorkspaceCapabilitiesForRole('owner'),
      agentPolicy: args.agentPolicy,
    });
    const workspace = {
      id: workspaceId,
      name,
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
    };
    const grant = {
      id: grantId,
      workspaceId,
      role: 'owner' as const,
      tokenDigest,
      policy: policyForStorage(policy),
      expiresAt: args.expiresAt,
      createdAt: now,
    };
    await ctx.db.insert('nodeslide_workspaces', workspace);
    await ctx.db.insert('nodeslide_access_grants', grant);
    await insertGrantEvent(ctx, {
      workspaceId,
      grantId,
      kind: 'issued',
      occurredAt: now,
    });
    return {
      workspace: workspaceSummary(workspace),
      grant: grantSummary(grant, now),
      token,
    };
  },
});

export const createProject = mutation({
  args: { workspaceId: v.string(), token: v.string(), name: v.string() },
  handler: async (ctx, args): Promise<NodeSlideWorkspaceProjectSummary> => {
    const now = Date.now();
    await requireGrant(ctx, args.workspaceId, args.token, now, 'project:create');
    await requireWorkspace(ctx, args.workspaceId);
    const name = boundedName(args.name, 'project name');
    const projectId = nodeslideEventId('nsworkspace_project', now, args.workspaceId, randomToken());
    const project = {
      id: projectId,
      workspaceId: args.workspaceId,
      name,
      createdAt: now,
      updatedAt: now,
    };
    await ctx.db.insert('nodeslide_workspace_projects', project);
    return projectSummary(project);
  },
});

export const attachDeck = mutation({
  args: {
    workspaceId: v.string(),
    projectId: v.string(),
    token: v.string(),
    deckId: v.string(),
    ownerAccessKey: v.string(),
  },
  handler: async (ctx, args): Promise<NodeSlideAttachedDeckSummary> => {
    const now = Date.now();
    await requireGrant(ctx, args.workspaceId, args.token, now, 'deck:attach', args.projectId);
    await requireProject(ctx, args.workspaceId, args.projectId);
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    if (deck.workspaceId !== undefined || deck.workspaceProjectId !== undefined) {
      if (deck.workspaceId !== args.workspaceId || deck.workspaceProjectId !== args.projectId) {
        throw new Error('NodeSlide deck is already attached to another project.');
      }
      return attachedDeckSummary(deck, args.workspaceId, args.projectId);
    }
    await ctx.db.patch(deck._id, {
      workspaceId: args.workspaceId,
      workspaceProjectId: args.projectId,
    });
    return attachedDeckSummary(
      { ...deck, workspaceId: args.workspaceId, workspaceProjectId: args.projectId },
      args.workspaceId,
      args.projectId,
    );
  },
});

export const issueGrant = mutation({
  args: {
    workspaceId: v.string(),
    token: v.string(),
    projectId: v.string(),
    role: v.union(v.literal('editor'), v.literal('viewer')),
    capabilities: v.array(v.string()),
    agentPolicy: v.any(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const issuer = await requireGrant(ctx, args.workspaceId, args.token, now, 'grant:issue');
    await requireProject(ctx, args.workspaceId, args.projectId);
    assertExpiry(args.expiresAt, now);
    if (args.expiresAt > issuer.row.expiresAt) throw new Error(ACCESS_DENIED);
    const requested = normalizeNodeSlideWorkspaceAccessPolicy({
      workspaceId: args.workspaceId,
      role: args.role,
      projectScope: { kind: 'project', projectId: args.projectId },
      capabilities: args.capabilities,
      agentPolicy: args.agentPolicy,
    });
    const policy = narrowNodeSlideWorkspaceAccessPolicy(issuer.policy, requested);
    if (
      policy.projectScope.kind !== 'project' ||
      policy.projectScope.projectId !== args.projectId
    ) {
      throw new Error(ACCESS_DENIED);
    }
    const { token, tokenDigest } = await createUniqueGrantToken(ctx);
    const grantId = nodeslideEventId(
      'nsaccess',
      now,
      args.workspaceId,
      args.projectId,
      tokenDigest,
    );
    const grant = {
      id: grantId,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      role: args.role,
      tokenDigest,
      policy: policyForStorage(policy),
      parentGrantId: issuer.row.id,
      expiresAt: args.expiresAt,
      createdAt: now,
    };
    await ctx.db.insert('nodeslide_access_grants', grant);
    await insertGrantEvent(ctx, {
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      grantId,
      actorGrantId: issuer.row.id,
      kind: 'issued',
      occurredAt: now,
    });
    return { grant: grantSummary(grant, now), token };
  },
});

export const revokeGrant = mutation({
  args: { workspaceId: v.string(), token: v.string(), grantId: v.string() },
  handler: async (ctx, args): Promise<NodeSlideWorkspaceGrantSummary> => {
    const now = Date.now();
    const actor = await requireGrant(ctx, args.workspaceId, args.token, now, 'grant:revoke');
    const target = await findGrantById(ctx, args.grantId);
    if (!target || target.workspaceId !== args.workspaceId || target.role === 'owner') {
      throw new Error(ACCESS_DENIED);
    }
    assertStoredGrant(target);
    if (target.revokedAt === undefined) {
      await ctx.db.patch(target._id, { revokedAt: now });
      await insertGrantEvent(ctx, {
        workspaceId: args.workspaceId,
        ...(target.projectId ? { projectId: target.projectId } : {}),
        grantId: target.id,
        actorGrantId: actor.row.id,
        kind: 'revoked',
        occurredAt: now,
      });
      return grantSummary({ ...target, revokedAt: now }, now);
    }
    return grantSummary(target, now);
  },
});

export const getWorkspace = query({
  args: { workspaceId: v.string(), token: v.string() },
  handler: async (ctx, args): Promise<NodeSlideWorkspaceSummary> => {
    await requireGrant(ctx, args.workspaceId, args.token, Date.now(), 'workspace:read');
    return workspaceSummary(await requireWorkspace(ctx, args.workspaceId));
  },
});

export const getProject = query({
  args: { workspaceId: v.string(), projectId: v.string(), token: v.string() },
  handler: async (ctx, args): Promise<NodeSlideWorkspaceProjectSummary> => {
    await requireGrant(
      ctx,
      args.workspaceId,
      args.token,
      Date.now(),
      'project:read',
      args.projectId,
    );
    return projectSummary(await requireProject(ctx, args.workspaceId, args.projectId));
  },
});

export const getAttachedDeck = query({
  args: { workspaceId: v.string(), projectId: v.string(), deckId: v.string(), token: v.string() },
  handler: async (ctx, args): Promise<NodeSlideAttachedDeckSummary> => {
    await requireGrant(ctx, args.workspaceId, args.token, Date.now(), 'deck:read', args.projectId);
    const deck = await findDeckRow(ctx, args.deckId);
    if (
      !deck ||
      deck.workspaceId !== args.workspaceId ||
      deck.workspaceProjectId !== args.projectId
    ) {
      throw new Error(ACCESS_DENIED);
    }
    return attachedDeckSummary(deck, args.workspaceId, args.projectId);
  },
});

/** Workspace/project grants can launch bounded jobs without exposing the deck owner capability. */
export const startEditProposal = action({
  args: {
    workspaceId: v.string(),
    projectId: v.string(),
    token: v.string(),
    idempotencyKey: v.string(),
    ...nodeslideEditProposalJobRequestFields,
  },
  handler: async (ctx, args): Promise<PublicNodeSlideJob> => {
    const authorization = await ctx.runQuery(
      internal.nodeslideWorkspaceAccess.authorizeEditJobInternal,
      {
        workspaceId: args.workspaceId,
        projectId: args.projectId,
        deckId: args.deckId,
        token: args.token,
        ...(args.providerMode ? { providerMode: args.providerMode } : {}),
        ...(args.providerModel ? { providerModel: args.providerModel } : {}),
        ...(args.maxCostUsd !== undefined ? { maxCostUsd: args.maxCostUsd } : {}),
        ...(args.webResearch !== undefined ? { webResearch: args.webResearch } : {}),
        ...(args.memoryMode ? { memoryMode: args.memoryMode } : {}),
      },
    );
    const { workspaceId: _workspaceId, projectId: _projectId, token: _token, ...request } = args;
    return (await ctx.runMutation(api.nodeslideJobs.startEditProposal, {
      ...request,
      ownerAccessKey: authorization.ownerAccessKey,
    })) as PublicNodeSlideJob;
  },
});

export const authorizeEditJobInternal = internalQuery({
  args: {
    workspaceId: v.string(),
    projectId: v.string(),
    deckId: v.string(),
    token: v.string(),
    providerMode: nodeslideEditProposalJobRequestFields.providerMode,
    providerModel: nodeslideEditProposalJobRequestFields.providerModel,
    maxCostUsd: v.optional(v.number()),
    webResearch: v.optional(v.boolean()),
    memoryMode: nodeslideEditProposalJobRequestFields.memoryMode,
  },
  handler: async (ctx, args) => {
    const grant = await requireGrant(
      ctx,
      args.workspaceId,
      args.token,
      Date.now(),
      'job:create',
      args.projectId,
    );
    const deck = await findDeckRow(ctx, args.deckId);
    if (
      !deck ||
      deck.workspaceId !== args.workspaceId ||
      deck.workspaceProjectId !== args.projectId ||
      !deck.ownerAccessKey
    ) {
      throw new Error(ACCESS_DENIED);
    }
    const policy = grant.policy.agentPolicy;
    if (
      !policy.capabilities.includes('proposal:create') ||
      !policy.capabilities.includes('deck:read') ||
      !policy.scopes.deckIds.includes(args.deckId)
    ) {
      throw new Error(ACCESS_DENIED);
    }
    if (args.providerMode && args.providerMode !== 'deterministic') {
      if (!args.providerModel || !policy.capabilities.includes('model:invoke')) {
        throw new Error(ACCESS_DENIED);
      }
      const route = nodeSlideAgentModel(args.providerModel);
      if (
        !policy.scopes.modelIds.includes(args.providerModel) ||
        !policy.scopes.providerIds.includes(route.provider)
      ) {
        throw new Error(ACCESS_DENIED);
      }
    }
    if (args.webResearch && !policy.capabilities.includes('web:read')) {
      throw new Error(ACCESS_DENIED);
    }
    if (args.memoryMode === 'relevant' && !policy.capabilities.includes('memory:read')) {
      throw new Error(ACCESS_DENIED);
    }
    const requestedMicroUsd = Math.ceil((args.maxCostUsd ?? 1) * 1_000_000);
    if (requestedMicroUsd > policy.budget.maxCostMicroUsd) throw new Error(ACCESS_DENIED);
    return { ownerAccessKey: deck.ownerAccessKey, grantId: grant.row.id };
  },
});

export const listGrants = query({
  args: { workspaceId: v.string(), token: v.string() },
  handler: async (ctx, args): Promise<NodeSlideWorkspaceGrantSummary[]> => {
    await requireGrant(ctx, args.workspaceId, args.token, Date.now(), 'grant:issue');
    const rows = await ctx.db
      .query('nodeslide_access_grants')
      .withIndex('by_workspace_created', (index) => index.eq('workspaceId', args.workspaceId))
      .order('desc')
      .take(LIST_LIMIT);
    return rows.map((row) => {
      assertStoredGrant(row);
      return grantSummary(row, Date.now());
    });
  },
});

async function requireGrant(
  ctx: ReadCtx,
  workspaceId: string,
  tokenInput: string,
  now: number,
  capability: NodeSlideWorkspaceCapability,
  projectId?: string,
): Promise<{ row: Doc<'nodeslide_access_grants'>; policy: NodeSlideWorkspaceAccessPolicy }> {
  if (!boundedId(workspaceId) || !TOKEN_PATTERN.test(tokenInput) || !Number.isFinite(now)) {
    throw new Error(ACCESS_DENIED);
  }
  const row = await ctx.db
    .query('nodeslide_access_grants')
    .withIndex('by_token_digest', (index) => index.eq('tokenDigest', grantTokenDigest(tokenInput)))
    .unique();
  if (
    !row ||
    row.workspaceId !== workspaceId ||
    row.revokedAt !== undefined ||
    now >= row.expiresAt
  ) {
    throw new Error(ACCESS_DENIED);
  }
  const policy = assertStoredGrant(row);
  const decision = evaluateNodeSlideWorkspaceAccess(policy, {
    workspaceId,
    capability,
    ...(projectId ? { projectId } : {}),
  });
  if (!decision.allowed) throw new Error(ACCESS_DENIED);
  return { row, policy };
}

function assertStoredGrant(row: Doc<'nodeslide_access_grants'>): NodeSlideWorkspaceAccessPolicy {
  if (!isNodeSlideWorkspaceAccessPolicy(row.policy)) throw new Error(ACCESS_DENIED);
  if (
    row.policy.workspaceId !== row.workspaceId ||
    row.policy.role !== row.role ||
    (row.projectId === undefined
      ? row.policy.projectScope.kind !== 'workspace'
      : row.policy.projectScope.kind !== 'project' ||
        row.policy.projectScope.projectId !== row.projectId)
  ) {
    throw new Error(ACCESS_DENIED);
  }
  return row.policy;
}

async function requireWorkspace(
  ctx: ReadCtx,
  workspaceId: string,
): Promise<Doc<'nodeslide_workspaces'>> {
  if (!boundedId(workspaceId)) throw new Error(ACCESS_DENIED);
  const row = await ctx.db
    .query('nodeslide_workspaces')
    .withIndex('by_stable_id', (index) => index.eq('id', workspaceId))
    .unique();
  if (!row || row.status !== 'active') throw new Error(ACCESS_DENIED);
  return row;
}

async function requireProject(
  ctx: ReadCtx,
  workspaceId: string,
  projectId: string,
): Promise<Doc<'nodeslide_workspace_projects'>> {
  if (!boundedId(projectId)) throw new Error(ACCESS_DENIED);
  const row = await ctx.db
    .query('nodeslide_workspace_projects')
    .withIndex('by_stable_id', (index) => index.eq('id', projectId))
    .unique();
  if (!row || row.workspaceId !== workspaceId) throw new Error(ACCESS_DENIED);
  return row;
}

async function findGrantById(
  ctx: ReadCtx,
  grantId: string,
): Promise<Doc<'nodeslide_access_grants'> | null> {
  if (!boundedId(grantId)) return null;
  return await ctx.db
    .query('nodeslide_access_grants')
    .withIndex('by_stable_id', (index) => index.eq('id', grantId))
    .unique();
}

async function createUniqueGrantToken(
  ctx: ReadCtx,
): Promise<{ token: string; tokenDigest: string }> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const token = randomToken();
    const tokenDigest = grantTokenDigest(token);
    const existing = await ctx.db
      .query('nodeslide_access_grants')
      .withIndex('by_token_digest', (index) => index.eq('tokenDigest', tokenDigest))
      .unique();
    if (!existing) return { token, tokenDigest };
  }
  throw new Error('Unable to create NodeSlide workspace capability.');
}

async function insertGrantEvent(
  ctx: Pick<MutationCtx, 'db'>,
  event: {
    workspaceId: string;
    projectId?: string;
    grantId: string;
    actorGrantId?: string;
    kind: 'issued' | 'revoked';
    occurredAt: number;
  },
): Promise<void> {
  await ctx.db.insert('nodeslide_access_grant_events', {
    id: nodeslideEventId(
      'nsaccess_event',
      event.occurredAt,
      event.grantId,
      event.kind,
      event.actorGrantId ?? 'bootstrap',
    ),
    ...event,
  });
}

function grantSummary(
  grant: Omit<Doc<'nodeslide_access_grants'>, '_id' | '_creationTime'>,
  now: number,
): NodeSlideWorkspaceGrantSummary {
  return {
    id: grant.id,
    workspaceId: grant.workspaceId,
    ...(grant.projectId ? { projectId: grant.projectId } : {}),
    role: grant.role,
    policy: structuredClone(grant.policy),
    ...(grant.parentGrantId ? { parentGrantId: grant.parentGrantId } : {}),
    status:
      grant.revokedAt !== undefined ? 'revoked' : now >= grant.expiresAt ? 'expired' : 'active',
    expiresAt: grant.expiresAt,
    createdAt: grant.createdAt,
    ...(grant.revokedAt !== undefined ? { revokedAt: grant.revokedAt } : {}),
  };
}

function policyForStorage(
  policy: NodeSlideWorkspaceAccessPolicy,
): Doc<'nodeslide_access_grants'>['policy'] {
  return structuredClone(policy) as Doc<'nodeslide_access_grants'>['policy'];
}

function workspaceSummary(
  workspace: Omit<Doc<'nodeslide_workspaces'>, '_id' | '_creationTime'>,
): NodeSlideWorkspaceSummary {
  return {
    id: workspace.id,
    name: workspace.name,
    status: workspace.status,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

function projectSummary(
  project: Omit<Doc<'nodeslide_workspace_projects'>, '_id' | '_creationTime'>,
): NodeSlideWorkspaceProjectSummary {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function attachedDeckSummary(
  deck: Doc<'nodeslide_decks'>,
  workspaceId: string,
  projectId: string,
): NodeSlideAttachedDeckSummary {
  return {
    id: deck.id,
    workspaceId,
    projectId,
    title: deck.title,
    status: deck.status,
    version: deck.version,
  };
}

function boundedName(value: string, field: string): string {
  const clean = value.replace(/\s+/gu, ' ').trim();
  if (!clean || clean.length > 120) throw new Error(`Invalid NodeSlide ${field}.`);
  return clean;
}

function boundedId(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function assertExpiry(expiresAt: number, now: number): void {
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now ||
    expiresAt - now > MAX_GRANT_LIFETIME_MS
  ) {
    throw new Error('Invalid NodeSlide workspace grant expiry.');
  }
}

function grantTokenDigest(token: string): string {
  return nodeslideContentDigest(`nodeslide-workspace-grant\u001f${token}`);
}

function randomToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

export type { NodeSlideAccessPolicy };
