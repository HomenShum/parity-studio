import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  STATUS,
  aggregateStatus,
  digestValue,
  sha256,
  stableStringify,
} from './nodeslide-uxbench.mjs';

export const TASTEBENCH_VERSION = '1.0.0';
export const TASTEBENCH_REPORT_SCHEMA = 'nodeslide-tastebench-report/v1';
export const TASTE_ARTIFACT_SCHEMA = 'nodeslide-taste-artifact/v1';
export const TASTE_JUDGE_SCHEMA = 'nodeslide-taste-judge/v1';
export const TASTE_LOG_SCHEMA = 'nodeslide-tastebench-log/v1';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_TASTE_RULES_PATH = path.resolve(
  scriptDirectory,
  '..',
  'qa',
  'nodeslide-agent-corpus',
  'taste-rules.json',
);

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SOURCE_REVISION_PATTERN = /^[0-9a-f]{40,64}$/;
const CASE_ID_PATTERN = /^[A-Z][0-9]{2}$/;
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export async function loadTasteRules(rulesPath = DEFAULT_TASTE_RULES_PATH) {
  const rules = JSON.parse(await readFile(rulesPath, 'utf8'));
  const errors = validateTasteRules(rules);
  if (errors.length > 0) {
    throw new Error(`Invalid TasteBench rules:\n- ${errors.join('\n- ')}`);
  }
  return rules;
}

export function tasteRulesDigest(rules) {
  return digestValue(rules);
}

export function validateTasteRules(rules) {
  const errors = [];
  if (!isRecord(rules)) return ['rules must be an object'];
  rejectUnknownKeys(
    rules,
    new Set(['schemaVersion', 'rubricId', 'scoreRange', 'rules', 'decision']),
    'rules',
    errors,
  );
  if (rules.schemaVersion !== 'nodeslide-held-out-taste-rules/v1') {
    errors.push('rules schemaVersion is invalid');
  }
  if (rules.rubricId !== 'nodeslide-held-out-taste/v1') errors.push('rules rubricId is invalid');
  if (
    !isRecord(rules.scoreRange) ||
    typeof rules.scoreRange.minimum !== 'number' ||
    typeof rules.scoreRange.maximum !== 'number' ||
    rules.scoreRange.maximum <= rules.scoreRange.minimum
  ) {
    errors.push('scoreRange must define an increasing numeric range');
  } else {
    rejectUnknownKeys(rules.scoreRange, new Set(['minimum', 'maximum']), 'scoreRange', errors);
  }
  if (!Array.isArray(rules.rules) || rules.rules.length === 0) {
    errors.push('rules must be a nonempty array');
  } else {
    const ids = new Set();
    for (const [index, rule] of rules.rules.entries()) {
      if (!isRecord(rule)) {
        errors.push(`rules[${index}] must be an object`);
        continue;
      }
      rejectUnknownKeys(
        rule,
        new Set(['id', 'description', 'minimumAfter', 'minimumDelta', 'weight']),
        `rules[${index}]`,
        errors,
      );
      if (!nonemptyString(rule.id)) errors.push(`rules[${index}].id must be nonempty`);
      if (ids.has(rule.id)) errors.push(`duplicate taste rule ${rule.id}`);
      ids.add(rule.id);
      if (!nonemptyString(rule.description)) {
        errors.push(`rules[${index}].description must be nonempty`);
      }
      for (const key of ['minimumAfter', 'minimumDelta', 'weight']) {
        if (typeof rule[key] !== 'number') errors.push(`rules[${index}].${key} must be numeric`);
      }
      if (rule.weight <= 0) errors.push(`rules[${index}].weight must be positive`);
    }
  }
  if (!isRecord(rules.decision)) {
    errors.push('decision must be an object');
  } else {
    rejectUnknownKeys(
      rules.decision,
      new Set([
        'minimumWeightedAfter',
        'minimumWeightedDelta',
        'maximumRegressions',
        'minimumJudgeConfidence',
      ]),
      'decision',
      errors,
    );
    for (const key of [
      'minimumWeightedAfter',
      'minimumWeightedDelta',
      'maximumRegressions',
      'minimumJudgeConfidence',
    ]) {
      if (typeof rules.decision[key] !== 'number') errors.push(`decision.${key} must be numeric`);
    }
    if (rules.decision.minimumJudgeConfidence < 0 || rules.decision.minimumJudgeConfidence > 1) {
      errors.push('decision.minimumJudgeConfidence must be within 0-1');
    }
  }
  return errors;
}

