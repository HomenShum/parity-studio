import {
  type NodeSlideRequestBinding,
  nodeSlideDurableDigest,
} from '../../shared/nodeslideDurableSession';

export const NODESLIDE_JOB_JOURNAL_VERSION = 'nodeslide.job-journal/v2' as const;
export const NODESLIDE_JOB_JOURNAL_MAX_MODEL_ENTRIES = 64 as const;
export const NODESLIDE_JOB_JOURNAL_MAX_WEB_ENTRIES = 128 as const;

export interface NodeSlideJobJournalBinding extends NodeSlideRequestBinding {
  readonly sessionId: string;
  readonly jobId: string;
  readonly egressEpoch: number;
  readonly attempt: number;
}

export interface NodeSlideModelJournalInput {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly operation: string;
  /** Digests stand in for prompts, messages, tool payloads, and completions. */
  readonly inputDigest: string;
  readonly outputDigest: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly createdAt: number;
}

export interface NodeSlideWebJournalInput {
  readonly id: string;
  readonly provider: string;
  readonly operation: string;
  /** URL/query/result material is represented by digests, never raw content. */
  readonly queryDigest: string;
  readonly urlDigest: string;
  readonly resultDigest: string;
  readonly resultCount: number;
  readonly createdAt: number;
}

export interface NodeSlideModelJournalEntry extends NodeSlideModelJournalInput {
  readonly kind: 'model';
  readonly sequence: number;
  readonly binding: NodeSlideJobJournalBinding;
  readonly entryDigest: string;
}

export interface NodeSlideWebJournalEntry extends NodeSlideWebJournalInput {
  readonly kind: 'web';
  readonly sequence: number;
  readonly binding: NodeSlideJobJournalBinding;
  readonly entryDigest: string;
}

export interface NodeSlideJobJournal {
  readonly schemaVersion: typeof NODESLIDE_JOB_JOURNAL_VERSION;
  readonly binding: NodeSlideJobJournalBinding;
  readonly nextSequence: number;
  readonly modelEntries: readonly NodeSlideModelJournalEntry[];
  readonly webEntries: readonly NodeSlideWebJournalEntry[];
  readonly lastEntryDigest: string | null;
  readonly journalDigest: string;
}

export type NodeSlideJobJournalCommand =
  | {
      readonly kind: 'model';
      readonly binding: NodeSlideJobJournalBinding;
      readonly entry: NodeSlideModelJournalInput;
    }
  | {
      readonly kind: 'web';
      readonly binding: NodeSlideJobJournalBinding;
      readonly entry: NodeSlideWebJournalInput;
    };

export type NodeSlideJobJournalErrorCode =
  | 'invalid_journal'
  | 'binding_mismatch'
  | 'entry_conflict'
  | 'journal_capacity_exceeded';

export class NodeSlideJobJournalError extends Error {
  constructor(
    readonly code: NodeSlideJobJournalErrorCode,
    message: string,
  ) {
    super(`NodeSlide job journal ${code}: ${message}`);
    this.name = 'NodeSlideJobJournalError';
  }
}

export function createNodeSlideJobJournal(
  binding: NodeSlideJobJournalBinding,
): NodeSlideJobJournal {
  assertBinding(binding);
  const base = {
    schemaVersion: NODESLIDE_JOB_JOURNAL_VERSION,
    binding,
    nextSequence: 1,
    modelEntries: [],
    webEntries: [],
    lastEntryDigest: null,
  } satisfies Omit<NodeSlideJobJournal, 'journalDigest'>;
  return { ...base, journalDigest: journalDigest(base) };
}

export function appendNodeSlideModelJournal(
  journal: NodeSlideJobJournal,
  args: {
    readonly binding: NodeSlideJobJournalBinding;
    readonly entry: NodeSlideModelJournalInput;
  },
): NodeSlideJobJournal {
  assertNodeSlideJobJournal(journal);
  assertExactBinding(journal.binding, args.binding);
  assertModelInput(args.entry);
  const existing = journal.modelEntries.find((entry) => entry.id === args.entry.id);
  if (existing) {
    if (sameCanonical(modelInputFromEntry(existing), args.entry)) return journal;
    throw new NodeSlideJobJournalError(
      'entry_conflict',
      'model entry id is already bound differently',
    );
  }
  if (journal.modelEntries.length >= NODESLIDE_JOB_JOURNAL_MAX_MODEL_ENTRIES) {
    throw new NodeSlideJobJournalError(
      'journal_capacity_exceeded',
      'model journal capacity is full',
    );
  }
  const entryData = {
    ...args.entry,
    kind: 'model' as const,
    sequence: journal.nextSequence,
    binding: journal.binding,
  };
  const entry: NodeSlideModelJournalEntry = {
    ...entryData,
    entryDigest: entryDigest(journal.lastEntryDigest, entryData),
  };
  return finalizeJournal(journal, {
    nextSequence: journal.nextSequence + 1,
    modelEntries: [...journal.modelEntries, entry],
    webEntries: journal.webEntries,
    lastEntryDigest: entry.entryDigest,
  });
}

