import { describe, expect, it } from 'vitest';
import type { DeckPatch, DeckVersion, SlideElement } from '../../../shared/nodeslide';
import {
  appendDistinctHistoryVersion,
  applyExpectedElementVersions,
  authoritativePredecessorVersion,
  captureInlineEditSession,
  classifyEditorVersionAdvance,
  createEditorRequestGate,
  createSerializedEditorWriteQueue,
  editorCandidateCanAccept,
  editorCandidateReceiptForPatch,
  inlineEditCommit,
  workspaceReceiptMarker,
  workspaceSatisfiesReceiptMarker,
} from './editorStateIntegrity';

describe('editor candidate integrity', () => {
  it('accepts only an exact patch- and candidate-digest-bound successful receipt', () => {
    const receipt = editorCandidateReceiptForPatch(readyPatch, currentDeck);

    expect(receipt.status).toBe('ready');
    expect(editorCandidateCanAccept(receipt)).toBe(true);
    expect(
      editorCandidateCanAccept({
        status: 'ready',
        summary: 'A caller cannot assert readiness without the exact binding.',
      }),
    ).toBe(false);
  });

  it.each([
    {
      label: 'missing digest',
      patch: { ...readyPatch, candidateDigest: undefined, candidateValidation: undefined },
      status: 'unavailable',
    },
    {
      label: 'wrong patch',
      patch: {
        ...readyPatch,
        candidateValidation: { ...readyValidation, patchId: 'patch:other' },
      },
      status: 'invalid',
    },
    {
      label: 'wrong digest',
      patch: {
        ...readyPatch,
        candidateValidation: {
          ...readyValidation,
          candidateDigest: 'sha256:candidate-other',
        },
      },
      status: 'invalid',
    },
    {
      label: 'failed validation',
      patch: {
        ...readyPatch,
        candidateValidation: { ...readyValidation, ok: false },
      },
      status: 'invalid',
    },
  ])('rejects a $label receipt', ({ patch, status }) => {
    const receipt = editorCandidateReceiptForPatch(patch as DeckPatch, currentDeck);

    expect(receipt.status).toBe(status);
    expect(editorCandidateCanAccept(receipt)).toBe(false);
  });

  it('marks a formerly valid proposal stale when the active deck clock advances', () => {
    const receipt = editorCandidateReceiptForPatch(readyPatch, {
      ...currentDeck,
      version: currentDeck.version + 1,
    });

    expect(receipt.status).toBe('stale');
    expect(editorCandidateCanAccept(receipt)).toBe(false);
  });

  it('keeps a server-rebased proposal ready when its receipt targets the current deck', () => {
    const receipt = editorCandidateReceiptForPatch(
      { ...readyPatch, baseDeckVersion: currentDeck.version - 1 },
      currentDeck,
    );

    expect(receipt.status).toBe('ready');
    expect(editorCandidateCanAccept(receipt)).toBe(true);
  });
});

describe('editor async request integrity', () => {
  it('invalidates late results when a newer request or active deck replaces their token', () => {
    const gate = createEditorRequestGate('deck:alpha');
    const first = gate.begin('proposal', 'deck:alpha');
    const second = gate.begin('proposal', 'deck:alpha');

    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);

    gate.setActiveDeck('deck:beta');

    expect(gate.isCurrent(second)).toBe(false);
    expect(gate.isDeckCurrent('deck:alpha')).toBe(false);
  });
});

describe('editor write history integrity', () => {
  it('serializes writes and preserves each distinct successful commit as an undo entry', async () => {
    const queue = createSerializedEditorWriteQueue();
    const started: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let history: string[] = [];

    const first = queue.enqueue(async () => {
      started.push('first');
      await firstBlocked;
      history = appendDistinctHistoryVersion(history, 'version:7');
    });
    const second = queue.enqueue(() => {
      started.push('second');
      history = appendDistinctHistoryVersion(history, 'version:8');
    });

    await Promise.resolve();
    expect(started).toEqual(['first']);
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(started).toEqual(['first', 'second']);
    expect(history).toEqual(['version:7', 'version:8']);
  });

  it('derives a rebased commit predecessor from the authoritative resulting workspace', () => {
    const versions = [7, 8, 9].map(versionFixture);
    const predecessor = authoritativePredecessorVersion({
      deck: { id: currentDeck.id, version: 9 },
      patches: [],
      versions,
    });

    expect(predecessor?.id).toBe('version:8');
  });

  it('distinguishes local resulting versions from external advances', () => {
    expect(classifyEditorVersionAdvance(7, 8, new Set([8]))).toBe('local');
    expect(classifyEditorVersionAdvance(7, 8, new Set())).toBe('external');
    expect(classifyEditorVersionAdvance(8, 8, new Set())).toBe('none');
  });
});

