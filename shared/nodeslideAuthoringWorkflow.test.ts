import { describe, expect, it } from 'vitest';
import {
  createNodeSlideAuthoringWorkflow,
  verifyNodeSlideAuthoringWorkflow,
} from './nodeslideAuthoringWorkflow';

describe('NodeSlide authoring workflow', () => {
  it('builds a tamper-evident creative and critic pipeline from the brief', () => {
    const workflow = createNodeSlideAuthoringWorkflow({
      prompt: 'Explain why NodeSlide should dogfood its own authoring workflow.',
      audience: 'Product and design leadership',
      purpose: 'Approve the quality-system roadmap',
      successCriteria: ['Show the end-to-end workflow', 'Keep every object editable'],
    });
    expect(verifyNodeSlideAuthoringWorkflow(workflow)).toBe(true);
    expect(workflow.stages.map((stage) => stage.role)).toEqual(
      expect.arrayContaining([
        'communication_strategist',
        'narrative_architect',
        'visual_director',
        'claim_verifier',
        'export_parity_critic',
        'journey_capture_agent',
      ]),
    );
    expect(workflow.providerInstruction).toMatch(/never invent decorative data/iu);
    expect(workflow.repairLoop.maxIterations).toBe(3);
  });

  it('detects a modified workflow', () => {
    const workflow = createNodeSlideAuthoringWorkflow({
      prompt: 'Deck',
      audience: 'Leaders',
      purpose: 'Decide',
      successCriteria: ['Decision'],
    });
    expect(
      verifyNodeSlideAuthoringWorkflow({ ...workflow, providerInstruction: 'Skip critique.' }),
    ).toBe(false);
  });
});
