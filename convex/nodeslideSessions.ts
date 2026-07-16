import { v } from 'convex/values';
import {
  NODESLIDE_CAPABILITY_DIGEST_VERSION,
  NODESLIDE_DURABLE_JOB_STATUSES,
  NODESLIDE_DURABLE_SESSION_MAX_EVENTS,
  NODESLIDE_REQUEST_BINDING_VERSION,
  type NodeSlideCapabilityDigestMetadata,
  type NodeSlideDurableJobEvent,
  type NodeSlideDurableSessionState,
  type NodeSlideRequestBinding,
  nodeSlideDurableDigest,
  sameNodeSlideRequestBinding,
} from '../shared/nodeslideDurableSession';
import type { Doc } from './_generated/dataModel';
import {
  type MutationCtx,
  type QueryCtx,
  internalMutation,
  internalQuery,
} from './_generated/server';
import {
  type NodeSlideDurableSessionCommand,
  NodeSlideDurableSessionError,
  assertNodeSlideDurableSessionState,
  createNodeSlideDurableSession,
  reduceNodeSlideDurableSession,
} from './lib/nodeslideDurableSessionState';
import {
  NODESLIDE_JOB_JOURNAL_VERSION,
  type NodeSlideJobJournal,
  type NodeSlideJobJournalBinding,
  type NodeSlideModelJournalInput,
  type NodeSlideWebJournalInput,
  appendNodeSlideModelJournal,
  appendNodeSlideWebJournal,
  createNodeSlideJobJournal,
} from './lib/nodeslideJobJournal';

export const NODESLIDE_DURABLE_SESSION_MAX_TRANSITIONS = NODESLIDE_DURABLE_SESSION_MAX_EVENTS;
export const NODESLIDE_DURABLE_MODEL_RESULT_MAX_BYTES = 200_000 as const;

const NODESLIDE_MODEL_RESULT_REPLAY_VERSION = 'nodeslide.model-result-replay/v1' as const;
const NODESLIDE_MODEL_OUTPUT_DIGEST_VERSION = 'nodeslide.model-output/v1' as const;
const NODESLIDE_MODEL_RESULT_MAX_JSON_DEPTH = 64;
const MODEL_RESULT_DISPOSITIONS = new Set([
  'settled',
  'unreconciled',
  'released',
  'denied',
  'replayed',
  'accounting_error',
]);
const MODEL_RESULT_FAILURE_CODES = new Set([
  'pricing_unknown',
  'budget_denied',
  'ambiguous_provider_call',
  'idempotent_replay',
  'accounting_failed',
]);
const MODEL_RESULT_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

const requestBindingValidator = v.object({
  schemaVersion: v.literal(NODESLIDE_REQUEST_BINDING_VERSION),
  requestDigest: v.string(),
  capabilityDigest: v.string(),
});

const capabilityMetadataValidator = v.object({
  schemaVersion: v.literal(NODESLIDE_CAPABILITY_DIGEST_VERSION),
  capabilityDigest: v.string(),
  provider: v.optional(v.string()),
  model: v.optional(v.string()),
  scopes: v.array(v.string()),
  egress: v.union(
    v.literal('none'),
    v.literal('model'),
    v.literal('web'),
    v.literal('model_and_web'),
  ),
  hasSecret: v.boolean(),
  hasConsent: v.boolean(),
  attachmentCount: v.number(),
  consentDigest: v.optional(v.string()),
  attachmentsDigest: v.optional(v.string()),
});

const jobStatusValidator = v.union(
  ...NODESLIDE_DURABLE_JOB_STATUSES.map((status) => v.literal(status)),
);

const leaseRequestValidator = v.object({
  leaseId: v.string(),
  workerId: v.string(),
  issuedAt: v.number(),
  expiresAt: v.number(),
});

const sessionCommandValidator = v.union(
  v.object({
    type: v.literal('enqueue'),
    expectedStateVersion: v.number(),
    requestBinding: requestBindingValidator,
    jobId: v.string(),
    maxAttempts: v.optional(v.number()),
  }),
  v.object({
    type: v.literal('claim'),
    expectedStateVersion: v.number(),
    requestBinding: requestBindingValidator,
    jobId: v.string(),
    lease: leaseRequestValidator,
  }),
  v.object({
    type: v.literal('resume'),
    expectedStateVersion: v.number(),
    requestBinding: requestBindingValidator,
    jobId: v.string(),
    lease: leaseRequestValidator,
  }),
  v.object({
    type: v.literal('retry'),
    expectedStateVersion: v.number(),
    requestBinding: requestBindingValidator,
    jobId: v.string(),
  }),
  v.object({
    type: v.literal('transition'),
    expectedStateVersion: v.number(),
    requestBinding: requestBindingValidator,
    jobId: v.string(),
    toStatus: jobStatusValidator,
    leaseId: v.optional(v.string()),
    reason: v.optional(v.string()),
  }),
  v.object({
    type: v.literal('rotate_egress'),
    expectedStateVersion: v.number(),
    requestBinding: requestBindingValidator,
    reason: v.optional(v.string()),
  }),
);

const journalBindingValidator = v.object({
  schemaVersion: v.literal(NODESLIDE_REQUEST_BINDING_VERSION),
  sessionId: v.string(),
  jobId: v.string(),
  requestDigest: v.string(),
  capabilityDigest: v.string(),
  egressEpoch: v.number(),
  attempt: v.number(),
});

const journalEntryValidator = v.union(
  v.object({
    kind: v.literal('model'),
    binding: journalBindingValidator,
    entry: v.object({
      id: v.string(),
      provider: v.string(),
      model: v.string(),
      operation: v.string(),
      inputDigest: v.string(),
      outputDigest: v.string(),
      inputTokens: v.optional(v.number()),
      outputTokens: v.optional(v.number()),
      createdAt: v.number(),
    }),
    result: v.optional(v.any()),
  }),
  v.object({
    kind: v.literal('web'),
    binding: journalBindingValidator,
    entry: v.object({
      id: v.string(),
      provider: v.string(),
      operation: v.string(),
      queryDigest: v.string(),
      urlDigest: v.string(),
      resultDigest: v.string(),
      resultCount: v.number(),
      createdAt: v.number(),
    }),
  }),
);