export async function loadTasteArtifact(manifestPath, expectedPhase) {
  const manifestName = path.basename(manifestPath);
  let bytes;
  let manifest;
  try {
    bytes = await readFile(manifestPath);
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    return invalidInput({
      kind: expectedPhase ?? 'artifact',
      manifestName,
      manifestDigest: bytes ? sha256(bytes) : null,
      errors: [`cannot read manifest: ${errorMessage(error)}`],
    });
  }
  const manifestDigest = sha256(bytes);
  const errors = validateTasteArtifactManifest(manifest, expectedPhase);
  if (errors.length > 0) {
    return invalidInput({
      kind: expectedPhase ?? manifest.phase ?? 'artifact',
      caseId: CASE_ID_PATTERN.test(manifest.caseId ?? '') ? manifest.caseId : null,
      manifestName,
      manifestDigest,
      errors,
    });
  }

  const verifiedPixels = [];
  for (const pixel of manifest.pixels) {
    let pixelPath;
    try {
      pixelPath = resolveContainedPath(path.dirname(manifestPath), pixel.path);
      const pixelBytes = await readFile(pixelPath);
      if (sha256(pixelBytes) !== pixel.sha256) throw new Error(`${pixel.id} sha256 mismatch`);
      if (pixelBytes.byteLength !== pixel.byteLength) {
        throw new Error(`${pixel.id} byteLength mismatch`);
      }
      if (!validImageSignature(pixelBytes, pixel.mediaType)) {
        throw new Error(`${pixel.id} does not match ${pixel.mediaType}`);
      }
      verifiedPixels.push({ ...pixel, path: normalizeRelativePath(pixel.path) });
    } catch (error) {
      errors.push(`pixel evidence rejected: ${errorMessage(error)}`);
    }
  }
  if (errors.length > 0) {
    return invalidInput({
      kind: manifest.phase,
      caseId: manifest.caseId,
      manifestName,
      manifestDigest,
      errors,
    });
  }
  return {
    ok: true,
    kind: manifest.phase,
    caseId: manifest.caseId,
    manifest,
    manifestName,
    manifestDigest,
    pixels: verifiedPixels,
  };
}

export function validateTasteArtifactManifest(manifest, expectedPhase) {
  const errors = [];
  if (!isRecord(manifest)) return ['artifact manifest must be an object'];
  rejectUnknownKeys(
    manifest,
    new Set(['schemaVersion', 'artifactId', 'caseId', 'phase', 'provenance', 'capture', 'pixels']),
    'artifact manifest',
    errors,
  );
  if (manifest.schemaVersion !== TASTE_ARTIFACT_SCHEMA) {
    errors.push(`schemaVersion must be ${TASTE_ARTIFACT_SCHEMA}`);
  }
  if (!nonemptyString(manifest.artifactId)) errors.push('artifactId must be nonempty');
  if (!CASE_ID_PATTERN.test(manifest.caseId ?? '')) errors.push('caseId is invalid');
  if (!['before', 'after'].includes(manifest.phase)) errors.push('phase must be before or after');
  if (expectedPhase && manifest.phase !== expectedPhase) {
    errors.push(`phase must be ${expectedPhase}`);
  }
  validateArtifactProvenance(manifest.provenance, errors);
  validateCapture(manifest.capture, errors);
  if (!Array.isArray(manifest.pixels) || manifest.pixels.length === 0) {
    errors.push('pixels must contain at least one pixel artifact');
  } else {
    const ids = new Set();
    for (const [index, pixel] of manifest.pixels.entries()) {
      if (!isRecord(pixel)) {
        errors.push(`pixels[${index}] must be an object`);
        continue;
      }
      rejectUnknownKeys(
        pixel,
        new Set(['id', 'path', 'sha256', 'byteLength', 'width', 'height', 'mediaType']),
        `pixels[${index}]`,
        errors,
      );
      if (!nonemptyString(pixel.id)) errors.push(`pixels[${index}].id must be nonempty`);
      if (ids.has(pixel.id)) errors.push(`duplicate pixel ID ${pixel.id}`);
      ids.add(pixel.id);
      if (!nonemptyString(pixel.path)) errors.push(`pixels[${index}].path must be nonempty`);
      if (!SHA256_PATTERN.test(pixel.sha256 ?? '')) {
        errors.push(`pixels[${index}].sha256 is invalid`);
      }
      if (!positiveInteger(pixel.byteLength)) {
        errors.push(`pixels[${index}].byteLength must be positive`);
      }
      if (!positiveInteger(pixel.width) || !positiveInteger(pixel.height)) {
        errors.push(`pixels[${index}] dimensions must be positive integers`);
      }
      if (!IMAGE_MEDIA_TYPES.has(pixel.mediaType)) {
        errors.push(`pixels[${index}].mediaType is invalid`);
      }
    }
  }
  return errors;
}

