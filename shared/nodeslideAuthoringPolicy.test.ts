import { describe, expect, it } from 'vitest';
import {
  applyNodeSlideAuthoringPolicyPatch,
  createDefaultNodeSlideAuthoringPolicy,
  createNodeSlideAuthoringEvaluation,
  nodeSlideAuthoringParetoFront,
  nodeSlideAuthoringPolicyPromotable,
  selectNodeSlideAuthoringParent,
} from './nodeslideAuthoringPolicy';

describe('NodeSlide authoring policy meta loop', () => {
  const evaluation = (policyId: string, quality: number, costMicroUsd = 100, latencyMs = 100) =>
    createNodeSlideAuthoringEvaluation({
      policyId,
      heldOut: true,
      quality,
      safety: 100,
      exportFidelity: 100,
      costMicroUsd,
      latencyMs,
      journeyProofPassed: true,
      evaluatedAt: 1,
    });

  it('limits self-improvement to a versioned policy surface', () => {
    const base = createDefaultNodeSlideAuthoringPolicy();
    const child = applyNodeSlideAuthoringPolicyPatch(
      base,
      {
        rolePromptVersions: { narrative_architect: 'narrative_architect/v2' },
        maxRepairIterations: 4,
      },
      'authoring-policy:child-v2',
    );
    expect(child.parentId).toBe(base.id);
    expect(child.generation).toBe(1);
    expect(child.roles.narrative_architect.promptVersion).toBe('narrative_architect/v2');
  });

  it('refuses to disable mandatory safety and proof roles', () => {
    const base = createDefaultNodeSlideAuthoringPolicy();
    expect(() =>
      applyNodeSlideAuthoringPolicyPatch(
        base,
        { roleEnabled: { journey_capture_agent: false } },
        'authoring-policy:unsafe',
      ),
    ).toThrow(/bounded policy contract/u);
  });

  it('selects a deterministic Pareto parent from held-out proven runs', () => {
    const base = createDefaultNodeSlideAuthoringPolicy();
    const quality = applyNodeSlideAuthoringPolicyPatch(base, {}, 'authoring-policy:quality');
    const cheap = applyNodeSlideAuthoringPolicyPatch(base, {}, 'authoring-policy:cheap');
    const entries = [
      { policy: quality, evaluation: evaluation(quality.id, 94, 200, 150) },
      { policy: cheap, evaluation: evaluation(cheap.id, 90, 50, 80) },
      { policy: base, evaluation: evaluation(base.id, 80, 300, 300) },
    ];
    expect(nodeSlideAuthoringParetoFront(entries).map((entry) => entry.policy.id)).toEqual([
      quality.id,
      cheap.id,
    ]);
    expect(selectNodeSlideAuthoringParent(entries)?.policy.id).toBe(quality.id);
  });

  it('promotes only held-out quality gains without safety or fidelity regression', () => {
    const base = createDefaultNodeSlideAuthoringPolicy();
    const child = applyNodeSlideAuthoringPolicyPatch(base, {}, 'authoring-policy:better');
    expect(
      nodeSlideAuthoringPolicyPromotable({
        baseline: { policy: base, evaluation: evaluation(base.id, 80) },
        candidate: { policy: child, evaluation: evaluation(child.id, 90) },
      }),
    ).toBe(true);
  });
});
