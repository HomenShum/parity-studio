import { v } from 'convex/values';
import type { DeckPatch, DeckSnapshot } from '../shared/nodeslide';
import { createGoogleSlidesAdapter } from '../src/domains/nodeslide/integrations/googleSlides/adapter';
import {
  type GoogleSlidesInboundExternalPlanV1,
  type GoogleSlidesOutboundExternalPlanV1,
  assertGoogleSlidesExternalPlanCurrent,
  createGoogleSlidesInboundExternalPlan,
  createGoogleSlidesOutboundExternalPlan,
  createGoogleSlidesPostAcceptanceReceipt,
  googleSlidesExternalSnapshotDigest,
} from '../src/domains/nodeslide/integrations/googleSlides/googleSlides';
import { planGoogleSlidesThreeWaySync } from '../src/domains/nodeslide/integrations/googleSlides/planning';
import type { GoogleSlidesRequest } from '../src/domains/nodeslide/integrations/googleSlides/types';
import {
  type NormalizedPresentationElement,
  type NormalizedPresentationState,
  type PresentationSyncBaseline,
  syncSemanticFingerprint,
} from '../src/domains/nodeslide/integrations/syncContracts';
import { api, internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import {
  type ActionCtx,
  type MutationCtx,
  action,
  internalMutation,
  internalQuery,
  query,
} from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';
import { loadNodeSlideSnapshot } from './lib/nodeslideData';
import { resolveNodeSlideGoogleOAuthConfig } from './lib/nodeslideGoogleOAuth';
import {
  NodeSlideGoogleRuntimeError,
  assertAcceptedInboundGoogleProposal,
  assertGoogleRuntimeStateSize,
  assertGoogleSlidesBatchUpdateResponse,
  assertVerifiedGoogleSlidesConvergence,
  createBlockedGoogleSlidesBootstrapBaseline,
  createExactGoogleSlidesBootstrapBaseline,
  decodeGoogleRuntimeBaseline,
  decodeGoogleRuntimePlan,
  encodeGoogleRuntimeBaseline,
  encodeGoogleRuntimePlan,
  encodeGoogleRuntimeReceipt,
  resolveNodeSlideGoogleAccessToken,
  runtimeError,
} from './lib/nodeslideGoogleSlidesRuntime';
import { nodeslideStableId } from './lib/nodeslideIds';

const PROVIDER = 'google_slides' as const;
const GOOGLE_REQUEST_TIMEOUT_MS = 20_000;
const PRESENTATION_ID_MAX_CHARACTERS = 256;

type RuntimeStatus =
  | 'active'
  | 'planning'
  | 'awaiting_pull_review'
  | 'awaiting_push_review'
  | 'executing'
  | 'verifying'
  | 'conflict'
  | 'error';

interface RuntimeContext {
  snapshot: DeckSnapshot;
  credential: {
    accessTokenCiphertext: string;
    refreshTokenCiphertext?: string;
    accessTokenExpiresAt: number;
    scopes: string[];
    tokenType: string;
    updatedAt: number;
  } | null;
  state: Doc<'nodeslide_google_sync_states'> | null;
  pendingPatch: DeckPatch | null;
}

interface PublicRuntimeState {
  remotePresentationId: string;
  status: RuntimeStatus;
  stateVersion: number;
  baselineRemoteRevision: string;
  pendingDirection?: 'inbound' | 'outbound';
  pendingPlanDigest?: string;
  pendingPatchId?: string;
  pendingPatchStatus?: DeckPatch['status'];
  lastReceiptDigest?: string;
  errorCode?: string;
  errorMessage?: string;
  updatedAt: number;
}

interface AttachResult extends PublicRuntimeState {
  attached: true;
}

interface CreatedPresentationResult extends AttachResult {
  presentationUrl: string;
}

interface PlanResult extends PublicRuntimeState {
  result: 'awaiting_review' | 'conflict' | 'no_change';
  operationCount: number;
}

interface VerificationResult extends PublicRuntimeState {
  verified: true;
  receiptDigest: string;
  writeResponseVerified?: boolean;
}

// biome-ignore lint/suspicious/noExplicitAny: generated self-reference for action/query cycles
const runtimeInternal: any = (internal as any).nodeslideGoogleSlidesRuntime;

export const getState = query({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args): Promise<PublicRuntimeState | null> => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const state = await ctx.db
      .query('nodeslide_google_sync_states')
      .withIndex('by_deck', (index) => index.eq('deckId', deck.id))
      .unique();
    if (!state) return null;
    const pendingPatch = state.pendingPatchId
      ? await ctx.db
          .query('nodeslide_patches')
          .withIndex('by_stable_id', (index) => index.eq('id', state.pendingPatchId as string))
          .unique()
      : null;
    return publicState(state, pendingPatch?.status);
  },
});

export const attachPresentation = action({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    presentationId: v.string(),
  },
  handler: async (ctx, args): Promise<AttachResult> => {
    const presentationId = requirePresentationId(args.presentationId);
    const initial = await readRuntimeContext(ctx, args);
    const adapter = await authorizedAdapter(ctx, args, initial);
    let remote: NormalizedPresentationState;
    try {
      remote = (await adapter.getPresentation(presentationId)).normalized.presentation;
    } catch (error) {
      throw runtimeError(error);
    }
    if (remote.remotePresentationId !== presentationId) {
      throw new NodeSlideGoogleRuntimeError(
        'remote_conflict',
        'Google Slides returned a different presentation than the requested attachment.',
      );
    }
    const revision = requiredRevision(remote);

    try {
      const baseline = createExactGoogleSlidesBootstrapBaseline(initial.snapshot, remote);
      const encoded = encodeGoogleRuntimeBaseline(baseline);
      const state = (await ctx.runMutation(runtimeInternal.attachState, {
        ...args,
        remotePresentationId: presentationId,
        status: 'active',
        baselineJson: encoded.json,
        baselineDigest: encoded.digest,
        baselineRemoteRevision: revision,
      })) as Doc<'nodeslide_google_sync_states'>;
      return { attached: true, ...publicState(state) };
    } catch (error) {
      const failure = runtimeError(error);
      if (failure.code === 'bootstrap_mismatch') {
        const blocked = encodeGoogleRuntimeBaseline(
          createBlockedGoogleSlidesBootstrapBaseline(initial.snapshot, remote),
        );
        await ctx.runMutation(runtimeInternal.attachState, {
          ...args,
          remotePresentationId: presentationId,
          status: 'conflict',
          baselineJson: blocked.json,
          baselineDigest: blocked.digest,
          baselineRemoteRevision: revision,
          errorCode: failure.code,
          errorMessage: failure.message,
        });
      }
      throw failure;
    }
  },
});