type SessionRow = Doc<'nodeslide_durable_sessions'>;
type TransitionRow = Doc<'nodeslide_durable_session_events'>;
type JournalRow = Doc<'nodeslide_durable_job_journal_entries'>;
type ModelResultReplayRow = Doc<'nodeslide_durable_model_result_replays'>;
type ReadCtx = Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>;

interface PreparedModelResultReplay {
  readonly callIdDigest: string;
  readonly outputDigest: string;
  readonly payloadJson: string;
  readonly payloadBytes: number;
  readonly computedOutputDigest: string;
}

type PersistedCommand =
  | Omit<Extract<NodeSlideDurableSessionCommand, { type: 'enqueue' }>, 'now'>
  | Omit<Extract<NodeSlideDurableSessionCommand, { type: 'claim' }>, 'now'>
  | Omit<Extract<NodeSlideDurableSessionCommand, { type: 'resume' }>, 'now'>
  | Omit<Extract<NodeSlideDurableSessionCommand, { type: 'retry' }>, 'now'>
  | Omit<Extract<NodeSlideDurableSessionCommand, { type: 'transition' }>, 'now'>
  | {
      readonly type: 'rotate_egress';
      readonly expectedStateVersion: number;
      readonly requestBinding: NodeSlideRequestBinding;
      readonly reason?: string;
    };

export type NodeSlideSessionPersistenceErrorCode =
  | 'session_not_found'
  | 'idempotency_conflict'
  | 'integrity_failure'
  | 'model_result_too_large'
  | 'transition_capacity_exceeded';

export class NodeSlideSessionPersistenceError extends Error {
  constructor(
    readonly code: NodeSlideSessionPersistenceErrorCode,
    message: string,
  ) {
    super(`NodeSlide durable session persistence ${code}: ${message}`);
    this.name = 'NodeSlideSessionPersistenceError';
  }
}

/**
 * Creates exactly one canonical session row. `request` is used only to derive
 * its digest binding and is deliberately never persisted.
 */
export const create = internalMutation({
  args: {
    sessionId: v.string(),
    request: v.any(),
    capability: capabilityMetadataValidator,
  },
  handler: async (ctx, args) => {
    validateCapabilityMetadata(args.capability);
    const sessionId = requiredKey(args.sessionId, 'sessionId');
    const now = Date.now();
    const state = createNodeSlideDurableSession({
      sessionId,
      request: args.request,
      capability: args.capability,
      now,
    });
    const existing = await findSession(ctx, sessionId);
    if (existing) {
      if (
        !sameNodeSlideRequestBinding(existing.requestBinding, state.requestBinding) ||
        nodeSlideDurableDigest(existing.capability) !== nodeSlideDurableDigest(args.capability)
      ) {
        throw new NodeSlideSessionPersistenceError(
          'idempotency_conflict',
          'session id is already bound to different request or capability digests',
        );
      }
      const restored = await loadSessionState(ctx, existing);
      return { replayed: true, session: presentSession(existing, restored) };
    }

    await ctx.db.insert('nodeslide_durable_sessions', {
      id: sessionId,
      schemaVersion: state.schemaVersion,
      requestBinding: state.requestBinding,
      requestDigest: state.requestBinding.requestDigest,
      capabilityDigest: state.requestBinding.capabilityDigest,
      capability: args.capability,
      stateVersion: state.stateVersion,
      egressEpoch: state.egressEpoch,
      activeJobId: state.activeJobId,
      jobs: state.jobs,
      eventSequence: state.eventSequence,
      transitionSequence: 0,
      stateDigest: nodeSlideDurableDigest(state),
      createdAt: now,
      updatedAt: now,
    });
    const created = await requireSession(ctx, sessionId);
    return { replayed: false, session: presentSession(created, state) };
  },
});

/** Applies one CAS-bound state command and records one immutable transition. */
export const applyCommand = internalMutation({
  args: { sessionId: v.string(), commandId: v.string(), command: sessionCommandValidator },
  handler: async (ctx, args) => {
    const sessionId = requiredKey(args.sessionId, 'sessionId');
    const commandId = requiredKey(args.commandId, 'commandId');
    const commandKey = opaqueKey('command', sessionId, commandId);
    const command = args.command as PersistedCommand;
    const commandDigest = nodeSlideDurableDigest({
      version: 'nodeslide.session-command/v2',
      sessionId,
      command,
    });
    const row = await requireSession(ctx, sessionId);
    const replay = await findTransitionByCommand(ctx, sessionId, commandKey);
    if (replay) {
      if (replay.commandDigest !== commandDigest) {
        throw new NodeSlideSessionPersistenceError(
          'idempotency_conflict',
          'command id is already bound to a different canonical command',
        );
      }
      const restored = await loadSessionState(ctx, row);
      return {
        replayed: true,
        appliedStateVersion: replay.stateVersion,
        session: presentSession(row, restored),
        transition: presentTransition(replay),
      };
    }
    if (row.transitionSequence >= NODESLIDE_DURABLE_SESSION_MAX_TRANSITIONS) {
      throw new NodeSlideSessionPersistenceError(
        'transition_capacity_exceeded',
        `session transition journal is capped at ${NODESLIDE_DURABLE_SESSION_MAX_TRANSITIONS}`,
      );
    }

    const state = await loadSessionState(ctx, row);
    assertBinding(state.requestBinding, command.requestBinding);
    const now = Date.now();
    const next = reduceNodeSlideDurableSession(state, reducerCommand(command, now));
    const durableEvent =
      next.eventSequence === state.eventSequence + 1 ? next.events.at(-1) : undefined;
    const commandJobId = jobIdFromCommand(command);
    if (
      next.stateVersion !== state.stateVersion + 1 ||
      next.eventSequence < state.eventSequence ||
      next.eventSequence > state.eventSequence + 1
    ) {
      integrityFailure('a command produced an invalid state/event increment');
    }

    const transitionSequence = row.transitionSequence + 1;
    const core = {
      version: 'nodeslide.session-transition/v2',
      sessionId,
      transitionSequence,
      commandId: commandKey,
      commandDigest,
      commandKind: command.type,
      stateVersion: next.stateVersion,
      eventSequence: next.eventSequence,
      egressEpoch: next.egressEpoch,
      requestBinding: next.requestBinding,
      ...(commandJobId !== undefined ? { jobId: commandJobId } : {}),
      ...(durableEvent ? { event: durableEvent } : {}),
      ...(row.lastTransitionDigest ? { previousTransitionDigest: row.lastTransitionDigest } : {}),
      occurredAt: now,
    };
    const transitionDigest = nodeSlideDurableDigest(core);
    await ctx.db.insert('nodeslide_durable_session_events', {
      sessionId,
      transitionSequence,
      commandId: commandKey,
      commandDigest,
      commandKind: command.type,
      stateVersion: next.stateVersion,
      eventSequence: next.eventSequence,
      egressEpoch: next.egressEpoch,
      requestBinding: next.requestBinding,
      ...(commandJobId !== undefined ? { jobId: commandJobId } : {}),
      ...(durableEvent ? { event: durableEvent } : {}),
      ...(row.lastTransitionDigest ? { previousTransitionDigest: row.lastTransitionDigest } : {}),
      transitionDigest,
      occurredAt: now,
    });
    await ctx.db.patch(row._id, {
      stateVersion: next.stateVersion,
      egressEpoch: next.egressEpoch,
      activeJobId: next.activeJobId,
      jobs: next.jobs,
      eventSequence: next.eventSequence,
      transitionSequence,
      lastTransitionDigest: transitionDigest,
      stateDigest: nodeSlideDurableDigest(next),
      updatedAt: now,
    });
    const persisted = await requireSession(ctx, sessionId);
    return {
      replayed: false,
      appliedStateVersion: next.stateVersion,
      session: presentSession(persisted, next),
      transition: presentTransition(await requireTransition(ctx, sessionId, transitionSequence)),
    };
  },
});

