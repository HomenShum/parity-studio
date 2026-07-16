import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  durableDigest,
  finalizeNodeSlideJourneyProof,
  verifyNodeSlideJourneyProofFiles,
} from '../nodeslide-journey-proof.mjs';

const directories = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'nodeslide-journey-proof-'));
  directories.push(directory);
  const paths = {
    rawRecordingPath: path.join(directory, 'journey.webm'),
    gifPath: path.join(directory, 'journey.gif'),
    finalScreenshotPath: path.join(directory, 'final.png'),
    exportedDeckPath: path.join(directory, 'deck.pptx'),
    runManifestPath: path.join(directory, 'run-manifest.json'),
  };
  await writeFile(paths.rawRecordingPath, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1]));
  await writeFile(paths.gifPath, Buffer.from('GIF89a'));
  await writeFile(
    paths.finalScreenshotPath,
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
  );
  await writeFile(paths.exportedDeckPath, Buffer.from('PKfixture'));
  const kinds = [
    'brief_submitted',
    'deck_created',
    'edit_submitted',
    'validation_received',
    'edit_applied',
    'undo_verified',
    'redo_verified',
    'version_advanced',
    'export_downloaded',
  ];
  const manifest = {
    deckId: 'deck-proof',
    expectedCreationProvenance: 'brief_to_new_deck',
    actualCreationProvenance: 'brief_to_new_deck',
    baseVersion: 1,
    appliedVersion: 2,
    finalVersion: 4,
    steps: kinds.map((kind, index) => {
      const common = { kind, occurredAt: index + 1 };
      if (kind === 'validation_received') {
        return {
          ...common,
          deckVersion: 1,
          receiptDigest: `sha256:${'1'.repeat(64)}`,
          runId: 'run-1',
          patchId: 'patch-1',
          candidateDigest: `sha256:${'c'.repeat(64)}`,
          baseDeckVersion: 1,
        };
      }
      if (kind === 'edit_applied') {
        return {
          ...common,
          deckVersion: 2,
          receiptDigest: `sha256:${'2'.repeat(64)}`,
          runId: 'run-1',
          patchId: 'patch-1',
          candidateDigest: `sha256:${'c'.repeat(64)}`,
          baseDeckVersion: 1,
          resultingDeckVersion: 2,
          contentDigest: `sha256:${'a'.repeat(64)}`,
        };
      }
      if (kind === 'undo_verified') {
        return {
          ...common,
          deckVersion: 3,
          receiptDigest: `sha256:${'3'.repeat(64)}`,
          patchId: 'patch-1',
          contentDigest: `sha256:${'b'.repeat(64)}`,
        };
      }
      if (kind === 'redo_verified') {
        return {
          ...common,
          deckVersion: 4,
          receiptDigest: `sha256:${'4'.repeat(64)}`,
          patchId: 'patch-1',
          contentDigest: `sha256:${'a'.repeat(64)}`,
        };
      }
      return common;
    }),
    artifacts: paths,
  };
  await writeFile(paths.runManifestPath, JSON.stringify(manifest));
  return { paths, manifest };
}

describe('NodeSlide journey proof artifact verifier', () => {
  it('writes a digest-bound proof only when every real artifact exists', async () => {
    const { paths } = await fixture();
    const result = await finalizeNodeSlideJourneyProof(paths.runManifestPath);
    expect(result.result.ok).toBe(true);
    expect(JSON.parse(await readFile(result.outputPath, 'utf8')).digest).toMatch(
      /^sha256:[0-9a-f]{64}$/u,
    );
  });

  it('fails closed for a missing GIF and a multi-version jump', async () => {
    const { paths, manifest } = await fixture();
    await rm(paths.gifPath);
    await writeFile(paths.runManifestPath, JSON.stringify({ ...manifest, appliedVersion: 3 }));
    await expect(finalizeNodeSlideJourneyProof(paths.runManifestPath)).rejects.toThrow(
      /exactly once|gifPath/iu,
    );
  });

  it('detects proof tampering after finalization', async () => {
    const { paths } = await fixture();
    const { proof } = await finalizeNodeSlideJourneyProof(paths.runManifestPath);
    expect((await verifyNodeSlideJourneyProofFiles({ ...proof, deckId: 'other' })).ok).toBe(false);
  });

  it('continues to verify v1 proofs while v2 artifacts migrate', async () => {
    const { paths } = await fixture();
    const partial = {
      schemaVersion: 'nodeslide.journey-proof/v1',
      deckId: 'deck-legacy',
      expectedCreationProvenance: 'brief_to_new_deck',
      actualCreationProvenance: 'brief_to_new_deck',
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
          ? { receiptDigest: `sha256:${'a'.repeat(64)}` }
          : {}),
      })),
      artifacts: paths,
    };
    const proof = { ...partial, digest: durableDigest(partial) };
    expect((await verifyNodeSlideJourneyProofFiles(proof)).ok).toBe(true);
  });
});