export const createPresentation = action({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args): Promise<CreatedPresentationResult> => {
    const initial = await readRuntimeContext(ctx, args);
    if (initial.state) {
      throw new NodeSlideGoogleRuntimeError(
        'invalid_runtime_state',
        'Reset the current Google Slides attachment before creating a new target.',
      );
    }
    const session = await authorizedGoogleSession(ctx, args, initial);
    const presentationId = await createBlankGooglePresentation(
      session.accessToken,
      initial.snapshot.deck.title,
    );
    let remote = (await session.adapter.getPresentation(presentationId)).normalized.presentation;
    let revision = requiredRevision(remote);
    const bootstrapPlaceholders = appCreatedGoogleSlidesBootstrapPlaceholders(remote);
    if (bootstrapPlaceholders.length > 0) {
      const requests = bootstrapPlaceholders.map((element) => ({
        deleteObject: { objectId: element.remoteId },
      })) satisfies GoogleSlidesRequest[];
      await session.adapter.batchUpdate({
        kind: 'google_slides_batch_update',
        provider: 'google_slides',
        presentationId,
        requiredRevisionId: revision,
        requests,
        body: { requests, writeControl: { requiredRevisionId: revision } },
        blocked: false,
        blockedReasons: [],
      });
      remote = (await session.adapter.getPresentation(presentationId)).normalized.presentation;
      revision = requiredRevision(remote);
    }
    const baseline = createAppBlankGoogleSlidesBootstrapBaseline(initial.snapshot, remote);
    const encoded = encodeGoogleRuntimeBaseline(baseline);
    const state = (await ctx.runMutation(runtimeInternal.attachState, {
      ...args,
      remotePresentationId: presentationId,
      status: 'active',
      baselineJson: encoded.json,
      baselineDigest: encoded.digest,
      baselineRemoteRevision: revision,
    })) as Doc<'nodeslide_google_sync_states'>;
    return {
      attached: true,
      presentationUrl: `https://docs.google.com/presentation/d/${presentationId}/edit`,
      ...publicState(state),
    };
  },
});

export const planPull = action({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args): Promise<PlanResult> => {
    const initial = await readRuntimeContext(ctx, args);
    const state = requireRuntimeState(initial.state);
    const claimed = (await ctx.runMutation(runtimeInternal.claimPlanning, {
      ...args,
      expectedStateVersion: state.stateVersion,
    })) as Doc<'nodeslide_google_sync_states'>;
    try {
      const adapter = await authorizedAdapter(ctx, args, initial);
      const remote = (await adapter.getPresentation(state.remotePresentationId)).normalized
        .presentation;
      const planningInput = {
        baseline: decodeGoogleRuntimeBaseline(state.baselineJson, state.baselineDigest),
        local: initial.snapshot,
        remote,
      };
      const plan = createGoogleSlidesInboundExternalPlan(planningInput);
      const encoded = encodeGoogleRuntimePlan({ direction: 'inbound', planningInput, plan });
      if (plan.changeSet.conflicts.length > 0) {
        const conflicted = (await ctx.runMutation(runtimeInternal.recordPlan, {
          ...args,
          expectedStateVersion: claimed.stateVersion,
          status: 'conflict',
          direction: 'inbound',
          planJson: encoded.json,
          planDigest: encoded.digest,
          errorCode: 'remote_conflict',
          errorMessage: `Google Slides pull has ${plan.changeSet.conflicts.length} unresolved conflict${plan.changeSet.conflicts.length === 1 ? '' : 's'}.`,
        })) as Doc<'nodeslide_google_sync_states'>;
        return {
          result: 'conflict',
          operationCount: plan.proposal.operations.length,
          ...publicState(conflicted),
        };
      }
      if (plan.proposal.operations.length === 0) {
        const active = (await ctx.runMutation(runtimeInternal.finishNoChange, {
          ...args,
          expectedStateVersion: claimed.stateVersion,
        })) as Doc<'nodeslide_google_sync_states'>;
        return { result: 'no_change', operationCount: 0, ...publicState(active) };
      }

      const patchId = nodeslideStableId('google_pull', args.deckId, plan.digest);
      const proposal = await ctx.runMutation(api.nodeslide.proposePatch, {
        id: patchId,
        deckId: args.deckId,
        ownerAccessKey: args.ownerAccessKey,
        baseDeckVersion: plan.proposal.baseDeckVersion,
        baseSlideVersions: plan.proposal.baseSlideVersions,
        baseElementVersions: plan.proposal.baseElementVersions,
        scope: plan.proposal.scope,
        operations: plan.proposal.operations,
        summary: `Google Slides pull ${plan.changeSet.remote.versionId} · plan ${plan.digest}`,
      });
      if (proposal.patch.status !== 'ready' && proposal.patch.status !== 'accepted') {
        throw new NodeSlideGoogleRuntimeError(
          'remote_conflict',
          'The Google Slides pull proposal became stale before review.',
        );
      }
      const pending = (await ctx.runMutation(runtimeInternal.recordPlan, {
        ...args,
        expectedStateVersion: claimed.stateVersion,
        status: 'awaiting_pull_review',
        direction: 'inbound',
        planJson: encoded.json,
        planDigest: encoded.digest,
        patchId,
      })) as Doc<'nodeslide_google_sync_states'>;
      return {
        result: 'awaiting_review',
        operationCount: plan.proposal.operations.length,
        ...publicState(pending),
      };
    } catch (error) {
      throw await recordActionFailure(ctx, args, claimed.stateVersion, error);
    }
  },
});

