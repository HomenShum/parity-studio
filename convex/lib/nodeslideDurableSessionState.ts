import {
  NODESLIDE_DURABLE_JOB_STATUSES,
  NODESLIDE_DURABLE_SESSION_MAX_EVENTS,
  NODESLIDE_DURABLE_SESSION_VERSION,
  type NodeSlideDurableJobEvent,
  type NodeSlideDurableJobEventKind,
  type NodeSlideDurableJobState,
  type NodeSlideDurableSessionState,
  type NodeSlideJobLease,
  type NodeSlideRequestBinding,
  boundedNodeSlideReason,
  createNodeSlideRequestBinding,
  nodeSlideDurableDigest,
  sameNodeSlideRequestBinding,
} from '../../shared/nodeslideDurableSession';

export const NODESLIDE_DURABLE_SESSION_MAX_ATTEMPTS = 3 as const;
const ACTIVE_JOB_STATUSES = ['queued', 'running', 'retrying', 'paused'] as const;

export type NodeSlideDurableSessionErrorCode =
  | 'invalid_state'
  | 'state_version_mismatch'
  | 'request_binding_mismatch'
  | 'active_job_conflict'
  | 'invalid_transition'
  | 'lease_mismatch'
  | 'egress_epoch_mismatch'
  | 'event_capacity_exceeded';

export class NodeSlideDurableSessionError extends Error {
  constructor(
    readonly code: NodeSlideDurableSessionErrorCode,
    message: string,
  ) {
    super(`NodeSlide durable session ${code}: ${message}`);
    this.name = 'NodeSlideDurableSessionError';
  }
}

type LeaseRequest = Pick<NodeSlideJobLease, 'leaseId' | 'workerId' | 'issuedAt' | 'expiresAt'>;

export type NodeSlideDurableSessionCommand =
  | {
      readonly type: 'enqueue';
      readonly expectedStateVersion: number;
      readonly jobId: string;
      readonly requestBinding: NodeSlideRequestBinding;
      readonly now: number;
      readonly maxAttempts?: number;
    }
  | {
      readonly type: 'claim';
      readonly expectedStateVersion: number;
      readonly jobId: string;
      readonly requestBinding: NodeSlideRequestBinding;
      readonly lease: LeaseRequest;
      readonly now: number;
    }
  | {
      readonly type: 'resume';
      readonly expectedStateVersion: number;
      readonly jobId: string;
      readonly requestBinding: NodeSlideRequestBinding;
      readonly lease: LeaseRequest;
      readonly now: number;
    }
  | {
      readonly type: 'retry';
      readonly expectedStateVersion: number;
      readonly jobId: string;
      readonly requestBinding: NodeSlideRequestBinding;
      readonly now: number;
    }
  | {
      readonly type: 'transition';
      readonly expectedStateVersion: number;
      readonly jobId: string;
      readonly requestBinding: NodeSlideRequestBinding;
      readonly toStatus: (typeof NODESLIDE_DURABLE_JOB_STATUSES)[number];
      readonly now: number;
      readonly leaseId?: string;
      readonly reason?: string;
    }
  | {
      readonly type: 'rotate_egress';
      readonly expectedStateVersion: number;
      readonly now: number;
      readonly reason?: string;
    };

export function createNodeSlideDurableSession(args: {
  readonly sessionId: string;
  readonly request: unknown;
  readonly capability: { readonly capabilityDigest: string };
  readonly now: number;
  readonly egressEpoch?: number;
}): NodeSlideDurableSessionState {
  const requestBinding = createNodeSlideRequestBinding(args.request, args.capability);
  assertFiniteTime(args.now);
  const egressEpoch = args.egressEpoch ?? 0;
  assertNonnegativeInteger('egressEpoch', egressEpoch);
  return {
    schemaVersion: NODESLIDE_DURABLE_SESSION_VERSION,
    sessionId: requiredKey('sessionId', args.sessionId),
    requestBinding,
    stateVersion: 0,
    egressEpoch,
    activeJobId: null,
    jobs: {},
    eventSequence: 0,
    events: [],
  };
}

