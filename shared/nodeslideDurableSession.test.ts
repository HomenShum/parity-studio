import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_DURABLE_JOB_STATUSES,
  createNodeSlideCapabilityDigestMetadata,
  nodeSlideDurableDigest,
  nodeSlideRequestDigest,
} from './nodeslideDurableSession';

describe('NodeSlide durable-session v2 shared contracts', () => {
  it('exposes only safe capability metadata while binding secret material by digest', () => {
    const secret = 'raw-provider-secret-do-not-persist';
    const consent = 'raw-consent-token-do-not-persist';
    const attachment = { name: 'private-brief.pptx', bytes: 'private attachment bytes' };
    const metadata = createNodeSlideCapabilityDigestMetadata({
      provider: 'nebius',
      model: 'glm',
      scopes: ['web', 'model', 'model'],
      egress: 'model_and_web',
      secret,
      consent,
      attachments: [attachment],
    });
    const serialized = JSON.stringify(metadata);

    expect(metadata).toMatchObject({
      provider: 'nebius',
      model: 'glm',
      scopes: ['model', 'web'],
      hasSecret: true,
      hasConsent: true,
      attachmentCount: 1,
    });
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(consent);
    expect(serialized).not.toContain('private-brief.pptx');
    expect(serialized).not.toContain('private attachment bytes');
    expect(metadata.capabilityDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(
      createNodeSlideCapabilityDigestMetadata({
        provider: 'nebius',
        model: 'glm',
        egress: 'model_and_web',
        secret: 'a-different-secret',
        consent,
        attachments: [attachment],
      }).capabilityDigest,
    ).not.toBe(metadata.capabilityDigest);
  });

  it('canonicalizes request digests independent of object key order', () => {
    expect(nodeSlideRequestDigest({ b: 2, a: 1 })).toBe(nodeSlideRequestDigest({ a: 1, b: 2 }));
    expect(nodeSlideDurableDigest('a')).not.toBe(nodeSlideDurableDigest('b'));
  });

  it('keeps the durable status vocabulary exhaustive', () => {
    expect(NODESLIDE_DURABLE_JOB_STATUSES).toEqual([
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
    ]);
  });
});
