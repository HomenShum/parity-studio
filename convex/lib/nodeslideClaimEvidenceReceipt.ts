import { nodeslideContentDigest } from './nodeslideIds';

export const NODESLIDE_CLAIM_EVIDENCE_RECEIPT_SCHEMA =
  'nodeslide.claim-evidence-receipt/v1' as const;

const SHA_256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const SOURCE_REVISION_ID = /^source-revision:sha256:[0-9a-f]{64}$/;
const RECEIPT_ID = /^claim-evidence-receipt:sha256:[0-9a-f]{64}$/;
const MAX_ID_LENGTH = 256;
const MAX_PDF_PAGES = 100_000;
const COORDINATE_PRECISION = 1_000_000;

export type NodeSlideEvidenceRegionKind = 'screenshot' | 'pdf';

export interface NodeSlideEvidenceRegionInput {
  x: number;
  y: number;
  w: number;
  h: number;
  /** One-indexed and required for PDF evidence. */
  page?: number;
  /** Exact retained document page count; required for PDF evidence. */
  pageCount?: number;
}

export interface NodeSlideNormalizedEvidenceRegion {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly page?: number;
  readonly pageCount?: number;
}

/** Exact immutable custody chain from one generated claim to one visual source region. */
export interface NodeSlideClaimEvidenceReceipt {
  readonly schema: typeof NODESLIDE_CLAIM_EVIDENCE_RECEIPT_SCHEMA;
  readonly receiptId: string;
  readonly receiptDigest: string;
  readonly deckId: string;
  readonly slideId: string;
  readonly elementId: string;
  readonly claimDigest: string;
  readonly sourceRevisionId: string;
  readonly sourceRevisionDigest: string;
  readonly captureId: string;
  readonly captureDigest: string;
  readonly evidenceStepId: string;
  readonly evidenceStepDigest: string;
  readonly attachmentKind: NodeSlideEvidenceRegionKind;
  readonly attachmentDigest: string;
  readonly region: NodeSlideNormalizedEvidenceRegion;
}

export interface BuildNodeSlideClaimEvidenceReceiptArgs {
  deckId: string;
  slideId: string;
  elementId: string;
  claimDigest: string;
  sourceRevisionId: string;
  sourceRevisionDigest: string;
  captureId: string;
  captureDigest: string;
  evidenceStepId: string;
  evidenceStepDigest: string;
  attachmentKind: NodeSlideEvidenceRegionKind;
  attachmentDigest: string;
  region: NodeSlideEvidenceRegionInput;
}

type ReceiptPayload = Omit<NodeSlideClaimEvidenceReceipt, 'receiptId' | 'receiptDigest'>;

export function buildNodeSlideClaimEvidenceReceipt(
  args: BuildNodeSlideClaimEvidenceReceiptArgs,
): NodeSlideClaimEvidenceReceipt {
  const payload: ReceiptPayload = {
    schema: NODESLIDE_CLAIM_EVIDENCE_RECEIPT_SCHEMA,
    deckId: requiredId(args.deckId, 'deck ID'),
    slideId: requiredId(args.slideId, 'slide ID'),
    elementId: requiredId(args.elementId, 'element ID'),
    claimDigest: canonicalDigest(args.claimDigest, 'claim digest'),
    sourceRevisionId: canonicalSourceRevisionId(args.sourceRevisionId, args.sourceRevisionDigest),
    sourceRevisionDigest: canonicalDigest(args.sourceRevisionDigest, 'source revision digest'),
    captureId: requiredId(args.captureId, 'capture ID'),
    captureDigest: canonicalDigest(args.captureDigest, 'capture digest'),
    evidenceStepId: requiredId(args.evidenceStepId, 'evidence step ID'),
    evidenceStepDigest: canonicalDigest(args.evidenceStepDigest, 'evidence step digest'),
    attachmentKind: canonicalAttachmentKind(args.attachmentKind),
    attachmentDigest: canonicalDigest(args.attachmentDigest, 'attachment digest'),
    region: normalizeNodeSlideEvidenceRegion(args.attachmentKind, args.region),
  };
  const receiptDigest = receiptPayloadDigest(payload);
  const receipt = {
    ...payload,
    receiptId: `claim-evidence-receipt:${receiptDigest}`,
    receiptDigest,
  } satisfies NodeSlideClaimEvidenceReceipt;
  assertNodeSlideClaimEvidenceReceipt(receipt);
  return deepFreeze(receipt);
}

/**
 * Validates a normalized region without changing its semantic target. Six decimal
 * places are retained to keep receipts deterministic across renderer boundaries.
 */
export function normalizeNodeSlideEvidenceRegion(
  kind: NodeSlideEvidenceRegionKind,
  input: NodeSlideEvidenceRegionInput,
): NodeSlideNormalizedEvidenceRegion {
  canonicalAttachmentKind(kind);
  if (!isRecord(input)) invalid('region must be an object');
  const x = normalizedCoordinate(input.x, 'region x', true);
  const y = normalizedCoordinate(input.y, 'region y', true);
  const w = normalizedCoordinate(input.w, 'region width', false);
  const h = normalizedCoordinate(input.h, 'region height', false);
  if (rounded(x + w) > 1 || rounded(y + h) > 1) {
    invalid('region must fit within normalized page bounds');
  }

  if (kind === 'pdf') {
    const page = positiveInteger(input.page, 'PDF region page');
    const pageCount = positiveInteger(input.pageCount, 'PDF region page count');
    if (pageCount > MAX_PDF_PAGES) invalid(`PDF page count exceeds ${MAX_PDF_PAGES}`);
    if (page > pageCount) invalid('PDF region page exceeds the retained page count');
    return deepFreeze({ x, y, w, h, page, pageCount });
  }
  if (input.page !== undefined || input.pageCount !== undefined) {
    invalid('screenshot regions cannot contain PDF page bounds');
  }
  return deepFreeze({ x, y, w, h });
}