describe('receipt/query synchronization integrity', () => {
  it('keeps a same-version receipt until the query contains its patch state', () => {
    const receiptPatch: DeckPatch = { ...readyPatch, status: 'rejected', updatedAt: 2_000 };
    const marker = workspaceReceiptMarker({
      deck: currentDeck,
      patches: [receiptPatch],
      versions: [versionFixture(currentDeck.version)],
    });
    const lagging = {
      deck: currentDeck,
      patches: [{ ...readyPatch, status: 'ready' as const, updatedAt: 1_000 }],
      versions: [versionFixture(currentDeck.version)],
    };

    expect(workspaceSatisfiesReceiptMarker(lagging, marker)).toBe(false);
    expect(workspaceSatisfiesReceiptMarker({ ...lagging, patches: [receiptPatch] }, marker)).toBe(
      true,
    );
    expect(
      workspaceSatisfiesReceiptMarker(
        { ...lagging, deck: { ...currentDeck, version: currentDeck.version + 1 }, patches: [] },
        marker,
      ),
    ).toBe(true);
  });
});

describe('inline edit integrity', () => {
  it('submits the element clock captured at edit start after a collaborator update', () => {
    const session = captureInlineEditSession(textElement);
    const collaboratorVersion = { ...textElement, content: 'Collaborator copy', version: 5 };
    const submission = inlineEditCommit(session, 'My edit');
    const clocks = applyExpectedElementVersions(
      { [collaboratorVersion.id]: collaboratorVersion.version, 'element:other': 2 },
      submission ? { [submission.elementId]: submission.baseElementVersion } : undefined,
    );

    expect(submission).toEqual({
      elementId: textElement.id,
      baseElementVersion: 4,
      text: 'My edit',
    });
    expect(clocks).toEqual({ [textElement.id]: 4, 'element:other': 2 });
  });
});

const currentDeck = { id: 'deck:test', version: 7 };

const readyValidation = {
  id: 'validation:ready',
  patchId: 'patch:ready',
  candidateDigest: 'sha256:candidate-ready',
  deckId: currentDeck.id,
  deckVersion: currentDeck.version + 1,
  ok: true,
  publishOk: true,
  cleanOk: true,
  issues: [],
  checkedAt: 1_000,
  toolchainVersion: 'test',
};

const readyPatch: DeckPatch = {
  id: 'patch:ready',
  deckId: currentDeck.id,
  baseDeckVersion: currentDeck.version,
  baseSlideVersions: { 'slide:one': 3 },
  baseElementVersions: { 'element:text': 4 },
  scope: {
    kind: 'elements',
    deckId: currentDeck.id,
    slideIds: ['slide:one'],
    elementIds: ['element:text'],
    operationMode: 'copy',
  },
  operations: [
    {
      op: 'replace_text',
      slideId: 'slide:one',
      elementId: 'element:text',
      text: 'Updated copy',
    },
  ],
  source: 'agent',
  status: 'ready',
  summary: 'Update copy',
  candidateDigest: 'sha256:candidate-ready',
  candidateValidation: readyValidation,
  createdAt: 1_000,
  updatedAt: 1_000,
};

const textElement: SlideElement = {
  id: 'element:text',
  slideId: 'slide:one',
  name: 'Headline',
  kind: 'text',
  bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 },
  rotation: 0,
  content: 'Original copy',
  style: { fontSize: 30 },
  sourceIds: [],
  locked: false,
  exportCapabilities: ['web_native'],
  version: 4,
};

function versionFixture(version: number): DeckVersion {
  return { id: `version:${version}`, version } as DeckVersion;
}