function validateArtifactProvenance(provenance, errors) {
  if (!isRecord(provenance)) {
    errors.push('provenance must be an object');
    return;
  }
  rejectUnknownKeys(
    provenance,
    new Set(['capturedAt', 'producer', 'sourceRevision', 'captureMethod']),
    'provenance',
    errors,
  );
  if (!validIsoDate(provenance.capturedAt)) errors.push('provenance.capturedAt is invalid');
  validateProducer(provenance.producer, 'provenance.producer', errors);
  if (!SOURCE_REVISION_PATTERN.test(provenance.sourceRevision ?? '')) {
    errors.push('provenance.sourceRevision is invalid');
  }
  if (provenance.captureMethod !== 'browser_screenshot') {
    errors.push('provenance.captureMethod must be browser_screenshot');
  }
}

function validateCapture(capture, errors) {
  if (!isRecord(capture)) {
    errors.push('capture must be an object');
    return;
  }
  rejectUnknownKeys(capture, new Set(['slideId', 'stateDigest', 'viewport']), 'capture', errors);
  if (!nonemptyString(capture.slideId)) errors.push('capture.slideId must be nonempty');
  if (!SHA256_PATTERN.test(capture.stateDigest ?? ''))
    errors.push('capture.stateDigest is invalid');
  if (!isRecord(capture.viewport)) {
    errors.push('capture.viewport must be an object');
  } else {
    rejectUnknownKeys(
      capture.viewport,
      new Set(['width', 'height', 'deviceScaleFactor']),
      'capture.viewport',
      errors,
    );
    if (!positiveInteger(capture.viewport.width) || !positiveInteger(capture.viewport.height)) {
      errors.push('capture.viewport width and height must be positive integers');
    }
    if (
      typeof capture.viewport.deviceScaleFactor !== 'number' ||
      capture.viewport.deviceScaleFactor <= 0
    ) {
      errors.push('capture.viewport.deviceScaleFactor must be positive');
    }
  }
}

export async function loadTasteJudge(judgePath, rules) {
  const manifestName = path.basename(judgePath);
  let bytes;
  let judge;
  try {
    bytes = await readFile(judgePath);
    judge = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    return invalidInput({
      kind: 'judge',
      manifestName,
      manifestDigest: bytes ? sha256(bytes) : null,
      errors: [`cannot read judge evidence: ${errorMessage(error)}`],
    });
  }
  const manifestDigest = sha256(bytes);
  const errors = validateTasteJudge(judge, rules);
  if (errors.length > 0) {
    return invalidInput({
      kind: 'judge',
      caseId: CASE_ID_PATTERN.test(judge.caseId ?? '') ? judge.caseId : null,
      manifestName,
      manifestDigest,
      errors,
    });
  }
  return {
    ok: true,
    kind: 'judge',
    caseId: judge.caseId,
    manifestName,
    manifestDigest,
    judge,
  };
}

export function validateTasteJudge(judge, rules) {
  const errors = [];
  if (!isRecord(judge)) return ['judge evidence must be an object'];
  rejectUnknownKeys(
    judge,
    new Set([
      'schemaVersion',
      'judgmentId',
      'caseId',
      'bindings',
      'rubric',
      'provenance',
      'assessments',
    ]),
    'judge evidence',
    errors,
  );
  if (judge.schemaVersion !== TASTE_JUDGE_SCHEMA) {
    errors.push(`schemaVersion must be ${TASTE_JUDGE_SCHEMA}`);
  }
  if (!nonemptyString(judge.judgmentId)) errors.push('judgmentId must be nonempty');
  if (!CASE_ID_PATTERN.test(judge.caseId ?? '')) errors.push('caseId is invalid');
  validateJudgeBindings(judge.bindings, errors);
  if (!isRecord(judge.rubric)) {
    errors.push('rubric must be an object');
  } else {
    rejectUnknownKeys(judge.rubric, new Set(['id', 'digest']), 'rubric', errors);
    if (judge.rubric.id !== rules.rubricId) errors.push('rubric.id does not match held-out rules');
    if (judge.rubric.digest !== tasteRulesDigest(rules)) {
      errors.push('rubric.digest does not match held-out rules');
    }
  }
  validateJudgeProvenance(judge.provenance, errors);
  validateAssessments(judge.assessments, rules, errors);
  return errors;
}

