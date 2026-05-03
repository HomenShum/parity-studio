import { describe, expect, it } from 'vitest';
import { QUALITY_GATE_MAX_REPAIRS, shouldContinueQualityGate } from './qualityGate';

describe('quality gate', () => {
  it('continues repairing actionable failures under the cap', () => {
    expect(
      shouldContinueQualityGate(
        {
          status: 'failed',
          passCount: 4,
          totalChecks: 16,
          checks: [{ id: 'structure', status: 'fail' }],
        },
        QUALITY_GATE_MAX_REPAIRS - 1,
      ),
    ).toBe(true);
  });

  it('stops at the cap even when failures remain', () => {
    expect(
      shouldContinueQualityGate(
        {
          status: 'failed',
          passCount: 4,
          totalChecks: 16,
          checks: [{ id: 'structure', status: 'fail' }],
        },
        QUALITY_GATE_MAX_REPAIRS,
      ),
    ).toBe(false);
  });

  it('does not loop only for visual-only unavailable checks', () => {
    expect(
      shouldContinueQualityGate(
        {
          status: 'needs_review',
          passCount: 14,
          totalChecks: 16,
          checks: [
            { id: 'colorDelta', status: 'unavailable' },
            { id: 'visualRegression', status: 'unavailable' },
          ],
        },
        0,
      ),
    ).toBe(false);
  });
});
