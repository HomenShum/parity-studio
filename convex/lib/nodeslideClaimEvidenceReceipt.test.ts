import { describe, expect, it } from 'vitest';
import {
  type BuildNodeSlideClaimEvidenceReceiptArgs,
  assertNodeSlideClaimEvidenceReceipt,
  buildNodeSlideClaimEvidenceReceipt,
  isNodeSlideClaimEvidenceReceipt,
  normalizeNodeSlideEvidenceRegion,
} from './nodeslideClaimEvidenceReceipt';

const DIGESTS = {
  claim: `sha256:${'1'.repeat(64)}`,
  sourceRevision: `sha256:${'2'.repeat(64)}`,
  capture: `sha256:${'3'.repeat(64)}`,
  step: `sha256:${'4'.repeat(64)}`,
  attachment: `sha256:${'5'.repeat(64)}`,
} as const;

describe('NodeSlide claim evidence receipts', () => {
  it('builds a deterministic, deeply frozen claim-to-region custody receipt', () => {
    const input = receiptArgs();
    const original = structuredClone(input);
    const first = buildNodeSlideClaimEvidenceReceipt(input);
    const second = buildNodeSlideClaimEvidenceReceipt({
      ...input,
      region: { x: 0.10000001, y: 0.2, w: 0.3, h: 0.4, page: 2, pageCount: 8 },
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schema: 'nodeslide.claim-evidence-receipt/v1',
      claimDigest: DIGESTS.claim,
      sourceRevisionId: `source-revision:${DIGESTS.sourceRevision}`,
      sourceRevisionDigest: DIGESTS.sourceRevision,
      captureId: 'capture-a',
      captureDigest: DIGESTS.capture,
      evidenceStepId: 'step-a',
      evidenceStepDigest: DIGESTS.step,
      attachmentKind: 'pdf',
      attachmentDigest: DIGESTS.attachment,
      region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4, page: 2, pageCount: 8 },
      receiptId: expect.stringMatching(/^claim-evidence-receipt:sha256:[0-9a-f]{64}$/),
      receiptDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(first.receiptId).toBe(`claim-evidence-receipt:${first.receiptDigest}`);
    expect(input).toEqual(original);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.region)).toBe(true);
    expect(() => assertNodeSlideClaimEvidenceReceipt(first)).not.toThrow();
    expect(isNodeSlideClaimEvidenceReceipt(first)).toBe(true);
  });

  it('normalizes valid screenshot boxes and rejects PDF-only page metadata', () => {
    expect(
      normalizeNodeSlideEvidenceRegion('screenshot', {
        x: 0,
        y: 0.123456789,
        w: 1,
        h: 0.876543211,
      }),
    ).toEqual({ x: 0, y: 0.123457, w: 1, h: 0.876543 });
    expect(() =>
      normalizeNodeSlideEvidenceRegion('screenshot', {
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        page: 1,
      }),
    ).toThrow('screenshot regions cannot contain PDF page bounds');
  });

  it('enforces normalized geometry and exact PDF page bounds', () => {
    const invalidRegions = [
      { x: -0.01, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0, w: 0, h: 0.5 },
      { x: 0.8, y: 0, w: 0.3, h: 0.5 },
      { x: 0, y: 0.8, w: 0.5, h: 0.3 },
      { x: Number.NaN, y: 0, w: 0.5, h: 0.5 },
    ];
    for (const region of invalidRegions) {
      expect(() => normalizeNodeSlideEvidenceRegion('screenshot', region)).toThrow();
    }

    expect(() => normalizeNodeSlideEvidenceRegion('pdf', { x: 0, y: 0, w: 1, h: 1 })).toThrow(
      'PDF region page must be a positive safe integer',
    );
    expect(() =>
      normalizeNodeSlideEvidenceRegion('pdf', {
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        page: 9,
        pageCount: 8,
      }),
    ).toThrow('PDF region page exceeds the retained page count');
    expect(() =>
      normalizeNodeSlideEvidenceRegion('pdf', {
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        page: 1,
        pageCount: 100_001,
      }),
    ).toThrow('PDF page count exceeds 100000');
  });

  it('rejects every broken digest or identity link in the custody chain', () => {
    const valid = receiptArgs();
    const invalid: BuildNodeSlideClaimEvidenceReceiptArgs[] = [
      { ...valid, claimDigest: 'sha256:short' },
      {
        ...valid,
        sourceRevisionId: `source-revision:sha256:${'9'.repeat(64)}`,
      },
      { ...valid, sourceRevisionDigest: 'not-a-digest' },
      { ...valid, captureId: ' capture-a' },
      { ...valid, captureDigest: 'not-a-digest' },
      { ...valid, evidenceStepId: '' },
      { ...valid, evidenceStepDigest: 'not-a-digest' },
      { ...valid, attachmentDigest: 'not-a-digest' },
    ];

    for (const input of invalid) {
      expect(() => buildNodeSlideClaimEvidenceReceipt(input)).toThrow();
    }
  });

  it('detects post-build tampering at every material custody hop', () => {
    const receipt = buildNodeSlideClaimEvidenceReceipt(receiptArgs());
    const mutations: unknown[] = [
      { ...receipt, claimDigest: `sha256:${'9'.repeat(64)}` },
      { ...receipt, sourceRevisionDigest: `sha256:${'9'.repeat(64)}` },
      { ...receipt, captureId: 'capture-b' },
      { ...receipt, captureDigest: `sha256:${'9'.repeat(64)}` },
      { ...receipt, evidenceStepId: 'step-b' },
      { ...receipt, evidenceStepDigest: `sha256:${'9'.repeat(64)}` },
      { ...receipt, attachmentDigest: `sha256:${'9'.repeat(64)}` },
      { ...receipt, region: { ...receipt.region, page: 3 } },
      { ...receipt, receiptDigest: `sha256:${'9'.repeat(64)}` },
      { ...receipt, receiptId: `claim-evidence-receipt:sha256:${'9'.repeat(64)}` },
      { ...receipt, unboundExtension: true },
    ];

    for (const tampered of mutations) {
      expect(() => assertNodeSlideClaimEvidenceReceipt(tampered)).toThrow();
      expect(isNodeSlideClaimEvidenceReceipt(tampered)).toBe(false);
    }
  });
});

function receiptArgs(): BuildNodeSlideClaimEvidenceReceiptArgs {
  return {
    deckId: 'deck-a',
    slideId: 'slide-a',
    elementId: 'element-a',
    claimDigest: DIGESTS.claim,
    sourceRevisionId: `source-revision:${DIGESTS.sourceRevision}`,
    sourceRevisionDigest: DIGESTS.sourceRevision,
    captureId: 'capture-a',
    captureDigest: DIGESTS.capture,
    evidenceStepId: 'step-a',
    evidenceStepDigest: DIGESTS.step,
    attachmentKind: 'pdf',
    attachmentDigest: DIGESTS.attachment,
    region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4, page: 2, pageCount: 8 },
  };
}
