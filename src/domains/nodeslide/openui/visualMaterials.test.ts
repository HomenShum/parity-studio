import { createParser } from '@openuidev/react-lang';
import { describe, expect, it } from 'vitest';
import { buildGoldenNodeSlide } from '../../../../convex/lib/nodeslideSeed';
import { nodeslideVisualMaterialLibrary } from './VisualMaterialWorkbench';
import {
  AI2027_OPENUI_PROGRAM,
  AI2027_TRANSFORMATION_LADDER,
  NODESLIDE_OPENUI_ACTION,
  compileVisualMaterialProposal,
  validateVisualMaterialSpec,
} from './visualMaterials';

describe('NodeSlide OpenUI visual materials', () => {
  it('parses the canonical OpenUI Lang program with the bounded component library', () => {
    const parsed = createParser(nodeslideVisualMaterialLibrary.toJSONSchema()).parse(
      AI2027_OPENUI_PROGRAM,
    );
    expect(parsed.meta.errors).toEqual([]);
    expect(parsed.meta.unresolved).toEqual([]);
    expect(parsed.root).not.toBeNull();
    expect(parsed.meta.statementCount).toBe(1);
  });

  it('exposes only the allowlisted proposal action', () => {
    expect(NODESLIDE_OPENUI_ACTION).toBe('nodeslide.visual-material.propose');
    const prompt = nodeslideVisualMaterialLibrary.prompt({
      additionalRules: ['Never mutate a deck directly.'],
    });
    expect(prompt).toContain('TransformationLadder');
    expect(prompt).toContain('Never mutate a deck directly.');
  });

  it('compiles the mixed-unit ladder into one unapplied add-slide operation', () => {
    const { snapshot } = buildGoldenNodeSlide('openui-compile-proof', 1_700_000_000_000);
    const activeSlide = snapshot.slides[0];
    expect(activeSlide).toBeDefined();
    if (!activeSlide) return;
    const proposal = compileVisualMaterialProposal(
      AI2027_TRANSFORMATION_LADDER,
      snapshot.deck,
      activeSlide,
    );
    expect(proposal.operations).toHaveLength(1);
    expect(proposal.operations[0]?.op).toBe('add_slide');
    expect(snapshot.deck.slideOrder).not.toContain(proposal.slideId);
    if (proposal.operations[0]?.op !== 'add_slide') return;
    expect(
      proposal.operations[0].elements.filter((element) => element.role === 'metric'),
    ).toHaveLength(4);
    expect(proposal.operations[0].slide.notes).toContain('unverified');
  });

  it('fails closed when incompatible units are requested on one chart axis', () => {
    const invalid = validateVisualMaterialSpec({
      ...AI2027_TRANSFORMATION_LADDER,
      kind: 'chart',
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.issues).toContain('Mixed-unit claims cannot share one quantitative chart axis.');
  });

  it('requires scenario fixtures to remain visibly unverified', () => {
    const invalid = validateVisualMaterialSpec({
      ...AI2027_TRANSFORMATION_LADDER,
      provenanceLabel: 'Scenario brief',
    });
    expect(invalid.ok).toBe(false);
  });
});
