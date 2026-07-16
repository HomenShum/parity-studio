/**
 * Provider-neutral contracts for a durable NodeSlide session.
 *
 * This module deliberately contains no Convex, provider, or I/O dependency. Raw
 * capability material may be used to calculate a binding, but the returned
 * metadata contains only safe descriptors and digests.
 */

export const NODESLIDE_DURABLE_SESSION_VERSION = 'nodeslide.durable-session/v2' as const;
export const NODESLIDE_CAPABILITY_DIGEST_VERSION = 'nodeslide.capability-digest/v2' as const;
export const NODESLIDE_REQUEST_BINDING_VERSION = 'nodeslide.request-binding/v2' as const;
export const NODESLIDE_DURABLE_SESSION_MAX_EVENTS = 256 as const;

export const NODESLIDE_DURABLE_JOB_STATUSES = [
  'queued',
  'running',
  'retrying',
  'paused',
  'awaiting_review',
  'succeeded',
  'failed',
  'cancelled',
  'rejected',
  'stale',
] as const;

export type NodeSlideDurableJobStatus = (typeof NODESLIDE_DURABLE_JOB_STATUSES)[number];
export type NodeSlideEgressKind = 'none' | 'model' | 'web' | 'model_and_web';

export interface NodeSlideCapabilityMaterial {
  readonly provider?: string;
  readonly model?: string;
  readonly scopes?: readonly string[];
  readonly egress?: NodeSlideEgressKind;
  /** Accepted only as digest input; never returned by capability metadata. */
  readonly secret?: string;
  /** Accepted only as digest input; never returned by capability metadata. */
  readonly consent?: unknown;
  /** Accepted only as digest input; never returned by capability metadata. */
  readonly attachments?: readonly unknown[];
}

export interface NodeSlideCapabilityDigestMetadata {
  readonly schemaVersion: typeof NODESLIDE_CAPABILITY_DIGEST_VERSION;
  readonly capabilityDigest: string;
  readonly provider?: string;
  readonly model?: string;
  readonly scopes: readonly string[];
  readonly egress: NodeSlideEgressKind;
  readonly hasSecret: boolean;
  readonly hasConsent: boolean;
  readonly attachmentCount: number;
  readonly consentDigest?: string;
  readonly attachmentsDigest?: string;
}

export interface NodeSlideRequestBinding {
  readonly schemaVersion: typeof NODESLIDE_REQUEST_BINDING_VERSION;
  readonly requestDigest: string;
  readonly capabilityDigest: string;
}

export interface NodeSlideJobLease {
  readonly leaseId: string;
  readonly workerId: string;
  readonly attempt: number;
  readonly egressEpoch: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface NodeSlideDurableJobState {
  readonly jobId: string;
  readonly requestBinding: NodeSlideRequestBinding;
  readonly status: NodeSlideDurableJobStatus;
  /** Execution attempt. Resuming a paused job does not increment this value. */
  readonly attempt: number;
  /** Number of explicit retries from failed state. */
  readonly retryCount: number;
  /** Number of resumes from paused state. */
  readonly resumeCount: number;
  readonly maxAttempts: number;
  readonly lease?: NodeSlideJobLease;
  readonly reason?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly completedAt?: number;
}

export type NodeSlideDurableJobEventKind =
  | 'enqueued'
  | 'claimed'
  | 'transitioned'
  | 'retried'
  | 'resumed'
  | 'paused'
  | 'egress_rotated'
  | 'stale_fenced';

export interface NodeSlideDurableJobEvent {
  readonly schemaVersion: typeof NODESLIDE_DURABLE_SESSION_VERSION;
  readonly sequence: number;
  readonly stateVersion: number;
  readonly jobId: string;
  readonly kind: NodeSlideDurableJobEventKind;
  readonly fromStatus: NodeSlideDurableJobStatus | null;
  readonly toStatus: NodeSlideDurableJobStatus;
  readonly requestBinding: NodeSlideRequestBinding;
  readonly egressEpoch: number;
  readonly attempt: number;
  readonly occurredAt: number;
  readonly leaseId?: string;
  readonly reason?: string;
  readonly eventDigest: string;
}

export interface NodeSlideDurableSessionState {
  readonly schemaVersion: typeof NODESLIDE_DURABLE_SESSION_VERSION;
  readonly sessionId: string;
  readonly requestBinding: NodeSlideRequestBinding;
  readonly stateVersion: number;
  readonly egressEpoch: number;
  readonly activeJobId: string | null;
  readonly jobs: Readonly<Record<string, NodeSlideDurableJobState>>;
  readonly eventSequence: number;
  readonly events: readonly NodeSlideDurableJobEvent[];
}

export function createNodeSlideCapabilityDigestMetadata(
  material: NodeSlideCapabilityMaterial,
): NodeSlideCapabilityDigestMetadata {
  const scopes = uniqueStrings(material.scopes ?? []);
  const egress = material.egress ?? 'none';
  const hasSecret = material.secret !== undefined;
  const hasConsent = material.consent !== undefined;
  const attachments = material.attachments ?? [];
  const safeMaterial = {
    schemaVersion: NODESLIDE_CAPABILITY_DIGEST_VERSION,
    provider: material.provider ?? null,
    model: material.model ?? null,
    scopes,
    egress,
    secret: material.secret ?? null,
    consent: material.consent ?? null,
    attachments,
  };
  const metadata: NodeSlideCapabilityDigestMetadata = {
    schemaVersion: NODESLIDE_CAPABILITY_DIGEST_VERSION,
    capabilityDigest: nodeSlideDurableDigest(safeMaterial),
    ...(material.provider ? { provider: cleanDescriptor(material.provider, 'provider') } : {}),
    ...(material.model ? { model: cleanDescriptor(material.model, 'model') } : {}),
    scopes,
    egress,
    hasSecret,
    hasConsent,
    attachmentCount: attachments.length,
    ...(hasConsent ? { consentDigest: nodeSlideDurableDigest(material.consent) } : {}),
    ...(attachments.length > 0 ? { attachmentsDigest: nodeSlideDurableDigest(attachments) } : {}),
  };
  return metadata;
}

export function nodeSlideRequestDigest(request: unknown): string {
  return nodeSlideDurableDigest({ schemaVersion: NODESLIDE_REQUEST_BINDING_VERSION, request });
}

export function createNodeSlideRequestBinding(
  request: unknown,
  capability: Pick<NodeSlideCapabilityDigestMetadata, 'capabilityDigest'>,
): NodeSlideRequestBinding {
  return {
    schemaVersion: NODESLIDE_REQUEST_BINDING_VERSION,
    requestDigest: nodeSlideRequestDigest(request),
    capabilityDigest: capability.capabilityDigest,
  };
}

export function sameNodeSlideRequestBinding(
  left: NodeSlideRequestBinding,
  right: NodeSlideRequestBinding,
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.requestDigest === right.requestDigest &&
    left.capabilityDigest === right.capabilityDigest
  );
}