/**
 * Appends a model/web receipt only while the exact job attempt owns a live,
 * non-expired lease in the current egress epoch.
 */
export const appendJournal = internalMutation({
  args: {
    sessionId: v.string(),
    expectedStateVersion: v.number(),
    leaseId: v.string(),
    journal: journalEntryValidator,
  },
  handler: async (ctx, args) => {
    const sessionId = requiredKey(args.sessionId, 'sessionId');
    const leaseId = requiredKey(args.leaseId, 'leaseId');
    const journalCommand = args.journal;
    const binding = journalCommand.binding as NodeSlideJobJournalBinding;
    if (binding.sessionId !== sessionId) {
      throw new NodeSlideDurableSessionError(
        'request_binding_mismatch',
        'journal session id does not match the canonical session',
      );
    }
    const canonicalEntry = canonicalJournalInput(sessionId, journalCommand.entry);
    const modelResultReplay =
      journalCommand.kind === 'model' && journalCommand.result !== undefined
        ? prepareModelResultReplay({
            sessionId,
            callId: journalCommand.entry.id,
            callIdDigest: canonicalEntry.id,
            outputDigest: journalCommand.entry.outputDigest,
            result: journalCommand.result,
          })
        : null;
    const entryInputDigest = nodeSlideDurableDigest({
      version: NODESLIDE_JOB_JOURNAL_VERSION,
      kind: journalCommand.kind,
      binding,
      entry: canonicalEntry,
    });
    const existing = await findJournalEntry(ctx, binding, canonicalEntry.id);
    if (existing) {
      if (existing.entryInputDigest !== entryInputDigest) {
        throw new NodeSlideSessionPersistenceError(
          'idempotency_conflict',
          'journal entry id is already bound to different safe metadata',
        );
      }
      if (modelResultReplay) {
        const existingReplay = await findModelResultReplay(
          ctx,
          binding,
          modelResultReplay.callIdDigest,
        );
        if (
          !existingReplay ||
          existingReplay.payloadJson !== modelResultReplay.payloadJson ||
          existingReplay.payloadBytes !== modelResultReplay.payloadBytes ||
          existingReplay.outputDigest !== modelResultReplay.outputDigest
        ) {
          throw new NodeSlideSessionPersistenceError(
            'idempotency_conflict',
            'model call is already bound to a different replay payload',
          );
        }
        assertModelResultOutputDigest(modelResultReplay, modelResultReplay.outputDigest);
      }
      const restored = await loadJournal(ctx, binding);
      return { replayed: true, journal: presentJournal(restored) };
    }

    if (modelResultReplay) {
      assertModelResultOutputDigest(modelResultReplay, modelResultReplay.outputDigest);
    }

    const row = await requireSession(ctx, sessionId);
    const state = await loadSessionState(ctx, row);
    if (state.stateVersion !== args.expectedStateVersion) {
      throw new NodeSlideDurableSessionError(
        'state_version_mismatch',
        `expected ${args.expectedStateVersion}, found ${state.stateVersion}`,
      );
    }
    assertJournalLease(state, binding, leaseId, Date.now());
    const current = await loadJournal(ctx, binding);
    const next =
      journalCommand.kind === 'model'
        ? appendNodeSlideModelJournal(current, {
            binding,
            entry: canonicalEntry as NodeSlideModelJournalInput,
          })
        : appendNodeSlideWebJournal(current, {
            binding,
            entry: canonicalEntry as NodeSlideWebJournalInput,
          });
    const appended = [...next.modelEntries, ...next.webEntries].find(
      (entry) => entry.sequence === current.nextSequence,
    );
    if (!appended) integrityFailure('journal append did not produce one new entry');
    await ctx.db.insert('nodeslide_durable_job_journal_entries', {
      sessionId: binding.sessionId,
      jobId: binding.jobId,
      egressEpoch: binding.egressEpoch,
      attempt: binding.attempt,
      sequence: appended.sequence,
      entryId: appended.id,
      kind: appended.kind,
      binding,
      requestDigest: binding.requestDigest,
      capabilityDigest: binding.capabilityDigest,
      provider: appended.provider,
      ...(appended.kind === 'model' ? { model: appended.model } : {}),
      operation: appended.operation,
      ...(appended.kind === 'model'
        ? {
            inputDigest: appended.inputDigest,
            outputDigest: appended.outputDigest,
            ...(appended.inputTokens !== undefined ? { inputTokens: appended.inputTokens } : {}),
            ...(appended.outputTokens !== undefined ? { outputTokens: appended.outputTokens } : {}),
          }
        : {
            queryDigest: appended.queryDigest,
            urlDigest: appended.urlDigest,
            resultDigest: appended.resultDigest,
            resultCount: appended.resultCount,
          }),
      entryInputDigest,
      ...(current.lastEntryDigest ? { previousEntryDigest: current.lastEntryDigest } : {}),
      entryDigest: appended.entryDigest,
      journalDigest: next.journalDigest,
      createdAt: appended.createdAt,
    });
    if (modelResultReplay) {
      await ctx.db.insert('nodeslide_durable_model_result_replays', {
        schemaVersion: NODESLIDE_MODEL_RESULT_REPLAY_VERSION,
        sessionId: binding.sessionId,
        jobId: binding.jobId,
        callIdDigest: modelResultReplay.callIdDigest,
        requestDigest: binding.requestDigest,
        capabilityDigest: binding.capabilityDigest,
        egressEpoch: binding.egressEpoch,
        attempt: binding.attempt,
        binding,
        outputDigest: modelResultReplay.outputDigest,
        payloadJson: modelResultReplay.payloadJson,
        payloadBytes: modelResultReplay.payloadBytes,
        createdAt: appended.createdAt,
      });
    }
    return { replayed: false, journal: presentJournal(next) };
  },
});

