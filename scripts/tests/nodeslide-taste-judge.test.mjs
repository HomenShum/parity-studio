import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  NODESLIDE_TASTE_JUDGE_MODEL,
  judgeTasteArtifacts,
  structuredOutputPayload,
} from '../nodeslide-taste-judge.mjs';
import {
  evaluateTastePair,
  loadTasteArtifact,
  loadTasteJudge,
  loadTasteRules,
  tasteRulesDigest,
  validateTasteJudge,
} from '../nodeslide-tastebench.mjs';
import { STATUS, sha256 } from '../nodeslide-uxbench.mjs';

const temporaryDirectories = [];
const FIXED_TIME = '2026-07-15T21:00:00.000Z';
let rules;
let originalOpenRouterKey;

beforeAll(async () => {
  rules = await loadTasteRules();
  originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
});

afterEach(async () => {
  if (originalOpenRouterKey === undefined) {
    Reflect.deleteProperty(process.env, 'OPENROUTER_API_KEY');
  } else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('NodeSlide independent taste judge', () => {
  it('uses one pinned vision route and emits a deterministic schema-compatible artifact', async () => {
    const inputs = await writeTasteInputs(await temporaryDirectory());
    const requests = [];
    const complete = vi.fn(async (request) => {
      requests.push(request);
      return validAssessmentResponse();
    });
    const outputPath = path.join(path.dirname(inputs.beforeManifestPath), 'judge.json');

    const first = await judgeTasteArtifacts(
      { ...inputs, outputPath },
      { complete, now: () => new Date(FIXED_TIME) },
    );
    const replay = await judgeTasteArtifacts(
      { ...inputs, outputPath },
      { complete, now: () => new Date(FIXED_TIME) },
    );

    expect(first.ok).toBe(true);
    expect(first.status).toBe(STATUS.PASS);
    expect(replay.artifact).toEqual(first.artifact);
    expect(first.write.written).toBe(true);
    expect(replay.write.written).toBe(false);
    expect(validateTasteJudge(first.artifact, rules)).toEqual([]);
    expect(first.artifact.rubric.digest).toBe(tasteRulesDigest(rules));
    expect(first.artifact.provenance).toMatchObject({
      judgedAt: FIXED_TIME,
      judgeType: 'independent_visual_judge',
      model: {
        provider: 'openrouter',
        name: NODESLIDE_TASTE_JUDGE_MODEL,
        version: '3.5',
      },
    });
    const loaded = await loadTasteJudge(outputPath, rules);
    expect(loaded.ok).toBe(true);
    expect(loaded.judge).toEqual(first.artifact);
    const before = await loadTasteArtifact(inputs.beforeManifestPath, 'before');
    const after = await loadTasteArtifact(inputs.afterManifestPath, 'after');
    expect(evaluateTastePair({ rules, before, after, judge: loaded }).status).toBe(STATUS.PASS);

    expect(complete).toHaveBeenCalledTimes(2);
    expect(requests.every(({ model }) => model === NODESLIDE_TASTE_JUDGE_MODEL)).toBe(true);
    expect(requests[0].userContent.filter(({ type }) => type === 'image')).toHaveLength(2);
    expect(requests[0].responseSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['assessments'],
    });
    expect(requests[0].userContent.map(({ type }) => type)).toEqual([
      'text',
      'text',
      'image',
      'text',
      'image',
    ]);
  });

  it('fails closed without invoking the model for missing, invalid, or incompatible pixels', async () => {
    const complete = vi.fn(async () => validAssessmentResponse());
    const missing = await judgeTasteArtifacts({}, { complete, now: () => FIXED_TIME });
    expect(missing).toMatchObject({ ok: false, status: STATUS.UNSCORED, artifact: null });

    const directory = await temporaryDirectory();
    const invalidInputs = await writeTasteInputs(directory, { badAfterDigest: true });
    const invalid = await judgeTasteArtifacts(invalidInputs, {
      complete,
      now: () => FIXED_TIME,
    });
    expect(invalid).toMatchObject({ ok: false, status: STATUS.UNSCORED, artifact: null });
    expect(invalid.errors.join(' ')).toMatch(/after evidence rejected/i);

    const mismatchInputs = await writeTasteInputs(await temporaryDirectory(), {
      afterCaseId: 'V07',
    });
    const mismatch = await judgeTasteArtifacts(mismatchInputs, {
      complete,
      now: () => FIXED_TIME,
    });
    expect(mismatch).toMatchObject({ ok: false, status: STATUS.UNSCORED, artifact: null });
    expect(mismatch.errors.join(' ')).toMatch(/case IDs do not match/i);
    expect(complete).not.toHaveBeenCalled();

    Reflect.deleteProperty(process.env, 'OPENROUTER_API_KEY');
    const validInputs = await writeTasteInputs(await temporaryDirectory());
    const missingKey = await judgeTasteArtifacts(validInputs, { now: () => FIXED_TIME });
    expect(missingKey).toMatchObject({ ok: false, status: STATUS.UNSCORED, artifact: null });
    expect(missingKey.errors).toEqual(['OpenRouter API key is not configured.']);
  });

  it('rejects malformed or incomplete model output instead of manufacturing scores', async () => {
    const inputs = await writeTasteInputs(await temporaryDirectory());
    const outputPath = path.join(path.dirname(inputs.beforeManifestPath), 'invalid-judge.json');
    const markdown = await judgeTasteArtifacts(
      { ...inputs, outputPath },
      {
        complete: async () => `\`\`\`json\n${validAssessmentResponse()}\n\`\`\``,
        now: () => FIXED_TIME,
      },
    );
    expect(markdown).toMatchObject({ ok: false, status: STATUS.UNSCORED, artifact: null });
    await expect(readFile(outputPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    const parsed = JSON.parse(validAssessmentResponse());
    parsed.assessments.pop();
    const incomplete = await judgeTasteArtifacts(inputs, {
      complete: async () => JSON.stringify(parsed),
      now: () => FIXED_TIME,
    });
    expect(incomplete).toMatchObject({ ok: false, status: STATUS.UNSCORED, artifact: null });
    expect(incomplete.errors).toEqual([
      'Visual judge response did not match the assessment schema.',
    ]);
  });

  it('never includes the OpenRouter key in requests, errors, artifacts, or structured payloads', async () => {
    const apiKey = 'openrouter-secret-test-key';
    process.env.OPENROUTER_API_KEY = apiKey;
    const inputs = await writeTasteInputs(await temporaryDirectory());
    let capturedRequest;
    const providerFailure = await judgeTasteArtifacts(inputs, {
      complete: async (request) => {
        capturedRequest = request;
        throw new Error(`provider rejected ${apiKey}`);
      },
      now: () => FIXED_TIME,
    });

    expect(providerFailure.status).toBe(STATUS.UNSCORED);
    expect(JSON.stringify(capturedRequest)).not.toContain(apiKey);
    expect(JSON.stringify(providerFailure)).not.toContain(apiKey);

    const secretResponse = JSON.parse(validAssessmentResponse());
    secretResponse.assessments[0].rationale = apiKey;
    const rejected = await judgeTasteArtifacts(inputs, {
      complete: async () => JSON.stringify(secretResponse),
      now: () => FIXED_TIME,
    });
    expect(rejected.status).toBe(STATUS.UNSCORED);
    expect(JSON.stringify(rejected)).not.toContain(apiKey);

    const secretMetadataInputs = await writeTasteInputs(await temporaryDirectory(), {
      beforePixelId: apiKey,
    });
    const secretMetadataComplete = vi.fn(async () => validAssessmentResponse());
    const rejectedRequest = await judgeTasteArtifacts(secretMetadataInputs, {
      complete: secretMetadataComplete,
      now: () => FIXED_TIME,
    });
    expect(rejectedRequest.status).toBe(STATUS.UNSCORED);
    expect(secretMetadataComplete).not.toHaveBeenCalled();
    expect(JSON.stringify(rejectedRequest)).not.toContain(apiKey);

    const payload = structuredOutputPayload(
      { model: NODESLIDE_TASTE_JUDGE_MODEL, messages: [] },
      { type: 'object' },
    );
    expect(payload).toMatchObject({
      model: NODESLIDE_TASTE_JUDGE_MODEL,
      provider: { require_parameters: true },
      response_format: {
        type: 'json_schema',
        json_schema: { strict: true, schema: { type: 'object' } },
      },
    });
    expect(JSON.stringify(payload)).not.toContain(apiKey);
  });
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'nodeslide-taste-judge-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeTasteInputs(
  directory,
  { badAfterDigest = false, afterCaseId = 'T09', beforePixelId = 'before-slide' } = {},
) {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const beforeBytes = Buffer.concat([pngSignature, Buffer.from('before-judge-pixels')]);
  const afterBytes = Buffer.concat([pngSignature, Buffer.from('after-judge-pixels')]);
  await writeFile(path.join(directory, 'before.png'), beforeBytes);
  await writeFile(path.join(directory, 'after.png'), afterBytes);

  const manifest = (phase, bytes, caseId) => ({
    schemaVersion: 'nodeslide-taste-artifact/v1',
    artifactId: `${phase}-artifact-${caseId.toLowerCase()}`,
    caseId,
    phase,
    provenance: {
      capturedAt: phase === 'before' ? '2026-07-15T20:00:00.000Z' : '2026-07-15T20:01:00.000Z',
      producer: { name: 'pixel-capture-harness', version: '1.0.0' },
      sourceRevision: 'c'.repeat(40),
      captureMethod: 'browser_screenshot',
    },
    capture: {
      slideId: 'slide-proof',
      stateDigest: `sha256:${phase === 'before' ? '1'.repeat(64) : '2'.repeat(64)}`,
      viewport: { width: 1512, height: 812, deviceScaleFactor: 1 },
    },
    pixels: [
      {
        id: phase === 'before' ? beforePixelId : `${phase}-slide`,
        path: `${phase}.png`,
        sha256: phase === 'after' && badAfterDigest ? `sha256:${'f'.repeat(64)}` : sha256(bytes),
        byteLength: bytes.byteLength,
        width: 1512,
        height: 812,
        mediaType: 'image/png',
      },
    ],
  });
  const beforePath = path.join(directory, 'before.manifest.json');
  const afterPath = path.join(directory, 'after.manifest.json');
  await writeFile(
    beforePath,
    `${JSON.stringify(manifest('before', beforeBytes, 'T09'), null, 2)}\n`,
  );
  await writeFile(
    afterPath,
    `${JSON.stringify(manifest('after', afterBytes, afterCaseId), null, 2)}\n`,
  );
  return { beforeManifestPath: beforePath, afterManifestPath: afterPath };
}

function validAssessmentResponse() {
  return JSON.stringify({
    assessments: rules.rules.map(({ id }) => ({
      ruleId: id,
      beforeScore: 2,
      afterScore: 3.5,
      confidence: 0.9,
      rationale: `The after frame improves ${id} while preserving visible evidence.`,
    })),
  });
}
