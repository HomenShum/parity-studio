import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendAuthoringArchiveRecord,
  authoringCandidatePromotable,
  authoringParetoFront,
  loadAuthoringArchive,
} from '../nodeslide-authoring-meta.mjs';

const directories = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

function entry(id, quality, overrides = {}) {
  const roles = {
    claim_verifier: { enabled: true },
    export_parity_critic: { enabled: true },
    journey_capture_agent: { enabled: true },
  };
  return {
    policy: { id, roles, ...overrides.policy },
    evaluation: {
      policyId: id,
      heldOut: true,
      quality,
      safety: 100,
      exportFidelity: 100,
      costMicroUsd: 1000,
      latencyMs: 1000,
      journeyProofPassed: true,
      ...overrides.evaluation,
    },
  };
}

describe('NodeSlide authoring meta archive', () => {
  it('keeps an append-only verified hash chain and deterministic parent front', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'nodeslide-authoring-meta-'));
    directories.push(directory);
    const archive = path.join(directory, 'archive.jsonl');
    await appendAuthoringArchiveRecord(archive, entry('baseline', 80), 1);
    await appendAuthoringArchiveRecord(archive, entry('candidate', 90), 2);
    const records = await loadAuthoringArchive(archive);
    expect(records).toHaveLength(2);
    expect(authoringParetoFront(records.map((record) => record.entry))[0].policy.id).toBe(
      'candidate',
    );
  });

  it('rejects archive tampering and safety-role removal', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'nodeslide-authoring-meta-'));
    directories.push(directory);
    const archive = path.join(directory, 'archive.jsonl');
    await appendAuthoringArchiveRecord(archive, entry('baseline', 80), 1);
    await writeFile(archive, '{"tampered":true}\n');
    await expect(loadAuthoringArchive(archive)).rejects.toThrow(/hash chain/iu);
    await expect(
      appendAuthoringArchiveRecord(
        path.join(directory, 'unsafe.jsonl'),
        entry('unsafe', 99, {
          policy: {
            roles: {
              claim_verifier: { enabled: false },
              export_parity_critic: { enabled: true },
              journey_capture_agent: { enabled: true },
            },
          },
        }),
      ),
    ).rejects.toThrow(/mandatory/iu);
  });

  it('promotes only held-out quality gains without safety or export regression', () => {
    const baseline = entry('baseline', 80);
    const candidate = entry('candidate', 90, { policy: { parentId: 'baseline' } });
    expect(authoringCandidatePromotable(baseline, candidate)).toBe(true);
    expect(
      authoringCandidatePromotable(baseline, {
        ...candidate,
        evaluation: { ...candidate.evaluation, safety: 99 },
      }),
    ).toBe(false);
  });
});
