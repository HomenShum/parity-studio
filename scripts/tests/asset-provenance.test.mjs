import { describe, expect, it } from 'vitest';
import { scanAssetMetadata, sha256, verifyEmbeddedAssets } from '../lib/asset-provenance.mjs';

/**
 * Embedding a real product screenshot ships whatever was on screen. These tests exist to prove the
 * gate fails closed — an unprovenanced or unreviewed capture must never slip through, and a "pair"
 * that is one image twice is a false claim regardless of how well provenanced each copy is.
 */

const imgA = Buffer.from('PNG-BYTES-ALPHA');
const imgB = Buffer.from('PNG-BYTES-BETA');

const reviewed = { reviewed: true, reviewedBy: 'reviewer', reviewedAt: '2026-07-22' };

function manifestFor(buffers) {
  return {
    assets: buffers.map((b, i) => ({
      path: `artifacts/capture-${i}.png`,
      sha256: sha256(b),
      sourcePolicyId: 'nodeslide-owned',
      secretsReview: { ...reviewed },
    })),
  };
}

describe('asset gate: provenance', () => {
  it('passes when every embedded image resolves to a reviewed, policied source', () => {
    const report = verifyEmbeddedAssets({
      embedded: [{ part: 'ppt/media/a.png', buffer: imgA }],
      manifest: manifestFor([imgA]),
    });
    expect(report.verdict).toBe('pass');
  });

  it('FAILS an embedded image that matches no declared source', () => {
    const report = verifyEmbeddedAssets({
      embedded: [{ part: 'ppt/media/rogue.png', buffer: imgB }],
      manifest: manifestFor([imgA]),
    });
    expect(report.verdict).toBe('fail');
    expect(report.assets[0].problems[0]).toMatch(/no manifest entry/);
  });

  it('FAILS when nobody has attested a secrets review', () => {
    const manifest = manifestFor([imgA]);
    manifest.assets[0].secretsReview = { reviewed: false };
    const report = verifyEmbeddedAssets({ embedded: [{ part: 'p', buffer: imgA }], manifest });
    expect(report.verdict).toBe('fail');
    expect(report.assets[0].problems[0]).toMatch(/no attested secrets review/);
  });

  it('FAILS when redistribution rights are unknown', () => {
    const manifest = manifestFor([imgA]);
    manifest.assets[0].sourcePolicyId = null;
    const report = verifyEmbeddedAssets({ embedded: [{ part: 'p', buffer: imgA }], manifest });
    expect(report.assets[0].problems.some((p) => /redistribution rights unknown/.test(p))).toBe(
      true,
    );
  });

  it('will not accept a review with no reviewer or no date', () => {
    const manifest = manifestFor([imgA]);
    manifest.assets[0].secretsReview = { reviewed: true, reviewedBy: null, reviewedAt: null };
    const report = verifyEmbeddedAssets({ embedded: [{ part: 'p', buffer: imgA }], manifest });
    expect(report.verdict).toBe('fail');
  });
});

describe('asset gate: pair honesty', () => {
  it('FAILS a two-state pair that is the same image twice', () => {
    const report = verifyEmbeddedAssets({
      embedded: [
        { part: 'ppt/media/image-5-1.png', buffer: imgA },
        { part: 'ppt/media/image-5-2.png', buffer: imgA },
      ],
      manifest: manifestFor([imgA]),
      pairs: [
        { label: 'before/after', parts: ['ppt/media/image-5-1.png', 'ppt/media/image-5-2.png'] },
      ],
    });
    expect(report.verdict).toBe('fail');
    expect(report.pairs[0].detail).toMatch(/byte-identical/);
  });

  it('passes a pair of genuinely different captures', () => {
    const report = verifyEmbeddedAssets({
      embedded: [
        { part: 'a', buffer: imgA },
        { part: 'b', buffer: imgB },
      ],
      manifest: manifestFor([imgA, imgB]),
      pairs: [{ label: 'before/after', parts: ['a', 'b'] }],
    });
    expect(report.verdict).toBe('pass');
    expect(report.pairs[0].detail).toMatch(/genuinely different/);
  });
});

describe('asset gate: metadata leaks', () => {
  it('catches a Windows user path leaked in a PNG text chunk', () => {
    const leaky = Buffer.from('....tEXtSoftware C:\\Users\\hshum\\capture.png....');
    expect(scanAssetMetadata(leaky).some((f) => f.rule === 'windows-user-path')).toBe(true);
  });

  it('catches an AWS key and a generic secret assignment', () => {
    expect(
      scanAssetMetadata(Buffer.from('tEXtcomment AKIAIOSFODNN7EXAMPLE zz')).length,
    ).toBeGreaterThan(0);
    expect(
      scanAssetMetadata(Buffer.from('tEXtnote api_key: sk-abcdefgh12345678 zz')).length,
    ).toBeGreaterThan(0);
  });

  it('does not flag ordinary metadata', () => {
    expect(scanAssetMetadata(Buffer.from('tEXtSoftware Playwright screenshot'))).toEqual([]);
  });
});

describe('asset gate: honest reporting', () => {
  it('says plainly when nobody attested a pixel review', () => {
    const manifest = manifestFor([imgA]);
    manifest.assets[0].secretsReview = { reviewed: false };
    const report = verifyEmbeddedAssets({ embedded: [{ part: 'p', buffer: imgA }], manifest });
    expect(report.pixelReview).toMatch(/none attested/);
  });

  it('surfaces captures cleared internally but NOT for external publication', () => {
    const manifest = manifestFor([imgA]);
    manifest.assets[0].secretsReview = {
      ...reviewed,
      externalPublicationCleared: false,
      findings: 'shows an internal request id',
    };
    const report = verifyEmbeddedAssets({ embedded: [{ part: 'p', buffer: imgA }], manifest });
    // Internally shippable, so the gate passes — but the restriction is reported, not buried.
    expect(report.verdict).toBe('pass');
    expect(report.flaggedForExternalPublication).toHaveLength(1);
    expect(report.flaggedForExternalPublication[0].findings).toMatch(/internal request id/);
  });
});