export const get = internalQuery({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const row = await findSession(ctx, args.sessionId);
    if (!row) return null;
    return presentSession(row, await loadSessionState(ctx, row));
  },
});

export const getEvents = internalQuery({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const row = await findSession(ctx, args.sessionId);
    if (!row) return null;
    await loadSessionState(ctx, row);
    return (await listTransitions(ctx, row.id)).map(presentTransition);
  },
});

export const getJournal = internalQuery({
  args: { binding: journalBindingValidator },
  handler: async (ctx, args) => {
    const row = await findSession(ctx, args.binding.sessionId);
    if (!row) return null;
    assertBinding(row.requestBinding, args.binding);
    return presentJournal(await loadJournal(ctx, args.binding as NodeSlideJobJournalBinding));
  },
});

/** Returns a provider result envelope only for the complete historical binding. */
export const getModelResultReplay = internalQuery({
  args: { binding: journalBindingValidator, callId: v.string() },
  handler: async (ctx, args) => {
    const binding = args.binding as NodeSlideJobJournalBinding;
    const callId = requiredKey(args.callId, 'model call id');
    const callIdDigest = canonicalJournalEntryId(binding.sessionId, callId);
    const replay = await findModelResultReplay(ctx, binding, callIdDigest);
    if (!replay) return null;

    assertModelResultReplayBinding(replay, binding, callIdDigest);
    const journal = await loadJournal(ctx, binding);
    const receipt = journal.modelEntries.find((entry) => entry.id === callIdDigest);
    if (!receipt || receipt.outputDigest !== replay.outputDigest) {
      integrityFailure('model result replay is not bound to its journal receipt');
    }
    return readModelResultReplay(replay, receipt.outputDigest, callId);
  },
});

function reducerCommand(command: PersistedCommand, now: number): NodeSlideDurableSessionCommand {
  switch (command.type) {
    case 'retry':
    case 'enqueue':
      return { ...command, now } as NodeSlideDurableSessionCommand;
    case 'claim':
    case 'resume':
      return {
        ...command,
        lease: {
          ...command.lease,
          leaseId: opaqueKey('lease', command.jobId, command.lease.leaseId),
          workerId: opaqueKey('worker', command.jobId, command.lease.workerId),
        },
        now,
      };
    case 'transition':
      return {
        ...command,
        ...(command.leaseId ? { leaseId: opaqueKey('lease', command.jobId, command.leaseId) } : {}),
        ...(command.reason ? { reason: safeReason(command.reason) } : {}),
        now,
      };
    case 'rotate_egress': {
      const { requestBinding: _requestBinding, ...rotate } = command;
      return {
        ...rotate,
        ...(rotate.reason ? { reason: safeReason(rotate.reason) } : {}),
        now,
      };
    }
  }
}

async function loadSessionState(
  ctx: ReadCtx,
  row: SessionRow,
): Promise<NodeSlideDurableSessionState> {
  const transitions = await listTransitions(ctx, row.id);
  validateCapabilityMetadata(row.capability);
  if (
    row.requestDigest !== row.requestBinding.requestDigest ||
    row.capabilityDigest !== row.requestBinding.capabilityDigest ||
    row.capability.capabilityDigest !== row.capabilityDigest ||
    row.stateVersion !== row.transitionSequence
  ) {
    integrityFailure('canonical binding or state counters do not agree');
  }
  if (transitions.length !== row.transitionSequence) {
    integrityFailure('transition count does not match the canonical session row');
  }
  let previousTransitionDigest: string | undefined;
  const events: NodeSlideDurableJobEvent[] = [];
  const commandKeys = new Set<string>();
  for (const [index, transition] of transitions.entries()) {
    if (
      transition.transitionSequence !== index + 1 ||
      transition.stateVersion !== transition.transitionSequence
    ) {
      integrityFailure('transition sequence is not contiguous');
    }
    if (commandKeys.has(transition.commandId)) {
      integrityFailure('transition command key is not unique');
    }
    commandKeys.add(transition.commandId);
    if (transition.previousTransitionDigest !== previousTransitionDigest) {
      integrityFailure('transition chain predecessor does not match');
    }
    if (transition.transitionDigest !== nodeSlideDurableDigest(transitionCore(transition))) {
      integrityFailure('transition digest does not verify');
    }
    if (!sameNodeSlideRequestBinding(row.requestBinding, transition.requestBinding)) {
      integrityFailure('transition request binding differs from the canonical session');
    }
    if (transition.event) {
      if (
        transition.event.stateVersion !== transition.stateVersion ||
        transition.event.sequence !== transition.eventSequence
      ) {
        integrityFailure('durable event does not bind to its transition');
      }
      events.push(transition.event);
    }
    if (transition.eventSequence !== events.length) {
      integrityFailure('transition event sequence does not match persisted events');
    }
    previousTransitionDigest = transition.transitionDigest;
  }
  if (row.lastTransitionDigest !== previousTransitionDigest) {
    integrityFailure('canonical transition head does not match the append-only journal');
  }
  if (transitions.at(-1)?.egressEpoch !== row.egressEpoch && transitions.length > 0) {
    integrityFailure('canonical egress epoch does not match the transition head');
  }
  const state: NodeSlideDurableSessionState = {
    schemaVersion: row.schemaVersion,
    sessionId: row.id,
    requestBinding: row.requestBinding,
    stateVersion: row.stateVersion,
    egressEpoch: row.egressEpoch,
    activeJobId: row.activeJobId,
    jobs: row.jobs,
    eventSequence: row.eventSequence,
    events,
  };
  assertNodeSlideDurableSessionState(state);
  if (nodeSlideDurableDigest(state) !== row.stateDigest) {
    integrityFailure('canonical session state digest does not verify');
  }
  return state;
}

