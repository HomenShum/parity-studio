import { describe, expect, it } from 'vitest';
import type { DeckSnapshot, PatchScope, SlideElement } from '../../shared/nodeslide';
import { runNodeSlideDeckRepl } from './nodeslideDeckRepl';
import { planNodeSlideEditShadow } from './nodeslideEditShadowPlanner';
import { buildGoldenNodeSlide } from './nodeslideSeed';

const NOW = 1_700_000_000_000;

function fixture(): { snapshot: DeckSnapshot; target: SlideElement; scope: PatchScope } {
  const snapshot = buildGoldenNodeSlide('edit-shadow-planner-tests', NOW).snapshot;
  const target = snapshot.elements.find((element) => element.kind === 'text' && !element.locked);
  if (!target) throw new Error('Expected an unlocked text fixture.');
  target.content = 'Before';
  return {
    snapshot,
    target,
    scope: {
      kind: 'elements',
      deckId: snapshot.deck.id,
      slideIds: [target.slideId],
      elementIds: [target.id],
      operationMode: 'copy',
    },
  };
}

function planArgs(snapshot: DeckSnapshot, target: SlideElement, scope: PatchScope) {
  const slide = snapshot.slides.find((candidate) => candidate.id === target.slideId);
  if (!slide) throw new Error('Expected target slide fixture.');
  return {
    snapshot,
    instruction: 'Replace "Before" with "After".',
    deckId: snapshot.deck.id,
    baseDeckVersion: snapshot.deck.version,
    baseSlideVersions: { [slide.id]: slide.version },
    baseElementVersions: { [target.id]: target.version },
    scope,
  };
}

describe('NodeSlide independent deterministic edit shadow planner', () => {
  it('produces one typed command that the pure Deck REPL accepts', () => {
    const { snapshot, target, scope } = fixture();
    const before = structuredClone(snapshot);
    const args = planArgs(snapshot, target, scope);
    const plan = planNodeSlideEditShadow(args);

    expect(plan.outcome).toBe('ready');
    if (plan.outcome !== 'ready') return;
    expect(plan.command.operations).toEqual([
      {
        op: 'replace_text',
        slideId: target.slideId,
        elementId: target.id,
        text: 'After',
      },
    ]);
    const result = runNodeSlideDeckRepl({
      sessionId: 'shadow-planner-test',
      traceId: 'shadow-planner-trace',
      snapshot,
      commands: [plan.command],
    });
    expect(result.terminalReason).toBe('completed');
    expect(result.proposals).toHaveLength(1);
    expect(snapshot).toEqual(before);
  });

  it('is deterministic for identical immutable input', () => {
    const { snapshot, target, scope } = fixture();
    const args = planArgs(snapshot, target, scope);
    expect(planNodeSlideEditShadow(args)).toEqual(planNodeSlideEditShadow(args));
  });

  it('skips unsupported comment scope instead of claiming comparable validation', () => {
    const { snapshot, target } = fixture();
    const scope: PatchScope = {
      kind: 'comment',
      deckId: snapshot.deck.id,
      slideIds: [target.slideId],
      elementIds: [target.id],
      commentId: 'comment-open',
      operationMode: 'copy',
    };
    expect(planNodeSlideEditShadow(planArgs(snapshot, target, scope))).toMatchObject({
      outcome: 'skipped',
      reason: 'unsupported_scope',
    });
  });

  it('fails closed when the request and immutable snapshot are not deck-bound', () => {
    const { snapshot, target, scope } = fixture();
    expect(
      planNodeSlideEditShadow({
        ...planArgs(snapshot, target, scope),
        deckId: 'deck-other',
      }),
    ).toMatchObject({ outcome: 'skipped', reason: 'planner_error' });
  });

  it('skips when every scoped target is locked', () => {
    const { snapshot, target, scope } = fixture();
    target.locked = true;
    expect(planNodeSlideEditShadow(planArgs(snapshot, target, scope))).toMatchObject({
      outcome: 'skipped',
      reason: 'no_eligible_target',
    });
  });

  it('uses only theme tokens for its conservative style candidate', () => {
    const { snapshot, target, scope } = fixture();
    target.style.color = '#000000';
    scope.operationMode = 'style';
    const args = planArgs(snapshot, target, scope);
    args.instruction = 'Use a stronger accent style.';
    const plan = planNodeSlideEditShadow(args);
    expect(plan.outcome).toBe('ready');
    if (plan.outcome !== 'ready') return;
    expect(plan.command.operations[0]).toMatchObject({
      op: 'update_style',
      elementId: target.id,
      properties: { color: snapshot.deck.theme.colors.accent },
    });
  });
});