/** Rejects a broken custody link, invalid page box, or any post-build tampering. */
export function assertNodeSlideClaimEvidenceReceipt(
  value: unknown,
): asserts value is NodeSlideClaimEvidenceReceipt {
  if (!isRecord(value)) invalid('must be an object');
  const allowed = new Set([
    'schema',
    'receiptId',
    'receiptDigest',
    'deckId',
    'slideId',
    'elementId',
    'claimDigest',
    'sourceRevisionId',
    'sourceRevisionDigest',
    'captureId',
    'captureDigest',
    'evidenceStepId',
    'evidenceStepDigest',
    'attachmentKind',
    'attachmentDigest',
    'region',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    invalid('contains fields outside the immutable receipt contract');
  }
  if (value['schema'] !== NODESLIDE_CLAIM_EVIDENCE_RECEIPT_SCHEMA) invalid('schema is invalid');
  if (typeof value['receiptId'] !== 'string' || !RECEIPT_ID.test(value['receiptId'])) {
    invalid('receipt ID is invalid');
  }
  canonicalDigest(value['receiptDigest'], 'receipt digest');
  requiredId(value['deckId'], 'deck ID');
  requiredId(value['slideId'], 'slide ID');
  requiredId(value['elementId'], 'element ID');
  canonicalDigest(value['claimDigest'], 'claim digest');
  canonicalSourceRevisionId(value['sourceRevisionId'], value['sourceRevisionDigest']);
  canonicalDigest(value['sourceRevisionDigest'], 'source revision digest');
  requiredId(value['captureId'], 'capture ID');
  canonicalDigest(value['captureDigest'], 'capture digest');
  requiredId(value['evidenceStepId'], 'evidence step ID');
  canonicalDigest(value['evidenceStepDigest'], 'evidence step digest');
  const attachmentKind = canonicalAttachmentKind(value['attachmentKind']);
  canonicalDigest(value['attachmentDigest'], 'attachment digest');
  if (!isRecord(value['region'])) invalid('region must be an object');
  const canonicalRegion = normalizeNodeSlideEvidenceRegion(
    attachmentKind,
    value['region'] as unknown as NodeSlideEvidenceRegionInput,
  );
  if (stableJson(canonicalRegion) !== stableJson(value['region'])) {
    invalid('region is not canonical');
  }

  const { receiptId: _receiptId, receiptDigest, ...payload } = value;
  const expectedDigest = receiptPayloadDigest(payload as ReceiptPayload);
  if (receiptDigest !== expectedDigest) invalid('digest binding is invalid');
  if (value['receiptId'] !== `claim-evidence-receipt:${expectedDigest}`) {
    invalid('receipt ID is not bound to its digest');
  }
}

export function isNodeSlideClaimEvidenceReceipt(
  value: unknown,
): value is NodeSlideClaimEvidenceReceipt {
  try {
    assertNodeSlideClaimEvidenceReceipt(value);
    return true;
  } catch {
    return false;
  }
}

function receiptPayloadDigest(payload: ReceiptPayload): string {
  return nodeslideContentDigest(stableJson(payload));
}

function canonicalSourceRevisionId(value: unknown, digest: unknown): string {
  const revisionId = requiredId(value, 'source revision ID');
  const revisionDigest = canonicalDigest(digest, 'source revision digest');
  if (!SOURCE_REVISION_ID.test(revisionId) || revisionId !== `source-revision:${revisionDigest}`) {
    invalid('source revision ID is not bound to its digest');
  }
  return revisionId;
}

function canonicalAttachmentKind(value: unknown): NodeSlideEvidenceRegionKind {
  if (value !== 'screenshot' && value !== 'pdf') invalid('attachment kind is invalid');
  return value;
}

function canonicalDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA_256_DIGEST.test(value)) {
    invalid(`${label} must be a canonical SHA-256 digest`);
  }
  return value;
}

function requiredId(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_ID_LENGTH ||
    value.trim() !== value
  ) {
    invalid(`${label} must be non-empty, trimmed, and at most ${MAX_ID_LENGTH} characters`);
  }
  return value;
}

function normalizedCoordinate(value: unknown, label: string, zeroAllowed: boolean): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`${label} must be finite`);
  const normalized = rounded(value);
  if (normalized < 0 || normalized > 1 || (!zeroAllowed && normalized === 0)) {
    invalid(`${label} must be ${zeroAllowed ? 'between 0 and 1' : 'greater than 0 and at most 1'}`);
  }
  return normalized;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    invalid(`${label} must be a positive safe integer`);
  }
  return Number(value);
}

function rounded(value: number): number {
  return Math.round(value * COORDINATE_PRECISION) / COORDINATE_PRECISION;
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
  throw new Error(`NodeSlide claim evidence receipt ${reason}.`);
}