function validateJudgeBindings(bindings, errors) {
  if (!isRecord(bindings)) {
    errors.push('bindings must be an object');
    return;
  }
  rejectUnknownKeys(
    bindings,
    new Set([
      'beforeArtifactId',
      'beforeManifestDigest',
      'afterArtifactId',
      'afterManifestDigest',
      'pixelPairs',
    ]),
    'bindings',
    errors,
  );
  for (const key of ['beforeArtifactId', 'afterArtifactId']) {
    if (!nonemptyString(bindings[key])) errors.push(`bindings.${key} must be nonempty`);
  }
  for (const key of ['beforeManifestDigest', 'afterManifestDigest']) {
    if (!SHA256_PATTERN.test(bindings[key] ?? '')) errors.push(`bindings.${key} is invalid`);
  }
  validatePixelPairs(bindings.pixelPairs, 'bindings.pixelPairs', errors);
}

function validateJudgeProvenance(provenance, errors) {
  if (!isRecord(provenance)) {
    errors.push('judge provenance must be an object');
    return;
  }
  rejectUnknownKeys(
    provenance,
    new Set(['judgedAt', 'judgeType', 'producer', 'model', 'promptDigest']),
    'judge provenance',
    errors,
  );
  if (!validIsoDate(provenance.judgedAt)) errors.push('provenance.judgedAt is invalid');
  if (provenance.judgeType !== 'independent_visual_judge') {
    errors.push('provenance.judgeType must be independent_visual_judge');
  }
  validateProducer(provenance.producer, 'provenance.producer', errors);
  if (!isRecord(provenance.model)) {
    errors.push('provenance.model must be an object');
  } else {
    rejectUnknownKeys(
      provenance.model,
      new Set(['provider', 'name', 'version']),
      'provenance.model',
      errors,
    );
    for (const key of ['provider', 'name', 'version']) {
      if (!nonemptyString(provenance.model[key])) {
        errors.push(`provenance.model.${key} must be nonempty`);
      }
    }
  }
  if (!SHA256_PATTERN.test(provenance.promptDigest ?? '')) {
    errors.push('provenance.promptDigest is invalid');
  }
}

function validateAssessments(assessments, rules, errors) {
  if (!Array.isArray(assessments) || assessments.length === 0) {
    errors.push('assessments must be a nonempty array');
    return;
  }
  const expectedRuleIds = rules.rules.map(({ id }) => id).sort();
  const actualRuleIds = assessments.map(({ ruleId }) => ruleId).sort();
  if (stableStringify(expectedRuleIds) !== stableStringify(actualRuleIds)) {
    errors.push('assessments must cover every held-out rule exactly once');
  }
  for (const [index, assessment] of assessments.entries()) {
    if (!isRecord(assessment)) {
      errors.push(`assessments[${index}] must be an object`);
      continue;
    }
    rejectUnknownKeys(
      assessment,
      new Set(['ruleId', 'beforeScore', 'afterScore', 'confidence', 'pixelPairs', 'rationale']),
      `assessments[${index}]`,
      errors,
    );
    if (!nonemptyString(assessment.ruleId)) {
      errors.push(`assessments[${index}].ruleId must be nonempty`);
    }
    for (const key of ['beforeScore', 'afterScore']) {
      if (
        typeof assessment[key] !== 'number' ||
        assessment[key] < rules.scoreRange.minimum ||
        assessment[key] > rules.scoreRange.maximum
      ) {
        errors.push(`assessments[${index}].${key} is outside the score range`);
      }
    }
    if (
      typeof assessment.confidence !== 'number' ||
      assessment.confidence < 0 ||
      assessment.confidence > 1
    ) {
      errors.push(`assessments[${index}].confidence must be within 0-1`);
    }
    validatePixelPairs(assessment.pixelPairs, `assessments[${index}].pixelPairs`, errors);
  }
}

function validatePixelPairs(pairs, label, errors) {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    errors.push(`${label} must be a nonempty array`);
    return;
  }
  for (const [index, pair] of pairs.entries()) {
    if (isRecord(pair)) {
      rejectUnknownKeys(
        pair,
        new Set(['beforePixelId', 'afterPixelId']),
        `${label}[${index}]`,
        errors,
      );
    }
    if (
      !isRecord(pair) ||
      !nonemptyString(pair.beforePixelId) ||
      !nonemptyString(pair.afterPixelId)
    ) {
      errors.push(`${label}[${index}] must identify before and after pixels`);
    }
  }
}

