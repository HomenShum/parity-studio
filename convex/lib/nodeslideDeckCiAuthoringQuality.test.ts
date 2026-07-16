import { describe, expect, it } from 'vitest';
import type { DeckSnapshot } from '../../shared/nodeslide';
import { createDefaultNodeSlideAuthoringPolicy } from '../../shared/nodeslideAuthoringPolicy';
import { evaluateNodeSlidePresentationQuality } from '../../shared/nodeslideAuthoringQuality';
import { evaluateNodeSlideDeckCi } from './nodeslideDeckCi';

describe('Deck CI presentation-quality binding', () => {
  it('surfaces a valid release-quality blocker in the deterministic Deck CI receipt', () => {
    const deck = snapshot();
    const policy = createDefaultNodeSlideAuthoringPolicy();
    const quality = evaluateNodeSlidePresentationQuality(deck, { policy });
    const result = evaluateNodeSlideDeckCi(deck, { presentationQuality: quality });

    expect(result.status).toBe('fail');
    expect(result.presentationQuality).toMatchObject({
      digest: quality.digest,
      overall: quality.scores.overall,
      blockerCount: quality.blockerCount,
    });
    expect(result.checks.some((check) => check.origin === 'presentation_quality')).toBe(true);
  });

  it('fails closed when the quality receipt is rebound to another deck version', () => {
    const deck = snapshot();
    const quality = evaluateNodeSlidePresentationQuality(deck);
    deck.deck.version += 1;
    const result = evaluateNodeSlideDeckCi(deck, { presentationQuality: quality });
    expect(result.checks.map((check) => check.code)).toContain(
      'presentation_quality_receipt_mismatch',
    );
  });
});

function snapshot(): DeckSnapshot {
  return {
    deck: {
      schemaVersion: 'nodeslide.slidelang/v1',
      toolchainVersion: 'local-slidelang-adapter/1.1.0',
      id: 'deck:quality',
      projectId: 'project:1',
      title: 'Generic deck',
      brief: {
        prompt: 'Make slides.',
        audience: 'general',
        purpose: 'Overview',
        successCriteria: [],
      },
      theme: {
        id: 'theme:1',
        name: 'Default',
        mode: 'light',
        colors: {
          canvas: '#fff',
          ink: '#111',
          muted: '#666',
          accent: '#f60',
          accentSoft: '#fee',
          insight: '#def',
          insightInk: '#123',
          trace: '#345',
          border: '#ddd',
        },
        typography: { display: 'Inter', body: 'Inter', data: 'Mono' },
        defaultRadius: 0,
        spacingUnit: 8,
      },
      slideOrder: ['slide:1'],
      version: 1,
      status: 'ready',
      createdAt: 1,
      updatedAt: 1,
    },
    slides: [
      {
        id: 'slide:1',
        deckId: 'deck:quality',
        title: 'Overview',
        background: '#fff',
        elementOrder: ['element:1'],
        version: 1,
      },
    ],
    elements: [
      {
        id: 'element:1',
        slideId: 'slide:1',
        name: 'Headline',
        kind: 'text',
        role: 'headline',
        bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 },
        rotation: 0,
        content: 'Overview',
        style: { fontSize: 40 },
        sourceIds: [],
        locked: false,
        exportCapabilities: ['pptx_editable'],
        version: 1,
      },
    ],
    sources: [],
  };
}
