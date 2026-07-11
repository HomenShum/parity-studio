import { NODESLIDE_PREFERENCE_BOUNDS } from '../../shared/nodeslidePreference';

export interface PreferenceRetentionCandidate {
  id: string;
  tenantId?: string;
  actorId?: string;
  recordedAt: number;
  processedAt?: number;
  sourceEventId?: string;
}

export interface PreferenceRetentionSignalCandidate {
  id: string;
  tenantId: string;
  actorId: string;
  createdAt: number;
  evidenceEventIds: readonly string[];
  evaluatorInputEventIds: readonly string[];
}

export interface PreferenceRetentionOptions {
  maximum?: number;
  tenantId?: string;
  actorId?: string;
}

export interface PreferenceRetentionReceipt {
  limit: number;
  beforeCount: number;
  deletedEventCount: number;
  postCount: number;
  inputSignalCount: number;
  evictedSignalCount: number;
  retainedSignalCount: number;
  retainedEvidenceEventCount: number;
  evictedSignalIds: string[];
  postCountAtOrBelowLimit: true;
  noDanglingReferences: true;
}

export interface PreferenceRetentionPlan {
  eventIdsToDelete: string[];
  signalIdsToEvict: string[];
  retainedEventIds: string[];
  retainedSignalIds: string[];
  retainedCount: number;
  referencedCount: number;
  receipt: PreferenceRetentionReceipt;
}

const MAX_PROFILE_EVIDENCE_REFERENCES =
  NODESLIDE_PREFERENCE_BOUNDS.maxProfileSignals * NODESLIDE_PREFERENCE_BOUNDS.maxEvidenceEventIds;

/**
 * The largest recorder burst that can land before one retention pass.
 */
export const NODESLIDE_PREFERENCE_RETENTION_WRITE_BURST_LIMIT = 200;

/**
 * Covers every possible distinct profile evidence reference plus a complete recorder burst.
 */
export const NODESLIDE_PREFERENCE_RETENTION_SCAN_LIMIT =
  MAX_PROFILE_EVIDENCE_REFERENCES + NODESLIDE_PREFERENCE_RETENTION_WRITE_BURST_LIMIT;

