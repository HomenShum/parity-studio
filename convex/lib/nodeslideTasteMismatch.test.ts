import { describe, expect, it } from 'vitest';
import type { PreferenceSignal } from '../../shared/nodeslidePreference';
import { STARTUP_NARRATIVE_TASTE_PACK } from '../../src/domains/nodeslide/signature/packs';
import { buildGoldenNodeSlide } from './nodeslideSeed';
import { evaluateNodeSlideTasteMismatch } from './nodeslideTasteMismatch';

const NOW = 1_700_000_000_000;

function passedSignal(passed = true): PreferenceSignal {
  return {
    id: passed ? 'signal-passed' : 'signal-rejected',
    tenantId: 'tenant',
    actorId: 'actor',
    polarity: 'positive',
    scope: { kind: 'deck', deckId: 'deck' },
    dimension: 'density',
    value: passed ? 'executive' : 'sk-secretsecretsecret',
    confidence: 0.9,
    evidenceEventIds: ['event-1'],
    evaluator: {
      evaluatorVersion: 'nodeslide.preference-evaluator/v1',
      passed,
      checks: {
        schema: { passed, rejectionCodes: [] },
        provenance: { passed, rejectionCodes: [] },
        hallucination: { passed, rejectionCodes: [] },
      },
      rejectionCodes: [],
      inputEventIds: ['event-1'],
    },
    createdAt: NOW,
  };
}

describe('NodeSlide taste mismatch receipts', () => {
  it('binds the full target and candidate digests to deterministic violations and a bounded proposal', () => {
    const snapshot = buildGoldenNodeSlide('taste-mismatch', NOW).snapshot;
    const receipt = evaluateNodeSlideTasteMismatch({
      snapshot,
      profile: STARTUP_NARRATIVE_TASTE_PACK,
      renderDigest: 'render_golden',
      softPreferenceSignals: [passedSignal(true), passedSignal(false)],
      maxRepairOperations: 128,
    });

    expect(receipt.target.profileDigest).toMatch(/^profile_sha256:[0-9a-f]{64}$/);
    expect(receipt.candidate.snapshotDigest).toMatch(/^snap_sha256:[0-9a-f]{64}$/);
    expect(receipt.candidate.renderDigest).toBe('render_golden');
    expect(receipt.violations.length).toBeGreaterThan(0);
    expect(receipt.violations.every((item) => item.expectedDigest.startsWith('target_'))).toBe(
      true,
    );
    expect(receipt.softPreferences.map((item) => item.signalId)).toEqual(['signal-passed']);
    expect(receipt.repair.candidateOperationCount).toBeGreaterThan(0);
    expect(receipt.repair.candidateOperationDigest).toMatch(/^operations_sha256:[0-9a-f]{64}$/);
    expect(receipt.receiptDigest).toMatch(/^taste_sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(receipt)).not.toContain('secretsecretsecret');
  });

  it('is deterministic and records a human decision only with provenance', () => {
    const snapshot = buildGoldenNodeSlide('taste-determinism', NOW).snapshot;
    const args = {
      snapshot,
      profile: STARTUP_NARRATIVE_TASTE_PACK,
      renderDigest: 'render_same',
      humanDecision: { status: 'accepted' as const, eventId: 'event-choice' },
      maxRepairOperations: 128,
    };

    expect(evaluateNodeSlideTasteMismatch(args)).toEqual(evaluateNodeSlideTasteMismatch(args));
    expect(() =>
      evaluateNodeSlideTasteMismatch({
        ...args,
        humanDecision: { status: 'rejected' },
      }),
    ).toThrow('require an event ID');
  });

  it('withholds repairs when source lineage or locked elements make a complete repair unsafe', () => {
    const snapshot = buildGoldenNodeSlide('taste-blockers', NOW).snapshot;
    const target = snapshot.elements.find((element) => !element.locked);
    expect(target).toBeDefined();
    if (!target) return;
    target.locked = true;
    target.sourceIds = ['source-missing'];

    const receipt = evaluateNodeSlideTasteMismatch({
      snapshot,
      profile: STARTUP_NARRATIVE_TASTE_PACK,
      renderDigest: 'render_blocked',
      maxRepairOperations: 128,
    });

    expect(receipt.repair.status).toBe('blocked');
    expect(receipt.repair.proposal).toBeNull();
    expect(receipt.repair.blockers).toEqual(
      expect.arrayContaining(['locked_elements', 'source_lineage']),
    );
  });

  it('rejects malformed render bindings and operation budgets', () => {
    const snapshot = buildGoldenNodeSlide('taste-invalid', NOW).snapshot;
    expect(() =>
      evaluateNodeSlideTasteMismatch({
        snapshot,
        profile: STARTUP_NARRATIVE_TASTE_PACK,
        renderDigest: 'bad digest!',
      }),
    ).toThrow('valid render digest');
    expect(() =>
      evaluateNodeSlideTasteMismatch({
        snapshot,
        profile: STARTUP_NARRATIVE_TASTE_PACK,
        renderDigest: 'render_ok',
        maxRepairOperations: 129,
      }),
    ).toThrow('between 1 and 128');
  });
});
