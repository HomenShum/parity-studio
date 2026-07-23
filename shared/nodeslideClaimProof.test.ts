import { describe, expect, it } from 'vitest';
import {
  type ClaimDefinition,
  type ClaimEvidence,
  DEFAULT_AUTONOMY_BUDGET,
  NODESLIDE_CLAIM_PROOF_VERSION,
  decideClaim,
  evaluateAutonomy,
  evaluateClaimSet,
  isProofVerdict,
  validateClaimDefinitions,
} from './nodeslideClaimProof';

/**
 * The scenario: a launch post makes nine claims, one recording is made, and a reader concludes all
 * nine are established. These tests are written against that reader.
 *
 * Almost every case below is about what the evaluator must REFUSE to certify, because the failure
 * mode here is not a wrong verdict — it is a generous one that nobody questions.
 */

const claim = (over: Partial<ClaimDefinition> = {}): ClaimDefinition => ({
  id: 'agent-builds-deck',
  statement: 'Let your coding agent build your slides with you.',
  proof: 'live',
  required: true,
  requiredEvidence: ['agent-transcript', 'generated-deck'],
  ...over,
});

const evidence = (over: Partial<ClaimEvidence> = {}): ClaimEvidence => ({
  claimId: 'agent-builds-deck',
  present: ['agent-transcript', 'generated-deck'],
  holds: true,
  ...over,
});

describe('positioning claims: framing that can never become a result', () => {
  it('returns positioning-only however much evidence is attached', () => {
    const decision = decideClaim(
      claim({ id: 'yc-batch', proof: 'positioning', required: false }),
      evidence({
        claimId: 'yc-batch',
        present: ['agent-transcript', 'generated-deck', 'browser-recording', 'pptx-topology'],
        holds: true,
      }),
    );
    expect(decision.verdict).toBe('positioning-only');
    expect(isProofVerdict(decision.verdict)).toBe(false);
  });

  it('rejects a manifest that marks positioning as required', () => {
    const errors = validateClaimDefinitions([
      claim({ id: 'grant-target', proof: 'positioning', required: true }),
    ]);
    expect(errors.join(' ')).toMatch(/cannot be required/);
  });

  it('never counts positioning toward the proven list', () => {
    const report = evaluateClaimSet({
      claimSet: 'post',
      definitions: [claim({ id: 'grant-target', proof: 'positioning', required: false })],
      evidence: [evidence({ claimId: 'grant-target' })],
    });
    expect(report.provenClaims).toEqual([]);
    expect(report.unprovenClaims).toEqual(['grant-target']);
    // No required claim failed, so the SET passes while the claim itself remains unproven —
    // those are different questions and the report keeps them apart.
    expect(report.verdict).toBe('pass');
  });
});

describe('benchmark claims: a demo cannot carry them', () => {
  it('will not pass a benchmark claim from live evidence alone', () => {
    const decision = decideClaim(
      claim({
        id: 'references-improve-quality',
        proof: 'benchmark',
        requiredEvidence: ['reference-ids'],
      }),
      evidence({ claimId: 'references-improve-quality', present: ['reference-ids'], holds: true }),
    );
    expect(decision.verdict).toBe('not-run');
    expect(decision.reason).toMatch(/shows it happened, not that it helped/);
  });

  it('credits the separate receipt, and labels it as separate', () => {
    const decision = decideClaim(
      claim({
        id: 'references-improve-quality',
        proof: 'benchmark',
        requiredEvidence: ['reference-ids'],
      }),
      evidence({
        claimId: 'references-improve-quality',
        present: ['reference-ids'],
        holds: true,
        benchmarkReceiptId: 'harness-ab-2026-07-23',
      }),
    );
    expect(decision.verdict).toBe('supported-by-separate-benchmark');
    expect(isProofVerdict(decision.verdict)).toBe(true);
    expect(decision.reason).toMatch(/not by the live run/);
  });
});