export function planPreferenceEventRetention(
  candidates: readonly PreferenceRetentionCandidate[],
  references: ReadonlySet<string> | readonly PreferenceRetentionSignalCandidate[],
  maximumOrOptions:
    | number
    | PreferenceRetentionOptions = NODESLIDE_PREFERENCE_BOUNDS.maxRetainedEvents,
): PreferenceRetentionPlan {
  const options = retentionOptions(maximumOrOptions);
  validateScopeOptions(options);
  const maximum = options.maximum ?? NODESLIDE_PREFERENCE_BOUNDS.maxRetainedEvents;
  if (
    !Number.isInteger(maximum) ||
    maximum < 1 ||
    maximum > NODESLIDE_PREFERENCE_RETENTION_SCAN_LIMIT
  ) {
    throw new TypeError('Preference retention maximum is invalid.');
  }
  if (candidates.length > NODESLIDE_PREFERENCE_RETENTION_SCAN_LIMIT) {
    throw new RangeError(
      `Preference retention accepts at most ${NODESLIDE_PREFERENCE_RETENTION_SCAN_LIMIT} rows.`,
    );
  }

  const byId = normalizeCandidates(candidates, options);
  const rows = [...byId.values()];
  const validProvenanceById = new Map<string, boolean>();
  const provenanceIsValid = (eventId: string): boolean => {
    const cached = validProvenanceById.get(eventId);
    if (cached !== undefined) return cached;
    const path: string[] = [];
    const visited = new Set<string>();
    let currentId: string | undefined = eventId;
    let valid = true;
    while (currentId !== undefined) {
      const known = validProvenanceById.get(currentId);
      if (known !== undefined) {
        valid = known;
        break;
      }
      if (visited.has(currentId)) {
        valid = false;
        break;
      }
      visited.add(currentId);
      path.push(currentId);
      const row = byId.get(currentId);
      if (!row) {
        valid = false;
        break;
      }
      currentId = row.sourceEventId;
    }
    for (const id of path) validProvenanceById.set(id, valid);
    return valid;
  };
  for (const row of rows) provenanceIsValid(row.id);

  const signalInput = isReferenceSet(references) ? undefined : normalizeSignals(references);
  const legacyReferences = isReferenceSet(references) ? references : undefined;
  const signalIdsToEvict = new Set<string>();
  let retainedSignals = signalInput ? [...signalInput] : [];

  if (signalInput) {
    for (const signal of signalInput) {
      if (!signalCanBeRetained(signal, byId, provenanceIsValid, options)) {
        signalIdsToEvict.add(signal.id);
      }
    }
    retainedSignals = retainedSignals.filter((signal) => !signalIdsToEvict.has(signal.id));
    const overProfileLimit = Math.max(
      0,
      retainedSignals.length - NODESLIDE_PREFERENCE_BOUNDS.maxProfileSignals,
    );
    for (const signal of signalEvictionOrder(retainedSignals).slice(0, overProfileLimit)) {
      signalIdsToEvict.add(signal.id);
    }
    retainedSignals = retainedSignals.filter((signal) => !signalIdsToEvict.has(signal.id));
  } else {
    validateLegacyReferences(legacyReferences ?? new Set(), byId, provenanceIsValid);
  }

  let referenceSets = collectReferenceSets(
    retainedSignals,
    legacyReferences,
    byId,
    provenanceIsValid,
  );
  if (signalInput) {
    for (const signal of signalEvictionOrder(retainedSignals)) {
      if (referenceSets.protectedEventIds.size <= maximum) break;
      signalIdsToEvict.add(signal.id);
      retainedSignals = retainedSignals.filter((candidate) => candidate.id !== signal.id);
      referenceSets = collectReferenceSets(retainedSignals, undefined, byId, provenanceIsValid);
    }
  }
  if (referenceSets.protectedEventIds.size > maximum) {
    throw new RangeError(
      'Preference retention cannot satisfy the event limit without profile signals to evict.',
    );
  }

  const dependentsBySourceId = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.sourceEventId) continue;
    const dependents = dependentsBySourceId.get(row.sourceEventId) ?? [];
    dependents.push(row.id);
    dependentsBySourceId.set(row.sourceEventId, dependents);
  }
  for (const dependents of dependentsBySourceId.values()) dependents.sort();

  const eventIdsToDelete = new Set(
    rows.filter((row) => !provenanceIsValid(row.id)).map((row) => row.id),
  );
  const addDeletionClosure = (eventId: string): void => {
    const pending = [eventId];
    while (pending.length > 0) {
      const currentId = pending.pop();
      if (!currentId || eventIdsToDelete.has(currentId)) continue;
      if (referenceSets.protectedEventIds.has(currentId)) {
        throw new Error('Preference retention attempted to delete retained provenance.');
      }
      eventIdsToDelete.add(currentId);
      pending.push(...(dependentsBySourceId.get(currentId) ?? []));
    }
  };

  const overflow = Math.max(0, rows.length - maximum);
  const deletionOrder = [...rows].sort(compareDeletionPriority);
  for (const row of deletionOrder) {
    if (eventIdsToDelete.size >= overflow) break;
    if (eventIdsToDelete.has(row.id) || referenceSets.protectedEventIds.has(row.id)) continue;
    addDeletionClosure(row.id);
  }

  const deleted = eventIdsToDelete;
  const retainedRows = rows.filter((row) => !deleted.has(row.id));
  const retainedEventIdsSet = new Set(retainedRows.map((row) => row.id));
  const noDanglingEventProvenance = retainedRows.every(
    (row) => !row.sourceEventId || retainedEventIdsSet.has(row.sourceEventId),
  );
  const noDanglingSignalReferences = retainedSignals.every((signal) =>
    signal.evidenceEventIds.every((eventId) => retainedEventIdsSet.has(eventId)),
  );
  if (retainedRows.length > maximum || !noDanglingEventProvenance || !noDanglingSignalReferences) {
    throw new Error('Preference retention post-prune invariant failed.');
  }

  const deletionRank = new Map(deletionOrder.map((row, index) => [row.id, index]));
  const orderedEventIdsToDelete = [...deleted].sort(
    (left, right) =>
      (deletionRank.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (deletionRank.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right),
  );
  const retainedEventIds = retainedRows.sort(compareChronological).map((row) => row.id);
  const orderedEvictedSignalIds = signalInput
    ? signalEvictionOrder(signalInput)
        .filter((signal) => signalIdsToEvict.has(signal.id))
        .map((signal) => signal.id)
    : [];
  const retainedSignalIds = [...retainedSignals]
    .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))
    .map((signal) => signal.id);
  const referencedCount = [...referenceSets.directEvidenceEventIds].filter((eventId) =>
    retainedEventIdsSet.has(eventId),
  ).length;
  const receipt: PreferenceRetentionReceipt = {
    limit: maximum,
    beforeCount: rows.length,
    deletedEventCount: orderedEventIdsToDelete.length,
    postCount: retainedEventIds.length,
    inputSignalCount: signalInput?.length ?? 0,
    evictedSignalCount: orderedEvictedSignalIds.length,
    retainedSignalCount: retainedSignalIds.length,
    retainedEvidenceEventCount: referencedCount,
    evictedSignalIds: orderedEvictedSignalIds,
    postCountAtOrBelowLimit: true,
    noDanglingReferences: true,
  };
  return {
    eventIdsToDelete: orderedEventIdsToDelete,
    signalIdsToEvict: orderedEvictedSignalIds,
    retainedEventIds,
    retainedSignalIds,
    retainedCount: retainedEventIds.length,
    referencedCount,
    receipt,
  };
}

