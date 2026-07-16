import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const UXBENCH_VERSION = '1.0.0';
export const UXBENCH_REPORT_SCHEMA = 'nodeslide-uxbench-report/v1';
export const FIXTURE_SCHEMA = 'nodeslide-agent-fixture/v1';
export const RUN_MANIFEST_SCHEMA = 'nodeslide-ux-run-manifest/v1';
export const RUN_RECORD_SCHEMA = 'nodeslide-ux-run-record/v1';
export const STATUS = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', UNSCORED: 'UNSCORED' });

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CORPUS_DIRECTORY = path.resolve(
  scriptDirectory,
  '..',
  'qa',
  'nodeslide-agent-corpus',
);
export const DEFAULT_REGISTRY_PATH = path.join(DEFAULT_CORPUS_DIRECTORY, 'registry.json');
export const DEFAULT_FIXTURES_DIRECTORY = path.join(DEFAULT_CORPUS_DIRECTORY, 'fixtures');
export const DEFAULT_SUPPLEMENTAL_FIXTURES_DIRECTORY = path.join(
  DEFAULT_CORPUS_DIRECTORY,
  'live-fixtures',
);

const FIXTURE_OPERATORS = new Set([
  'equals',
  'not_equals',
  'length_equals',
  'contains',
  'contains_all',
  'set_equals',
  'all_nonempty',
  'all_unique',
  'unchanged',
  'changed',
  'truthy',
  'falsy',
  'greater_than_or_equal',
  'less_than_or_equal',
]);
const OPERATORS_WITHOUT_EXPECTED = new Set([
  'all_nonempty',
  'all_unique',
  'unchanged',
  'changed',
  'truthy',
  'falsy',
]);
const APPROVAL_MODES = new Set(['review_required', 'autonomous']);
const ENVIRONMENT_MODES = new Set(['local', 'preview', 'production']);
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SOURCE_REVISION_PATTERN = /^[0-9a-f]{40,64}$/;
const CASE_ID_PATTERN = /^[A-Z][0-9]{2}$/;
const ASSERTION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOP_LEVEL_FIXTURE_KEYS = new Set([
  '$schema',
  'schemaVersion',
  'id',
  'title',
  'category',
  'minimumRelease',
  'setup',
  'request',
  'expected',
  'trace',
  'forbidden',
  'assertions',
]);

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError('Cannot serialize undefined values.');
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(',')}}`;
}

export function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function digestValue(value) {
  return sha256(stableStringify(value));
}

export function fixtureDigest(fixture) {
  return digestValue(fixture);
}

export async function loadRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  const errors = validateRegistry(registry);
  if (errors.length > 0) {
    throw new Error(`Invalid NodeSlide corpus registry:\n- ${errors.join('\n- ')}`);
  }
  return registry;
}

export function validateRegistry(registry) {
  const errors = [];
  if (!isRecord(registry)) return ['registry must be an object'];
  if (registry.schemaVersion !== 'nodeslide-agent-corpus-registry/v1') {
    errors.push('schemaVersion must be nodeslide-agent-corpus-registry/v1');
  }
  if (!Array.isArray(registry.cases)) errors.push('cases must be an array');
  if (!Array.isArray(registry.categories)) errors.push('categories must be an array');
  if (!Array.isArray(registry.minimumReleaseCaseIds)) {
    errors.push('minimumReleaseCaseIds must be an array');
  }
  if (Array.isArray(registry.cases)) {
    const ids = new Set();
    for (const [index, entry] of registry.cases.entries()) {
      if (!isRecord(entry)) {
        errors.push(`cases[${index}] must be an object`);
        continue;
      }
      if (!CASE_ID_PATTERN.test(entry.id ?? '')) errors.push(`cases[${index}].id is invalid`);
      if (ids.has(entry.id)) errors.push(`duplicate case ID ${entry.id}`);
      ids.add(entry.id);
      if (!nonemptyString(entry.category)) errors.push(`${entry.id}.category must be nonempty`);
      if (!nonemptyString(entry.request)) errors.push(`${entry.id}.request must be nonempty`);
    }
    if (registry.caseCount !== registry.cases.length) {
      errors.push(`caseCount ${registry.caseCount} does not match ${registry.cases.length} cases`);
    }
    for (const id of registry.minimumReleaseCaseIds ?? []) {
      if (!ids.has(id)) errors.push(`minimum release case ${id} is absent from cases`);
    }
  }
  if (!isRecord(registry.source) || !/^[0-9a-f]{64}$/.test(registry.source.sha256 ?? '')) {
    errors.push('source.sha256 must be a 64-character lowercase digest');
  }
  return errors;
}

export async function loadFixtures({
  fixturesDirectory = DEFAULT_FIXTURES_DIRECTORY,
  registry,
} = {}) {
  const activeRegistry = registry ?? (await loadRegistry());
  const names = (await readdir(fixturesDirectory)).filter((name) => name.endsWith('.json')).sort();
  const fixtures = [];
  const errors = [];
  const registryById = new Map(activeRegistry.cases.map((entry) => [entry.id, entry]));

  for (const name of names) {
    try {
      const fixture = JSON.parse(await readFile(path.join(fixturesDirectory, name), 'utf8'));
      const fixtureErrors = validateFixture(fixture, registryById.get(fixture.id) ?? null);
      if (fixtureErrors.length > 0) {
        errors.push(`${name}: ${fixtureErrors.join('; ')}`);
      } else {
        fixtures.push(fixture);
      }
    } catch (error) {
      errors.push(`${name}: ${errorMessage(error)}`);
    }
  }

  const fixtureIds = fixtures.map(({ id }) => id);
  const duplicateIds = duplicates(fixtureIds);
  if (duplicateIds.length > 0) errors.push(`duplicate fixture IDs: ${duplicateIds.join(', ')}`);
  const expectedIds = [...activeRegistry.minimumReleaseCaseIds].sort();
  const actualIds = [...new Set(fixtureIds)].sort();
  if (!deepEqual(actualIds, expectedIds)) {
    errors.push(
      `fixture IDs must exactly cover the minimum release suite; expected ${expectedIds.join(', ')}, got ${actualIds.join(', ')}`,
    );
  }
  if (errors.length > 0) {
    throw new Error(`Invalid NodeSlide fixtures:\n- ${errors.join('\n- ')}`);
  }
  return fixtures.sort(
    (left, right) =>
      activeRegistry.minimumReleaseCaseIds.indexOf(left.id) -
      activeRegistry.minimumReleaseCaseIds.indexOf(right.id),
  );
}

/**
 * Load non-P0 fixtures used by scheduled/live evidence lanes without changing
 * the fixed 20-case minimum-release comparability contract.
 */
export async function loadSupplementalFixtures({
  fixturesDirectory = DEFAULT_SUPPLEMENTAL_FIXTURES_DIRECTORY,
  registry,
} = {}) {
  const activeRegistry = registry ?? (await loadRegistry());
  const names = (await readdir(fixturesDirectory)).filter((name) => name.endsWith('.json')).sort();
  const fixtures = [];
  const errors = [];
  const registryById = new Map(activeRegistry.cases.map((entry) => [entry.id, entry]));
  const minimumReleaseIds = new Set(activeRegistry.minimumReleaseCaseIds);

  for (const name of names) {
    try {
      const fixture = JSON.parse(await readFile(path.join(fixturesDirectory, name), 'utf8'));
      const fixtureErrors = validateFixture(fixture, registryById.get(fixture.id) ?? null, {
        minimumRelease: false,
      });
      if (minimumReleaseIds.has(fixture.id)) {
        fixtureErrors.push('supplemental fixture duplicates a minimum-release case');
      }
      if (fixtureErrors.length > 0) {
        errors.push(`${name}: ${fixtureErrors.join('; ')}`);
      } else {
        fixtures.push(fixture);
      }
    } catch (error) {
      errors.push(`${name}: ${errorMessage(error)}`);
    }
  }

  const duplicateIds = duplicates(fixtures.map(({ id }) => id));
  if (duplicateIds.length > 0)
    errors.push(`duplicate supplemental fixture IDs: ${duplicateIds.join(', ')}`);
  if (errors.length > 0) {
    throw new Error(`Invalid supplemental NodeSlide fixtures:\n- ${errors.join('\n- ')}`);
  }
  return fixtures.sort((left, right) => left.id.localeCompare(right.id));
}

export function validateFixture(fixture, registryCase, { minimumRelease = true } = {}) {
  const errors = [];
  if (!isRecord(fixture)) return ['fixture must be an object'];
  rejectUnknownKeys(fixture, TOP_LEVEL_FIXTURE_KEYS, 'fixture', errors);
  if (fixture.schemaVersion !== FIXTURE_SCHEMA) {
    errors.push(`schemaVersion must be ${FIXTURE_SCHEMA}`);
  }
  if (!CASE_ID_PATTERN.test(fixture.id ?? '')) errors.push('id must match ^[A-Z][0-9]{2}$');
  if (!nonemptyString(fixture.title)) errors.push('title must be nonempty');
  if (!nonemptyString(fixture.category)) errors.push('category must be nonempty');
  if (fixture.minimumRelease !== minimumRelease) {
    errors.push(`minimumRelease must be ${minimumRelease}`);
  }
  if (registryCase) {
    if (fixture.request?.text !== registryCase.request) {
      errors.push('request.text must exactly match the registry request');
    }
    if (fixture.category !== registryCase.category) {
      errors.push('category must exactly match the registry category');
    }
  } else if (registryCase === null) {
    errors.push(`fixture ${fixture.id ?? '<unknown>'} has no matching registry case`);
  }

  validateSetup(fixture.setup, errors);
  validateRequest(fixture.request, fixture.setup, errors);
  validateExpected(fixture.expected, fixture.setup, errors);
  validateTrace(fixture.trace, errors);
  validateStringArray(fixture.forbidden, 'forbidden', errors, { minimum: 1 });
  validateAssertions(fixture.assertions, errors);
  return errors;
}

function validateSetup(setup, errors) {
  if (!isRecord(setup)) {
    errors.push('setup must be an object');
    return;
  }
  rejectUnknownKeys(
    setup,
    new Set([
      'deckFixture',
      'activeSlideId',
      'selectedSlideIds',
      'selectedElementIds',
      'approvalMode',
      'autonomyGrant',
      'context',
    ]),
    'setup',
    errors,
  );
  if (!nonemptyString(setup.deckFixture)) errors.push('setup.deckFixture must be nonempty');
  if (!(setup.activeSlideId === null || nonemptyString(setup.activeSlideId))) {
    errors.push('setup.activeSlideId must be null or a nonempty string');
  }
  validateStringArray(setup.selectedSlideIds, 'setup.selectedSlideIds', errors);
  validateStringArray(setup.selectedElementIds, 'setup.selectedElementIds', errors);
  if (!APPROVAL_MODES.has(setup.approvalMode)) errors.push('setup.approvalMode is invalid');
  if (!(setup.autonomyGrant === null || isRecord(setup.autonomyGrant))) {
    errors.push('setup.autonomyGrant must be null or an object');
  }
  if (setup.approvalMode === 'autonomous' && !isRecord(setup.autonomyGrant)) {
    errors.push('autonomous fixtures require setup.autonomyGrant');
  }
  if (setup.approvalMode === 'review_required' && setup.autonomyGrant !== null) {
    errors.push('review_required fixtures must have a null autonomyGrant');
  }
  const context = setup.context;
  if (!isRecord(context)) {
    errors.push('setup.context must be an object');
    return;
  }
  rejectUnknownKeys(
    context,
    new Set(['description', 'attachments', 'web', 'canonicalBefore']),
    'setup.context',
    errors,
  );
  for (const key of ['description', 'attachments', 'web', 'canonicalBefore']) {
    if (!(key in context)) errors.push(`setup.context.${key} is required`);
  }
  if (!nonemptyString(context.description))
    errors.push('setup.context.description must be nonempty');
  if (!Array.isArray(context.attachments))
    errors.push('setup.context.attachments must be an array');
  if (!isRecord(context.web)) {
    errors.push('setup.context.web must be an object');
  } else {
    rejectUnknownKeys(
      context.web,
      new Set(['allowed', 'authorizedOrigins']),
      'setup.context.web',
      errors,
    );
    if (typeof context.web.allowed !== 'boolean')
      errors.push('setup.context.web.allowed must be boolean');
    validateStringArray(
      context.web.authorizedOrigins,
      'setup.context.web.authorizedOrigins',
      errors,
    );
  }
  if (!isRecord(context.canonicalBefore)) {
    errors.push('setup.context.canonicalBefore must be an object');
  }
}

function validateRequest(request, setup, errors) {
  if (!isRecord(request)) {
    errors.push('request must be an object');
    return;
  }
  rejectUnknownKeys(request, new Set(['text', 'attachmentIds', 'webResearch']), 'request', errors);
  if (!nonemptyString(request.text)) errors.push('request.text must be nonempty');
  validateStringArray(request.attachmentIds, 'request.attachmentIds', errors);
  if (typeof request.webResearch !== 'boolean') errors.push('request.webResearch must be boolean');
  const availableAttachments = new Set(
    (setup?.context?.attachments ?? []).map((attachment) => attachment.id),
  );
  for (const id of request.attachmentIds ?? []) {
    if (!availableAttachments.has(id)) errors.push(`request attachment ${id} is absent from setup`);
  }
  if (request.webResearch === true && setup?.context?.web?.allowed !== true) {
    errors.push('request.webResearch requires setup.context.web.allowed');
  }
}

function validateExpected(expected, setup, errors) {
  if (!isRecord(expected)) {
    errors.push('expected must be an object');
    return;
  }
  rejectUnknownKeys(
    expected,
    new Set(['primitives', 'operations', 'authority', 'outcomes']),
    'expected',
    errors,
  );
  validateStringArray(expected.primitives, 'expected.primitives', errors, { minimum: 1 });
  validateOperations(expected.operations, errors);
  const authority = expected.authority;
  if (!isRecord(authority)) {
    errors.push('expected.authority must be an object');
  } else {
    rejectUnknownKeys(
      authority,
      new Set([
        'mode',
        'proposalRequired',
        'canonicalMutationBeforeReview',
        'requiredEvents',
        'forbiddenEvents',
        'boundaryBehavior',
      ]),
      'expected.authority',
      errors,
    );
    if (!APPROVAL_MODES.has(authority.mode)) errors.push('expected.authority.mode is invalid');
    if (authority.mode !== setup?.approvalMode) {
      errors.push('expected.authority.mode must match setup.approvalMode');
    }
    if (typeof authority.proposalRequired !== 'boolean') {
      errors.push('expected.authority.proposalRequired must be boolean');
    }
    if (typeof authority.canonicalMutationBeforeReview !== 'boolean') {
      errors.push('expected.authority.canonicalMutationBeforeReview must be boolean');
    }
    validateStringArray(authority.requiredEvents, 'expected.authority.requiredEvents', errors, {
      minimum: 1,
    });
    validateStringArray(authority.forbiddenEvents, 'expected.authority.forbiddenEvents', errors);
    if (!nonemptyString(authority.boundaryBehavior)) {
      errors.push('expected.authority.boundaryBehavior must be nonempty');
    }
  }
  validateStringArray(expected.outcomes, 'expected.outcomes', errors, { minimum: 1 });
}

function validateOperations(operations, errors) {
  if (!isRecord(operations)) {
    errors.push('expected.operations must be an object');
    return;
  }
  rejectUnknownKeys(
    operations,
    new Set(['required', 'allowed', 'denied']),
    'expected.operations',
    errors,
  );
  if (!Array.isArray(operations.required)) {
    errors.push('expected.operations.required must be an array');
  } else {
    for (const [index, requirement] of operations.required.entries()) {
      if (!isRecord(requirement)) {
        errors.push(`expected.operations.required[${index}] must be an object`);
        continue;
      }
      rejectUnknownKeys(
        requirement,
        new Set(['type', 'minCount', 'maxCount', 'scope']),
        `expected.operations.required[${index}]`,
        errors,
      );
      if (!nonemptyString(requirement.type)) {
        errors.push(`expected.operations.required[${index}].type must be nonempty`);
      }
      if (!nonnegativeInteger(requirement.minCount)) {
        errors.push(`expected.operations.required[${index}].minCount must be nonnegative`);
      }
      if (!nonnegativeInteger(requirement.maxCount)) {
        errors.push(`expected.operations.required[${index}].maxCount must be nonnegative`);
      }
      if (requirement.maxCount < requirement.minCount) {
        errors.push(`expected.operations.required[${index}] has maxCount below minCount`);
      }
      if (!nonemptyString(requirement.scope)) {
        errors.push(`expected.operations.required[${index}].scope must be nonempty`);
      }
    }
  }
  validateStringArray(operations.allowed, 'expected.operations.allowed', errors);
  validateStringArray(operations.denied, 'expected.operations.denied', errors);
  const allowed = new Set(operations.allowed ?? []);
  const denied = new Set(operations.denied ?? []);
  for (const requirement of operations.required ?? []) {
    if (!allowed.has(requirement.type)) {
      errors.push(`required operation ${requirement.type} is absent from allowed operations`);
    }
  }
  for (const operation of allowed) {
    if (denied.has(operation)) errors.push(`operation ${operation} is both allowed and denied`);
  }
}

function validateTrace(trace, errors) {
  if (!isRecord(trace)) {
    errors.push('trace must be an object');
    return;
  }
  rejectUnknownKeys(trace, new Set(['ordered', 'mustInclude']), 'trace', errors);
  if (trace.ordered !== true) errors.push('trace.ordered must be true');
  validateStringArray(trace.mustInclude, 'trace.mustInclude', errors, { minimum: 1 });
}

function validateAssertions(assertions, errors) {
  if (!Array.isArray(assertions) || assertions.length === 0) {
    errors.push('assertions must be a nonempty array');
    return;
  }
  const ids = new Set();
  for (const [index, assertion] of assertions.entries()) {
    const prefix = `assertions[${index}]`;
    if (!isRecord(assertion)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    rejectUnknownKeys(
      assertion,
      new Set(['id', 'description', 'actual', 'operator', 'expected']),
      prefix,
      errors,
    );
    if (!ASSERTION_ID_PATTERN.test(assertion.id ?? '')) errors.push(`${prefix}.id is invalid`);
    if (ids.has(assertion.id)) errors.push(`duplicate assertion ID ${assertion.id}`);
    ids.add(assertion.id);
    if (!nonemptyString(assertion.description))
      errors.push(`${prefix}.description must be nonempty`);
    if (!FIXTURE_OPERATORS.has(assertion.operator)) errors.push(`${prefix}.operator is invalid`);
    const actual = assertion.actual;
    if (!isRecord(actual)) {
      errors.push(`${prefix}.actual must be an object`);
      continue;
    }
    rejectUnknownKeys(
      actual,
      new Set(['evidenceKind', 'pointer', 'comparePointer', 'itemPointer']),
      `${prefix}.actual`,
      errors,
    );
    if (actual.evidenceKind !== 'run_record') {
      errors.push(`${prefix}.actual.evidenceKind must be run_record`);
    }
    if (!validJsonPointer(actual.pointer)) errors.push(`${prefix}.actual.pointer is invalid`);
    if (actual.comparePointer !== undefined && !validJsonPointer(actual.comparePointer)) {
      errors.push(`${prefix}.actual.comparePointer is invalid`);
    }
    if (actual.itemPointer !== undefined && !validJsonPointer(actual.itemPointer)) {
      errors.push(`${prefix}.actual.itemPointer is invalid`);
    }
    if (['unchanged', 'changed'].includes(assertion.operator) && !actual.comparePointer) {
      errors.push(`${prefix} requires actual.comparePointer`);
    }
    if (!OPERATORS_WITHOUT_EXPECTED.has(assertion.operator) && !('expected' in assertion)) {
      errors.push(`${prefix} requires expected`);
    }
  }
}

export async function loadUxArtifact(manifestPath) {
  const manifestName = path.basename(manifestPath);
  let bytes;
  let manifest;
  try {
    bytes = await readFile(manifestPath);
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    return {
      ok: false,
      caseId: null,
      manifestName,
      manifestDigest: bytes ? sha256(bytes) : null,
      errors: [`cannot read manifest: ${errorMessage(error)}`],
    };
  }
  const manifestDigest = sha256(bytes);
  const manifestErrors = validateRunManifest(manifest);
  const caseId = CASE_ID_PATTERN.test(manifest.caseId ?? '') ? manifest.caseId : null;
  if (manifestErrors.length > 0) {
    return { ok: false, caseId, manifestName, manifestDigest, errors: manifestErrors };
  }

  const evidence = manifest.evidence[0];
  let evidencePath;
  try {
    evidencePath = resolveContainedPath(path.dirname(manifestPath), evidence.path);
  } catch (error) {
    return {
      ok: false,
      caseId,
      manifestName,
      manifestDigest,
      errors: [`evidence path rejected: ${errorMessage(error)}`],
    };
  }
  let evidenceBytes;
  let record;
  try {
    evidenceBytes = await readFile(evidencePath);
    if (sha256(evidenceBytes) !== evidence.sha256) throw new Error('sha256 mismatch');
    if (evidenceBytes.byteLength !== evidence.byteLength) throw new Error('byteLength mismatch');
    record = JSON.parse(evidenceBytes.toString('utf8'));
  } catch (error) {
    return {
      ok: false,
      caseId,
      manifestName,
      manifestDigest,
      errors: [`run_record evidence rejected: ${errorMessage(error)}`],
    };
  }
  const recordErrors = validateRunRecord(record);
  if (record.runId !== manifest.runId)
    recordErrors.push('run_record runId does not match manifest');
  if (record.caseId !== manifest.caseId)
    recordErrors.push('run_record caseId does not match manifest');
  if (recordErrors.length > 0) {
    return {
      ok: false,
      caseId,
      manifestName,
      manifestDigest,
      errors: recordErrors,
    };
  }
  return {
    ok: true,
    caseId,
    manifest,
    manifestName,
    manifestDigest,
    record,
    evidence,
  };
}

export function validateRunManifest(manifest) {
  const errors = [];
  if (!isRecord(manifest)) return ['manifest must be an object'];
  rejectUnknownKeys(
    manifest,
    new Set([
      'schemaVersion',
      'artifactId',
      'runId',
      'caseId',
      'fixtureDigest',
      'provenance',
      'evidence',
    ]),
    'manifest',
    errors,
  );
  if (manifest.schemaVersion !== RUN_MANIFEST_SCHEMA) {
    errors.push(`schemaVersion must be ${RUN_MANIFEST_SCHEMA}`);
  }
  if (!nonemptyString(manifest.artifactId)) errors.push('artifactId must be nonempty');
  if (!nonemptyString(manifest.runId)) errors.push('runId must be nonempty');
  if (!CASE_ID_PATTERN.test(manifest.caseId ?? '')) errors.push('caseId is invalid');
  if (!SHA256_PATTERN.test(manifest.fixtureDigest ?? '')) errors.push('fixtureDigest is invalid');
  validateRunProvenance(manifest.provenance, errors);
  if (!Array.isArray(manifest.evidence) || manifest.evidence.length !== 1) {
    errors.push('evidence must contain exactly one run_record');
  } else {
    const item = manifest.evidence[0];
    if (!isRecord(item)) {
      errors.push('evidence[0] must be an object');
    } else {
      rejectUnknownKeys(
        item,
        new Set(['id', 'kind', 'path', 'sha256', 'byteLength', 'mediaType']),
        'evidence[0]',
        errors,
      );
      if (!nonemptyString(item.id)) errors.push('evidence[0].id must be nonempty');
      if (item.kind !== 'run_record') errors.push('evidence[0].kind must be run_record');
      if (!nonemptyString(item.path)) errors.push('evidence[0].path must be nonempty');
      if (!SHA256_PATTERN.test(item.sha256 ?? '')) errors.push('evidence[0].sha256 is invalid');
      if (!Number.isInteger(item.byteLength) || item.byteLength < 1) {
        errors.push('evidence[0].byteLength must be a positive integer');
      }
      if (item.mediaType !== 'application/json') {
        errors.push('evidence[0].mediaType must be application/json');
      }
    }
  }
  return errors;
}

function validateRunProvenance(provenance, errors) {
  if (!isRecord(provenance)) {
    errors.push('provenance must be an object');
    return;
  }
  rejectUnknownKeys(
    provenance,
    new Set(['capturedAt', 'recorder', 'sourceRevision', 'environment']),
    'provenance',
    errors,
  );
  if (!validIsoDate(provenance.capturedAt)) errors.push('provenance.capturedAt is invalid');
  validateProducer(provenance.recorder, 'provenance.recorder', errors);
  if (!SOURCE_REVISION_PATTERN.test(provenance.sourceRevision ?? '')) {
    errors.push('provenance.sourceRevision is invalid');
  }
  if (!isRecord(provenance.environment)) {
    errors.push('provenance.environment must be an object');
  } else {
    rejectUnknownKeys(
      provenance.environment,
      new Set(['name', 'mode']),
      'provenance.environment',
      errors,
    );
    if (!nonemptyString(provenance.environment.name)) {
      errors.push('provenance.environment.name must be nonempty');
    }
    if (!ENVIRONMENT_MODES.has(provenance.environment.mode)) {
      errors.push('provenance.environment.mode is invalid');
    }
  }
}

export function validateRunRecord(record) {
  const errors = [];
  if (!isRecord(record)) return ['run_record must be an object'];
  rejectUnknownKeys(
    record,
    new Set([
      'schemaVersion',
      'runId',
      'caseId',
      'request',
      'operations',
      'authority',
      'trace',
      'forbiddenBehaviorsObserved',
      'result',
    ]),
    'run_record',
    errors,
  );
  if (record.schemaVersion !== RUN_RECORD_SCHEMA) {
    errors.push(`run_record schemaVersion must be ${RUN_RECORD_SCHEMA}`);
  }
  if (!nonemptyString(record.runId)) errors.push('run_record runId must be nonempty');
  if (!CASE_ID_PATTERN.test(record.caseId ?? '')) errors.push('run_record caseId is invalid');
  if (!isRecord(record.request)) {
    errors.push('run_record request must be an object');
  } else {
    rejectUnknownKeys(
      record.request,
      new Set(['text', 'attachmentIds', 'webResearch']),
      'run_record request',
      errors,
    );
    if (!nonemptyString(record.request.text))
      errors.push('run_record request.text must be nonempty');
    validateStringArray(record.request.attachmentIds, 'run_record request.attachmentIds', errors);
    if (typeof record.request.webResearch !== 'boolean') {
      errors.push('run_record request.webResearch must be boolean');
    }
  }
  if (!Array.isArray(record.operations)) {
    errors.push('run_record operations must be an array');
  } else {
    const operationIds = new Set();
    for (const [index, operation] of record.operations.entries()) {
      if (!isRecord(operation)) {
        errors.push(`run_record operations[${index}] must be an object`);
        continue;
      }
      rejectUnknownKeys(
        operation,
        new Set(['id', 'type', 'scope', 'targets', 'status']),
        `operations[${index}]`,
        errors,
      );
      if (!nonemptyString(operation.id)) errors.push(`operations[${index}].id must be nonempty`);
      if (operationIds.has(operation.id)) errors.push(`duplicate operation ID ${operation.id}`);
      operationIds.add(operation.id);
      if (!nonemptyString(operation.type))
        errors.push(`operations[${index}].type must be nonempty`);
      if (!nonemptyString(operation.scope))
        errors.push(`operations[${index}].scope must be nonempty`);
      validateStringArray(operation.targets, `operations[${index}].targets`, errors);
    }
  }
  if (!isRecord(record.authority)) {
    errors.push('run_record authority must be an object');
  } else {
    rejectUnknownKeys(
      record.authority,
      new Set(['mode', 'proposalRequired', 'canonicalMutationBeforeReview', 'events']),
      'authority',
      errors,
    );
    if (!APPROVAL_MODES.has(record.authority.mode)) errors.push('authority.mode is invalid');
    if (typeof record.authority.proposalRequired !== 'boolean') {
      errors.push('authority.proposalRequired must be boolean');
    }
    if (typeof record.authority.canonicalMutationBeforeReview !== 'boolean') {
      errors.push('authority.canonicalMutationBeforeReview must be boolean');
    }
    validateStringArray(record.authority.events, 'authority.events', errors);
  }
  if (!Array.isArray(record.trace)) {
    errors.push('run_record trace must be an array');
  } else {
    let previous = -1;
    for (const [index, entry] of record.trace.entries()) {
      if (!isRecord(entry) || !Number.isInteger(entry.sequence) || !nonemptyString(entry.stage)) {
        errors.push(`trace[${index}] must have integer sequence and nonempty stage`);
        continue;
      }
      rejectUnknownKeys(entry, new Set(['sequence', 'stage']), `trace[${index}]`, errors);
      if (entry.sequence <= previous) errors.push('trace sequence must be strictly increasing');
      previous = entry.sequence;
    }
  }
  validateStringArray(
    record.forbiddenBehaviorsObserved,
    'run_record forbiddenBehaviorsObserved',
    errors,
  );
  if (!isRecord(record.result)) errors.push('run_record result must be an object');
  return errors;
}

export function evaluateFixture(fixture, artifact) {
  const digest = fixtureDigest(fixture);
  if (!artifact) {
    return finalizeCase(fixture, digest, null, [
      makeCheck(
        'artifact-supplied',
        STATUS.UNSCORED,
        'No run artifact was supplied for this fixture.',
        [],
      ),
    ]);
  }
  if (Array.isArray(artifact)) {
    return finalizeCase(fixture, digest, null, [
      makeCheck(
        'artifact-unique',
        STATUS.UNSCORED,
        `Multiple run artifacts were supplied for ${fixture.id}; the evidence is ambiguous.`,
        [],
      ),
    ]);
  }
  if (!artifact.ok) {
    return finalizeCase(fixture, digest, artifact, [
      makeCheck(
        'artifact-provenance',
        STATUS.UNSCORED,
        `Run artifact rejected: ${artifact.errors.join('; ')}`,
        artifact.manifestDigest
          ? [
              {
                artifactId: null,
                evidenceId: 'manifest',
                kind: 'manifest',
                path: artifact.manifestName,
                sha256: artifact.manifestDigest,
                pointer: '',
              },
            ]
          : [],
      ),
    ]);
  }

  const checks = [];
  const manifestReference = manifestEvidenceReference(artifact, '/provenance');
  const recordReference = (pointer) => runRecordEvidenceReference(artifact, pointer);
  checks.push(
    makeCheck(
      'artifact-provenance',
      STATUS.PASS,
      'Manifest provenance and the run-record digest were verified.',
      [manifestReference, recordReference('')],
    ),
  );
  if (artifact.manifest.fixtureDigest !== digest) {
    checks.push(
      makeCheck(
        'fixture-binding',
        STATUS.UNSCORED,
        'The supplied artifact was recorded against a different fixture digest.',
        [manifestEvidenceReference(artifact, '/fixtureDigest')],
      ),
    );
    return finalizeCase(fixture, digest, artifact, checks);
  }
  checks.push(
    makeCheck(
      'fixture-binding',
      STATUS.PASS,
      'The run artifact is bound to the exact canonical fixture digest.',
      [manifestEvidenceReference(artifact, '/fixtureDigest')],
    ),
  );

  const record = artifact.record;
  checks.push(
    comparisonCheck({
      id: 'exact-request',
      pass: deepEqual(record.request, fixture.request),
      message: 'The captured request exactly matches text, attachments, and web-research intent.',
      failure: 'The captured request differs from the canonical fixture request.',
      refs: [recordReference('/request')],
    }),
  );
  checks.push(...evaluateOperations(fixture, record, recordReference));
  checks.push(...evaluateAuthority(fixture, record, recordReference));
  checks.push(...evaluateTrace(fixture, record, recordReference));
  checks.push(
    comparisonCheck({
      id: 'forbidden-behavior',
      pass: record.forbiddenBehaviorsObserved.length === 0,
      message: 'The run record reports no forbidden behavior.',
      failure: `Forbidden behavior was observed: ${record.forbiddenBehaviorsObserved.join(', ')}`,
      refs: [recordReference('/forbiddenBehaviorsObserved')],
    }),
  );
  for (const assertion of fixture.assertions) {
    checks.push(evaluateAssertion(assertion, record, recordReference));
  }
  return finalizeCase(fixture, digest, artifact, checks);
}

function evaluateOperations(fixture, record, reference) {
  const checks = [];
  const operations = record.operations;
  for (const requirement of fixture.expected.operations.required) {
    const matches = operations.filter(
      (operation) => operation.type === requirement.type && operation.scope === requirement.scope,
    );
    const pass = matches.length >= requirement.minCount && matches.length <= requirement.maxCount;
    checks.push(
      comparisonCheck({
        id: `operation-${requirement.type}-${requirement.scope}`,
        pass,
        message: `${requirement.type} count ${matches.length} is within ${requirement.minCount}-${requirement.maxCount} for ${requirement.scope}.`,
        failure: `${requirement.type} count ${matches.length} is outside ${requirement.minCount}-${requirement.maxCount} for ${requirement.scope}.`,
        refs: [reference('/operations')],
      }),
    );
  }
  const allowed = new Set(fixture.expected.operations.allowed);
  const unexpected = operations.map(({ type }) => type).filter((type) => !allowed.has(type));
  checks.push(
    comparisonCheck({
      id: 'operations-allowed',
      pass: unexpected.length === 0,
      message: 'Every recorded operation is allowed by the fixture.',
      failure: `Unallowed operations were recorded: ${[...new Set(unexpected)].join(', ')}`,
      refs: [reference('/operations')],
    }),
  );
  const denied = new Set(fixture.expected.operations.denied);
  const observedDenied = operations.map(({ type }) => type).filter((type) => denied.has(type));
  checks.push(
    comparisonCheck({
      id: 'operations-denied',
      pass: observedDenied.length === 0,
      message: 'No denied operation was recorded.',
      failure: `Denied operations were recorded: ${[...new Set(observedDenied)].join(', ')}`,
      refs: [reference('/operations')],
    }),
  );
  return checks;
}

function evaluateAuthority(fixture, record, reference) {
  const expected = fixture.expected.authority;
  const actual = record.authority;
  const checks = [
    comparisonCheck({
      id: 'authority-mode',
      pass: actual.mode === expected.mode,
      message: `Authority mode is ${expected.mode}.`,
      failure: `Authority mode ${actual.mode} does not match ${expected.mode}.`,
      refs: [reference('/authority/mode')],
    }),
    comparisonCheck({
      id: 'proposal-boundary',
      pass: actual.proposalRequired === expected.proposalRequired,
      message: 'Proposal requirement matches the canonical authority boundary.',
      failure: 'Proposal requirement does not match the canonical authority boundary.',
      refs: [reference('/authority/proposalRequired')],
    }),
    comparisonCheck({
      id: 'canonical-mutation-boundary',
      pass: actual.canonicalMutationBeforeReview === expected.canonicalMutationBeforeReview,
      message: 'Canonical mutation behavior matches the fixture authority rule.',
      failure: 'Canonical mutation behavior violates the fixture authority rule.',
      refs: [reference('/authority/canonicalMutationBeforeReview')],
    }),
  ];
  const missingEvents = expected.requiredEvents.filter((event) => !actual.events.includes(event));
  checks.push(
    comparisonCheck({
      id: 'authority-required-events',
      pass: missingEvents.length === 0,
      message: 'Every required authority event is present.',
      failure: `Required authority events are missing: ${missingEvents.join(', ')}`,
      refs: [reference('/authority/events')],
    }),
  );
  const forbiddenEvents = expected.forbiddenEvents.filter((event) => actual.events.includes(event));
  checks.push(
    comparisonCheck({
      id: 'authority-forbidden-events',
      pass: forbiddenEvents.length === 0,
      message: 'No forbidden authority event is present.',
      failure: `Forbidden authority events are present: ${forbiddenEvents.join(', ')}`,
      refs: [reference('/authority/events')],
    }),
  );
  return checks;
}

function evaluateTrace(fixture, record, reference) {
  const stages = record.trace.map(({ stage }) => stage);
  const pass = orderedSubsequence(stages, fixture.trace.mustInclude);
  return [
    comparisonCheck({
      id: 'required-trace-stages',
      pass,
      message: 'All required trace stages appear in canonical order.',
      failure: 'One or more required trace stages are missing or out of order.',
      refs: [reference('/trace')],
    }),
  ];
}

function evaluateAssertion(assertion, record, reference) {
  const actualResult = resolvePointer(record, assertion.actual.pointer);
  if (!actualResult.found) {
    return makeCheck(
      `assertion-${assertion.id}`,
      STATUS.UNSCORED,
      `${assertion.description} Required evidence pointer ${assertion.actual.pointer} is absent.`,
      [reference(assertion.actual.pointer)],
    );
  }
  let actualValue = actualResult.value;
  if (assertion.actual.itemPointer) {
    if (!Array.isArray(actualValue)) {
      return makeCheck(
        `assertion-${assertion.id}`,
        STATUS.UNSCORED,
        `${assertion.description} itemPointer requires an array value.`,
        [reference(assertion.actual.pointer)],
      );
    }
    const mapped = actualValue.map((item) => resolvePointer(item, assertion.actual.itemPointer));
    if (mapped.some((entry) => !entry.found)) {
      return makeCheck(
        `assertion-${assertion.id}`,
        STATUS.UNSCORED,
        `${assertion.description} An item evidence pointer is absent.`,
        [reference(assertion.actual.pointer)],
      );
    }
    actualValue = mapped.map(({ value }) => value);
  }
  let compareValue;
  if (assertion.actual.comparePointer) {
    const compareResult = resolvePointer(record, assertion.actual.comparePointer);
    if (!compareResult.found) {
      return makeCheck(
        `assertion-${assertion.id}`,
        STATUS.UNSCORED,
        `${assertion.description} Comparison evidence pointer ${assertion.actual.comparePointer} is absent.`,
        [reference(assertion.actual.pointer), reference(assertion.actual.comparePointer)],
      );
    }
    compareValue = compareResult.value;
  }
  const pass = applyOperator(assertion.operator, actualValue, assertion.expected, compareValue);
  const refs = [reference(assertion.actual.pointer)];
  if (assertion.actual.comparePointer) refs.push(reference(assertion.actual.comparePointer));
  return comparisonCheck({
    id: `assertion-${assertion.id}`,
    pass,
    message: assertion.description,
    failure: `Assertion failed: ${assertion.description}`,
    refs,
  });
}

export function applyOperator(operator, actual, expected, comparison) {
  switch (operator) {
    case 'equals':
      return deepEqual(actual, expected);
    case 'not_equals':
      return !deepEqual(actual, expected);
    case 'length_equals':
      return hasLength(actual) && actual.length === expected;
    case 'contains':
      return containsValue(actual, expected);
    case 'contains_all':
      return (
        Array.isArray(actual) &&
        Array.isArray(expected) &&
        expected.every((entry) => actual.some((item) => deepEqual(item, entry)))
      );
    case 'set_equals':
      return setEquals(actual, expected);
    case 'all_nonempty':
      return Array.isArray(actual) && actual.length > 0 && actual.every((entry) => nonempty(entry));
    case 'all_unique':
      return (
        Array.isArray(actual) &&
        new Set(actual.map((entry) => stableStringify(entry))).size === actual.length
      );
    case 'unchanged':
      return deepEqual(actual, comparison);
    case 'changed':
      return !deepEqual(actual, comparison);
    case 'truthy':
      return Boolean(actual);
    case 'falsy':
      return !actual;
    case 'greater_than_or_equal':
      return typeof actual === 'number' && actual >= expected;
    case 'less_than_or_equal':
      return typeof actual === 'number' && actual <= expected;
    default:
      return false;
  }
}

export function resolvePointer(root, pointer) {
  if (pointer === '') return { found: true, value: root };
  if (!validJsonPointer(pointer)) return { found: false, value: undefined };
  let current = root;
  for (const token of pointer.slice(1).split('/').map(decodePointerToken)) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token)) return { found: false, value: undefined };
      const index = Number(token);
      if (index >= current.length) return { found: false, value: undefined };
      current = current[index];
    } else if (isRecord(current) && Object.hasOwn(current, token)) {
      current = current[token];
    } else {
      return { found: false, value: undefined };
    }
  }
  return { found: true, value: current };
}

export function runUxBench({ registry, fixtures, artifacts, selectedCaseIds = [] }) {
  const selected = new Set(selectedCaseIds);
  const activeFixtures =
    selected.size === 0 ? fixtures : fixtures.filter((fixture) => selected.has(fixture.id));
  const knownIds = new Set(fixtures.map(({ id }) => id));
  const inputIssues = [];
  const byCase = new Map();
  for (const artifact of artifacts) {
    if (!artifact.caseId) {
      inputIssues.push({
        status: STATUS.UNSCORED,
        message: `${artifact.manifestName}: a valid caseId could not be recovered.`,
      });
      continue;
    }
    if (!knownIds.has(artifact.caseId)) {
      inputIssues.push({
        status: STATUS.UNSCORED,
        message: `${artifact.manifestName}: unknown fixture caseId ${artifact.caseId}.`,
      });
      continue;
    }
    const current = byCase.get(artifact.caseId);
    byCase.set(
      artifact.caseId,
      current ? (Array.isArray(current) ? [...current, artifact] : [current, artifact]) : artifact,
    );
  }
  const cases = activeFixtures.map((fixture) => evaluateFixture(fixture, byCase.get(fixture.id)));
  const statuses = [
    ...cases.map(({ status }) => status),
    ...inputIssues.map(({ status }) => status),
  ];
  const reportWithoutId = {
    schemaVersion: UXBENCH_REPORT_SCHEMA,
    harness: { name: 'nodeslide-uxbench', version: UXBENCH_VERSION },
    corpus: {
      version: registry.corpusVersion,
      registryDigest: digestValue(registry),
      fixtureDigests: Object.fromEntries(
        activeFixtures.map((fixture) => [fixture.id, fixtureDigest(fixture)]),
      ),
    },
    status: aggregateStatus(statuses),
    summary: statusCounts(cases.map(({ status }) => status)),
    artifactCount: artifacts.length,
    inputIssues,
    cases,
  };
  return { ...reportWithoutId, reportId: digestValue(reportWithoutId) };
}

export async function writeDeterministicJson(outputPath, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  try {
    const existing = await readFile(outputPath, 'utf8');
    if (existing === serialized) return { written: false, identical: true };
    throw new Error('Refusing to overwrite a nonidentical benchmark report.');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await writeFile(outputPath, serialized, { encoding: 'utf8', flag: 'wx' });
  return { written: true, identical: false };
}

async function cli(argv) {
  const options = parseCliArguments(argv);
  const registry = await loadRegistry(options.registryPath);
  const fixtures = await loadFixtures({
    fixturesDirectory: options.fixturesDirectory,
    registry,
  });
  const selectedCaseIds = options.caseIds;
  const fixtureIds = new Set(fixtures.map(({ id }) => id));
  for (const id of selectedCaseIds) {
    if (!fixtureIds.has(id)) throw new Error(`Unknown --case ${id}`);
  }
  const artifactPaths = await discoverArtifactPaths(options.artifactInputs);
  const artifacts = await Promise.all(
    artifactPaths.map((artifactPath) => loadUxArtifact(artifactPath)),
  );
  const report = runUxBench({ registry, fixtures, artifacts, selectedCaseIds });
  if (options.outputPath) await writeDeterministicJson(options.outputPath, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === STATUS.PASS ? 0 : report.status === STATUS.FAIL ? 1 : 2;
}

function parseCliArguments(argv) {
  const options = {
    registryPath: DEFAULT_REGISTRY_PATH,
    fixturesDirectory: DEFAULT_FIXTURES_DIRECTORY,
    artifactInputs: [],
    caseIds: [],
    outputPath: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--artifact' || argument === '--artifacts') {
      if (!value) throw new Error(`${argument} requires a path`);
      options.artifactInputs.push(path.resolve(value));
      index += 1;
    } else if (argument === '--case') {
      if (!value) throw new Error('--case requires an ID');
      options.caseIds.push(value);
      index += 1;
    } else if (argument === '--out') {
      if (!value) throw new Error('--out requires a path');
      options.outputPath = path.resolve(value);
      index += 1;
    } else if (argument === '--registry') {
      if (!value) throw new Error('--registry requires a path');
      options.registryPath = path.resolve(value);
      index += 1;
    } else if (argument === '--fixtures') {
      if (!value) throw new Error('--fixtures requires a directory');
      options.fixturesDirectory = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument ${argument}`);
    }
  }
  return options;
}