describe('absent evidence is reported, never scored', () => {
  it('reports not-run when nothing was supplied', () => {
    const decision = decideClaim(claim(), undefined);
    expect(decision.verdict).toBe('not-run');
    expect(decision.missingEvidence).toEqual(['agent-transcript', 'generated-deck']);
  });

  it('refuses to decide on partial evidence rather than guessing', () => {
    const decision = decideClaim(claim(), evidence({ present: ['agent-transcript'] }));
    expect(decision.verdict).toBe('not-run');
    expect(decision.missingEvidence).toEqual(['generated-deck']);
    expect(decision.reason).toMatch(/guess wearing a verdict/);
  });

  it('distinguishes never-measured from measured-and-broken', () => {
    const notRun = decideClaim(claim(), undefined);
    const broken = decideClaim(claim(), evidence({ holds: false, detail: 'export was flattened' }));
    expect(notRun.verdict).toBe('not-run');
    expect(broken.verdict).toBe('failed');
    expect(broken.reason).toMatch(/flattened/);
  });
});

describe('scenario claims: one persona proves one persona', () => {
  const scenarioClaim = claim({
    id: 'researchers-and-founders',
    proof: 'scenario',
    requiredEvidence: ['generated-deck'],
  });

  it('is partially-proven when only the founder deck exists', () => {
    const decision = decideClaim(
      scenarioClaim,
      evidence({
        claimId: 'researchers-and-founders',
        present: ['generated-deck'],
        scenariosCovered: ['founder'],
      }),
      { requiredScenarios: ['founder', 'researcher'] },
    );
    expect(decision.verdict).toBe('partially-proven');
    expect(decision.reason).toMatch(/still unproven for researcher/);
    expect(isProofVerdict(decision.verdict)).toBe(false);
  });

  it('passes only once every required audience is covered', () => {
    const decision = decideClaim(
      scenarioClaim,
      evidence({
        claimId: 'researchers-and-founders',
        present: ['generated-deck'],
        scenariosCovered: ['founder', 'researcher'],
      }),
      { requiredScenarios: ['founder', 'researcher'] },
    );
    expect(decision.verdict).toBe('passed');
  });
});

describe('mostly autonomous: a number, not an adjective', () => {
  const measured = {
    humanMessages: 3,
    agentToolCalls: 47,
    agentAuthoredOperations: 31,
    manualFileEdits: 0,
    manualSlideEdits: 0,
  };

  it('accepts brief, one correction, acceptance', () => {
    expect(evaluateAutonomy(measured).withinBudget).toBe(true);
    expect(DEFAULT_AUTONOMY_BUDGET.maxHumanSteeringMessages).toBe(3);
  });

  it('FAILS when the human had to keep rescuing the run', () => {
    const result = evaluateAutonomy({ ...measured, humanMessages: 9 });
    expect(result.withinBudget).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/exceeds the budget/);
  });

  it('FAILS on a single hand-edited slide, however few messages were sent', () => {
    const result = evaluateAutonomy({ ...measured, humanMessages: 1, manualSlideEdits: 1 });
    expect(result.withinBudget).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/not agent-authored/);
  });

  it('does NOT treat a large tool-call count as autonomy', () => {
    // 400 calls and a human rescuing twice is less autonomous than 20 nobody touched.
    const chatty = evaluateAutonomy({ ...measured, agentToolCalls: 400, humanMessages: 7 });
    expect(chatty.withinBudget).toBe(false);
    const quiet = evaluateAutonomy({ ...measured, agentToolCalls: 12, humanMessages: 2 });
    expect(quiet.withinBudget).toBe(true);
  });

  it('FAILS a run where the agent authored nothing at all', () => {
    const result = evaluateAutonomy({ ...measured, agentAuthoredOperations: 0 });
    expect(result.withinBudget).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/nothing was demonstrated/);
  });
});