export function evaluateTastePair({ rules, before, after, judge, caseId: suppliedCaseId = null }) {
  const caseId = suppliedCaseId ?? before?.caseId ?? after?.caseId ?? judge?.caseId ?? null;
  const checks = [];
  const invalidInputs = [before, after, judge].filter((input) => input && !input.ok);
  for (const input of invalidInputs) {
    checks.push(
      makeCheck(
        `${input.kind}-provenance`,
        STATUS.UNSCORED,
        `${input.kind} evidence rejected: ${input.errors.join('; ')}`,
        input.manifestDigest ? [manifestReference(input, '')] : [],
      ),
    );
  }
  if (!before) {
    checks.push(
      makeCheck('before-pixels', STATUS.UNSCORED, 'Before pixel evidence was not supplied.', []),
    );
  } else if (before.ok) {
    checks.push(
      makeCheck(
        'before-pixels',
        STATUS.PASS,
        'Before pixels and their digests were verified.',
        before.pixels.map((pixel) => pixelReference(before, pixel)),
      ),
    );
  }
  if (!after) {
    checks.push(
      makeCheck('after-pixels', STATUS.UNSCORED, 'After pixel evidence was not supplied.', []),
    );
  } else if (after.ok) {
    checks.push(
      makeCheck(
        'after-pixels',
        STATUS.PASS,
        'After pixels and their digests were verified.',
        after.pixels.map((pixel) => pixelReference(after, pixel)),
      ),
    );
  }
  if (!judge) {
    checks.push(
      makeCheck(
        'independent-judge',
        STATUS.UNSCORED,
        'Independent visual-judge evidence was not supplied.',
        [],
      ),
    );
  }

  const allValid = before?.ok && after?.ok && judge?.ok;
  let metrics = null;
  if (allValid) {
    const bindingErrors = validatePairBindings({ rules, before, after, judge });
    if (bindingErrors.length > 0) {
      checks.push(
        makeCheck(
          'paired-provenance',
          STATUS.UNSCORED,
          `Paired evidence rejected: ${bindingErrors.join('; ')}`,
          [
            manifestReference(before, '/capture'),
            manifestReference(after, '/capture'),
            judgeReference(judge, '/bindings'),
          ],
        ),
      );
    } else {
      checks.push(
        makeCheck(
          'paired-provenance',
          STATUS.PASS,
          'Before, after, judge, viewport, and held-out rubric bindings were verified.',
          [
            manifestReference(before, '/capture'),
            manifestReference(after, '/capture'),
            judgeReference(judge, '/bindings'),
            judgeReference(judge, '/rubric'),
          ],
        ),
      );
      const ruleResult = evaluateTasteRules({ rules, before, after, judge });
      checks.push(...ruleResult.checks);
      metrics = ruleResult.metrics;
    }
  }

  const reportWithoutId = {
    schemaVersion: TASTEBENCH_REPORT_SCHEMA,
    harness: { name: 'nodeslide-tastebench', version: TASTEBENCH_VERSION },
    caseId,
    status: aggregateStatus(checks.map(({ status }) => status)),
    proofPolicy: {
      beforePixelsRequired: true,
      afterPixelsRequired: true,
      independentJudgeRequired: true,
      selfReportedUiStringsAccepted: false,
    },
    summary: statusCounts(checks.map(({ status }) => status)),
    metrics,
    checks,
    provenance: {
      rulesDigest: tasteRulesDigest(rules),
      beforeManifestDigest: before?.manifestDigest ?? null,
      afterManifestDigest: after?.manifestDigest ?? null,
      judgeManifestDigest: judge?.manifestDigest ?? null,
      beforeSourceRevision: before?.ok ? before.manifest.provenance.sourceRevision : null,
      afterSourceRevision: after?.ok ? after.manifest.provenance.sourceRevision : null,
      judge: judge?.ok
        ? {
            judgmentId: judge.judge.judgmentId,
            producer: judge.judge.provenance.producer,
            model: judge.judge.provenance.model,
            promptDigest: judge.judge.provenance.promptDigest,
          }
        : null,
    },
  };
  return { ...reportWithoutId, reportId: digestValue(reportWithoutId) };
}

