import type { SourceRecord } from '../../shared/nodeslide';
import { nodeslideContentDigest } from './nodeslideIds';

export const NODESLIDE_SOURCE_REVISION_SCHEMA = 'nodeslide.source-revision/v1' as const;

const SHA_256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const SOURCE_REVISION_ID = /^source-revision:sha256:[0-9a-f]{64}$/;
const MAX_ID_LENGTH = 256;
const MAX_TITLE_LENGTH = 1_000;
const MAX_CITATION_LENGTH = 8_000;
const MAX_METADATA_LENGTH = 512;
const MAX_COLUMNS = 2_048;

export interface NodeSlideSourceRevisionPredecessor {
  readonly revisionId: string;
  readonly revisionDigest: string;
}

/**
 * Content-addressed source evidence. Unlike SourceRecord, this value contains no
 * mutable ingestion status and can be safely retained by historical receipts.
 */
export interface NodeSlideImmutableSourceRevision {
  readonly schema: typeof NODESLIDE_SOURCE_REVISION_SCHEMA;
  readonly revisionId: string;
  readonly revisionDigest: string;
  readonly sourceId: string;
  readonly deckId: string;
  readonly title: string;
  readonly url?: string;
  readonly sourceType: SourceRecord['sourceType'];
  readonly retrievedAt: number;
  readonly citation: string;
  readonly license?: string;
  readonly format?: SourceRecord['format'];
  /** Digest of the exact retained bytes/text, not of mutable source metadata. */
  readonly contentDigest: string;
  readonly byteSize?: number;
  readonly rowCount?: number;
  readonly columns?: readonly string[];
  readonly provider?: string;
  readonly retention?: SourceRecord['retention'];
  readonly predecessor?: NodeSlideSourceRevisionPredecessor;
}

export interface BuildNodeSlideSourceRevisionArgs {
  source: SourceRecord;
  /** Overrides source.contentDigest when the exact retained artifact was just captured. */
  contentDigest?: string;
  predecessor?: Pick<NodeSlideImmutableSourceRevision, 'revisionId' | 'revisionDigest'>;
}

type RevisionPayload = Omit<NodeSlideImmutableSourceRevision, 'revisionId' | 'revisionDigest'>;

/** Builds a deterministic, deeply frozen revision of exact retained source evidence. */
export function buildNodeSlideSourceRevision(
  args: BuildNodeSlideSourceRevisionArgs,
): NodeSlideImmutableSourceRevision {
  const contentDigest = args.contentDigest ?? args.source.contentDigest;
  assertCanonicalDigest(contentDigest, 'Source revision content digest');

  const payload: RevisionPayload = {
    schema: NODESLIDE_SOURCE_REVISION_SCHEMA,
    sourceId: cleanRequired(args.source.id, 'Source revision source ID', MAX_ID_LENGTH),
    deckId: cleanRequired(args.source.deckId, 'Source revision deck ID', MAX_ID_LENGTH),
    title: cleanRequired(args.source.title, 'Source revision title', MAX_TITLE_LENGTH),
    ...(args.source.url ? { url: canonicalPublicUrl(args.source.url) } : {}),
    sourceType: args.source.sourceType,
    retrievedAt: nonNegativeInteger(args.source.retrievedAt, 'Source revision retrievedAt'),
    citation: cleanRequired(args.source.citation, 'Source revision citation', MAX_CITATION_LENGTH),
    ...(args.source.license
      ? {
          license: cleanRequired(
            args.source.license,
            'Source revision license',
            MAX_METADATA_LENGTH,
          ),
        }
      : {}),
    ...(args.source.format ? { format: args.source.format } : {}),
    contentDigest,
    ...(args.source.byteSize !== undefined
      ? { byteSize: nonNegativeInteger(args.source.byteSize, 'Source revision byteSize') }
      : {}),
    ...(args.source.rowCount !== undefined
      ? { rowCount: nonNegativeInteger(args.source.rowCount, 'Source revision rowCount') }
      : {}),
    ...(args.source.columns ? { columns: canonicalColumns(args.source.columns) } : {}),
    ...(args.source.provider
      ? {
          provider: cleanRequired(
            args.source.provider,
            'Source revision provider',
            MAX_METADATA_LENGTH,
          ),
        }
      : {}),
    ...(args.source.retention ? { retention: args.source.retention } : {}),
    ...(args.predecessor
      ? {
          predecessor: canonicalPredecessor(args.predecessor),
        }
      : {}),
  };
  assertSourceType(payload.sourceType);
  assertFormat(payload.format);
  assertRetention(payload.retention);

  const revisionDigest = sourceRevisionDigest(payload);
  const revision = {
    ...payload,
    revisionId: `source-revision:${revisionDigest}`,
    revisionDigest,
  } satisfies NodeSlideImmutableSourceRevision;
  assertNodeSlideSourceRevision(revision);
  return deepFreeze(revision);
}