describe('the whole post: one recording must not certify nine claims', () => {
  const definitions: ClaimDefinition[] = [
    claim({ id: 'agent-builds-deck', proof: 'live', required: true }),
    claim({
      id: 'mostly-autonomous',
      proof: 'live',
      required: true,
      requiredEvidence: ['autonomy-receipt'],
    }),
    claim({
      id: 'visual-self-critique',
      proof: 'live',
      required: true,
      requiredEvidence: ['repair-cycle'],
    }),
    claim({
      id: 'harness-self-improvement',
      proof: 'benchmark',
      required: false,
      requiredEvidence: ['reference-ids'],
    }),
    claim({
      id: 'editable-pptx',
      proof: 'artifact',
      required: true,
      requiredEvidence: ['pptx-topology'],
    }),
    claim({
      id: 'researchers-and-founders',
      proof: 'scenario',
      required: false,
      requiredEvidence: ['generated-deck'],
    }),
    claim({
      id: 'nodekit-consumer-setup',
      proof: 'consumer',
      required: false,
      requiredEvidence: ['fresh-repo-install'],
    }),
    claim({ id: 'grant-and-batch-positioning', proof: 'positioning', required: false }),
  ];

  it('is a valid manifest', () => {
    expect(validateClaimDefinitions(definitions)).toEqual([]);
  });

  it('passes the live claims while refusing to certify the rest from the same run', () => {
    const report = evaluateClaimSet({
      claimSet: 'coding-agent-builds-slides',
      definitions,
      requiredScenarios: ['founder', 'researcher'],
      evidence: [
        evidence({ claimId: 'agent-builds-deck' }),
        evidence({ claimId: 'mostly-autonomous', present: ['autonomy-receipt'] }),
        evidence({ claimId: 'visual-self-critique', present: ['repair-cycle'] }),
        evidence({ claimId: 'harness-self-improvement', present: ['reference-ids'] }),
        evidence({ claimId: 'editable-pptx', present: ['pptx-topology'] }),
        evidence({
          claimId: 'researchers-and-founders',
          present: ['generated-deck'],
          scenariosCovered: ['founder'],
        }),
        // nodekit-consumer-setup deliberately unevidenced: the fresh-repo canary has not run.
        evidence({ claimId: 'grant-and-batch-positioning' }),
      ],
    });

    expect(report.verdict).toBe('pass');
    expect(report.provenClaims).toEqual([
      'agent-builds-deck',
      'mostly-autonomous',
      'visual-self-critique',
      'editable-pptx',
    ]);
    // The four the post would otherwise imply.
    expect(report.unprovenClaims).toEqual([
      'harness-self-improvement',
      'researchers-and-founders',
      'nodekit-consumer-setup',
      'grant-and-batch-positioning',
    ]);
    expect(report.schemaVersion).toBe(NODESLIDE_CLAIM_PROOF_VERSION);
  });

  it('fails the set when a required claim was never run — silence is not a pass', () => {
    const report = evaluateClaimSet({
      claimSet: 'coding-agent-builds-slides',
      definitions,
      evidence: [evidence({ claimId: 'agent-builds-deck' })],
    });
    expect(report.verdict).toBe('fail');
    expect(report.decisions.find((d) => d.claimId === 'editable-pptx')?.verdict).toBe('not-run');
  });

  it('fails the set when the export is flattened, even with a flawless recording', () => {
    const report = evaluateClaimSet({
      claimSet: 'coding-agent-builds-slides',
      definitions,
      evidence: [
        evidence({ claimId: 'agent-builds-deck' }),
        evidence({ claimId: 'mostly-autonomous', present: ['autonomy-receipt'] }),
        evidence({ claimId: 'visual-self-critique', present: ['repair-cycle'] }),
        evidence({
          claimId: 'editable-pptx',
          present: ['pptx-topology'],
          holds: false,
          detail: 'chart shipped as 49 autoshapes, no c:ser',
        }),
      ],
    });
    expect(report.verdict).toBe('fail');
    expect(report.summary).toMatch(/1 failed/);
  });

  it('names the count of every verdict so a summary cannot round up', () => {
    const report = evaluateClaimSet({ claimSet: 'x', definitions, evidence: [] });
    expect(report.summary).toMatch(/8 claims/);
    expect(report.summary).toMatch(/may not/);
  });
});
