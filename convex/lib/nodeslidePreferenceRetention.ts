import { NODESLIDE_PREFERENCE_BOUNDS } from '../../shared/nodeslidePreference';

export interface PreferenceRetentionCandidate {
  id: string;
  recordedAt: number;
  processedAt?: number;
}

export interface PreferenceRetentionPlan {
  eventIdsToDelete: string[];
  retainedEventIds: string[];
  retainedCount: number;
  referencedCount: number;
}

const RETENTION_INPUT_LIMIT = NODESLIDE_PREFERENCE_BOUNDS.maxRetainedEvents + 501;

export function planPreferenceEventRetention(
  candidates: readonly PreferenceRetentionCandidate[],
  referencedEventIds: ReadonlySet<string>,
  maximum = NODESLIDE_PREFERENCE_BOUNDS.maxRetainedEvents,
): PreferenceRetentionPlan {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > RETENTION_INPUT_LIMIT) {
    throw new TypeError('Preference retention maximum is invalid.');
  }
  if (candidates.length > RETENTION_INPUT_LIMIT) {
    throw new RangeError(`Preference retention accepts at most ${RETENTION_INPUT_LIMIT} rows.`);
  }
  const byId = new Map<string, PreferenceRetentionCandidate>();
  for (const candidate of candidates) {
    if (
      !candidate.id ||
      candidate.id.length > NODESLIDE_PREFERENCE_BOUNDS.maxAttributeStringLength ||
      !Number.isFinite(candidate.recordedAt) ||
      (candidate.processedAt !== undefined && !Number.isFinite(candidate.processedAt))
    ) {
      throw new TypeError('Preference retention candidate is invalid.');
    }
    const existing = byId.get(candidate.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(candidate)) {
      throw new TypeError('Conflicting preference retention candidate ID.');
    }
    byId.set(candidate.id, candidate);
  }
  const rows = [...byId.values()];
  const overflow = Math.max(0, rows.length - maximum);
  const deletionOrder = [...rows].sort(
    (left, right) =>
      Number(left.processedAt === undefined) - Number(right.processedAt === undefined) ||
      left.recordedAt - right.recordedAt ||
      left.id.localeCompare(right.id),
  );
  const eventIdsToDelete: string[] = [];
  for (const row of deletionOrder) {
    if (eventIdsToDelete.length >= overflow) break;
    if (referencedEventIds.has(row.id)) continue;
    eventIdsToDelete.push(row.id);
  }
  const deleted = new Set(eventIdsToDelete);
  const retainedEventIds = rows
    .filter((row) => !deleted.has(row.id))
    .sort((left, right) => left.recordedAt - right.recordedAt || left.id.localeCompare(right.id))
    .map((row) => row.id);
  return {
    eventIdsToDelete,
    retainedEventIds,
    retainedCount: retainedEventIds.length,
    referencedCount: retainedEventIds.filter((id) => referencedEventIds.has(id)).length,
  };
}