async function discoverArtifactPaths(inputs) {
  const paths = [];
  for (const input of inputs) {
    const metadata = await stat(input);
    if (metadata.isDirectory()) {
      const names = (await readdir(input)).filter((name) => name.endsWith('.manifest.json')).sort();
      paths.push(...names.map((name) => path.join(input, name)));
    } else if (metadata.isFile()) {
      paths.push(input);
    } else {
      throw new Error(`Artifact input is neither a file nor directory: ${input}`);
    }
  }
  return [...new Set(paths)].sort();
}

function finalizeCase(fixture, digest, artifact, checks) {
  const report = {
    caseId: fixture.id,
    title: fixture.title,
    status: aggregateStatus(checks.map(({ status }) => status)),
    runId: artifact?.ok ? artifact.manifest.runId : null,
    fixtureDigest: digest,
    artifactManifestDigest: artifact?.manifestDigest ?? null,
    checks,
  };
  report.summary = statusCounts(checks.map(({ status }) => status));
  return report;
}

function makeCheck(id, status, message, evidenceRefs) {
  return { id, status, message, evidenceRefs };
}

function comparisonCheck({ id, pass, message, failure, refs }) {
  return makeCheck(id, pass ? STATUS.PASS : STATUS.FAIL, pass ? message : failure, refs);
}