export function reduceNodeSlideDurableSession(
  state: NodeSlideDurableSessionState,
  command: NodeSlideDurableSessionCommand,
): NodeSlideDurableSessionState {
  assertNodeSlideDurableSessionState(state);
  if (state.stateVersion !== command.expectedStateVersion) {
    throw new NodeSlideDurableSessionError(
      'state_version_mismatch',
      `expected ${command.expectedStateVersion}, found ${state.stateVersion}`,
    );
  }
  assertFiniteTime(command.now);
  switch (command.type) {
    case 'enqueue':
      return enqueue(state, command);
    case 'claim':
      return claim(state, command);
    case 'resume':
      return resume(state, command);
    case 'retry':
      return retry(state, command);
    case 'transition':
      return transition(state, command);
    case 'rotate_egress':
      return rotateEgress(state, command);
  }
}

export function claimNodeSlideDurableJob(
  state: NodeSlideDurableSessionState,
  args: Omit<
    Extract<NodeSlideDurableSessionCommand, { type: 'claim' }>,
    'expectedStateVersion' | 'type'
  >,
): NodeSlideDurableSessionState {
  return reduceNodeSlideDurableSession(state, {
    ...args,
    type: 'claim',
    expectedStateVersion: state.stateVersion,
  });
}

export function retryNodeSlideDurableJob(
  state: NodeSlideDurableSessionState,
  args: Omit<
    Extract<NodeSlideDurableSessionCommand, { type: 'retry' }>,
    'expectedStateVersion' | 'type'
  >,
): NodeSlideDurableSessionState {
  return reduceNodeSlideDurableSession(state, {
    ...args,
    type: 'retry',
    expectedStateVersion: state.stateVersion,
  });
}

export function resumeNodeSlideDurableJob(
  state: NodeSlideDurableSessionState,
  args: Omit<
    Extract<NodeSlideDurableSessionCommand, { type: 'resume' }>,
    'expectedStateVersion' | 'type'
  >,
): NodeSlideDurableSessionState {
  return reduceNodeSlideDurableSession(state, {
    ...args,
    type: 'resume',
    expectedStateVersion: state.stateVersion,
  });
}

export function transitionNodeSlideDurableJob(
  state: NodeSlideDurableSessionState,
  args: Omit<
    Extract<NodeSlideDurableSessionCommand, { type: 'transition' }>,
    'expectedStateVersion' | 'type'
  >,
): NodeSlideDurableSessionState {
  return reduceNodeSlideDurableSession(state, {
    ...args,
    type: 'transition',
    expectedStateVersion: state.stateVersion,
  });
}

export function rotateNodeSlideEgressEpoch(
  state: NodeSlideDurableSessionState,
  nowOrReason: number | string = state.stateVersion,
  reason?: string,
): NodeSlideDurableSessionState {
  const now = typeof nowOrReason === 'number' ? nowOrReason : state.stateVersion;
  const actualReason = typeof nowOrReason === 'string' ? nowOrReason : reason;
  return reduceNodeSlideDurableSession(state, {
    type: 'rotate_egress',
    expectedStateVersion: state.stateVersion,
    now,
    ...(actualReason !== undefined ? { reason: actualReason } : {}),
  });
}

export function assertNodeSlideDurableSessionState(state: NodeSlideDurableSessionState): void {
  if (state.schemaVersion !== NODESLIDE_DURABLE_SESSION_VERSION) invalid('schema version');
  requiredKey('sessionId', state.sessionId);
  assertNonnegativeInteger('stateVersion', state.stateVersion);
  assertNonnegativeInteger('egressEpoch', state.egressEpoch);
  assertNonnegativeInteger('eventSequence', state.eventSequence);
  if (state.events.length > NODESLIDE_DURABLE_SESSION_MAX_EVENTS) invalid('event capacity');
  if (state.eventSequence !== state.events.length) invalid('event sequence');
  if (state.events.some((event, index) => event.sequence !== index + 1)) invalid('event ordering');
  let previousEventDigest: string | null = null;
  let previousEventStateVersion = 0;
  for (const event of state.events) {
    if (event.schemaVersion !== NODESLIDE_DURABLE_SESSION_VERSION) invalid('event schema version');
    if (!sameNodeSlideRequestBinding(event.requestBinding, state.requestBinding)) {
      invalid('event request binding');
    }
    if (!state.jobs[event.jobId]) invalid('event job reference');
    if (
      event.stateVersion <= previousEventStateVersion ||
      event.stateVersion > state.stateVersion
    ) {
      invalid('event state version');
    }
    const { eventDigest: _eventDigest, ...eventData } = event;
    void _eventDigest;
    if (event.eventDigest !== nodeSlideDurableDigest({ previousEventDigest, event: eventData })) {
      invalid('event digest');
    }
    previousEventDigest = event.eventDigest;
    previousEventStateVersion = event.stateVersion;
  }
  if (state.activeJobId !== null && state.jobs[state.activeJobId] === undefined) {
    invalid('active job reference');
  }
  if (
    state.activeJobId !== null &&
    !ACTIVE_JOB_STATUSES.includes(
      state.jobs[state.activeJobId]?.status as (typeof ACTIVE_JOB_STATUSES)[number],
    )
  ) {
    invalid('active job status');
  }
  for (const job of Object.values(state.jobs)) {
    if (!sameNodeSlideRequestBinding(job.requestBinding, state.requestBinding)) {
      invalid('job request binding');
    }
    if (!NODESLIDE_DURABLE_JOB_STATUSES.includes(job.status)) invalid('job status');
    assertNonnegativeInteger('job attempt', job.attempt);
    assertNonnegativeInteger('job retryCount', job.retryCount);
    assertNonnegativeInteger('job resumeCount', job.resumeCount);
    assertNonnegativeInteger('job maxAttempts', job.maxAttempts);
    if (job.lease && job.lease.attempt !== job.attempt) invalid('lease attempt');
  }
}

