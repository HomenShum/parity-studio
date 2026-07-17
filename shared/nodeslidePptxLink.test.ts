import { describe, expect, it } from 'vitest';
import { nodeSlideDurableDigest } from './nodeslideDurableSession';
import {
  type NodeSlidePptxSyncDocument,
  createNodeSlidePptxLinkedBaseline,
  nodeSlidePptxSemanticIdentity,
} from './nodeslidePptxLink';

describe('NodeSlide PPTX linked baseline', () => {
  it('uses the PowerPoint object name as the strong round-trip identity signal', () => {
    const parent = nodeSlidePptxSemanticIdentity({
      entityKind: 'slide',
      parentSemanticFingerprint: deckIdentity.fingerprint,
      sourceObjectName: 'Slide 1',
    });
    const before = nodeSlidePptxSemanticIdentity({
      entityKind: 'element',
      parentSemanticFingerprint: parent.fingerprint,
      sourceObjectName: 'Revenue headline',
      elementKind: 'text',
      text: 'Revenue is $4m',
      bbox: { x: 0.1, y: 0.1, width: 0.6, height: 0.1 },
    });
    const after = nodeSlidePptxSemanticIdentity({
      entityKind: 'element',
      parentSemanticFingerprint: parent.fingerprint,
      sourceObjectName: ' revenue   HEADLINE ',
      elementKind: 'text',
      text: 'Revenue is now $8m',
      bbox: { x: 0.2, y: 0.3, width: 0.5, height: 0.2 },
    });

    expect(after).toEqual(before);
    expect(before).toMatchObject({ basis: 'source_object_name', confidence: 'strong' });
    expect(before.fingerprint).toMatch(/^sync-semantic\/v1:[0-9a-f]{64}$/u);
  });

  it('labels structural fallback identity as weak and binds it to ordinal and coarse geometry', () => {
    const first = nodeSlidePptxSemanticIdentity({
      entityKind: 'element',
      parentSemanticFingerprint: slideIdentity.fingerprint,
      elementKind: 'shape',
      text: 'Callout',
      bbox: { x: 0.101, y: 0.201, width: 0.301, height: 0.101 },
      ordinal: 2,
    });
    const sameBucket = nodeSlidePptxSemanticIdentity({
      entityKind: 'element',
      parentSemanticFingerprint: slideIdentity.fingerprint,
      elementKind: 'shape',
      text: 'Callout',
      bbox: { x: 0.102, y: 0.202, width: 0.302, height: 0.102 },
      ordinal: 2,
    });
    const differentOrdinal = nodeSlidePptxSemanticIdentity({
      entityKind: 'element',
      parentSemanticFingerprint: slideIdentity.fingerprint,
      elementKind: 'shape',
      text: 'Callout',
      bbox: { x: 0.102, y: 0.202, width: 0.302, height: 0.102 },
      ordinal: 3,
    });

    expect(first).toEqual(sameBucket);
    expect(first).toMatchObject({ basis: 'structural_fallback', confidence: 'weak' });
    expect(differentOrdinal.fingerprint).not.toBe(first.fingerprint);
  });

  it('records a digest-bound three-way baseline only from synchronized semantic states', () => {
    const baseline = createNodeSlidePptxLinkedBaseline({
      linkId: 'pptx-link-1',
      local: documentFixture('local'),
      remote: documentFixture('remote'),
      createdAt: 1_750_000_000_000,
    });

    expect(baseline).toMatchObject({
      schemaVersion: 'nodeslide.pptx-link/v1',
      localDeckId: 'deck-1',
      remoteArtifactId: 'file-1.pptx',
      localDeckVersion: 7,
      remotePackageDigest: remoteDigest,
    });
    expect(baseline.localSnapshotDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(baseline.remoteSnapshotDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(baseline.baselineDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(
      baseline.entities.map((entity) => [entity.localObjectId, entity.remoteObjectId]),
    ).toEqual([
      ['deck-1', 'ppt/presentation.xml'],
      ['slide-1', 'ppt/slides/slide1.xml'],
      ['element-1', 'shape-42'],
    ]);
  });

  it('records distinct local and PowerPoint-normalized states for the same semantic entity', () => {
    const remote = documentFixture('remote');
    const element = remote.entities.find((entity) => entity.kind === 'element');
    if (!element) throw new Error('Missing element fixture.');
    element.properties.content = 'Remote edit';

    const baseline = createNodeSlidePptxLinkedBaseline({
      linkId: 'pptx-link-1',
      local: documentFixture('local'),
      remote,
      createdAt: 1_750_000_000_000,
    });
    const baselineElement = baseline.entities.find((entity) => entity.kind === 'element');
    expect(baselineElement?.properties.content).toBe('Revenue grew 20%');
    expect(baselineElement?.remoteProperties?.content).toBe('Remote edit');
    expect(baselineElement?.remoteStateDigest).not.toBe(baselineElement?.stateDigest);
  });
});

const deckIdentity = nodeSlidePptxSemanticIdentity({
  entityKind: 'deck',
  sourceObjectName: 'Linked deck',
});
const slideIdentity = nodeSlidePptxSemanticIdentity({
  entityKind: 'slide',
  parentSemanticFingerprint: deckIdentity.fingerprint,
  sourceObjectName: 'Slide 1',
});
const elementIdentity = nodeSlidePptxSemanticIdentity({
  entityKind: 'element',
  parentSemanticFingerprint: slideIdentity.fingerprint,
  sourceObjectName: 'Headline',
  elementKind: 'text',
});
const remoteDigest = nodeSlideDurableDigest('pptx-package-v1');

function documentFixture(side: 'local' | 'remote'): NodeSlidePptxSyncDocument {
  const local = side === 'local';
  const deckId = local ? 'deck-1' : 'ppt/presentation.xml';
  const slideId = local ? 'slide-1' : 'ppt/slides/slide1.xml';
  return {
    side,
    documentId: local ? 'deck-1' : 'file-1.pptx',
    revision: local
      ? { kind: 'nodeslide_deck_version', value: '7' }
      : { kind: 'pptx_package_digest', value: remoteDigest },
    entities: [
      {
        kind: 'deck',
        objectId: deckId,
        identity: deckIdentity,
        properties: { title: 'Quarterly review', order: [slideIdentity.fingerprint] },
      },
      {
        kind: 'slide',
        objectId: slideId,
        parentObjectId: deckId,
        parentSemanticFingerprint: deckIdentity.fingerprint,
        identity: slideIdentity,
        properties: {
          title: 'Results',
          notes: 'Discuss margin.',
          order: [elementIdentity.fingerprint],
        },
      },
      {
        kind: 'element',
        objectId: local ? 'element-1' : 'shape-42',
        parentObjectId: slideId,
        parentSemanticFingerprint: slideIdentity.fingerprint,
        identity: elementIdentity,
        properties: {
          kind: 'text',
          role: 'headline',
          content: 'Revenue grew 20%',
          bbox: { x: 0.1, y: 0.1, width: 0.7, height: 0.12 },
        },
      },
    ],
    unsupportedConstructs: [],
  };
}
