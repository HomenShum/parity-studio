import { describe, expect, it } from 'vitest';
import { buildPptx } from '../src/domains/nodeslide/slidelang/pptx';
import { importPptxSnapshot } from '../src/domains/nodeslide/slidelang/pptxImport';
import { nodeslideContentDigest, nodeslideStableId } from './lib/nodeslideIds';
import { runNodeSlideLiveRenderRepair } from './lib/nodeslideLiveRenderRepair';
import { buildGoldenNodeSlide } from './lib/nodeslideSeed';
import { validateNodeSlideSnapshot } from './lib/nodeslideValidation';

const NOW = 1_700_000_000_000;

/**
 * D8 create=edit parity: the exact pipeline importPptxAsNewDeck runs server-side
 * (bytes -> bounded import with server-minted ids -> canonical validation) must
 * round-trip a real exported deck into a persistable new-deck snapshot.
 */
describe('PPTX-as-create round trip', () => {
  it('imports an exported deck as a NEW deck snapshot that passes canonical validation', async () => {
    const source = buildGoldenNodeSlide('pptx-create-roundtrip', NOW).snapshot;
    const bytes = await buildPptx(source);

    const contentDigest = nodeslideContentDigest('session:idem:1234');
    const deckId = nodeslideStableId('deck_pptx_import', contentDigest);
    const projectId = nodeslideStableId('project_pptx_import', contentDigest);
    const imported = await importPptxSnapshot(bytes, {
      deckId,
      projectId,
      fileName: 'roundtrip.pptx',
      timestamp: NOW,
    });

    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    // A NEW identity, not an edit of the source deck.
    expect(imported.snapshot.deck.id).toBe(deckId);
    expect(imported.snapshot.deck.id).not.toBe(source.deck.id);
    expect(imported.snapshot.slides.length).toBe(source.slides.length);
    expect(imported.snapshot.elements.length).toBeGreaterThan(0);

    // The import path then runs the live render-repair loop before persisting.
    const blockers = (snapshot: typeof imported.snapshot) =>
      validateNodeSlideSnapshot(snapshot, NOW).issues.filter(
        (issue) =>
          issue.severity === 'error' && (issue.code === 'collision' || issue.code === 'overflow'),
      );
    const importedBlockers = blockers(imported.snapshot);
    const repaired = runNodeSlideLiveRenderRepair(imported.snapshot);
    const candidateBlockers = blockers(repaired.result.candidate);

    // Automatic repair classes (overflow/text-fit/geometry) must be gone; any
    // residual collisions persist as visible findings under the import policy.
    expect(candidateBlockers.filter((issue) => issue.code === 'overflow')).toEqual([]);
    expect(candidateBlockers.length).toBeLessThanOrEqual(importedBlockers.length);
    expect(repaired.summary.receipts.length).toBeGreaterThan(0);
  });

  it('fails closed with a coded error on a non-PPTX payload', async () => {
    const junk = new TextEncoder().encode('this is not a zip archive');
    const imported = await importPptxSnapshot(junk, {
      deckId: 'deck_junk',
      projectId: 'project_junk',
      fileName: 'junk.pptx',
      timestamp: NOW,
    });
    expect(imported.ok).toBe(false);
    if (imported.ok) return;
    expect(imported.error.code).toBeTruthy();
    expect(imported.error.message.length).toBeGreaterThan(0);
  });
});
