import { describe, expect, it, vi } from 'vitest';
import {
  type DeckPatch,
  type DeckSnapshot,
  NODESLIDE_SCHEMA_VERSION,
  NODESLIDE_TOOLCHAIN_VERSION,
} from '../../shared/nodeslide';
import { applyDeckPatch } from '../../shared/nodeslidePatch';
import {
  createGoogleSlidesInboundExternalPlan,
  createGoogleSlidesOutboundExternalPlan,
} from '../../src/domains/nodeslide/integrations/googleSlides/googleSlides';
import type { NormalizedPresentationState } from '../../src/domains/nodeslide/integrations/syncContracts';
import { encryptOAuthSecret } from './nodeslideGoogleOAuth';
import {
  assertAcceptedInboundGoogleProposal,
  assertGoogleSlidesBatchUpdateResponse,
  assertVerifiedGoogleSlidesConvergence,
  createExactGoogleSlidesBootstrapBaseline,
  decodeGoogleRuntimeBaseline,
  encodeGoogleRuntimeBaseline,
  encodeGoogleRuntimePlan,
  resolveNodeSlideGoogleAccessToken,
} from './nodeslideGoogleSlidesRuntime';

const ENCRYPTION_KEY = Buffer.from(Array.from({ length: 32 }, (_, index) => index)).toString(
  'base64url',
);