function manifestEvidenceReference(artifact, pointer) {
  return {
    artifactId: artifact.manifest.artifactId,
    evidenceId: 'manifest',
    kind: 'manifest',
    path: artifact.manifestName,
    sha256: artifact.manifestDigest,
    pointer,
  };
}

function runRecordEvidenceReference(artifact, pointer) {
  return {
    artifactId: artifact.manifest.artifactId,
    evidenceId: artifact.evidence.id,
    kind: artifact.evidence.kind,
    path: normalizeRelativePath(artifact.evidence.path),
    sha256: artifact.evidence.sha256,
    pointer,
  };
}

export function aggregateStatus(statuses) {
  if (statuses.includes(STATUS.FAIL)) return STATUS.FAIL;
  if (statuses.includes(STATUS.UNSCORED) || statuses.length === 0) return STATUS.UNSCORED;
  return STATUS.PASS;
}

function statusCounts(statuses) {
  return {
    pass: statuses.filter((status) => status === STATUS.PASS).length,
    fail: statuses.filter((status) => status === STATUS.FAIL).length,
    unscored: statuses.filter((status) => status === STATUS.UNSCORED).length,
  };
}

function orderedSubsequence(actual, required) {
  let cursor = 0;
  for (const value of actual) {
    if (value === required[cursor]) cursor += 1;
    if (cursor === required.length) return true;
  }
  return required.length === 0;
}

