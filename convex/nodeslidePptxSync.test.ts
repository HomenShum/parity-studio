import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DeckSnapshot } from '../shared/nodeslide';
import { nodeSlideDurableDigest } from '../shared/nodeslideDurableSession';
import {
  type NodeSlidePptxSyncDocument,
  createNodeSlidePptxLinkedBaseline,
} from '../shared/nodeslidePptxLink';
import { planNodeSlidePptxLinkedSync } from '../shared/nodeslidePptxLinkPlanner';
import {
  NODESLIDE_PPTX_RUNTIME_LIMITS,
  assertNodeSlidePptxLinkCas,
  assertNodeSlidePptxPlanConvergence,
  assertNodeSlidePptxRuntimePayload,
  nodeSlideSnapshotToPptxSyncDocument,
} from './nodeslidePptxSync';

const runtimeSource = readFileSync(new URL('./nodeslidePptxSync.ts', import.meta.url), 'utf8');

describe('NodeSlide linked PPTX server runtime', () => {
  it('owner-gates every public entry point and never auto-applies imported review work', () => {
    const entryPoints = [
      ['getLink', 'attachImportedBaseline'],
      ['attachImportedBaseline', 'planImportedSnapshot'],
      ['planImportedSnapshot', 'verifyOutboundSnapshot'],
      ['verifyOutboundSnapshot', 'finalizePlan'],
      ['finalizePlan', 'nodeSlideSnapshotToPptxSyncDocument'],
    ] as const;
    for (const [name, nextName] of entryPoints) {
      const block = exportedBlock(name, nextName);
      expect(block.slice(0, block.indexOf('handler:')), `${name} owner gate`).toContain(
        'ownerAccessKey: v.string()',
      );
      expect(block, `${name} owner authorization`).toContain('requireOwnerAccess');
    }
    const planning = exportedBlock('planImportedSnapshot', 'verifyOutboundSnapshot');
    expect(planning).toContain('planNodeSlidePptxLinkedSync');
    expect(planning).not.toMatch(/acceptPatch|applyPatch|commitPatch/u);
    expect(runtimeSource).not.toMatch(/api\.nodeslide\.(?:accept|apply|commit)/u);
  });

  it('derives the local semantic document from the authoritative NodeSlide snapshot', () => {
    const document = nodeSlideSnapshotToPptxSyncDocument(snapshotFixture());

    expect(document).toMatchObject({
      side: 'local',
      documentId: 'deck-1',
      revision: { kind: 'nodeslide_deck_version', value: '7' },
    });
    expect(document.entities.map((entity) => [entity.kind, entity.objectId])).toEqual([
      ['deck', 'deck-1'],
      ['slide', 'slide-1'],
      ['element', 'element-1'],
    ]);
    expect(document.entities.every((entity) => entity.identity.confidence === 'strong')).toBe(true);
  });

  it('keeps an imported inbound change review-only until the accepted local state converges', () => {
    const local = nodeSlideSnapshotToPptxSyncDocument(snapshotFixture());
    const remote = remoteDocument(local, 'remote-v1');
    const baseline = createNodeSlidePptxLinkedBaseline({
      linkId: 'pptx-link-1',
      local,
      remote,
      createdAt: 1,
    });
    const imported = structuredClone(remote);
    imported.revision = { kind: 'pptx_package_digest', value: digest('remote-v2') };
    entity(imported, 'slide').properties.notes = 'Edited in PowerPoint';
    const plan = planNodeSlidePptxLinkedSync({ baseline, local, remote: imported });

    expect(plan).toMatchObject({ status: 'ready', outbound: [] });
    expect(plan.inbound).toEqual([
      expect.objectContaining({ operation: 'update', changedProperties: ['notes'] }),
    ]);
    expect(() =>
      assertNodeSlidePptxPlanConvergence(
        { baseline, local, remote: imported, plan },
        local,
        imported,
      ),
    ).toThrow(/does not match the reviewed plan/i);

    const accepted = nodeSlideSnapshotToPptxSyncDocument(
      snapshotFixture({ version: 8, notes: 'Edited in PowerPoint' }),
    );
    expect(() =>
      assertNodeSlidePptxPlanConvergence(
        { baseline, local, remote: imported, plan },
        accepted,
        imported,
      ),
    ).not.toThrow();
  });

  it('requires verified outbound semantics and rejects unresolved conflicts', () => {
    const baselineLocal = nodeSlideSnapshotToPptxSyncDocument(snapshotFixture());
    const baselineRemote = remoteDocument(baselineLocal, 'remote-v1');
    const baseline = createNodeSlidePptxLinkedBaseline({
      linkId: 'pptx-link-1',
      local: baselineLocal,
      remote: baselineRemote,
      createdAt: 1,
    });
    const changedLocal = nodeSlideSnapshotToPptxSyncDocument(
      snapshotFixture({ version: 8, content: 'Local result' }),
    );
    const outboundPlan = planNodeSlidePptxLinkedSync({
      baseline,
      local: changedLocal,
      remote: baselineRemote,
    });
    const unverified = structuredClone(baselineRemote);
    unverified.revision = { kind: 'pptx_package_digest', value: digest('remote-v2') };
    expect(() =>
      assertNodeSlidePptxPlanConvergence(
        { baseline, local: changedLocal, remote: baselineRemote, plan: outboundPlan },
        undefined,
        unverified,
      ),
    ).toThrow(/does not match the reviewed plan/i);

    entity(unverified, 'element').properties.content = 'Local result';
    expect(() =>
      assertNodeSlidePptxPlanConvergence(
        { baseline, local: changedLocal, remote: baselineRemote, plan: outboundPlan },
        changedLocal,
        unverified,
      ),
    ).not.toThrow();

    const conflictingRemote = structuredClone(baselineRemote);
    conflictingRemote.revision = {
      kind: 'pptx_package_digest',
      value: digest('remote-conflict'),
    };
    entity(conflictingRemote, 'element').properties.content = 'Remote result';
    const conflictPlan = planNodeSlidePptxLinkedSync({
      baseline,
      local: changedLocal,
      remote: conflictingRemote,
    });
    expect(conflictPlan.status).toBe('blocked');
    expect(() =>
      assertNodeSlidePptxPlanConvergence(
        { baseline, local: changedLocal, remote: conflictingRemote, plan: conflictPlan },
        changedLocal,
        conflictingRemote,
      ),
    ).toThrow(/conflicted PPTX plan/i);
  });

  it('fails closed on stale CAS inputs and oversized persisted payloads', () => {
    expect(() =>
      assertNodeSlidePptxLinkCas({ stateVersion: 4 }, 4, 'plan-a', 'plan-a'),
    ).not.toThrow();
    expect(() => assertNodeSlidePptxLinkCas({ stateVersion: 4 }, 3, 'plan-a', 'plan-a')).toThrow(
      /state changed/i,
    );
    expect(() => assertNodeSlidePptxLinkCas({ stateVersion: 4 }, 4, 'plan-a', 'plan-b')).toThrow(
      /state changed/i,
    );
    expect(() =>
      assertNodeSlidePptxRuntimePayload(
        'x'.repeat(NODESLIDE_PPTX_RUNTIME_LIMITS.rowPayloadBytes + 1),
      ),
    ).toThrow(/bounded persisted payload/i);
  });

  it('registers the link table for schema persistence and atomic deck erasure', () => {
    const schema = readFileSync(new URL('./schema.ts', import.meta.url), 'utf8');
    const deletion = readFileSync(
      new URL('./lib/nodeslideDeckDeletion.ts', import.meta.url),
      'utf8',
    );
    expect(schema).toContain('nodeslide_pptx_sync_links: defineTable');
    expect(schema).toContain(".index('by_remote_artifact', ['remoteArtifactId'])");
    expect(deletion).toContain("'nodeslide_pptx_sync_links'");
    expect(deletion).toContain(".query('nodeslide_pptx_sync_links')");
  });
});