function enqueue(
  state: NodeSlideDurableSessionState,
  command: Extract<NodeSlideDurableSessionCommand, { type: 'enqueue' }>,
): NodeSlideDurableSessionState {
  assertSessionBinding(state, command.requestBinding);
  if (state.activeJobId !== null) {
    throw new NodeSlideDurableSessionError(
      'active_job_conflict',
      'the active-job slot is occupied',
    );
  }
  if (state.jobs[command.jobId]) invalid('job id is already present');
  const maxAttempts = command.maxAttempts ?? NODESLIDE_DURABLE_SESSION_MAX_ATTEMPTS;
  assertPositiveInteger('maxAttempts', maxAttempts);
  const job: NodeSlideDurableJobState = {
    jobId: requiredKey('jobId', command.jobId),
    requestBinding: command.requestBinding,
    status: 'queued',
    attempt: 0,
    retryCount: 0,
    resumeCount: 0,
    createdAt: command.now,
    updatedAt: command.now,
    maxAttempts,
  };
  return appendEvent(state, job, 'enqueued', null, command.now, undefined, job.jobId);
}

function claim(
  state: NodeSlideDurableSessionState,
  command: Extract<NodeSlideDurableSessionCommand, { type: 'claim' }>,
): NodeSlideDurableSessionState {
  const job = getBoundJob(state, command.jobId, command.requestBinding);
  if (state.activeJobId !== job.jobId) activeConflict();
  if (job.status !== 'queued' && job.status !== 'retrying')
    invalidTransition(job.status, 'running');
  const attempt = job.attempt + 1;
  if (attempt > job.maxAttempts) invalidTransition(job.status, 'running', 'retry limit reached');
  const lease = makeLease(command.lease, attempt, state.egressEpoch, command.now);
  const nextJob: NodeSlideDurableJobState = {
    ...job,
    status: 'running',
    attempt,
    lease,
    updatedAt: command.now,
  };
  return appendEvent(state, nextJob, 'claimed', job.status, command.now, lease.leaseId, undefined);
}

function resume(
  state: NodeSlideDurableSessionState,
  command: Extract<NodeSlideDurableSessionCommand, { type: 'resume' }>,
): NodeSlideDurableSessionState {
  const job = getBoundJob(state, command.jobId, command.requestBinding);
  if (state.activeJobId !== job.jobId) activeConflict();
  if (job.status !== 'paused') invalidTransition(job.status, 'running');
  const lease = makeLease(command.lease, job.attempt, state.egressEpoch, command.now);
  const nextJob: NodeSlideDurableJobState = {
    ...job,
    status: 'running',
    resumeCount: job.resumeCount + 1,
    lease,
    updatedAt: command.now,
  };
  return appendEvent(state, nextJob, 'resumed', 'paused', command.now, lease.leaseId, undefined);
}

function retry(
  state: NodeSlideDurableSessionState,
  command: Extract<NodeSlideDurableSessionCommand, { type: 'retry' }>,
): NodeSlideDurableSessionState {
  const job = getBoundJob(state, command.jobId, command.requestBinding);
  if (job.status !== 'failed') invalidTransition(job.status, 'retrying');
  if (job.attempt >= job.maxAttempts)
    invalidTransition(job.status, 'retrying', 'retry limit reached');
  const nextJob: NodeSlideDurableJobState = {
    ...job,
    status: 'retrying',
    retryCount: job.retryCount + 1,
    updatedAt: command.now,
  };
  return appendEvent(state, nextJob, 'retried', 'failed', command.now, undefined, job.jobId);
}

