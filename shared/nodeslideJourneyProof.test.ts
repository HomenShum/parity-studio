import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_REQUIRED_JOURNEY_STEPS,
  createNodeSlideJourneyProof,
  verifyNodeSlideJourneyProof,
} from './nodeslideJourneyProof';

describe('NodeSlide journey proof', () => {
  it('requires the complete recorded brief-to-export journey', () => {
    const proof = createNodeSlideJourneyProof({
      deckId: 'deck:1',
      expectedCreationProvenance: 'brief_to_new_deck',
      actualCreationProvenance: 'brief_to_new_deck',
      baseVersion: 1,
      acceptedVersion: 2,
      steps: NODESLIDE_REQUIRED_JOURNEY_STEPS.map((kind, index) => ({
        kind,
        occurredAt: index + 1,
        ...(['validation_received', 'proposal_accepted'].includes(kind)
          ? { receiptDigest: `sha256:${kind}` }
          : {}),
      })),
      artifacts: {
        rawRecordingPath: 'run.webm',
        gifPath: 'run.gif',
        finalScreenshotPath: 'final.png',
        exportedDeckPath: 'deck.pptx',
        runManifestPath: 'run.json',
      },
    });

    expect(verifyNodeSlideJourneyProof(proof)).toEqual({ ok: true, findings: [] });
  });

  it('fails closed for a renamed sample, missing media, and a multi-version jump', () => {
    const proof = createNodeSlideJourneyProof({
      deckId: 'deck:1',
      expectedCreationProvenance: 'brief_to_new_deck',
      actualCreationProvenance: 'sample_fallback',
      baseVersion: 2,
      acceptedVersion: 4,
      steps: [],
      artifacts: {},
    });

    const result = verifyNodeSlideJourneyProof(proof);
    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        'journey_provenance_mismatch',
        'journey_version_delta_invalid',
        'journey_step_missing',
        'journey_artifact_missing',
      ]),
    );
  });

  it('detects tampering after proof creation', () => {
    const proof = createNodeSlideJourneyProof({
      deckId: 'deck:1',
      expectedCreationProvenance: 'existing_deck_edit',
      actualCreationProvenance: 'existing_deck_edit',
      baseVersion: 1,
      acceptedVersion: 2,
      steps: [],
      artifacts: {},
    });
    proof.acceptedVersion = 3;
    expect(verifyNodeSlideJourneyProof(proof).findings[0]?.code).toBe('journey_digest_mismatch');
  });
});
