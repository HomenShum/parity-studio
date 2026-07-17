import { describe, expect, it } from 'vitest';
import { nodeSlideDurableDigest } from './nodeslideDurableSession';
import {
  type NodeSlidePptxLinkedBaseline,
  type NodeSlidePptxSyncDocument,
  type NodeSlidePptxSyncEntity,
  createNodeSlidePptxLinkedBaseline,
  nodeSlidePptxSemanticIdentity,
} from './nodeslidePptxLink';
import { planNodeSlidePptxLinkedSync } from './nodeslidePptxLinkPlanner';

describe('NodeSlide PPTX linked sync planner', () => {
  it('separates remote-only inbound work from local-only outbound work', () => {
    const { baseline, local, remote } = planningFixture();
    local.revision = { kind: 'nodeslide_deck_version', value: '8' };
    remote.revision = { kind: 'pptx_package_digest', value: digest('remote-v2') };
    entity(local, headlineIdentity).properties.content = 'Local revenue grew 30%';
    entity(remote, slideIdentity).properties.notes = 'Remote speaker note';
    local.entities = local.entities.filter(
      (candidate) => candidate.identity.fingerprint !== imageIdentity.fingerprint,
    );
    remote.entities.push(remoteCallout('remote-callout'));

    const plan = planNodeSlidePptxLinkedSync({ baseline, local, remote });

    expect(plan.status).toBe('ready');
    expect(plan.inbound).toHaveLength(2);
    expect(plan.inbound.map(actionSummary)).toEqual(
      expect.arrayContaining([
        ['element', 'add', calloutIdentity.fingerprint, ['bbox', 'content', 'kind', 'parent']],
        ['slide', 'update', slideIdentity.fingerprint, ['notes']],
      ]),
    );
    expect(plan.outbound).toHaveLength(2);
    expect(plan.outbound.map(actionSummary)).toEqual(
      expect.arrayContaining([
        ['element', 'update', headlineIdentity.fingerprint, ['content']],
        ['element', 'delete', imageIdentity.fingerprint, ['altText', 'image', 'kind', 'parent']],
      ]),
    );
    expect(plan.conflicts).toEqual([]);
    expect(plan.planDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it('blocks divergent concurrent updates rather than choosing a winner', () => {
    const { baseline, local, remote } = planningFixture();
    local.revision = { kind: 'nodeslide_deck_version', value: '8' };
    remote.revision = { kind: 'pptx_package_digest', value: digest('remote-v2') };
    entity(local, headlineIdentity).properties.content = 'Local result';
    entity(remote, headlineIdentity).properties.content = 'Remote result';

    const plan = planNodeSlidePptxLinkedSync({ baseline, local, remote });

    expect(plan.status).toBe('blocked');
    expect(plan.inbound).toEqual([]);
    expect(plan.outbound).toEqual([]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({
        kind: 'concurrent_update',
        semanticFingerprint: headlineIdentity.fingerprint,
        localDelta: 'updated',
        remoteDelta: 'updated',
        changedProperties: ['content'],
      }),
    ]);
  });

  it('distinguishes delete-versus-modify and identical convergence', () => {
    const deleted = planningFixture();
    deleted.local.revision = { kind: 'nodeslide_deck_version', value: '8' };
    deleted.remote.revision = { kind: 'pptx_package_digest', value: digest('remote-v2') };
    deleted.local.entities = deleted.local.entities.filter(
      (candidate) => candidate.identity.fingerprint !== headlineIdentity.fingerprint,
    );
    entity(deleted.remote, headlineIdentity).properties.content = 'Remote result';

    const deletePlan = planNodeSlidePptxLinkedSync(deleted);
    expect(deletePlan.conflicts).toEqual([
      expect.objectContaining({ kind: 'delete_vs_modify', changedProperties: ['content'] }),
    ]);

    const converged = planningFixture();
    converged.local.revision = { kind: 'nodeslide_deck_version', value: '8' };
    converged.remote.revision = { kind: 'pptx_package_digest', value: digest('remote-v2') };
    entity(converged.local, headlineIdentity).properties.content = 'Same result';
    entity(converged.remote, headlineIdentity).properties.content = 'Same result';
    const convergedPlan = planNodeSlidePptxLinkedSync(converged);
    expect(convergedPlan.status).toBe('clean');
    expect(convergedPlan.convergedSemanticFingerprints).toEqual([headlineIdentity.fingerprint]);
  });

  it('reports concurrent adds and semantic identity collisions explicitly', () => {
    const concurrent = planningFixture();
    concurrent.local.revision = { kind: 'nodeslide_deck_version', value: '8' };
    concurrent.remote.revision = { kind: 'pptx_package_digest', value: digest('remote-v2') };
    concurrent.local.entities.push(localCallout('local-callout', 'Local callout'));
    concurrent.remote.entities.push(remoteCallout('remote-callout', 'Remote callout'));
    const concurrentPlan = planNodeSlidePptxLinkedSync(concurrent);
    expect(concurrentPlan.conflicts).toEqual([
      expect.objectContaining({
        kind: 'concurrent_add',
        semanticFingerprint: calloutIdentity.fingerprint,
      }),
    ]);

    const ambiguous = planningFixture();
    ambiguous.local.revision = { kind: 'nodeslide_deck_version', value: '8' };
    ambiguous.remote.revision = { kind: 'pptx_package_digest', value: digest('remote-v2') };
    ambiguous.local.entities.push({
      ...structuredClone(entity(ambiguous.local, headlineIdentity)),
      objectId: 'duplicate-headline',
    });
    const ambiguousPlan = planNodeSlidePptxLinkedSync(ambiguous);
    expect(ambiguousPlan.conflicts).toEqual([
      expect.objectContaining({
        kind: 'identity_ambiguous',
        localObjectIds: ['duplicate-headline', 'element-headline'],
      }),
    ]);
  });

  it('keeps unsupported constructs visible and blocks only affected directions', () => {
    const { baseline, local, remote } = planningFixture();
    local.revision = { kind: 'nodeslide_deck_version', value: '8' };
    remote.revision = { kind: 'pptx_package_digest', value: digest('remote-v2') };
    entity(local, headlineIdentity).properties.content = 'Local outbound edit';
    entity(remote, slideIdentity).properties.notes = 'Remote inbound edit';
    remote.unsupportedConstructs = [
      {
        id: 'macro-1',
        kind: 'macro',
        handling: 'preserve_remote_only',
        blockedDirections: ['outbound'],
        scope: 'deck',
        reason: 'The planner cannot promise VBA preservation when replacing the package.',
      },
    ];

    const plan = planNodeSlidePptxLinkedSync({ baseline, local, remote });

    expect(plan.inbound).toHaveLength(1);
    expect(plan.outbound).toHaveLength(1);
    expect(plan.unsupportedConstructs).toEqual(remote.unsupportedConstructs);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({
        kind: 'unsupported_construct',
        constructKind: 'macro',
        blockedDirections: ['outbound'],
        blockedActionIds: [plan.outbound[0]?.id],
      }),
    ]);
  });

  it('rejects state changes hidden behind unchanged revision metadata', () => {
    const { baseline, local, remote } = planningFixture();
    entity(local, headlineIdentity).properties.content = 'Undeclared local change';
    expect(() => planNodeSlidePptxLinkedSync({ baseline, local, remote })).toThrow(
      /without advancing its deck version/i,
    );

    const remoteMismatch = planningFixture();
    entity(remoteMismatch.remote, headlineIdentity).properties.content = 'Undeclared remote change';
    expect(() => planNodeSlidePptxLinkedSync(remoteMismatch)).toThrow(
      /without advancing its package digest/i,
    );
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
const headlineIdentity = nodeSlidePptxSemanticIdentity({
  entityKind: 'element',
  parentSemanticFingerprint: slideIdentity.fingerprint,
  sourceObjectName: 'Headline',
  elementKind: 'text',
});
const imageIdentity = nodeSlidePptxSemanticIdentity({
  entityKind: 'element',
  parentSemanticFingerprint: slideIdentity.fingerprint,
  sourceObjectName: 'Hero image',
  elementKind: 'image',
});
const calloutIdentity = nodeSlidePptxSemanticIdentity({
  entityKind: 'element',
  parentSemanticFingerprint: slideIdentity.fingerprint,
  sourceObjectName: 'Callout',
  elementKind: 'text',
});

function planningFixture(): {
  baseline: NodeSlidePptxLinkedBaseline;
  local: NodeSlidePptxSyncDocument;
  remote: NodeSlidePptxSyncDocument;
} {
  const local = documentFixture('local');
  const remote = documentFixture('remote');
  return {
    baseline: createNodeSlidePptxLinkedBaseline({
      linkId: 'pptx-link-1',
      local,
      remote,
      createdAt: 1_750_000_000_000,
    }),
    local: structuredClone(local),
    remote: structuredClone(remote),
  };
}

function documentFixture(side: 'local' | 'remote'): NodeSlidePptxSyncDocument {
  const local = side === 'local';
  const deckId = local ? 'deck-1' : 'ppt/presentation.xml';
  const slideId = local ? 'slide-1' : 'ppt/slides/slide1.xml';
  return {
    side,
    documentId: local ? 'deck-1' : 'file-1.pptx',
    revision: local
      ? { kind: 'nodeslide_deck_version', value: '7' }
      : { kind: 'pptx_package_digest', value: digest('remote-v1') },
    entities: [
      {
        kind: 'deck',
        objectId: deckId,
        identity: deckIdentity,
        properties: { title: 'Quarterly review' },
      },
      {
        kind: 'slide',
        objectId: slideId,
        parentObjectId: deckId,
        parentSemanticFingerprint: deckIdentity.fingerprint,
        identity: slideIdentity,
        properties: { title: 'Results', notes: 'Baseline note' },
      },
      {
        kind: 'element',
        objectId: local ? 'element-headline' : 'shape-headline',
        parentObjectId: slideId,
        parentSemanticFingerprint: slideIdentity.fingerprint,
        identity: headlineIdentity,
        properties: { kind: 'text', content: 'Revenue grew 20%' },
      },
      {
        kind: 'element',
        objectId: local ? 'element-image' : 'shape-image',
        parentObjectId: slideId,
        parentSemanticFingerprint: slideIdentity.fingerprint,
        identity: imageIdentity,
        properties: { kind: 'image', image: 'asset:hero', altText: 'Product hero' },
      },
    ],
    unsupportedConstructs: [],
  };
}

function entity(
  document: NodeSlidePptxSyncDocument,
  identity: { fingerprint: string },
): NodeSlidePptxSyncEntity {
  const match = document.entities.find(
    (candidate) => candidate.identity.fingerprint === identity.fingerprint,
  );
  if (!match) throw new Error(`Missing fixture entity ${identity.fingerprint}.`);
  return match;
}

function localCallout(objectId: string, content = 'Callout'): NodeSlidePptxSyncEntity {
  return {
    kind: 'element',
    objectId,
    parentObjectId: 'slide-1',
    parentSemanticFingerprint: slideIdentity.fingerprint,
    identity: calloutIdentity,
    properties: {
      kind: 'text',
      content,
      bbox: { x: 0.1, y: 0.7, width: 0.4, height: 0.1 },
    },
  };
}

function remoteCallout(objectId: string, content = 'Callout'): NodeSlidePptxSyncEntity {
  return {
    ...localCallout(objectId, content),
    parentObjectId: 'ppt/slides/slide1.xml',
  };
}

function actionSummary(action: {
  entityKind: string;
  operation: string;
  semanticFingerprint: string;
  changedProperties: string[];
}): [string, string, string, string[]] {
  return [
    action.entityKind,
    action.operation,
    action.semanticFingerprint,
    action.changedProperties,
  ];
}

function digest(value: string): string {
  return nodeSlideDurableDigest(value);
}