async function loadJournal(
  ctx: ReadCtx,
  binding: NodeSlideJobJournalBinding,
): Promise<NodeSlideJobJournal> {
  const rows = await listJournalRows(ctx, binding);
  let journal = createNodeSlideJobJournal(binding);
  for (const [index, row] of rows.entries()) {
    if (
      row.sequence !== index + 1 ||
      (row.previousEntryDigest ?? null) !== journal.lastEntryDigest
    ) {
      integrityFailure('job journal sequence or predecessor is invalid');
    }
    const input = journalInputFromRow(row);
    if (
      row.entryInputDigest !==
      nodeSlideDurableDigest({
        version: NODESLIDE_JOB_JOURNAL_VERSION,
        kind: row.kind,
        binding,
        entry: input,
      })
    ) {
      integrityFailure('job journal input digest does not verify');
    }
    journal =
      row.kind === 'model'
        ? appendNodeSlideModelJournal(journal, {
            binding,
            entry: input as NodeSlideModelJournalInput,
          })
        : appendNodeSlideWebJournal(journal, {
            binding,
            entry: input as NodeSlideWebJournalInput,
          });
    const appended = [...journal.modelEntries, ...journal.webEntries].find(
      (entry) => entry.sequence === row.sequence,
    );
    if (
      !appended ||
      appended.entryDigest !== row.entryDigest ||
      journal.journalDigest !== row.journalDigest
    ) {
      integrityFailure('job journal entry or head digest does not verify');
    }
  }
  return journal;
}

function assertJournalLease(
  state: NodeSlideDurableSessionState,
  binding: NodeSlideJobJournalBinding,
  leaseId: string,
  now: number,
): void {
  assertBinding(state.requestBinding, binding);
  if (binding.egressEpoch !== state.egressEpoch) {
    throw new NodeSlideDurableSessionError(
      'egress_epoch_mismatch',
      'journal writer is fenced by the current egress epoch',
    );
  }
  const job = state.jobs[binding.jobId];
  if (!job || state.activeJobId !== binding.jobId || job.status !== 'running') {
    throw new NodeSlideDurableSessionError(
      'lease_mismatch',
      'journal writes require the active running job',
    );
  }
  if (
    !job.lease ||
    job.lease.leaseId !== opaqueKey('lease', binding.jobId, leaseId) ||
    job.lease.attempt !== binding.attempt ||
    job.attempt !== binding.attempt ||
    job.lease.egressEpoch !== binding.egressEpoch ||
    state.egressEpoch !== binding.egressEpoch ||
    job.lease.expiresAt <= now
  ) {
    throw new NodeSlideDurableSessionError(
      job.lease?.egressEpoch !== state.egressEpoch ? 'egress_epoch_mismatch' : 'lease_mismatch',
      'journal writer is fenced by lease, attempt, expiry, or egress epoch',
    );
  }
}

