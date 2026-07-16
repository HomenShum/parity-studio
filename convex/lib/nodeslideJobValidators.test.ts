import { describe, expect, it } from 'vitest';
import { nodeSlideJobRequestDigest } from './nodeslideJobState';
import {
  type NodeSlideCreateJobRequest,
  type NodeSlideEditProposalJobRequest,
  nodeSlideCreateJobRequestFromArgs,
  nodeSlideEditProposalJobRequestFromArgs,
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

  it('binds edit scope, clocks, and every external-consent receipt into the durable request', () => {
    const first = canonicalEditRequest({
      providerConsent: 'openrouter_edit_review_v1',
      webResearchConsent: 'nodeslide_web_research_v1',
    });
    const substitutedConsent = canonicalEditRequest({
      providerConsent: 'different-consent',
      webResearchConsent: 'nodeslide_web_research_v1',
    });
    const substitutedClock = canonicalEditRequest({ baseDeckVersion: 8 });
    const substitutedBudget = canonicalEditRequest({ maxCostUsd: 0.25 });

    expect(nodeSlideJobRequestDigest(first)).not.toBe(
      nodeSlideJobRequestDigest(substitutedConsent),
    );
    expect(nodeSlideJobRequestDigest(first)).not.toBe(nodeSlideJobRequestDigest(substitutedClock));
    expect(nodeSlideJobRequestDigest(first)).not.toBe(nodeSlideJobRequestDigest(substitutedBudget));
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

function canonicalEditRequest(overrides: Partial<NodeSlideEditProposalJobRequest>) {
  return nodeSlideEditProposalJobRequestFromArgs({ ...editRequest(), ...overrides });
}

function editRequest(): NodeSlideEditProposalJobRequest {
  return {
    clientSessionId: 'session-a',
    deckId: 'deck-a',
    instruction: 'Make the title more decisive.',
    baseDeckVersion: 7,
    baseSlideVersions: { slide_a: 3 },
    baseElementVersions: { element_a: 2 },
    scope: {
      kind: 'slide',
      deckId: 'deck-a',
      slideIds: ['slide_a'],
      operationMode: 'copy',
    },
    providerMode: 'openrouter_free',
    providerModel: 'openai/gpt-5.6-terra',
    providerEffort: 'high',
    providerConsent: 'openrouter_edit_review_v1',
    webResearch: true,
    webResearchConsent: 'nodeslide_web_research_v1',
    memoryMode: 'relevant',
  };
}