function validatePairBindings({ rules, before, after, judge }) {
  const errors = [];
  if (
    before.manifest.caseId !== after.manifest.caseId ||
    before.manifest.caseId !== judge.judge.caseId
  ) {
    errors.push('case IDs do not match');
  }
  if (before.manifest.capture.slideId !== after.manifest.capture.slideId) {
    errors.push('slide IDs do not match');
  }
  if (!deepEqual(before.manifest.capture.viewport, after.manifest.capture.viewport)) {
    errors.push('viewports do not match');
  }
  const bindings = judge.judge.bindings;
  if (bindings.beforeArtifactId !== before.manifest.artifactId) {
    errors.push('judge beforeArtifactId does not match');
  }
  if (bindings.afterArtifactId !== after.manifest.artifactId) {
    errors.push('judge afterArtifactId does not match');
  }
  if (bindings.beforeManifestDigest !== before.manifestDigest) {
    errors.push('judge beforeManifestDigest does not match');
  }
  if (bindings.afterManifestDigest !== after.manifestDigest) {
    errors.push('judge afterManifestDigest does not match');
  }
  if (judge.judge.rubric.digest !== tasteRulesDigest(rules)) {
    errors.push('judge rubric digest does not match');
  }
  const beforePixelIds = new Set(before.pixels.map(({ id }) => id));
  const afterPixelIds = new Set(after.pixels.map(({ id }) => id));
  for (const pair of bindings.pixelPairs) {
    if (!beforePixelIds.has(pair.beforePixelId))
      errors.push(`unknown before pixel ${pair.beforePixelId}`);
    if (!afterPixelIds.has(pair.afterPixelId))
      errors.push(`unknown after pixel ${pair.afterPixelId}`);
    const beforePixel = before.pixels.find(({ id }) => id === pair.beforePixelId);
    const afterPixel = after.pixels.find(({ id }) => id === pair.afterPixelId);
    if (beforePixel && afterPixel) {
      if (beforePixel.width !== afterPixel.width || beforePixel.height !== afterPixel.height) {
        errors.push(
          `pixel pair ${pair.beforePixelId}/${pair.afterPixelId} has different dimensions`,
        );
      }
      const pairClaimedDifferent = judge.judge.assessments.some(
        (assessment) =>
          assessment.beforeScore !== assessment.afterScore &&
          assessment.pixelPairs.some(
            (candidate) =>
              candidate.beforePixelId === pair.beforePixelId &&
              candidate.afterPixelId === pair.afterPixelId,
          ),
      );
      if (beforePixel.sha256 === afterPixel.sha256 && pairClaimedDifferent) {
        errors.push('judge claims a score change for byte-identical before and after pixels');
      }
    }
  }
  const captureProducers = new Set([
    before.manifest.provenance.producer.name,
    after.manifest.provenance.producer.name,
  ]);
  if (captureProducers.has(judge.judge.provenance.producer.name)) {
    errors.push('visual judge producer must be independent from capture producer');
  }
  return errors;
}