function exportedBlock(name: string, nextName: string): string {
  const start = runtimeSource.indexOf(`export const ${name} =`);
  const end = runtimeSource.indexOf(
    `export ${nextName.startsWith('nodeSlide') ? 'function' : 'const'} ${nextName}`,
    start,
  );
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return runtimeSource.slice(start, end);
}

function snapshotFixture(
  overrides: { version?: number; notes?: string; content?: string } = {},
): DeckSnapshot {
  return {
    deck: {
      schemaVersion: 'nodeslide.slidelang/v1',
      toolchainVersion: 'test',
      id: 'deck-1',
      projectId: 'project-1',
      title: 'Quarterly review',
      brief: {
        prompt: 'Review the quarter.',
        audience: 'Quarterly business reviewers',
        purpose: 'Summarize the quarterly results',
        successCriteria: ['Keep the exported presentation editable'],
      },
      theme: {
        id: 'theme-1',
        name: 'Test theme',
        mode: 'light',
        colors: {
          canvas: '#ffffff',
          ink: '#111111',
          muted: '#666666',
          accent: '#ff6600',
          accentSoft: '#fff0e8',
          insight: '#dbeafe',
          insightInk: '#1e3a8a',
          trace: '#334155',
          border: '#dddddd',
        },
        typography: { display: 'Inter', body: 'Inter', data: 'Mono' },
        defaultRadius: 8,
        spacingUnit: 8,
      },
      slideOrder: ['slide-1'],
      version: overrides.version ?? 7,
      status: 'draft',
      createdAt: 1,
      updatedAt: 1,
    },
    slides: [
      {
        id: 'slide-1',
        deckId: 'deck-1',
        title: 'Results',
        notes: overrides.notes ?? 'Baseline note',
        background: '#ffffff',
        elementOrder: ['element-1'],
        version: overrides.version ?? 7,
      },
    ],
    elements: [
      {
        id: 'element-1',
        slideId: 'slide-1',
        name: 'Headline',
        kind: 'text',
        role: 'headline',
        bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 },
        rotation: 0,
        content: overrides.content ?? 'Revenue grew 20%',
        style: {},
        sourceIds: [],
        locked: false,
        visible: true,
        exportCapabilities: ['pptx_editable'],
        version: overrides.version ?? 7,
      },
    ],
    sources: [],
  } as DeckSnapshot;
}

function remoteDocument(
  local: NodeSlidePptxSyncDocument,
  revision: string,
): NodeSlidePptxSyncDocument {
  const objectIds = new Map([
    ['deck-1', 'ppt/presentation.xml'],
    ['slide-1', 'ppt/slides/slide1.xml'],
    ['element-1', 'shape-1'],
  ]);
  return {
    side: 'remote',
    documentId: 'quarterly-review.pptx',
    revision: { kind: 'pptx_package_digest', value: digest(revision) },
    entities: local.entities.map((entity) => ({
      ...structuredClone(entity),
      objectId: objectIds.get(entity.objectId) ?? entity.objectId,
      ...(entity.parentObjectId
        ? { parentObjectId: objectIds.get(entity.parentObjectId) ?? entity.parentObjectId }
        : {}),
    })),
    unsupportedConstructs: [],
  };
}

function entity(document: NodeSlidePptxSyncDocument, kind: 'slide' | 'element') {
  const result = document.entities.find((candidate) => candidate.kind === kind);
  if (!result) throw new Error(`Missing ${kind} fixture.`);
  return result;
}

function digest(value: string): string {
  return nodeSlideDurableDigest(value);
}
