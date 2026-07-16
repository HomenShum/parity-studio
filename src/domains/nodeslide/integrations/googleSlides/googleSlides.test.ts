import { describe, expect, it } from 'vitest';
import {
  type DeckSnapshot,
  NODESLIDE_SCHEMA_VERSION,
  NODESLIDE_TOOLCHAIN_VERSION,
  type SlideElement,
} from '../../../../../shared/nodeslide';
import { applyDeckPatch } from '../../../../../shared/nodeslidePatch';
import {
  type NormalizedPresentationElement,
  type NormalizedPresentationState,
  type PresentationSyncBaseline,
  type SyncObjectMapping,
  syncSemanticFingerprint,
} from '../syncContracts';
import { createGoogleSlidesAdapter } from './adapter';
import { GOOGLE_SLIDES_SYNC_CAPABILITIES } from './capabilities';
import {
  assertGoogleSlidesExternalPlanCurrent,
  createGoogleSlidesInboundExternalPlan,
  createGoogleSlidesOutboundExternalPlan,
  createGoogleSlidesPostAcceptanceReceipt,
  googleSlidesExternalSnapshotDigest,
} from './googleSlides';
import { normalizeGoogleSlidesPresentation } from './normalization';
import { planGoogleSlidesThreeWaySync } from './planning';
import type {
  GoogleSlidesBatchUpdatePlan,
  GoogleSlidesFetch,
  GoogleSlidesPresentation,
} from './types';

describe('Google Slides capability contract', () => {
  it('is honest about guarded writes and lossy/unsupported surfaces', () => {
    expect(GOOGLE_SLIDES_SYNC_CAPABILITIES.revisionGuardedWrites).toBe('supported');
    expect(GOOGLE_SLIDES_SYNC_CAPABILITIES.outboundWritePlanning).toBe('conditional');
    expect(GOOGLE_SLIDES_SYNC_CAPABILITIES.groups).toBe('unsupported');
    expect(GOOGLE_SLIDES_SYNC_CAPABILITIES.comments).toBe('unsupported');
    expect(GOOGLE_SLIDES_SYNC_CAPABILITIES.limitations.join(' ')).toContain(
      'nodeslide.proposePatch',
    );
  });
});