/** Rejects malformed, mutable-field-bearing, or digest-tampered source revisions. */
export function assertNodeSlideSourceRevision(
  value: unknown,
): asserts value is NodeSlideImmutableSourceRevision {
  if (!isRecord(value)) invalid('must be an object');
  const allowed = new Set([
    'schema',
    'revisionId',
    'revisionDigest',
    'sourceId',
    'deckId',
    'title',
    'url',
    'sourceType',
    'retrievedAt',
    'citation',
    'license',
    'format',
    'contentDigest',
    'byteSize',
    'rowCount',
    'columns',
    'provider',
    'retention',
    'predecessor',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    invalid('contains fields outside the immutable revision contract');
  }
  if (value['schema'] !== NODESLIDE_SOURCE_REVISION_SCHEMA) invalid('schema is invalid');
  if (typeof value['revisionId'] !== 'string' || !SOURCE_REVISION_ID.test(value['revisionId'])) {
    invalid('revision ID is invalid');
  }
  assertCanonicalDigest(value['revisionDigest'], 'Source revision digest');
  assertCanonicalDigest(value['contentDigest'], 'Source revision content digest');
  cleanRequired(value['sourceId'], 'Source revision source ID', MAX_ID_LENGTH);
  cleanRequired(value['deckId'], 'Source revision deck ID', MAX_ID_LENGTH);
  cleanRequired(value['title'], 'Source revision title', MAX_TITLE_LENGTH);
  cleanRequired(value['citation'], 'Source revision citation', MAX_CITATION_LENGTH);
  if (value['url'] !== undefined && canonicalPublicUrl(value['url']) !== value['url']) {
    invalid('URL is not canonical');
  }
  assertSourceType(value['sourceType']);
  nonNegativeInteger(value['retrievedAt'], 'Source revision retrievedAt');
  if (value['license'] !== undefined) {
    cleanRequired(value['license'], 'Source revision license', MAX_METADATA_LENGTH);
  }
  assertFormat(value['format']);
  if (value['byteSize'] !== undefined) {
    nonNegativeInteger(value['byteSize'], 'Source revision byteSize');
  }
  if (value['rowCount'] !== undefined) {
    nonNegativeInteger(value['rowCount'], 'Source revision rowCount');
  }
  if (value['columns'] !== undefined) {
    if (!Array.isArray(value['columns'])) invalid('columns must be an array');
    const canonical = canonicalColumns(value['columns']);
    if (stableJson(canonical) !== stableJson(value['columns'])) {
      invalid('columns are not canonical');
    }
  }
  if (value['provider'] !== undefined) {
    cleanRequired(value['provider'], 'Source revision provider', MAX_METADATA_LENGTH);
  }
  assertRetention(value['retention']);
  if (value['predecessor'] !== undefined) {
    if (!isRecord(value['predecessor'])) invalid('predecessor is invalid');
    const predecessor = canonicalPredecessor(value['predecessor']);
    if (stableJson(predecessor) !== stableJson(value['predecessor'])) {
      invalid('predecessor is not canonical');
    }
    if (predecessor.revisionId === value['revisionId']) invalid('cannot reference itself');
  }

  const { revisionId: _revisionId, revisionDigest, ...payload } = value;
  const expectedDigest = sourceRevisionDigest(payload as RevisionPayload);
  if (revisionDigest !== expectedDigest) invalid('digest binding is invalid');
  if (value['revisionId'] !== `source-revision:${expectedDigest}`) {
    invalid('revision ID is not bound to its digest');
  }
}

export function isNodeSlideSourceRevision(
  value: unknown,
): value is NodeSlideImmutableSourceRevision {
  try {
    assertNodeSlideSourceRevision(value);
    return true;
  } catch {
    return false;
  }
}

function sourceRevisionDigest(payload: RevisionPayload): string {
  return nodeslideContentDigest(stableJson(payload));
}

function canonicalPredecessor(value: unknown): NodeSlideSourceRevisionPredecessor {
  if (!isRecord(value)) invalid('predecessor is invalid');
  const revisionId = value['revisionId'];
  const revisionDigest = value['revisionDigest'];
  if (typeof revisionId !== 'string' || !SOURCE_REVISION_ID.test(revisionId)) {
    invalid('predecessor revision ID is invalid');
  }
  assertCanonicalDigest(revisionDigest, 'Source revision predecessor digest');
  if (revisionId !== `source-revision:${revisionDigest}`) {
    invalid('predecessor revision ID is not bound to its digest');
  }
  return { revisionId, revisionDigest };
}

function canonicalColumns(values: readonly unknown[]): readonly string[] {
  if (values.length > MAX_COLUMNS) invalid('contains too many columns');
  const columns = values.map((value) =>
    cleanRequired(value, 'Source revision column', MAX_METADATA_LENGTH),
  );
  if (new Set(columns).size !== columns.length) invalid('contains duplicate columns');
  return columns;
}

function canonicalPublicUrl(value: unknown): string {
  const raw = cleanRequired(value, 'Source revision URL', 8_000);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    invalid('URL is invalid');
  }
  if (parsed.username || parsed.password) invalid('URL cannot contain credentials');
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    invalid('URL must use HTTP or HTTPS');
  }
  parsed.hash = '';
  return parsed.toString();
}

function assertSourceType(value: unknown): asserts value is SourceRecord['sourceType'] {
  if (!['internal', 'url', 'document', 'spreadsheet', 'note'].includes(String(value))) {
    invalid('source type is invalid');
  }
}

function assertFormat(value: unknown): asserts value is SourceRecord['format'] | undefined {
  if (value !== undefined && !['csv', 'json', 'txt', 'md', 'pdf', 'web'].includes(String(value))) {
    invalid('format is invalid');
  }
}

function assertRetention(value: unknown): asserts value is SourceRecord['retention'] | undefined {
  if (value !== undefined && !['until_deleted', 'public_snapshot'].includes(String(value))) {
    invalid('retention is invalid');
  }
}

function assertCanonicalDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SHA_256_DIGEST.test(value)) {
    throw new Error(`${label} must be a canonical SHA-256 digest.`);
  }
}

function cleanRequired(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  const clean = value.trim();
  if (!clean || clean.length > maxLength || clean !== value) {
    throw new Error(`${label} must be non-empty, trimmed, and at most ${maxLength} characters.`);
  }
  return clean;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return Number(value);
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function invalid(reason: string): never {
  throw new Error(`NodeSlide source revision ${reason}.`);
}
