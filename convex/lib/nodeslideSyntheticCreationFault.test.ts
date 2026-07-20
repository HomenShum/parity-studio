import { describe, expect, it, vi } from 'vitest';
import type { DeckBrief } from '../../shared/nodeslide';
import type { NodeSlideProviderResult } from './nodeslideProvider';
import {
  injectNodeSlideSyntheticCreationFault,
  resolveNodeSlideSyntheticCreationFault,
  runNodeSlideSyntheticCreationRepairDemo,
} from './nodeslideSyntheticCreationFault';

const ROADSHOW_BRIEF: DeckBrief = {
  prompt:
    'Build a seven-slide roadshow. Include a quarterly revenue chart using Q1 $120K, Q2 $180K, Q3 $260K, and Q4 $400K.',
  audience: 'seed-stage investors',
  purpose: 'Win a second partner meeting',
  successCriteria: ['Keep the quarterly chart auditable'],
};

const NOW = 1_700_000_000_000;
const LAYOUTS = [
  'hero',
  'comparison',
  'contract',
  'flow',
  'split',
  'evidence_board',
  'decision',
] as const;

const CORRECTED_SPEC = {
  title: 'Roadshow',
  narrative: ['Open', 'Build', 'Close'],
  plan: ['1. Open', '2. Evidence', '3. Ask'],
  slides: LAYOUTS.map((layout, index) => ({
    title: `Slide ${index + 1}`,
    section: `Act / 0${index + 1}`,
    headline: `Grounded takeaway for act ${index + 1}.`,
    body: 'Concise evidence-led copy that stays within the supplied brief.',
    bullets: ['Grounded point one', 'Grounded point two'],
    layout,
    ...(index === 4
      ? {
          chart: {
            labels: ['Q1', 'Q2', 'Q3', 'Q4'],
            values: [120, 180, 260, 400],
            unit: '$K',
          },
        }
      : {}),
  })),
};

describe('development-only synthetic creation repair demo', () => {
  it('fails closed unless both the runtime and allowlisted flag opt in', () => {
    expect(
      resolveNodeSlideSyntheticCreationFault({
        runtimeEnvironment: 'production',
        faultFlag: 'drop_requested_chart',
      }),
    ).toBeNull();
    expect(
      resolveNodeSlideSyntheticCreationFault({
        runtimeEnvironment: 'development',
        faultFlag: 'unknown',
      }),
    ).toBeNull();
    expect(
      resolveNodeSlideSyntheticCreationFault({
        runtimeEnvironment: 'development',
        faultFlag: 'drop_requested_chart',
      }),
    ).toBe('drop_requested_chart');
  });

  it('clones the provider spec, removes its requested chart, and labels the fault', () => {
    const injected = injectNodeSlideSyntheticCreationFault({
      rawSpec: CORRECTED_SPEC,
      brief: ROADSHOW_BRIEF,
      fault: 'drop_requested_chart',
    });
    expect(injected.applied).toBe(true);
    expect(injected.traceLabel).toContain('Development-only synthetic fault');
    expect(JSON.stringify(injected.spec)).not.toContain('"chart"');
    expect(JSON.stringify(CORRECTED_SPEC)).toContain('"chart"');
  });

  it('proves the real second provider pass repairs the materialized chart omission', async () => {
    const injected = injectNodeSlideSyntheticCreationFault({
      rawSpec: CORRECTED_SPEC,
      brief: ROADSHOW_BRIEF,
      fault: 'drop_requested_chart',
    });
    const requestRevision = vi.fn(
      async (promptReport: string): Promise<NodeSlideProviderResult> => {
        expect(promptReport).toContain('"missingPrimitives":["chart"]');
        return {
          ok: true,
          value: CORRECTED_SPEC,
          telemetry: {
            provider: 'openrouter',
            model: 'kimi-k3',
            costMicroUsd: 20,
            inputTokens: 900,
            outputTokens: 1_400,
          },
        };
      },
    );

    const outcome = await runNodeSlideSyntheticCreationRepairDemo({
      title: 'Roadshow',
      brief: ROADSHOW_BRIEF,
      themeId: 'editorial-signal',
      now: NOW,
      firstSpec: injected.spec,
      requestRevision,
    });

    expect(requestRevision).toHaveBeenCalledTimes(1);
    expect(outcome.decision).toBe('revised');
    expect(outcome.passes).toBe(2);
    expect(outcome.firstReport.missingRequestedChart).toBe(true);
    expect(outcome.chosenReport.missingRequestedChart).toBe(false);
    expect(outcome.spec).toBe(CORRECTED_SPEC);
  });

  it('keeps the visibly faulted pass when revision fails instead of faking a repair', async () => {
    const injected = injectNodeSlideSyntheticCreationFault({
      rawSpec: CORRECTED_SPEC,
      brief: ROADSHOW_BRIEF,
      fault: 'drop_requested_chart',
    });
    const outcome = await runNodeSlideSyntheticCreationRepairDemo({
      title: 'Roadshow',
      brief: ROADSHOW_BRIEF,
      themeId: 'editorial-signal',
      now: NOW,
      firstSpec: injected.spec,
      requestRevision: async () => ({ ok: false, reason: 'provider timeout' }),
    });

    expect(outcome.decision).toBe('revision_failed');
    expect(outcome.spec).toBe(injected.spec);
    expect(outcome.summary).toContain('kept pass 1');
  });

  it('records an inapplicable request without mutating the provider spec', () => {
    const withoutChartRequest: DeckBrief = {
      ...ROADSHOW_BRIEF,
      prompt: 'Build a seven-slide roadshow with concise executive copy.',
      successCriteria: ['Keep the decision clear'],
    };
    const injected = injectNodeSlideSyntheticCreationFault({
      rawSpec: CORRECTED_SPEC,
      brief: withoutChartRequest,
      fault: 'drop_requested_chart',
    });
    expect(injected.applied).toBe(false);
    expect(injected.spec).toBe(CORRECTED_SPEC);
    expect(injected.traceLabel).toContain('not applicable');
  });
});
