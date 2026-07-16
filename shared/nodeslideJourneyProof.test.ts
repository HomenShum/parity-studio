import { describe, expect, it } from 'vitest';
import { nodeSlideDurableDigest } from './nodeslideDurableSession';
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
      appliedVersion: 2,
      finalVersion: 4,
      steps: NODESLIDE_REQUIRED_JOURNEY_STEPS.map((kind, index) => {
        const common = { kind, occurredAt: index + 1 };
        if (kind === 'validation_received') {
          return {
            ...common,
            deckVersion: 1,
            receiptDigest: digest('1'),
            runId: 'run-1',
            patchId: 'patch-1',
            candidateDigest: digest('c'),
            baseDeckVersion: 1,
          };
        }
        if (kind === 'edit_applied') {
          return {
            ...common,
            deckVersion: 2,
            receiptDigest: digest('2'),
            runId: 'run-1',
            patchId: 'patch-1',
            candidateDigest: digest('c'),
            baseDeckVersion: 1,
            resultingDeckVersion: 2,
            contentDigest: digest('a'),
          };
        }
        if (kind === 'undo_verified') {
          return {
            ...common,
            deckVersion: 3,
            receiptDigest: digest('3'),
            patchId: 'patch-1',
            contentDigest: digest('b'),
          };
        }
        if (kind === 'redo_verified') {
          return {
            ...common,
            deckVersion: 4,
            receiptDigest: digest('4'),
            patchId: 'patch-1',
            contentDigest: digest('a'),
          };
        }
        return common;
      }),
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
      appliedVersion: 4,
      finalVersion: 5,
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
      appliedVersion: 2,
      finalVersion: 4,
      steps: [],
      artifacts: {},
    });
    proof.appliedVersion = 3;
    expect(verifyNodeSlideJourneyProof(proof).findings[0]?.code).toBe('journey_digest_mismatch');
  });

  it('continues to verify tracked v1 proof receipts during migration', () => {
    const partial = {
      schemaVersion: 'nodeslide.journey-proof/v1' as const,
      deckId: 'deck:legacy',
      expectedCreationProvenance: 'brief_to_new_deck' as const,
      actualCreationProvenance: 'brief_to_new_deck' as const,
      baseVersion: 1,
      acceptedVersion: 2,
      steps: [
        'brief_submitted',
        'deck_created',
        'proposal_ready',
        'compare_opened',
        'validation_received',
        'proposal_accepted',
        'version_advanced',
        'export_downloaded',
      ].map((kind, index) => ({
        kind,
        occurredAt: index + 1,
        ...(['validation_received', 'proposal_accepted'].includes(kind)
          ? { receiptDigest: digest(kind) }
          : {}),
      })),
      artifacts: {
        rawRecordingPath: 'run.webm',
        gifPath: 'run.gif',
        finalScreenshotPath: 'final.png',
        exportedDeckPath: 'deck.pptx',
        runManifestPath: 'run.json',
      },
    };
    const legacy = { ...partial, digest: nodeSlideDurableDigest(partial) };
    expect(verifyNodeSlideJourneyProof(legacy)).toEqual({ ok: true, findings: [] });
  });
});

function digest(seed: string): string {
  return nodeSlideDurableDigest(seed);
}
