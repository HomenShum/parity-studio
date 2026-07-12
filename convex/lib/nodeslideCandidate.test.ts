import { describe, expect, it } from 'vitest';
import type { DeckPatch } from '../../shared/nodeslide';
import {
  candidateValidationBindingMatches,
  candidateValidationReceipt,
  materializeNodeSlideCandidate,
  nodeSlideCandidateDigest,
  nodeSlideCandidateValidationId,
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
});
