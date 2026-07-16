import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_UPLOAD_POLICIES,
  assertNodeSlideStoredFileMatches,
  assertNodeSlideUploadModelAccessible,
  isNodeSlideUploadModelAccessible,
  nodeSlideUploadRequestFingerprint,
  validateNodeSlideUploadRequest,
} from './nodeslideUploadPolicy';

const DIGEST = 'sha256-digest-value';

function request(overrides: Partial<Parameters<typeof validateNodeSlideUploadRequest>[0]> = {}) {
  return {
    fileName: 'brief.pdf',
    contentType: 'application/pdf',
    byteSize: 1_024,
    contentDigest: DIGEST,
    clientSessionId: 'session_1',
    idempotencyKey: 'upload_1',
    ...overrides,
  };
}

describe('NodeSlide upload policy', () => {
  it('covers the requested structured, office, image, and presentation formats', () => {
    expect(NODESLIDE_UPLOAD_POLICIES.map(({ format }) => format)).toEqual([
      'csv',
      'json',
      'txt',
      'md',
      'pdf',
      'docx',
      'xlsx',
      'png',
      'jpeg',
      'webp',
      'gif',
      'pptx',
    ]);
  });

  it('normalizes MIME parameters and binds the matching extension', () => {
    expect(
      validateNodeSlideUploadRequest(request({ contentType: 'Application/PDF; charset=binary' })),
    ).toMatchObject({ format: 'pdf', contentType: 'application/pdf' });
  });

  it.each([
    { fileName: '../brief.pdf' },
    { fileName: 'brief.exe', contentType: 'application/octet-stream' },
    { fileName: 'brief.pdf', contentType: 'image/png' },
    { fileName: 'brief.svg', contentType: 'image/svg+xml' },
    { fileName: 'brief.pdf', byteSize: 25 * 1024 * 1024 + 1 },
    { fileName: 'brief.pdf', byteSize: 0 },
  ])('rejects an unsafe or unsupported upload: %o', (override) => {
    expect(() => validateNodeSlideUploadRequest(request(override))).toThrow(/NodeSlide|invalid/i);
  });

  it('verifies MIME, size, and digest against storage metadata', () => {
    const normalized = validateNodeSlideUploadRequest(request());
    expect(() =>
      assertNodeSlideStoredFileMatches(normalized, {
        contentType: 'application/pdf',
        size: 1_024,
        sha256: DIGEST,
      }),
    ).not.toThrow();
    expect(() =>
      assertNodeSlideStoredFileMatches(normalized, {
        contentType: 'application/pdf',
        size: 1_025,
        sha256: DIGEST,
      }),
    ).toThrow(/size/i);
    expect(() =>
      assertNodeSlideStoredFileMatches(normalized, {
        contentType: 'application/pdf',
        size: 1_024,
        sha256: 'different',
      }),
    ).toThrow(/digest/i);
  });

  it('produces a stable fingerprint and changes it when content changes', () => {
    const first = validateNodeSlideUploadRequest(request());
    const replay = validateNodeSlideUploadRequest(request());
    const changed = validateNodeSlideUploadRequest(request({ contentDigest: 'other-digest' }));
    expect(nodeSlideUploadRequestFingerprint('deck_1', first)).toBe(
      nodeSlideUploadRequestFingerprint('deck_1', replay),
    );
    expect(nodeSlideUploadRequestFingerprint('deck_1', first)).not.toBe(
      nodeSlideUploadRequestFingerprint('deck_1', changed),
    );
  });

  it('allows model access only after registration, approval, and quarantine release', () => {
    const approved = {
      lifecycleStatus: 'registered' as const,
      securityStatus: 'approved' as const,
      quarantineStatus: 'released' as const,
    };
    expect(isNodeSlideUploadModelAccessible(approved)).toBe(true);
    expect(() => assertNodeSlideUploadModelAccessible(approved)).not.toThrow();

    for (const inaccessible of [
      { ...approved, lifecycleStatus: 'awaiting_upload' as const },
      { ...approved, securityStatus: 'pending' as const },
      { ...approved, securityStatus: 'rejected' as const },
      { ...approved, quarantineStatus: 'quarantined' as const },
    ]) {
      expect(isNodeSlideUploadModelAccessible(inaccessible)).toBe(false);
      expect(() => assertNodeSlideUploadModelAccessible(inaccessible)).toThrow(/not approved/i);
    }
  });
});