function presentSession(row: SessionRow, state: NodeSlideDurableSessionState) {
  return {
    schemaVersion: state.schemaVersion,
    sessionId: state.sessionId,
    requestBinding: state.requestBinding,
    capability: row.capability,
    stateVersion: state.stateVersion,
    egressEpoch: state.egressEpoch,
    activeJobId: state.activeJobId,
    jobs: Object.values(state.jobs)
      .sort(
        (left, right) => left.createdAt - right.createdAt || left.jobId.localeCompare(right.jobId),
      )
      .map((job) => ({
        jobId: job.jobId,
        requestBinding: job.requestBinding,
        status: job.status,
        attempt: job.attempt,
        retryCount: job.retryCount,
        resumeCount: job.resumeCount,
        maxAttempts: job.maxAttempts,
        hasReason: job.reason !== undefined,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        ...(job.completedAt !== undefined ? { completedAt: job.completedAt } : {}),
        ...(job.lease
          ? {
              lease: {
                present: true,
                attempt: job.lease.attempt,
                egressEpoch: job.lease.egressEpoch,
                issuedAt: job.lease.issuedAt,
                expiresAt: job.lease.expiresAt,
              },
            }
          : {}),
      })),
    eventSequence: state.eventSequence,
    transitionSequence: row.transitionSequence,
    integrity: {
      stateDigest: row.stateDigest,
      ...(row.lastTransitionDigest ? { transitionDigest: row.lastTransitionDigest } : {}),
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function presentTransition(row: TransitionRow) {
  const event = row.event
    ? (() => {
        const { leaseId: _leaseId, reason: _reason, ...safe } = row.event;
        return {
          ...safe,
          leaseBound: _leaseId !== undefined,
          hasReason: _reason !== undefined,
        };
      })()
    : undefined;
  return {
    transitionSequence: row.transitionSequence,
    commandDigest: row.commandDigest,
    commandKind: row.commandKind,
    stateVersion: row.stateVersion,
    eventSequence: row.eventSequence,
    egressEpoch: row.egressEpoch,
    requestBinding: row.requestBinding,
    ...(row.jobId ? { jobId: row.jobId } : {}),
    ...(event ? { event } : {}),
    transitionDigest: row.transitionDigest,
    occurredAt: row.occurredAt,
  };
}

function presentJournal(journal: NodeSlideJobJournal) {
  return {
    schemaVersion: journal.schemaVersion,
    binding: journal.binding,
    nextSequence: journal.nextSequence,
    modelEntries: journal.modelEntries.map((entry) => {
      const { id, binding: _binding, ...safe } = entry;
      return { ...safe, entryIdDigest: id };
    }),
    webEntries: journal.webEntries.map((entry) => {
      const { id, binding: _binding, ...safe } = entry;
      return { ...safe, entryIdDigest: id };
    }),
    journalDigest: journal.journalDigest,
  };
}

function journalInputFromRow(
  row: JournalRow,
): NodeSlideModelJournalInput | NodeSlideWebJournalInput {
  if (row.kind === 'model') {
    if (!row.model || !row.inputDigest || !row.outputDigest) {
      integrityFailure('model journal row is incomplete');
    }
    return {
      id: row.entryId,
      provider: row.provider,
      model: row.model,
      operation: row.operation,
      inputDigest: row.inputDigest,
      outputDigest: row.outputDigest,
      ...(row.inputTokens !== undefined ? { inputTokens: row.inputTokens } : {}),
      ...(row.outputTokens !== undefined ? { outputTokens: row.outputTokens } : {}),
      createdAt: row.createdAt,
    };
  }
  if (!row.queryDigest || !row.urlDigest || !row.resultDigest || row.resultCount === undefined) {
    integrityFailure('web journal row is incomplete');
  }
  return {
    id: row.entryId,
    provider: row.provider,
    operation: row.operation,
    queryDigest: row.queryDigest,
    urlDigest: row.urlDigest,
    resultDigest: row.resultDigest,
    resultCount: row.resultCount,
    createdAt: row.createdAt,
  };
}

function transitionCore(row: TransitionRow) {
  return {
    version: 'nodeslide.session-transition/v2',
    sessionId: row.sessionId,
    transitionSequence: row.transitionSequence,
    commandId: row.commandId,
    commandDigest: row.commandDigest,
    commandKind: row.commandKind,
    stateVersion: row.stateVersion,
    eventSequence: row.eventSequence,
    egressEpoch: row.egressEpoch,
    requestBinding: row.requestBinding,
    ...(row.jobId ? { jobId: row.jobId } : {}),
    ...(row.event ? { event: row.event } : {}),
    ...(row.previousTransitionDigest
      ? { previousTransitionDigest: row.previousTransitionDigest }
      : {}),
    occurredAt: row.occurredAt,
  };
}

function jobIdFromCommand(command: PersistedCommand): string | undefined {
  return 'jobId' in command ? command.jobId : undefined;
}

function prepareModelResultReplay(args: {
  sessionId: string;
  callId: string;
  callIdDigest: string;
  outputDigest: string;
  result: unknown;
}): PreparedModelResultReplay {
  const callId = requiredKey(args.callId, 'model call id');
  if (args.callIdDigest !== canonicalJournalEntryId(args.sessionId, callId)) {
    integrityFailure('model result call id does not match its journal receipt');
  }
  const canonical = canonicalModelResultEnvelope(args.result, callId);
  return {
    callIdDigest: args.callIdDigest,
    outputDigest: args.outputDigest,
    payloadJson: canonical.payloadJson,
    payloadBytes: canonical.payloadBytes,
    computedOutputDigest: canonical.computedOutputDigest,
  };
}

function canonicalModelResultEnvelope(result: unknown, callId: string) {
  assertModelResultEnvelope(result, callId);
  const payload = canonicalJsonValue(result, new Set<object>(), 0);
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadJson).byteLength;
  if (payloadBytes > NODESLIDE_DURABLE_MODEL_RESULT_MAX_BYTES) {
    throw new NodeSlideSessionPersistenceError(
      'model_result_too_large',
      `model result replay payload exceeds ${NODESLIDE_DURABLE_MODEL_RESULT_MAX_BYTES} bytes`,
    );
  }
  return {
    payload,
    payloadJson,
    payloadBytes,
    computedOutputDigest: nodeSlideDurableDigest({
      schemaVersion: NODESLIDE_MODEL_OUTPUT_DIGEST_VERSION,
      result: payload,
    }),
  };
}

function assertModelResultOutputDigest(
  replay: PreparedModelResultReplay,
  outputDigest: string,
): void {
  if (replay.computedOutputDigest !== outputDigest) {
    integrityFailure('model journal output digest does not bind the replay payload');
  }
}

function readModelResultReplay(
  row: ModelResultReplayRow,
  outputDigest: string,
  callId: string,
): unknown {
  const storedBytes = new TextEncoder().encode(row.payloadJson).byteLength;
  if (
    !Number.isSafeInteger(row.payloadBytes) ||
    row.payloadBytes < 0 ||
    row.payloadBytes !== storedBytes ||
    storedBytes > NODESLIDE_DURABLE_MODEL_RESULT_MAX_BYTES
  ) {
    integrityFailure('model result replay payload size does not verify');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payloadJson) as unknown;
  } catch {
    integrityFailure('model result replay payload is not valid JSON');
  }
  const canonical = canonicalModelResultEnvelope(parsed, callId);
  if (
    canonical.payloadJson !== row.payloadJson ||
    canonical.payloadBytes !== row.payloadBytes ||
    canonical.computedOutputDigest !== row.outputDigest ||
    row.outputDigest !== outputDigest
  ) {
    integrityFailure('model result replay payload digest does not verify');
  }
  return canonical.payload;
}

function assertModelResultReplayBinding(
  row: ModelResultReplayRow,
  binding: NodeSlideJobJournalBinding,
  callIdDigest: string,
): void {
  if (
    row.schemaVersion !== NODESLIDE_MODEL_RESULT_REPLAY_VERSION ||
    row.sessionId !== binding.sessionId ||
    row.jobId !== binding.jobId ||
    row.callIdDigest !== callIdDigest ||
    row.requestDigest !== binding.requestDigest ||
    row.capabilityDigest !== binding.capabilityDigest ||
    row.egressEpoch !== binding.egressEpoch ||
    row.attempt !== binding.attempt ||
    !sameJournalBinding(row.binding, binding)
  ) {
    integrityFailure('model result replay binding does not verify');
  }
}

function sameJournalBinding(
  left: NodeSlideJobJournalBinding,
  right: NodeSlideJobJournalBinding,
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.sessionId === right.sessionId &&
    left.jobId === right.jobId &&
    left.requestDigest === right.requestDigest &&
    left.capabilityDigest === right.capabilityDigest &&
    left.egressEpoch === right.egressEpoch &&
    left.attempt === right.attempt
  );
}