function transition(
  state: NodeSlideDurableSessionState,
  command: Extract<NodeSlideDurableSessionCommand, { type: 'transition' }>,
): NodeSlideDurableSessionState {
  const job = getBoundJob(state, command.jobId, command.requestBinding);
  const requiresLease = job.status === 'running';
  if (requiresLease) assertLease(job, command.leaseId, state.egressEpoch, command.now);
  if (!isAllowedTransition(job.status, command.toStatus)) {
    invalidTransition(job.status, command.toStatus);
  }
  const terminal = isTerminal(command.toStatus);
  const active = terminal || command.toStatus === 'awaiting_review' ? null : state.activeJobId;
  const { lease: _lease, ...jobWithoutLease } = job;
  const nextJob = {
    ...(terminal || command.toStatus === 'paused' || command.toStatus === 'awaiting_review'
      ? jobWithoutLease
      : job),
    status: command.toStatus,
    updatedAt: command.now,
    ...(boundedNodeSlideReason(command.reason) !== undefined
      ? { reason: boundedNodeSlideReason(command.reason) }
      : {}),
    ...(terminal ? { completedAt: command.now } : {}),
  } as NodeSlideDurableJobState;
  const kind: NodeSlideDurableJobEventKind =
    command.toStatus === 'paused'
      ? 'paused'
      : command.toStatus === 'stale'
        ? 'stale_fenced'
        : 'transitioned';
  return appendEvent(state, nextJob, kind, job.status, command.now, command.leaseId, active);
}

function rotateEgress(
  state: NodeSlideDurableSessionState,
  command: Extract<NodeSlideDurableSessionCommand, { type: 'rotate_egress' }>,
): NodeSlideDurableSessionState {
  const nextEpoch = state.egressEpoch + 1;
  if (state.activeJobId === null) {
    return { ...state, egressEpoch: nextEpoch, stateVersion: state.stateVersion + 1 };
  }
  const job = state.jobs[state.activeJobId];
  if (!job || job.status === 'awaiting_review' || isTerminal(job.status)) {
    return { ...state, egressEpoch: nextEpoch, stateVersion: state.stateVersion + 1 };
  }
  const reason =
    boundedNodeSlideReason(command.reason) ??
    'Egress epoch rotated; the previous execution was fenced.';
  const nextJob: NodeSlideDurableJobState = {
    jobId: job.jobId,
    requestBinding: job.requestBinding,
    status: 'stale',
    attempt: job.attempt,
    retryCount: job.retryCount,
    resumeCount: job.resumeCount,
    maxAttempts: job.maxAttempts,
    createdAt: job.createdAt,
    updatedAt: command.now,
    completedAt: command.now,
    reason,
  };
  const next = appendEvent(
    { ...state, egressEpoch: nextEpoch },
    nextJob,
    'egress_rotated',
    job.status,
    command.now,
    undefined,
    null,
  );
  return next;
}

function appendEvent(
  state: NodeSlideDurableSessionState,
  job: NodeSlideDurableJobState,
  kind: NodeSlideDurableJobEventKind,
  fromStatus: NodeSlideDurableJobState['status'] | null,
  now: number,
  leaseId: string | undefined,
  activeJobId: string | null | undefined,
): NodeSlideDurableSessionState {
  if (state.events.length >= NODESLIDE_DURABLE_SESSION_MAX_EVENTS) {
    throw new NodeSlideDurableSessionError('event_capacity_exceeded', 'the event journal is full');
  }
  const nextStateVersion = state.stateVersion + 1;
  const sequence = state.eventSequence + 1;
  const eventData = {
    schemaVersion: NODESLIDE_DURABLE_SESSION_VERSION,
    sequence,
    stateVersion: nextStateVersion,
    jobId: job.jobId,
    kind,
    fromStatus,
    toStatus: job.status,
    requestBinding: job.requestBinding,
    egressEpoch: state.egressEpoch,
    attempt: job.attempt,
    occurredAt: now,
    ...(leaseId !== undefined ? { leaseId } : {}),
    ...(job.reason !== undefined ? { reason: job.reason } : {}),
  } satisfies Omit<NodeSlideDurableJobEvent, 'eventDigest'>;
  const event: NodeSlideDurableJobEvent = {
    ...eventData,
    eventDigest: nodeSlideDurableDigest({
      previousEventDigest: state.events.at(-1)?.eventDigest ?? null,
      event: eventData,
    }),
  };
  return {
    ...state,
    stateVersion: nextStateVersion,
    activeJobId: activeJobId === undefined ? state.activeJobId : activeJobId,
    jobs: { ...state.jobs, [job.jobId]: job },
    eventSequence: sequence,
    events: [...state.events, event],
  };
}