function evaluateTasteRules({ rules, before, after, judge }) {
  const checks = [];
  const assessmentByRule = new Map(
    judge.judge.assessments.map((assessment, index) => [assessment.ruleId, { assessment, index }]),
  );
  const validBoundPairs = new Set(
    judge.judge.bindings.pixelPairs.map(
      (pair) => `${pair.beforePixelId}\u0000${pair.afterPixelId}`,
    ),
  );
  const scored = [];
  for (const rule of rules.rules) {
    const { assessment, index } = assessmentByRule.get(rule.id);
    const pairBindingsValid = assessment.pixelPairs.every((pair) =>
      validBoundPairs.has(`${pair.beforePixelId}\u0000${pair.afterPixelId}`),
    );
    const refs = assessment.pixelPairs.flatMap((pair) => {
      const beforePixel = before.pixels.find(({ id }) => id === pair.beforePixelId);
      const afterPixel = after.pixels.find(({ id }) => id === pair.afterPixelId);
      return [pixelReference(before, beforePixel), pixelReference(after, afterPixel)];
    });
    refs.push(judgeReference(judge, `/assessments/${index}`));
    if (!pairBindingsValid) {
      checks.push(
        makeCheck(
          `rule-${rule.id}`,
          STATUS.UNSCORED,
          `${rule.id} cites a pixel pair outside the verified judge binding.`,
          refs,
        ),
      );
      continue;
    }
    if (assessment.confidence < rules.decision.minimumJudgeConfidence) {
      checks.push(
        makeCheck(
          `rule-${rule.id}`,
          STATUS.UNSCORED,
          `${rule.id} judge confidence ${assessment.confidence} is below ${rules.decision.minimumJudgeConfidence}.`,
          refs,
        ),
      );
      continue;
    }
    const delta = assessment.afterScore - assessment.beforeScore;
    const pass = assessment.afterScore >= rule.minimumAfter && delta >= rule.minimumDelta;
    scored.push({ rule, assessment, delta });
    checks.push(
      makeCheck(
        `rule-${rule.id}`,
        pass ? STATUS.PASS : STATUS.FAIL,
        pass
          ? `${rule.id} met after >= ${rule.minimumAfter} and delta >= ${rule.minimumDelta}.`
          : `${rule.id} missed a held-out threshold: after ${assessment.afterScore}, delta ${delta}.`,
        refs,
      ),
    );
  }
  let metrics = null;
  if (scored.length === rules.rules.length) {
    const totalWeight = scored.reduce((sum, { rule }) => sum + rule.weight, 0);
    const weightedAfter =
      scored.reduce((sum, { rule, assessment }) => sum + assessment.afterScore * rule.weight, 0) /
      totalWeight;
    const weightedDelta =
      scored.reduce((sum, { rule, delta }) => sum + delta * rule.weight, 0) / totalWeight;
    const regressions = scored.filter(({ delta }) => delta < 0).length;
    metrics = {
      weightedAfter: roundMetric(weightedAfter),
      weightedDelta: roundMetric(weightedDelta),
      regressions,
    };
    const aggregatePass =
      weightedAfter >= rules.decision.minimumWeightedAfter &&
      weightedDelta >= rules.decision.minimumWeightedDelta &&
      regressions <= rules.decision.maximumRegressions;
    checks.push(
      makeCheck(
        'held-out-aggregate',
        aggregatePass ? STATUS.PASS : STATUS.FAIL,
        aggregatePass
          ? 'The weighted held-out taste thresholds passed.'
          : 'The weighted held-out taste thresholds failed.',
        [judgeReference(judge, '/assessments')],
      ),
    );
  } else {
    checks.push(
      makeCheck(
        'held-out-aggregate',
        STATUS.UNSCORED,
        'The aggregate is unscored because one or more rules lack sufficient evidence.',
        [judgeReference(judge, '/assessments')],
      ),
    );
  }
  return { checks, metrics };
}

