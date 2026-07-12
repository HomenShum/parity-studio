import { describe, expect, it, vi } from 'vitest';
import type { DeckComment, DeckSnapshot, PatchScope, SlideElement } from '../../shared/nodeslide';
import { planNodeSlideEdit } from './nodeslideEditPlanner';
import { buildGoldenNodeSlide } from './nodeslideSeed';

const NOW = 1_700_000_000_000;

function fixture(): {
  snapshot: DeckSnapshot;
  target: SlideElement;
  scope: PatchScope;
} {
  const snapshot = buildGoldenNodeSlide('edit-planner-tests', NOW).snapshot;
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

function input(snapshot: DeckSnapshot, target: SlideElement, scope: PatchScope) {
  const slide = snapshot.slides.find((candidate) => candidate.id === target.slideId);
  if (!slide) throw new Error('Expected target slide fixture.');
  return {
    snapshot,
    scopedComment: null,
    request: {
      deckId: snapshot.deck.id,
      instruction: 'Replace "Before" with "After".',
      baseDeckVersion: snapshot.deck.version,
      baseSlideVersions: { [slide.id]: slide.version },
      baseElementVersions: { [target.id]: target.version },
      scope,
      designBehavior: 'preserve' as const,
      referenceUse: 'context_only' as const,
      providerMode: 'openrouter_free' as const,
    },
  };
}

describe('NodeSlide baseline edit planner extraction', () => {
  it('does not call a provider when deterministic mode is selected', async () => {
    const { snapshot, target, scope } = fixture();
    const planningInput = input(snapshot, target, scope);
    const deterministicInput = {
      ...planningInput,
      request: { ...planningInput.request, providerMode: 'deterministic' as const },
    };
    const provider = vi.fn(async () => ({
      ok: false as const,
      reason: 'must_not_be_called',
    }));

    const result = await planNodeSlideEdit(deterministicInput, { callProvider: provider });

    expect(result.ok).toBe(true);
    expect(provider).not.toHaveBeenCalled();
    if (result.ok) expect(result.receipt.providerOutcome).toBe('not_requested');
  });

  it('plans a deterministic exact-copy edit from a slide-anchored comment', async () => {
    const { snapshot, target } = fixture();
    const headline = snapshot.elements.find(
      (element) =>
        element.slideId === target.slideId &&
        (element.role === 'headline' || element.role === 'title') &&
        !element.locked,
    );
    if (!headline) throw new Error('Fixture needs an editable headline.');
    const slideElements = snapshot.elements.filter((element) => element.slideId === target.slideId);
    const comment: DeckComment = {
      id: 'comment-slide-scope',
      deckId: snapshot.deck.id,
      anchor: { type: 'slide', deckId: snapshot.deck.id, slideId: target.slideId },
      authorId: 'reviewer',
      authorName: 'Reviewer',
      text: 'Make the headline more decisive.',
      status: 'open',
      createdAt: NOW,
      updatedAt: NOW,
    };
    const scope: PatchScope = {
      kind: 'comment',
      deckId: snapshot.deck.id,
      slideIds: [target.slideId],
      elementIds: slideElements.map((element) => element.id),
      commentId: comment.id,
      operationMode: 'copy',
    };
    const planningInput = input(snapshot, headline, scope);

    const result = await planNodeSlideEdit({
      ...planningInput,
      scopedComment: comment,
      request: {
        ...planningInput.request,
        providerMode: 'deterministic',
        instruction: 'Set the headline copy exactly to "Launch-ready decisions stay reviewable".',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations).toEqual([
      {
        op: 'replace_text',
        slideId: headline.slideId,
        elementId: headline.id,
        text: 'Launch-ready decisions stay reviewable',
      },
    ]);
  });

  it('accepts valid provider operations and derives its summary from the validated diff', async () => {
    const { snapshot, target, scope } = fixture();
    const before = structuredClone(snapshot);
    const provider = vi.fn(async () => ({
      ok: true as const,
      value: {
        summary: 'UNTRUSTED_PROVIDER_PROSE',
        operations: [
          {
            op: 'replace_text',
            slideId: target.slideId,
            elementId: target.id,
            text: 'Provider replacement',
          },
        ],
      },
      telemetry: {
        provider: 'openrouter',
        model: 'resolved/free-model',
        costMicroUsd: 0,
        inputTokens: 100,
        outputTokens: 20,
      },
    }));

    const result = await planNodeSlideEdit(input(snapshot, target, scope), {
      callProvider: provider,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.origin).toBe('free_route');
    expect(result.receipt.providerOutcome).toBe('accepted');
    expect(result.operations).toEqual([
      {
        op: 'replace_text',
        slideId: target.slideId,
        elementId: target.id,
        text: 'Provider replacement',
      },
    ]);
    expect(result.summary).toContain('replace text');
    expect(JSON.stringify(result)).not.toContain('UNTRUSTED_PROVIDER_PROSE');
    expect(snapshot).toEqual(before);
  });

  it('falls back when an otherwise valid provider envelope targets outside scope', async () => {
    const { snapshot, target, scope } = fixture();
    const other = snapshot.elements.find((element) => element.id !== target.id && !element.locked);
    if (!other) throw new Error('Expected another element fixture.');
    const provider = vi.fn(async () => ({
      ok: true as const,
      value: {
        operations: [
          {
            op: 'move',
            slideId: other.slideId,
            elementId: other.id,
            x: 0.1,
            y: 0.1,
          },
        ],
      },
      telemetry: {
        provider: 'openrouter',
        model: 'resolved/free-model',
        costMicroUsd: 0,
        inputTokens: 100,
        outputTokens: 20,
      },
    }));

    const result = await planNodeSlideEdit(input(snapshot, target, scope), {
      callProvider: provider,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.origin).toBe('deterministic_fallback');
    expect(result.receipt.providerOutcome).toBe('invalid');
    expect(result.receipt.fallbackReason).toBe('the free response was invalid');
    expect(result.operations).toEqual([
      {
        op: 'replace_text',
        slideId: target.slideId,
        elementId: target.id,
        text: 'After',
      },
    ]);
  });

  it('retains provider telemetry when a failed route supplies it', async () => {
    const { snapshot, target, scope } = fixture();
    const telemetry = {
      provider: 'openrouter',
      model: 'resolved/free-model',
      costMicroUsd: 0,
      inputTokens: 100,
      outputTokens: 20,
    };
    const result = await planNodeSlideEdit(input(snapshot, target, scope), {
      callProvider: async () => ({
        ok: false,
        reason: 'The free route response was incomplete.',
        telemetry,
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.origin).toBe('deterministic_fallback');
    expect(result.receipt.providerOutcome).toBe('failed');
    expect(result.receipt.providerTelemetry).toEqual(telemetry);
  });

  it('preserves the public fallback-unavailable mapping for unsupported intent', async () => {
    const { snapshot, target, scope } = fixture();
    scope.operationMode = 'unrestricted';
    const planningInput = input(snapshot, target, scope);
    planningInput.request.instruction = 'Improve it somehow.';
    const result = await planNodeSlideEdit(planningInput, {
      callProvider: async () => ({ ok: false, reason: 'The free route was unavailable.' }),
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'fallback_unavailable',
      receipt: {
        origin: 'deterministic_fallback',
        providerOutcome: 'failed',
        terminalOutcome: 'fallback_unavailable',
      },
    });
    if (result.ok) return;
    expect(result.message).toContain('could not safely infer');
  });
});