export function appendNodeSlideWebJournal(
  journal: NodeSlideJobJournal,
  args: { readonly binding: NodeSlideJobJournalBinding; readonly entry: NodeSlideWebJournalInput },
): NodeSlideJobJournal {
  assertNodeSlideJobJournal(journal);
  assertExactBinding(journal.binding, args.binding);
  assertWebInput(args.entry);
  const existing = journal.webEntries.find((entry) => entry.id === args.entry.id);
  if (existing) {
    if (sameCanonical(webInputFromEntry(existing), args.entry)) return journal;
    throw new NodeSlideJobJournalError(
      'entry_conflict',
      'web entry id is already bound differently',
    );
  }
  if (journal.webEntries.length >= NODESLIDE_JOB_JOURNAL_MAX_WEB_ENTRIES) {
    throw new NodeSlideJobJournalError('journal_capacity_exceeded', 'web journal capacity is full');
  }
  const entryData = {
    ...args.entry,
    kind: 'web' as const,
    sequence: journal.nextSequence,
    binding: journal.binding,
  };
  const entry: NodeSlideWebJournalEntry = {
    ...entryData,
    entryDigest: entryDigest(journal.lastEntryDigest, entryData),
  };
  return finalizeJournal(journal, {
    nextSequence: journal.nextSequence + 1,
    modelEntries: journal.modelEntries,
    webEntries: [...journal.webEntries, entry],
    lastEntryDigest: entry.entryDigest,
  });
}

export function reduceNodeSlideJobJournal(
  journal: NodeSlideJobJournal,
  command: NodeSlideJobJournalCommand,
): NodeSlideJobJournal {
  return command.kind === 'model'
    ? appendNodeSlideModelJournal(journal, command)
    : appendNodeSlideWebJournal(journal, command);
}

export function assertNodeSlideJobJournal(journal: NodeSlideJobJournal): void {
  if (journal.schemaVersion !== NODESLIDE_JOB_JOURNAL_VERSION) invalid('schema version');
  assertBinding(journal.binding);
  if (!Number.isSafeInteger(journal.nextSequence) || journal.nextSequence < 1) invalid('sequence');
  if (journal.modelEntries.length > NODESLIDE_JOB_JOURNAL_MAX_MODEL_ENTRIES)
    invalid('model capacity');
  if (journal.webEntries.length > NODESLIDE_JOB_JOURNAL_MAX_WEB_ENTRIES) invalid('web capacity');
  const entries = [...journal.modelEntries, ...journal.webEntries].sort(
    (left, right) => left.sequence - right.sequence,
  );
  if (entries.some((entry, index) => entry.sequence !== index + 1)) invalid('entry sequence');
  if (journal.nextSequence !== entries.length + 1) invalid('next sequence');
  let previous: string | null = null;
  for (const entry of entries) {
    assertExactBinding(journal.binding, entry.binding);
    const { entryDigest: _entryDigest, ...data } = entry;
    void _entryDigest;
    if (entry.entryDigest !== entryDigest(previous, data)) invalid('entry digest');
    previous = entry.entryDigest;
  }
  if (journal.lastEntryDigest !== previous) invalid('last entry digest');
  if (journal.journalDigest !== journalDigest(journal)) invalid('journal digest');
}

export function assertNodeSlideJournalBinding(
  expected: NodeSlideJobJournalBinding,
  actual: NodeSlideJobJournalBinding,
): void {
  assertExactBinding(expected, actual);
}