describe('NodeSlide Google Slides runtime', () => {
  it('decrypts a current access token without refreshing or exposing ciphertext', async () => {
    const fetchMock = vi.fn();
    const result = await resolveNodeSlideGoogleAccessToken({
      credential: {
        accessTokenCiphertext: await encryptOAuthSecret('current-access', ENCRYPTION_KEY),
        refreshTokenCiphertext: await encryptOAuthSecret('refresh-secret', ENCRYPTION_KEY),
        accessTokenExpiresAt: 500_000,
        scopes: ['https://www.googleapis.com/auth/drive.file'],
        tokenType: 'Bearer',
        updatedAt: 7,
      },
      encryptionKey: ENCRYPTION_KEY,
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetch: fetchMock,
      now: 1_000,
    });

    expect(result).toEqual({ accessToken: 'current-access' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the encrypted refresh token and returns a CAS-bound encrypted update', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      expect(String(init?.body)).toContain('grant_type=refresh_token');
      expect(String(init?.body)).toContain('refresh_token=refresh-secret');
      return new Response(
        JSON.stringify({
          access_token: 'fresh-access',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/drive.file',
          token_type: 'Bearer',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const result = await resolveNodeSlideGoogleAccessToken({
      credential: {
        accessTokenCiphertext: await encryptOAuthSecret('expired-access', ENCRYPTION_KEY),
        refreshTokenCiphertext: await encryptOAuthSecret('refresh-secret', ENCRYPTION_KEY),
        accessTokenExpiresAt: 900,
        scopes: ['https://www.googleapis.com/auth/drive.file'],
        tokenType: 'Bearer',
        updatedAt: 23,
      },
      encryptionKey: ENCRYPTION_KEY,
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetch: fetchMock,
      now: 1_000,
    });

    expect(result.accessToken).toBe('fresh-access');
    expect(result.update).toMatchObject({
      expectedUpdatedAt: 23,
      accessTokenExpiresAt: 3_601_000,
      tokenType: 'Bearer',
    });
    expect(result.update?.accessTokenCiphertext).not.toContain('fresh-access');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed when an expired credential has no refresh token', async () => {
    await expect(
      resolveNodeSlideGoogleAccessToken({
        credential: {
          accessTokenCiphertext: await encryptOAuthSecret('expired-access', ENCRYPTION_KEY),
          accessTokenExpiresAt: 1,
          scopes: ['https://www.googleapis.com/auth/drive.file'],
          tokenType: 'Bearer',
          updatedAt: 1,
        },
        encryptionKey: ENCRYPTION_KEY,
        clientId: 'client-id',
        clientSecret: 'client-secret',
        fetch: vi.fn(),
        now: 10_000,
      }),
    ).rejects.toMatchObject({ code: 'reauthorization_required' });
  });

  it('rejects a current token whose stored grant no longer has per-file access', async () => {
    await expect(
      resolveNodeSlideGoogleAccessToken({
        credential: {
          accessTokenCiphertext: await encryptOAuthSecret('current-access', ENCRYPTION_KEY),
          refreshTokenCiphertext: await encryptOAuthSecret('refresh-secret', ENCRYPTION_KEY),
          accessTokenExpiresAt: 500_000,
          scopes: [],
          tokenType: 'Bearer',
          updatedAt: 1,
        },
        encryptionKey: ENCRYPTION_KEY,
        clientId: 'client-id',
        clientSecret: 'client-secret',
        fetch: vi.fn(),
        now: 1_000,
      }),
    ).rejects.toMatchObject({ code: 'reauthorization_required' });
  });

  it('attaches only an exact, safely writable positional match', () => {
    const local = localFixture();
    const remote = remoteFixture('Base');
    const baseline = createExactGoogleSlidesBootstrapBaseline(local, remote);

    expect(baseline.mapping.links).toHaveLength(3);
    expect(baseline.mapping.links).toContainEqual(
      expect.objectContaining({
        kind: 'element',
        localId: 'element-1',
        remoteId: 'google-element-1',
      }),
    );

    expect(() =>
      createExactGoogleSlidesBootstrapBaseline(local, remoteFixture('Different')),
    ).toThrowError(expect.objectContaining({ code: 'bootstrap_mismatch' }));
    const readOnly = remoteFixture('Base');
    const element = readOnly.slides[0]?.elements[0];
    if (!element) throw new Error('fixture element missing');
    element.writable = false;
    expect(() => createExactGoogleSlidesBootstrapBaseline(local, readOnly)).toThrow(
      /not safely writable/i,
    );
    const lossy = remoteFixture('Base');
    const lossyElement = lossy.slides[0]?.elements[0];
    if (!lossyElement) throw new Error('fixture element missing');
    lossyElement.lossy = true;
    expect(() => createExactGoogleSlidesBootstrapBaseline(local, lossy)).toThrow(
      /not safely writable/i,
    );
  });

  it('digest-binds bounded baselines and pending plans', () => {
    const baseline = createExactGoogleSlidesBootstrapBaseline(
      localFixture(),
      remoteFixture('Base'),
    );
    const encodedBaseline = encodeGoogleRuntimeBaseline(baseline);
    expect(decodeGoogleRuntimeBaseline(encodedBaseline.json, encodedBaseline.digest)).toEqual(
      baseline,
    );
    expect(() =>
      decodeGoogleRuntimeBaseline(
        encodedBaseline.json.replace('Mapped deck', 'Tampered deck'),
        encodedBaseline.digest,
      ),
    ).toThrow(/digest does not match/i);

    const planningInput = {
      baseline,
      local: structuredClone(baseline.local),
      remote: remoteFixture('Remote edit'),
    };
    const plan = createGoogleSlidesInboundExternalPlan(planningInput);
    const first = encodeGoogleRuntimePlan({ direction: 'inbound', planningInput, plan });
    const second = encodeGoogleRuntimePlan({
      direction: 'inbound',
      planningInput: structuredClone(planningInput),
      plan: structuredClone(plan),
    });
    expect(first.digest).toBe(second.digest);
  });

  it('binds pull finalization to the exact accepted proposal and resulting version', () => {
    const baseline = createExactGoogleSlidesBootstrapBaseline(
      localFixture(),
      remoteFixture('Base'),
    );
    const planningInput = {
      baseline,
      local: structuredClone(baseline.local),
      remote: remoteFixture('Remote edit'),
    };
    const plan = createGoogleSlidesInboundExternalPlan(planningInput);
    const acceptedLocal = applyDeckPatch(planningInput.local, plan.proposal, 10).snapshot;
    const patch = {
      id: 'google-pull-patch',
      deckId: plan.proposal.deckId,
      baseDeckVersion: plan.proposal.baseDeckVersion,
      baseSlideVersions: plan.proposal.baseSlideVersions,
      baseElementVersions: plan.proposal.baseElementVersions,
      resultingDeckVersion: acceptedLocal.deck.version,
      scope: plan.proposal.scope,
      operations: plan.proposal.operations,
      source: 'human',
      status: 'accepted',
      summary: 'Google pull',
      createdAt: 9,
      updatedAt: 10,
    } satisfies DeckPatch;

    expect(() =>
      assertAcceptedInboundGoogleProposal({
        patch,
        patchId: patch.id,
        plan,
        acceptedLocal,
      }),
    ).not.toThrow();
    expect(() =>
      assertAcceptedInboundGoogleProposal({
        patch: { ...patch, operations: [] },
        patchId: patch.id,
        plan,
        acceptedLocal,
      }),
    ).toThrowError(expect.objectContaining({ code: 'proposal_mismatch' }));
  });

  it('requires semantic convergence after a push, not only a changed revision', () => {
    const baseline = createExactGoogleSlidesBootstrapBaseline(
      localFixture(),
      remoteFixture('Base'),
    );
    const local = structuredClone(baseline.local);
    const element = local.elements[0];
    if (!element) throw new Error('fixture element missing');
    element.content = 'Pushed';
    element.version += 1;
    local.deck.version += 1;
    const verifiedRemote = remoteFixture('Pushed');
    verifiedRemote.revisionId = 'revision-after-write';
    const plan = createGoogleSlidesOutboundExternalPlan(
      { baseline, local, remote: remoteFixture('Base') },
      {
        strategy: 'read_after_write',
        remoteObjectId: 'presentation-1',
        compareAgainstVersionId: 'revision-current',
      },
    );

    expect(() =>
      assertVerifiedGoogleSlidesConvergence({ baseline, acceptedLocal: local, verifiedRemote }),
    ).not.toThrow();
    expect(() =>
      assertVerifiedGoogleSlidesConvergence({
        baseline,
        acceptedLocal: local,
        verifiedRemote: { ...remoteFixture('Unexpected'), revisionId: 'revision-after-write' },
      }),
    ).toThrowError(expect.objectContaining({ code: 'verification_failed' }));
    const providerCanonicalized = structuredClone(verifiedRemote);
    const remoteSlide = providerCanonicalized.slides[0];
    if (!remoteSlide) throw new Error('fixture slide missing');
    remoteSlide.title = 'Derived from the first textbox';
    expect(() =>
      assertVerifiedGoogleSlidesConvergence({
        baseline,
        acceptedLocal: local,
        verifiedRemote: providerCanonicalized,
        plan,
      }),
    ).not.toThrow();
    expect(() =>
      assertVerifiedGoogleSlidesConvergence({
        baseline,
        acceptedLocal: local,
        verifiedRemote: { ...remoteFixture('Unexpected'), revisionId: 'revision-after-write' },
        plan,
      }),
    ).toThrowError(expect.objectContaining({ code: 'verification_failed' }));
  });

  it('rejects incomplete batchUpdate receipts before read-after-write finalization', () => {
    const baseline = createExactGoogleSlidesBootstrapBaseline(
      localFixture(),
      remoteFixture('Base'),
    );
    const local = structuredClone(baseline.local);
    const element = local.elements[0];
    if (!element) throw new Error('fixture element missing');
    element.content = 'Pushed';
    const planningInput = { baseline, local, remote: remoteFixture('Base') };
    const plan = createGoogleSlidesOutboundExternalPlan(planningInput, {
      strategy: 'read_after_write',
      remoteObjectId: 'presentation-1',
      compareAgainstVersionId: 'revision-current',
    });
    const validResponse = {
      presentationId: 'presentation-1',
      replies: plan.batchUpdate.requests.map(() => ({})),
      writeControl: { requiredRevisionId: 'revision-after-write' },
    };

    expect(() => assertGoogleSlidesBatchUpdateResponse(plan, validResponse)).not.toThrow();
    expect(() =>
      assertGoogleSlidesBatchUpdateResponse(plan, {
        ...validResponse,
        presentationId: 'other-presentation',
      }),
    ).toThrowError(expect.objectContaining({ code: 'verification_failed' }));
    expect(() =>
      assertGoogleSlidesBatchUpdateResponse(plan, { ...validResponse, replies: [] }),
    ).toThrow(/incomplete write receipt/i);
  });
});

function localFixture(): DeckSnapshot {
  return {
    deck: {
      schemaVersion: NODESLIDE_SCHEMA_VERSION,
      toolchainVersion: NODESLIDE_TOOLCHAIN_VERSION,
      id: 'deck-1',
      projectId: 'project-1',
      title: 'Mapped deck',
      brief: {
        prompt: 'Test sync',
        audience: 'Builders',
        purpose: 'Test',
        successCriteria: ['No silent overwrite'],
      },
      theme: {
        id: 'theme-1',
        name: 'Theme',
        mode: 'light',
        colors: {
          canvas: '#ffffff',
          ink: '#111111',
          muted: '#666666',
          accent: '#3366ff',
          accentSoft: '#dde5ff',
          insight: '#ddffdd',
          insightInk: '#113311',
          trace: '#333333',
          border: '#dddddd',
        },
        typography: { display: 'Inter', body: 'Inter', data: 'Mono' },
        defaultRadius: 0,
        spacingUnit: 8,
      },
      slideOrder: ['slide-1'],
      version: 7,
      status: 'ready',
      createdAt: 1,
      updatedAt: 1,
    },
    slides: [
      {
        id: 'slide-1',
        deckId: 'deck-1',
        title: 'Slide title',
        background: '#ffffff',
        elementOrder: ['element-1'],
        version: 4,
      },
    ],
    elements: [
      {
        id: 'element-1',
        slideId: 'slide-1',
        name: 'Headline',
        kind: 'text',
        bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 },
        rotation: 0,
        content: 'Base',
        style: { color: '#111111', fontFamily: 'Inter', fontSize: 24, fontWeight: 400 },
        sourceIds: [],
        locked: false,
        exportCapabilities: ['web_native', 'google_importable'],
        version: 3,
      },
    ],
    sources: [],
  };
}

function remoteFixture(content: string): NormalizedPresentationState {
  return {
    provider: 'google_slides',
    remotePresentationId: 'presentation-1',
    revisionId: 'revision-current',
    title: 'Mapped deck',
    pageWidthEmu: 10_000_000,
    pageHeightEmu: 5_000_000,
    slides: [
      {
        remoteId: 'google-slide-1',
        title: 'Slide title',
        background: '#ffffff',
        elements: [
          {
            remoteId: 'google-element-1',
            remoteSlideId: 'google-slide-1',
            kind: 'text',
            name: 'Headline',
            bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 },
            rotation: 0,
            intrinsicWidthEmu: 5_000_000,
            intrinsicHeightEmu: 1_000_000,
            content,
            style: { color: '#111111', fontFamily: 'Inter', fontSize: 24, fontWeight: 400 },
            rawKind: 'shape',
            writable: true,
            lossy: false,
          },
        ],
      },
    ],
  };
}