export const finalizePull = action({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    planDigest: v.string(),
  },
  handler: async (ctx, args): Promise<VerificationResult> => {
    const initial = await readRuntimeContext(ctx, args);
    const state = requirePendingState(initial.state, 'inbound', args.planDigest);
    let failureStateVersion = state.stateVersion;
    try {
      const envelope = decodeGoogleRuntimePlan(required(state.pendingPlanJson), args.planDigest);
      const plan = envelope.plan as GoogleSlidesInboundExternalPlanV1;
      const patchId = required(state.pendingPatchId);
      if (!initial.pendingPatch) {
        throw new NodeSlideGoogleRuntimeError(
          'proposal_mismatch',
          'The Google Slides pull proposal is unavailable.',
        );
      }
      assertAcceptedInboundGoogleProposal({
        patch: initial.pendingPatch,
        patchId,
        plan,
        acceptedLocal: initial.snapshot,
      });
      const claimed = (await ctx.runMutation(runtimeInternal.claimPending, {
        ...args,
        expectedStateVersion: state.stateVersion,
        direction: 'inbound',
        nextStatus: 'verifying',
      })) as Doc<'nodeslide_google_sync_states'>;
      failureStateVersion = claimed.stateVersion;
      const adapter = await authorizedAdapter(ctx, args, initial);
      const verifiedRemote = (await adapter.getPresentation(state.remotePresentationId)).normalized
        .presentation;
      assertGoogleSlidesExternalPlanCurrent(plan, {
        ...envelope.planningInput,
        remote: verifiedRemote,
      });
      const receipt = createGoogleSlidesPostAcceptanceReceipt({
        plan,
        planningInput: envelope.planningInput,
        acceptedLocal: initial.snapshot,
        verifiedRemote,
        acceptance: {
          kind: 'nodeslide_patch_accepted',
          externalChangeSetDigest: plan.changeSet.digest,
          acceptedLocalSnapshotDigest: googleSlidesExternalSnapshotDigest(
            'local',
            initial.snapshot,
          ),
        },
      });
      return await finishVerifiedAction(ctx, args, claimed.stateVersion, receipt);
    } catch (error) {
      throw await recordActionFailure(ctx, args, failureStateVersion, error);
    }
  },
});

export const planPush = action({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args): Promise<PlanResult> => {
    const initial = await readRuntimeContext(ctx, args);
    const state = requireRuntimeState(initial.state);
    const claimed = (await ctx.runMutation(runtimeInternal.claimPlanning, {
      ...args,
      expectedStateVersion: state.stateVersion,
    })) as Doc<'nodeslide_google_sync_states'>;
    try {
      const adapter = await authorizedAdapter(ctx, args, initial);
      const remote = (await adapter.getPresentation(state.remotePresentationId)).normalized
        .presentation;
      const planningInput = {
        baseline: decodeGoogleRuntimeBaseline(state.baselineJson, state.baselineDigest),
        local: initial.snapshot,
        remote,
      };
      const preview = planGoogleSlidesThreeWaySync(planningInput);
      if (preview.conflicts.length > 0 || preview.inbound.operations.length > 0) {
        const conflicted = (await ctx.runMutation(runtimeInternal.recordFailure, {
          ...args,
          expectedStateVersion: claimed.stateVersion,
          errorCode: 'remote_conflict',
          errorMessage:
            preview.conflicts.length > 0
              ? `Google Slides push has ${preview.conflicts.length} unresolved conflict${preview.conflicts.length === 1 ? '' : 's'}.`
              : 'Google Slides has inbound changes that must be reviewed before pushing.',
        })) as Doc<'nodeslide_google_sync_states'>;
        return {
          result: 'conflict',
          operationCount: preview.outbound.requests.length,
          ...publicState(conflicted),
        };
      }
      if (preview.outbound.requests.length === 0) {
        const active = (await ctx.runMutation(runtimeInternal.finishNoChange, {
          ...args,
          expectedStateVersion: claimed.stateVersion,
        })) as Doc<'nodeslide_google_sync_states'>;
        return { result: 'no_change', operationCount: 0, ...publicState(active) };
      }
      const revision = requiredRevision(remote);
      const plan = createGoogleSlidesOutboundExternalPlan(planningInput, {
        strategy: 'read_after_write',
        remoteObjectId: remote.remotePresentationId,
        compareAgainstVersionId: revision,
      });
      const encoded = encodeGoogleRuntimePlan({ direction: 'outbound', planningInput, plan });
      const pending = (await ctx.runMutation(runtimeInternal.recordPlan, {
        ...args,
        expectedStateVersion: claimed.stateVersion,
        status: 'awaiting_push_review',
        direction: 'outbound',
        planJson: encoded.json,
        planDigest: encoded.digest,
      })) as Doc<'nodeslide_google_sync_states'>;
      return {
        result: 'awaiting_review',
        operationCount: plan.batchUpdate.requests.length,
        ...publicState(pending),
      };
    } catch (error) {
      throw await recordActionFailure(ctx, args, claimed.stateVersion, error);
    }
  },
});