function getBoundJob(
  state: NodeSlideDurableSessionState,
  jobId: string,
  binding: NodeSlideRequestBinding,
): NodeSlideDurableJobState {
  const job = state.jobs[jobId];
  if (!job) throw new NodeSlideDurableSessionError('invalid_state', `job ${jobId} is absent`);
  if (!sameNodeSlideRequestBinding(job.requestBinding, binding)) {
    throw new NodeSlideDurableSessionError('request_binding_mismatch', 'job binding is immutable');
  }
  return job;
}

function assertSessionBinding(
  state: NodeSlideDurableSessionState,
  binding: NodeSlideRequestBinding,
): void {
  if (!sameNodeSlideRequestBinding(state.requestBinding, binding)) {
    throw new NodeSlideDurableSessionError(
      'request_binding_mismatch',
      'session binding is immutable',
    );
  }
}

function makeLease(
  request: LeaseRequest,
  attempt: number,
  egressEpoch: number,
  now: number,
): NodeSlideJobLease {
  requiredKey('leaseId', request.leaseId);
  requiredKey('workerId', request.workerId);
  if (!Number.isSafeInteger(request.issuedAt) || request.issuedAt > now)
    invalid('lease issue time');
  if (!Number.isSafeInteger(request.expiresAt) || request.expiresAt <= now) invalid('lease expiry');
  return { ...request, attempt, egressEpoch };
}

function assertLease(
  job: NodeSlideDurableJobState,
  leaseId: string | undefined,
  egressEpoch: number,
  now: number,
): asserts job is NodeSlideDurableJobState & { lease: NodeSlideJobLease } {
  if (!job.lease || job.lease.leaseId !== leaseId) {
    throw new NodeSlideDurableSessionError('lease_mismatch', 'the worker lease does not match');
  }
  if (job.lease.egressEpoch !== egressEpoch) {
    throw new NodeSlideDurableSessionError(
      'egress_epoch_mismatch',
      'the worker egress epoch is stale',
    );
  }
  if (job.lease.expiresAt <= now) {
    throw new NodeSlideDurableSessionError('lease_mismatch', 'the worker lease has expired');
  }
}

function isAllowedTransition(
  from: NodeSlideDurableJobState['status'],
  to: NodeSlideDurableJobState['status'],
): boolean {
  const allowed: Readonly<Record<NodeSlideDurableJobState['status'], readonly string[]>> = {
    queued: ['cancelled', 'rejected', 'stale'],
    running: ['paused', 'awaiting_review', 'succeeded', 'failed', 'cancelled', 'rejected', 'stale'],
    retrying: ['cancelled', 'rejected', 'stale'],
    paused: ['cancelled', 'rejected', 'stale'],
    awaiting_review: ['succeeded', 'rejected', 'stale'],
    succeeded: [],
    failed: [],
    cancelled: [],
    rejected: [],
    stale: [],
  };
  return allowed[from].includes(to);
}

function isTerminal(status: NodeSlideDurableJobState['status']): boolean {
  return (
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'rejected' ||
    status === 'stale'
  );
}

function activeConflict(): never {
  throw new NodeSlideDurableSessionError(
    'active_job_conflict',
    'job is not in the active-job slot',
  );
}

function invalidTransition(from: string, to: string, detail?: string): never {
  throw new NodeSlideDurableSessionError(
    'invalid_transition',
    `cannot transition ${from} to ${to}${detail ? `: ${detail}` : ''}`,
  );
}

function requiredKey(field: string, value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256)
    invalid(`${field} is invalid`);
  return value;
}

function assertFiniteTime(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) invalid('timestamp');
}

function assertNonnegativeInteger(field: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) invalid(field);
}

function assertPositiveInteger(field: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) invalid(field);
}

function invalid(message: string): never {
  throw new NodeSlideDurableSessionError('invalid_state', message);
}
