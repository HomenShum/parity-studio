import { describe, expect, it } from 'vitest';
import { nodeSlideJobRequestDigest } from './nodeslideJobState';
import {
  type NodeSlideCreateJobRequest,
  nodeSlideCreateJobRequestFromArgs,
} from './nodeslideJobValidators';

describe('NodeSlide durable job request journal', () => {
  it('omits the preview access secret while binding every durable request field', () => {
    const first = canonicalRequest({ accessCode: 'preview-secret-a' });
    const resumed = canonicalRequest({ accessCode: 'preview-secret-b' });
    const substituted = canonicalRequest({
      accessCode: 'preview-secret-a',
      brief: { ...request().brief, prompt: 'Build a substituted deck' },
    });

    expect(first).not.toHaveProperty('accessCode');
    expect(nodeSlideJobRequestDigest(first)).toBe(nodeSlideJobRequestDigest(resumed));
    expect(nodeSlideJobRequestDigest(first)).not.toBe(nodeSlideJobRequestDigest(substituted));
  });
});

function canonicalRequest(overrides: Partial<NodeSlideCreateJobRequest>) {
  return nodeSlideCreateJobRequestFromArgs({ ...request(), ...overrides });
}

function request(): NodeSlideCreateJobRequest {
  return {
    accessCode: 'preview-secret',
    clientSessionId: 'session-a',
    title: 'Launch review',
    brief: {
      prompt: 'Build a launch review',
      audience: 'Leadership',
      purpose: 'Decision support',
      successCriteria: ['Six editable slides'],
    },
    themeId: 'editorial-signal',
    route: 'free',
    providerMode: 'deterministic',
    attachments: [],
  };
}