export const executePush = action({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    planDigest: v.string(),
  },
  handler: async (ctx, args): Promise<VerificationResult> => {
    const initial = await readRuntimeContext(ctx, args);
    const state = requireResumableOutboundState(initial.state, args.planDigest);
    const envelope = decodeGoogleRuntimePlan(required(state.pendingPlanJson), args.planDigest);
    const plan = envelope.plan as GoogleSlidesOutboundExternalPlanV1;
    const dispatchRequired = state.status === 'awaiting_push_review';
    const claimed = dispatchRequired
      ? ((await ctx.runMutation(runtimeInternal.claimPending, {
          ...args,
          expectedStateVersion: state.stateVersion,
          direction: 'outbound',
          nextStatus: 'executing',
        })) as Doc<'nodeslide_google_sync_states'>)
      : state;

    try {
      const current = await readRuntimeContext(ctx, args);
      const adapter = await authorizedAdapter(ctx, args, current);
      const preWriteRemote = (await adapter.getPresentation(state.remotePresentationId)).normalized
        .presentation;
      if (dispatchRequired) {
        assertGoogleSlidesExternalPlanCurrent(plan, {
          ...envelope.planningInput,
          local: current.snapshot,
          remote: preWriteRemote,
        });
      }

      let responseVerified = !dispatchRequired;
      let writeError: unknown;
      if (dispatchRequired) {
        try {
          const response = await adapter.batchUpdate(plan.batchUpdate);
          assertGoogleSlidesBatchUpdateResponse(plan, response);
          responseVerified = true;
        } catch (error) {
          writeError = error;
        }
      } else {
        try {
          assertVerifiedGoogleSlidesConvergence({
            baseline: envelope.planningInput.baseline,
            acceptedLocal: current.snapshot,
            verifiedRemote: preWriteRemote,
            plan,
          });
        } catch {
          throw new NodeSlideGoogleRuntimeError(
            'remote_conflict',
            'The interrupted Google Slides write did not converge. Re-plan before retrying.',
          );
        }
      }
      const verifying =
        claimed.status === 'verifying'
          ? claimed
          : ((await ctx.runMutation(runtimeInternal.markVerifying, {
              ...ownerRuntimeArgs(args),
              expectedStateVersion: claimed.stateVersion,
            })) as Doc<'nodeslide_google_sync_states'>);
      const verifiedRemote = (await adapter.getPresentation(state.remotePresentationId)).normalized
        .presentation;
      try {
        assertVerifiedGoogleSlidesConvergence({
          baseline: envelope.planningInput.baseline,
          acceptedLocal: current.snapshot,
          verifiedRemote,
          plan,
        });
      } catch (verificationError) {
        if (writeError) {
          throw new NodeSlideGoogleRuntimeError(
            'remote_conflict',
            'The Google Slides write outcome is uncertain and did not verify; re-plan before retrying.',
          );
        }
        throw verificationError;
      }
      const receipt = createGoogleSlidesPostAcceptanceReceipt({
        plan,
        planningInput: envelope.planningInput,
        acceptedLocal: current.snapshot,
        verifiedRemote,
        acceptance: {
          kind: 'google_slides_write_verified',
          strategy: 'read_after_write',
          externalChangeSetDigest: plan.changeSet.digest,
          acceptedLocalSnapshotDigest: googleSlidesExternalSnapshotDigest(
            'local',
            current.snapshot,
          ),
          preWriteVersionId: plan.changeSet.remote.versionId,
          verifiedRemoteVersionId: requiredRevision(verifiedRemote),
          verifiedRemoteSnapshotDigest: googleSlidesExternalSnapshotDigest(
            'remote',
            verifiedRemote,
          ),
        },
      });
      const result = await finishVerifiedAction(ctx, args, verifying.stateVersion, receipt);
      return { ...result, writeResponseVerified: responseVerified };
    } catch (error) {
      const latest = (await readRuntimeContext(ctx, args)).state;
      throw await recordActionFailure(
        ctx,
        args,
        latest?.stateVersion ?? claimed.stateVersion,
        error,
      );
    }
  },
});

export const cancelPending = action({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    expectedStateVersion: v.number(),
  },
  handler: async (ctx, args): Promise<PublicRuntimeState & { cancelled: true }> => {
    const initial = await readRuntimeContext(ctx, args);
    const state = requireRuntimeState(initial.state);
    if (
      state.stateVersion !== args.expectedStateVersion ||
      (state.status !== 'awaiting_pull_review' && state.status !== 'awaiting_push_review')
    ) {
      throw new NodeSlideGoogleRuntimeError(
        'invalid_runtime_state',
        'The pending Google Slides review changed; refresh before cancelling it.',
      );
    }
    if (state.status === 'awaiting_pull_review' && initial.pendingPatch?.status === 'accepted') {
      throw new NodeSlideGoogleRuntimeError(
        'invalid_runtime_state',
        'This pull proposal was already accepted. Verify it to advance the exact baseline.',
      );
    }
    if (state.status === 'awaiting_pull_review' && initial.pendingPatch?.status === 'ready') {
      await ctx.runMutation(api.nodeslide.rejectPatch, {
        deckId: args.deckId,
        ownerAccessKey: args.ownerAccessKey,
        patchId: initial.pendingPatch.id,
      });
    }
    const active = (await ctx.runMutation(
      runtimeInternal.cancelPendingState,
      args,
    )) as Doc<'nodeslide_google_sync_states'>;
    return { cancelled: true, ...publicState(active) };
  },
});

export const resetAttachment = action({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    expectedStateVersion: v.number(),
  },
  handler: async (ctx, args): Promise<{ reset: true }> => {
    await ctx.runMutation(runtimeInternal.resetState, args);
    return { reset: true };
  },
});