function retentionOptions(
  maximumOrOptions: number | PreferenceRetentionOptions,
): PreferenceRetentionOptions {
  return typeof maximumOrOptions === 'number' ? { maximum: maximumOrOptions } : maximumOrOptions;
}

function validateScopeOptions(options: PreferenceRetentionOptions): void {
  if ((options.tenantId === undefined) !== (options.actorId === undefined)) {
    throw new TypeError('Preference retention scope is invalid.');
  }
  if (
    (options.tenantId !== undefined && !isIdentifier(options.tenantId)) ||
    (options.actorId !== undefined && !isIdentifier(options.actorId))
  ) {
    throw new TypeError('Preference retention scope is invalid.');
  }
}

function normalizeCandidates(
  candidates: readonly PreferenceRetentionCandidate[],
  options: PreferenceRetentionOptions,
): Map<string, PreferenceRetentionCandidate> {
  const byId = new Map<string, PreferenceRetentionCandidate>();
  for (const candidate of candidates) {
    if (
      !isIdentifier(candidate.id) ||
      !Number.isFinite(candidate.recordedAt) ||
      (candidate.processedAt !== undefined && !Number.isFinite(candidate.processedAt)) ||
      (candidate.sourceEventId !== undefined && !isIdentifier(candidate.sourceEventId)) ||
      (options.tenantId !== undefined && candidate.tenantId !== options.tenantId) ||
      (options.actorId !== undefined && candidate.actorId !== options.actorId)
    ) {
      throw new TypeError('Preference retention candidate is invalid.');
    }
    const existing = byId.get(candidate.id);
    if (existing && !sameCandidate(existing, candidate)) {
      throw new TypeError('Conflicting preference retention candidate ID.');
    }
    byId.set(candidate.id, candidate);
  }
  return byId;
}

function normalizeSignals(
  signals: readonly PreferenceRetentionSignalCandidate[],
): PreferenceRetentionSignalCandidate[] {
  const byId = new Map<string, PreferenceRetentionSignalCandidate>();
  for (const signal of signals) {
    const existing = byId.get(signal.id);
    if (existing) throw new TypeError('Duplicate preference retention signal ID.');
    byId.set(signal.id, signal);
  }
  return [...byId.values()];
}

