import type {
  NodeSlideStoredAttachmentFormat,
  NodeSlideUploadLifecycleStatus,
  NodeSlideUploadQuarantineStatus,
  NodeSlideUploadSecurityStatus,
} from '../../shared/nodeslideAttachments';
import { nodeslideContentDigest } from './nodeslideIds';

export const NODESLIDE_UPLOAD_LIMITS = {
  fileNameCharacters: 180,
  clientSessionIdCharacters: 256,
  idempotencyKeyCharacters: 160,
  digestCharacters: 128,
  listItems: 100,
} as const;

export type NodeSlideUploadPolicy = {
  format: NodeSlideStoredAttachmentFormat;
  extensions: readonly string[];
  contentTypes: readonly string[];
  maxBytes: number;
};

const MiB = 1024 * 1024;

export const NODESLIDE_UPLOAD_POLICIES: readonly NodeSlideUploadPolicy[] = [
  { format: 'csv', extensions: ['csv'], contentTypes: ['text/csv'], maxBytes: 10 * MiB },
  {
    format: 'json',
    extensions: ['json'],
    contentTypes: ['application/json'],
    maxBytes: 10 * MiB,
  },
  { format: 'txt', extensions: ['txt'], contentTypes: ['text/plain'], maxBytes: 5 * MiB },
  {
    format: 'md',
    extensions: ['md', 'markdown'],
    contentTypes: ['text/markdown'],
    maxBytes: 5 * MiB,
  },
  {
    format: 'pdf',
    extensions: ['pdf'],
    contentTypes: ['application/pdf'],
    maxBytes: 25 * MiB,
  },
  {
    format: 'docx',
    extensions: ['docx'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    maxBytes: 25 * MiB,
  },
  {
    format: 'xlsx',
    extensions: ['xlsx'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    maxBytes: 25 * MiB,
  },
  { format: 'png', extensions: ['png'], contentTypes: ['image/png'], maxBytes: 15 * MiB },
  {
    format: 'jpeg',
    extensions: ['jpg', 'jpeg'],
    contentTypes: ['image/jpeg'],
    maxBytes: 15 * MiB,
  },
  {
    format: 'webp',
    extensions: ['webp'],
    contentTypes: ['image/webp'],
    maxBytes: 15 * MiB,
  },
  { format: 'gif', extensions: ['gif'], contentTypes: ['image/gif'], maxBytes: 15 * MiB },
  {
    format: 'pptx',
    extensions: ['pptx'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    maxBytes: 50 * MiB,
  },
] as const;

export type NodeSlideUploadRequest = {
  fileName: string;
  contentType: string;
  byteSize: number;
  contentDigest: string;
  clientSessionId: string;
  idempotencyKey: string;
};

export type NormalizedNodeSlideUploadRequest = NodeSlideUploadRequest & {
  format: NodeSlideStoredAttachmentFormat;
};

export type NodeSlideStoredFileMetadata = {
  sha256: string;
  size: number;
  contentType?: string;
};

export function validateNodeSlideUploadRequest(
  request: NodeSlideUploadRequest,
): NormalizedNodeSlideUploadRequest {
  const fileName = requiredFileName(request.fileName);
  const contentType = normalizeContentType(request.contentType);
  const byteSize = requiredPositiveInteger(request.byteSize, 'Upload byte size');
  const contentDigest = requiredOpaqueValue(
    request.contentDigest,
    'Upload content digest',
    NODESLIDE_UPLOAD_LIMITS.digestCharacters,
  );
  const clientSessionId = requiredOpaqueValue(
    request.clientSessionId,
    'Client session ID',
    NODESLIDE_UPLOAD_LIMITS.clientSessionIdCharacters,
  );
  const idempotencyKey = requiredOpaqueValue(
    request.idempotencyKey,
    'Upload idempotency key',
    NODESLIDE_UPLOAD_LIMITS.idempotencyKeyCharacters,
  );
  const extension = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  const policy = NODESLIDE_UPLOAD_POLICIES.find(
    (candidate) =>
      candidate.extensions.includes(extension) && candidate.contentTypes.includes(contentType),
  );
  if (!policy) {
    throw new Error('NodeSlide upload type is not allowed or does not match its file extension.');
  }
  if (byteSize > policy.maxBytes) {
    throw new Error(`NodeSlide ${policy.format.toUpperCase()} upload exceeds its size limit.`);
  }

  return {
    fileName,
    contentType,
    byteSize,
    contentDigest,
    clientSessionId,
    idempotencyKey,
    format: policy.format,
  };
}

export function assertNodeSlideStoredFileMatches(
  expected: Pick<NormalizedNodeSlideUploadRequest, 'contentType' | 'byteSize' | 'contentDigest'>,
  actual: NodeSlideStoredFileMetadata | null,
): asserts actual is NodeSlideStoredFileMetadata {
  if (!actual) throw new Error('NodeSlide uploaded file was not found in storage.');
  if (normalizeContentType(actual.contentType ?? '') !== expected.contentType) {
    throw new Error('NodeSlide uploaded file MIME type does not match the prepared upload.');
  }
  if (actual.size !== expected.byteSize) {
    throw new Error('NodeSlide uploaded file size does not match the prepared upload.');
  }
  if (actual.sha256 !== expected.contentDigest) {
    throw new Error('NodeSlide uploaded file digest does not match the prepared upload.');
  }
}

export function nodeSlideUploadRequestFingerprint(
  deckId: string,
  request: NormalizedNodeSlideUploadRequest,
): string {
  return nodeslideContentDigest(
    [
      'nodeslide-upload/v1',
      deckId,
      request.clientSessionId,
      request.idempotencyKey,
      request.fileName,
      request.format,
      request.contentType,
      String(request.byteSize),
      request.contentDigest,
    ].join('\u001f'),
  );
}

export function isNodeSlideUploadModelAccessible(upload: {
  lifecycleStatus: NodeSlideUploadLifecycleStatus;
  securityStatus: NodeSlideUploadSecurityStatus;
  quarantineStatus: NodeSlideUploadQuarantineStatus;
}): boolean {
  return (
    upload.lifecycleStatus === 'registered' &&
    upload.securityStatus === 'approved' &&
    upload.quarantineStatus === 'released'
  );
}

export function assertNodeSlideUploadModelAccessible(upload: {
  lifecycleStatus: NodeSlideUploadLifecycleStatus;
  securityStatus: NodeSlideUploadSecurityStatus;
  quarantineStatus: NodeSlideUploadQuarantineStatus;
}): void {
  if (!isNodeSlideUploadModelAccessible(upload)) {
    throw new Error('NodeSlide upload is not approved for model access.');
  }
}

function requiredFileName(value: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > NODESLIDE_UPLOAD_LIMITS.fileNameCharacters ||
    hasUnsafeFileNameCharacters(normalized) ||
    normalized === '.' ||
    normalized === '..' ||
    !normalized.includes('.')
  ) {
    throw new Error('NodeSlide upload file name is invalid.');
  }
  return normalized;
}

function hasUnsafeFileNameCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character === '/' || character === '\\' || code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function normalizeContentType(value: string): string {
  const normalized = value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (
    !normalized ||
    normalized.length > 160 ||
    !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(normalized)
  ) {
    throw new Error('NodeSlide upload MIME type is invalid.');
  }
  return normalized;
}

function requiredPositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} is invalid.`);
  return value;
}

function requiredOpaqueValue(value: string, label: string, maxCharacters: number): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maxCharacters ||
    !/^[A-Za-z0-9._~+/:=@-]+$/u.test(normalized)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}