export const readContextInternal = internalQuery({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    patchId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<RuntimeContext> => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const [snapshot, credential, state, pendingPatch] = await Promise.all([
      loadNodeSlideSnapshot(ctx, deck.id),
      ctx.db
        .query('nodeslide_oauth_credentials')
        .withIndex('by_deck_provider', (index) =>
          index.eq('deckId', deck.id).eq('provider', PROVIDER),
        )
        .unique(),
      ctx.db
        .query('nodeslide_google_sync_states')
        .withIndex('by_deck', (index) => index.eq('deckId', deck.id))
        .unique(),
      args.patchId
        ? ctx.db
            .query('nodeslide_patches')
            .withIndex('by_stable_id', (index) => index.eq('id', args.patchId as string))
            .unique()
        : Promise.resolve(null),
    ]);
    if (!snapshot) throw new Error('NodeSlide deck not found.');
    return {
      snapshot,
      credential:
        credential && credential.revokedAt === undefined
          ? {
              accessTokenCiphertext: credential.accessTokenCiphertext,
              ...(credential.refreshTokenCiphertext
                ? { refreshTokenCiphertext: credential.refreshTokenCiphertext }
                : {}),
              accessTokenExpiresAt: credential.accessTokenExpiresAt,
              scopes: credential.scopes,
              tokenType: credential.tokenType,
              updatedAt: credential.updatedAt,
            }
          : null,
      state,
      pendingPatch: pendingPatch ? (pendingPatch as unknown as DeckPatch) : null,
    };
  },
});

export const storeRefreshedCredential = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    expectedUpdatedAt: v.number(),
    accessTokenCiphertext: v.string(),
    accessTokenExpiresAt: v.number(),
    scopes: v.array(v.string()),
    tokenType: v.string(),
    refreshTokenCiphertext: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const credential = await ctx.db
      .query('nodeslide_oauth_credentials')
      .withIndex('by_deck_provider', (index) =>
        index.eq('deckId', deck.id).eq('provider', PROVIDER),
      )
      .unique();
    if (
      !credential ||
      credential.revokedAt !== undefined ||
      credential.updatedAt !== args.expectedUpdatedAt
    ) {
      return false;
    }
    await ctx.db.patch(credential._id, {
      accessTokenCiphertext: args.accessTokenCiphertext,
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      scopes: args.scopes,
      tokenType: args.tokenType,
      ...(args.refreshTokenCiphertext
        ? { refreshTokenCiphertext: args.refreshTokenCiphertext }
        : {}),
      updatedAt: Math.max(Date.now(), credential.updatedAt + 1),
    });
    return true;
  },
});

export const attachState = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    remotePresentationId: v.string(),
    status: v.union(v.literal('active'), v.literal('conflict')),
    baselineJson: v.string(),
    baselineDigest: v.string(),
    baselineRemoteRevision: v.string(),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Doc<'nodeslide_google_sync_states'>> => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    assertGoogleRuntimeStateSize(args.baselineJson);
    const [existing, claimedRemote] = await Promise.all([
      ctx.db
        .query('nodeslide_google_sync_states')
        .withIndex('by_deck', (index) => index.eq('deckId', deck.id))
        .unique(),
      ctx.db
        .query('nodeslide_google_sync_states')
        .withIndex('by_remote', (index) =>
          index.eq('remotePresentationId', args.remotePresentationId),
        )
        .unique(),
    ]);
    if (claimedRemote && claimedRemote.deckId !== deck.id) {
      throw new Error('Google Slides presentation is already attached to another deck.');
    }
    const now = Date.now();
    const common = {
      remotePresentationId: args.remotePresentationId,
      status: args.status,
      stateVersion: (existing?.stateVersion ?? 0) + 1,
      baselineJson: args.baselineJson,
      baselineDigest: args.baselineDigest,
      baselineRemoteRevision: args.baselineRemoteRevision,
      ...(args.errorCode ? { errorCode: args.errorCode } : {}),
      ...(args.errorMessage ? { errorMessage: args.errorMessage } : {}),
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...common,
        pendingDirection: undefined,
        pendingPlanJson: undefined,
        pendingPlanDigest: undefined,
        pendingPatchId: undefined,
        lastReceiptJson: undefined,
        lastReceiptDigest: undefined,
        errorCode: args.errorCode,
        errorMessage: args.errorMessage,
      });
      const updated = await ctx.db.get(existing._id);
      if (!updated) throw new Error('Google Slides runtime state is unavailable.');
      return updated;
    }
    const row = {
      id: nodeslideStableId('google_sync_state', deck.id),
      deckId: deck.id,
      ...common,
      createdAt: now,
    };
    const id = await ctx.db.insert('nodeslide_google_sync_states', row);
    const inserted = await ctx.db.get(id);
    if (!inserted) throw new Error('Google Slides runtime state is unavailable.');
    return inserted;
  },
});

export const cancelPendingState = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    expectedStateVersion: v.number(),
  },
  handler: async (ctx, args) =>
    await transitionState(ctx, args, ['awaiting_pull_review', 'awaiting_push_review'], 'active', {
      pendingDirection: undefined,
      pendingPlanJson: undefined,
      pendingPlanDigest: undefined,
      pendingPatchId: undefined,
      errorCode: undefined,
      errorMessage: undefined,
    }),
});

export const resetState = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    expectedStateVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const state = await requireStateForMutation(ctx, args);
    assertTransition(state, args.expectedStateVersion, ['conflict', 'error']);
    await ctx.db.delete(state._id);
  },
});

export const claimPlanning = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    expectedStateVersion: v.number(),
  },
  handler: async (ctx, args) =>
    await transitionState(ctx, args, ['active', 'conflict', 'error'], 'planning', {
      pendingDirection: undefined,
      pendingPlanJson: undefined,
      pendingPlanDigest: undefined,
      pendingPatchId: undefined,
      errorCode: undefined,
      errorMessage: undefined,
    }),
});

