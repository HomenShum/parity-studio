import { describe, expect, it } from 'vitest';
import {
  evaluateNodeSlideCas,
  validateNodeSlidePatch,
} from '../../../../convex/lib/nodeslidePatches';
import { buildGoldenNodeSlide } from '../../../../convex/lib/nodeslideSeed';
import { validateNodeSlideSnapshot } from '../../../../convex/lib/nodeslideValidation';
import type { DeckSnapshot, PatchScope } from '../../../../shared/nodeslide';
import { applyDeckPatch } from '../../../../shared/nodeslidePatch';
import { candidateSlideIdForPatch } from '../editorStateIntegrity';
import {
  AI2027_TRANSFORMATION_LADDER,
  NODESLIDE_OPENUI_ACTION,
  compileVisualMaterialProposal,
  validateVisualMaterialSpec,
} from './visualMaterials';

function fixture() {
  const { snapshot } = buildGoldenNodeSlide('openui-agent-interactions', 1_700_000_000_000);
  const activeSlide = snapshot.slides[0];
  if (!activeSlide) throw new Error('Golden NodeSlide fixture has no active slide.');
  const proposal = compileVisualMaterialProposal(
    AI2027_TRANSFORMATION_LADDER,
    snapshot.deck,
    activeSlide,
  );
  const scope: PatchScope = {
    kind: 'deck',
    deckId: snapshot.deck.id,
    operationMode: 'unrestricted',
  };
  return { snapshot, activeSlide, proposal, scope };
}

function apply(snapshot: DeckSnapshot) {
  const { proposal, scope } = fixtureFor(snapshot);
  return applyDeckPatch(
    snapshot,
    { baseDeckVersion: snapshot.deck.version, operations: proposal.operations, scope },
    1_700_000_000_100,
  ).snapshot;
}

function fixtureFor(snapshot: DeckSnapshot) {
  const activeSlide = snapshot.slides[0];
  if (!activeSlide) throw new Error('NodeSlide fixture has no active slide.');
  const proposal = compileVisualMaterialProposal(
    AI2027_TRANSFORMATION_LADDER,
    snapshot.deck,
    activeSlide,
  );
  const scope: PatchScope = {
    kind: 'deck',
    deckId: snapshot.deck.id,
    operationMode: 'unrestricted',
  };
  return { proposal, scope };
}

describe('OpenUI slide-agent interaction contract', () => {
  it('A1 accepts only the explicit visual-proposal action', () => {
    expect(NODESLIDE_OPENUI_ACTION).toBe('nodeslide.visual-material.propose');
    expect(NODESLIDE_OPENUI_ACTION).not.toMatch(/apply|accept|publish/);
  });

  it('A2 compiles selection into a proposal while leaving the deck untouched', () => {
    const { snapshot, proposal } = fixture();
    expect(snapshot.deck.slideOrder).not.toContain(proposal.slideId);
    expect(proposal.operations).toHaveLength(1);
    expect(proposal.operations[0]?.op).toBe('add_slide');
  });

  it('A3 validates the exact candidate before review', () => {
    const { snapshot, proposal, scope } = fixture();
    const errors = validateNodeSlidePatch(snapshot, {
      deckId: snapshot.deck.id,
      baseDeckVersion: snapshot.deck.version,
      baseSlideVersions: {},
      baseElementVersions: {},
      scope,
      operations: proposal.operations,
    });
    expect(errors).toEqual([]);
    const candidate = apply(snapshot);
    const validation = validateNodeSlideSnapshot(candidate, 1_700_000_000_200, 'openui-candidate');
    expect(validation.ok, JSON.stringify(validation.issues)).toBe(true);
  });

  it('A4 keeps all four claims editable in the SlideLang candidate', () => {
    const { proposal } = fixture();
    if (proposal.operations[0]?.op !== 'add_slide') throw new Error('Expected add_slide.');
    const metrics = proposal.operations[0].elements.filter((element) => element.role === 'metric');
    expect(metrics.map((element) => element.content)).toEqual([
      '200K copies',
      '50K coder equivalents',
      '30× speed',
      '4× research progress',
    ]);
    expect(metrics.every((element) => element.exportCapabilities.includes('pptx_editable'))).toBe(
      true,
    );
  });

  it('A5 preserves provenance honesty in visible copy and speaker notes', () => {
    const { proposal } = fixture();
    if (proposal.operations[0]?.op !== 'add_slide') throw new Error('Expected add_slide.');
    const provenance = proposal.operations[0].elements.find((element) => element.role === 'source');
    expect(provenance?.content).toMatch(/unverified/i);
    expect(proposal.operations[0].slide.notes).toMatch(/user-provided.*unverified/i);
  });

  it('A6 rejects a fabricated source-bound label', () => {
    const result = validateVisualMaterialSpec({
      ...AI2027_TRANSFORMATION_LADDER,
      provenanceLabel: 'Verified research source',
    });
    expect(result.ok).toBe(false);
  });

  it('A7 rejects a mixed-unit quantitative chart', () => {
    const result = validateVisualMaterialSpec({
      ...AI2027_TRANSFORMATION_LADDER,
      kind: 'chart',
    });
    expect(result.ok).toBe(false);
    expect(result.distinctUnits).toHaveLength(4);
  });

  it('A8 rejects stale deck-level proposals with exact-version CAS', () => {
    const { snapshot, proposal, scope } = fixture();
    const cas = evaluateNodeSlideCas(snapshot, {
      deckId: snapshot.deck.id,
      baseDeckVersion: snapshot.deck.version - 1,
      baseSlideVersions: {},
      baseElementVersions: {},
      scope,
      operations: proposal.operations,
    });
    expect(cas.canCommit).toBe(false);
    expect(cas.reasons.join(' ')).toMatch(/deck-level operations cannot be rebased/i);
  });

  it('A9 commits only through the existing patch kernel and advances one deck version', () => {
    const { snapshot } = fixture();
    const candidate = apply(snapshot);
    expect(candidate.deck.version).toBe(snapshot.deck.version + 1);
    expect(candidate.deck.slideOrder).toHaveLength(snapshot.deck.slideOrder.length + 1);
  });

  it('A10 rejects a duplicate compiled slide id after commit', () => {
    const { snapshot, proposal, scope } = fixture();
    const candidate = applyDeckPatch(
      snapshot,
      { baseDeckVersion: snapshot.deck.version, operations: proposal.operations, scope },
      1_700_000_000_100,
    ).snapshot;
    expect(() =>
      applyDeckPatch(candidate, {
        baseDeckVersion: candidate.deck.version,
        operations: proposal.operations,
        scope,
      }),
    ).toThrow(/already exists/i);
  });

  it('A11 targets a newly added slide in Compare instead of reusing the active baseline', () => {
    const { activeSlide, proposal } = fixture();
    expect(candidateSlideIdForPatch({ operations: proposal.operations }, activeSlide.id)).toBe(
      proposal.slideId,
    );
  });
});