export function nodeSlideDurableDigest(value: unknown): string {
  return `sha256:${sha256Hex(stableSerialize(value))}`;
}

export function boundedNodeSlideReason(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const clean = value.replace(/\s+/gu, ' ').trim();
  return clean ? clean.slice(0, 600) : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => cleanDescriptor(value, 'scope')))].sort();
}

function cleanDescriptor(value: string, field: string): string {
  const clean = value.replace(/\s+/gu, ' ').trim();
  if (!clean || clean.length > 200) throw new Error(`NodeSlide ${field} descriptor is invalid.`);
  return clean;
}

function stableSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('NodeSlide digest input must be finite.');
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') return `"${value.toString()}n"`;
  if (typeof value === 'undefined') return 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (typeof value !== 'object') throw new Error('NodeSlide digest input has an unsupported type.');
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(',')}}`;
}

function sha256Hex(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLength = BigInt(bytes.length) * 8n;
  for (let index = 0; index < 8; index += 1) {
    padded[paddedLength - index - 1] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
  }
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
    0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1,
    0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
    0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee,
    0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const initial = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const rotate = (word: number, amount: number) => (word >>> amount) | (word << (32 - amount));
  const state = [...initial];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const at = offset + index * 4;
      words[index] =
        ((padded[at] ?? 0) << 24) |
        ((padded[at + 1] ?? 0) << 16) |
        ((padded[at + 2] ?? 0) << 8) |
        (padded[at + 3] ?? 0);
    }
    for (let index = 16; index < 64; index += 1) {
      const a = words[index - 15] ?? 0;
      const b = words[index - 2] ?? 0;
      words[index] =
        ((words[index - 16] ?? 0) +
          (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) +
          (words[index - 7] ?? 0) +
          (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) >>>
        0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotate(e ?? 0, 6) ^ rotate(e ?? 0, 11) ^ rotate(e ?? 0, 25);
      const choice = ((e ?? 0) & (f ?? 0)) ^ (~(e ?? 0) & (g ?? 0));
      const t1 = ((h ?? 0) + sigma1 + choice + (constants[index] ?? 0) + (words[index] ?? 0)) >>> 0;
      const sigma0 = rotate(a ?? 0, 2) ^ rotate(a ?? 0, 13) ^ rotate(a ?? 0, 22);
      const majority = ((a ?? 0) & (b ?? 0)) ^ ((a ?? 0) & (c ?? 0)) ^ ((b ?? 0) & (c ?? 0));
      const t2 = (sigma0 + majority) >>> 0;
      [h, g, f, e, d, c, b, a] = [g, f, e, ((d ?? 0) + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    state[0] = ((state[0] ?? 0) + (a ?? 0)) >>> 0;
    state[1] = ((state[1] ?? 0) + (b ?? 0)) >>> 0;
    state[2] = ((state[2] ?? 0) + (c ?? 0)) >>> 0;
    state[3] = ((state[3] ?? 0) + (d ?? 0)) >>> 0;
    state[4] = ((state[4] ?? 0) + (e ?? 0)) >>> 0;
    state[5] = ((state[5] ?? 0) + (f ?? 0)) >>> 0;
    state[6] = ((state[6] ?? 0) + (g ?? 0)) >>> 0;
    state[7] = ((state[7] ?? 0) + (h ?? 0)) >>> 0;
  }
  return state.map((word) => word.toString(16).padStart(8, '0')).join('');
}