export const recordPlan = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    expectedStateVersion: v.number(),
    status: v.union(
      v.literal('awaiting_pull_review'),
      v.literal('awaiting_push_review'),
      v.literal('conflict'),
    ),
    direction: v.union(v.literal('inbound'), v.literal('outbound')),
    planJson: v.string(),
    planDigest: v.string(),
    patchId: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const state = await requireStateForMutation(ctx, args);
    assertTransition(state, args.expectedStateVersion, ['planning']);
    assertGoogleRuntimeStateSize(state.baselineJson, args.planJson, state.lastReceiptJson);
    const patch = {
      status: args.status,
      stateVersion: state.stateVersion + 1,
      pendingDirection: args.direction,
      pendingPlanJson: args.planJson,
      pendingPlanDigest: args.planDigest,
      pendingPatchId: args.patchId,
      errorCode: args.errorCode,
      errorMessage: args.errorMessage,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(state._id, patch);
    return { ...state, ...patch };
  },
});

export const finishNoChange = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    expectedStateVersion: v.number(),
  },
  handler: async (ctx, args) =>
    await transitionState(ctx, args, ['planning'], 'active', {
      errorCode: undefined,
      errorMessage: undefined,
    }),
});

export const claimPending = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    expectedStateVersion: v.number(),
    planDigest: v.string(),
    direction: v.union(v.literal('inbound'), v.literal('outbound')),
    nextStatus: v.union(v.literal('executing'), v.literal('verifying')),
  },
  handler: async (ctx, args) => {
    const state = await requireStateForMutation(ctx, args);
    const expectedStatus =
      args.direction === 'inbound' ? 'awaiting_pull_review' : 'awaiting_push_review';
    assertTransition(state, args.expectedStateVersion, [expectedStatus]);
    if (state.pendingDirection !== args.direction || state.pendingPlanDigest !== args.planDigest) {
      throw new Error('Google Slides pending plan changed; re-plan before continuing.');
    }
    const patch = {
      status: args.nextStatus,
      stateVersion: state.stateVersion + 1,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(state._id, patch);
    return { ...state, ...patch };
  },
});

export const markVerifying = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    expectedStateVersion: v.number(),
  },
  handler: async (ctx, args) =>
    await transitionState(ctx, args, ['executing', 'error'], 'verifying', {}),
});

export const finishVerified = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    expectedStateVersion: v.number(),
    baselineJson: v.string(),
    baselineDigest: v.string(),
    baselineRemoteRevision: v.string(),
    receiptJson: v.string(),
    receiptDigest: v.string(),
  },
  handler: async (ctx, args) => {
    const state = await requireStateForMutation(ctx, args);
    assertTransition(state, args.expectedStateVersion, ['verifying']);
    assertGoogleRuntimeStateSize(args.baselineJson, args.receiptJson);
    const patch = {
      status: 'active' as const,
      stateVersion: state.stateVersion + 1,
      baselineJson: args.baselineJson,
      baselineDigest: args.baselineDigest,
      baselineRemoteRevision: args.baselineRemoteRevision,
      pendingDirection: undefined,
      pendingPlanJson: undefined,
      pendingPlanDigest: undefined,
      pendingPatchId: undefined,
      lastReceiptJson: args.receiptJson,
      lastReceiptDigest: args.receiptDigest,
      errorCode: undefined,
      errorMessage: undefined,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(state._id, patch);
    return { ...state, ...patch };
  },
});

export const recordFailure = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    expectedStateVersion: v.number(),
    errorCode: v.string(),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const state = await requireStateForMutation(ctx, args);
    if (state.stateVersion !== args.expectedStateVersion) return state;
    const status = conflictCode(args.errorCode) ? ('conflict' as const) : ('error' as const);
    const patch = {
      status,
      stateVersion: state.stateVersion + 1,
      errorCode: args.errorCode,
      errorMessage: boundedError(args.errorMessage),
      updatedAt: Date.now(),
    };
    await ctx.db.patch(state._id, patch);
    return { ...state, ...patch };
  },
});

async function readRuntimeContext(
  ctx: ActionCtx,
  args: { deckId: string; ownerAccessKey: string },
): Promise<RuntimeContext> {
  const authorizationArgs = {
    ...ownerRuntimeArgs(args),
  };
  const first = (await ctx.runQuery(
    runtimeInternal.readContextInternal,
    authorizationArgs,
  )) as RuntimeContext;
  if (!first.state?.pendingPatchId) return first;
  return (await ctx.runQuery(runtimeInternal.readContextInternal, {
    ...authorizationArgs,
    patchId: first.state.pendingPatchId,
  })) as RuntimeContext;
}

function appCreatedGoogleSlidesBootstrapPlaceholders(
  remote: NormalizedPresentationState,
): NormalizedPresentationElement[] {
  if (remote.slides.length !== 1) return [];
  const elements = remote.slides[0]?.elements ?? [];
  if (elements.length === 0) return [];
  const placeholders = elements.filter(
    (element) =>
      element.writable &&
      (element.kind === 'text' || element.kind === 'shape') &&
      !element.content?.trim() &&
      !element.imageUrl,
  );
  if (placeholders.length !== elements.length) return [];
  return placeholders.map((element) => ({ ...element }));
}

async function authorizedAdapter(
  ctx: ActionCtx,
  args: { deckId: string; ownerAccessKey: string },
  initial: RuntimeContext,
) {
  return (await authorizedGoogleSession(ctx, args, initial)).adapter;
}