describe('presentations.get normalization', () => {
  it('normalizes text, geometry, notes, colors, revision, and caller hooks', () => {
    const source: GoogleSlidesPresentation = {
      presentationId: 'presentation-1',
      title: 'Quarterly review',
      revisionId: 'opaque-revision',
      pageSize: {
        width: { magnitude: 10_000_000, unit: 'EMU' },
        height: { magnitude: 5_000_000, unit: 'EMU' },
      },
      slides: [
        {
          objectId: 'google-slide-1',
          pageProperties: {
            pageBackgroundFill: {
              solidFill: { color: { rgbColor: { red: 1, green: 0.5, blue: 0 } } },
            },
          },
          pageElements: [
            {
              objectId: 'google-text-1',
              title: 'Headline',
              size: {
                width: { magnitude: 2_000_000, unit: 'EMU' },
                height: { magnitude: 500_000, unit: 'EMU' },
              },
              transform: {
                scaleX: 1,
                scaleY: 1,
                translateX: 1_000_000,
                translateY: 500_000,
                unit: 'EMU',
              },
              shape: {
                placeholder: { type: 'TITLE' },
                text: {
                  textElements: [
                    { paragraphMarker: { style: { alignment: 'CENTER' } } },
                    {
                      textRun: {
                        content: 'Revenue grew\n',
                        style: {
                          bold: true,
                          fontFamily: 'Inter',
                          fontSize: { magnitude: 24, unit: 'PT' },
                          foregroundColor: {
                            opaqueColor: { rgbColor: { red: 0, green: 0.2, blue: 0.4 } },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
          slideProperties: {
            notesPage: {
              objectId: 'notes-page-1',
              notesProperties: { speakerNotesObjectId: 'notes-shape-1' },
              pageElements: [
                {
                  objectId: 'notes-shape-1',
                  shape: { text: { textElements: [{ textRun: { content: 'Private note\n' } }] } },
                },
              ],
            },
          },
        },
      ],
    };

    const result = normalizeGoogleSlidesPresentation(source, {
      normalizeSlideTitle: (_context, defaultTitle) => `Hooked: ${defaultTitle}`,
    });

    expect(result.presentation.revisionId).toBe('opaque-revision');
    expect(result.presentation.slides[0]).toMatchObject({
      remoteId: 'google-slide-1',
      title: 'Hooked: Revenue grew',
      notes: 'Private note',
      background: '#ff8000',
    });
    expect(result.presentation.slides[0]?.elements[0]).toMatchObject({
      remoteId: 'google-text-1',
      kind: 'text',
      content: 'Revenue grew',
      bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
      style: {
        color: '#003366',
        fontFamily: 'Inter',
        fontSize: 24,
        fontWeight: 700,
        textAlign: 'center',
      },
      intrinsicWidthEmu: 2_000_000,
      intrinsicHeightEmu: 500_000,
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('reports read-only access when presentations.get omits revisionId', () => {
    const result = normalizeGoogleSlidesPresentation({
      presentationId: 'presentation-1',
      title: 'Read only',
      slides: [],
    });

    expect(result.presentation.revisionId).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe('google_revision_unavailable');
  });
});

describe('injectable Google Slides REST adapter', () => {
  it('injects auth into presentations.get and returns normalized state', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const fetch: GoogleSlidesFetch = async (input, init) => {
      calls.push({ input, ...(init ? { init } : {}) });
      return response({
        presentationId: 'deck/id',
        title: 'Fetched',
        revisionId: 'rev-fetched',
        slides: [],
      });
    };
    const adapter = createGoogleSlidesAdapter({
      fetch,
      auth: async () => ({ Authorization: 'Bearer injected-token' }),
      baseUrl: 'https://slides.test/v1/',
    });

    const result = await adapter.getPresentation('deck/id');

    expect(calls[0]?.input).toBe('https://slides.test/v1/presentations/deck%2Fid');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(calls[0]?.init?.headers).toMatchObject({ Authorization: 'Bearer injected-token' });
    expect(result.normalized.presentation.revisionId).toBe('rev-fetched');
  });

  it('executes only an exact requiredRevisionId-bound batchUpdate plan', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const fetch: GoogleSlidesFetch = async (input, init) => {
      calls.push({ input, ...(init ? { init } : {}) });
      return response({
        presentationId: 'presentation-1',
        writeControl: { requiredRevisionId: 'rev-2' },
      });
    };
    const adapter = createGoogleSlidesAdapter({
      fetch,
      auth: () => ({ Authorization: 'Bearer x' }),
    });
    const requests = [
      { insertText: { objectId: 'shape-1', insertionIndex: 0, text: 'Updated' } },
    ] as const;
    const plan: GoogleSlidesBatchUpdatePlan = {
      kind: 'google_slides_batch_update',
      provider: 'google_slides',
      presentationId: 'presentation-1',
      requiredRevisionId: 'rev-1',
      requests: [...requests],
      body: {
        requests: [...requests],
        writeControl: { requiredRevisionId: 'rev-1' },
      },
      blocked: false,
      blockedReasons: [],
    };
    await adapter.batchUpdate(plan);

    expect(calls[0]?.input).toContain('presentation-1:batchUpdate');
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      writeControl: { requiredRevisionId: 'rev-1' },
    });

    await expect(
      adapter.batchUpdate({
        ...plan,
        requiredRevisionId: undefined,
        body: undefined,
      } as unknown as GoogleSlidesBatchUpdatePlan),
    ).rejects.toThrow('requiredRevisionId');
  });
});

describe('three-way sync planning', () => {
  it('turns a remote-only text edit into a typed candidate patch with local CAS clocks', () => {
    const baseline = baselineFixture();
    const remote = remoteFixture('Edited in Google');

    const plan = planGoogleSlidesThreeWaySync({
      baseline,
      local: clone(baseline.local),
      remote,
    });

    expect(plan.inbound.operations).toContainEqual({
      op: 'replace_text',
      slideId: 'slide-1',
      elementId: 'element-1',
      text: 'Edited in Google',
    });
    expect(plan.inbound.baseDeckVersion).toBe(7);
    expect(plan.inbound.baseSlideVersions).toEqual({ 'slide-1': 4 });
    expect(plan.inbound.baseElementVersions).toEqual({ 'element-1': 3 });
    expect(plan.inbound.commit).toEqual({
      authority: 'nodeslide.proposePatch',
      usesCompareAndSwap: true,
      requiresHumanAcceptance: true,
    });
    const applied = applyDeckPatch(baseline.local, plan.inbound, 2).snapshot;
    expect(applied.elements[0]?.content).toBe('Edited in Google');
    expect(plan.outbound.requests).toEqual([]);
  });

  it('turns a local-only text edit into a revision-guarded batchUpdate plan', () => {
    const baseline = baselineFixture();
    const local = clone(baseline.local);
    const element = local.elements[0];
    if (!element) throw new Error('fixture element missing');
    element.content = 'Edited in NodeSlide';

    const plan = planGoogleSlidesThreeWaySync({ baseline, local, remote: remoteFixture('Base') });

    expect(plan.inbound.operations).toEqual([]);
    expect(plan.outbound.blocked).toBe(false);
    expect(plan.outbound.requiredRevisionId).toBe('revision-current');
    expect(plan.outbound.body?.writeControl.requiredRevisionId).toBe('revision-current');
    expect(plan.outbound.requests).toEqual([
      { deleteText: { objectId: 'google-element-1', textRange: { type: 'ALL' } } },
      {
        insertText: {
          objectId: 'google-element-1',
          insertionIndex: 0,
          text: 'Edited in NodeSlide',
        },
      },
    ]);
  });

  it('returns an explicit conflict instead of overwriting concurrent edits', () => {
    const baseline = baselineFixture();
    const local = clone(baseline.local);
    const element = local.elements[0];
    if (!element) throw new Error('fixture element missing');
    element.content = 'Local edit';

    const plan = planGoogleSlidesThreeWaySync({
      baseline,
      local,
      remote: remoteFixture('Remote edit'),
    });

    expect(plan.conflicts).toContainEqual(
      expect.objectContaining({
        code: 'concurrent_change',
        path: 'elements.element-1.content',
        resolution: 'manual',
      }),
    );
    expect(plan.inbound.operations).not.toContainEqual(
      expect.objectContaining({ op: 'replace_text', elementId: 'element-1' }),
    );
    expect(plan.outbound.requests).not.toContainEqual(
      expect.objectContaining({ insertText: expect.anything() }),
    );
  });

  it('blocks outbound changes when no requiredRevisionId is available', () => {
    const baseline = baselineFixture();
    const local = clone(baseline.local);
    const element = local.elements[0];
    if (!element) throw new Error('fixture element missing');
    element.content = 'Cannot push unguarded';
    const remote = {
      ...remoteFixture('Base'),
      revisionId: undefined,
    } as unknown as NormalizedPresentationState;

    const plan = planGoogleSlidesThreeWaySync({ baseline, local, remote });

    expect(plan.outbound.requests.length).toBeGreaterThan(0);
    expect(plan.outbound.blocked).toBe(true);
    expect(plan.outbound.body).toBeUndefined();
    expect(plan.outbound.blockedReasons[0]).toContain('refusing an unguarded');
  });

  it('recovers a changed Google objectId only by a unique semantic fingerprint', () => {
    const baseline = baselineFixture();
    const remote = remoteFixture('Base', 'google-element-rewritten');

    const plan = planGoogleSlidesThreeWaySync({
      baseline,
      local: clone(baseline.local),
      remote,
    });

    expect(plan.inbound.operations).toEqual([]);
    expect(plan.outbound.requests).toEqual([]);
    expect(plan.stagedMappingLinks).toContainEqual(
      expect.objectContaining({
        localId: 'element-1',
        remoteId: 'google-element-rewritten',
        semanticFingerprint: baseline.mapping.links[2]?.semanticFingerprint,
        commitAfter: 'verified_read',
      }),
    );
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'google_object_id_reconciled' }),
    );
  });

  it('uses a stable sanitized Google objectId and stages fingerprinted mapping for new local objects', () => {
    const baseline = baselineFixture();
    const local = clone(baseline.local);
    const added: SlideElement = {
      ...clone(local.elements[0] as SlideElement),
      id: 'node:headline/with spaces',
      name: 'Added headline',
      content: 'Added locally',
      version: 1,
    };
    local.elements.push(added);
    local.slides[0]?.elementOrder.push(added.id);

    const first = planGoogleSlidesThreeWaySync({ baseline, local, remote: remoteFixture('Base') });
    const second = planGoogleSlidesThreeWaySync({ baseline, local, remote: remoteFixture('Base') });
    const firstCreate = first.outbound.requests.find((request) => 'createShape' in request);
    const secondCreate = second.outbound.requests.find((request) => 'createShape' in request);
    if (
      !firstCreate ||
      !('createShape' in firstCreate) ||
      !secondCreate ||
      !('createShape' in secondCreate)
    ) {
      throw new Error('expected createShape request');
    }

    expect(firstCreate.createShape.objectId).toBe(secondCreate.createShape.objectId);
    expect(firstCreate.createShape.objectId).toMatch(/^[a-zA-Z0-9_][a-zA-Z0-9_:-]{4,49}$/u);
    expect(first.stagedMappingLinks).toContainEqual(
      expect.objectContaining({
        localId: added.id,
        remoteId: firstCreate.createShape.objectId,
        semanticFingerprint: expect.stringMatching(/^sync-semantic\/v1:/u),
        commitAfter: 'outbound_batch_update',
      }),
    );
  });
});

describe('canonical ExternalChangeSetV1 adapters', () => {
  it('binds an inbound PatchOperation proposal to exact local and remote planning witnesses', () => {
    const baseline = baselineFixture();
    const planningInput = {
      baseline,
      local: clone(baseline.local),
      remote: remoteFixture('Edited in Google'),
    };

    const first = createGoogleSlidesInboundExternalPlan(planningInput);
    const second = createGoogleSlidesInboundExternalPlan(clone(planningInput));

    expect(first.changeSet).toMatchObject({
      sourceSystem: 'google_slides',
      direction: 'inbound',
      remote: {
        objectId: 'presentation-1',
        versionId: 'revision-current',
        baselineId: first.binding.baselineDigest,
      },
      localBase: {
        deckId: 'deck-1',
        deckVersion: 7,
        slideVersions: { 'slide-1': 4 },
        elementVersions: { 'element-1': 3 },
      },
      operations: [
        {
          op: 'replace_text',
          slideId: 'slide-1',
          elementId: 'element-1',
          text: 'Edited in Google',
        },
      ],
    });
    expect(first.proposal).toMatchObject({
      kind: 'candidate_patch',
      commit: {
        authority: 'nodeslide.proposePatch',
        usesCompareAndSwap: true,
        requiresHumanAcceptance: true,
      },
      externalChangeSetDigest: first.changeSet.digest,
      remoteBaselineId: first.binding.baselineDigest,
      remoteVersionId: 'revision-current',
    });
    expect(first).not.toHaveProperty('advancedBaseline');
    expect(() => assertGoogleSlidesExternalPlanCurrent(first, planningInput)).not.toThrow();
    expect(second.binding).toEqual(first.binding);
    expect(second.changeSet.digest).toBe(first.changeSet.digest);
    expect(second.digest).toBe(first.digest);
  });

  it('fails a previously planned inbound handoff when either exact snapshot is stale', () => {
    const baseline = baselineFixture();
    const planningInput = {
      baseline,
      local: clone(baseline.local),
      remote: remoteFixture('Edited in Google'),
    };
    const plan = createGoogleSlidesInboundExternalPlan(planningInput);
    const staleRemote = clone(planningInput);
    staleRemote.remote.revisionId = 'revision-newer';
    const staleLocal = clone(planningInput);
    const staleElement = staleLocal.local.elements[0];
    if (!staleElement) throw new Error('fixture element missing');
    staleElement.content = 'Changed without re-planning';

    expect(() => assertGoogleSlidesExternalPlanCurrent(plan, staleRemote)).toThrow(
      'external plan is stale',
    );
    expect(() => assertGoogleSlidesExternalPlanCurrent(plan, staleLocal)).toThrow(
      'external plan is stale',
    );
  });

  it('creates only conflict-free, verification-bound outbound execution plans', () => {
    const baseline = baselineFixture();
    const local = clone(baseline.local);
    const element = local.elements[0];
    if (!element) throw new Error('fixture element missing');
    element.content = 'Edited in NodeSlide';
    const planningInput = { baseline, local, remote: remoteFixture('Base') };
    const verification = {
      strategy: 'read_after_write' as const,
      remoteObjectId: 'presentation-1',
      compareAgainstVersionId: 'revision-current',
    };

    expect(() => createGoogleSlidesOutboundExternalPlan(planningInput)).toThrow(
      'requires post-write verification intent',
    );
    const first = createGoogleSlidesOutboundExternalPlan(planningInput, verification);
    const second = createGoogleSlidesOutboundExternalPlan(clone(planningInput), verification);

    expect(first.changeSet).toMatchObject({
      direction: 'outbound',
      conflicts: [],
      postWriteVerification: verification,
    });
    expect(first.batchUpdate.requests).toHaveLength(2);
    expect(first.batchUpdate.body?.writeControl.requiredRevisionId).toBe('revision-current');
    expect(first).not.toHaveProperty('advancedBaseline');
    expect(second.changeSet.digest).toBe(first.changeSet.digest);
    expect(second.batchUpdateDigest).toBe(first.batchUpdateDigest);
    expect(second.digest).toBe(first.digest);

    const verifiedRemote = {
      ...remoteFixture('Edited in NodeSlide'),
      revisionId: 'revision-after-write',
    };
    const receipt = createGoogleSlidesPostAcceptanceReceipt({
      plan: first,
      planningInput,
      acceptedLocal: local,
      verifiedRemote,
      acceptance: {
        kind: 'google_slides_write_verified',
        strategy: 'read_after_write',
        externalChangeSetDigest: first.changeSet.digest,
        acceptedLocalSnapshotDigest: googleSlidesExternalSnapshotDigest('local', local),
        preWriteVersionId: 'revision-current',
        verifiedRemoteVersionId: 'revision-after-write',
        verifiedRemoteSnapshotDigest: googleSlidesExternalSnapshotDigest('remote', verifiedRemote),
      },
    });
    expect(receipt).toMatchObject({
      kind: 'google_slides_post_acceptance_receipt',
      direction: 'outbound',
      externalChangeSetDigest: first.changeSet.digest,
      advancedBaseline: {
        local,
        remote: verifiedRemote,
      },
    });
    expect(receipt.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it('fails outbound conversion closed when the planner reports a conflict', () => {
    const baseline = baselineFixture();
    const local = clone(baseline.local);
    const element = local.elements[0];
    if (!element) throw new Error('fixture element missing');
    element.content = 'Local edit';
    const planningInput = { baseline, local, remote: remoteFixture('Remote edit') };

    expect(() =>
      createGoogleSlidesOutboundExternalPlan(planningInput, {
        strategy: 'read_after_write',
        remoteObjectId: 'presentation-1',
        compareAgainstVersionId: 'revision-current',
      }),
    ).toThrow('forbidden with 1 conflict');
  });

  it('advances recovered mappings only inside a digest-bound post-acceptance receipt', () => {
    const baseline = baselineFixture();
    const planningInput = {
      baseline,
      local: clone(baseline.local),
      remote: remoteFixture('Base', 'google-element-rewritten'),
    };
    const plan = createGoogleSlidesInboundExternalPlan(planningInput);
    const acceptance = {
      kind: 'nodeslide_patch_accepted' as const,
      externalChangeSetDigest: plan.changeSet.digest,
      acceptedLocalSnapshotDigest: googleSlidesExternalSnapshotDigest('local', planningInput.local),
    };

    const first = createGoogleSlidesPostAcceptanceReceipt({
      plan,
      planningInput,
      acceptedLocal: planningInput.local,
      verifiedRemote: planningInput.remote,
      acceptance,
    });
    const second = createGoogleSlidesPostAcceptanceReceipt({
      plan: clone(plan),
      planningInput: clone(planningInput),
      acceptedLocal: clone(planningInput.local),
      verifiedRemote: clone(planningInput.remote),
      acceptance: clone(acceptance),
    });

    expect(plan.stagedMappingLinks).toContainEqual(
      expect.objectContaining({
        localId: 'element-1',
        remoteId: 'google-element-rewritten',
        commitAfter: 'verified_read',
      }),
    );
    expect(plan).not.toHaveProperty('advancedBaseline');
    expect(first.advancedBaseline.mapping.links).toContainEqual(
      expect.objectContaining({
        localId: 'element-1',
        remoteId: 'google-element-rewritten',
      }),
    );
    expect(first.advancedBaselineDigest).toBe(second.advancedBaselineDigest);
    expect(first.digest).toBe(second.digest);
  });
});

function baselineFixture(): PresentationSyncBaseline {
  const local = localFixture();
  const remote = remoteFixture('Base');
  const mapping: SyncObjectMapping = {
    provider: 'google_slides',
    localDeckId: local.deck.id,
    remotePresentationId: remote.remotePresentationId,
    links: [
      {
        kind: 'deck',
        localId: local.deck.id,
        remoteId: remote.remotePresentationId,
        semanticFingerprint: syncSemanticFingerprint({ title: 'Mapped deck' }),
      },
      {
        kind: 'slide',
        localId: 'slide-1',
        remoteId: 'google-slide-1',
        semanticFingerprint: syncSemanticFingerprint({
          title: 'Slide title',
          notes: '',
          background: '#ffffff',
        }),
      },
      {
        kind: 'element',
        localId: 'element-1',
        remoteId: 'google-element-1',
        localSlideId: 'slide-1',
        remoteSlideId: 'google-slide-1',
        semanticFingerprint: remoteElementFingerprint(remote.slides[0]?.elements[0]),
      },
    ],
  };
  return { local: clone(local), remote: clone(remote), mapping };
}

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

function remoteFixture(
  content: string,
  remoteElementId = 'google-element-1',
): NormalizedPresentationState {
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
            remoteId: remoteElementId,
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

function remoteElementFingerprint(element: NormalizedPresentationElement | undefined): string {
  if (!element) throw new Error('fixture remote element missing');
  return syncSemanticFingerprint({
    kind: element.kind,
    bbox: element.bbox,
    rotation: element.rotation,
    content: element.content ?? '',
    style: element.style,
    imageUrl: element.imageUrl ?? '',
    altText: element.altText ?? '',
  });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function response(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    async json() {
      return body;
    },
  };
}