function finalizeJournal(
  journal: NodeSlideJobJournal,
  patch: Pick<
    NodeSlideJobJournal,
    'nextSequence' | 'modelEntries' | 'webEntries' | 'lastEntryDigest'
  >,
): NodeSlideJobJournal {
  const next = {
    schemaVersion: journal.schemaVersion,
    binding: journal.binding,
    ...patch,
  } satisfies Omit<NodeSlideJobJournal, 'journalDigest'>;
  return { ...next, journalDigest: journalDigest(next) };
}

function journalDigest(
  journal: Omit<NodeSlideJobJournal, 'journalDigest'> | NodeSlideJobJournal,
): string {
  return nodeSlideDurableDigest({
    schemaVersion: journal.schemaVersion,
    binding: journal.binding,
    nextSequence: journal.nextSequence,
    modelEntries: journal.modelEntries,
    webEntries: journal.webEntries,
    lastEntryDigest: journal.lastEntryDigest,
  });
}

function entryDigest(previous: string | null, entry: unknown): string {
  return nodeSlideDurableDigest({
    schemaVersion: NODESLIDE_JOB_JOURNAL_VERSION,
    previousEntryDigest: previous,
    entry,
  });
}

function assertExactBinding(
  expected: NodeSlideJobJournalBinding,
  actual: NodeSlideJobJournalBinding,
): void {
  if (
    expected.schemaVersion !== actual.schemaVersion ||
    expected.sessionId !== actual.sessionId ||
    expected.jobId !== actual.jobId ||
    expected.requestDigest !== actual.requestDigest ||
    expected.capabilityDigest !== actual.capabilityDigest ||
    expected.egressEpoch !== actual.egressEpoch ||
    expected.attempt !== actual.attempt
  ) {
    throw new NodeSlideJobJournalError('binding_mismatch', 'journal binding must match exactly');
  }
}

function assertBinding(binding: NodeSlideJobJournalBinding): void {
  if (
    !nonempty(binding.schemaVersion) ||
    !nonempty(binding.sessionId) ||
    !nonempty(binding.jobId) ||
    !nonempty(binding.requestDigest) ||
    !nonempty(binding.capabilityDigest) ||
    !Number.isSafeInteger(binding.egressEpoch) ||
    binding.egressEpoch < 0 ||
    !Number.isSafeInteger(binding.attempt) ||
    binding.attempt < 0
  ) {
    invalid('binding');
  }
}

function assertModelInput(entry: NodeSlideModelJournalInput): void {
  assertCommonInput(entry);
  if (!nonempty(entry.provider) || !nonempty(entry.model) || !nonempty(entry.operation))
    invalid('model metadata');
  if (!nonempty(entry.inputDigest) || !nonempty(entry.outputDigest)) invalid('model digests');
  assertOptionalNonnegativeInteger(entry.inputTokens, 'input tokens');
  assertOptionalNonnegativeInteger(entry.outputTokens, 'output tokens');
}

function assertWebInput(entry: NodeSlideWebJournalInput): void {
  assertCommonInput(entry);
  if (!nonempty(entry.provider) || !nonempty(entry.operation)) invalid('web metadata');
  if (!nonempty(entry.queryDigest) || !nonempty(entry.urlDigest) || !nonempty(entry.resultDigest)) {
    invalid('web digests');
  }
  if (!Number.isSafeInteger(entry.resultCount) || entry.resultCount < 0) invalid('result count');
}

function assertCommonInput(entry: { id: string; createdAt: number }): void {
  if (!nonempty(entry.id) || !Number.isSafeInteger(entry.createdAt) || entry.createdAt < 0) {
    invalid('entry identity');
  }
}

function assertOptionalNonnegativeInteger(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) invalid(field);
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return nodeSlideDurableDigest(left) === nodeSlideDurableDigest(right);
}

function modelInputFromEntry(entry: NodeSlideModelJournalEntry): NodeSlideModelJournalInput {
  const {
    kind: _kind,
    sequence: _sequence,
    binding: _binding,
    entryDigest: _entryDigest,
    ...input
  } = entry;
  return input;
}

function webInputFromEntry(entry: NodeSlideWebJournalEntry): NodeSlideWebJournalInput {
  const {
    kind: _kind,
    sequence: _sequence,
    binding: _binding,
    entryDigest: _entryDigest,
    ...input
  } = entry;
  return input;
}

function nonempty(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
}

function invalid(message: string): never {
  throw new NodeSlideJobJournalError('invalid_journal', message);
}
