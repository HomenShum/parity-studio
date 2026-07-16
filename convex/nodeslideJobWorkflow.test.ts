import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflowSource = readFileSync(
  fileURLToPath(new URL('./nodeslideJobWorkflow.ts', import.meta.url)),
  'utf8',
);
const runnerSource = readFileSync(
  fileURLToPath(new URL('./nodeslideJobRunner.ts', import.meta.url)),
  'utf8',
);

describe('NodeSlide durable workflow claim ordering', () => {
  it.each([
    ['create', 'export const createDeckJobWorkflow', 'executeCreateDeckInternal'],
    ['edit', 'export const editProposalJobWorkflow', 'executeEditProposalInternal'],
  ])(
    'keeps the %s job queued until the runner claims its durable lease',
    (_kind, start, action) => {
      const workflowStart = workflowSource.indexOf(start);
      const actionStart = workflowSource.indexOf(action, workflowStart);
      expect(workflowStart).toBeGreaterThanOrEqual(0);
      expect(actionStart).toBeGreaterThan(workflowStart);

      const preActionCheckpoint = workflowSource.slice(workflowStart, actionStart);
      expect(preActionCheckpoint).toContain("phase: 'planning'");
      expect(preActionCheckpoint).not.toContain("status: 'running'");

      const runnerStart = runnerSource.indexOf(`export const ${action}`);
      const runnerClaim = runnerSource.indexOf('claimAttemptInternal', runnerStart);
      const runnerGenerating = runnerSource.indexOf("phase: 'generating'", runnerStart);
      expect(runnerStart).toBeGreaterThanOrEqual(0);
      expect(runnerClaim).toBeGreaterThan(runnerStart);
      expect(runnerGenerating).toBeGreaterThan(runnerClaim);
    },
  );

  it.each([
    ['create', 'gate-create-deck', 'heartbeat-create-deck-result'],
    ['edit', 'gate-edit-proposal', 'heartbeat-edit-proposal-result'],
  ])('fences paused %s work before execution and before completion', (_kind, before, after) => {
    expect(workflowSource).toContain(`name: '${before}'`);
    expect(workflowSource).toContain(`name: '${after}'`);
    expect(workflowSource.match(/if \(!before(?:Create|Edit)\.shouldRun\) return;/gu)).toHaveLength(
      2,
    );
    expect(workflowSource.match(/if \(!after(?:Create|Edit)\.shouldRun\) return;/gu)).toHaveLength(
      2,
    );
  });
});