function setEquals(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const leftValues = [...new Set(left.map((entry) => stableStringify(entry)))].sort();
  const rightValues = [...new Set(right.map((entry) => stableStringify(entry)))].sort();
  return deepEqual(leftValues, rightValues);
}

function containsValue(container, value) {
  if (typeof container === 'string' && typeof value === 'string') return container.includes(value);
  return Array.isArray(container) && container.some((entry) => deepEqual(entry, value));
}

function hasLength(value) {
  return typeof value === 'string' || Array.isArray(value);
}

function nonempty(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return value !== null && value !== undefined && value !== false;
}

function deepEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function duplicates(values) {
  const seen = new Set();
  const duplicatesFound = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicatesFound.add(value);
    seen.add(value);
  }
  return [...duplicatesFound].sort();
}

function validateStringArray(value, label, errors, { minimum = 0 } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return;
  }
  if (value.length < minimum) errors.push(`${label} must contain at least ${minimum} item(s)`);
  if (value.some((entry) => !nonemptyString(entry))) {
    errors.push(`${label} must contain only nonempty strings`);
  }
  if (new Set(value).size !== value.length) errors.push(`${label} must contain unique values`);
}

function validateProducer(value, label, errors) {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  rejectUnknownKeys(value, new Set(['name', 'version']), label, errors);
  if (!nonemptyString(value.name)) errors.push(`${label}.name must be nonempty`);
  if (!nonemptyString(value.version)) errors.push(`${label}.version must be nonempty`);
}

function rejectUnknownKeys(value, allowed, label, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${label} has unknown key ${key}`);
  }
}

function validJsonPointer(pointer) {
  return typeof pointer === 'string' && (pointer === '' || pointer.startsWith('/'));
}

function decodePointerToken(token) {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
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

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function nonnegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
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