async function authorizedGoogleSession(
  ctx: ActionCtx,
  args: { deckId: string; ownerAccessKey: string },
  initial: RuntimeContext,
) {
  const credential = initial.credential;
  if (!credential) {
    throw new NodeSlideGoogleRuntimeError(
      'credential_unavailable',
      'Authorize Google Slides for this deck before continuing.',
    );
  }
  const config = googleRuntimeConfig();
  const resolved = await resolveNodeSlideGoogleAccessToken({
    credential,
    encryptionKey: config.encryptionKey,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    fetch: fetchWithTimeout,
  });
  if (resolved.update) {
    const stored = (await ctx.runMutation(runtimeInternal.storeRefreshedCredential, {
      ...ownerRuntimeArgs(args),
      ...resolved.update,
    })) as boolean;
    if (!stored) {
      throw new NodeSlideGoogleRuntimeError(
        'credential_unavailable',
        'Google Slides authorization changed while refreshing; try again.',
      );
    }
  }
  return {
    accessToken: resolved.accessToken,
    adapter: createGoogleSlidesAdapter({
      fetch: fetchWithTimeout,
      auth: () => ({ Authorization: `Bearer ${resolved.accessToken}` }),
    }),
  };
}

async function finishVerifiedAction(
  ctx: ActionCtx,
  args: { deckId: string; ownerAccessKey: string },
  expectedStateVersion: number,
  receipt: ReturnType<typeof createGoogleSlidesPostAcceptanceReceipt>,
): Promise<VerificationResult> {
  const baseline = encodeGoogleRuntimeBaseline(receipt.advancedBaseline);
  const encodedReceipt = encodeGoogleRuntimeReceipt(receipt);
  assertGoogleRuntimeStateSize(baseline.json, encodedReceipt.json);
  const state = (await ctx.runMutation(runtimeInternal.finishVerified, {
    ...ownerRuntimeArgs(args),
    expectedStateVersion,
    baselineJson: baseline.json,
    baselineDigest: baseline.digest,
    baselineRemoteRevision: requiredRevision(receipt.advancedBaseline.remote),
    receiptJson: encodedReceipt.json,
    receiptDigest: encodedReceipt.digest,
  })) as Doc<'nodeslide_google_sync_states'>;
  return { verified: true, receiptDigest: encodedReceipt.digest, ...publicState(state) };
}

async function recordActionFailure(
  ctx: ActionCtx,
  args: { deckId: string; ownerAccessKey: string },
  expectedStateVersion: number,
  error: unknown,
): Promise<NodeSlideGoogleRuntimeError> {
  const failure = runtimeError(error);
  await ctx.runMutation(runtimeInternal.recordFailure, {
    ...ownerRuntimeArgs(args),
    expectedStateVersion,
    errorCode: failure.code,
    errorMessage: failure.message,
  });
  return failure;
}

function ownerRuntimeArgs(args: { deckId: string; ownerAccessKey: string }) {
  return { deckId: args.deckId, ownerAccessKey: args.ownerAccessKey };
}

async function transitionState(
  ctx: MutationCtx,
  args: { deckId: string; ownerAccessKey: string; expectedStateVersion: number },
  allowed: RuntimeStatus[],
  status: RuntimeStatus,
  extra: Record<string, unknown>,
) {
  const state = await requireStateForMutation(ctx, args);
  assertTransition(state, args.expectedStateVersion, allowed);
  const patch = {
    ...extra,
    status,
    stateVersion: state.stateVersion + 1,
    updatedAt: Date.now(),
  };
  await ctx.db.patch(state._id, patch);
  return { ...state, ...patch };
}

async function requireStateForMutation(
  ctx: MutationCtx,
  args: { deckId: string; ownerAccessKey: string },
): Promise<Doc<'nodeslide_google_sync_states'>> {
  const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
  const state = await ctx.db
    .query('nodeslide_google_sync_states')
    .withIndex('by_deck', (index) => index.eq('deckId', deck.id))
    .unique();
  if (!state) throw new Error('Google Slides is not attached to this deck.');
  return state;
}

function assertTransition(
  state: Doc<'nodeslide_google_sync_states'>,
  expectedVersion: number,
  allowed: RuntimeStatus[],
): void {
  if (state.stateVersion !== expectedVersion || !allowed.includes(state.status)) {
    throw new Error('Google Slides runtime state changed; retry from the latest status.');
  }
}

function requireRuntimeState(
  state: Doc<'nodeslide_google_sync_states'> | null,
): Doc<'nodeslide_google_sync_states'> {
  if (!state) {
    throw new NodeSlideGoogleRuntimeError(
      'invalid_runtime_state',
      'Attach a Google Slides presentation before planning sync.',
    );
  }
  return state;
}

function requirePendingState(
  state: Doc<'nodeslide_google_sync_states'> | null,
  direction: 'inbound' | 'outbound',
  digest: string,
): Doc<'nodeslide_google_sync_states'> {
  const requiredState = requireRuntimeState(state);
  const expectedStatus = direction === 'inbound' ? 'awaiting_pull_review' : 'awaiting_push_review';
  if (
    requiredState.status !== expectedStatus ||
    requiredState.pendingDirection !== direction ||
    requiredState.pendingPlanDigest !== digest
  ) {
    throw new NodeSlideGoogleRuntimeError(
      'invalid_runtime_state',
      'The approved Google Slides plan is no longer pending; re-plan before continuing.',
    );
  }
  return requiredState;
}

function requireResumableOutboundState(
  state: Doc<'nodeslide_google_sync_states'> | null,
  digest: string,
): Doc<'nodeslide_google_sync_states'> {
  const requiredState = requireRuntimeState(state);
  if (
    !['awaiting_push_review', 'executing', 'verifying', 'error'].includes(requiredState.status) ||
    requiredState.pendingDirection !== 'outbound' ||
    requiredState.pendingPlanDigest !== digest
  ) {
    throw new NodeSlideGoogleRuntimeError(
      'invalid_runtime_state',
      'The approved Google Slides push is no longer resumable; re-plan before continuing.',
    );
  }
  return requiredState;
}