function assertModelResultEnvelope(value: unknown, callId: string): void {
  const envelope = jsonRecord(value, 'model result envelope');
  const accounting = jsonRecord(envelope['accounting'], 'model result accounting');
  assertOnlyKeys(accounting, ['budgetId', 'callId', 'disposition', 'ledger'], 'accounting');
  assertBoundedString(accounting['budgetId'], 'accounting budget id', 512);
  assertBoundedString(accounting['callId'], 'accounting call id', 256);
  if (accounting['callId'] !== callId) {
    integrityFailure('provider result accounting call id does not match the journal call');
  }
  if (
    typeof accounting['disposition'] !== 'string' ||
    !MODEL_RESULT_DISPOSITIONS.has(accounting['disposition'])
  ) {
    integrityFailure('model result accounting disposition is invalid');
  }
  if (accounting['ledger'] !== undefined) assertModelResultLedger(accounting['ledger']);

  if (envelope['ok'] === true) {
    assertOnlyKeys(envelope, ['ok', 'value', 'telemetry', 'accounting'], 'successful result');
    if (!Object.hasOwn(envelope, 'value') || !Object.hasOwn(envelope, 'telemetry')) {
      integrityFailure('successful model result envelope is incomplete');
    }
    assertModelResultTelemetry(envelope['telemetry']);
    return;
  }
  if (envelope['ok'] !== false) integrityFailure('model result envelope status is invalid');
  assertOnlyKeys(envelope, ['ok', 'reason', 'code', 'telemetry', 'accounting'], 'failed result');
  assertBoundedString(envelope['reason'], 'model result reason', 4_000);
  if (
    envelope['code'] !== undefined &&
    (typeof envelope['code'] !== 'string' || !MODEL_RESULT_FAILURE_CODES.has(envelope['code']))
  ) {
    integrityFailure('model result failure code is invalid');
  }
  if (envelope['telemetry'] !== undefined) assertModelResultTelemetry(envelope['telemetry']);
}

function assertModelResultTelemetry(value: unknown): void {
  const telemetry = jsonRecord(value, 'model result telemetry');
  assertOnlyKeys(
    telemetry,
    [
      'provider',
      'model',
      'reasoningEffort',
      'costMicroUsd',
      'inputTokens',
      'outputTokens',
      'attempts',
    ],
    'telemetry',
  );
  assertBoundedString(telemetry['provider'], 'telemetry provider', 256);
  assertBoundedString(telemetry['model'], 'telemetry model', 256);
  assertNonnegativeInteger(telemetry['costMicroUsd'], 'telemetry cost');
  assertNonnegativeInteger(telemetry['inputTokens'], 'telemetry input tokens');
  assertNonnegativeInteger(telemetry['outputTokens'], 'telemetry output tokens');
  if (
    telemetry['reasoningEffort'] !== undefined &&
    (typeof telemetry['reasoningEffort'] !== 'string' ||
      !MODEL_RESULT_REASONING_EFFORTS.has(telemetry['reasoningEffort']))
  ) {
    integrityFailure('telemetry reasoning effort is invalid');
  }
  if (telemetry['attempts'] === undefined) return;
  if (!Array.isArray(telemetry['attempts']) || telemetry['attempts'].length > 2) {
    integrityFailure('telemetry attempts are invalid');
  }
  for (const value of telemetry['attempts']) {
    const attempt = jsonRecord(value, 'model result telemetry attempt');
    assertOnlyKeys(
      attempt,
      ['attempt', 'attempted', 'settled', 'ambiguous', 'unreconciled', 'elapsedMs'],
      'telemetry attempt',
    );
    if (attempt['attempt'] !== 'initial' && attempt['attempt'] !== 'repair') {
      integrityFailure('telemetry attempt kind is invalid');
    }
    for (const field of ['attempted', 'settled', 'ambiguous', 'unreconciled'] as const) {
      if (typeof attempt[field] !== 'boolean') {
        integrityFailure(`telemetry attempt ${field} is invalid`);
      }
    }
    assertNonnegativeInteger(attempt['elapsedMs'], 'telemetry attempt elapsed time');
  }
}

function assertModelResultLedger(value: unknown): void {
  const ledger = jsonRecord(value, 'model result ledger');
  assertOnlyKeys(ledger, ['budget', 'call'], 'ledger');
  const budget = jsonRecord(ledger['budget'], 'model result budget');
  assertOnlyKeys(
    budget,
    [
      'id',
      'status',
      'revision',
      'stateDigest',
      'actualMicroUsd',
      'reservedMicroUsd',
      'unreconciledMicroUsd',
    ],
    'ledger budget',
  );
  assertBoundedString(budget['id'], 'ledger budget id', 512);
  if (budget['status'] !== 'open' && budget['status'] !== 'finalized') {
    integrityFailure('ledger budget status is invalid');
  }
  assertNonnegativeInteger(budget['revision'], 'ledger budget revision');
  assertBoundedString(budget['stateDigest'], 'ledger budget state digest', 256);
  assertNonnegativeInteger(budget['actualMicroUsd'], 'ledger actual cost');
  assertNonnegativeInteger(budget['reservedMicroUsd'], 'ledger reserved cost');
  assertNonnegativeInteger(budget['unreconciledMicroUsd'], 'ledger unreconciled cost');

  if (ledger['call'] === undefined) return;
  const call = jsonRecord(ledger['call'], 'model result ledger call');
  assertOnlyKeys(
    call,
    ['callId', 'status', 'quoteMicroUsd', 'providerSafeOutputTokenCeiling', 'providerTimeoutMs'],
    'ledger call',
  );
  assertBoundedString(call['callId'], 'ledger call id', 256);
  if (!['reserved', 'unreconciled', 'settled', 'released'].includes(String(call['status']))) {
    integrityFailure('ledger call status is invalid');
  }
  assertNonnegativeInteger(call['quoteMicroUsd'], 'ledger call quote');
  assertNonnegativeInteger(call['providerSafeOutputTokenCeiling'], 'ledger output ceiling');
  assertNonnegativeInteger(call['providerTimeoutMs'], 'ledger timeout');
}

function canonicalJsonValue(value: unknown, active: Set<object>, depth: number): unknown {
  if (depth > NODESLIDE_MODEL_RESULT_MAX_JSON_DEPTH) {
    integrityFailure('model result JSON is nested too deeply');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) integrityFailure('model result JSON number is not finite');
    return value;
  }
  if (typeof value !== 'object') {
    integrityFailure('model result payload must contain only JSON values');
  }
  if (active.has(value)) integrityFailure('model result JSON must not be cyclic');
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) {
        integrityFailure('model result JSON arrays must be dense');
      }
      return value.map((child) => canonicalJsonValue(child, active, depth + 1));
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      integrityFailure('model result JSON objects must be plain');
    }
    if (
      Object.getOwnPropertySymbols(value).length > 0 ||
      Object.getOwnPropertyNames(value).length !== Object.keys(value).length
    ) {
      integrityFailure('model result JSON object properties are invalid');
    }
    const canonical: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value).sort()) {
      canonical[key] = canonicalJsonValue(
        (value as Record<string, unknown>)[key],
        active,
        depth + 1,
      );
    }
    return canonical;
  } finally {
    active.delete(value);
  }
}

function jsonRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    integrityFailure(`${field} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    integrityFailure(`${field} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    integrityFailure(`${field} contains non-result material`);
  }
}

function assertBoundedString(value: unknown, field: string, max: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    integrityFailure(`${field} is invalid`);
  }
}

function assertNonnegativeInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    integrityFailure(`${field} is invalid`);
  }
}

function canonicalJournalInput<T extends { id: string }>(sessionId: string, entry: T): T {
  return {
    ...entry,
    id: canonicalJournalEntryId(sessionId, entry.id),
  };
}

function canonicalJournalEntryId(sessionId: string, entryId: string): string {
  return opaqueKey('journal-entry', sessionId, requiredKey(entryId, 'journal entry id'));
}

function safeReason(reason: string): string {
  return `reason:${nodeSlideDurableDigest(requiredKey(reason, 'reason', 600))}`;
}

function opaqueKey(kind: string, scope: string, value: string): string {
  return nodeSlideDurableDigest({
    version: 'nodeslide.opaque-key/v2',
    kind,
    scope,
    value: requiredKey(value, kind),
  });
}

function assertBinding(expected: NodeSlideRequestBinding, actual: NodeSlideRequestBinding): void {
  if (!sameNodeSlideRequestBinding(expected, actual)) {
    throw new NodeSlideDurableSessionError(
      'request_binding_mismatch',
      'request and capability digests are immutable for this session',
    );
  }
}

function validateCapabilityMetadata(capability: NodeSlideCapabilityDigestMetadata): void {
  assertDigest(capability.capabilityDigest, 'capabilityDigest');
  if (
    capability.scopes.length > 64 ||
    new Set(capability.scopes).size !== capability.scopes.length
  ) {
    integrityFailure('capability scopes must be unique and bounded');
  }
  for (const scope of capability.scopes) requiredKey(scope, 'scope', 200);
  if (
    !Number.isSafeInteger(capability.attachmentCount) ||
    capability.attachmentCount < 0 ||
    capability.attachmentCount > 256
  ) {
    integrityFailure('capability attachment count is invalid');
  }
  if (capability.hasConsent !== (capability.consentDigest !== undefined)) {
    integrityFailure('consent presence must match its digest descriptor');
  }
  if (capability.attachmentCount > 0 !== (capability.attachmentsDigest !== undefined)) {
    integrityFailure('attachment count must match its digest descriptor');
  }
  if (capability.consentDigest) assertDigest(capability.consentDigest, 'consentDigest');
  if (capability.attachmentsDigest) assertDigest(capability.attachmentsDigest, 'attachmentsDigest');
}

async function findSession(ctx: ReadCtx, sessionId: string): Promise<SessionRow | null> {
  return await ctx.db
    .query('nodeslide_durable_sessions')
    .withIndex('by_stable_id', (index) => index.eq('id', sessionId))
    .unique();
}

async function requireSession(ctx: ReadCtx, sessionId: string): Promise<SessionRow> {
  const row = await findSession(ctx, sessionId);
  if (!row) {
    throw new NodeSlideSessionPersistenceError('session_not_found', 'session does not exist');
  }
  return row;
}

async function listTransitions(ctx: ReadCtx, sessionId: string): Promise<TransitionRow[]> {
  return await ctx.db
    .query('nodeslide_durable_session_events')
    .withIndex('by_session_sequence', (index) => index.eq('sessionId', sessionId))
    .order('asc')
    .collect();
}

async function findTransitionByCommand(
  ctx: ReadCtx,
  sessionId: string,
  commandId: string,
): Promise<TransitionRow | null> {
  return await ctx.db
    .query('nodeslide_durable_session_events')
    .withIndex('by_session_command', (index) =>
      index.eq('sessionId', sessionId).eq('commandId', commandId),
    )
    .unique();
}

async function requireTransition(
  ctx: ReadCtx,
  sessionId: string,
  sequence: number,
): Promise<TransitionRow> {
  const row = await ctx.db
    .query('nodeslide_durable_session_events')
    .withIndex('by_session_sequence', (index) =>
      index.eq('sessionId', sessionId).eq('transitionSequence', sequence),
    )
    .unique();
  if (!row) integrityFailure('persisted transition cannot be reloaded');
  return row;
}

async function listJournalRows(
  ctx: ReadCtx,
  binding: NodeSlideJobJournalBinding,
): Promise<JournalRow[]> {
  return await ctx.db
    .query('nodeslide_durable_job_journal_entries')
    .withIndex('by_binding_sequence', (index) =>
      index
        .eq('sessionId', binding.sessionId)
        .eq('jobId', binding.jobId)
        .eq('egressEpoch', binding.egressEpoch)
        .eq('attempt', binding.attempt),
    )
    .order('asc')
    .collect();
}

async function findJournalEntry(
  ctx: ReadCtx,
  binding: NodeSlideJobJournalBinding,
  entryId: string,
): Promise<JournalRow | null> {
  return await ctx.db
    .query('nodeslide_durable_job_journal_entries')
    .withIndex('by_binding_entry', (index) =>
      index
        .eq('sessionId', binding.sessionId)
        .eq('jobId', binding.jobId)
        .eq('egressEpoch', binding.egressEpoch)
        .eq('attempt', binding.attempt)
        .eq('entryId', entryId),
    )
    .unique();
}

async function findModelResultReplay(
  ctx: ReadCtx,
  binding: NodeSlideJobJournalBinding,
  callIdDigest: string,
): Promise<ModelResultReplayRow | null> {
  return await ctx.db
    .query('nodeslide_durable_model_result_replays')
    .withIndex('by_exact_binding', (index) =>
      index
        .eq('sessionId', binding.sessionId)
        .eq('jobId', binding.jobId)
        .eq('callIdDigest', callIdDigest)
        .eq('requestDigest', binding.requestDigest)
        .eq('capabilityDigest', binding.capabilityDigest)
        .eq('egressEpoch', binding.egressEpoch)
        .eq('attempt', binding.attempt),
    )
    .unique();
}

function requiredKey(value: string, field: string, max = 256): string {
  const clean = value.replace(/\s+/gu, ' ').trim();
  if (!clean || clean.length > max) integrityFailure(`${field} is invalid`);
  return clean;
}

function assertDigest(value: string, field: string): void {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) integrityFailure(`${field} is invalid`);
}

function integrityFailure(message: string): never {
  throw new NodeSlideSessionPersistenceError('integrity_failure', message);
}
