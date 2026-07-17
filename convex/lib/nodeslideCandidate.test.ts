import { describe, expect, it } from 'vitest';
import type { DeckPatch, PatchOperation, PatchScope } from '../../shared/nodeslide';
import {
  candidateValidationBindingMatches,
  candidateValidationReceipt,
  evaluateNodeSlideSemanticCoverage,
  materializeNodeSlideCandidate,
  nodeSlideCandidateDigest,
  nodeSlideCandidateValidationId,
  nodeSlideSemanticCoverageReceiptMatches,
} from './nodeslideCandidate';
import { buildGoldenNodeSlide } from './nodeslideSeed';
import { validateNodeSlideSnapshot } from './nodeslideValidation';

describe('NodeSlide candidate validation binding', () => {
  it('binds the exact materialized candidate and rejects a changed candidate', () => {
    const snapshot = buildGoldenNodeSlide('candidate-binding', 1_700_000_000_000).snapshot;
    const element = snapshot.elements.find(
      (candidate) => candidate.kind === 'text' && !candidate.locked,
    );
    if (!element) throw new Error('Expected text fixture.');
    const patch: Pick<DeckPatch, 'scope' | 'operations'> = {
      scope: {
        kind: 'elements',
        deckId: snapshot.deck.id,
        slideIds: [element.slideId],
        elementIds: [element.id],
        operationMode: 'copy',
      },
      operations: [
        {
          op: 'replace_text',
          slideId: element.slideId,
          elementId: element.id,
          text: 'Bound candidate copy',
        },
      ],
    };
    const candidate = materializeNodeSlideCandidate(snapshot, patch, 10);
    const digest = nodeSlideCandidateDigest(candidate);
    expect(nodeSlideCandidateDigest(materializeNodeSlideCandidate(snapshot, patch, 20))).toBe(
      digest,
    );
    const patchId = 'patch-candidate-binding';
    const validation = validateNodeSlideSnapshot(
      candidate,
      10,
      nodeSlideCandidateValidationId(patchId, digest),
    );
    const receipt = candidateValidationReceipt({ patchId, candidateDigest: digest, validation });
    expect(
      candidateValidationBindingMatches({
        patchId,
        candidateDigest: digest,
        persistedDigest: digest,
        persistedReceipt: receipt,
        validation: { ...validation, checkedAt: 20 },
      }),
    ).toBe(true);

    const changed = materializeNodeSlideCandidate(
      snapshot,
      {
        ...patch,
        operations: [
          {
            op: 'replace_text',
            slideId: element.slideId,
            elementId: element.id,
            text: 'Different candidate copy',
          },
        ],
      },
      20,
    );
    expect(nodeSlideCandidateDigest(changed)).not.toBe(digest);
  });

  it('binds explicit field coverage to the exact candidate and rejects five-field under-coverage', () => {
    const snapshot = buildGoldenNodeSlide('semantic-coverage-binding', 1_700_000_000_000).snapshot;
    const slide = snapshot.slides[0];
    if (!slide) throw new Error('Expected opening slide fixture.');
    const elements = snapshot.elements.filter((element) => element.slideId === slide.id);
    const section = elements.find((element) => element.name === 'Section label');
    if (!section) throw new Error('Expected section label fixture.');
    const scope: PatchScope = {
      kind: 'slide',
      deckId: snapshot.deck.id,
      slideIds: [slide.id],
      operationMode: 'unrestricted',
    };
    const operations: PatchOperation[] = [
      {
        op: 'move',
        slideId: slide.id,
        elementId: section.id,
        x: section.bbox.x + 0.01,
        y: section.bbox.y,
      },
    ];
    const receipt = evaluateNodeSlideSemanticCoverage({
      snapshot,
      instruction:
        'Rewrite the section label, headline, body copy, key point 1, and key point 2. Change nothing else.',
      scope,
      operations,
      focusSlideId: slide.id,
    });
    const candidate = materializeNodeSlideCandidate(snapshot, { scope, operations }, 10);

    expect(receipt.status).toBe('blocked');
    expect(receipt.obligations.map((obligation) => obligation.field)).toEqual([
      'section label',
      'headline',
      'body copy',
      'key point 1',
      'key point 2',
    ]);
    expect(receipt.coveredObligationIds).toEqual([]);
    expect(receipt.missingObligationIds).toHaveLength(5);
    expect(nodeSlideSemanticCoverageReceiptMatches(receipt, candidate)).toBe(true);
    expect(
      nodeSlideSemanticCoverageReceiptMatches(receipt, {
        ...candidate,
        deck: { ...candidate.deck, title: 'Changed after coverage' },
      }),
    ).toBe(false);
  });

  it('requires one matching headline edit for every explicitly numbered slide target', () => {
    const snapshot = buildGoldenNodeSlide('semantic-slide-targets', 1_700_000_000_000).snapshot;
    const slides = snapshot.slides.slice(0, 2);
    const headlines = slides.map((slide) => {
      const headline = snapshot.elements.find(
        (element) =>
          element.slideId === slide.id &&
          !element.locked &&
          element.kind === 'text' &&
          (element.role === 'title' || element.role === 'headline'),
      );
      if (!headline) throw new Error(`Expected headline for ${slide.id}.`);
      return headline;
    });
    const scope: PatchScope = {
      kind: 'slide',
      deckId: snapshot.deck.id,
      slideIds: slides.map((slide) => slide.id),
      operationMode: 'copy',
    };
    const operations: PatchOperation[] = [
      {
        op: 'replace_text',
        slideId: headlines[0]?.slideId ?? '',
        elementId: headlines[0]?.id ?? '',
        text: 'First headline updated.',
      },
    ];

    const blocked = evaluateNodeSlideSemanticCoverage({
      snapshot,
      instruction: 'Rewrite the headline on slides 1 and 2.',
      scope,
      operations,
    });
    const passed = evaluateNodeSlideSemanticCoverage({
      snapshot,
      instruction: 'Rewrite the headline on slides 1 and 2.',
      scope,
      operations: [
        ...operations,
        {
          op: 'replace_text',
          slideId: headlines[1]?.slideId ?? '',
          elementId: headlines[1]?.id ?? '',
          text: 'Second headline updated.',
        },
      ],
    });

    expect(blocked.status).toBe('blocked');
    expect(blocked.obligations).toHaveLength(2);
    expect(blocked.coveredObligationIds).toHaveLength(1);
    expect(blocked.missingObligationIds).toHaveLength(1);
    expect(passed.status).toBe('pass');
    expect(passed.coveredObligationIds).toHaveLength(2);
  });

  it('treats preserve-current-layout language as a constraint, not a layout mutation', () => {
    const snapshot = buildGoldenNodeSlide(
      'semantic-preservation-constraint',
      1_700_000_000_000,
    ).snapshot;
    const slide = snapshot.slides[0];
    if (!slide) throw new Error('Expected opening slide fixture.');
    const headline = snapshot.elements.find(
      (element) =>
        element.slideId === slide.id &&
        !element.locked &&
        element.kind === 'text' &&
        (element.role === 'title' || element.role === 'headline'),
    );
    if (!headline) throw new Error('Expected headline fixture.');
    const scope: PatchScope = {
      kind: 'elements',
      deckId: snapshot.deck.id,
      slideIds: [slide.id],
      elementIds: [headline.id],
      operationMode: 'unrestricted',
    };

    const receipt = evaluateNodeSlideSemanticCoverage({
      snapshot,
      instruction:
        'Replace only this selected headline with “AI 2027 is a decision system, not a forecast.” Preserve every other element and the current layout.',
      scope,
      operations: [
        {
          op: 'replace_text',
          slideId: slide.id,
          elementId: headline.id,
          text: 'AI 2027 is a decision system, not a forecast.',
        },
      ],
      focusSlideId: slide.id,
    });

    expect(receipt.status).toBe('pass');
    expect(receipt.obligations).toEqual([
      expect.objectContaining({
        field: 'headline',
        elementId: headline.id,
        operationClass: 'copy',
      }),
    ]);
  });
});