function publicState(
  state: Doc<'nodeslide_google_sync_states'>,
  pendingPatchStatus?: DeckPatch['status'],
): PublicRuntimeState {
  return {
    remotePresentationId: state.remotePresentationId,
    status: state.status,
    stateVersion: state.stateVersion,
    baselineRemoteRevision: state.baselineRemoteRevision,
    ...(state.pendingDirection ? { pendingDirection: state.pendingDirection } : {}),
    ...(state.pendingPlanDigest ? { pendingPlanDigest: state.pendingPlanDigest } : {}),
    ...(state.pendingPatchId ? { pendingPatchId: state.pendingPatchId } : {}),
    ...(pendingPatchStatus ? { pendingPatchStatus } : {}),
    ...(state.lastReceiptDigest ? { lastReceiptDigest: state.lastReceiptDigest } : {}),
    ...(state.errorCode ? { errorCode: state.errorCode } : {}),
    ...(state.errorMessage ? { errorMessage: state.errorMessage } : {}),
    updatedAt: state.updatedAt,
  };
}

function googleRuntimeConfig() {
  return resolveNodeSlideGoogleOAuthConfig({
    clientId: process.env['GOOGLE_CLIENT_ID'],
    clientSecret: process.env['GOOGLE_CLIENT_SECRET'],
    encryptionKey: process.env['NODESLIDE_OAUTH_TOKEN_ENCRYPTION_KEY'],
    redirectUri: process.env['NODESLIDE_GOOGLE_REDIRECT_URI'],
    allowedOrigins: process.env['NODESLIDE_APP_ORIGINS'],
  });
}

async function fetchWithTimeout(input: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function createBlankGooglePresentation(accessToken: string, title: string): Promise<string> {
  const response = await fetchWithTimeout('https://slides.googleapis.com/v1/presentations', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: title.trim() || 'NodeSlide presentation' }),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw new NodeSlideGoogleRuntimeError(
      response.status === 401 || response.status === 403
        ? 'reauthorization_required'
        : 'remote_error',
      response.status === 401 || response.status === 403
        ? 'Google Slides could not create an app-authorized presentation. Reconnect and try again.'
        : `Google Slides presentation creation failed with HTTP ${response.status}.`,
    );
  }
  const presentationId =
    typeof body === 'object' && body !== null && 'presentationId' in body
      ? (body as { presentationId?: unknown }).presentationId
      : undefined;
  if (typeof presentationId !== 'string') {
    throw new NodeSlideGoogleRuntimeError(
      'remote_error',
      'Google Slides created a presentation without returning its ID.',
    );
  }
  return requirePresentationId(presentationId);
}

function createAppBlankGoogleSlidesBootstrapBaseline(
  local: DeckSnapshot,
  remote: NormalizedPresentationState,
): PresentationSyncBaseline {
  const localSlide = local.deck.slideOrder
    .map((slideId) => local.slides.find((slide) => slide.id === slideId))
    .find((slide) => slide !== undefined);
  const remoteSlide = remote.slides[0];
  if (
    !localSlide ||
    remote.slides.length !== 1 ||
    !remoteSlide ||
    remoteSlide.elements.length !== 0
  ) {
    throw new NodeSlideGoogleRuntimeError(
      'bootstrap_mismatch',
      'The app-created Google Slides presentation was not the expected one-slide blank target.',
    );
  }

  const { notes: _localNotes, ...localSlideWithoutNotes } = localSlide;
  const baselineLocal: DeckSnapshot = {
    ...structuredClone(local),
    deck: {
      ...structuredClone(local.deck),
      title: remote.title,
      slideOrder: [localSlide.id],
    },
    slides: [
      {
        ...structuredClone(localSlideWithoutNotes),
        title: remoteSlide.title,
        background: remoteSlide.background,
        elementOrder: [],
        ...(remoteSlide.notes !== undefined ? { notes: remoteSlide.notes } : {}),
      },
    ],
    elements: [],
  };
  return {
    local: baselineLocal,
    remote: structuredClone(remote),
    mapping: {
      provider: 'google_slides',
      localDeckId: local.deck.id,
      remotePresentationId: remote.remotePresentationId,
      links: [
        {
          kind: 'deck',
          localId: local.deck.id,
          remoteId: remote.remotePresentationId,
          semanticFingerprint: syncSemanticFingerprint({
            kind: 'app_created_blank_deck',
            title: remote.title,
          }),
        },
        {
          kind: 'slide',
          localId: localSlide.id,
          remoteId: remoteSlide.remoteId,
          semanticFingerprint: syncSemanticFingerprint({
            kind: 'app_created_blank_slide',
            title: remoteSlide.title,
            background: remoteSlide.background,
          }),
        },
      ],
    },
  };
}

function requirePresentationId(value: string): string {
  const id = value.trim();
  const hasControlCharacter = Array.from(id).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f);
  });
  if (!id || id.length > PRESENTATION_ID_MAX_CHARACTERS || hasControlCharacter) {
    throw new Error('Google Slides presentation ID is invalid.');
  }
  return id;
}

function requiredRevision(remote: NormalizedPresentationState): string {
  const revision = remote.revisionId?.trim();
  if (!revision) {
    throw new NodeSlideGoogleRuntimeError(
      'remote_conflict',
      'Google Slides did not provide an editable revision for this presentation.',
    );
  }
  return revision;
}

function required(value: string | undefined): string {
  if (!value) throw new Error('Google Slides runtime state is incomplete.');
  return value;
}

function conflictCode(code: string): boolean {
  return (
    code === 'bootstrap_mismatch' ||
    code === 'proposal_mismatch' ||
    code === 'remote_conflict' ||
    code === 'verification_failed'
  );
}

function boundedError(message: string): string {
  return message.replace(/\s+/gu, ' ').trim().slice(0, 320) || 'Google Slides operation failed.';
}