function signalCanBeRetained(
  signal: PreferenceRetentionSignalCandidate,
  candidates: ReadonlyMap<string, PreferenceRetentionCandidate>,
  provenanceIsValid: (eventId: string) => boolean,
  options: PreferenceRetentionOptions,
): boolean {
  const evidenceIds = signal.evidenceEventIds;
  return (
    isIdentifier(signal.id) &&
    isIdentifier(signal.tenantId) &&
    isIdentifier(signal.actorId) &&
    Number.isFinite(signal.createdAt) &&
    (options.tenantId === undefined || signal.tenantId === options.tenantId) &&
    (options.actorId === undefined || signal.actorId === options.actorId) &&
    evidenceIds.length > 0 &&
    evidenceIds.length <= NODESLIDE_PREFERENCE_BOUNDS.maxEvidenceEventIds &&
    new Set(evidenceIds).size === evidenceIds.length &&
    evidenceIds.every(
      (eventId) => isIdentifier(eventId) && candidates.has(eventId) && provenanceIsValid(eventId),
    ) &&
    sameIds(evidenceIds, signal.evaluatorInputEventIds)
  );
}

function validateLegacyReferences(
  references: ReadonlySet<string>,
  candidates: ReadonlyMap<string, PreferenceRetentionCandidate>,
  provenanceIsValid: (eventId: string) => boolean,
): void {
  for (const eventId of references) {
    if (!isIdentifier(eventId) || !candidates.has(eventId) || !provenanceIsValid(eventId)) {
      throw new TypeError('Preference retention reference is invalid.');
    }
  }
}

function collectReferenceSets(
  signals: readonly PreferenceRetentionSignalCandidate[],
  legacyReferences: ReadonlySet<string> | undefined,
  candidates: ReadonlyMap<string, PreferenceRetentionCandidate>,
  provenanceIsValid: (eventId: string) => boolean,
): { directEvidenceEventIds: Set<string>; protectedEventIds: Set<string> } {
  const directEvidenceEventIds = new Set(
    legacyReferences ?? signals.flatMap((signal) => signal.evidenceEventIds),
  );
  const protectedEventIds = new Set<string>();
  for (const evidenceEventId of directEvidenceEventIds) {
    let currentId: string | undefined = evidenceEventId;
    while (currentId !== undefined && !protectedEventIds.has(currentId)) {
      if (!provenanceIsValid(currentId)) {
        throw new Error('Preference retention encountered invalid retained provenance.');
      }
      protectedEventIds.add(currentId);
      currentId = candidates.get(currentId)?.sourceEventId;
    }
  }
  return { directEvidenceEventIds, protectedEventIds };
}

function signalEvictionOrder(
  signals: readonly PreferenceRetentionSignalCandidate[],
): PreferenceRetentionSignalCandidate[] {
  return [...signals].sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
}

function compareDeletionPriority(
  left: PreferenceRetentionCandidate,
  right: PreferenceRetentionCandidate,
): number {
  return (
    Number(left.processedAt === undefined) - Number(right.processedAt === undefined) ||
    left.recordedAt - right.recordedAt ||
    left.id.localeCompare(right.id)
  );
}

function compareChronological(
  left: PreferenceRetentionCandidate,
  right: PreferenceRetentionCandidate,
): number {
  return left.recordedAt - right.recordedAt || left.id.localeCompare(right.id);
}

function sameCandidate(
  left: PreferenceRetentionCandidate,
  right: PreferenceRetentionCandidate,
): boolean {
  return (
    left.id === right.id &&
    left.tenantId === right.tenantId &&
    left.actorId === right.actorId &&
    left.recordedAt === right.recordedAt &&
    left.processedAt === right.processedAt &&
    left.sourceEventId === right.sourceEventId
  );
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function isReferenceSet(
  references: ReadonlySet<string> | readonly PreferenceRetentionSignalCandidate[],
): references is ReadonlySet<string> {
  return !Array.isArray(references);
}

function isIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= NODESLIDE_PREFERENCE_BOUNDS.maxAttributeStringLength;
}