export async function appendTasteReport(outputPath, report) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const lockPath = `${outputPath}.lock`;
  let lock;
  try {
    lock = await open(lockPath, 'wx');
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('TasteBench output is locked by another writer.');
    throw error;
  }
  try {
    let content = '';
    try {
      content = await readFile(outputPath, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const envelopes = parseAndValidateLog(content);
    const existing = envelopes.find(({ recordId }) => recordId === report.reportId);
    if (existing) {
      if (!deepEqual(existing.report, report)) {
        throw new Error('Existing TasteBench record ID has nonidentical content.');
      }
      return { appended: false, envelope: existing };
    }
    const previousRecordDigest = envelopes.length === 0 ? null : digestValue(envelopes.at(-1));
    const envelope = {
      schemaVersion: TASTE_LOG_SCHEMA,
      recordId: report.reportId,
      previousRecordDigest,
      report,
    };
    const handle = await open(outputPath, 'a');
    try {
      await handle.write(`${JSON.stringify(envelope)}\n`, null, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    return { appended: true, envelope };
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}

export function parseAndValidateLog(content) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const envelopes = [];
  let previousDigest = null;
  for (const [index, line] of lines.entries()) {
    let envelope;
    try {
      envelope = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid TasteBench log JSON on line ${index + 1}: ${errorMessage(error)}`);
    }
    if (!isRecord(envelope) || envelope.schemaVersion !== TASTE_LOG_SCHEMA) {
      throw new Error(`Invalid TasteBench log envelope on line ${index + 1}.`);
    }
    if (envelope.previousRecordDigest !== previousDigest) {
      throw new Error(`Broken TasteBench hash chain on line ${index + 1}.`);
    }
    if (!isRecord(envelope.report) || envelope.recordId !== envelope.report.reportId) {
      throw new Error(`Invalid TasteBench record binding on line ${index + 1}.`);
    }
    const { reportId, ...reportWithoutId } = envelope.report;
    if (digestValue(reportWithoutId) !== reportId) {
      throw new Error(`Invalid TasteBench report digest on line ${index + 1}.`);
    }
    envelopes.push(envelope);
    previousDigest = digestValue(envelope);
  }
  return envelopes;
}

async function cli(argv) {
  const options = parseCliArguments(argv);
  if (!options.outputPath) throw new Error('--out is required for append-only TasteBench output');
  const rules = await loadTasteRules(options.rulesPath);
  const before = options.beforePath ? await loadTasteArtifact(options.beforePath, 'before') : null;
  const after = options.afterPath ? await loadTasteArtifact(options.afterPath, 'after') : null;
  const judge = options.judgePath ? await loadTasteJudge(options.judgePath, rules) : null;
  const report = evaluateTastePair({ rules, before, after, judge, caseId: options.caseId });
  const appendResult = await appendTasteReport(options.outputPath, report);
  process.stdout.write(`${JSON.stringify({ report, append: appendResult }, null, 2)}\n`);
  process.exitCode = report.status === STATUS.PASS ? 0 : report.status === STATUS.FAIL ? 1 : 2;
}

function parseCliArguments(argv) {
  const options = {
    beforePath: null,
    afterPath: null,
    judgePath: null,
    outputPath: null,
    rulesPath: DEFAULT_TASTE_RULES_PATH,
    caseId: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--before') options.beforePath = requiredPath(argument, value);
    else if (argument === '--after') options.afterPath = requiredPath(argument, value);
    else if (argument === '--judge') options.judgePath = requiredPath(argument, value);
    else if (argument === '--out') options.outputPath = requiredPath(argument, value);
    else if (argument === '--rules') options.rulesPath = requiredPath(argument, value);
    else if (argument === '--case') {
      if (!value || !CASE_ID_PATTERN.test(value)) throw new Error('--case requires a case ID');
      options.caseId = value;
    } else throw new Error(`Unknown argument ${argument}`);
    index += 1;
  }
  return options;
}

function requiredPath(argument, value) {
  if (!value) throw new Error(`${argument} requires a path`);
  return path.resolve(value);
}

function invalidInput({ kind, caseId = null, manifestName, manifestDigest, errors }) {
  return { ok: false, kind, caseId, manifestName, manifestDigest, errors };
}

function makeCheck(id, status, message, evidenceRefs) {
  return { id, status, message, evidenceRefs };
}

function manifestReference(input, pointer) {
  return {
    artifactId: input.ok ? input.manifest.artifactId : null,
    evidenceId: 'manifest',
    kind: `${input.kind}_manifest`,
    path: input.manifestName,
    sha256: input.manifestDigest,
    pointer,
  };
}

function pixelReference(input, pixel) {
  return {
    artifactId: input.manifest.artifactId,
    evidenceId: pixel.id,
    kind: `${input.kind}_pixels`,
    path: pixel.path,
    sha256: pixel.sha256,
    pointer: '',
  };
}

function judgeReference(input, pointer) {
  return {
    artifactId: input.judge.judgmentId,
    evidenceId: 'judge-manifest',
    kind: 'independent_visual_judgment',
    path: input.manifestName,
    sha256: input.manifestDigest,
    pointer,
  };
}

function statusCounts(statuses) {
  return {
    pass: statuses.filter((status) => status === STATUS.PASS).length,
    fail: statuses.filter((status) => status === STATUS.FAIL).length,
    unscored: statuses.filter((status) => status === STATUS.UNSCORED).length,
  };
}

function validateProducer(producer, label, errors) {
  if (!isRecord(producer)) {
    errors.push(`${label} must be an object`);
    return;
  }
  rejectUnknownKeys(producer, new Set(['name', 'version']), label, errors);
  if (!nonemptyString(producer.name)) errors.push(`${label}.name must be nonempty`);
  if (!nonemptyString(producer.version)) errors.push(`${label}.version must be nonempty`);
}

function validImageSignature(bytes, mediaType) {
  if (mediaType === 'image/png') {
    return (
      bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    );
  }
  if (mediaType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mediaType === 'image/webp') {
    return (
      bytes.length >= 12 &&
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}

function resolveContainedPath(baseDirectory, relativePath) {
  if (path.isAbsolute(relativePath)) throw new Error('absolute paths are not allowed');
  const resolved = path.resolve(baseDirectory, relativePath);
  const relative = path.relative(baseDirectory, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('path escapes the manifest directory');
  }
  return resolved;
}

function normalizeRelativePath(value) {
  return value.split(path.sep).join('/');
}

function rejectUnknownKeys(value, allowed, label, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${label} has unknown key ${key}`);
  }
}

function roundMetric(value) {
  return Math.round(value * 10000) / 10000;
}

function deepEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function nonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validIsoDate(value) {
  return (
    typeof value === 'string' &&
    /(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 2;
  });
}
